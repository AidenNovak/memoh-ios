/**
 * 归约器测试。
 *
 * 这些用例存在的唯一理由：把「流式文本按 id 追加」和「epoch/seq 语义」这两条
 * 容易写反的契约钉死。改 reducer 之前先跑它们。
 *
 * 用 Node 的内置 test runner + 类型剥离，不引入测试框架。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyDelta,
  applyHistory,
  applySnapshot,
  appendOptimisticUserMessage,
  clearApproval,
  dropOptimistic,
  fallbackLabelKey,
  hasContent,
  initialChatState,
  isRunActive,
  renderTurns,
  turnsForDisplay,
} from '../src/features/chat/reducer.ts';

/** 造一条文本消息的 upsert。 */
function textMessage(id, content, running) {
  return { id, type: 'text', content, running };
}

function toolMessage(id, name, running, options) {
  return {
    id,
    type: 'tool',
    name,
    running,
    input: { command: `${name} --flag` },
    approval:
      options === undefined ? undefined : { approval_id: `a${id}`, status: 'pending', options },
  };
}

test('message_appends 按 id 累加，不覆盖', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_appends: [{ id: 7, type: 'text', content: 'Hello' }],
  });
  state = applyDelta(state, 'e1', 2, {
    message_appends: [{ id: 7, type: 'text', content: ', world' }],
  });
  state = applyDelta(state, 'e1', 3, {
    message_appends: [{ id: 7, type: 'text', content: '!' }],
  });

  assert.equal(state.streams['7'].content, 'Hello, world!');
  assert.equal(state.streams['7'].type, 'text');
});

test('text 与 reasoning 各自累加到同一个 id 时不互相污染', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_appends: [{ id: 1, type: 'reasoning', content: 'thinking' }],
  });
  state = applyDelta(state, 'e1', 2, {
    message_appends: [{ id: 2, type: 'text', content: 'answer' }],
  });

  assert.equal(state.streams['1'].content, 'thinking');
  assert.equal(state.streams['2'].content, 'answer');
});

test('整块 upsert 到达后清掉同 id 的流式缓冲，避免重复累加', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_appends: [{ id: 3, type: 'text', content: 'partial' }],
  });
  assert.equal(state.streams['3'].content, 'partial');

  state = applyDelta(state, 'e1', 2, {
    message_upserts: [textMessage(3, 'partial and the rest', false)],
  });

  assert.equal(state.streams['3'], undefined);
  assert.equal(state.blocks['3'].content, 'partial and the rest');
});

test('epoch 变化时不合并，只标记 stale', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_appends: [{ id: 1, type: 'text', content: 'a' }],
  });
  const after = applyDelta(state, 'e2', 1, {
    message_appends: [{ id: 1, type: 'text', content: 'b' }],
  });

  assert.equal(after.stale, true);
  // 内容没有被合并进去——跨 epoch 的增量无意义。
  assert.equal(after.streams['1'].content, 'a');
});

test('reset_messages 丢弃流式缓冲与乐观内容，保留整块历史', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_upserts: [textMessage(1, 'kept', false)],
    message_appends: [{ id: 2, type: 'text', content: 'discarded' }],
  });
  state = appendOptimisticUserMessage(state, 'hi', 'inv-1');

  const after = applyDelta(state, 'e1', 2, { reset_messages: true });

  assert.deepEqual(after.streams, {});
  assert.equal(after.optimistic.length, 0);
  assert.equal(after.blocks['2'], undefined);
});

test('snapshot 覆盖本地推测（权威状态优先）', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 5, {
    message_appends: [{ id: 9, type: 'text', content: 'local guess' }],
  });

  const after = applySnapshot(state, {
    bot_id: 'b1',
    session_id: 's1',
    epoch: 'e9',
    seq: 0,
    current_run_view: {
      run_id: 'r1',
      status: 'running',
      messages: [textMessage(4, 'authoritative', false)],
    },
  });

  assert.equal(after.epoch, 'e9');
  assert.equal(after.seq, 0);
  assert.equal(after.blocks['4'].content, 'authoritative');
  assert.equal(after.blocks['9'], undefined);
});

test('snapshot 无 current_run_view 时清空活跃 run 内容', () => {
  let state = initialChatState;
  state = applyDelta(state, 'e1', 1, {
    message_upserts: [textMessage(1, 'gone', false)],
  });

  const after = applySnapshot(state, {
    bot_id: 'b1',
    session_id: 's1',
    epoch: 'e1',
    seq: 9,
    current_run_view: null,
  });

  assert.equal(after.running, false);
  assert.deepEqual(after.order, []);
});

test('run 状态机：waiting_decision 仍算活跃', () => {
  assert.equal(isRunActive('running'), true);
  assert.equal(isRunActive('waiting_decision'), true);
  assert.equal(isRunActive('admitting'), true);
  assert.equal(isRunActive('completed'), false);
  assert.equal(isRunActive('aborted'), false);
  assert.equal(isRunActive('errored'), false);
  assert.equal(isRunActive(null), false);
});

