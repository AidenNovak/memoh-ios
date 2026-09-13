import Foundation

// Mirrors src/models/chat.ts. Transport messages must never enter this boundary.
enum BlockKind: String, Decodable, CaseIterable, Sendable {
  case text, reasoning, tool, error, notice, attachments
}

struct TranscriptBlock: Decodable, Equatable, Sendable {
  let kind: BlockKind
  let key: String
  let text: String?
  let streaming: Bool?
  let durationMs: Double?
  let name: String?
  let title: String?
  let status: String?
  let error: String?
  let location: String?
  let code: String?
  let input: ToolInput?
  let items: [Attachment]?

  struct Attachment: Decodable, Equatable, Sendable {
    let key: String
    let name: String
    let mime: String?
    let url: String?
    let size: Double?
    let isImage: Bool

    var symbolName: String {
      if isImage || mime?.hasPrefix("image/") == true { return "photo" }
      if mime?.hasPrefix("audio/") == true { return "waveform" }
      if mime?.hasPrefix("video/") == true { return "film" }
      return "doc"
    }

    var formattedSize: String? {
      guard let size, size.isFinite, size >= 0, size < Double(Int64.max) else { return nil }
      return ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }
  }

  var toolState: ToolState { ToolState(rawValue: status ?? "") ?? .unknown }
}

enum ToolState: String, CaseIterable, Sendable {
  case running, done, failed, unknown

  var titleKey: String {
    switch self {
    case .running: return "Running"
    case .done: return "Done"
    case .failed: return "Failed"
    case .unknown: return "Unknown"
    }
  }

  var symbolName: String {
    switch self {
    case .running: return "hourglass"
    case .done: return "checkmark.circle.fill"
    case .failed: return "exclamationmark.triangle.fill"
    case .unknown: return "questionmark.circle"
    }
  }
}

