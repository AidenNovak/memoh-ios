import UIKit

// Shared bubble geometry and accessibility; each reuse type owns its presentation.
class MessageBlockCell: UICollectionViewCell {
  let body = UILabel()
  let heading = UILabel()
  let symbol = UIImageView()
  let stack = UIStackView()
  let header = UIStackView()
  var headingTextStyle: UIFont.TextStyle { .headline }
  private var leading: NSLayoutConstraint!
  private var userWidth: NSLayoutConstraint!
  private var user = false
  private var borderColor: UIColor = .clear

  override init(frame: CGRect) {
    super.init(frame: frame)
    stack.axis = .vertical
    stack.spacing = 10
    stack.isLayoutMarginsRelativeArrangement = true
    stack.layer.cornerRadius = 16
    stack.layer.cornerCurve = .continuous
    header.axis = .horizontal
    header.alignment = .top
    header.spacing = 8
    symbol.contentMode = .scaleAspectFit
    symbol.setContentHuggingPriority(.required, for: .horizontal)
    symbol.setContentCompressionResistancePriority(.required, for: .horizontal)
    symbol.isAccessibilityElement = false
    header.addArrangedSubview(symbol)
    header.addArrangedSubview(heading)
    style(heading, .headline)
    style(body, .body)
    stack.addArrangedSubview(header)
    stack.addArrangedSubview(body)
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(stack)
    leading = stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor),
    ])
    updateWidth()
    isAccessibilityElement = true
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self, UITraitUserInterfaceStyle.self,
                            UITraitAccessibilityContrast.self]) {
      (cell: MessageBlockCell, _: UITraitCollection) in
      cell.updateWidth()
      cell.stack.layer.borderColor = cell.borderColor.resolvedColor(with: cell.traitCollection).cgColor
      cell.symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: .preferredFont(forTextStyle: cell.headingTextStyle))
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  /**
   给 label 上字体与颜色。
   
   `color` 传 `nil` 表示"品牌正文色"——不能把 `MemohPalette.label(traitCollection)`
   写成默认参数，因为默认参数在编译期求值，拿不到当前 trait。
   */
  func style(_ label: UILabel, _ textStyle: UIFont.TextStyle, color: UIColor? = nil) {
    label.font = .preferredFont(forTextStyle: textStyle)
    label.adjustsFontForContentSizeCategory = true
    label.numberOfLines = 0
    label.textColor = color ?? MemohPalette.label(traitCollection)
  }

  private func updateWidth() {
    userWidth?.isActive = false
    let fraction = MessageListMetrics.userWidthFraction(
      accessibilitySize: traitCollection.preferredContentSizeCategory.isAccessibilityCategory)
    userWidth = stack.widthAnchor.constraint(equalTo: contentView.widthAnchor, multiplier: CGFloat(fraction))
    leading.isActive = !user
    userWidth.isActive = user
  }

  /**
   机器活动的容器样式。
   
   ⚠️ 这个表面必须与**用户气泡**不同色。曾经两者都是同一个系统灰，实测
   （`verification/ui/tools/measure_surfaces.py`）一张工具场景截图里那种灰占了
   49% 的像素——整屏是一片同色的板子，没有层级。
   
   现在两者的区分有两层，任一层单独成立：
   
   - **色相**：用户气泡是品牌紫派生的淡紫（`MemohPalette.userBubble`），
     这里的中性下沉面（`MemohPalette.activitySurface`）一点紫都不带；
   - **形态**：用户气泡是实心块，这里是带描边的容器。
   
   用中性下沉面而不是"描边白"，是因为 Memoh 的页面底本身是暖白 `#FAF8F7`，
   卡片白 `#FFFFFF` 与它的差别在手机上几乎看不出来，纯靠描边会显得单薄。
   */
  func card(border: UIColor? = nil) {
    stack.backgroundColor = MessageBlockCell.color(for: MessageListMetrics.activitySurface, traits: traitCollection)
    stack.directionalLayoutMargins = .init(top: 14, leading: 16, bottom: 14, trailing: 16)
    borderColor = border ?? MemohPalette.separator(traitCollection)
    stack.layer.borderWidth = 1
    stack.layer.borderColor = borderColor.resolvedColor(with: traitCollection).cgColor
  }

  /**
   语义表面 → 具体颜色。**唯一**的转换点，两边取值必须不同。
   
   政策在 `SurfaceToken`（Foundation-only，可单测），这里只负责把它落到 UIColor。
   */
  static func color(for surface: SurfaceToken, traits: UITraitCollection) -> UIColor {
    switch surface {
    case .secondary: return MemohPalette.userBubble(traits)
    case .tertiary: return MemohPalette.activitySurface(traits)
    }
  }

  func setHeading(_ text: String?, symbol name: String? = nil, color: UIColor? = nil) {
    let color = color ?? MemohPalette.label(traitCollection)
    heading.text = text
    heading.textColor = color
    header.isHidden = text?.isEmpty != false
    symbol.image = name.flatMap { UIImage(systemName: $0) }
    symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: .preferredFont(forTextStyle: headingTextStyle))
    symbol.tintColor = color
    symbol.isHidden = name == nil
  }

  func configure(_ row: TranscriptRow) {
    user = row.id.role == "user"
    updateWidth()
    stack.backgroundColor = user ? MessageBlockCell.color(for: MessageListMetrics.userSurface, traits: traitCollection) : .clear
    stack.directionalLayoutMargins = .init(top: 12, leading: 16, bottom: 12, trailing: 16)
    if !user { stack.directionalLayoutMargins = .init(top: 4, leading: 0, bottom: 4, trailing: 0) }
    borderColor = .clear
    stack.layer.borderWidth = 0
    style(body, .body)
    body.lineBreakMode = .byWordWrapping
    body.text = row.block.text
    body.isHidden = body.text?.isEmpty != false
    // 用户气泡上**不写 "You"**。
    //
    // 右对齐 + 一致的实心气泡已经说明"这是你说的"；再贴一个 headline 字号的
    // "You" 只会比你自己写的话还显眼——这是最典型的层级倒挂。iOS 上没有任何
    // 一款像样的聊天客户端这么做（Messages / ChatGPT / Claude 都没有）。
    // 屏幕阅读器仍然会念角色（见 updateAccessibility），信息没有丢，只是不该
    // 在视觉上占那么大位置。
    setHeading(nil)
    accessibilityTraits = .staticText
    accessibilityValue = nil
    accessibilityHint = nil
    accessibilityCustomActions = nil
    accessibilityIdentifier = "message-block-\(row.id.block)"
    updateAccessibility(row, content: [body.text])
  }

  func updateAccessibility(_ row: TranscriptRow, content: [String?]) {
    let roles = ["user": MemohStrings.text("You"), "assistant": MemohStrings.text("Assistant"),
                 "system": MemohStrings.text("System")]
    accessibilityLabel = ([roles[row.id.role]] + content).compactMap { $0 }
      .filter { !$0.isEmpty }.joined(separator: ". ")
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    body.text = nil
    body.numberOfLines = 0
    heading.text = nil
    symbol.image = nil
    accessibilityLabel = nil
    accessibilityValue = nil
    accessibilityHint = nil
    accessibilityIdentifier = nil
    accessibilityCustomActions = nil
  }
}

