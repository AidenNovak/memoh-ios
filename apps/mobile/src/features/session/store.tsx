/**
 * 应用级会话状态。
 *
 * 这一层把三样东西接起来：
 *   - REST（`MemohClient`）——列表、历史、账号
 *   - 实时通道（`MemohRealtime`）——一条 bot 一条 WebSocket
 *   - 聊天归约器（`features/chat/reducer`）——纯状态变换
 *
 * 刻意**不**引入状态库：需要共享的东西就这么多，useReducer 够用。参考项目的
 * AGENTS.md 也是这条规矩（"add state libraries only when needed"）。
 *
 * 一个刻意的设计：**当前打开的会话 id 放在 state 里，不放 ref**。实时回调如果靠
 * ref 读，会出现"回调到了但 UI 不知道该更新谁"的竞态；放 state 里，所有订阅都在
 * 同一个渲染周期内拿到一致的值。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { AppState as RNAppState } from 'react-native';

import { ApiError, MemohClient } from '../../api/client.ts';
import { MemohRealtime, type ConnectionState } from '../../api/realtime.ts';
import { canOpenRealtime, type Bot, type Session as MemohSession } from '../../api/types.ts';
import type { QueueItem } from '../../models/chat.ts';
import { uuid } from '../../lib/uuid.ts';
import {
  composerActionWithSupport,
  QueueSubmissionGate,
  visibleQueueItems,
  type QueueSupport,
} from '../chat/queue.ts';
import {
  decisionForFallback,
  isFallbackOption,
  isRunActive,
  isRunAbandoned,
  settleAbandonedRun,
  appendOptimisticUserMessage,
  applyDelta,
  applyHistory,
  applySnapshot,
  clearApproval,
  clearUserInput,
  initialChatState,
  markStale,
  type ChatState,
} from './reducer-exports.ts';
import { CANCEL_REASON } from '../chat/userInput.ts';

/**
 * 会话在列表里的摘要。
 *
 * `title` **可能是空字符串**：服务端允许没有标题（新会话、从 IM 频道建的会话等）。
 * 之前这里用 `id.slice(0,8)` 兜底，结果界面上出现 "fixture-a3f2…" 这种 id 片段——
 * 对用户毫无意义，而且看起来像没做完。
 *
 * 现在保持原样（可能为空），显示时用 `sessionDisplayTitle()`，它走 i18n。
 * 放在渲染层而不是这里的原因：语言可以切换，本地化字符串不该固化进数据。
 */
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  /**
   * 副标题用的来源标记。
   *
   * 会话列表接口**不返回最后一条消息**，所以不能伪造"消息预览"——那会让用户以为
   * 那是真实内容。这里只展示服务端确实给了的字段（来源通道 / 会话类型），
   * 它对"这个会话是从哪来的"这个问题也是有信息量的。
   */
  source: string;
}

interface UiState {
  phase: 'signedOut' | 'ready';
  client: MemohClient | null;
  bots: Bot[];
  currentBotId: string | null;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  /** sessionId → 聊天状态。 */
  chats: Record<string, ChatState>;
  /** sessionId → 待发队列（服务端持有的 follow-up / steer）。 */
  queues: Record<string, QueueView>;
  currentSessionId: string | null;
  connection: ConnectionState;
  error: string | null;
}

/**
 * 一个会话的待发队列视图。
 *
 * `steerSupported` 来自服务端：不是所有运行形态都能被"插话"。宁可不给入口，
 * 也不要给一个必然失败的按钮。`error` 是入队/删除失败的一句话——队列失败必须
 * 说出来，用户以为排上了而实际没有是最坏的情况。
 */
export interface QueueView {
  items: QueueItem[];
  steerSupported: boolean;
  /**
   * 服务端有没有队列端点。`unknown` = 还没探测。
   *
   * 这个字段不是"锦上添花"：实测部署版本对 `/queue` 一律 404，而桌面端在同一个
   * 部署上也没有队列功能。探测到 `no` 之后，运行中的发送按钮回到"停止"语义
   * （与桌面端一致），而不是给一个必然失败的入口。
   */
  support: QueueSupport;
  error: string | null;
}

const EMPTY_QUEUE: QueueView = {
  items: [],
  steerSupported: false,
  support: 'unknown',
  error: null,
};

/**
 * 一次提交的结果。调用方据 `sent` / `queued` 清草稿，其余都把草稿留着——
 * 用户写的话不能因为一次失败就丢掉。
 */
