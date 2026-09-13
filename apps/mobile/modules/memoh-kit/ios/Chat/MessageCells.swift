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
  let spinner = UIActivityIndicatorView(style: .medium)
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
    // 执行中要有**活的**指示，不能只靠一个静止的图标。
    //
    // UIActivityIndicatorView 是 iOS 的标准答案：用户看到转圈就知道"它在动、没卡
    // 住"，而一个静止的沙漏在等待超过几秒后会被读成"卡死了"。上游 Web 端也是给
    // running 加动画的（shimmer，延迟 250ms 起，理由见 verified-behaviour 第 16 条），
    // 只是他们用 shimmer、我们用系统 spinner——spinner 是 iOS 上用户认得的那个东西，
    // 而且它只旋转、不改布局，不会在流式追加时造成抖动。
    spinner.hidesWhenStopped = true
    spinner.setContentHuggingPriority(.required, for: .horizontal)
    spinner.setContentCompressionResistancePriority(.required, for: .horizontal)
    spinner.isAccessibilityElement = false
    header.insertArrangedSubview(spinner, at: 0)
    stack.insertArrangedSubview(toolTitle, at: 1)
    stack.insertArrangedSubview(input, at: 2)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func prepareForReuse() {
    super.prepareForReuse()
    // 复用走掉的 cell 必须停掉动画：一个不可见的 spinner 还在转是白耗电，
    // 而 iOS 不会因为你把它藏在屏幕外就自动停。
    spinner.stopAnimating()
    stateLabel.text = nil
    toolTitle.text = nil
    input.text = nil
  }

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
    //
    // 标题 = 工具名 +（有的话）执行位置，和上游一样把位置**挂在这一行上**：
    // `exec · workspace`。位置单独占一行时是个悬空的词，读者不知道它属于谁；
    // 而它本来就是"这个工具在哪儿跑"的修饰，属于工具名这一行。
    //
    // 变量名刻意不叫 `heading`——基类上有个 UILabel 属性就叫这个名字，重名会遮蔽它，
    // 于是后面的 `heading.text` 变成对 String 取 .text（踩过，见 Tools/typecheck-kit.sh）。
    var titleLine = block.name?.isEmpty == false ? block.name! : MemohStrings.text("Tool")
    if let location = block.location, !location.isEmpty {
      titleLine += " · " + location
    }
    // **完成态不给图标，也不给状态词。**
    //
    // 查了上游的 `tool-call-inline.vue`：它那一行里**根本没有状态图标**，
    // 只有 [动作描述] [目标] · [执行位置] 加一个展开箭头；未完成时靠 shimmer 表示。
    //
    // 我原来给完成的工具贴了一个对勾，那是我自己加的，而且它在断言一件事：
    // "这次调用成功了"。可上游的明文规则是**不能从一次工具调用推导成败**
    // （第 15 条）——那条规则对成功同样成立。三份视觉评审都把"灰色对勾 + 红色
    // 报错"读成自相矛盾，那说明读者没问题，是图标多说了话。
    //
    // 现在图标只表达**需要用户注意**的两件事：正在跑（转圈）、服务端说这条出错了
    // （警告）。跑完了就是跑完了，不需要一枚奖章。
    setHeading(titleLine, symbol: nil, color: .label)
    let isRunning = state == .running
    // 注意顺序：`setHeading` 会把图标清掉（它默认 symbol: nil），所以图标要在它之后设。
    //
    // 正在跑时**只给 spinner，不给静态图标**——两个都表示"进行中"，并排显示是重复，
    // 视觉评审一眼就看出来了（"spinner 旁边还挂了一个沙漏，语义重复"）。
    let hasIcon = MessageListMetrics.showsToolIcon(state) && !isRunning
    symbol.isHidden = !hasIcon
    if hasIcon {
      symbol.image = UIImage(systemName: state.symbolName)
      symbol.preferredSymbolConfiguration = UIImage.SymbolConfiguration(
        font: .preferredFont(forTextStyle: .headline))
      symbol.tintColor = .secondaryLabel
    }
    // 跑着的工具用 spinner（活的），其余停掉。
    if isRunning {
      spinner.startAnimating()
    } else {
      spinner.stopAnimating()
    }
    // 状态词**只在需要说明的时候出现**：运行中、失败。
    //
    // ## 为什么不给"完成"也加个 Done
    //
    // 上游 `tool-call-inline.vue` 的 `showPendingLabel` 就是 `title.pending`——
    // 即它**只在未完成时显示状态词**，完成之后不贴任何标签：
    //
    // > Specialized panels describe successful results or attempted inputs. Failed
    // > results use the shared diagnostic detail, without changing the neutral title.
    //
    // 这不只是省事。全部工具都会完成，给每一个都贴一个 "Done"，等于在一屏里重复
    // 十几次同一句话——那是噪声，不是信息。真正需要说明的只有两种情况：
    // 还在跑（用户要等着）、出错了（用户要留意）。
    //
    // 而且它顺手消掉了一个矛盾：曾出现"卡片写着 Done、下面一行红字说 Module not
    // found"，两轮视觉评审都判定为"状态与内容打架"。原因是"完成"和"输出里有错误"
    // 本来就是两件事，硬给它一个 Done 就等于替用户下了结论。现在不下了——
    // 图标（对勾）表示跑完了，红字表示内容里有错误，各说各的事实。
    let statusText = MessageListMetrics.toolStatusText(state: state)
    stateLabel.text = statusText
    stateLabel.isHidden = statusText == nil
    // 跑着的工具要**看得出来在跑**。
    //
    // 视觉评审的原话：「三张卡扫一眼，两个实心黑对勾（已完成）最抓眼，唯一在跑的
    // exec 卡反而最不显眼」——权重反了。用户正等着的那个恰恰最该被看见。
    //
    // 只给**进行中**用强调色，失败不用（见下面的规则）。这不矛盾：强调"正在发生"
    // 是时间信息，而给失败染色是替用户下"任务失败"的结论——前者该醒目，后者不该。
    let accent: UIColor = isRunning ? .tintColor : .secondaryLabel
    stateLabel.textColor = accent
    symbol.tintColor = .secondaryLabel
    spinner.color = accent

    // 先算入参（它的可见性决定标题要不要让位），再算标题。
    input.text = block.input?.preview
    input.isHidden = input.text?.isEmpty != false
    input.numberOfLines = MessageListMetrics.inputLineLimit
    input.lineBreakMode = .byTruncatingTail
    let font = UIFont.preferredFont(forTextStyle: .callout)
    let mono = UIFont(descriptor: font.fontDescriptor.withDesign(.monospaced) ?? font.fontDescriptor, size: 0)
    input.font = mono

    // The upstream title is often the entire command. Don't let it bypass input limits.
    let title = block.title.map { ToolInput.string($0).preview }
    toolTitle.text = title
    toolTitle.numberOfLines = 2
    toolTitle.lineBreakMode = .byTruncatingTail
    // 判定逻辑在 `MessageListMetrics`（Foundation-only，可单测）。
    // 实测它值得单独立规则：`chat-tools` 场景里三张卡有两张把同一条命令写了两遍。
    toolTitle.isHidden = !MessageListMetrics.showsToolTitle(
      title: title, name: block.name, inputPreview: input.text)
    // 工具结果的诊断。
    //
    // 之前这里只显示 `block.error`，而协议里工具块**没有** error 字段——所以这一行
    // 从来都是空的，"构建失败"的工具看起来和成功的一模一样。视觉评审直接指出了
    // 这个矛盾：「第三张卡写着 Done，下面的回复却说构建失败了」。
    //
    // 诊断要从 output 内部读（`isError` / `content[].text`），与上游一致。
    // 读到了就显示，**但不给标题染色**——理由见上面那段规则。
    let diagnosis = ToolResultDiagnosis.read(block.output)
    let hasDiagnosis = diagnosis.text?.isEmpty == false
    if hasDiagnosis, let text = diagnosis.text {
      body.text = text
      body.isHidden = false
    } else {
      body.text = block.error
      body.isHidden = body.text?.isEmpty != false
    }
    // 诊断文字与入参同为"机器输出"，用同一套等宽字体。
    // 之前诊断用正文字体、入参用等宽，同一种东西两种字体——两轮视觉评审都提了。
    body.font = mono
    body.numberOfLines = MessageListMetrics.inputLineLimit
    body.lineBreakMode = .byTruncatingTail
    // 诊断是**次要**信息（过程里的波折），用次要色，不与正文抢。真正的任务失败
    // 由回合级错误块表达，那个才是醒目的。
    //
    // 但**错误内容本身要红**。这不是我猜的，是上游的做法：
    // `tool-call-detail-generic.vue` 里 `errorText` 用 `text-destructive` 渲染，
    // 而正常输出用 `text-foreground`。
    //
    // 于是出现一个看起来矛盾、其实不矛盾的情形：**卡片标题说 Done，输出是红的**。
    // 两轮视觉评审都提出"状态与内容打架"。这里明确一次，免得下轮再改回去：
    //
    //   · 标题（Done/Running）= "这次工具调用**结束了**"，这是事实，也确实是
    //     工具调用的终态——它跑完了。
    //   · 红色正文 = "它吐出来的内容里有错误"，这也是事实。
    //   · **"任务失败了"** 是另一件事，只能由 run 的终态（`errored`）表达，
    //     不能从一次工具调用推导（第 15 条，上游明文规则）。
    //
    // 把标题改成 Failed 才是错的：agent 跑一个非零退出的命令、看一眼报错再修，
    // 是它正常干活的方式。把它标成失败，用户会以为任务挂了。
    body.textColor = diagnosis.isError ? .systemRed : .secondaryLabel
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
