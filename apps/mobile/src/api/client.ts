/**
 * Memoh REST 客户端。
 *
 * 只用 fetch + 手写类型，不引入官方 SDK（它的 SSE helper 依赖 RN 上没有的
 * `TextDecoderStream`）。
 *
 * 鉴权模型（务必记住）：**没有 refresh token**。`/auth/refresh` 必须带未过期的
 * Bearer 才能续期；一旦过期只能重新登录。所以任意 401 都当成"会话结束"处理，
 * 通知上层清凭据回登录页——不要指望按 exp 判断就够，服务端每次请求还会查一次
 * 账号状态（停用/删除会立刻 401，即使 token 未过期）。
 */
import type { QueueItem, SessionStatus } from '../models/chat.ts';
import type {
  Account,
  ModelSummary,
  Session,
  ListBotsResponse,
  ListSessionsResponse,
  LoginResponse,
  RefreshResponse,
  UIMessageListResponse,
} from './types.ts';

/**
 * 队列项的线上形状（snake_case、字段可缺）。转成 `QueueItem` 再由界面渲染——
 * 界面不直接碰线上形状，免得服务端加字段就漏出来。
 */
interface RawQueueItem {
  item_id?: string;
  text?: string;
  position?: number;
  status?: string;
}

function toQueueItem(raw: RawQueueItem, kind: 'follow-up' | 'steer'): QueueItem {
  return {
    itemId: raw.item_id ?? '',
    text: raw.text ?? '',
    position: raw.position ?? 0,
    status: raw.status ?? '',
    kind,
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 401 = 凭据失效，调用方应清凭据回登录页。 */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export type UnauthorizedHandler = () => void;

export interface ClientOptions {
  /** 形如 `https://memoh.example.com`，末尾斜杠会被去掉。 */
  baseUrl: string;
  /** 返回当前 token；由调用方负责从 Keychain 取。 */
  getToken: () => string | null;
  /** 收到 401 时调用，用于清凭据并跳登录。 */
  onUnauthorized?: UnauthorizedHandler;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** 把网络层异常与 HTTP 错误统一成 ApiError。 */
async function toApiError(response: Response): Promise<ApiError> {
  let message = `HTTP ${response.status}`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown; error?: unknown };
    if (typeof body.message === 'string' && body.message !== '') message = body.message;
    else if (typeof body.error === 'string' && body.error !== '') message = body.error;
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // 非 JSON 响应体（例如网关的 HTML 错误页）保持默认 message。
  }
  return new ApiError(response.status, message, code);
}

export class MemohClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: UnauthorizedHandler;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  get url(): string {
    return this.baseUrl;
  }

  /** 每次建连都要拿最新 token；不要在调用方缓存。 */
  token(): string | null {
    return this.getToken();
  }

  /** 把相对路径拼成绝对 URL。WebSocket 也用它。 */
  resolve(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * 打任意端点。给工具脚本与尚未成型的接口用。
   *
   * 有语义的接口都应该在上面有具名方法——`request` 是逃生舱，不是主路。
   * 用它的时候顺手想一下"这个是不是该有个具名方法"。
   */
  request<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    return this.send<T>(method, path, { body });
  }

  /** GET /bots/{botId}/settings —— bot 的运行时配置（模型、审批策略等）。 */
  getSettings(botId: string): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('GET', `/bots/${botId}/settings`);
  }

  updateSettings(botId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('PUT', `/bots/${botId}/settings`, { body });
  }

  // -------------------------------------------------------------- 会话信息

  /**
   * `GET /bots/{botId}/sessions/{sessionId}/status` —— 会话的消息数、上下文用量与
   * cache 统计。
   *
   * 返回形状**按部署实测**（不是照上游类型抄）：这台部署只给 `used_tokens`，
   * 没有 `context_window` / `budget_plan` / `compaction`。类型里把那些写成可选，
   * 界面据此决定要不要显示百分比——**没有窗口就不算百分比**，算出来是编的。
   */
  getSessionStatus(botId: string, sessionId: string): Promise<SessionStatus> {
    return this.send<SessionStatus>('GET', `/bots/${botId}/sessions/${sessionId}/status`);
  }

  // -------------------------------------------------------------- 会话队列

  /**
   * `GET /bots/{botId}/sessions/{sessionId}/queue` —— 两条队列一起拿。
   *
   * `steer_supported` 决定界面要不要给"插话"选项：不是所有运行形态都能被插话
   * （服务端 `SteerSupported`）。宁可不给这个入口，也不要给了却必然失败。
   */
  async getSessionQueue(
    botId: string,
    sessionId: string,
  ): Promise<{ followUp: QueueItem[]; steer: QueueItem[]; steerSupported: boolean }> {
    const raw = await this.send<{
      follow_up?: RawQueueItem[];
      steer?: RawQueueItem[];
      steer_supported?: boolean;
    }>('GET', `/bots/${botId}/sessions/${sessionId}/queue`);
    return {
      followUp: (raw.follow_up ?? []).map((item) => toQueueItem(item, 'follow-up')),
      steer: (raw.steer ?? []).map((item) => toQueueItem(item, 'steer')),
      steerSupported: raw.steer_supported === true,
    };
  }

  /**
   * `POST .../follow-up-queue` —— 这一轮跑完再跑（运行中发送的默认落点）。
   *
   * `invocationId` 是**幂等身份**：同一个发送手势重试必须带同一个 id，否则服务端
   * 会入两条（见 `features/chat/queue.ts` 的闸门说明）。
   */
  enqueueFollowUp(
    botId: string,
    sessionId: string,
    text: string,
    invocationId: string,
  ): Promise<RawQueueItem> {
    return this.send<RawQueueItem>('POST', `/bots/${botId}/sessions/${sessionId}/follow-up-queue`, {
      body: { invocation_id: invocationId, text },
    });
  }

  /** `POST .../steer-queue` —— 插进正在跑的那一轮，agent 立刻看到。 */
  enqueueSteer(
    botId: string,
    sessionId: string,
    text: string,
    invocationId: string,
  ): Promise<RawQueueItem> {
    return this.send<RawQueueItem>('POST', `/bots/${botId}/sessions/${sessionId}/steer-queue`, {
      body: { invocation_id: invocationId, text },
    });
  }

  /** 删掉一条还没被取用的队列项。 */
  deleteQueueItem(
    botId: string,
    sessionId: string,
    kind: 'follow-up' | 'steer',
    itemId: string,
  ): Promise<unknown> {
    const segment = kind === 'steer' ? 'steer-queue' : 'follow-up-queue';
    return this.send<unknown>(
      'DELETE',
      `/bots/${botId}/sessions/${sessionId}/${segment}/${encodeURIComponent(itemId)}`,
    );
  }

  /** 把一条 follow-up 提成 steer（"别等它跑完，现在就告诉它"）。 */
  promoteQueueItem(botId: string, sessionId: string, itemId: string): Promise<RawQueueItem> {
    return this.send<RawQueueItem>(
      'POST',
      `/bots/${botId}/sessions/${sessionId}/follow-up-queue/${encodeURIComponent(itemId)}/steer`,
    );
  }

  /**
   * `authenticated: false` 只给 `/auth/login` 用——那是唯一公开的鉴权入口。
   */
  private async send<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      authenticated?: boolean;
    } = {},
  ): Promise<T> {
    const { body, query, authenticated = true } = options;
    const url = new URL(this.resolve(path));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      const token = this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ApiError(0, detail);
    }

    if (!response.ok) {
      const apiError = await toApiError(response);
      if (apiError.isUnauthorized && authenticated) this.onUnauthorized?.();
      throw apiError;
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }

  // -------------------------------------------------------------- 认证

  /** 唯一公开入口。成功后应把返回的 profile 落盘（refresh 不再返回这些字段）。 */
  login(username: string, password: string): Promise<LoginResponse> {
    return this.send<LoginResponse>('POST', '/auth/login', {
      body: { username, password },
      authenticated: false,
    });
  }

  /** 需要当前 token 仍然有效。过期就救不回来了。 */
  refresh(): Promise<RefreshResponse> {
    return this.send<RefreshResponse>('POST', '/auth/refresh');
  }

  me(): Promise<Account> {
    return this.send<Account>('GET', '/users/me');
  }

  // -------------------------------------------------------------- Bot

  listBots(): Promise<ListBotsResponse> {
    return this.send<ListBotsResponse>('GET', '/bots');
  }

  // -------------------------------------------------------------- 会话

  listSessions(
    botId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<ListSessionsResponse> {
    return this.send<ListSessionsResponse>('GET', `/bots/${botId}/sessions`, {
      query: { limit: options.limit, cursor: options.cursor },
    });
  }

  /**
   * 单个会话的详情。
   *
   * 会话列表是分页的（默认 50 条），所以"当前会话不在已加载的那一页里"是常态——
   * 从通知、深链或另一个 bot 切进来时都会这样。直接拿列表去查标题会查不到，
   * 标题就退化成占位文案，用户看不出自己在哪个会话里。
   */
  getSession(botId: string, sessionId: string): Promise<Session> {
    return this.send<Session>('GET', `/bots/${botId}/sessions/${sessionId}`);
  }

  /**
   * 列模型。用于「这个 bot 能用哪些模型」以及测试跨模型家族的行为差异。
   */
  listModels(): Promise<{ items?: ModelSummary[] } | ModelSummary[]> {
    return this.send<{ items?: ModelSummary[] } | ModelSummary[]>('GET', '/models');
  }

  createSession(botId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.send<unknown>('POST', `/bots/${botId}/sessions`, { body });
  }

  updateSession(botId: string, sessionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.send<unknown>('PATCH', `/bots/${botId}/sessions/${sessionId}`, { body });
  }

  deleteSession(botId: string, sessionId: string): Promise<void> {
    return this.send<void>('DELETE', `/bots/${botId}/sessions/${sessionId}`);
  }

  /**
   * 会话历史。注意这是**轮次**（UITurn）列表，不是扁平消息列表。
   * `before_message_id` 用于向前翻页。
   */
  listMessages(
    botId: string,
    sessionId: string,
    options: { limit?: number; beforeMessageId?: string | number } = {},
  ): Promise<UIMessageListResponse> {
    return this.send<UIMessageListResponse>('GET', `/bots/${botId}/messages`, {
      query: {
        session_id: sessionId,
        limit: options.limit,
        before_message_id: options.beforeMessageId,
      },
    });
  }

  /** 会话上下文用量 / 缓存命中 / 技能列表。**不是**运行状态。 */
  sessionStatus(botId: string, sessionId: string): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('GET', `/bots/${botId}/sessions/${sessionId}/status`);
  }

  // -------------------------------------------------------------- 用量

  tokenUsage(botId: string): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('GET', `/bots/${botId}/token-usage`);
  }

  // -------------------------------------------------------------- 工作区文件

  /** ⚠️ 这个端点的 JSON 是 camelCase（`modTime` / `isDir`），全仓唯一例外。 */
  listFiles(botId: string, path: string): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('GET', `/bots/${botId}/container/fs/list`, {
      query: { path },
    });
  }

  /** ⚠️ 无大小限制，且二进制会有损。只用于小文本预览。 */
  readFile(botId: string, path: string): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>('GET', `/bots/${botId}/container/fs/read`, {
      query: { path },
    });
  }
}
