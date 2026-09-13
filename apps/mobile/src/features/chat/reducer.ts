/**
 * 聊天页状态归约器（纯函数，不碰 React、不碰网络）。
 *
 * 这里是本项目最容易写错、也最值得写测试的地方。核心契约只有一条，违反它就会让
 * 长回复直接卡死：
 *
 *   **流式文本是 `message_appends`（按 id 追加），不是整块替换。**
 *   **只有 `tool_call_*`、审批、终止事件才是 `message_upserts`（整块）。**
 *
 * 状态因此分成三层：
 *   - `history`：已完成的历史轮次（来自 REST，或服务端确认过的 snapshot）。
 *   - `live`：当前活跃 run 的输出（整块 `blocks` + 按 id 累加的 `streams`）。
 *   - `optimistic`：本地刚发出、服务端还没确认的消息。
 *
 * 合并只在**渲染层做一次**（`turnsForDisplay`），不在每帧重建整条消息。
 *
 * 另外两个必须守住的点：
 *   - `reset_messages: true`（服务端 `retry`）丢弃本地推测的流式内容，保留已确认的
 *     整块历史。
 *   - `epoch` 变了就整体重建，不尝试合并——跨 epoch 的 seq 没有意义。
 */
import type {
  CurrentRunView,
  RunStatus,
  RuntimeDelta,
  RuntimeSnapshotPayload,
} from '../../api/protocol.ts';
import type { UIMessage, UITurn } from '../../api/types.ts';
import type {
  ApprovalChoice,
  PendingApproval,
  PendingQuestion,
  PendingUserInput,
  RenderBlock,
  RenderMessage,
  RenderTurn,
} from '../../models/chat.ts';
import {
  approvalTone,
  attachmentRef,
  fallbackOptionKey,
  toolStatusFrom,
} from '../../models/chat.ts';

/** 流式缓冲：message id → 累加内容。 */
export type StreamMap = Record<string, { type: 'text' | 'reasoning'; content: string }>;

export interface ChatState {
  /** null = 还没收到过任何 snapshot。 */
  epoch: string | null;
  seq: number;
  runId: string | null;
  runStatus: RunStatus | null;
  runError: string | null;
  /** 服务端权威：是否有活跃 run。 */
  running: boolean;
  /** 活跃 run 已准入的用户输入（含 apply 过的 steer）。 */
  liveUserTurns: UITurn[];
  /** 活跃 run 的助手侧整块内容，按消息 id 索引。 */
  blocks: Record<string, UIMessage>;
  /** 消息 id 的顺序。服务端不保证 upsert 顺序，自己维护。 */
  order: number[];
  /** 按 id 累加的流式缓冲。 */
  streams: StreamMap;
  /** 工具进度，按消息 id 索引。 */
  progress: Record<string, unknown[]>;
  /** 已完成的历史轮次。 */
  history: RenderTurn[];
  /** 本地乐观插入、尚未被服务端确认的轮次。 */
  optimistic: RenderTurn[];
  approval: PendingApproval | null;
  userInput: PendingUserInput | null;
  /** 视图可能已过期（收到 gap / dropped）。UI 应展示"刷新中"而不是假装还连着。 */
  stale: boolean;
  /** 本地已发出但服务端还没回 `run_accepted`。 */
  pendingSend: boolean;
}

export const initialChatState: ChatState = {
  epoch: null,
  seq: 0,
  runId: null,
  runStatus: null,
  runError: null,
  running: false,
  liveUserTurns: [],
  blocks: {},
  order: [],
  streams: {},
  progress: {},
  history: [],
  optimistic: [],
  approval: null,
  userInput: null,
  stale: false,
  pendingSend: false,
};

// ---------------------------------------------------------------- 消息 → 渲染块

