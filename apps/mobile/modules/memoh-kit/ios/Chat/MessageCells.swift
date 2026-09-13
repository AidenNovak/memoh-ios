import UIKit

// Shared bubble geometry and accessibility; each reuse type owns its presentation.
class MessageBlockCell: UICollectionViewCell {
  let body = UILabel()
  let heading = UILabel()
  let symbol = UIImageView()
  let stack = UIStackView()
  let header = UIStackView()
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
      cell.symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: .preferredFont(forTextStyle: .headline))
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func style(_ label: UILabel, _ textStyle: UIFont.TextStyle, color: UIColor = .label) {
    label.font = .preferredFont(forTextStyle: textStyle)
    label.adjustsFontForContentSizeCategory = true
    label.numberOfLines = 0
    label.textColor = color
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
   
   ⚠️ **刻意不用 `.secondarySystemBackground`**：那个灰正好等于用户气泡的灰，
   于是"我说的话"和"agent 干的事"长得一模一样。实测
   （`verification/ui/tools/measure_surfaces.py`）在一张工具场景截图里，同一种灰
   占了 49% 的像素——整屏是一片同色的板子，没有层级。
   
   改用 `.tertiarySystemBackground`，它在两套外观下各给一个合适的形态：
   
   - **浅色**：等于页面白，于是这张卡片只剩一圈描边 —— "描边容器"；
   - **深色**：比页面亮一档，是一块浮起的面 —— "浮起容器"。
   
   两种外观下它都和用户气泡（`.secondarySystemBackground`）**不同**，于是层级变成：
   实心 = 你说的话，描边/浮起 = agent 干的事。区分靠形态，不靠第三个灰阶——
   浅色模式里根本没有第三个能和页面分开的灰。
   */
  func card(border: UIColor = .separator) {
    stack.backgroundColor = MessageBlockCell.color(for: MessageListMetrics.activitySurface)
    stack.directionalLayoutMargins = .init(top: 14, leading: 16, bottom: 14, trailing: 16)
    borderColor = border
    stack.layer.borderWidth = 1
    stack.layer.borderColor = border.resolvedColor(with: traitCollection).cgColor
  }

  /**
   语义表面 → 具体颜色。**唯一**的转换点，两边取值必须不同。
   
   `.tertiarySystemBackground` 在浅色下等于页面白（于是卡片只剩一圈描边）、
   在深色下比页面亮一档（一块浮起的面）；两套外观下都和用户气泡的
   `.secondarySystemBackground` 不同，所以"谁在说话"始终分得开。
   */
  static func color(for surface: SurfaceToken) -> UIColor {
    switch surface {
    case .secondary: return .secondarySystemBackground
    case .tertiary: return .tertiarySystemBackground
    }
  }

  func setHeading(_ text: String?, symbol name: String? = nil, color: UIColor = .label) {
    heading.text = text
    heading.textColor = color
    header.isHidden = text?.isEmpty != false
    symbol.image = name.flatMap { UIImage(systemName: $0) }
    symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(font: .preferredFont(forTextStyle: .headline))
    symbol.tintColor = color
    symbol.isHidden = name == nil
  }

  func configure(_ row: TranscriptRow) {
    user = row.id.role == "user"
    updateWidth()
    stack.backgroundColor = user ? MessageBlockCell.color(for: MessageListMetrics.userSurface) : .clear
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
    setHeading(MemohStrings.text("Reasoning"), symbol: "text.bubble", color: .secondaryLabel)
    style(body, .callout, color: .secondaryLabel)
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
  private let toolTitle = UILabel()
  /** 状态与执行位置，跟在工具名后面 —— 它们是这个工具名的修饰，不是并列的信息。 */
  let stateLabel = UILabel()
  private let input = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    style(toolTitle, .callout)
    style(stateLabel, .subheadline, color: .secondaryLabel)
    style(input, .callout)
    // 状态和工具名同一行。
    //
    // 之前"Running"与工具名各占一行、还都是 headline 字号，于是**状态和它修饰的
    // 东西一样重**——扫一眼分不清哪个是主体。改成同一行：工具名是主体（headline），
    // 状态是它的修饰（subheadline + 次要色）。
    header.addArrangedSubview(stateLabel)
    stack.insertArrangedSubview(toolTitle, at: 1)
    stack.insertArrangedSubview(input, at: 2)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    card()
    let block = row.block
    let state = block.toolState
    // 工具出错**不着色**。
    //
    // 上游 Web 客户端把这条写成了明确规则（`tool-call-inline.vue`）：
    // 「工具标题是执行过程摘要。Agent 在虚拟机中试错、检查并修复命令是正常的
    // 长任务行为；非零退出码（包括 -1）或工具 isError 不等于用户任务失败。
    // 标题保持中性色，不附加退出码或错误染色；诊断留在展开详情中，真正的任务
    // 失败由回合级错误反馈表达，不能从某一次工具调用推导。」
    //
    // 也就是说：一次工具失败 ≠ 这一步失败 ≠ 任务失败。把工具行染红会让正常的
    // 试错过程看起来像事故，而真正该被注意的回合级错误反而被淹掉。诊断信息在
    // 下面照样能看到（output 里的内容），只是不用颜色替用户下结论。
    // 状态**文字**本身必须留着（"Running"/"Done"）：图标只做辅助，色盲用户与
    // 强光下都得能读出来。
    setHeading(block.name?.isEmpty == false ? block.name : MemohStrings.text("Tool"),
               symbol: state.symbolName, color: .label)
    // 状态与位置合成一行：`Running · workspace`。位置单独占一行时是个悬空的词，
    // 读者不知道它属于谁。
    stateLabel.text = [MemohStrings.text(state.titleKey), block.location]
      .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    stateLabel.isHidden = stateLabel.text?.isEmpty != false
    // 先算入参（它的可见性决定标题要不要让位），再算标题。
    input.text = block.input?.preview
    input.isHidden = input.text?.isEmpty != false
    input.numberOfLines = MessageListMetrics.inputLineLimit
    input.lineBreakMode = .byTruncatingTail
    let font = UIFont.preferredFont(forTextStyle: .callout)
    input.font = UIFont(descriptor: font.fontDescriptor.withDesign(.monospaced) ?? font.fontDescriptor, size: 0)

    // The upstream title is often the entire command. Don't let it bypass input limits.
    let title = block.title.map { ToolInput.string($0).preview }
    toolTitle.text = title
    toolTitle.numberOfLines = 2
    toolTitle.lineBreakMode = .byTruncatingTail
    // 判定逻辑在 `MessageListMetrics`（Foundation-only，可单测）。
    // 实测它值得单独立规则：`chat-tools` 场景里三张卡有两张把同一条命令写了两遍。
    toolTitle.isHidden = !MessageListMetrics.showsToolTitle(
      title: title, name: block.name, inputPreview: input.text)
    body.text = block.error
    body.isHidden = body.text?.isEmpty != false
    body.textColor = .label
    updateAccessibility(row, content: [heading.text, stateLabel.text,
                                       toolTitle.isHidden ? nil : toolTitle.text,
                                       input.text, body.text])
  }
}

final class ErrorMessageCell: MessageBlockCell {
  private let code = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    style(code, .subheadline, color: .secondaryLabel)
    stack.addArrangedSubview(code)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    card(border: .systemRed)
    setHeading(MemohStrings.text("Error"), symbol: "exclamationmark.octagon.fill", color: .systemRed)
    code.text = row.block.code.flatMap { $0.isEmpty ? nil : MemohStrings.text("Error code") + ": " + $0 }
    code.isHidden = code.text == nil
    updateAccessibility(row, content: [heading.text, body.text, code.text])
  }
}

final class NoticeMessageCell: MessageBlockCell {
  override func configure(_ row: TranscriptRow) {
    super.configure(row)
    setHeading(MemohStrings.text("Notice"), symbol: "info.circle", color: .secondaryLabel)
    style(body, .callout, color: .secondaryLabel)
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
      icon.tintColor = .secondaryLabel
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
      style(size, .subheadline, color: .secondaryLabel)
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