test('run.status = waiting_decision 时 running 为 true（这是"等你批准"的权威信号）', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    run: { run_id: 'r1', status: 'waiting_decision' },
  });
  assert.equal(state.running, true);
  assert.equal(state.runStatus, 'waiting_decision');
});

test('审批从整块内容里提取，选项逐字保留', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      toolMessage(1, 'fs_write', false, [
        { id: 'allow_once', name: 'Allow once' },
        { id: 'allow_always', name: 'Always allow' },
        { id: 'reject_once', name: 'Deny' },
      ]),
    ],
  });

  assert.notEqual(state.approval, null);
  assert.equal(state.approval.approvalId, 'a1');
  assert.equal(state.approval.toolName, 'fs_write');
  assert.deepEqual(
    state.approval.options.map((option) => option.id),
    ['allow_once', 'allow_always', 'reject_once'],
  );
  assert.deepEqual(
    state.approval.options.map((option) => option.tone),
    ['allow', 'allow', 'reject'],
  );
});

test('已决的审批不再出现在待处理里', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      {
        id: 1,
        type: 'tool',
        name: 'fs_write',
        running: false,
        approval: { approval_id: 'a1', status: 'approved', options: [{ id: 'allow_once' }] },
      },
    ],
  });
  assert.equal(state.approval, null);
});

test('can_approve=false 的审批不弹窗', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      {
        id: 1,
        type: 'tool',
        name: 'fs_write',
        running: false,
        approval: { approval_id: 'a1', status: 'pending', can_approve: false },
      },
    ],
  });
  assert.equal(state.approval, null);
});

test('clearApproval 本地立刻清掉审批', () => {
  let state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [toolMessage(1, 'fs_write', false, [{ id: 'allow_once' }])],
  });
  state = clearApproval(state);
  assert.equal(state.approval, null);
});

test('agent 提问被提取成待回应', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      {
        id: 5,
        type: 'tool',
        running: false,
        user_input: {
          user_input_id: 'u1',
          status: 'pending',
          questions: [
            {
              id: 'q1',
              text: 'Which branch?',
              kind: 'single_choice',
              options: [{ id: 'main', label: 'main' }],
            },
          ],
        },
      },
    ],
  });

  assert.notEqual(state.userInput, null);
  assert.equal(state.userInput.userInputId, 'u1');
  assert.equal(state.userInput.questions.length, 1);
  assert.equal(state.userInput.questions[0].text, 'Which branch?');
});

test('用户轮次与助手轮次合并进同一轮', () => {
  const turns = renderTurns(
    [
      { turn_id: 't1', role: 'user', text: 'hello', turn_position: 1 },
      {
        turn_id: 't1',
        role: 'assistant',
        turn_position: 2,
        messages: [{ id: 1, type: 'text', content: 'hi there' }],
      },
    ],
    {},
  );

  assert.equal(turns.length, 1);
  assert.equal(turns[0].user.blocks[0].text, 'hello');
  assert.equal(turns[0].assistant.blocks[0].text, 'hi there');
});

test('轮次按 turn_position 排序，不靠时间戳', () => {
  const turns = renderTurns(
    [
      { turn_id: 'b', role: 'user', text: 'second', turn_position: 20 },
      { turn_id: 'a', role: 'user', text: 'first', turn_position: 10 },
    ],
    {},
  );
  assert.deepEqual(
    turns.map((turn) => turn.key),
    ['a', 'b'],
  );
});

test('乐观消息在服务端确认后由 snapshot 清掉', () => {
  let state = appendOptimisticUserMessage(initialChatState, 'hi', 'inv-1');
  assert.equal(state.optimistic.length, 1);
  assert.equal(state.pendingSend, true);

  state = applySnapshot(state, {
    bot_id: 'b1',
    session_id: 's1',
    epoch: 'e1',
    seq: 1,
    current_run_view: {
      run_id: 'r1',
      invocation_id: 'inv-1',
      status: 'running',
      messages: [],
      user_turns: [{ turn_id: 't1', role: 'user', text: 'hi', turn_position: 1 }],
    },
  });

  assert.equal(state.optimistic.length, 0);
  assert.equal(state.pendingSend, false);
});

test('dropOptimistic 撤掉发送失败的消息', () => {
  let state = appendOptimisticUserMessage(initialChatState, 'hi', 'inv-2');
  state = dropOptimistic(state, 'inv-2');
  assert.equal(state.optimistic.length, 0);
  assert.equal(state.pendingSend, false);
});

