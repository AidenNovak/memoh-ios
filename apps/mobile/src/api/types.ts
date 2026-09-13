/**
 * Memoh 协议类型。
 *
 * 真源：`spec/swagger.json`（REST）与 Go 实现（WebSocket 与 UI 视图模型），见
 * `docs/research/memoh-api.md`。这里只声明 iOS 用得到的部分，并且**刻意手写**——
 * 官方 `@memohai/sdk` 的 SSE helper 依赖 RN 上没有的 `TextDecoderStream`，
 * 我们不把它当运行时依赖。
 *
 * 命名约定（重要）：Memoh 的 REST JSON 大部分是 snake_case，**唯一例外**是
 * `GET /container/fs/list`（camelCase 的 `modTime` / `isDir`），见 `FileEntry`。
 *
 * 视图模型的权威定义在 `internal/agent/view/uimessage.go` —— 形状是**扁平的**，
 * 不是嵌套的 blocks 数组，这跟直觉不符，改之前先回去读那个文件。
 */

// ---------------------------------------------------------------- 账号

export type UserRole = 'admin' | 'member' | string;

export interface LoginResponse {
  access_token: string;
  token_type: string;
  /** ISO8601。默认签发 168h。没有 refresh token，过期即重登。 */
  expires_at: string;
  user_id: string;
  role: UserRole;
  display_name: string;
  username: string;
  timezone: string;
}

/**
 * `/auth/refresh` 只回这三样——`user_id` / `role` / `display_name` / `timezone`
 * 是登录独有的，别指望刷新能拿到，所以登录时必须把 profile 落盘。
 */
export interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
}

export interface Account {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  display_name: string;
  avatar_url: string;
  timezone: string;
  is_active: boolean;
  principal_is_active: boolean;
  membership_is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  joined_at: string;
  membership_updated_at: string;
  last_login_at: string;
  title_model_id: string;
}

// ---------------------------------------------------------------- Bot

export interface Bot {
  id: string;
  name: string;
  display_name: string;
  avatar_url: string;
  owner_user_id: string;
  status: string;
  timezone: string;
  is_active: boolean;
  check_state: string;
  check_issue_count: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  /**
   * 关键：`workspace_exec` / `manage` 是能不能连 WebSocket 的门槛。
   * 只有 `chat` 的成员看不到实时流，只能拉 REST 历史。
   */
  current_user_permissions: string[];
}

export interface ListBotsResponse {
  items: Bot[];
}

/** 能否开实时通道。UI 用这个决定走流式还是只读回放。 */
export function canOpenRealtime(bot: Bot): boolean {
  const permissions = bot.current_user_permissions ?? [];
  return permissions.includes('workspace_exec') || permissions.includes('manage');
}

// ---------------------------------------------------------------- 会话

export interface Session {
  id: string;
  bot_id: string;
  title: string;
  type: string;
  channel_type: string;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  parent_session_id: string;
  preferred_chat_model_id: string;
  preferred_external_model_id: string;
  preferred_reasoning_effort: string;
  model_preference_revision: string;
  runtime_type: string;
  runtime_metadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
  bot_agent_id: string;
  workdir_id: string;
  route_conversation_type: string;
  route_id: string;
  route_metadata: Record<string, unknown>;
  session_mode: string;
}

export interface ListSessionsResponse {
  items: Session[];
  /** 空串 = 到底了，不要再去请求空页。 */
  next_cursor: string;
}

// ---------------------------------------------------------------- 消息（扁平视图模型）

/**
 * 内容块类型。**只有这 6 种**——没有"文件改动"专有类型，diff 卡片要从 `tool`
 * 类型的 `input` / `output` 推导。
 */
export type UIMessageType = 'text' | 'reasoning' | 'tool' | 'attachments' | 'error' | 'notice';

