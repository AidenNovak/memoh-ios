import XCTest
#if canImport(MemohKit)
@testable import MemohKit
#endif
#if canImport(UIKit)
import UIKit

/// Run in an iOS hosted XCTest target linked to MemohKit/ExpoModulesCore.
/// These tests use the production view, no account, network, or test renderer.
@MainActor
final class MessageListTests: XCTestCase {
  func testToolAndAttachmentReconfigurationClearsOldContent() throws {
    let tool = ToolMessageCell(frame: .zero)
    let failed = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"failed","input":{"command":"pytest"},"error":"Permission denied"}]"#)).first)
    tool.configure(failed)
    // 工具名是标题；状态跟在后面（同一行），不与它抢层级。
    XCTAssertEqual(tool.heading.text, "exec")
    XCTAssertEqual(tool.stateLabel.text, MemohStrings.text("Failed"))
    XCTAssertNotNil(tool.symbol.image)
    XCTAssertTrue(tool.accessibilityLabel?.contains("pytest") == true)
    XCTAssertTrue(tool.accessibilityLabel?.contains("Permission denied") == true)
    let done = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"done"}]"#)).first)
    tool.configure(done)
    XCTAssertEqual(tool.stateLabel.text, MemohStrings.text("Done"))
    XCTAssertFalse(tool.accessibilityLabel?.contains("Permission denied") == true)
    XCTAssertFalse(tool.accessibilityLabel?.contains("pytest") == true)

    let attachments = AttachmentsMessageCell(frame: .zero)
    let files = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"files","kind":"attachments","items":[{"key":"a","name":"a.png","size":1024,"isImage":true},{"key":"b","name":"b.txt","isImage":false}]}]"#)).first)
    attachments.configure(files)
    let fileStack = try XCTUnwrap(attachments.stack.arrangedSubviews.last as? UIStackView)
    XCTAssertEqual(fileStack.arrangedSubviews.count, 2)
    attachments.configure(files)
    XCTAssertEqual(fileStack.arrangedSubviews.count, 2)
    attachments.prepareForReuse()
    XCTAssertEqual(fileStack.arrangedSubviews.count, 0)
  }

  func testReasoningCellReuseAndAccessibleDisclosure() throws {
    let row = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"thought","kind":"reasoning","text":"A long thought","streaming":true}]"#)).first)
    let cell = ReasoningMessageCell(frame: CGRect(x: 0, y: 0, width: 358, height: 200))
    var state = ReasoningExpansionState()
    state.toggle(row.id)
    cell.configure(row, expanded: state.isExpanded(row.id))
    XCTAssertEqual(cell.body.numberOfLines, 0)
    XCTAssertEqual(cell.accessibilityIdentifier, "message-block-thought")
    XCTAssertTrue(cell.isAccessibilityElement)
    XCTAssertEqual(cell.accessibilityCustomActions?.count, 1)
    var toggles = 0
    cell.onToggle = { toggles += 1 }
    cell.disclosure.sendActions(for: .touchUpInside)
    XCTAssertEqual(toggles, 1)
    cell.prepareForReuse()
    XCTAssertNil(cell.onToggle)
    XCTAssertNil(cell.accessibilityCustomActions)
    XCTAssertEqual(cell.body.numberOfLines, 3)
    cell.configure(row, expanded: state.isExpanded(row.id))
    XCTAssertEqual(cell.body.numberOfLines, 0)
    state.toggle(row.id)
    cell.configure(row, expanded: state.isExpanded(row.id))
    XCTAssertEqual(cell.body.numberOfLines, 3)
  }

  private func fixture(_ indices: Range<Int>, suffix: String = "") throws -> String {
    let turns: [[String: Any]] = indices.map { index in
      ["key": "turn-\(index)", "position": index, "active": false,
       "assistant": ["key": "message-\(index)", "role": "assistant", "blocks": [
        ["key": "block-\(index)", "kind": "text", "text": "Message \(index) " + (index == indices.upperBound - 1 ? suffix : ""),
         "streaming": !suffix.isEmpty],
       ]]]
    }
    return String(decoding: try JSONSerialization.data(withJSONObject: turns), as: UTF8.self)
  }

  private func settle() async throws {
    // Bounded wait; assertions below fail if the expected scene never arrived.
    try await Task.sleep(for: .milliseconds(250))
  }

  func testStableIdentityAndAuthoritativeOrder() throws {
    let old = try TranscriptRow.decode(fixture(0..<3))
    let grown = try TranscriptRow.decode(fixture(0..<3, suffix: "More text"))
    XCTAssertEqual(old.map(\.id), grown.map(\.id))
    XCTAssertNotEqual(old.last, grown.last)
    let prepended = try TranscriptRow.decode(fixture(-2..<3))
    XCTAssertEqual(Array(prepended.suffix(3)).map(\.id), old.map(\.id))
    XCTAssertThrowsError(try TranscriptRow.decode("not JSON"))
    let one = try fixture(0..<1)
    let duplicate = "[" + one.dropFirst().dropLast() + "," + one.dropFirst().dropLast() + "]"
    XCTAssertThrowsError(try TranscriptRow.decode(duplicate))
  }

  func testStreamingFollowReadingAnchorAndReturnButton() async throws {
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    let list = NativeMessageList(appContext: nil)
    list.frame = window.bounds
    controller.view.addSubview(list)
    window.isHidden = false
    defer { window.isHidden = true }
    list.setTurnsJSON(try fixture(0..<1000))
    try await settle()
    list.layoutIfNeeded()
    let collection = try XCTUnwrap(list.subviews.compactMap { $0 as? UICollectionView }.first)
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 1000)
    XCTAssertLessThan(collection.visibleCells.count, 1000)

    list.setTurnsJSON(try fixture(0..<1001))
    try await settle()
    let bottom = collection.contentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom
    XCTAssertEqual(collection.contentOffset.y, bottom, accuracy: 2)

    let streamedText = String(repeating: "Streaming line\n", count: 20)
    list.setTurnsJSON(try fixture(0..<1001, suffix: streamedText))
    try await settle()
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 1001)
    XCTAssertTrue(collection.visibleCells.contains { $0.accessibilityLabel?.contains(streamedText) == true })
    XCTAssertEqual(collection.contentOffset.y,
                   collection.contentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom,
                   accuracy: 2)

    // Inject only the gesture boundary; data source, cells, and layout are production code.
    list.scrollViewWillBeginDragging(collection)
    collection.contentOffset.y = 300
    collection.layoutIfNeeded()
    let anchorPath = try XCTUnwrap(collection.indexPathsForVisibleItems.sorted().first)
    let anchorCell = try XCTUnwrap(collection.cellForItem(at: anchorPath))
    let anchorID = anchorCell.accessibilityIdentifier
    let distance = try XCTUnwrap(collection.layoutAttributesForItem(at: anchorPath)).frame.minY - collection.contentOffset.y
    list.setTurnsJSON(try fixture(-5..<1002))
    try await settle()
    let restored = try XCTUnwrap(collection.visibleCells.first { $0.accessibilityIdentifier == anchorID })
    XCTAssertEqual(restored.frame.minY - collection.contentOffset.y, distance, accuracy: 2)
    let button = try XCTUnwrap(list.subviews.compactMap { $0 as? UIButton }.first)
    XCTAssertFalse(button.isHidden)
    XCTAssertGreaterThanOrEqual(button.bounds.height, 44)
    button.sendActions(for: .touchUpInside)
    XCTAssertTrue(button.isHidden)
    XCTAssertEqual(collection.contentOffset.y,
                   collection.contentSize.height - collection.bounds.height + collection.adjustedContentInset.bottom,
                   accuracy: 2)

    list.setTurnsJSON("invalid")
    try await settle()
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 1007)
    list.setTurnsJSON("[]")
    try await settle()
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 0)
  }

  /**
   两种表面必须**真的**映射到不同的颜色。

   政策层的断言（两者是不同的枚举值）在 `MessageListLogicTests` 里；这里验证实现
   没有在转换那一步又把它们填回同一个。实测这里曾经就是同一个灰：一张工具场景截图
   里那种灰占了 49% 的像素，整屏没有层级——所以这条不是形式主义。
   */
  func testActivitySurfaceDiffersFromUserBubble() {
    let user = MessageBlockCell.color(for: MessageListMetrics.userSurface)
    let activity = MessageBlockCell.color(for: MessageListMetrics.activitySurface)
    XCTAssertNotEqual(user, activity, "两种表面映射到了同一种颜色——层级会在真实屏幕上消失")
    XCTAssertGreaterThan(user.cgColor.alpha, 0.9, "用户气泡必须是实心的：用户说的话是实体")
  }

  /**
   工具卡片的两行结构：工具名（标题）+ 状态（同一行的修饰）。

   之前"Running"和工具名各占一行、都是 headline 字号，于是状态和它修饰的东西一样
   重。这里钉住新的关系：工具名在 `heading`，状态在它旁边。
   */
  func testToolHeaderNamesToolAndStatesStatusBeside() throws {
    let row = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"running","execution_location":{"kind":"container","name":"workspace"}}]"#)).first)
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(row)
    XCTAssertEqual(cell.heading.text, "exec", "标题该是工具名，不是状态")
    XCTAssertEqual(cell.stateLabel.text, "Running · workspace",
                   "状态与执行位置合成一行，跟在工具名后面")
    XCTAssertFalse(cell.stateLabel.isHidden)
  }
}
#endif