test('turnsForDisplay 把历史、活跃、乐观三层拼起来', () => {
  let state = applyHistory(initialChatState, [
    { turn_id: 't1', role: 'user', text: 'old', turn_position: 1 },
  ]);
  state = applyDelta(state, 'e1', 1, {
    message_upserts: [textMessage(1, 'live output', false)],
    current_run_view: {
      run_id: 'r1',
      status: 'running',
      messages: [textMessage(1, 'live output', false)],
    },
  });
  state = appendOptimisticUserMessage(state, 'newest', 'inv-3');

  const turns = turnsForDisplay(state);
  const contents = turns.flatMap((turn) =>
    [...(turn.user?.blocks ?? []), ...(turn.assistant?.blocks ?? [])].map(
      (block) => block.text ?? '',
    ),
  );

  assert.ok(contents.includes('old'));
  assert.ok(contents.includes('live output'));
  assert.ok(contents.includes('newest'));
});

test('用户提问排在助手回复之前（回归：曾经反序）', () => {
  // 真机截图里助手回复渲染在用户气泡**上方**，看起来像模型抢答。
  // 起因是乐观消息被 push 到了数组最后。屏幕顺序由数组顺序决定，所以要断言顺序。
  //
  // 注意：用户轮与助手轮在服务端是**两条独立的轮次**（REST 历史里 role=user 与
  // role=assistant 各自一条），所以它们不会合并成一个 RenderTurn——断言要按"屏幕上
  // 从上到下看到的顺序"来写，而不是"合并成一条"。
  let state = appendOptimisticUserMessage(initialChatState, 'Say exactly: gamma', 'inv-9');
  state = applyDelta(state, 'e1', 1, {
    message_upserts: [textMessage(1, 'gamma', false)],
    current_run_view: {
      run_id: 'r1',
      status: 'running',
      messages: [textMessage(1, 'gamma', false)],
    },
  });

  const lines = turnsForDisplay(state)
    .filter(hasContent)
    .flatMap((turn) => [
      ...(turn.user?.blocks ?? []).map((block) => ({ role: 'user', text: block.text })),
      ...(turn.assistant?.blocks ?? []).map((block) => ({ role: 'assistant', text: block.text })),
    ]);

  assert.equal(lines.length, 2, `应该正好两行，实际是 ${JSON.stringify(lines)}`);
  assert.equal(lines[0].role, 'user');
  assert.equal(lines[0].text, 'Say exactly: gamma');
  assert.equal(lines[1].role, 'assistant');
  assert.equal(lines[1].text, 'gamma');
});

test('run 期间服务端不发 user_turns 时，乐观消息要顶上（回归）', () => {
  // 实测（tools/turn-probe.mjs）：run 跑到 admitting 时
  // current_run_view.user_turns 是 null。早期版本此时就把乐观消息清了，
  // 结果屏幕上用户提问直接消失，只剩助手回复。
  let state = appendOptimisticUserMessage(initialChatState, 'hello', 'inv-a');
  state = applySnapshot(state, {
    bot_id: 'b1',
    session_id: 's1',
    epoch: 'e1',
    seq: 1,
    current_run_view: {
      run_id: 'r1',
      invocation_id: 'inv-a',
      status: 'admitting',
      messages: [],
      // user_turns 故意缺失
    },
  });

  assert.equal(state.optimistic.length, 1, '还不知道用户轮次时不能丢掉乐观消息');
  const turns = turnsForDisplay(state).filter(hasContent);
  assert.equal(turns[0]?.user?.blocks[0].text, 'hello');
});

test('服务端给出 user_turns 之后才让乐观消息退场', () => {
  let state = appendOptimisticUserMessage(initialChatState, 'hello', 'inv-b');
  state = applySnapshot(state, {
    bot_id: 'b1',
    session_id: 's1',
    epoch: 'e1',
    seq: 1,
    current_run_view: {
      run_id: 'r1',
      invocation_id: 'inv-b',
      status: 'running',
      messages: [],
      user_turns: [{ turn_id: 't1', role: 'user', text: 'hello', turn_position: 1 }],
    },
  });

  assert.equal(state.optimistic.length, 0, '权威轮次到了，乐观副本该退场');
  const turns = turnsForDisplay(state).filter(hasContent);
  assert.equal(turns[0]?.user?.blocks[0].text, 'hello');
});

