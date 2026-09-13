import XCTest
import UIKit
@testable import MemohKit

/// Run in an iOS hosted XCTest target linked to MemohKit/ExpoModulesCore.
/// These tests use the production view, no account, network, or test renderer.
@MainActor
final class MessageListTests: XCTestCase {
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
}
