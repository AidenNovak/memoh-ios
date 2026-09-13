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
import {
  decisionForFallback,
  isFallbackOption,
  appendOptimisticUserMessage,
  applyDelta,
  applyHistory,
  applySnapshot,
  clearApproval,
  initialChatState,
  markStale,
  type ChatState,
} from './reducer-exports.ts';

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
  currentSessionId: string | null;
  connection: ConnectionState;
  error: string | null;
}

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
  /** 返回 invocation_id；null 表示发不出去（没有实时通道）。 */
  sendMessage: (text: string) => string | null;
  abort: () => void;
  respondApproval: (optionId: string) => void;
  respondUserInput: (answers: unknown) => void;
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
        title: item.title !== '' ? item.title : item.id.slice(0, 8),
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
        title: session.title !== '' ? session.title : session.id.slice(0, 8),
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
    realtimeRef.current?.subscribe(currentSessionId);
  }, [state.client, state.currentSessionId, refreshHistory, ensureSessionInList]);

  // run 从跑着变成结束 → 历史现在是权威的，拉一次覆盖本地推测。
  useEffect(() => {
    const { currentSessionId, chats } = state;
    if (currentSessionId === null) return;
    const chat = chats[currentSessionId];
    if (chat === undefined) return;

    const wasRunning = prevRunningRef.current[currentSessionId] === true;
    prevRunningRef.current[currentSessionId] = chat.running;

    if (wasRunning && !chat.running) void refreshHistory(currentSessionId);
  }, [state.chats, state.currentSessionId, refreshHistory]);

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

  const sendMessage = useCallback((text: string): string | null => {
    const { currentSessionId, chats } = stateRef.current;
    const realtime = realtimeRef.current;
    if (realtime === null || currentSessionId === null) return null;
    void chats;
    const invocationId = realtime.sendMessage({ sessionId: currentSessionId, text });
    dispatch({
      type: 'chat',
      sessionId: currentSessionId,
      update: (chat) => appendOptimisticUserMessage(chat, text, invocationId),
    });
    return invocationId;
  }, []);

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

  const respondUserInput = useCallback((answers: unknown) => {
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
      answers,
    });
  }, []);

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
      sendMessage,
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
      sendMessage,
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