test('刷新历史后不会出现重复轮次（回归）', () => {
  // run 结束时既拉历史、又保留活跃 run 的缓冲，屏幕上会出现两份同样的内容。
  // 权威历史一到，本地推测与 run 缓冲都必须收起来。
  let state = appendOptimisticUserMessage(initialChatState, 'Say exactly: delta', 'inv-d');
  state = applyDelta(state, 'e1', 1, {
    message_upserts: [textMessage(1, 'delta', false)],
  });

  const before = turnsForDisplay(state).filter(hasContent);
  assert.ok(before.length >= 1, '刷新前应该有内容');

  state = applyHistory(state, [
    { turn_id: 't1', role: 'user', text: 'Say exactly: delta', turn_position: 1 },
    {
      turn_id: 't1',
      role: 'assistant',
      turn_position: 2,
      messages: [{ id: 1, type: 'text', content: 'delta' }],
    },
  ]);

  const after = turnsForDisplay(state).filter(hasContent);
  const assistantLines = after.filter((turn) => (turn.assistant?.blocks.length ?? 0) > 0);
  assert.equal(assistantLines.length, 1, '助手输出只能出现一次');
  assert.equal(state.optimistic.length, 0);
  assert.deepEqual(state.order, []);
});

test('hasContent 过滤空轮次', () => {
  assert.equal(hasContent({ key: 'x', position: 0, active: false }), false);
  assert.equal(
    hasContent({
      key: 'x',
      position: 0,
      user: {
        key: 'x',
        role: 'user',
        blocks: [{ kind: 'text', key: 'k', text: 'hi', streaming: false }],
      },
      active: false,
    }),
    true,
  );
});

test('未知的块类型被丢弃而不是崩溃', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [{ id: 1, type: 'some_future_type', content: 'x' }],
  });
  const turns = turnsForDisplay(state);
  const blocks = turns.flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(blocks.length, 0);
});

test('工具状态判定：running / done / 未知', () => {
  const running = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [toolMessage(1, 'fs_write', true)],
  });
  const blocks = turnsForDisplay(running).flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(blocks[0].kind, 'tool');
  assert.equal(blocks[0].status, 'running');

  const done = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [toolMessage(1, 'fs_write', false)],
  });
  const doneBlocks = turnsForDisplay(done).flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(doneBlocks[0].status, 'done');
});

test('工具卡片的标题优先取 input.command', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      { id: 1, type: 'tool', name: 'exec', running: true, input: { command: 'ls -la' } },
    ],
  });
  const blocks = turnsForDisplay(state).flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(blocks[0].title, 'ls -la');
  assert.equal(blocks[0].name, 'exec');
});

test('progress_appends 累积进度并补上后到的 input', () => {
  let state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [{ id: 1, type: 'tool', name: 'exec', running: true }],
  });
  state = applyDelta(state, 'e1', 2, {
    progress_appends: [{ id: 1, progress: { line: 'step 1' } }],
  });
  state = applyDelta(state, 'e1', 3, {
    progress_appends: [{ id: 1, progress: { line: 'step 2' }, input: { command: 'late' } }],
  });

  assert.equal(state.progress['1'].length, 2);
  assert.equal(state.blocks['1'].input.command, 'late');
});

test('附件块：图片被识别，非图片不', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      {
        id: 1,
        type: 'attachments',
        attachments: [
          { id: 'f1', type: 'image', name: 'shot.png', mime: 'image/png' },
          { id: 'f2', type: 'file', name: 'notes.txt', mime: 'text/plain' },
        ],
      },
    ],
  });
  const blocks = turnsForDisplay(state).flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(blocks[0].kind, 'attachments');
  assert.equal(blocks[0].items[0].isImage, true);
  assert.equal(blocks[0].items[1].isImage, false);
});

test('error 与 notice 块各自成形', () => {
  const state = applyDelta(initialChatState, 'e1', 1, {
    message_upserts: [
      { id: 1, type: 'error', content: 'boom', code: 'E_BOOM' },
      { id: 2, type: 'notice', content: 'tools unavailable', name: 'tools_unavailable' },
    ],
  });
  const blocks = turnsForDisplay(state).flatMap((turn) => turn.assistant?.blocks ?? []);
  assert.equal(blocks[0].kind, 'error');
  assert.equal(blocks[0].code, 'E_BOOM');
  assert.equal(blocks[1].kind, 'notice');
  assert.equal(blocks[1].code, 'tools_unavailable');
});

test('审批选项没有 label 时给出本地化兜底 key', () => {
  assert.equal(fallbackLabelKey({ id: 'allow_always', tone: 'allow' }), 'approval.allowAlways');
  assert.equal(fallbackLabelKey({ id: 'reject_once', tone: 'reject' }), 'approval.rejectOnce');
  assert.equal(fallbackLabelKey({ id: 'allow_once', tone: 'allow' }), 'approval.allowOnce');
});

test('同一 id 的重复 append 不会因乱序帧丢失内容', () => {
  // 服务端保证 seq 单调；reducer 只负责把收到的内容拼起来。
  let state = initialChatState;
  const chunks = ['a', 'b', 'c', 'd', 'e'];
  for (const [index, chunk] of chunks.entries()) {
    state = applyDelta(state, 'e1', index + 1, {
      message_appends: [{ id: 1, type: 'text', content: chunk }],
    });
  }
  assert.equal(state.streams['1'].content, 'abcde');
});
