/**
 * 投影帧的序号校验。
 *
 * 从 `realtime.ts` 里抽出来单独成模块，因为这是整个实时层最容易写错、也最难在
 * 真机上复现的部分——错一格就会静默丢内容。抽成纯函数后可以直接测。
 *
 * 规则（依据 `docs/research/memoh-api.md` §2.2 与参考客户端
 * `apps/web/src/store/chat/runtime-client.ts` 的实现）：
 *
 *   - `epoch` 变了 → 重建。epoch 变了 seq 从 0 重来，跨 epoch 比较 seq 没有意义。
 *   - `seq <= 本地 seq` → 重复帧，丢弃。
 *   - `seq != 本地 seq + 1` → 有空洞，必须重新拿 snapshot。
 *   - 没订阅过就收到 delta → 状态不一致，重新订阅。
 *
 * 特别注意第三条：**不能靠 cursor 续传**。服务端明确说 live projection 背后没有
 * 持久事件日志，"在客户端位置和现在之间合成增量等于伪造历史"。所以恢复手段只有
 * 重新订阅要 snapshot。
 */

export interface SubscriptionCursor {
  epoch: string | null;
  seq: number;
}

export type Verdict =
  /** 正常帧，可以应用。 */
  | { action: 'apply'; cursor: SubscriptionCursor }
  /** 重复帧，丢弃且不动游标。 */
  | { action: 'drop' }
  /** 必须重新订阅（会带回权威 snapshot）。 */
  | { action: 'resubscribe'; reason: string };

/**
 * 判定一条 delta 帧。
 *
 * @param current 本地对该会话的游标；`epoch: null` 表示还没收到过 snapshot。
 */
export function judgeDelta(
  current: SubscriptionCursor,
  frame: { epoch: string; seq: number },
): Verdict {
  if (current.epoch === null) {
    return { action: 'resubscribe', reason: 'delta before snapshot' };
  }

  if (current.epoch !== frame.epoch) {
    return { action: 'resubscribe', reason: 'epoch changed' };
  }

  if (frame.seq <= current.seq) {
    return { action: 'drop' };
  }

  if (frame.seq !== current.seq + 1) {
    return { action: 'resubscribe', reason: `seq gap ${current.seq} → ${frame.seq}` };
  }

  return { action: 'apply', cursor: { epoch: frame.epoch, seq: frame.seq } };
}

/**
 * 判定一条 snapshot 帧。
 *
 * snapshot 是权威状态，不存在"比本地旧"的合法情况——直接覆盖游标。
 */
export function judgeSnapshot(frame: { epoch: string; seq: number }): SubscriptionCursor {
  return { epoch: frame.epoch, seq: frame.seq };
}

/** 心跳是否该发：默认 30s。服务端不发 ping，客户端必须自己保活。 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * 重连退避：指数增长并有上限，带抖动避免多会话同时重连打爆服务端。
 *
 * @param attempt 第几次重连，从 1 开始。
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = 1_000;
  const max = 30_000;
  const delay = Math.min(base * 2 ** Math.max(0, attempt - 1), max);
  const jitter = Math.floor(delay * 0.2 * random());
  return delay + jitter;
}
