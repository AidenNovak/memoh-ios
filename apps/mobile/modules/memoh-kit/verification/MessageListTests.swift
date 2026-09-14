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
    // 聚合行只显示活动措辞；原始名字、入参与诊断留在无障碍内容里。
    XCTAssertEqual(tool.heading.text, MemohStrings.text("Ran commands"))
    // 有详情（这里是 error）的可展开工具，无障碍值表达**展开态**而非状态词。
    XCTAssertEqual(tool.accessibilityValue, MemohStrings.text("Collapsed"))
    XCTAssertNotNil(tool.symbol.image)
    XCTAssertTrue(tool.accessibilityLabel?.contains("pytest") == true)
    XCTAssertTrue(tool.accessibilityLabel?.contains("Permission denied") == true)
    let done = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"done"}]"#)).first)
    tool.configure(done)
    // 无详情、非运行的块不贴任何词（完成不宣布，见 R2 评审 §2b）。
    XCTAssertNil(tool.accessibilityValue, "完成态不贴状态词")
    XCTAssertFalse(tool.symbol.isHidden, "类型图标不是成功标记，完成时仍保留")
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
    // 依赖 NativeMessageList（ExpoView，import ExpoModulesCore）：只有链接了
    // MemohKit/ExpoModulesCore 的 hosted target 才能编译这条（见文件头注释）。
    #if canImport(MemohKit)
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
    #endif
  }

  /**
   两种表面必须**真的**映射到不同的颜色。

   政策层的断言（两者是不同的枚举值）在 `MessageListLogicTests` 里；这里验证实现
   没有在转换那一步又把它们填回同一个。实测这里曾经就是同一个灰：一张工具场景截图
   里那种灰占了 49% 的像素，整屏没有层级——所以这条不是形式主义。
   */
  func testActivitySurfaceDiffersFromUserBubble() {
    let traits = UITraitCollection()
    let user = MessageBlockCell.color(for: MessageListMetrics.userSurface, traits: traits)
    let activity = MessageBlockCell.color(for: MessageListMetrics.activitySurface, traits: traits)
    XCTAssertNotEqual(user, activity, "两种表面映射到了同一种颜色——层级会在真实屏幕上消失")
    XCTAssertGreaterThan(user.cgColor.alpha, 0.9, "用户气泡必须是实心的：用户说的话是实体")
  }

  /// 活动措辞保持不变；运行状态由行尾 spinner 与 VoiceOver value 表达。
  func testToolHeaderNamesToolAndStatesStatusBeside() throws {
    let row = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"running","location":"workspace"}]"#)).first)
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(row)
    XCTAssertEqual(cell.heading.text, MemohStrings.text("Ran commands"))
    XCTAssertEqual(cell.accessibilityValue, MemohStrings.text("Running"))
    XCTAssertTrue(cell.accessibilityLabel?.contains("exec. workspace") == true)
    XCTAssertTrue(cell.spinner.isAnimating, "执行中要有活的指示，静止图标会被读成卡住")
    XCTAssertFalse(cell.symbol.isHidden, "前导图标表达活动类型，不重复表达运行状态")
    XCTAssertEqual(cell.heading.font, UIFont.preferredFont(forTextStyle: .footnote))
    XCTAssertTrue(cell.heading.adjustsFontForContentSizeCategory)
    XCTAssertEqual(cell.stack.layer.borderWidth, 0)
    XCTAssertEqual(cell.stack.backgroundColor, .clear)
    XCTAssertTrue(cell.isAccessibilityElement)
    XCTAssertEqual(cell.accessibilityIdentifier, "message-block-tool")
    XCTAssertNil(cell.accessibilityCustomActions)
    XCTAssertFalse(cell.accessibilityTraits.contains(.button))

    // 完成后仍是相同的类型图标与措辞，只停 spinner。
    let finished = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"done","location":"workspace"}]"#)).first)
    cell.configure(finished)
    XCTAssertNil(cell.accessibilityValue, "完成态不贴状态词")
    XCTAssertFalse(cell.symbol.isHidden)
    XCTAssertFalse(cell.spinner.isAnimating, "跑完了要停掉 spinner，不能留着空转")
    XCTAssertEqual(cell.heading.text, MemohStrings.text("Ran commands"))
    cell.configure(row)
    cell.prepareForReuse()
    XCTAssertFalse(cell.spinner.isAnimating)
    XCTAssertNil(cell.accessibilityLabel)
    XCTAssertNil(cell.accessibilityIdentifier)
  }

  func testGroupedToolErrorsKeepNeutralRenderingAndAllAccessibleNames() throws {
    let rows = try TranscriptRow.decode(MessageListLogicTests.transcript(MessageListLogicTests.chatToolsBlocks))
    let group = try XCTUnwrap(MessageListLogicTests.toolGroups(rows).first)
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(group)
    let text = cell.heading.text
    let icon = cell.symbol.image
    // 状态色用 Memoh 品牌次标签色（暖灰 #6A6965），不是系统 .secondaryLabel——
    // 这是品牌对齐后的设计决策（tokens.ts 与 MemohPalette.swift 两端一致）。
    let expected = MemohPalette.secondaryLabel(cell.traitCollection)
    XCTAssertEqual(cell.heading.textColor, expected)
    XCTAssertEqual(cell.symbol.tintColor, expected)
    XCTAssertEqual(cell.spinner.color, expected)
    XCTAssertTrue(cell.spinner.isAnimating)
    XCTAssertTrue(cell.body.isHidden)
    XCTAssertEqual(cell.accessibilityIdentifier, "message-block-m10")
    XCTAssertEqual(cell.accessibilityLabel?.components(separatedBy: "exec").count, 3)
    XCTAssertTrue(cell.accessibilityLabel?.contains("fs_write") == true)
    let clean = MessageListLogicTests.chatToolsBlocks.replacingOccurrences(of: "\"isError\":true", with: "\"isError\":false")
    let cleanRows = try TranscriptRow.decode(MessageListLogicTests.transcript(clean))
    cell.configure(try XCTUnwrap(MessageListLogicTests.toolGroups(cleanRows).first))
    XCTAssertEqual(cell.heading.text, text)
    XCTAssertEqual(cell.symbol.image, icon)
    XCTAssertEqual(cell.heading.textColor, expected)
    XCTAssertEqual(cell.symbol.tintColor, expected)
    XCTAssertEqual(cell.spinner.color, expected)
  }

  func testToolCardExpansionLayersInputAndKeepsNeutralHeading() throws {
    // 输入条目：key 次要色 / value 正文色（R2 第 3 项）；失败诊断用危险红；
    // 标题保持中性，不因 isError 染色；耗时只在服务端给了才显示。
    let blocks = #"[{"key":"a","kind":"tool","name":"exec","status":"done","location":"workspace","durationMs":1500,"input":{"command":"pytest -q","cwd":"/tmp"}},{"key":"b","kind":"tool","name":"fs_read","status":"done","input":{"path":"a.txt"},"output":{"isError":true,"content":[{"type":"text","text":"Permission denied"}]}}]"#
    let rows = try TranscriptRow.decode(MessageListLogicTests.transcript(blocks))
    let group = try XCTUnwrap(MessageListLogicTests.toolGroups(rows).first)
    XCTAssertTrue(group.expandable, "有输入条目 + 失败诊断，应该可展开")
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(group, expanded: true)
    XCTAssertFalse(cell.detailStack.isHidden, "展开后详情容器必须可见")
    XCTAssertFalse(cell.disclosure.isHidden, "可展开的工具必须有箭头")
    // 标题与箭头都保持中性（失败不染色）。
    let expected = MemohPalette.secondaryLabel(cell.traitCollection)
    XCTAssertEqual(cell.heading.textColor, expected)
    // 详情内容：成员块里应能找到输入条目（key muted / value fg）与红色诊断。
    let memberBlocks = cell.detailStack.arrangedSubviews.compactMap { $0 as? UIStackView }
    XCTAssertEqual(memberBlocks.count, 2, "两个成员各一个块")
    // 输入行是横向 stack（key/value 两个 label），要递归一层才能拿到。
    let allLabels = memberBlocks.flatMap { block in
      block.arrangedSubviews.flatMap { view -> [UILabel] in
        if let row = view as? UIStackView {
          return row.arrangedSubviews.compactMap { $0 as? UILabel }
        }
        return [view].compactMap { $0 as? UILabel }
      }
    }
    let keyLabels = allLabels.filter { $0.text == "command" || $0.text == "cwd" || $0.text == "path" }
    XCTAssertEqual(keyLabels.count, 3, "输入条目的 key 应该渲染出来")
    for key in keyLabels {
      XCTAssertEqual(key.textColor, expected, "key 用次要色")
    }
    let redDiagnosis = allLabels.filter { $0.text?.contains("Permission denied") == true }
    XCTAssertEqual(redDiagnosis.count, 1, "失败诊断要渲染出来")
    XCTAssertEqual(redDiagnosis[0].textColor, MemohPalette.destructive(cell.traitCollection), "诊断用危险红")
    XCTAssertTrue(allLabels.contains { $0.text?.contains("1.5s") == true }, "服务端给了耗时就要显示")
    // 折叠后详情收起、箭头仍在（可再展开）。
    cell.configure(group, expanded: false)
    XCTAssertTrue(cell.detailStack.isHidden)
    XCTAssertFalse(cell.disclosure.isHidden)
  }

  func testToolCardDisclosureTogglesAndExposesVoiceOverAction() throws {
    let blocks = #"[{"key":"a","kind":"tool","name":"exec","status":"done","input":{"command":"pytest"}},{"key":"b","kind":"tool","name":"fs_read","status":"done","input":{"path":"a.txt"}}]"#
    let rows = try TranscriptRow.decode(MessageListLogicTests.transcript(blocks))
    let group = try XCTUnwrap(MessageListLogicTests.toolGroups(rows).first)
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(group)
    XCTAssertEqual(cell.accessibilityCustomActions?.count, 1, "可展开的工具要暴露 custom action")
    var toggles = 0
    cell.onToggle = { toggles += 1 }
    cell.disclosure.sendActions(for: .touchUpInside)
    XCTAssertEqual(toggles, 1, "点箭头要触发 onToggle")
    cell.prepareForReuse()
    XCTAssertNil(cell.onToggle)
    XCTAssertNil(cell.accessibilityCustomActions)
  }

  func testToolCardNotExpandableWhileRunning() throws {
    let blocks = #"[{"key":"a","kind":"tool","name":"exec","status":"running","input":{"command":"pytest"}}]"#
    let rows = try TranscriptRow.decode(MessageListLogicTests.transcript(blocks))
    let group = try XCTUnwrap(MessageListLogicTests.toolGroups(rows).first)
    XCTAssertFalse(group.expandable, "运行中不可展开——参数可能还在流")
    let cell = ToolMessageCell(frame: .zero)
    cell.configure(group, expanded: true)
    XCTAssertTrue(cell.disclosure.isHidden, "运行中不显示箭头")
    XCTAssertTrue(cell.detailStack.isHidden, "运行中不渲染详情")
  }

  func testToolExpansionStateTogglesAndRetains() {
    let id = TranscriptRow.ID(turn: "t", message: "m", role: "user", block: "b", kind: .tool)
    var state = ToolExpansionState()
    XCTAssertFalse(state.isExpanded(id))
    state.toggle(id)
    XCTAssertTrue(state.isExpanded(id), "toggle 之后应该展开")
    state.toggle(id)
    XCTAssertFalse(state.isExpanded(id), "再 toggle 应该收起")
    state.toggle(id)
    state.retain([TranscriptRow.ID(turn: "t", message: "m", role: "user", block: "gone", kind: .tool)])
    XCTAssertFalse(state.isExpanded(id), "retain 只保留现存 id")
  }

  func testToolInputEntriesExposeFlatScalarPairs() throws {
    // entries 只摊平标量对象；嵌套/数组退回空（视觉分层只服务真正可读的键值）。
    let flat = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"t","kind":"tool","name":"exec","input":{"command":"pytest -q","cwd":"/tmp","flag":true}}]"#)).first)
    let entries = try XCTUnwrap(flat.block.input?.entries)
    XCTAssertEqual(entries.map(\.key), ["command", "cwd", "flag"], "按 key 排序")
    XCTAssertEqual(entries.map(\.value), ["pytest -q", "/tmp", "true"])
    let nested = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"t","kind":"tool","name":"exec","input":{"command":{"shell":"bash","args":["-c","pwd"]}}}]"#)).first)
    XCTAssertTrue(nested.block.input?.entries.isEmpty == true, "嵌套对象不摊平")
  }

  func testListGroupsToolsAndRefreshesWhenNonFirstToolFinishes() async throws {
    // 同 testStreamingFollowReadingAnchorAndReturnButton：依赖 NativeMessageList。
    #if canImport(MemohKit)
    let list = NativeMessageList(appContext: nil)
    list.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    let blocks = #"[{"key":"a","kind":"tool","name":"exec","status":"done"},{"key":"b","kind":"tool","name":"fs_read","status":"running"}]"#
    list.setTurnsJSON(MessageListLogicTests.transcript(blocks))
    try await settle()
    list.layoutIfNeeded()
    let collection = try XCTUnwrap(list.subviews.compactMap { $0 as? UICollectionView }.first)
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 1)
    let cell = try XCTUnwrap(collection.cellForItem(at: IndexPath(item: 0, section: 0)) as? ToolMessageCell)
    XCTAssertEqual(cell.accessibilityIdentifier, "message-block-a")
    XCTAssertTrue(cell.spinner.isAnimating)
    let text = cell.heading.text
    list.setTurnsJSON(MessageListLogicTests.transcript(blocks.replacingOccurrences(of: "running", with: "done")))
    try await settle()
    XCTAssertEqual(collection.numberOfItems(inSection: 0), 1)
    let updated = try XCTUnwrap(collection.cellForItem(at: IndexPath(item: 0, section: 0)) as? ToolMessageCell)
    XCTAssertEqual(updated.accessibilityIdentifier, "message-block-a")
    XCTAssertEqual(updated.heading.text, text)
    XCTAssertFalse(updated.spinner.isAnimating)
    #endif
  }
}
#endif

