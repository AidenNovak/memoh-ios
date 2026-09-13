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
  let items: [Attachment]?

  struct Attachment: Decodable, Equatable, Sendable {
    let key: String
    let name: String
    let mime: String?
    let url: String?
    let size: Double?
    let isImage: Bool
  }
  // Tool input/output are deliberately not rendered in this first, summary-only card.
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
