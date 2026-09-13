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
import type { RuntimeDelta, RuntimeSnapshotPayload } from '../../api/protocol.ts';
import { canOpenRealtime, type Bot, type Session as MemohSession } from '../../api/types.ts';
import {
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
          const sessionId = stateRef.current.currentSessionId;
          if (sessionId === null) return;
          const payload = frame.snapshot as unknown as RuntimeSnapshotPayload;
          dispatch({ type: 'chat', sessionId, update: (chat) => applySnapshot(chat, payload) });
        },
        onDelta: (frame) => {
          const sessionId = stateRef.current.currentSessionId;
          if (sessionId === null) return;
          dispatch({
            type: 'chat',
            sessionId,
            update: (chat) =>
              applyDelta(chat, frame.epoch, frame.seq, frame.delta as unknown as RuntimeDelta),
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

  // 打开会话：拉历史 + 订阅实时。
  useEffect(() => {
    const { client, currentBotId, currentSessionId } = state;
    if (client === null || currentBotId === null || currentSessionId === null) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await client.listMessages(currentBotId, currentSessionId, { limit: 100 });
        if (cancelled) return;
        dispatch({
          type: 'chat',
          sessionId: currentSessionId,
          update: (chat) => applyHistory(chat, response.items ?? []),
        });
      } catch (error) {
        if (!cancelled) dispatch({ type: 'error', message: describeError(error) });
      }
    })();

    realtimeRef.current?.subscribe(currentSessionId);

    return () => {
      cancelled = true;
    };
  }, [state.client, state.currentBotId, state.currentSessionId]);

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
    realtime.respondToApproval({
      sessionId: currentSessionId,
      runId,
      approvalId: approval.approvalId,
      optionId,
    });
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