// RenderBlock.input is unknown JSON, not necessarily a command dictionary.
// Keep it typed/Sendable so input-only streaming changes also reconfigure the cell.
indirect enum ToolInput: Codable, Equatable, Sendable {
  case object([String: ToolInput]), array([ToolInput]), string(String)
  case number(Double), bool(Bool), null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode([String: ToolInput].self) { self = .object(value) }
    else { self = .array(try container.decode([ToolInput].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .object(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }

  /// 给用户看的入参摘要。
  ///
  /// **不直接吐 JSON**：`{"command" : "pytest -q"}` 是给机器看的语法，花括号、引号、
  /// 冒号前的空格都在消耗注意力却零信息量。用户要的是"agent 到底执行了什么"。
  ///
  /// 规则：扁平对象渲染成 `key: value` 每行一条，顺序按 key 排序（同一份入参每次
  /// 渲染都一样，截图可比）；嵌套或数组退回紧凑 JSON——那种情况不多，也不该由半
  /// 吊子的人肉格式化去猜。
  var preview: String {
    let text: String
    if case .string(let value) = self {
      text = value
    } else if case .object(let fields) = self, !fields.isEmpty,
              fields.values.allSatisfy(\.isScalar) {
      // `!fields.isEmpty` 这个条件不能省：空对象的"所有值都是标量"是**真空成立**的，
      // 于是 `{}` 会被摊平成零行 → 预览变成空字符串 → 卡片上看起来像没有入参。
      // 测试逮住了这个（`testToolInputShapesAndInputOnlyUpdates`）。
      text = fields.keys.sorted().map { key in
        "\(key): \(fields[key]?.scalarText ?? "")"
      }.joined(separator: "\n")
    } else {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      guard let data = try? encoder.encode(self) else { return "" }
      text = String(decoding: data, as: UTF8.self)
    }
    let prefix = String(text.prefix(MessageListMetrics.inputCharacterLimit))
    return text.count > MessageListMetrics.inputCharacterLimit ? prefix + "…" : prefix
  }

  /// 标量（字符串/数字/布尔）——只有这种才值得摊平成 `key: value`。
  var isScalar: Bool {
    switch self {
    case .string, .number, .bool: return true
    case .object, .array, .null: return false
    }
  }

  var scalarText: String {
    switch self {
    case .string(let value): return value
    case .number(let value): return value.rounded() == value ? String(Int(value)) : String(value)
    case .bool(let value): return value ? "true" : "false"
    case .object, .array, .null: return ""
    }
  }
}

// Presentation state belongs to the list, never to a recycled cell or the transport.
struct ReasoningExpansionState {
  private var expanded = Set<TranscriptRow.ID>()

  func isExpanded(_ id: TranscriptRow.ID) -> Bool { expanded.contains(id) }

  mutating func toggle(_ id: TranscriptRow.ID) {
    guard id.kind == .reasoning else { return }
    if !expanded.insert(id).inserted { expanded.remove(id) }
  }

  mutating func retain(_ ids: [TranscriptRow.ID]) { expanded.formIntersection(ids) }
}

/**
 表面的语义名（不依赖 UIKit，才能在没有 UIKit 的环境里断言）。
 
 具体对应哪个颜色由 UI 层决定（见 `MessageCells`）：浅色与深色下需要不同的取值，
 那是 UI 的事；"这两者必须是不同的东西"是政策的事，政策放在这里。
 */
enum SurfaceToken: Equatable, Sendable {
  /** 用户说的话：实心。 */
  case secondary
  /** agent 的机器活动：容器。 */
  case tertiary
}

// Foundation-only policy shared by production layout and non-hosted XCTest.
enum MessageListMetrics {
  static let blockSpacing: Double = 16
  static let inputCharacterLimit = 600
  static let inputLineLimit = 5

  /**
   两种表面的分工，**必须不同**。

   - `userSurface`：用户说的一句话。实心，因为"你说的话"是实体。
   - `activitySurface`：agent 干活的过程（工具、思考）。容器，装着机器活动。

   为什么专门提出来：这两个曾经是同一种灰（都取 `.secondarySystemBackground`），
   实测在一张工具场景截图里那一种灰占了 49% 的像素——整屏一片同色，没有层级。
   把它们放到一个地方命名，是为了让"两者不同"成为一件能被断言的事，
   而不是散落在两个文件里、下次改动时又撞回一起。
   */
  static let userSurface = SurfaceToken.secondary
  static let activitySurface = SurfaceToken.tertiary

  /**
   标题是否只是把入参又说了一遍。

   上游的 `title` 经常就是整条命令，而 `input` 里又有 `command: 同一条命令`，
   于是卡片上同一句话出现两次。标题只在**补充**信息时才有价值。
   */
  static func toolTitleRepeatsInput(title: String?, inputPreview: String?) -> Bool {
    guard let title, !title.isEmpty, let inputPreview, !inputPreview.isEmpty else { return false }
    return inputPreview.range(of: title, options: .caseInsensitive) != nil
  }

  /**
   工具卡片的标题要不要显示。

   四件不同的事各自能让它消失，分开列出来是因为它们**原因不同**，将来要改的时候
   得知道是哪一条在起作用：

   - 没有标题（服务端没给）；
   - 标题就是工具名（那它没有新增信息，工具名已经在上面了）；
   - 没有入参可看时……**不影响**标题 —— 这时标题是唯一的信息来源，必须留着；
   - 标题的文字已经包含在入参里（同一条命令写两遍）。
   */
  static func showsToolTitle(title: String?, name: String?, inputPreview: String?) -> Bool {
    guard let title, !title.isEmpty else { return false }
    if title == name { return false }
    return !toolTitleRepeatsInput(title: title, inputPreview: inputPreview)
  }

  static func reasoningLineLimit(expanded: Bool) -> Int { expanded ? 0 : 3 }

  static func userWidthFraction(accessibilitySize: Bool) -> Double { accessibilitySize ? 0.94 : 0.78 }

  static func bottomOffset(contentHeight: Double, viewportHeight: Double,
                           topInset: Double, bottomInset: Double) -> Double {
    max(-topInset, contentHeight - viewportHeight + bottomInset)
  }

  static func anchoredOffset(itemTop: Double, distance: Double,
                             topInset: Double, bottomOffset: Double) -> Double {
    min(max(itemTop - distance, -topInset), bottomOffset)
  }

  static func isNearBottom(offset: Double, bottomOffset: Double) -> Bool {
    bottomOffset - offset <= 24
  }

  static func canRestoreAnchor(capturedRevision: Int, currentRevision: Int, isInteracting: Bool) -> Bool {
    !isInteracting && capturedRevision == currentRevision
  }
}

struct TranscriptMessage: Decodable, Sendable {
  let key: String
  let role: String
  let blocks: [TranscriptBlock]
}

struct TranscriptTurn: Decodable, Sendable {
  let key: String
  let position: Double
  let user: TranscriptMessage?
  let assistant: TranscriptMessage?
  let active: Bool
}

struct TranscriptRow: Equatable, Sendable {
  struct ID: Hashable, Sendable {
    let turn: String
    let message: String
    let role: String
    let block: String
    let kind: BlockKind
  }
  let id: ID
  let block: TranscriptBlock

  static func decode(_ json: String) throws -> [Self] {
    let turns = try JSONDecoder().decode([TranscriptTurn].self, from: Data(json.utf8))
    var rows: [Self] = []
    var seen = Set<ID>()
    // The incoming order is authoritative. Never sort by text, timestamps or content size.
    for turn in turns {
      for message in [turn.user, turn.assistant].compactMap({ $0 }) {
        for block in message.blocks {
          let id = ID(turn: turn.key, message: message.key, role: message.role,
                      block: block.key, kind: block.kind)
          guard seen.insert(id).inserted else {
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Duplicate block identity"))
          }
          rows.append(Self(id: id, block: block))
        }
      }
    }
    return rows
  }
}