// No UIKit, Expo, window, account, or simulator required. Compile alongside Transcript.swift.
final class MessageListLogicTests: XCTestCase {
  static func transcript(_ blocks: String, turn: String = "turn", message: String = "message") -> String {
    """
    [{"key":"\(turn)","position":0,"active":false,
      "assistant":{"key":"\(message)","role":"assistant","blocks":\(blocks)}}]
    """
  }

  func testToolStateMapping() throws {
    let expected: [(String?, ToolState, String, String)] = [
      ("running", .running, "Running", "hourglass"),
      ("done", .done, "Done", "checkmark.circle.fill"),
      ("failed", .failed, "Failed", "exclamationmark.triangle.fill"),
      ("unknown", .unknown, "Unknown", "questionmark.circle"),
      ("future-state", .unknown, "Unknown", "questionmark.circle"),
      (nil, .unknown, "Unknown", "questionmark.circle"),
    ]
    for (status, state, title, symbol) in expected {
      let field = status.map { #", "status":"\#($0)""# } ?? ""
      let row = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
        #"[{"key":"tool","kind":"tool"\#(field)}]"#)).first)
      XCTAssertEqual(row.block.toolState, state)
      XCTAssertEqual(row.block.toolState.titleKey, title)
      XCTAssertEqual(row.block.toolState.symbolName, symbol)
    }
    XCTAssertEqual(Set(ToolState.allCases.map(\.symbolName)).count, 4)
  }

  /**
   层级不是靠感觉，靠可以断言的规则。这是**实测踩出来的**
   （`verification/ui/tools/measure_surfaces.py` 量的真实截图），不是审美偏好。

   这里只断言**政策**：两种表面必须是不同的东西。它们各自映射到什么颜色是 UI 层
   的事，由 UIKit 宿主测试 `testActivitySurfaceDiffersFromUserBubble` 保证——
   那个断言需要 UIKit，所以放在另一半。
   */
  func testHierarchySeparatesUserBubblesFromAgentActivity() {
    XCTAssertNotEqual(MessageListMetrics.userSurface, MessageListMetrics.activitySurface,
                      "用户气泡与 agent 活动卡片必须是不同的表面，否则屏幕上没有层级")
  }

  /** 工具标题的显示规则：同一句话不该在卡片上出现两次。 */
  func testToolTitleVisibility() {
    // 标题 === 入参里的命令 → 不显示。
    XCTAssertFalse(MessageListMetrics.showsToolTitle(
      title: "pytest -q", name: "exec", inputPreview: "command: pytest -q"))
    XCTAssertFalse(MessageListMetrics.showsToolTitle(
      title: "RM -RF /tmp", name: "exec", inputPreview: "command: rm -rf /tmp"),
      "重复判定应当忽略大小写")
    // 标题就是工具名 → 不显示（上面已经有了）。
    XCTAssertFalse(MessageListMetrics.showsToolTitle(
      title: "exec", name: "exec", inputPreview: nil))
    // 没有标题 → 不显示。
    XCTAssertFalse(MessageListMetrics.showsToolTitle(title: nil, name: "exec", inputPreview: "command: ls"))
    XCTAssertFalse(MessageListMetrics.showsToolTitle(title: "", name: "exec", inputPreview: "command: ls"))
    // 标题是摘要、入参是具体命令 → 显示（它补充了信息）。
    XCTAssertTrue(MessageListMetrics.showsToolTitle(
      title: "Running the test suite", name: "exec", inputPreview: "command: pytest -q"))
    // **没有入参时标题是唯一的信息来源，必须显示**——这是最容易写反的一条。
    XCTAssertTrue(MessageListMetrics.showsToolTitle(
      title: "pytest -q", name: "exec", inputPreview: nil))
  }

  func testToolInputShapesAndInputOnlyUpdates() throws {
    let inputs = [
      #"{"command":"pytest -q tests/reports","cwd":"/data","flags":[true,2,null]}"#,
      #""echo hello""#, #"["one",false,3]"#, "42", "false", "{}", "[]", "null",
    ]
    for input in inputs {
      let row = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
        #"[{"key":"tool","kind":"tool","input":\#(input)}]"#)).first)
      if input == "null" { XCTAssertNil(row.block.input) }
      else { XCTAssertFalse(try XCTUnwrap(row.block.input).preview.isEmpty) }
    }
    let first = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
      #"[{"key":"tool","kind":"tool","input":{"command":"pwd"}}]"#)).first)
    let second = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
      #"[{"key":"tool","kind":"tool","input":{"command":"ls"}}]"#)).first)
    XCTAssertEqual(first.id, second.id)
    XCTAssertNotEqual(first, second)
    XCTAssertTrue(try XCTUnwrap(first.block.input).preview.contains("pwd"))
    XCTAssertEqual(ToolInput.string("echo hello").preview, "echo hello")
    let long = ToolInput.string(String(repeating: "界", count: 900)).preview
    XCTAssertEqual(long.count, MessageListMetrics.inputCharacterLimit + 1)
    XCTAssertTrue(long.hasSuffix("…"))
    XCTAssertEqual(ToolInput.object(["z": .bool(true), "a": .number(1)]).preview,
                   ToolInput.object(["a": .number(1), "z": .bool(true)]).preview)
  }

  func testReasoningStateSurvivesStreamingAndUsesFullIdentity() throws {
    let blocks = #"[{"key":"thought","kind":"reasoning","text":"First","streaming":true}]"#
    let first = try XCTUnwrap(TranscriptRow.decode(Self.transcript(blocks)).first)
    let grown = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
      blocks.replacingOccurrences(of: "First", with: "First and more"))).first)
    let other = try XCTUnwrap(TranscriptRow.decode(Self.transcript(blocks, turn: "other")).first)
    var state = ReasoningExpansionState()
    XCTAssertFalse(state.isExpanded(first.id))
    state.toggle(first.id)
    XCTAssertTrue(state.isExpanded(grown.id))
    XCTAssertFalse(state.isExpanded(other.id))
    state.retain([grown.id, other.id])
    XCTAssertTrue(state.isExpanded(first.id))
    state.toggle(first.id)
    XCTAssertFalse(state.isExpanded(first.id))
    state.toggle(first.id)
    state.retain([other.id])
    XCTAssertFalse(state.isExpanded(first.id))
    state.toggle(other.id)
    state.retain([])
    XCTAssertFalse(state.isExpanded(other.id))
  }

  func testAttachmentsCountTypesAndSizes() throws {
    let row = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
      #"[{"key":"files","kind":"attachments","items":[{"key":"a","name":"chart.png","mime":"image/png","size":240000,"isImage":true},{"key":"b","name":"notes.txt","size":0,"isImage":false},{"key":"c","name":"clip.mp4","mime":"video/mp4","isImage":false}]}]"#)).first)
    let items = try XCTUnwrap(row.block.items)
    XCTAssertEqual(items.count, 3)
    XCTAssertEqual(items.map(\.name), ["chart.png", "notes.txt", "clip.mp4"])
    XCTAssertEqual(items.map(\.symbolName), ["photo", "doc", "film"])
    XCTAssertNotNil(items[0].formattedSize)
    XCTAssertNotNil(items[1].formattedSize)
    XCTAssertNil(items[2].formattedSize)
    let empty = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
      #"[{"key":"files","kind":"attachments","items":[]}]"#)).first)
    XCTAssertEqual(empty.block.items?.count, 0)
    for size in [-1.0, Double.infinity, Double.nan, Double(Int64.max)] {
      let item = TranscriptBlock.Attachment(key: "bad", name: "bad", mime: nil, url: nil, size: size, isImage: false)
      XCTAssertNil(item.formattedSize)
    }
  }

  func testErrorCodeAndNoticeRemainDistinct() throws {
    let rows = try TranscriptRow.decode(Self.transcript(
      #"[{"key":"e","kind":"error","text":"Read only","code":"fs.readonly"},{"key":"n","kind":"notice","text":"Restored"}]"#))
    XCTAssertEqual(rows[0].block.kind, .error)
    XCTAssertEqual(rows[0].block.code, "fs.readonly")
    XCTAssertEqual(rows[1].block.kind, .notice)
    XCTAssertNil(rows[1].block.code)
  }

  func testLayoutPolicyAndScrollClamping() {
    XCTAssertEqual(MessageListMetrics.reasoningLineLimit(expanded: false), 3)
    XCTAssertEqual(MessageListMetrics.reasoningLineLimit(expanded: true), 0)
    XCTAssertEqual(MessageListMetrics.inputLineLimit, 5)
    XCTAssertEqual(MessageListMetrics.blockSpacing, 16)
    XCTAssertEqual(MessageListMetrics.userWidthFraction(accessibilitySize: false), 0.78)
    XCTAssertEqual(MessageListMetrics.userWidthFraction(accessibilitySize: true), 0.94)
    XCTAssertEqual(MessageListMetrics.bottomOffset(contentHeight: 100, viewportHeight: 800, topInset: 20, bottomInset: 34), -20)
    XCTAssertEqual(MessageListMetrics.bottomOffset(contentHeight: 1000, viewportHeight: 800, topInset: 20, bottomInset: 34), 234)
    // A history prepend of 200 keeps the same row at the same on-screen distance.
    XCTAssertEqual(MessageListMetrics.anchoredOffset(itemTop: 600, distance: 100, topInset: 20, bottomOffset: 1000), 500)
    XCTAssertEqual(MessageListMetrics.anchoredOffset(itemTop: 800, distance: 100, topInset: 20, bottomOffset: 1000), 700)
    XCTAssertEqual(MessageListMetrics.anchoredOffset(itemTop: 0, distance: 100, topInset: 20, bottomOffset: 1000), -20)
    XCTAssertEqual(MessageListMetrics.anchoredOffset(itemTop: 1200, distance: 0, topInset: 20, bottomOffset: 1000), 1000)
    XCTAssertFalse(MessageListMetrics.isNearBottom(offset: 975, bottomOffset: 1000))
    XCTAssertTrue(MessageListMetrics.isNearBottom(offset: 976, bottomOffset: 1000))
    XCTAssertTrue(MessageListMetrics.isNearBottom(offset: 1020, bottomOffset: 1000))
    XCTAssertTrue(MessageListMetrics.canRestoreAnchor(capturedRevision: 1, currentRevision: 1, isInteracting: false))
    XCTAssertFalse(MessageListMetrics.canRestoreAnchor(capturedRevision: 1, currentRevision: 2, isInteracting: false))
    XCTAssertFalse(MessageListMetrics.canRestoreAnchor(capturedRevision: 1, currentRevision: 1, isInteracting: true))
    XCTAssertFalse(MessageListMetrics.canRestoreAnchor(capturedRevision: 1, currentRevision: 2, isInteracting: true))
  }
}

#if !canImport(UIKit)
// swiftc Transcript.swift MessageListTests.swift -o message-list-tests && ./message-list-tests
@main
enum MessageListTestRunner {
  static func main() {
    XCTMain([testCase([
      ("testToolStateMapping", MessageListLogicTests.testToolStateMapping),
      ("testHierarchySeparatesUserBubblesFromAgentActivity", MessageListLogicTests.testHierarchySeparatesUserBubblesFromAgentActivity),
      ("testToolTitleVisibility", MessageListLogicTests.testToolTitleVisibility),
      ("testToolInputShapesAndInputOnlyUpdates", MessageListLogicTests.testToolInputShapesAndInputOnlyUpdates),
      ("testReasoningStateSurvivesStreamingAndUsesFullIdentity", MessageListLogicTests.testReasoningStateSurvivesStreamingAndUsesFullIdentity),
      ("testAttachmentsCountTypesAndSizes", MessageListLogicTests.testAttachmentsCountTypesAndSizes),
      ("testErrorCodeAndNoticeRemainDistinct", MessageListLogicTests.testErrorCodeAndNoticeRemainDistinct),
      ("testLayoutPolicyAndScrollClamping", MessageListLogicTests.testLayoutPolicyAndScrollClamping),
    ])])
  }
}
#endif