// No UIKit, Expo, window, account, or simulator required. Compile alongside Transcript.swift.
final class MessageListLogicTests: XCTestCase {
  // chat-tools after the TS reducer: running -> status, execution_location -> location.
  static let chatToolsBlocks = #"[{"key":"m10","kind":"tool","name":"exec","title":"pytest -q tests/reports","status":"running","location":"workspace","input":{"command":"pytest -q tests/reports"}},{"key":"m11","kind":"tool","name":"fs_write","title":"fs_write","status":"done","input":{"path":"/data/reports/chart-1.png"},"output":"wrote 240 KB"},{"key":"m12","kind":"tool","name":"exec","title":"npm run build","status":"done","input":{"command":"npm run build"},"output":{"isError":true,"content":[{"type":"text","text":"Module not found: @scope/missing"}]}}]"#

  static func toolGroups(_ rows: [TranscriptRow]) -> [ToolActivityGroup] {
    TranscriptDisplayRow.grouped(rows).compactMap {
      if case .tools(let group) = $0 { return group }
      return nil
    }
  }

  func testConsecutiveToolsGroupAndEveryOtherKindBreaksTheGroup() throws {
    let tools = try TranscriptRow.decode(Self.transcript(Self.chatToolsBlocks))
    let grouped = TranscriptDisplayRow.grouped(tools)
    XCTAssertEqual(grouped.count, 1)
    XCTAssertEqual(Self.toolGroups(tools).first?.rows, tools)
    XCTAssertEqual(grouped.first?.id, tools.first?.id)
    XCTAssertEqual(Self.toolGroups([tools[0]]).first?.rows, [tools[0]])
    XCTAssertTrue(TranscriptDisplayRow.grouped([]).isEmpty)
    for kind in BlockKind.allCases where kind != .tool {
      let separator = try XCTUnwrap(TranscriptRow.decode(Self.transcript(
        #"[{"key":"break","kind":"\#(kind.rawValue)","text":"Interlude"}]"#)).first)
      let result = TranscriptDisplayRow.grouped([tools[0], separator, tools[1], tools[2]])
      XCTAssertEqual(result.count, 3)
      XCTAssertEqual(result[1], .block(separator), "非工具渲染行必须原样保留")
      XCTAssertEqual(Self.toolGroups([tools[0], separator, tools[1], tools[2]]).map(\.rows.count), [1, 2])
    }
  }

  func testGroupsNeverCrossTurnMessageOrRoleBoundaries() throws {
    let blocks = #"[{"key":"t","kind":"tool","name":"exec"}]"#
    let first = try XCTUnwrap(TranscriptRow.decode(Self.transcript(blocks)).first)
    let otherTurn = try XCTUnwrap(TranscriptRow.decode(Self.transcript(blocks, turn: "other")).first)
    let otherMessage = try XCTUnwrap(TranscriptRow.decode(Self.transcript(blocks, message: "other")).first)
    let otherRole = TranscriptRow(id: .init(turn: first.id.turn, message: first.id.message,
      role: "system", block: "other", kind: .tool), block: first.block)
    for other in [otherTurn, otherMessage, otherRole] {
      XCTAssertEqual(TranscriptDisplayRow.grouped([first, other]).count, 2)
    }
  }

  func testToolActivityCategoryMappingAndFallback() {
    let cases: [(ToolActivityCategory, [String])] = [
      (.read, ["read", "fs_read", "list_files", "search", "ReadFile", "web_search"]),
      (.edit, ["write", "fs_write", "edit", "apply_patch", "patch", "apply"]),
      (.execute, ["exec", "execute", "bash", "shell", "run_command", "terminal"]),
      (.network, ["fetch", "web", "http_get", "HTTP"]),
      (.other, ["custom_action", "git_commit", "", "computer"]),
    ]
    for (category, names) in cases {
      for name in names { XCTAssertEqual(ToolActivityCategory.classify(name), category, name) }
    }
    XCTAssertEqual(ToolActivityCategory.classify(nil), .other)
    XCTAssertEqual(ToolActivityCategory.allCases.map(\.symbolName), [
      "doc.text.magnifyingglass", "square.and.pencil", "terminal", "globe", "wrench.and.screwdriver",
    ])
    XCTAssertEqual(ToolActivityCategory.allCases.map(\.titleKey), [
      "Read files", "Edited files", "Ran commands", "Fetched from the web", "Used tools",
    ])
  }

  func testMixedActivityWordingDeduplicatesAndCapsAtThreeInFirstSeenOrder() throws {
    let names = ["exec", "fs_read", "bash", "fs_write", "fetch", "custom"]
    let blocks = names.enumerated().map { index, name in
      #"{"key":"\#(index)","kind":"tool","name":"\#(name)"}"#
    }.joined(separator: ",")
    let rows = try TranscriptRow.decode(Self.transcript("[" + blocks + "]"))
    let group = try XCTUnwrap(Self.toolGroups(rows).first)
    XCTAssertEqual(group.categories, [.execute, .read, .edit, .network, .other])
    XCTAssertEqual(group.text, ["Ran commands", "Read files", "Edited files"]
      .map { MemohStrings.text($0) }.joined(separator: MemohStrings.text(", ")))
    XCTAssertEqual(group.symbolName, "wrench.and.screwdriver")
    XCTAssertEqual(group.text, Self.toolGroups(rows).first?.text)
    let singleCategory = try XCTUnwrap(Self.toolGroups([rows[0], rows[2]]).first)
    XCTAssertEqual(singleCategory.text, MemohStrings.text("Ran commands"))
    XCTAssertEqual(singleCategory.symbolName, "terminal")
    XCTAssertEqual(group.rows, rows, "三类上限只影响摘要，不能截掉原始工具")
  }

  func testActivitySpinnerReflectsAnyMemberWithoutChangingWording() throws {
    let blocks = #"[{"key":"a","kind":"tool","name":"exec","status":"done"},{"key":"b","kind":"tool","name":"exec","status":"running"}]"#
    let running = try XCTUnwrap(Self.toolGroups(TranscriptRow.decode(Self.transcript(blocks))).first)
    XCTAssertTrue(running.showsSpinner)
    for status in ["done", "failed", "unknown"] {
      let stopped = try XCTUnwrap(Self.toolGroups(TranscriptRow.decode(Self.transcript(
        blocks.replacingOccurrences(of: "running", with: status)))).first)
      XCTAssertFalse(stopped.showsSpinner)
      XCTAssertEqual(stopped.text, running.text)
      XCTAssertEqual(stopped.symbolName, running.symbolName)
      XCTAssertEqual(stopped.foreground, running.foreground)
      XCTAssertEqual(stopped.first.id, running.first.id)
      XCTAssertNotEqual(stopped, running, "非首个工具状态变更必须触发 diffable reconfigure")
    }
  }

  func testActivityErrorsRemainNeutralAndPreserveOriginalDetails() throws {
    let rows = try TranscriptRow.decode(Self.transcript(Self.chatToolsBlocks))
    let group = try XCTUnwrap(Self.toolGroups(rows).first)
    XCTAssertTrue(ToolResultDiagnosis.read(rows[2].block.output).isError)
    XCTAssertEqual(group.text, ["Ran commands", "Edited files"].map { MemohStrings.text($0) }
      .joined(separator: MemohStrings.text(", ")))
    XCTAssertEqual(group.foreground, .secondary)
    XCTAssertTrue(group.showsSpinner)
    XCTAssertEqual(group.accessibilityDescriptions.count, 3)
    for (description, name) in zip(group.accessibilityDescriptions, ["exec", "fs_write", "exec"]) {
      XCTAssertTrue(description.hasPrefix(name))
    }
    XCTAssertTrue(group.accessibilityDescriptions[2].contains("Module not found"))
    for output in [#"{"isError":false}"#, #"{"structuredContent":{"isError":true}}"#] {
      let updated = try TranscriptRow.decode(Self.transcript(
        #"[{"key":"m12","kind":"tool","name":"exec","status":"done","output":\#(output)}]"#))
      let changed = try XCTUnwrap(Self.toolGroups([rows[0], rows[1], updated[0]]).first)
      XCTAssertEqual(changed.text, group.text)
      XCTAssertEqual(changed.foreground, group.foreground)
      XCTAssertEqual(changed.symbolName, group.symbolName)
      XCTAssertNotEqual(changed, group, "仅 output 变更也必须保留并刷新")
    }
  }

  func testAppendingToolsRetainsIdentityAndOriginalInputUpdates() throws {
    let rows = try TranscriptRow.decode(Self.transcript(Self.chatToolsBlocks))
    let one = try XCTUnwrap(TranscriptDisplayRow.grouped([rows[0]]).first)
    let all = try XCTUnwrap(TranscriptDisplayRow.grouped(rows).first)
    XCTAssertEqual(one.id, all.id)
    XCTAssertNotEqual(one, all)
    let changedRows = try TranscriptRow.decode(Self.transcript(
      Self.chatToolsBlocks.replacingOccurrences(of: "npm run build", with: "npm test")))
    let changed = try XCTUnwrap(TranscriptDisplayRow.grouped(changedRows).first)
    XCTAssertEqual(changed.id, all.id)
    XCTAssertNotEqual(changed, all)
  }

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

  /**
   工具诊断：从 output 内部读，与上游 `tool-result-error.ts` 同一套判据。

   为什么必须从 output 读：协议里工具块**只有 `running: Bool`**，没有 is_error /
   status 字段（`internal/agent/view/uimessage.go:58`）。"这个工具出错了"在传输层
   不存在，只有输出内容里才有线索。
   */
  func testToolResultDiagnosisReadsUpstreamShape() throws {
    let block = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","name":"exec","status":"done","output":{"isError":true,"content":[{"type":"text","text":"Module not found"}]}}]"#)).first)
    let diagnosis = ToolResultDiagnosis.read(block.block.output)
    XCTAssertTrue(diagnosis.isError)
    XCTAssertEqual(diagnosis.text, "Module not found")

    // structuredContent 包一层也要能读到（上游也认这种）。
    let nested = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","output":{"structuredContent":{"isError":true,"content":[{"type":"text","text":"ENOENT"}]}}}]"#)).first)
    XCTAssertEqual(ToolResultDiagnosis.read(nested.block.output).text, "ENOENT")

    // 正常输出：不是错误，不该冒出诊断文字。
    let ok = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","output":{"content":[{"type":"text","text":"ok"}]}}]"#)).first)
    let okDiagnosis = ToolResultDiagnosis.read(ok.block.output)
    XCTAssertFalse(okDiagnosis.isError)

    // 没有 output（还在跑、或服务端没给）：什么都不猜。
    let none = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","running":true}]"#)).first)
    XCTAssertEqual(ToolResultDiagnosis.read(none.block.output), .none)
    XCTAssertEqual(ToolResultDiagnosis.read(nil), .none)

    // **非零退出码不算失败**——上游只用它显示退出码。这条最容易写反。
    let exitCode = try XCTUnwrap(TranscriptRow.decode(MessageListLogicTests.transcript(
      #"[{"key":"tool","kind":"tool","output":{"exit_code":1,"stdout":"compiling..."}}]"#)).first)
    XCTAssertFalse(ToolResultDiagnosis.read(exitCode.block.output).isError,
                   "exit_code != 0 不等于工具失败：agent 试错是正常干活过程")
  }

  /**
   状态词只在需要说明的时候出现。
   
   曾出现"卡片写 Done、下一行红字说 Module not found"，两轮视觉评审都判为矛盾。
   根因是我们给"完成"也贴了标签——而完成是常态，全部工具都会完成。
   */
  func testToolStatusLabelOnlyWhenItExplainsSomething() {
    XCTAssertTrue(MessageListMetrics.showsToolStatus(.running), "用户正等着，必须说明在跑")
    XCTAssertTrue(MessageListMetrics.showsToolStatus(.failed), "服务端明确说这条出错了")
    XCTAssertFalse(MessageListMetrics.showsToolStatus(.done), "完成是常态，对勾足够")
    XCTAssertFalse(MessageListMetrics.showsToolStatus(.unknown), "不知道就不多说一句")

    // 只有 running 才把执行位置带上（那时它依附于一个存在的状态词）。
    XCTAssertEqual(MessageListMetrics.toolStatusText(state: .running), "Running")
    XCTAssertEqual(MessageListMetrics.toolStatusText(state: .failed), "Failed")
    XCTAssertNil(MessageListMetrics.toolStatusText(state: .done), "完成态不贴状态词")
    XCTAssertNil(MessageListMetrics.toolStatusText(state: .unknown))

    // 图标同理：只有需要用户注意的两种状态才配一个图标。
    // 完成态没有图标——三份视觉评审都把"灰色对勾 + 红色报错"读成矛盾。
    XCTAssertTrue(MessageListMetrics.showsToolIcon(.failed), "服务端说这条出错了，要一个警告图标")
    // running **不给静态图标**：那个状态已经由 spinner 表达，再来一个图标就是
    // 两个东西说同一句话（视觉评审："spinner 旁边还挂了一个沙漏，语义重复"）。
    XCTAssertFalse(MessageListMetrics.showsToolIcon(.running),
                   "进行中由 spinner 表达，不要再叠一个静态图标")
    XCTAssertFalse(MessageListMetrics.showsToolIcon(.done), "对勾在断言「成功了」，而上游说不能这样推导")
    XCTAssertFalse(MessageListMetrics.showsToolIcon(.unknown))
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
      ("testConsecutiveToolsGroupAndEveryOtherKindBreaksTheGroup", MessageListLogicTests.testConsecutiveToolsGroupAndEveryOtherKindBreaksTheGroup),
      ("testGroupsNeverCrossTurnMessageOrRoleBoundaries", MessageListLogicTests.testGroupsNeverCrossTurnMessageOrRoleBoundaries),
      ("testToolActivityCategoryMappingAndFallback", MessageListLogicTests.testToolActivityCategoryMappingAndFallback),
      ("testMixedActivityWordingDeduplicatesAndCapsAtThreeInFirstSeenOrder", MessageListLogicTests.testMixedActivityWordingDeduplicatesAndCapsAtThreeInFirstSeenOrder),
      ("testActivitySpinnerReflectsAnyMemberWithoutChangingWording", MessageListLogicTests.testActivitySpinnerReflectsAnyMemberWithoutChangingWording),
      ("testActivityErrorsRemainNeutralAndPreserveOriginalDetails", MessageListLogicTests.testActivityErrorsRemainNeutralAndPreserveOriginalDetails),
      ("testAppendingToolsRetainsIdentityAndOriginalInputUpdates", MessageListLogicTests.testAppendingToolsRetainsIdentityAndOriginalInputUpdates),
      ("testToolStateMapping", MessageListLogicTests.testToolStateMapping),
      ("testHierarchySeparatesUserBubblesFromAgentActivity", MessageListLogicTests.testHierarchySeparatesUserBubblesFromAgentActivity),
      ("testToolTitleVisibility", MessageListLogicTests.testToolTitleVisibility),
      ("testToolStatusLabelOnlyWhenItExplainsSomething", MessageListLogicTests.testToolStatusLabelOnlyWhenItExplainsSomething),
      ("testToolResultDiagnosisReadsUpstreamShape", MessageListLogicTests.testToolResultDiagnosisReadsUpstreamShape),
      ("testToolInputShapesAndInputOnlyUpdates", MessageListLogicTests.testToolInputShapesAndInputOnlyUpdates),
      ("testReasoningStateSurvivesStreamingAndUsesFullIdentity", MessageListLogicTests.testReasoningStateSurvivesStreamingAndUsesFullIdentity),
      ("testAttachmentsCountTypesAndSizes", MessageListLogicTests.testAttachmentsCountTypesAndSizes),
      ("testErrorCodeAndNoticeRemainDistinct", MessageListLogicTests.testErrorCodeAndNoticeRemainDistinct),
      ("testLayoutPolicyAndScrollClamping", MessageListLogicTests.testLayoutPolicyAndScrollClamping),
    ])])
  }
}
#endif
