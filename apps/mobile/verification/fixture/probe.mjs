#!/usr/bin/env node
/**
 * 固定服务端自检：连上 WS、订阅、把收到的帧打出来。
 *
 * 为什么要有它：固定服务端替 App 说话，它自己坏了会表现为"App 里是空的"——
 * 那种失败信息很难查。这个探针把它当成一个独立组件验证：协议对不对、场景数据
 * 有没有真的发出来，几秒钟就有答案，不用起模拟器。
 *
 * 用法：
 *     node verification/fixture/probe.mjs [--port 18099] [--session fixture-session-active]
 */
const arguments_ = process.argv.slice(2);
function flag(name, fallback) {
  const index = arguments_.indexOf(`--${name}`);
  return index === -1 ? fallback : arguments_[index + 1];
}

const PORT = Number(flag('port', '18099'));
const SESSION = flag('session', 'fixture-session-active');

const socket = new WebSocket(`ws://127.0.0.1:${PORT}/bots/fixture-bot/web/ws`);
const frames = [];
let snapshot = null;

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'runtime_subscribe', session_id: SESSION }));
});

socket.addEventListener('message', (event) => {
  let frame;
  try {
    frame = JSON.parse(event.data);
  } catch {
    return;
  }
  frames.push(frame);
  if (frame.type === 'runtime_snapshot') snapshot = frame.snapshot;
});

socket.addEventListener('error', (error) => {
  console.error('WS 错误：', error.message ?? error);
  process.exit(1);
});

// 给 delta 足够时间发完（服务端每帧间隔 120ms）。
setTimeout(() => {
  const snapshots = frames.filter((frame) => frame.type === 'runtime_snapshot');
  const snapshotCursorOk = snapshots.every(
    (frame) =>
      typeof frame.epoch === 'string' && frame.epoch !== '' && typeof frame.seq === 'number',
  );
  const deltas = frames.filter((frame) => frame.type === 'runtime_delta');
  const appends = deltas.flatMap((frame) => frame.delta.message_appends ?? []);
  const upserts = deltas.flatMap((frame) => frame.delta.message_upserts ?? []);
  console.log(
    `收到帧：${frames.length}（snapshot ${snapshot === null ? 0 : 1}，delta ${deltas.length}）`,
  );
  console.log(`  upserts ${upserts.length}，appends ${appends.length}`);
  if (snapshot !== null) {
    console.log(
      `  snapshot epoch=${snapshot.epoch} seq=${snapshot.seq} run=${snapshot.current_run_view === null ? 'null' : snapshot.current_run_view.status}`,
    );
  }
  const kinds = new Set(upserts.map((message) => message.type));
  console.log(`  upsert 类型：${[...kinds].join(', ') || '(无)'}`);

  // seq 必须连续。踩过：场景帧里写死的 seq 有跳号，客户端光标判定"视图过期"、
  // 触发重订阅，页面停在 "Refreshing…"。这条断言把它钉住。
  const sequences = deltas.map((frame) => frame.seq);
  const expected = sequences.map((_, index) => index + 1);
  const contiguous = JSON.stringify(sequences) === JSON.stringify(expected);
  console.log(
    `  delta seq：${sequences.join(', ')}${contiguous ? '（连续）' : `（不连续，应为 ${expected.join(', ')}）`}`,
  );

  console.log(`  snapshot 顶层游标：${snapshotCursorOk ? '有' : '缺失'}`);

  const ok =
    snapshot !== null &&
    (deltas.length > 0 || upserts.length > 0) &&
    contiguous &&
    snapshotCursorOk;
  if (!contiguous) {
    console.error('自检失败：seq 不连续会让客户端判定视图过期，页面会停在 Refreshing…');
  }
  if (!snapshotCursorOk) {
    console.error(
      '自检失败：snapshot 帧的顶层缺少 epoch/seq。客户端从顶层取游标，' +
        '拿不到就会把第一个 delta 判成 "delta before snapshot" 并重新订阅，' +
        '页面停在 Refreshing…',
    );
  }
  console.log(ok ? '自检通过' : '自检失败：没有收到预期帧');
  socket.close();
  process.exit(ok ? 0 : 1);
}, 3000);