/** 把一条 UIMessage 变成渲染块。`stream` 是该 id 上还没并入的流式增量。 */
export function blocksFromMessage(
  message: UIMessage,
  stream?: { type: 'text' | 'reasoning'; content: string },
): RenderBlock[] {
  const key = `m${message.id}`;
  const blocks: RenderBlock[] = [];

  switch (message.type) {
    case 'text':
    case 'reasoning': {
      const appended = stream !== undefined && stream.type === message.type ? stream.content : '';
      const text = (message.content ?? '') + appended;
      if (text === '') break;
      const streaming = appended !== '';
      if (message.type === 'text') {
        blocks.push({ kind: 'text', key, text, streaming });
      } else {
        blocks.push({
          kind: 'reasoning',
          key,
          text,
          streaming,
          durationMs: message.reasoning_timing?.duration_ms,
        });
      }
      break;
    }
    case 'tool': {
      const input = message.input;
      // 工具卡片的一行标题：优先取 input.command（执行类工具），退回工具名。
      let title = message.name ?? '';
      if (input !== null && typeof input === 'object' && 'command' in input) {
        title = String((input as { command: unknown }).command);
      }
      blocks.push({
        kind: 'tool',
        key,
        name: message.name ?? '',
        title,
        status: toolStatusFrom(message),
        input,
        output: message.output,
        location: message.execution_location?.name,
      });
      break;
    }
    case 'error':
      blocks.push({ kind: 'error', key, text: message.content ?? '', code: message.code });
      break;
    case 'notice':
      blocks.push({ kind: 'notice', key, text: message.content ?? '', code: message.name });
      break;
    case 'attachments':
      blocks.push({
        kind: 'attachments',
        key,
        items: (message.attachments ?? []).map(attachmentRef),
      });
      break;
    default:
      // 服务端可能加新块类型。静默丢弃比崩溃好，Debug 页能看出来。
      break;
  }

  return blocks;
}

/** 用户轮次（`role: 'user'`）变成一条渲染消息。 */
function userTurnToMessage(turn: UITurn): RenderMessage {
  const blocks: RenderBlock[] = [];
  if (typeof turn.text === 'string' && turn.text !== '') {
    blocks.push({ kind: 'text', key: `${turn.turn_id}:text`, text: turn.text, streaming: false });
  }
  if (turn.attachments !== undefined && turn.attachments.length > 0) {
    blocks.push({
      kind: 'attachments',
      key: `${turn.turn_id}:attachments`,
      items: turn.attachments.map(attachmentRef),
    });
  }
  return {
    key: turn.turn_id,
    role: 'user',
    blocks,
    turnKey: turn.turn_id,
    createdAt: turn.timestamp,
  };
}

/** 助手轮次（`role: 'assistant'`）变成一条渲染消息。 */
function assistantTurnToMessage(turn: UITurn, streams: StreamMap): RenderMessage {
  const blocks: RenderBlock[] = [];
  for (const message of turn.messages ?? []) {
    blocks.push(...blocksFromMessage(message, streams[String(message.id)]));
  }
  return {
    key: turn.turn_id,
    role: 'assistant',
    blocks,
    turnKey: turn.turn_id,
    createdAt: turn.timestamp,
  };
}

function positionOf(turn: UITurn, fallback: number): number {
  return typeof turn.turn_position === 'number' ? turn.turn_position : fallback;
}

/**
 * 把服务端轮次列表组装成渲染轮次。
 *
 * `turn_position` 是准入时预留的不可变序号——排序用它，**不要**用时间戳或文本推。
 * 同一 `turn_id` 的 user 与 assistant 轮次会合并进同一个 `RenderTurn`。
 */
export function renderTurns(turns: UITurn[], streams: StreamMap): RenderTurn[] {
  const byKey = new Map<string, RenderTurn>();
  let fallback = 0;

  for (const turn of turns) {
    const existing = byKey.get(turn.turn_id);
    const message =
      turn.role === 'user' ? userTurnToMessage(turn) : assistantTurnToMessage(turn, streams);
    if (existing !== undefined) {
      if (turn.role === 'user') existing.user = message;
      else existing.assistant = message;
      continue;
    }
    byKey.set(turn.turn_id, {
      key: turn.turn_id,
      position: positionOf(turn, fallback),
      user: turn.role === 'user' ? message : undefined,
      assistant: turn.role === 'assistant' ? message : undefined,
      active: false,
    });
    fallback += 1;
  }

  return [...byKey.values()].sort((a, b) => a.position - b.position);
}

