/**
 * 序号校验与重连策略的测试。
 *
 * 这些用例钉死的是"静默丢内容"这类最难在真机上发现的 bug：seq 错一格、epoch
 * 变了还在合并、重复帧被当成新内容。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HEARTBEAT_INTERVAL_MS, judgeDelta, judgeSnapshot, reconnectDelay } from '../src/api/cursor.ts';

test('连续帧被应用，游标前进', () => {
  const verdict = judgeDelta({ epoch: 'e1', seq: 41 }, { epoch: 'e1', seq: 42 });
  assert.equal(verdict.action, 'apply');
  assert.deepEqual(verdict.cursor, { epoch: 'e1', seq: 42 });
});

test('重复帧被丢弃', () => {
  assert.equal(judgeDelta({ epoch: 'e1', seq: 42 }, { epoch: 'e1', seq: 42 }).action, 'drop');
  assert.equal(judgeDelta({ epoch: 'e1', seq: 42 }, { epoch: 'e1', seq: 41 }).action, 'drop');
});

test('seq 空洞触发重新订阅', () => {
  const verdict = judgeDelta({ epoch: 'e1', seq: 10 }, { epoch: 'e1', seq: 12 });
  assert.equal(verdict.action, 'resubscribe');
  assert.match(verdict.reason, /seq gap 10 → 12/);
});

test('epoch 变化触发重新订阅，不跨 epoch 比较 seq', () => {
  // seq 看起来是连续的，但 epoch 变了就是重建。
  const verdict = judgeDelta({ epoch: 'e1', seq: 10 }, { epoch: 'e2', seq: 11 });
  assert.equal(verdict.action, 'resubscribe');
  assert.equal(verdict.reason, 'epoch changed');
});

test('还没收到 snapshot 就收到 delta → 重新订阅', () => {
  const verdict = judgeDelta({ epoch: null, seq: 0 }, { epoch: 'e1', seq: 1 });
  assert.equal(verdict.action, 'resubscribe');
  assert.equal(verdict.reason, 'delta before snapshot');
});

test('snapshot 直接覆盖游标，包括比本地更旧的情况', () => {
  // 服务端换 epoch 后 seq 从 0 重来，本地 seq 可能比它大——这不是"旧帧"。
  assert.deepEqual(judgeSnapshot({ epoch: 'e2', seq: 0 }), { epoch: 'e2', seq: 0 });
  assert.deepEqual(judgeSnapshot({ epoch: 'e1', seq: 43 }), { epoch: 'e1', seq: 43 });
});

test('心跳间隔在代理超时之内', () => {
  // 仓库 nginx 对这条路径的 proxy_read_timeout 是 300s。
  assert.ok(HEARTBEAT_INTERVAL_MS < 300_000);
  assert.ok(HEARTBEAT_INTERVAL_MS >= 15_000, '太频繁会给服务端添无谓的负载');
});

test('重连退避指数增长并有上限', () => {
  const noJitter = () => 0;
  assert.equal(reconnectDelay(1, noJitter), 1_000);
  assert.equal(reconnectDelay(2, noJitter), 2_000);
  assert.equal(reconnectDelay(3, noJitter), 4_000);
  assert.equal(reconnectDelay(10, noJitter), 30_000);
  assert.equal(reconnectDelay(50, noJitter), 30_000);
});

test('重连退避带抖动，且抖动不超过 20%', () => {
  const min = reconnectDelay(3, () => 0);
  const max = reconnectDelay(3, () => 1);
  assert.equal(min, 4_000);
  assert.equal(max, 4_800);
});
