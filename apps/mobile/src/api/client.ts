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
import type {
  Account,
  Session,
  ListBotsResponse,
  ListSessionsResponse,
  LoginResponse,
  RefreshResponse,
  UIMessageListResponse,
} from './types.ts';

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
   * `authenticated: false` 只给 `/auth/login` 用——那是唯一公开的鉴权入口。
   */
  private async request<T>(
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
    return this.request<LoginResponse>('POST', '/auth/login', {
      body: { username, password },
      authenticated: false,
    });
  }

  /** 需要当前 token 仍然有效。过期就救不回来了。 */
  refresh(): Promise<RefreshResponse> {
    return this.request<RefreshResponse>('POST', '/auth/refresh');
  }

  me(): Promise<Account> {
    return this.request<Account>('GET', '/users/me');
  }

  // -------------------------------------------------------------- Bot

  listBots(): Promise<ListBotsResponse> {
    return this.request<ListBotsResponse>('GET', '/bots');
  }

  // -------------------------------------------------------------- 会话

  listSessions(
    botId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<ListSessionsResponse> {
    return this.request<ListSessionsResponse>('GET', `/bots/${botId}/sessions`, {
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
    return this.request<Session>('GET', `/bots/${botId}/sessions/${sessionId}`);
  }

  createSession(botId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>('POST', `/bots/${botId}/sessions`, { body });
  }

  updateSession(botId: string, sessionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>('PATCH', `/bots/${botId}/sessions/${sessionId}`, { body });
  }

  deleteSession(botId: string, sessionId: string): Promise<void> {
    return this.request<void>('DELETE', `/bots/${botId}/sessions/${sessionId}`);
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
    return this.request<UIMessageListResponse>('GET', `/bots/${botId}/messages`, {
      query: {
        session_id: sessionId,
        limit: options.limit,
        before_message_id: options.beforeMessageId,
      },
    });
  }

  /** 会话上下文用量 / 缓存命中 / 技能列表。**不是**运行状态。 */
  sessionStatus(botId: string, sessionId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `/bots/${botId}/sessions/${sessionId}/status`,
    );
  }

  // -------------------------------------------------------------- 用量

  tokenUsage(botId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/bots/${botId}/token-usage`);
  }

  // -------------------------------------------------------------- 工作区文件

  /** ⚠️ 这个端点的 JSON 是 camelCase（`modTime` / `isDir`），全仓唯一例外。 */
  listFiles(botId: string, path: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/bots/${botId}/container/fs/list`, {
      query: { path },
    });
  }

  /** ⚠️ 无大小限制，且二进制会有损。只用于小文本预览。 */
  readFile(botId: string, path: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `/bots/${botId}/container/fs/read`, {
      query: { path },
    });
  }
}
