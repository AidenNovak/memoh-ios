/**
 * 渲染用的领域模型。
 *
 * 服务端给的是"传输形状"（扁平 `UIMessage` / `UITurn`，见 `api/types.ts`），
 * 这里把它整理成 UI 好用的"渲染形状"。两份分开的原因：协议形状随上游变，
 * 渲染形状只随设计变，混在一起就没法独立演进。
 */

/** 一条内容块最终呈现成什么。 */
export type RenderBlock =
  | { kind: 'text'; key: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; key: string; text: string; streaming: boolean; durationMs?: number }
  | {
      kind: 'tool';
      key: string;
      name: string;
      title: string;
      status: ToolStatus;
      input?: unknown;
      output?: unknown;
      error?: string;
      /** 执行位置（本地容器 / 远端机器）。手机上看这个能判断"它在哪跑"。 */
      location?: string;
    }
  | { kind: 'error'; key: string; text: string; code?: string }
  | { kind: 'notice'; key: string; text: string; code?: string }
  | { kind: 'attachments'; key: string; items: AttachmentRef[] };

export type ToolStatus = 'running' | 'done' | 'failed' | 'unknown';

export interface AttachmentRef {
  key: string;
  name: string;
  mime?: string;
  url?: string;
  size?: number;
  /** 图片之类可以直接渲染的。 */
  isImage: boolean;
}

export interface RenderMessage {
  /** 稳定 key：`m<id>`。 */
  key: string;
  role: 'user' | 'assistant' | 'system';
  blocks: RenderBlock[];
  turnKey?: string;
  createdAt?: string;
}

export interface RenderTurn {
  key: string;
  position: number;
  user?: RenderMessage;
  assistant?: RenderMessage;
  /** 本轮是否正在流式输出。 */
  active: boolean;
}

/** 审批请求在 UI 里的形态。 */
export interface PendingApproval {
  approvalId: string;
  shortId?: number;
  runId: string;
  sessionId: string;
  toolName: string;
  toolInput?: unknown;
  options: ApprovalChoice[];
  canApprove: boolean;
}

/**
 * agent 自己定义的选项。**不能只做 approve/reject 两个写死的按钮**——没有它们，
 * 用户永远选不到 agent 的 session / always 作用域。
 */
export interface ApprovalChoice {
  id: string;
  /** agent 给的显示名；没有时 UI 用 tone 走本地化兜底文案。 */
  label?: string;
  tone: 'allow' | 'reject' | 'neutral';
}

/** agent 主动提问，走和审批同一套机制。 */
export interface PendingQuestion {
  questionId: string;
  text: string;
  kind: string;
  options: { id: string; label: string; description?: string }[];
  allowCustom: boolean;
  required: boolean;
  placeholder?: string;
}

export interface PendingUserInput {
  userInputId: string;
  shortId?: number;
  runId: string;
  sessionId: string;
  questions: PendingQuestion[];
}

export function toolStatusFrom(message: {
  running?: boolean;
  output?: unknown;
  type?: string;
}): ToolStatus {
  if (message.running === true) return 'running';
  if (message.type === 'error') return 'failed';
  if (message.running === false) {
    // 跑完了但 output 里可能是错误文本，交给上层判断。
    return 'done';
  }
  return 'unknown';
}

/**
 * agent 给的 option id 五花八门（`allow_once` / `reject_always` …），但语气是可
 * 判定的。判不准就当 neutral，由 UI 用默认样式呈现。
 */
export function approvalTone(optionId: string, kind?: string): ApprovalChoice['tone'] {
  const probe = `${optionId} ${kind ?? ''}`.toLowerCase();
  if (probe.includes('reject') || probe.includes('deny')) return 'reject';
  if (probe.includes('allow') || probe.includes('approve')) return 'allow';
  return 'neutral';
}

/** 没有 label 时的本地化兜底文案 key。 */
export function fallbackOptionKey(optionId: string, kind?: string): string {
  const probe = `${optionId} ${kind ?? ''}`.toLowerCase();
  if (probe.includes('reject_always') || probe.includes('deny_always'))
    return 'approval.rejectAlways';
  if (probe.includes('reject') || probe.includes('deny')) return 'approval.rejectOnce';
  if (probe.includes('always')) return 'approval.allowAlways';
  return 'approval.allowOnce';
}

const IMAGE_MIME_PREFIX = 'image/';

export function attachmentRef(
  attachment: {
    id?: string;
    type?: string;
    name?: string;
    mime?: string;
    url?: string;
    path?: string;
    size?: number;
  },
  index: number,
): AttachmentRef {
  const mime = attachment.mime;
  const name = attachment.name ?? attachment.path?.split('/').pop() ?? `file-${index}`;
  return {
    key: attachment.id ?? `${name}:${index}`,
    name,
    mime,
    url: attachment.url,
    size: attachment.size,
    isImage: mime !== undefined && mime.startsWith(IMAGE_MIME_PREFIX),
  };
}
