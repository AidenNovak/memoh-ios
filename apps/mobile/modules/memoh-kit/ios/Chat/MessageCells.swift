import UIKit

// Each kind has its own reuse type. Future rich text/tool interaction stays out of the list.
class MessageBlockCell: UICollectionViewCell {
  let body = UILabel()
  let heading = UILabel()
  private let stack = UIStackView()
  private var leading: NSLayoutConstraint!
  private var width: NSLayoutConstraint!

  override init(frame: CGRect) {
    super.init(frame: frame)
    stack.axis = .vertical
    stack.spacing = 6
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = .init(top: 12, leading: 16, bottom: 12, trailing: 16)
    stack.layer.cornerRadius = 16
    stack.layer.cornerCurve = .continuous
    for label in [heading, body] {
      label.numberOfLines = 0
      label.adjustsFontForContentSizeCategory = true
      stack.addArrangedSubview(label)
    }
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(stack)
    leading = stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor)
    width = stack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.78)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor),
    ])
    isAccessibilityElement = true
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func configure(_ row: TranscriptRow) {
    let user = row.id.role == "user"
    leading.isActive = !user
    width.isActive = user
    stack.backgroundColor = user ? .secondarySystemBackground : .clear
    heading.font = .preferredFont(forTextStyle: .footnote)
    heading.textColor = .secondaryLabel
    body.font = .preferredFont(forTextStyle: .body)
    body.textColor = .label
    heading.text = nil
    body.text = row.block.text
    let block = row.block
    switch block.kind {
    case .text:
      break
    case .reasoning:
      heading.text = MemohStrings.text("Reasoning")
      body.font = .preferredFont(forTextStyle: .footnote)
      body.textColor = .secondaryLabel
    case .tool:
      stack.backgroundColor = .secondarySystemBackground
      let statuses = ["running": MemohStrings.text("Running"), "done": MemohStrings.text("Done"),
                      "failed": MemohStrings.text("Failed"), "unknown": MemohStrings.text("Unknown")]
      heading.text = [statuses[block.status ?? "unknown"] ?? statuses["unknown"], block.location]
        .compactMap { $0 }.joined(separator: " · ")
      body.text = [block.title?.isEmpty == false ? block.title : block.name, block.error]
        .compactMap { $0 }.joined(separator: "\n")
      body.font = .preferredFont(forTextStyle: .callout)
    case .error:
      heading.text = MemohStrings.text("Error")
      body.textColor = .systemRed
    case .notice:
      body.font = .preferredFont(forTextStyle: .footnote)
      body.textColor = .secondaryLabel
    case .attachments:
      heading.text = MemohStrings.text("Attachments")
      body.text = block.items?.map(\.name).joined(separator: "\n")
    }
    heading.isHidden = heading.text?.isEmpty != false
    let roles = ["user": MemohStrings.text("You"), "assistant": MemohStrings.text("Assistant"),
                 "system": MemohStrings.text("System")]
    accessibilityLabel = [roles[row.id.role], heading.text, body.text].compactMap { $0 }.joined(separator: ". ")
    accessibilityIdentifier = "message-block-\(row.id.block)"
  }
}

final class TextMessageCell: MessageBlockCell {}
final class ReasoningMessageCell: MessageBlockCell {}
final class ToolMessageCell: MessageBlockCell {}
final class ErrorMessageCell: MessageBlockCell {}
final class NoticeMessageCell: MessageBlockCell {}
final class AttachmentsMessageCell: MessageBlockCell {}