export interface UIAttachment {
  id?: string;
  type: string;
  path?: string;
  url?: string;
  name?: string;
  mime?: string;
  size?: number;
  content_hash?: string;
  bot_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * agent 给出的审批选项，**逐字来自 agent**。客户端为每个 option 渲染一个动作，
 * 并用被选中的 option id 作答。
 */
export interface UIToolApprovalOption {
  id: string;
  name?: string;
  kind?: string;
}

export interface UIToolApproval {
  approval_id: string;
  short_id?: number;
  status: string;
  decision_reason?: string;
  can_approve?: boolean;
  options?: UIToolApprovalOption[];
  selected_option_id?: string;
}

/** agent 主动提问。走的是和审批同一套决策机制。 */
export interface UIQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface UIQuestion {
  id: string;
  text: string;
  kind: string;
  options?: UIQuestionOption[];
  allow_custom?: boolean;
  custom_exclusive?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface UIAnswer {
  question_id: string;
  question: string;
  selected?: UIQuestionOption[];
  custom_text?: string;
  text?: string;
  skipped?: boolean;
}

export interface UIUserInput {
  user_input_id: string;
  short_id?: number;
  status: string;
  questions?: UIQuestion[];
  answers?: UIAnswer[];
  can_respond?: boolean;
}

export interface UIExecutionLocation {
  kind: string;
  name: string;
}

export interface UIReasoningTiming {
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
}

/** 一条助手侧的输出块。注意是**扁平**的，没有嵌套 blocks。 */
export interface UIMessage {
  id: number;
  type: UIMessageType;
  content?: string;
  /** 工具名（`tool` 类型）。 */
  name?: string;
  input?: unknown;
  output?: unknown;
  tool_call_id?: string;
  /** 工具是否还在跑。比解析 content 可靠。 */
  running?: boolean;
  /** 工具进度流（`progress_appends` 累积到这里）。 */
  progress?: unknown[];
  approval?: UIToolApproval;
  execution_location?: UIExecutionLocation;
  user_input?: UIUserInput;
  attachments?: UIAttachment[];
  reasoning_timing?: UIReasoningTiming;
  code?: string;
  /** notice 块的机器可读参数（不要解析 content 来拿这些）。 */
  args?: Record<string, string>;
}

/**
 * 一轮对话。
 *
 * `role: 'user'` 的轮次用 `text` + `attachments`；
 * `role: 'assistant'` 的轮次用 `messages[]`。
 * `turn_position` 是准入时预留的不可变序号，用它排序，**不要**用时间戳或文本推。
 */
export interface UITurn {
  turn_id: string;
  turn_position?: number;
  role: 'user' | 'assistant' | 'system';
  kind?: string;
  messages?: UIMessage[];
  text?: string;
  user_message_kind?: string;
  attachments?: UIAttachment[];
  timestamp?: string;
  platform?: string;
  sender_display_name?: string;
  sender_avatar_url?: string;
  sender_user_id?: string;
}

export interface UIMessageListResponse {
  items: UITurn[];
}

// ---------------------------------------------------------------- 工作区文件

/** `GET /container/fs/list` 的条目。这里是 **camelCase**，全仓唯一例外。 */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
  mode?: string;
}

export interface ListFilesResponse {
  items?: FileEntry[];
  entries?: FileEntry[];
}

// ---------------------------------------------------------------- 用量

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
  cost?: number;
  [key: string]: unknown;
}

/** 建会话接口返回的形状在 swagger 里是空的，这里做一次显式窄化。 */
export function createdSessionId(response: unknown): string | null {
  if (response === null || typeof response !== 'object') return null;
  const record = response as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.session_id === 'string') return record.session_id;
  return null;
}

// ---------------------------------------------------------------- 模型

/**
 * 一个可用的模型。
 *
 * 注意 `enable`：**导入或新建的模型默认是 disabled**。不显式启用的话 run 会在
 * 解析阶段失败（"chat model ... is disabled"），而那个错误看起来像模型不可用，
 * 不像配置没生效。
 */
export interface ModelSummary {
  id: string;
  model_id: string;
  name: string;
  provider_id: string;
  type?: string;
  enable?: boolean;
  config?: Record<string, unknown>;
}
