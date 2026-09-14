/**
 * 会话队列的纯逻辑测试：提交闸门 + 队列项整理。
 *
 * 闸门错了的代价是**重复入队**——用户双击一下，agent 后面连着两轮都在回答同一句话。
 * 队列项过滤错了的代价是**队列永远显示不消失**（用户以为还欠着）或**提前消失**
 * （用户以为丢了）。两种都只有测试能钉住。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  composerAction,
  composerActionWithSupport,
  QueueSubmissionGate,
  queueFailureMessage,
  visibleQueueItems,
} from '../src/features/chat/queue.ts';

function item(overrides = {}) {
  return {
    itemId: 'i1',
    text: '补一句',
    position: 1,
    status: 'accepted',
    kind: 'follow-up',
    ...overrides,
  };
}

test('闸门：同一个手势在飞行中时第二次直接拒绝', () => {
  let created = 0;
  const gate = new QueueSubmissionGate(() => {
    created += 1;
    return `id-${created}`;
  });
  const first = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  assert.notEqual(first, null);
  assert.equal(
    gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' }),
    null,
    '同一个手势的第二次事件不能入队——那会排两条',
  );
  assert.equal(created, 1);
});

test('闸门：成功后重新开始算一个新身份', () => {
  let created = 0;
  const gate = new QueueSubmissionGate(() => {
    created += 1;
    return `id-${created}`;
  });
  const first = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  gate.succeed(first);
  const second = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  assert.notEqual(second, null, '上一次成功之后可以再发');
  assert.notEqual(second.invocationId, first.invocationId, '新的手势是新的身份');
});

test('闸门：失败后重试同一段文字沿用同一个身份（服务端据此去重）', () => {
  const gate = new QueueSubmissionGate(() => 'fixed-id');
  const first = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  gate.fail(first);
  const retry = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  assert.equal(retry.invocationId, first.invocationId, '结果不明的失败重试必须重放而不是再入一条');
});

test('闸门：失败后换了文字就是新的身份', () => {
  let created = 0;
  const gate = new QueueSubmissionGate(() => {
    created += 1;
    return `id-${created}`;
  });
  const first = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'a' });
  gate.fail(first);
  const other = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'b' });
  assert.notEqual(other.invocationId, first.invocationId, '换了内容就不是同一次提交');
});

test('闸门：不同会话/不同模式的身份互不干扰', () => {
  let created = 0;
  const gate = new QueueSubmissionGate(() => {
    created += 1;
    return `id-${created}`;
  });
  const a = gate.begin({ sessionId: 's1', mode: 'follow-up', text: 'x' });
  gate.succeed(a);
  const b = gate.begin({ sessionId: 's2', mode: 'follow-up', text: 'x' });
  gate.succeed(b);
  const c = gate.begin({ sessionId: 's1', mode: 'steer', text: 'x' });
  assert.notEqual(c.invocationId, a.invocationId);
});

test('visibleQueueItems：只留排队中与正在取用', () => {
  const items = [
    item({ itemId: 'a', status: 'accepted' }),
    item({ itemId: 'b', status: 'claimed' }),
    item({ itemId: 'c', status: 'applied' }),
    item({ itemId: 'd', status: 'rejected' }),
    item({ itemId: 'e', status: 'expired' }),
    item({ itemId: 'f', status: 'canceled' }),
  ];
  assert.deepEqual(
    visibleQueueItems(items).map((entry) => entry.itemId),
    ['a', 'b'],
    '终态不显示：它们要么已经是真实消息，要么已被放弃，继续挂着会让人以为还欠着',
  );
});

test('visibleQueueItems：按服务端给的 position 排序', () => {
  const items = [
    item({ itemId: 'later', position: 5 }),
    item({ itemId: 'first', position: 1 }),
    item({ itemId: 'middle', position: 3 }),
  ];
  assert.deepEqual(
    visibleQueueItems(items).map((entry) => entry.itemId),
    ['first', 'middle', 'later'],
  );
});

test('visibleQueueItems：同 position 时顺序稳定（不让两个设备抖出不同顺序）', () => {
  const items = [item({ itemId: 'b', position: 2 }), item({ itemId: 'a', position: 2 })];
  assert.deepEqual(
    visibleQueueItems(items).map((entry) => entry.itemId),
    ['a', 'b'],
  );
  // 输入顺序反过来，结果必须一样。
  assert.deepEqual(
    visibleQueueItems([...items].reverse()).map((entry) => entry.itemId),
    ['a', 'b'],
  );
});

test('visibleQueueItems：不修改传入数组', () => {
  const items = [item({ itemId: 'b', position: 2 }), item({ itemId: 'a', position: 1 })];
  visibleQueueItems(items);
  assert.deepEqual(
    items.map((entry) => entry.itemId),
    ['b', 'a'],
    '排序不该动调用方的数组',
  );
});

test('composerAction：服务端支持队列时，运行中且有文字 = 排队', () => {
  assert.equal(
    composerAction({ running: true, hasDraft: true, queueSupported: true }),
    'queue',
    '这正是"agent 还在跑、我再补一句"的落点',
  );
});

test('composerAction：服务端不支持队列时，运行中一律是停止（与部署版桌面端对齐）', () => {
  // 实测部署服务端对 /queue 一律 404，同部署的桌面端也没有队列功能。这时给"排队"
  // 按钮等于给一个必然失败的入口。
  assert.equal(composerAction({ running: true, hasDraft: true, queueSupported: false }), 'stop');
  assert.equal(composerAction({ running: true, hasDraft: false, queueSupported: false }), 'stop');
});

test('composerAction：空闲时是发送（有文字才有效）', () => {
  assert.equal(composerAction({ running: false, hasDraft: true, queueSupported: true }), 'send');
  assert.equal(composerAction({ running: false, hasDraft: true, queueSupported: false }), 'send');
  assert.equal(composerAction({ running: false, hasDraft: false, queueSupported: true }), 'send');
});

test('composerActionWithSupport：能力未知时按"不支持"处理', () => {
  // 还没探测出来时宁可当不支持：给一个注定 404 的入口比暂时没有这个功能更糟。
  assert.equal(
    composerActionWithSupport({ running: true, hasDraft: true, support: 'unknown' }),
    'stop',
  );
  assert.equal(
    composerActionWithSupport({ running: true, hasDraft: true, support: 'yes' }),
    'queue',
  );
  assert.equal(composerActionWithSupport({ running: true, hasDraft: true, support: 'no' }), 'stop');
});

test('queueFailureMessage：失败必须带得出原因，缺了就指明没拿到', () => {
  assert.equal(queueFailureMessage(new Error('boom')), 'queue.failed:boom');
  assert.equal(queueFailureMessage(new Error('')), 'queue.failed');
});