export type SubmitResult = 'sent' | 'queued' | 'failed' | 'busy' | 'unavailable';

type Action =
  | { type: 'signedOut' }
  | { type: 'ready'; client: MemohClient }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'selectBot'; botId: string }
  | { type: 'sessionsLoading' }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'openSession'; sessionId: string }
  | { type: 'closeSession' }
  | { type: 'chat'; sessionId: string; update: (chat: ChatState) => ChatState }
  | { type: 'queue'; sessionId: string; view: QueueView }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'error'; message: string | null };

const initialState: UiState = {
  phase: 'signedOut',
  client: null,
  bots: [],
  currentBotId: null,
  sessions: [],
  sessionsLoading: false,
  chats: {},
  queues: {},
  currentSessionId: null,
  connection: 'idle',
  error: null,
};

function reducer(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'signedOut':
      return initialState;
    case 'ready':
      return { ...state, phase: 'ready', client: action.client, error: null };
    case 'bots': {
      const current = state.currentBotId;
      const stillThere = current !== null && action.bots.some((bot) => bot.id === current);
      return {
        ...state,
        bots: action.bots,
        currentBotId: stillThere ? current : (action.bots[0]?.id ?? null),
      };
    }
    case 'selectBot':
      return { ...state, currentBotId: action.botId, sessions: [], currentSessionId: null };
    case 'sessionsLoading':
      return { ...state, sessionsLoading: true };
    case 'sessions':
      return { ...state, sessions: action.sessions, sessionsLoading: false };
    case 'openSession':
      return {
        ...state,
        currentSessionId: action.sessionId,
        chats: { ...state.chats, [action.sessionId]: initialChatState },
      };
    case 'closeSession':
      return { ...state, currentSessionId: null };
    case 'chat': {
      const current = state.chats[action.sessionId] ?? initialChatState;
      return { ...state, chats: { ...state.chats, [action.sessionId]: action.update(current) } };
    }
    case 'queue':
      return { ...state, queues: { ...state.queues, [action.sessionId]: action.view } };
    case 'connection':
      return { ...state, connection: action.state };
    case 'error':
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/** 把各种错误翻译成能给用户看的 key 或一句话。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'error.unauthorized';
    if (error.isNetwork) return 'error.network';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

interface SessionContextValue {
  state: UiState;
  currentBot: Bot | null;
  realtimeEnabled: boolean;
  selectBot: (botId: string) => void;
  refreshBots: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  openSession: (sessionId: string) => void;
  closeSession: () => void;
  chatFor: (sessionId: string) => ChatState;
  /**
   * 提交一句话。**运行中会入队**（follow-up），空闲时才真的开一轮——这是
   * "agent 还在跑，我再补一句"的落点（上游同一个按钮的同一套语义）。
   *
   * 返回结果而不是 invocation_id：入队是异步的，调用方必须知道到底排上了没有，
   * 才能决定要不要清草稿。
   */
  submit: (text: string) => Promise<SubmitResult>;
  /** 某个会话的待发队列（没有就是空队列）。 */
  queueFor: (sessionId: string) => QueueView;
  /** 删掉一条队列项（用户改主意）。 */
  removeQueueItem: (item: QueueItem) => Promise<void>;
  /** 把 follow-up 提成 steer（别等它跑完，现在就告诉它）。 */
  promoteQueueItem: (item: QueueItem) => Promise<void>;
  abort: () => void;
  respondApproval: (optionId: string) => void;
  /** 回应 agent 的提问：给答案，或显式取消（两者都会发出 `user_input_response`）。 */
  respondUserInput: (payload?: { answers?: unknown; canceled?: boolean }) => void;
  dismissError: () => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionSeed {
  client: MemohClient;
}

export function SessionProvider({
  children,
  seed,
}: {
  children: React.ReactNode;
  seed: SessionSeed;
}) {
  const [state, dispatch] = useReducer(reducer, initialState, (base) => ({
    ...base,
    phase: 'ready' as const,
    client: seed.client,
  }));

  const realtimeRef = useRef<MemohRealtime | null>(null);
  const stateRef = useRef(state);
  /** 一个 provider 一个闸门：它记的是"这个界面有没有手势在飞"。 */
  const gate = useRef(new QueueSubmissionGate(() => uuid())).current;
  stateRef.current = state;
  /** sessionId → 上一次渲染时是否在跑。用来捕捉"跑完了"这个边沿。 */
  const prevRunningRef = useRef<Record<string, boolean>>({});

  const currentBot = useMemo(
    () => state.bots.find((bot) => bot.id === state.currentBotId) ?? null,
    [state.bots, state.currentBotId],
  );
  const realtimeEnabled = currentBot !== null && canOpenRealtime(currentBot);

  // ------------------------------------------------------------ REST

  const refreshBots = useCallback(async () => {
    const { client } = stateRef.current;
    if (client === null) return;
    try {
      const response = await client.listBots();
      dispatch({ type: 'bots', bots: response.items ?? [] });
    } catch (error) {
      dispatch({ type: 'error', message: describeError(error) });
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    const { client, currentBotId } = stateRef.current;
    if (client === null || currentBotId === null) return;
    dispatch({ type: 'sessionsLoading' });
    try {
      const response = await client.listSessions(currentBotId, { limit: 50 });
      const sessions: SessionSummary[] = (response.items ?? []).map((item: MemohSession) => ({
        id: item.id,
        title: item.title,
        updatedAt: item.updated_at,
        source: [item.channel_type, item.type].filter((part) => part !== '').join(' · '),
      }));
      dispatch({ type: 'sessions', sessions });
    } catch (error) {
      dispatch({ type: 'error', message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    void refreshBots();
  }, [refreshBots]);

  useEffect(() => {
    if (state.currentBotId !== null) void refreshSessions();
  }, [state.currentBotId, refreshSessions]);

  // ------------------------------------------------------------ 实时通道

  useEffect(() => {
    if (state.client === null || currentBot === null || !canOpenRealtime(currentBot)) return;
    const client = state.client;

    const realtime = new MemohRealtime({
      baseUrl: client.url,
      botId: currentBot.id,
      getToken: () => client.token(),
      listener: {
        onStateChange: (connection) => dispatch({ type: 'connection', state: connection }),
        onSnapshot: (frame) => {
          // 只应用当前正在看的那个会话。多会话订阅时服务端会把每个会话的帧都发过来，
          // 不筛就会串台。帧自带 sessionId，不必靠时序猜。
          const current = stateRef.current.currentSessionId;
          if (current === null || frame.sessionId !== current) return;
          dispatch({
            type: 'chat',
            sessionId: current,
            update: (chat) => applySnapshot(chat, frame.snapshot),
          });
        },
        onDelta: (frame) => {
          const current = stateRef.current.currentSessionId;
          if (current === null || frame.sessionId !== current) return;
          dispatch({
            type: 'chat',
            sessionId: current,
            update: (chat) => applyDelta(chat, frame.epoch, frame.seq, frame.delta),
          });
        },
        onGap: () => {
          const sessionId = stateRef.current.currentSessionId;
          if (sessionId === null) return;
          // 视图可能已过期——UI 要展示"刷新中"，不要假装还连着。
          dispatch({ type: 'chat', sessionId, update: (chat) => markStale(chat, true) });
        },
        onSessionCreated: (sessionId) => {
          dispatch({ type: 'openSession', sessionId });
        },
      },
    });

    realtimeRef.current = realtime;
    realtime.connect();

    return () => {
      realtime.dispose();
      realtimeRef.current = null;
    };
  }, [state.client, currentBot]);

  // 从后台回前台：长连接大概率已经被掐（服务端不发心跳），直接重连。
  useEffect(() => {
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const realtime = realtimeRef.current;
      if (realtime === null) return;
      realtime.disconnect();
      realtime.connect();
    });
    return () => subscription.remove();
  }, []);

  /**
   刷新一个会话的队列（服务端持有，客户端只读）。
   
   失败不弹错：读队列失败不代表用户的操作失败，界面回到"没有待发项"就够了；
   真正需要说的是**写**失败（入队/删除），那在各自的调用点报。
   */
  const refreshQueue = useCallback(async (sessionId: string) => {
    const { client, currentBotId, queues } = stateRef.current;
    if (client === null || currentBotId === null) return;
    // 已经探测出服务端没有队列端点，就别再打了（否则每个会话都要白跑一次 404）。
    if (queues[sessionId]?.support === 'no') return;
    try {
      const result = await client.getSessionQueue(currentBotId, sessionId);
      dispatch({
        type: 'queue',
        sessionId,
        view: {
          items: visibleQueueItems([...result.followUp, ...result.steer]),
          steerSupported: result.steerSupported,
          support: 'yes',
          error: null,
        },
      });
    } catch (error) {
      // 404 = 这个服务端版本没有队列端点。那是**能力结论**，不是故障：
      // 记下来，界面据此回到"运行中=停止"的语义（与桌面端一致），也不再重试。
      if (error instanceof ApiError && error.status === 404) {
        dispatch({
          type: 'queue',
          sessionId,
          view: { ...(queues[sessionId] ?? EMPTY_QUEUE), items: [], support: 'no', error: null },
        });
        return;
      }
      // 其余错误是暂时的：保持现状（清空会让用户以为排队的东西丢了）。
    }
  }, []);

  const queueFailure = useCallback((sessionId: string, error: unknown) => {
    dispatch({
      type: 'queue',
      sessionId,
      view: {
        ...(stateRef.current.queues[sessionId] ?? EMPTY_QUEUE),
        error: describeError(error),
      },
    });
  }, []);

  /**
   * 拉一次会话历史。
   *
   * 打开会话时要拉，**run 结束后也要拉**——因为运行期间服务端不一定给用户轮次
   * （实测 `current_run_view.user_turns` 可能是 null），只有 REST 历史才是权威且完整的。
   * 不刷新的话，屏幕上会一直挂着本地乐观版本，rebuild 之后顺序或内容可能与服务端不一致。
   */
  const refreshHistory = useCallback(async (sessionId: string) => {
    const { client, currentBotId } = stateRef.current;
    if (client === null || currentBotId === null) return;
    try {
      const response = await client.listMessages(currentBotId, sessionId, { limit: 100 });
      dispatch({
        type: 'chat',
        sessionId,
        update: (chat) => applyHistory(chat, response.items ?? []),
      });
    } catch (error) {
      dispatch({ type: 'error', message: describeError(error) });
    }
  }, []);

  /**
   * 确保当前会话有标题可显示。
   *
   * 列表是分页的，当前会话不一定在里面（从通知进来、切过 bot、或列表还没加载完）。
   * 拿不到就单独查一次——标题退化成占位文案时，所有会话长得一样，用户认不出自己在哪。
   */
  const ensureSessionInList = useCallback(async (sessionId: string) => {
    const { client, currentBotId, sessions } = stateRef.current;
    if (client === null || currentBotId === null) return;
    if (sessions.some((session) => session.id === sessionId)) return;
    try {
      const session = await client.getSession(currentBotId, sessionId);
      const summary: SessionSummary = {
        id: session.id,
        title: session.title,
        updatedAt: session.updated_at,
        source: [session.channel_type, session.type].filter((part) => part !== '').join(' · '),
      };
      dispatch({ type: 'sessions', sessions: [summary, ...stateRef.current.sessions] });
    } catch {
      // 查不到就继续用占位标题——不为了一个标题把整页弄成错误态。
    }
  }, []);

  // 打开会话：补标题 + 拉历史 + 订阅实时。
  useEffect(() => {
    const { client, currentSessionId } = state;
    if (client === null || currentSessionId === null) return;
    void ensureSessionInList(currentSessionId);
    void refreshHistory(currentSessionId);
    // 队列是服务端持有的：换会话必须重新拉，不能用上一个会话的残留。
    void refreshQueue(currentSessionId);
    realtimeRef.current?.subscribe(currentSessionId);
  }, [state.client, state.currentSessionId, refreshHistory, ensureSessionInList, refreshQueue]);

  /**
   * 兜住"owner 已经死了但投影还停在 running"的情况。
   *
   * 实测（`tools/orphan-run-probe.mjs`）：run 正常失败时投影会给 `errored`，
   * 但 owner 进程死掉时投影永远停在 `running`——不报错、不收敛。这时**服务端给的
   * 租约到期时间**是唯一线索。
   *
   * 没有这个检查，界面就是一直转圈，用户只能杀进程。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const sessionId = stateRef.current.currentSessionId;
      if (sessionId === null) return;
      const chat = stateRef.current.chats[sessionId];
      if (chat === undefined) return;
      if (!isRunAbandoned(chat)) return;
      dispatch({ type: 'chat', sessionId, update: (current) => settleAbandonedRun(current) });
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  // run 从跑着变成结束 → 历史现在是权威的，拉一次覆盖本地推测。
  useEffect(() => {
    const { currentSessionId, chats } = state;
    if (currentSessionId === null) return;
    const chat = chats[currentSessionId];
    if (chat === undefined) return;

    const wasRunning = prevRunningRef.current[currentSessionId] === true;
    prevRunningRef.current[currentSessionId] = chat.running;

    if (wasRunning && !chat.running) {
      void refreshHistory(currentSessionId);
      // run 结束 = 队列被消费的时机：follow-up 这时候才开始跑。
      void refreshQueue(currentSessionId);
    }
  }, [state.chats, state.currentSessionId, refreshHistory, refreshQueue]);

  /**
   运行中定期对齐队列（兜底）。
   
   主要触发点是事件（入队、删除、run 状态变化）；这个定时器只覆盖"服务端把一条
   follow-up 取走执行了、而客户端没接到任何帧"的情况。上游同样有一个 10s 兜底
   （`QUEUE_FALLBACK_REFRESH_MS`），理由相同：让"还在排队"这件事不会永远显示下去。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const { currentSessionId, chats, queues } = stateRef.current;
      if (currentSessionId === null) return;
      const pending = queues[currentSessionId]?.items.length ?? 0;
      if (pending === 0) return;
      // 只在"有东西排队"时才轮询——空队列不用一直打服务端。
      void refreshQueue(currentSessionId);
      void chats;
    }, 10_000);
    return () => clearInterval(timer);
  }, [refreshQueue]);

  // ------------------------------------------------------------ 动作

  const selectBot = useCallback((botId: string) => dispatch({ type: 'selectBot', botId }), []);
  const openSession = useCallback(
    (sessionId: string) => dispatch({ type: 'openSession', sessionId }),
    [],
  );
  const closeSession = useCallback(() => {
    const sessionId = stateRef.current.currentSessionId;
    if (sessionId !== null) realtimeRef.current?.unsubscribe(sessionId);
    dispatch({ type: 'closeSession' });
  }, []);

  const chatFor = useCallback(
    (sessionId: string): ChatState => state.chats[sessionId] ?? initialChatState,
    [state.chats],
  );

  const submit = useCallback(
    async (text: string): Promise<SubmitResult> => {
      const { currentSessionId, chats, client, currentBotId, queues } = stateRef.current;
      const realtime = realtimeRef.current;
      if (currentSessionId === null) return 'unavailable';
      const trimmed = text.trim();
      if (trimmed === '') return 'unavailable';

      const chat = chats[currentSessionId];
      const running = chat !== undefined && isRunActive(chat.runStatus);

      // 空闲：正常开一轮（走实时通道）。
      if (!running) {
        if (realtime === null) return 'unavailable';
        const invocationId = realtime.sendMessage({ sessionId: currentSessionId, text: trimmed });
        dispatch({
          type: 'chat',
          sessionId: currentSessionId,
          update: (state) => appendOptimisticUserMessage(state, trimmed, invocationId),
        });
        // 开了新一轮，队列里可能还有上一轮排下的东西——刷一次看服务端怎么算的。
        void refreshQueue(currentSessionId);
        return 'sent';
      }

      // 运行中：入队（follow-up）。这句话会在这一轮跑完后被执行。
      if (client === null || currentBotId === null) return 'unavailable';
      const submission = gate.begin({
        sessionId: currentSessionId,
        mode: 'follow-up',
        text: trimmed,
      });
      // 上一个手势还在飞：直接拒绝。同一次双击不能入两条。
      if (submission === null) return 'busy';
      try {
        await client.enqueueFollowUp(
          currentBotId,
          currentSessionId,
          trimmed,
          submission.invocationId,
        );
        gate.succeed(submission);
        dispatch({
          type: 'queue',
          sessionId: currentSessionId,
          view: { ...(queues[currentSessionId] ?? EMPTY_QUEUE), support: 'yes', error: null },
        });
        // 乐观放一条进去，等服务端列表回来再对齐（否则用户会以为没排上而再点一次）。
        dispatch({
          type: 'queue',
          sessionId: currentSessionId,
          view: {
            items: [
              ...(queues[currentSessionId]?.items ?? []),
              {
                itemId: `local-${submission.invocationId}`,
                text: trimmed,
                position: Number.MAX_SAFE_INTEGER,
                status: 'accepted',
                kind: 'follow-up' as const,
              },
            ],
            steerSupported: queues[currentSessionId]?.steerSupported ?? false,
            support: 'yes',
            error: null,
          },
        });
        void refreshQueue(currentSessionId);
        return 'queued';
      } catch (error) {
        gate.fail(submission);
        queueFailure(currentSessionId, error);
        return 'failed';
      }
    },
    [queueFailure, refreshQueue],
  );

  const removeQueueItem = useCallback(
    async (item: QueueItem) => {
      const { currentSessionId, client, currentBotId } = stateRef.current;
      if (client === null || currentBotId === null || currentSessionId === null) return;
      try {
        await client.deleteQueueItem(currentBotId, currentSessionId, item.kind, item.itemId);
        await refreshQueue(currentSessionId);
      } catch (error) {
        queueFailure(currentSessionId, error);
      }
    },
    [queueFailure, refreshQueue],
  );

  const promoteQueueItem = useCallback(
    async (item: QueueItem) => {
      const { currentSessionId, client, currentBotId } = stateRef.current;
      if (client === null || currentBotId === null || currentSessionId === null) return;
      try {
        await client.promoteQueueItem(currentBotId, currentSessionId, item.itemId);
        await refreshQueue(currentSessionId);
      } catch (error) {
        queueFailure(currentSessionId, error);
      }
    },
    [queueFailure, refreshQueue],
  );

  const queueFor = useCallback(
    (sessionId: string): QueueView => stateRef.current.queues[sessionId] ?? EMPTY_QUEUE,
    [],
  );

  const abort = useCallback(() => {
    const { currentSessionId, chats } = stateRef.current;
    const realtime = realtimeRef.current;
    if (realtime === null || currentSessionId === null) return;
    const runId = chats[currentSessionId]?.runId;
    if (runId == null) return;
    realtime.abort(currentSessionId, runId);
  }, []);

  const respondApproval = useCallback((optionId: string) => {
    const { currentSessionId, chats } = stateRef.current;
    const realtime = realtimeRef.current;
    if (realtime === null || currentSessionId === null) return;
    const chat = chats[currentSessionId];
    const approval = chat?.approval;
    const runId = chat?.runId;
    if (approval == null || runId == null) return;

    // 兜底动作不是 agent 定义的选项，不能把它的假 id 回传——服务端匹配不到。
    // 这时用 decision 表达批准/拒绝。
    if (isFallbackOption(optionId)) {
      realtime.respondToApproval({
        sessionId: currentSessionId,
        runId,
        approvalId: approval.approvalId,
        decision: decisionForFallback(optionId),
      });
    } else {
      realtime.respondToApproval({
        sessionId: currentSessionId,
        runId,
        approvalId: approval.approvalId,
        optionId,
      });
    }
    dispatch({ type: 'chat', sessionId: currentSessionId, update: clearApproval });
  }, []);

  /**
   * 回应 agent 的提问（`ask_user`）。
   *
   * 两种结束方式：给答案，或显式取消。**两种都必须发帧出去**——run 停在
   * `waiting_decision` 上，不发它就永远不继续（用户看到的是"卡住了"）。
   * 取消要带 `canceled`，否则服务端会当成一次空提交（见 realtime 的注释）。
   */
  const respondUserInput = useCallback(
    (payload: { answers?: unknown; canceled?: boolean } = {}) => {
      const { currentSessionId, chats } = stateRef.current;
      const realtime = realtimeRef.current;
      if (realtime === null || currentSessionId === null) return;
      const chat = chats[currentSessionId];
      const pending = chat?.userInput;
      const runId = chat?.runId;
      if (pending == null || runId == null) return;
      realtime.respondToUserInput({
        sessionId: currentSessionId,
        runId,
        decisionId: pending.userInputId,
        answers: payload.answers,
        canceled: payload.canceled === true,
        reason: payload.canceled === true ? CANCEL_REASON : undefined,
      });
      // 乐观清掉：否则表单继续挂在屏幕上，用户会以为没生效而重复点。
      dispatch({ type: 'chat', sessionId: currentSessionId, update: clearUserInput });
    },
    [],
  );

  const signOut = useCallback(() => {
    realtimeRef.current?.dispose();
    realtimeRef.current = null;
    dispatch({ type: 'signedOut' });
  }, []);

  const dismissError = useCallback(() => dispatch({ type: 'error', message: null }), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      currentBot,
      realtimeEnabled,
      selectBot,
      refreshBots,
      refreshSessions,
      openSession,
      closeSession,
      chatFor,
      submit,
      queueFor,
      removeQueueItem,
      promoteQueueItem,
      abort,
      respondApproval,
      respondUserInput,
      dismissError,
      signOut,
    }),
    [
      state,
      currentBot,
      realtimeEnabled,
      selectBot,
      refreshBots,
      refreshSessions,
      openSession,
      closeSession,
      chatFor,
      submit,
      queueFor,
      removeQueueItem,
      promoteQueueItem,
      abort,
      respondApproval,
      respondUserInput,
      dismissError,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession 必须在 SessionProvider 内使用');
  return value;
}