function mergeTurns(base: RenderTurn[], overlay: RenderTurn[]): RenderTurn[] {
  const byKey = new Map<string, RenderTurn>();
  for (const turn of base) byKey.set(turn.key, turn);
  for (const turn of overlay) {
    const existing = byKey.get(turn.key);
    byKey.set(turn.key, existing === undefined ? turn : { ...existing, ...turn });
  }
  return [...byKey.values()].sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------- 决策提取

function toApprovalChoice(option: { id: string; name?: string; kind?: string }): ApprovalChoice {
  return { id: option.id, label: option.name, tone: approvalTone(option.id, option.kind) };
}

/** 没有 label 时的本地化兜底文案 key。 */
export function fallbackLabelKey(choice: ApprovalChoice): string {
  return fallbackOptionKey(choice.id);
}

function isPending(status: string | undefined): boolean {
  return status === 'pending' || status === 'waiting';
}

/** 从整块内容里找出待处理的审批。已决的不再展示。 */
function approvalFromBlocks(blocks: Record<string, UIMessage>): PendingApproval | null {
  for (const message of Object.values(blocks)) {
    const approval = message.approval;
    if (approval === undefined || approval.approval_id === '') continue;
    if (!isPending(approval.status)) continue;
    if (approval.can_approve === false) continue;
    return {
      approvalId: approval.approval_id,
      shortId: approval.short_id,
      runId: '',
      sessionId: '',
      toolName: message.name ?? '',
      toolInput: message.input,
      options: (approval.options ?? []).map(toApprovalChoice),
      // 上面已经过滤掉 can_approve === false 的审批。
      canApprove: true,
    };
  }
  return null;
}

function questionFrom(raw: {
  id: string;
  text: string;
  kind: string;
  options?: { id: string; label: string; description?: string }[];
  allow_custom?: boolean;
  required?: boolean;
  placeholder?: string;
}): PendingQuestion {
  return {
    questionId: raw.id,
    text: raw.text,
    kind: raw.kind,
    options: raw.options ?? [],
    allowCustom: raw.allow_custom !== false,
    required: raw.required === true,
    placeholder: raw.placeholder,
  };
}

/** 从整块内容里找出 agent 的提问。它走审批同一套决策机制。 */
function userInputFromBlocks(blocks: Record<string, UIMessage>): PendingUserInput | null {
  for (const message of Object.values(blocks)) {
    const input = message.user_input;
    if (input === undefined || input.user_input_id === '') continue;
    if (!isPending(input.status)) continue;
    if (input.can_respond === false) continue;
    return {
      userInputId: input.user_input_id,
      shortId: input.short_id,
      runId: '',
      sessionId: '',
      questions: (input.questions ?? []).map(questionFrom),
    };
  }
  return null;
}

function withDecisions(state: ChatState): ChatState {
  return {
    ...state,
    approval: approvalFromBlocks(state.blocks),
    userInput: userInputFromBlocks(state.blocks),
  };
}

// ---------------------------------------------------------------- 归约

function applyUpserts(state: ChatState, upserts: UIMessage[]): ChatState {
  if (upserts.length === 0) return state;
  const blocks = { ...state.blocks };
  const order = [...state.order];
  const streams = { ...state.streams };

  for (const message of upserts) {
    const key = String(message.id);
    blocks[key] = message;
    if (!order.includes(message.id)) order.push(message.id);
    // 整块内容到达后，该消息的流式缓冲已经并进去了，删掉避免重复累加。
    delete streams[key];
  }

  return { ...state, blocks, order, streams };
}

function applyAppends(
  state: ChatState,
  appends: { id: number; type: string; content: string }[],
): ChatState {
  if (appends.length === 0) return state;
  const streams: StreamMap = { ...state.streams };
  for (const append of appends) {
    const key = String(append.id);
    const type = append.type === 'reasoning' ? 'reasoning' : 'text';
    const existing = streams[key];
    if (existing !== undefined && existing.type === type) {
      // 同一个 id 的同类增量：追加。这就是本 reducer 存在的理由。
      streams[key] = { type, content: existing.content + append.content };
    } else {
      streams[key] = { type, content: append.content };
    }
  }
  return { ...state, streams };
}

function applyProgressAppends(
  state: ChatState,
  appends: { id: number; progress: unknown; input?: unknown }[],
): ChatState {
  if (appends.length === 0) return state;
  const progress = { ...state.progress };
  const blocks = { ...state.blocks };
  for (const append of appends) {
    const key = String(append.id);
    progress[key] = [...(progress[key] ?? []), append.progress];
    // 进度帧可能带来更新的 input（工具开始跑之后才拿到参数），补进整块消息。
    const existing = blocks[key];
    if (existing !== undefined && append.input !== undefined) {
      blocks[key] = { ...existing, input: append.input };
    }
  }
  return { ...state, progress, blocks };
}

export function isRunActive(status: RunStatus | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return (
    status === 'admitting' ||
    status === 'running' ||
    status === 'waiting_decision' ||
    status === 'finishing' ||
    status === 'aborting'
  );
}

/**
 * 应用一条 snapshot。snapshot 是**权威状态**：直接覆盖，不尝试与本地合并。
 * 服务端明确不做增量补齐（"在客户端位置和现在之间合成增量等于伪造历史"）。
 */
export function applySnapshot(state: ChatState, payload: RuntimeSnapshotPayload): ChatState {
  const run: CurrentRunView | null = payload.current_run_view ?? null;

  const blocks: Record<string, UIMessage> = {};
  const order: number[] = [];
  for (const message of run?.messages ?? []) {
    blocks[String(message.id)] = message;
    order.push(message.id);
  }

  const base: ChatState = {
    ...initialChatState,
    epoch: payload.epoch,
    seq: payload.seq,
    // 历史由 REST 维护；snapshot 只负责活跃 run 的部分。
    history: state.history,
    // 权威状态到了，本地乐观内容里还没有对应轮次的可以留着，其余丢掉。
    optimistic: state.optimistic.filter((turn) => !hasServerTurn(state, run, turn.key)),
    runId: run?.run_id ?? null,
    runStatus: run?.status ?? null,
    runError: typeof run?.error === 'string' && run.error !== '' ? run.error : null,
    running: isRunActive(run?.status),
    liveUserTurns: run?.user_turns ?? [],
    blocks,
    order,
  };

  return withDecisions(base);
}

/** 服务端是否已经有这个 turn（用于清掉对应的乐观占位）。 */
function hasServerTurn(state: ChatState, run: CurrentRunView | null, key: string): boolean {
  if (!key.startsWith('local-')) return false;
  const invocationId = key.slice('local-'.length);
  if (run?.invocation_id === invocationId) return true;
  return false;
}

/**
 * 应用一条 delta。
 *
 * `epoch` 与本地不一致时**不做增量合并**——跨 epoch 的 seq 没有意义，唯一正确的
 * 反应是丢弃并等新 snapshot。调用方（realtime）已经会重订阅，这里只标记过期。
 */
export function applyDelta(
  state: ChatState,
  epoch: string,
  seq: number,
  delta: RuntimeDelta,
): ChatState {
  if (state.epoch !== null && state.epoch !== epoch) {
    return { ...state, stale: true };
  }

  let next: ChatState = { ...state, epoch, seq, pendingSend: false };

  if (delta.reset_messages === true) {
    // 服务端 `retry`：丢弃本地推测的流式内容，保留已确认的整块历史。
    next = {
      ...next,
      streams: {},
      progress: {},
      blocks: {},
      order: [],
      stale: false,
      optimistic: [],
    };
  }

  next = applyUpserts(next, delta.message_upserts ?? []);
  next = applyAppends(next, delta.message_appends ?? []);
  next = applyProgressAppends(next, delta.progress_appends ?? []);

  if (delta.user_turn_upserts !== undefined && delta.user_turn_upserts.length > 0) {
    next = { ...next, liveUserTurns: mergeUserTurns(next.liveUserTurns, delta.user_turn_upserts) };
  }

  if (delta.current_run_view !== undefined) {
    const run = delta.current_run_view;
    const blocks: Record<string, UIMessage> = {};
    const order: number[] = [];
    for (const message of run?.messages ?? []) {
      blocks[String(message.id)] = message;
      order.push(message.id);
    }
    next = {
      ...next,
      blocks,
      order,
      runId: run?.run_id ?? null,
      runStatus: run?.status ?? null,
      runError: run?.error ?? null,
      running: isRunActive(run?.status),
      liveUserTurns: run?.user_turns ?? next.liveUserTurns,
    };
  } else if (delta.run !== undefined && delta.run !== null) {
    const run = delta.run;
    next = {
      ...next,
      runId: run.run_id ?? next.runId,
      runStatus: run.status ?? next.runStatus,
      runError: run.error ?? null,
      running: isRunActive(run.status),
    };
  }

  return withDecisions(next);
}

function mergeUserTurns(existing: UITurn[], incoming: UITurn[]): UITurn[] {
  const byId = new Map<string, UITurn>();
  for (const turn of existing) byId.set(turn.turn_id, turn);
  for (const turn of incoming) byId.set(turn.turn_id, turn);
  return [...byId.values()];
}

/** 用 REST 拿到的历史覆盖已完成轮次。活跃 run 的内容由 snapshot/delta 维护。 */
export function applyHistory(state: ChatState, turns: UITurn[]): ChatState {
  return { ...state, history: renderTurns(turns, {}) };
}

// ---------------------------------------------------------------- 本地动作

/** 本地乐观插入一条用户消息。服务端确认后会被替换。 */
export function appendOptimisticUserMessage(
  state: ChatState,
  text: string,
  invocationId: string,
): ChatState {
  const key = `local-${invocationId}`;
  const message: RenderMessage = {
    key,
    role: 'user',
    blocks: [{ kind: 'text', key: `${key}:text`, text, streaming: false }],
  };
  return {
    ...state,
    pendingSend: true,
    optimistic: [
      ...state.optimistic,
      { key, position: Number.MAX_SAFE_INTEGER, user: message, active: true },
    ],
  };
}

/** 发送失败：撤掉乐观消息，让界面回到能重试的状态。 */
export function dropOptimistic(state: ChatState, invocationId: string): ChatState {
  const key = `local-${invocationId}`;
  return {
    ...state,
    pendingSend: false,
    optimistic: state.optimistic.filter((turn) => turn.key !== key),
  };
}

/** 审批已回应：本地立刻清掉，不等服务端回执（回执失败会由 snapshot 纠正）。 */
export function clearApproval(state: ChatState): ChatState {
  return { ...state, approval: null };
}

export function clearUserInput(state: ChatState): ChatState {
  return { ...state, userInput: null };
}

export function markStale(state: ChatState, stale: boolean): ChatState {
  return { ...state, stale };
}

/** 重连/切换会话时重置实时部分，保留历史。 */
export function resetLive(state: ChatState): ChatState {
  return {
    ...initialChatState,
    history: state.history,
    optimistic: state.optimistic,
  };
}

// ---------------------------------------------------------------- 给 UI 的合并视图

/** 活跃 run 的助手侧渲染消息；没有内容时返回 null。 */
function liveAssistantMessage(state: ChatState): RenderMessage | null {
  const blocks = state.order.flatMap((id) => {
    const message = state.blocks[String(id)];
    return message === undefined ? [] : blocksFromMessage(message, state.streams[String(id)]);
  });
  // 只有流式缓冲、还没有整块的消息（罕见但可能）也要显示。
  for (const [id, stream] of Object.entries(state.streams)) {
    if (state.blocks[id] !== undefined) continue;
    blocks.push({
      kind: stream.type,
      key: `s${id}`,
      text: stream.content,
      streaming: true,
    });
  }
  if (blocks.length === 0) return null;
  return { key: '__live__', role: 'assistant', blocks };
}

/**
 * 展示用轮次：历史 → 活跃 run 的用户输入 → 活跃 run 的助手输出 → 本地乐观。
 *
 * 这是唯一做合并的地方；每帧只组装一次，不重建消息内容。
 */
export function turnsForDisplay(state: ChatState): RenderTurn[] {
  const result = state.history.slice();

  if (state.liveUserTurns.length > 0) {
    const live = renderTurns(state.liveUserTurns, state.streams).map((turn) => ({
      ...turn,
      position: turn.position + 1_000_000,
    }));
    result.push(...live);
  }

  const assistant = liveAssistantMessage(state);
  if (assistant !== null) {
    result.push({
      key: '__live__',
      position: Number.MAX_SAFE_INTEGER - 1,
      assistant: { ...assistant, turnKey: state.runId ?? undefined },
      active: state.running,
    });
  }

  result.push(...state.optimistic);
  return result;
}

/** 一条轮次是否含任何可渲染内容。用于过滤空轮次，避免出现空气泡。 */
export function hasContent(turn: RenderTurn): boolean {
  return (turn.user?.blocks.length ?? 0) > 0 || (turn.assistant?.blocks.length ?? 0) > 0;
}
