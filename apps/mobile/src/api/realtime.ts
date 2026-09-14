/**
 * Memoh 实时通道客户端。
 *
 * 一条 bot 一条 WebSocket。这个类负责三件正确性要求很高的事，每一件都有对应的
 * 服务端行为做依据（见 `docs/research/memoh-api.md` §2.2）：
 *
 * 1. **订阅才能收到正文**。发消息的连接只会收到 `run_accepted` 和错误帧；文本、
 *    思考、工具增量全部走 `runtime_delta`，只发给 `runtime_subscribe` 过该会话的
 *    连接。所以「连上 → 订阅 → 等 snapshot → 再发消息」是硬顺序。
 *
 * 2. **epoch/seq 必须校验**。epoch 变了 seq 从 0 重来；`seq <= 本地` 是重复帧，
 *    丢弃；`seq != 本地 + 1` 是空洞，重订阅要 snapshot。服务端明确不做增量补齐
 *    （"在客户端位置和现在之间合成增量等于伪造历史"），所以 cursor 只是礼貌，
 *    真正的恢复手段是重新拿 snapshot。
 *
 * 3. **服务端不发心跳**。NAT 和运营商会在无数据 30s–5min 内静默掐断长连，而
 *    仓库 nginx 对这条路径的 `proxy_read_timeout` 是 300s。所以客户端必须自己
 *    保活：周期重发幂等的 `runtime_subscribe`，既续命又顺带纠正状态。
 */
import type {
  ClientFrame,
  RuntimeCursor,
  RuntimeDelta,
  RuntimeSnapshotPayload,
  ServerFrame,
} from './protocol.ts';
import { frameType } from './protocol.ts';
import { uuid } from '../lib/uuid.ts';
import type { UIAttachment } from './types.ts';
import { HEARTBEAT_INTERVAL_MS, judgeDelta, judgeSnapshot, reconnectDelay } from './cursor.ts';

/** 单条帧的长度上限（防御性）：异常大的帧直接丢掉，不要让 JS 被撑爆。 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SessionSnapshot {
  /** 这条投影属于哪个会话。没有它，调用方无法把帧归到某个会话上。 */
  sessionId: string;
  epoch: string;
  seq: number;
  snapshot: RuntimeSnapshotPayload;
}

export interface SessionDelta {
  sessionId: string;
  epoch: string;
  seq: number;
  delta: RuntimeDelta;
}

/**
 * 每个会话的订阅状态。`epoch` / `seq` 是**一对**，跨 epoch 比较 seq 没有意义。
 */
interface Subscription {
  epoch: string | null;
  seq: number;
}

export interface RealtimeListener {
  onStateChange?: (state: ConnectionState) => void;
  /** 权威状态。收到它就应丢弃本地对该会话的推测，按 snapshot 重建。 */
  onSnapshot?: (snapshot: SessionSnapshot) => void;
  onDelta?: (delta: SessionDelta) => void;
  /** 视图已过期（缓冲溢出或 seq 空洞）。上层应展示"刷新中"而不是假装还连着。 */
  onGap?: (sessionId: string, reason: string) => void;
  /** 控制类回执：abort / 审批 / 回答的结果。 */
  onControlAck?: (event: ServerFrame) => void;
  /** 服务端建好了会话（首发时没带 session_id 的情况）。 */
  onSessionCreated?: (sessionId: string, event: ServerFrame) => void;
  /** run 被接受：这是唯一引入 run_id 的地方，abort 需要它。 */
  onRunAccepted?: (event: ServerFrame) => void;
  onRunRejected?: (event: ServerFrame) => void;
  /** 其他未归类的帧（命令结果、错误等）。 */
  onOther?: (event: ServerFrame) => void;
  /** 连接层错误，仅用于日志/诊断。 */
  onError?: (error: Error) => void;
}

export interface RealtimeOptions {
  /**
   * HTTP base URL，形如 `https://memoh.example.com`。
   *
   * **不要在这里传一个完整的 ws:// 地址**——路径由这个类自己拼（`/bots/{botId}/web/ws`）。
   * 让调用方拼路径是个反复出错的点：漏掉 bot 段就会连到根路径拿 404，而且看起来
   * 像是"连接不稳"而不是"地址写错了"。
   */
  baseUrl: string;
  /** 这条连接服务的 bot。 */
  botId: string;
  /** 每次建连时调用，拿最新 token（不要缓存到闭包外）。 */
  getToken: () => string | null;
  listener: RealtimeListener;
  /**
   * 建 WebSocket 的方式。默认用运行时的全局 `WebSocket`（iOS 上就是 RN 的实现，
   * 它支持 `{ headers }` 第三参数）。抽出来是为了让 Node 下的集成测试能注入一个
   * 支持 header 的实现（Node 内置的 WebSocket 不支持），而不是在源码里做环境判断。
   */
  createSocket?: SocketFactory;
}