final class TextMessageCell: MessageBlockCell {}

final class ReasoningMessageCell: MessageBlockCell {
  let disclosure = UIButton(type: .system)
  var onToggle: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    var configuration = UIButton.Configuration.plain()
    configuration.contentInsets = .zero
    configuration.imagePadding = 8
    configuration.titleLineBreakMode = .byWordWrapping
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
      var result = attributes
      result.font = .preferredFont(forTextStyle: .subheadline)
      return result
    }
    disclosure.configuration = configuration
    disclosure.contentHorizontalAlignment = .leading
    disclosure.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
    disclosure.titleLabel?.adjustsFontForContentSizeCategory = true
    disclosure.titleLabel?.numberOfLines = 0
    disclosure.tintColor = .systemBlue
    let minimumHeight = disclosure.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
    // A hidden arranged subview gets a required zero-height constraint from UIStackView.
    minimumHeight.priority = UILayoutPriority(999)
    minimumHeight.isActive = true
    // The cell is one VoiceOver element; expose the same action as a custom action.
    disclosure.isAccessibilityElement = false
    disclosure.addTarget(self, action: #selector(toggle), for: .touchUpInside)
    stack.addArrangedSubview(disclosure)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func configure(_ row: TranscriptRow) { configure(row, expanded: false) }

  func configure(_ row: TranscriptRow, expanded: Bool) {
    super.configure(row)
    card()
    setHeading(MemohStrings.text("Reasoning"), symbol: "text.bubble", color: MemohPalette.secondaryLabel(traitCollection))
    style(body, .callout, color: MemohPalette.secondaryLabel(traitCollection))
    body.numberOfLines = MessageListMetrics.reasoningLineLimit(expanded: expanded)
    body.lineBreakMode = .byTruncatingTail
    let action = MemohStrings.text(expanded ? "Collapse reasoning" : "Expand reasoning")
    var configuration = disclosure.configuration
    configuration?.title = action
    configuration?.image = UIImage(systemName: expanded ? "chevron.up" : "chevron.down")
    disclosure.configuration = configuration
    disclosure.isHidden = body.isHidden
    if !body.isHidden {
      accessibilityValue = MemohStrings.text(expanded ? "Expanded" : "Collapsed")
      accessibilityHint = action
      accessibilityCustomActions = [UIAccessibilityCustomAction(name: action, target: self, selector: #selector(toggle))]
    }
    // VoiceOver can read all reasoning even when its visual preview is clipped.
    updateAccessibility(row, content: [heading.text, body.text])
  }

  @objc private func toggle() -> Bool {
    guard let onToggle else { return false }
    onToggle()
    return true
  }

  override func accessibilityActivate() -> Bool { toggle() }

  override func prepareForReuse() {
    super.prepareForReuse()
    onToggle = nil
    body.numberOfLines = MessageListMetrics.reasoningLineLimit(expanded: false)
    var configuration = disclosure.configuration
    configuration?.title = nil
    configuration?.image = nil
    disclosure.configuration = configuration
    disclosure.isHidden = true
  }
}

final class ToolMessageCell: MessageBlockCell {
  let spinner = UIActivityIndicatorView(style: .medium)
  let disclosure = UIButton(type: .system)
  var onToggle: (() -> Void)?
  let detailStack = UIStackView()
  override var headingTextStyle: UIFont.TextStyle { .footnote }

  override init(frame: CGRect) {
    super.init(frame: frame)
    header.alignment = .center
    style(heading, .footnote, color: MemohPalette.secondaryLabel(traitCollection))
    heading.lineBreakMode = .byWordWrapping
    // Reserve the trailing slot even when stopped: completion must not reflow the text.
    let spinnerSlot = UIView()
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinnerSlot.addSubview(spinner)
    NSLayoutConstraint.activate([
      spinnerSlot.widthAnchor.constraint(equalToConstant: 20),
      spinnerSlot.heightAnchor.constraint(equalToConstant: 20),
      spinner.centerXAnchor.constraint(equalTo: spinnerSlot.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: spinnerSlot.centerYAnchor),
    ])
    spinnerSlot.isAccessibilityElement = false
    spinner.hidesWhenStopped = true
    spinner.isAccessibilityElement = false
    header.addArrangedSubview(spinnerSlot)

    // 展开箭头（详情流）。与 ReasoningMessageCell 同一套模式：cell 是单个
    // VoiceOver 元素，动作通过 custom action 暴露，箭头本身不可聚焦。
    var configuration = UIButton.Configuration.plain()
    configuration.contentInsets = .zero
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(textStyle: .footnote)
    disclosure.configuration = configuration
    disclosure.tintColor = .systemBlue
    disclosure.isAccessibilityElement = false
    disclosure.addTarget(self, action: #selector(toggle), for: .touchUpInside)
    disclosure.setContentHuggingPriority(.required, for: .horizontal)
    header.addArrangedSubview(disclosure)

    // 展开后的详情容器：下沉面 + 圆角（对应上游 Capsule），但**不自己滚动**——
    // 过程体必须跟着主聊天滚动（memoh-desktop-parity.md §4.3）。
    detailStack.axis = .vertical
    detailStack.spacing = 10
    detailStack.isLayoutMarginsRelativeArrangement = true
    detailStack.directionalLayoutMargins = .init(top: 10, leading: 12, bottom: 10, trailing: 12)
    detailStack.layer.cornerRadius = 12
    detailStack.layer.cornerCurve = .continuous
    detailStack.isHidden = true
    stack.addArrangedSubview(detailStack)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  static func color(
    for foreground: ToolActivityGroup.Foreground, traits: UITraitCollection
  ) -> UIColor {
    switch foreground {
    // 工具活动行是**过程**，用次要文字色——它不是结论，不该和正文抢。
    case .secondary: return MemohPalette.secondaryLabel(traits)
    }
  }

  override func configure(_ row: TranscriptRow) { configure(ToolActivityGroup(row)) }

  func configure(_ group: ToolActivityGroup) { configure(group, expanded: false) }

  func configure(_ group: ToolActivityGroup, expanded: Bool) {
    super.configure(group.first)
    // This is an activity sentence, not a card. No status badge or error-colored detail.
    stack.backgroundColor = .clear
    stack.layer.borderWidth = 0
    stack.directionalLayoutMargins = .init(top: 4, leading: 0, bottom: 4, trailing: 0)
    body.isHidden = true
    let foreground = Self.color(for: group.foreground, traits: traitCollection)
    style(heading, .footnote, color: foreground)
    setHeading(group.text, symbol: group.symbolName, color: foreground)
    spinner.color = foreground
    if group.showsSpinner {
      spinner.startAnimating()
    } else {
      spinner.stopAnimating()
    }

    if group.expandable {
      renderDetail(group)
      detailStack.isHidden = !expanded
      var configuration = disclosure.configuration
      configuration?.image = UIImage(systemName: expanded ? "chevron.up" : "chevron.down")
      disclosure.configuration = configuration
      disclosure.isHidden = false
      let action = MemohStrings.text(expanded ? "Collapse details" : "Expand details")
      accessibilityValue = MemohStrings.text(expanded ? "Expanded" : "Collapsed")
      accessibilityHint = action
      accessibilityCustomActions = [UIAccessibilityCustomAction(name: action, target: self, selector: #selector(toggle))]
    } else {
      detailStack.isHidden = true
      disclosure.isHidden = true
      accessibilityValue = group.showsSpinner ? MemohStrings.text("Running") : nil
      accessibilityHint = nil
      accessibilityCustomActions = nil
    }
    // The first block's identifier stays stable; every member's name (including
    // repeated names) remains available to VoiceOver.
    updateAccessibility(group.first, content: [group.text] + group.accessibilityDescriptions.map { Optional($0) })
  }

  /** 重建展开内容：每个成员一个块（名字 · 位置 · 耗时 / 输入条目 / 诊断）。 */
  private func renderDetail(_ group: ToolActivityGroup) {
    detailStack.backgroundColor = MessageBlockCell.color(for: MessageListMetrics.activitySurface, traits: traitCollection)
    for view in detailStack.arrangedSubviews { view.removeFromSuperview() }
    for row in group.rows {
      detailStack.addArrangedSubview(memberDetail(row))
    }
  }

  private func memberDetail(_ row: TranscriptRow) -> UIStackView {
    let block = row.block
    let container = UIStackView()
    container.axis = .vertical
    container.spacing = 4
    container.alignment = .fill

    // 成员头：名字 · 执行位置 · 耗时（服务端给了才显示，不伪造）。
    var meta = [block.name?.isEmpty == false ? block.name! : MemohStrings.text("Tool")]
    if let location = block.location, !location.isEmpty { meta.append(location) }
    if let durationMs = block.durationMs, durationMs > 0 { meta.append(Self.formatDuration(durationMs)) }
    let metaLabel = UILabel()
    style(metaLabel, .footnote, color: MemohPalette.secondaryLabel(traitCollection))
    metaLabel.text = meta.joined(separator: " · ")
    container.addArrangedSubview(metaLabel)

    // 输入条目：key 次要色 / value 正文色（R2 评审第 3 项，对应上游 generic detail）。
    for entry in block.input?.entries ?? [] {
      container.addArrangedSubview(inputRow(key: entry.key, value: entry.value))
    }

    // 诊断：失败用危险红（标题保持中性——失败不是任务失败，见 ToolResultDiagnosis）。
    let diagnosis = ToolResultDiagnosis.read(block.output)
    if let text = diagnosis.text, !text.isEmpty {
      let color = diagnosis.isError
        ? MemohPalette.destructive(traitCollection)
        : MemohPalette.label(traitCollection)
      container.addArrangedSubview(monoLabel(text, color: color))
    } else if let error = block.error, !error.isEmpty {
      container.addArrangedSubview(monoLabel(error, color: MemohPalette.destructive(traitCollection)))
    }
    return container
  }

  private func inputRow(key: String, value: String) -> UIStackView {
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = 8
    row.alignment = .firstBaseline
    let keyLabel = monoLabel(key, color: MemohPalette.secondaryLabel(traitCollection))
    keyLabel.setContentHuggingPriority(.required, for: .horizontal)
    keyLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
    let valueLabel = monoLabel(value, color: MemohPalette.label(traitCollection))
    valueLabel.lineBreakMode = .byCharWrapping
    valueLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    row.addArrangedSubview(keyLabel)
    row.addArrangedSubview(valueLabel)
    return row
  }

  private func monoLabel(_ text: String, color: UIColor) -> UILabel {
    let label = UILabel()
    label.font = UIFontMetrics(forTextStyle: .footnote)
      .scaledFont(for: .monospacedSystemFont(ofSize: 13, weight: .regular))
    label.adjustsFontForContentSizeCategory = true
    label.numberOfLines = 0
    label.textColor = color
    label.text = text
    label.isAccessibilityElement = false
    return label
  }

  static func formatDuration(_ ms: Double) -> String {
    if ms >= 1000 { return String(format: "%.1fs", ms / 1000) }
    return "\(Int(ms))ms"
  }

  @objc private func toggle() -> Bool {
    guard let onToggle else { return false }
    onToggle()
    return true
  }

  override func accessibilityActivate() -> Bool { toggle() }

  override func prepareForReuse() {
    super.prepareForReuse()
    spinner.stopAnimating()
    onToggle = nil
    disclosure.configuration?.image = nil
    disclosure.isHidden = true
    detailStack.isHidden = true
    for view in detailStack.arrangedSubviews { view.removeFromSuperview() }
    accessibilityHint = nil
    accessibilityCustomActions = nil
  }
}

final class ErrorMessageCell: MessageBlockCell {
  private let code = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    style(code, .subheadline, color: MemohPalette.secondaryLabel(traitCollection))
    stack.addArrangedSubview(code)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    card(border: MemohPalette.destructive(traitCollection))
    setHeading(MemohStrings.text("Error"), symbol: "exclamationmark.octagon.fill",
               color: MemohPalette.destructive(traitCollection))
    code.text = row.block.code.flatMap { $0.isEmpty ? nil : MemohStrings.text("Error code") + ": " + $0 }
    code.isHidden = code.text == nil
    updateAccessibility(row, content: [heading.text, body.text, code.text])
  }
}

final class NoticeMessageCell: MessageBlockCell {
  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    setHeading(MemohStrings.text("Notice"), symbol: "info.circle", color: MemohPalette.secondaryLabel(traitCollection))
    style(body, .callout, color: MemohPalette.secondaryLabel(traitCollection))
    updateAccessibility(row, content: [heading.text, body.text])
  }
}

final class AttachmentsMessageCell: MessageBlockCell {
  private let files = UIStackView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    files.axis = .vertical
    files.spacing = 12
    stack.addArrangedSubview(files)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  private func clearFiles() {
    for view in files.arrangedSubviews {
      files.removeArrangedSubview(view)
      view.removeFromSuperview()
    }
  }

  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    clearFiles()
    card()
    let items = row.block.items ?? []
    setHeading(MemohStrings.text("Attachments") + " (\(items.count))", symbol: "paperclip")
    body.isHidden = true
    var descriptions: [String?] = [heading.text]
    for item in items {
      let line = UIStackView()
      line.axis = .horizontal
      line.alignment = .top
      line.spacing = 12
      let icon = UIImageView(image: UIImage(systemName: item.symbolName))
      icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: .preferredFont(forTextStyle: .title3))
      icon.tintColor = MemohPalette.secondaryLabel(traitCollection)
      icon.contentMode = .scaleAspectFit
      icon.setContentHuggingPriority(.required, for: .horizontal)
      icon.setContentCompressionResistancePriority(.required, for: .horizontal)
      let details = UIStackView()
      details.axis = .vertical
      details.spacing = 4
      let name = UILabel()
      style(name, .body)
      name.text = item.name.isEmpty ? MemohStrings.text("Untitled attachment") : item.name
      let size = UILabel()
      style(size, .subheadline, color: MemohPalette.secondaryLabel(traitCollection))
      size.text = item.formattedSize ?? MemohStrings.text("Size unknown")
      details.addArrangedSubview(name)
      details.addArrangedSubview(size)
      line.addArrangedSubview(icon)
      line.addArrangedSubview(details)
      files.addArrangedSubview(line)
      descriptions.append([name.text, size.text].compactMap { $0 }.joined(separator: ", "))
    }
    files.isHidden = items.isEmpty
    updateAccessibility(row, content: descriptions)
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    clearFiles()
  }
}