/** 建一条已带上鉴权的 WebSocket。抛出即视为建连失败，会走重连。 */
export type SocketFactory = (url: string, token: string) => WebSocket;

/** HTTP base URL → WebSocket origin。 */
function toWebSocketOrigin(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}`;
  return baseUrl;
}

/**
 * 拼出这条连接要连的完整地址。
 *
 * 单独成一个导出的纯函数是为了能被测：漏掉 bot 段会导致 404，而现象看起来像
 * "连接不稳"（一直重连），排查成本很高。
 */
export function realtimeUrl(baseUrl: string, botId: string): string {
  const origin = toWebSocketOrigin(baseUrl).replace(/\/+$/, '');
  return `${origin}/bots/${encodeURIComponent(botId)}/web/ws`;
}

/**
 * 默认的建连方式：用运行时的全局 `WebSocket`。
 *
 * 在 iOS 上这就是 React Native 的实现，它接受第三个 options 参数（`{ headers }`）——
 * 原生客户端走 `Authorization`，不用 `?token=`（那条是给浏览器的妥协，因为浏览器
 * 的 WebSocket 设不了 header）。
 *
 * 类型上需要显式声明这个构造签名：RN 支持它，但 DOM 的 `WebSocket` 类型定义不认。
 */
const defaultSocketFactory: SocketFactory = (url, token) => {
  const WebSocketWithOptions = WebSocket as unknown as new (
    url: string,
    protocols: string | string[] | undefined,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new WebSocketWithOptions(url, undefined, {
    headers: { Authorization: `Bearer ${token}` },
  });
};

/** 客户端生成的幂等键。没有 crypto.randomUUID 的运行时用降级实现。 */

export class MemohRealtime {
  private readonly wsUrl: string;
  private readonly createSocket: SocketFactory;
  private readonly getToken: () => string | null;
  private readonly listener: RealtimeListener;

  private socket: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  /** 掉线期间发出的帧先入队，连上后按序补发。 */
  private outbox: ClientFrame[] = [];
  private disposed = false;

  constructor(options: RealtimeOptions) {
    this.wsUrl = realtimeUrl(options.baseUrl, options.botId);
    this.getToken = options.getToken;
    this.listener = options.listener;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
  }

  /** 实际会连的地址。诊断用。 */
  get url(): string {
    return this.wsUrl;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** 当前已知的订阅游标，用于诊断与重连时带上。 */
  cursorFor(sessionId: string): RuntimeCursor | undefined {
    const sub = this.subscriptions.get(sessionId);
    if (!sub?.epoch) return undefined;
    return { epoch: sub.epoch, seq: sub.seq };
  }

  connect(): void {
    if (this.disposed) return;
    if (this.state === 'connecting' || this.state === 'open') return;
    this.openSocket();
  }

  disconnect(): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.setState('closed');
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
  }

  /** 彻底释放。之后 connect() 也不会重连。 */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.subscriptions.clear();
    this.outbox = [];
  }

  // ------------------------------------------------------------ 出站

  /**
   * 订阅会话。幂等：重复调用会替换旧订阅并让服务端重发 snapshot——这既是恢复
   * 手段，也是心跳手段。
   */
  subscribe(sessionId: string, options: { useCursor?: boolean } = {}): void {
    const cursor = options.useCursor === false ? undefined : this.cursorFor(sessionId);
    this.send({ type: 'runtime_subscribe', session_id: sessionId, cursor });
  }

  unsubscribe(sessionId: string): void {
    this.subscriptions.delete(sessionId);
    this.send({ type: 'runtime_unsubscribe', session_id: sessionId });
  }

  /**
   * 发一条消息。返回 `invocation_id`——它是"意图"的幂等键，重发同一个不会产生
   * 第二轮（服务端会回 `duplicate: true` 的 `run_accepted`）。
   */
  sendMessage(params: {
    sessionId?: string;
    text: string;
    attachments?: UIAttachment[];
    modelId?: string;
    reasoningEffort?: string;
    workspaceTargetId?: string;
    invocationId?: string;
  }): string {
    const invocationId = params.invocationId ?? uuid();
    this.send({
      type: 'message',
      invocation_id: invocationId,
      session_id: params.sessionId,
      text: params.text,
      attachments: params.attachments,
      model_id: params.modelId,
      reasoning_effort: params.reasoningEffort,
      workspace_target_id: params.workspaceTargetId,
    });
    return invocationId;
  }

  /** 中断一个 run。需要服务端给的 `run_id`。 */
  abort(sessionId: string, runId: string, controlId?: string): string {
    const id = controlId ?? uuid();
    this.send({ type: 'abort', run_id: runId, session_id: sessionId, control_id: id });
    return id;
  }

  /**
   * 回应工具审批。
   *
   * ⚠️ `decision_id` 必须是原始 `approval_id`；`option_id` 必填——只做
   * approve/reject 两个写死的按钮会让用户永远选不到 agent 定义的 session/always
   * 作用域。
   */
  respondToApproval(params: {
    sessionId: string;
    runId: string;
    approvalId: string;
    /** agent 定义的选项 id；agent 没给选项时省略，改用 `decision`。 */
    optionId?: string;
    decision?: 'approve' | 'reject';
    reason?: string;
    controlId?: string;
  }): string {
    const controlId = params.controlId ?? uuid();
    this.send({
      type: 'tool_approval_response',
      run_id: params.runId,
      session_id: params.sessionId,
      decision_id: params.approvalId,
      control_id: controlId,
      decision: params.decision,
      option_id: params.optionId,
      reason: params.reason,
    });
    return controlId;
  }

  /** 回应 agent 的提问。走的是和审批同一套机制；漏掉它 run 会永久卡住。 */
  respondToUserInput(params: {
    sessionId: string;
    runId: string;
    decisionId: string;
    answers?: unknown;
    /** 取消整次提问（不回答）。服务端接受 `canceled` + `reason`。 */
    canceled?: boolean;
    reason?: string;
    controlId?: string;
  }): string {
    const controlId = params.controlId ?? uuid();
    this.send({
      type: 'user_input_response',
      run_id: params.runId,
      session_id: params.sessionId,
      decision_id: params.decisionId,
      control_id: controlId,
      // 回答与取消是同一帧的两个可选部分（服务端同一套解析）。
      // 只发 `answers` 而不显式给 `canceled` 时，"取消"会被理解成一次空提交，
      // run 就继续等一个永远不来的答案。
      answers: params.answers,
      canceled: params.canceled === true,
      reason: params.reason,
    });
    return controlId;
  }

  newControlId(): string {
    return uuid();
  }

  // ------------------------------------------------------------ 连接生命周期

  private openSocket(): void {
    const token = this.getToken();
    if (!token) {
      this.setState('closed');
      this.listener.onError?.(new Error('no token'));
      return;
    }

    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = this.createSocket(this.wsUrl, token);
    } catch (error) {
      this.listener.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setState('open');
      this.flushOutbox();
      // 重连后必须重订阅全部活跃会话，否则会静默不更新。
      for (const sessionId of this.subscriptions.keys()) this.subscribe(sessionId);
      this.startHeartbeat();
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      this.handleRawFrame(event.data);
    };

    socket.onerror = (event: unknown) => {
      const message =
        typeof event === 'object' && event !== null && 'message' in event
          ? String((event as { message: unknown }).message)
          : 'websocket error';
      this.listener.onError?.(new Error(message));
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.stopHeartbeat();
      if (this.disposed) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setState('reconnecting');
    this.attempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, reconnectDelay(this.attempt));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // 用重订阅当心跳：幂等，且顺手纠正状态。
      for (const sessionId of this.subscriptions.keys()) this.subscribe(sessionId);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.listener.onStateChange?.(next);
  }

  private send(frame: ClientFrame): void {
    if (frame.type === 'runtime_subscribe') {
      // 先记账再发送：掉线期间订阅意图不能丢，否则重连时不知道该订阅谁。
      const existing = this.subscriptions.get(frame.session_id) ?? { epoch: null, seq: 0 };
      this.subscriptions.set(frame.session_id, existing);
    }

    const socket = this.socket;
    const open = socket !== null && socket.readyState === 1; // WebSocket.OPEN
    if (!open) {
      // 订阅/退订是状态同步，重连后会自动重放；其余控制帧必须补发。
      if (frame.type !== 'runtime_subscribe' && frame.type !== 'runtime_unsubscribe') {
        this.outbox.push(frame);
      }
      this.connect();
      return;
    }

    try {
      socket.send(JSON.stringify(frame));
    } catch (error) {
      this.outbox.push(frame);
      this.listener.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private flushOutbox(): void {
    const pending = this.outbox;
    this.outbox = [];
    for (const frame of pending) {
      const socket = this.socket;
      if (!socket || socket.readyState !== 1) {
        this.outbox.push(frame);
        continue;
      }
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        this.outbox.push(frame);
      }
    }
  }

  // ------------------------------------------------------------ 入站

  private handleRawFrame(data: unknown): void {
    // RN 的 WebSocket 只在字符串/binary 之间有区别；二进制不是本协议的形态。
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer) {
        if (data.byteLength > MAX_FRAME_BYTES) return;
        this.handleFrameJson(new TextDecoder().decode(data));
      }
      return;
    }
    if (data.length > MAX_FRAME_BYTES) return;
    this.handleFrameJson(data);
  }

  private handleFrameJson(text: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(text) as ServerFrame;
    } catch {
      // 坏帧不该杀掉连接；服务端偶尔会插入非 JSON 的调试输出。
      return;
    }

    const type = frameType(frame);
    switch (type) {
      case 'runtime_snapshot':
        this.handleSnapshot(frame as never);
        return;
      case 'runtime_delta':
        this.handleDelta(frame as never);
        return;
      case 'runtime_dropped':
        this.handleDropped(frame as never);
        return;
      case 'control_ack':
        this.listener.onControlAck?.(frame);
        return;
      case 'session_created': {
        const sessionId = (frame as { session_id?: unknown }).session_id;
        if (typeof sessionId === 'string') {
          this.subscriptions.set(sessionId, { epoch: null, seq: 0 });
          this.listener.onSessionCreated?.(sessionId, frame);
        }
        return;
      }
      case 'run_accepted':
        this.listener.onRunAccepted?.(frame);
        return;
      case 'run_rejected':
        this.listener.onRunRejected?.(frame);
        return;
      default:
        this.listener.onOther?.(frame);
    }
  }

  private handleSnapshot(frame: {
    session_id?: string;
    epoch?: string;
    seq?: number;
    snapshot?: Record<string, unknown>;
  }): void {
    const sessionId = frame.session_id;
    const epoch = frame.epoch;
    const seq = frame.seq;
    if (typeof sessionId !== 'string' || typeof epoch !== 'string' || typeof seq !== 'number')
      return;

    // snapshot 是权威状态，直接覆盖本地游标——不存在"比本地旧"的合法情况。
    this.subscriptions.set(sessionId, judgeSnapshot({ epoch, seq }));
    this.listener.onSnapshot?.({
      sessionId,
      epoch,
      seq,
      // 服务端在真实帧里保证了 snapshot 的形状；这里给一个空的兜底，让"字段缺失"
      // 表现为空状态而不是崩溃。
      snapshot: (frame.snapshot ?? {
        bot_id: '',
        session_id: sessionId,
        epoch,
        seq,
      }) as unknown as RuntimeSnapshotPayload,
    });
  }

  private handleDelta(frame: {
    session_id?: string;
    epoch?: string;
    seq?: number;
    delta?: Record<string, unknown>;
  }): void {
    const sessionId = frame.session_id;
    const epoch = frame.epoch;
    const seq = frame.seq;
    const delta = frame.delta;
    if (
      typeof sessionId !== 'string' ||
      typeof epoch !== 'string' ||
      typeof seq !== 'number' ||
      delta === undefined
    ) {
      return;
    }

    const current = this.subscriptions.get(sessionId) ?? { epoch: null, seq: 0 };
    const verdict = judgeDelta(current, { epoch, seq });

    switch (verdict.action) {
      case 'drop':
        return; // 重复帧。
      case 'resubscribe':
        // 服务端不做增量补齐，唯一诚实的恢复手段是重新拿 snapshot。
        this.subscribe(sessionId, { useCursor: false });
        this.listener.onGap?.(sessionId, verdict.reason);
        return;
      case 'apply':
        this.subscriptions.set(sessionId, verdict.cursor);
        this.listener.onDelta?.({ sessionId, epoch, seq, delta: delta as RuntimeDelta });
        return;
    }
  }

  private handleDropped(frame: { session_id?: string; message?: string }): void {
    const sessionId = frame.session_id;
    if (typeof sessionId !== 'string') return;
    const message = typeof frame.message === 'string' ? frame.message : 'runtime subscription gap';
    this.subscribe(sessionId, { useCursor: false });
    this.listener.onGap?.(sessionId, message);
  }
}
