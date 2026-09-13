#!/usr/bin/env node
/**
 * 验收用的固定数据服务端（fixture server）。
 *
 * ## 为什么需要它
 *
 * 场景台最初只能渲染**消息列表**——因为那份数据是本地帧回放，不经过网络。但"会话
 * 列表""设置页""待审批横幅"这些页面是从真实 store 取数的（还要开 WebSocket），
 * 没法靠本地回放呈现。
 *
 * 两条路可以走：
 *
 * 1. 在生产代码里加"场景模式"分支，直接塞假数据 —— 被否决。假数据一旦绕开
 *    store/网络，截出来的图就不代表真实路径；而且生产代码里会长出验收专用的分支。
 * 2. **起一个说真协议的服务端** —— 采用。App 完全不知道自己在跟谁说话：真实的
 *    HTTP 客户端、真实的 WebSocket、真实的 store、真实的页面。零生产代码改动。
 *
 * 代价是要把协议实现一遍。但那份活儿只有一次，而它换来的是：
 *
 * - 每个页面、每个状态都能**确定性地**截图（不依赖线上数据，不依赖隧道）；
 * - CI 里不需要任何服务端就能跑完整 UI 验收；
 * - 它是"协议长什么样"的又一份可执行文档——`docs/research/verified-behaviour.md`
 *   里的每条结论都能在这里对着看。
 *
 * ## 数据从哪来
 *
 * 聊天数据**直接复用 `src/features/verify/scenes.ts`**（Node 的类型剥离能直接
 * import 那个 .ts）：同一份帧序列，一路是本地回放给场景台用，一路是走真实 WS 发给
 * App。两边写的必须是同一件事，所以只维护一份。
 *
 * 用法：
 *     node verification/fixture/server.mjs [--port 18099] [--scenario chat-tools]
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const { SCENES } = await import(join(ROOT, 'src/features/verify/scenes.ts'));

const arguments_ = process.argv.slice(2);
function flag(name, fallback) {
  const index = arguments_.indexOf(`--${name}`);
  return index === -1 ? fallback : arguments_[index + 1];
}

const PORT = Number(flag('port', '18099'));
/** 固定时点：截图里的时间、相对时间都要可复现。 */
const NOW = new Date('2026-09-13T20:00:00Z');
const ISO = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

// ------------------------------------------------------------------ 固定数据

const BOT = {
  id: 'fixture-bot',
  name: 'assistant',
  display_name: 'Assistant',
  avatar_url: '',
  owner_user_id: 'fixture-user',
  status: 'ready',
  timezone: 'Asia/Shanghai',
  is_active: true,
  check_state: 'ok',
  check_issue_count: 0,
  created_at: ISO(60 * 24 * 30),
  updated_at: ISO(5),
  metadata: {},
  // workspace_exec 是"能不能连 WebSocket"的门槛（见 types.ts 的 canOpenRealtime）。
  current_user_permissions: ['chat', 'workspace_exec', 'manage'],
};

/** 会话列表。刻意涵盖首页要区分的几种形态。 */
const SESSIONS = [
  {
    id: 'fixture-session-active',
    title: '把报告的图表重新生成',
    type: 'chat',
    channel_type: 'web',
    created_at: ISO(60 * 24 * 2),
    updated_at: ISO(3),
    created_by_user_id: 'fixture-user',
    parent_session_id: '',
    preferred_chat_model_id: 'deepseek-v4-flash',
    preferred_external_model_id: '',
    preferred_reasoning_effort: '',
    model_preference_revision: '1',
    runtime_type: 'native',
    runtime_metadata: {},
    metadata: {},
    bot_agent_id: '',
    owner_user_id: 'fixture-user',
    last_message_at: ISO(3),
    message_count: 12,
  },
  {
    id: 'fixture-session-long-title',
    title: '为什么昨天那个部署脚本在 CI 上会超时，我一直没想明白，帮我看看是不是轮询间隔的问题',
    type: 'chat',
    channel_type: 'web',
    created_at: ISO(60 * 24),
    updated_at: ISO(45),
    created_by_user_id: 'fixture-user',
    parent_session_id: '',
    preferred_chat_model_id: 'deepseek-v4-flash',
    preferred_external_model_id: '',
    preferred_reasoning_effort: '',
    model_preference_revision: '1',
    runtime_type: 'native',
    runtime_metadata: {},
    metadata: {},
    bot_agent_id: '',
    owner_user_id: 'fixture-user',
    last_message_at: ISO(45),
    message_count: 4,
  },
  {
    id: 'fixture-session-untitled',
    title: '',
    type: 'chat',
    channel_type: 'telegram',
    created_at: ISO(60 * 5),
    updated_at: ISO(60 * 3),
    created_by_user_id: 'fixture-user',
    parent_session_id: '',
    preferred_chat_model_id: '',
    preferred_external_model_id: '',
    preferred_reasoning_effort: '',
    model_preference_revision: '1',
    runtime_type: 'native',
    runtime_metadata: {},
    metadata: {},
    bot_agent_id: '',
    owner_user_id: 'fixture-user',
    last_message_at: ISO(60 * 3),
    message_count: 2,
  },
  {
    id: 'fixture-session-old',
    title: '整理一下这个月的账单',
    type: 'chat',
    channel_type: 'web',
    created_at: ISO(60 * 24 * 20),
    updated_at: ISO(60 * 24 * 18),
    created_by_user_id: 'fixture-user',
    parent_session_id: '',
    preferred_chat_model_id: '',
    preferred_external_model_id: '',
    preferred_reasoning_effort: '',
    model_preference_revision: '1',
    runtime_type: 'native',
    runtime_metadata: {},
    metadata: {},
    bot_agent_id: '',
    owner_user_id: 'fixture-user',
    last_message_at: ISO(60 * 24 * 18),
    message_count: 30,
  },
];

function sceneById(id) {
  return SCENES.find((scene) => scene.id === id) ?? null;
}

/** 把场景的帧序列翻成 REST 历史（`UITurn[]`）。 */
function turnsFor(sceneId) {
  const scene = sceneById(sceneId);
  if (scene === null) return [];
  const turns = [];
  for (const frame of scene.frames) {
    if (frame.kind !== 'delta') continue;
    const delta = frame.delta;
    const userTurn = delta.user_turn_upserts?.[0];
    if (userTurn !== undefined) {
      turns.push({
        key: userTurn.turn_id,
        position: userTurn.turn_position ?? turns.length,
        active: false,
        user: {
          key: `m-user-${turns.length}`,
          role: 'user',
          blocks: [{ key: 'b-user', kind: 'text', text: userTurn.text }],
        },
      });
    }
  }
  // 助手侧：把 upsert / append 合成一条消息，按 id 归并。
  const assistantBlocks = new Map();
  for (const frame of scene.frames) {
    if (frame.kind !== 'delta') continue;
    for (const message of frame.delta.message_upserts ?? []) {
      assistantBlocks.set(message.id, message);
    }
    for (const append of frame.delta.message_appends ?? []) {
      const existing = assistantBlocks.get(append.id);
      assistantBlocks.set(append.id, {
        ...(existing ?? { id: append.id, type: append.type }),
        content: `${existing?.content ?? ''}${append.content}`,
      });
    }
  }
  if (assistantBlocks.size > 0 && turns.length > 0) {
    const blocks = [...assistantBlocks.values()].map((message) => {
      const base = { key: `b-${message.id}` };
      switch (message.type) {
        case 'text':
          return { ...base, kind: 'text', text: message.content ?? '' };
        case 'reasoning':
          return { ...base, kind: 'reasoning', text: message.content ?? '' };
        case 'tool':
          return {
            ...base,
            kind: 'tool',
            name: message.name ?? '',
            title: message.title ?? '',
            status: message.running === true ? 'running' : 'done',
            input: message.input,
            output: message.output,
            execution_location: message.execution_location,
          };
        case 'error':
          return { ...base, kind: 'error', text: message.content ?? '', code: message.code };
        case 'notice':
          return { ...base, kind: 'notice', text: message.content ?? '', code: message.code };
        default:
          return { ...base, kind: 'text', text: message.content ?? '' };
      }
    });
    turns[turns.length - 1].assistant = {
      key: `m-assistant-${turns.length}`,
      role: 'assistant',
      blocks,
    };
  }
  return turns;
}

/** 每个会话对应哪个场景。默认用第一个聊天场景。 */
function sceneForSession(sessionId) {
  if (sessionId === 'fixture-session-active') return 'chat-tools';
  if (sessionId === 'fixture-session-long-title') return 'chat-reasoning';
  if (sessionId === 'fixture-session-untitled') return 'approval-no-options';
  if (sessionId === 'fixture-session-old') return 'chat-long';
  return 'chat-tools';
}

// ------------------------------------------------------------------ HTTP

const TOKEN = 'fixture-token';

/** 当前场景。验收脚本通过 `/__scenario` 切换，REST 与 WS 都按它出数据。 */
let currentScenario = 'chat-tools';

/** bot 的运行时配置。形状照 `PUT /bots/{id}/settings` 的实测要求（多字段会被整条拒）。 */
const SETTINGS = {
  model: 'deepseek-v4-flash',
  tool_approval_config: { exec: { force_review_commands: false } },
};

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  // 场景切换：验收脚本改这个，之后的 REST/WS 都按新场景出数据。
  if (path === '/__scenario') {
    const body = await readBody(request);
    if (typeof body.scenario === 'string') currentScenario = body.scenario;
    return json(response, 200, { scenario: currentScenario });
  }

  if (path === '/auth/login' && method === 'POST') {
    return json(response, 200, {
      access_token: TOKEN,
      token_type: 'Bearer',
      expires_at: new Date(NOW.getTime() + 168 * 3600_000).toISOString(),
      user_id: 'fixture-user',
      role: 'admin',
      display_name: 'Fixture User',
      username: 'fixture',
      timezone: 'Asia/Shanghai',
    });
  }
  if (path === '/auth/refresh' && method === 'POST') {
    return json(response, 200, {
      access_token: TOKEN,
      token_type: 'Bearer',
      expires_at: new Date(NOW.getTime() + 168 * 3600_000).toISOString(),
    });
  }
  if (path === '/users/me') {
    return json(response, 200, {
      user_id: 'fixture-user',
      username: 'fixture',
      display_name: 'Fixture User',
      role: 'admin',
      timezone: 'Asia/Shanghai',
    });
  }

  if (path === '/bots') return json(response, 200, { items: [BOT] });

  const sessionsMatch = path.match(/^\/bots\/([^/]+)\/sessions$/);
  if (sessionsMatch && method === 'GET') {
    // 空态场景：会话列表为空，用来截首页的空态。
    if (currentScenario === 'home-empty') return json(response, 200, { items: [] });
    return json(response, 200, { items: SESSIONS });
  }

  const oneSession = path.match(/^\/bots\/([^/]+)\/sessions\/([^/]+)$/);
  if (oneSession && method === 'GET') {
    const found = SESSIONS.find((session) => session.id === oneSession[2]);
    if (found === undefined) return json(response, 404, { error: 'not found' });
    return json(response, 200, found);
  }
  if (oneSession && method === 'PATCH') {
    return json(response, 200, { ok: true });
  }
  if (oneSession && method === 'DELETE') {
    return json(response, 204, {});
  }

  const messages = path.match(/^\/bots\/([^/]+)\/messages$/);
  if (messages && method === 'GET') {
    const sessionId = url.searchParams.get('session_id') ?? '';
    return json(response, 200, { items: turnsFor(sceneForSession(sessionId)) });
  }

  if (/^\/bots\/[^/]+\/settings$/.test(path)) {
    if (method === 'GET') return json(response, 200, SETTINGS);
    return json(response, 200, SETTINGS);
  }

  if (path === '/models') {
    return json(response, 200, {
      items: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'kimi-k3', name: 'Kimi K3' },
      ],
    });
  }
  if (path.endsWith('/status')) return json(response, 200, { message_count: 12 });

  return json(response, 404, { error: `未实现的固定端点：${method} ${path}` });
});

// ------------------------------------------------------------------ WebSocket

/**
 * 极简 WebSocket 服务端（RFC 6455 的 server→client 方向就够用）。
 *
 * 不引第三方库：我们只需要"接受升级 + 发文本帧 + 收文本帧"，那点工作量比拉一个
 * 依赖（还要考虑它跟 Node 版本的兼容）小。
 */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/** 按 RFC 6455 编码一个文本帧（服务端发出，不需要掩码）。 */
function encodeText(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** 解出客户端帧的文本内容（客户端帧一定带掩码）。 */
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask !== null) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    offset = cursor + length;
    if (opcode === 0x8) {
      messages.push({ op: 'close' });
    } else if (opcode === 0x1) {
      messages.push({ op: 'text', text: payload.toString('utf8') });
    }
  }
  return messages;
}

server.on('upgrade', (request, socket) => {
  if (!request.url.includes('/web/ws')) {
    socket.destroy();
    return;
  }
  const key = request.headers['sec-websocket-key'];
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );

  let buffer = Buffer.alloc(0);
  /** 已订阅的会话 → 该发哪些帧。 */
  const subscriptions = new Map();

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = decodeFrames(buffer);
    // 简化：解析成功后整块丢弃（帧边界恰好落在结尾就够了，验收数据量很小）。
    if (parsed.length > 0) buffer = Buffer.alloc(0);

    for (const message of parsed) {
      if (message.op === 'close') {
        socket.end();
        return;
      }
      if (message.op !== 'text') continue;
      let frame;
      try {
        frame = JSON.parse(message.text);
      } catch {
        continue;
      }
      if (frame.type === 'runtime_subscribe') {
        const sceneId = sceneForSession(frame.session_id ?? '');
        subscriptions.set(frame.session_id, sceneId);
        // 立刻发 snapshot：客户端要靠它确定 epoch 与当前 run。
        sendScene(socket, frame.session_id, sceneId, subscriptions);
      }
      if (frame.type === 'runtime_unsubscribe') subscriptions.delete(frame.session_id);
    }
  });

  socket.on('error', () => socket.destroy());
});

/**
 * 发一个会话的帧序列。
 *
 * 顺序照协议：先 snapshot（含当前 run 视图与已有消息），再按 seq 依次 delta。
 *
 * ## 两个踩过的坑，写在这里免得再犯
 *
 * **1. `epoch` / `seq` 必须在帧的顶层，不能只藏在 `snapshot` 里。**
 *
 * 客户端从**帧顶层**读这两个字段（`realtime.ts` 的 `handleSnapshot`：`frame.epoch`
 * / `frame.seq`），拿到之后才更新游标。只放在 `snapshot` 对象里的话，客户端认为
 * 自己"还没收到过 snapshot"，于是收到第一个 delta 时判定 `delta before snapshot`
 * → 重新订阅 → 页面永远停在 "Refreshing…"。
 *
 * 这一点有上游自己的测试佐证：
 * `internal/agent/runtime/session/acceptance/suite_test.go` 里就是
 * `eventEpoch(snapshot)` / `eventSeq(snapshot)`——从事件顶层取。
 *
 * **2. `seq` 必须连续，而且由服务端重新编号。**
 *
 * 一开始直接发场景帧里写死的 seq（那些值是为本地回放写的，内部还有跳号），
 * 客户端的光标校验（`cursor.ts`：`seq !== current.seq + 1` → 重新拿 snapshot）
 * 判定"视图过期"。**本地回放那条路看不出问题**——reducer 不校验连续性，
 * 只有走真实实时通道才会暴露。
 *
 * 换句话说：seq 是**服务端对每条订阅流自己编号**的东西，不是数据自带的属性。
 * 这里每 120ms 发一帧，让流式在录屏里看得见；验收截图会等到终态。
 */
function sendScene(socket, sessionId, sceneId, subscriptions) {
  const scene = sceneById(sceneId);
  if (scene === null) return;
  const snapshotFrame = scene.frames.find((frame) => frame.kind === 'snapshot');
  const payload = snapshotFrame === undefined ? null : snapshotFrame.payload;

  socket.write(
    encodeText(
      JSON.stringify({
        type: 'runtime_snapshot',
        session_id: sessionId,
        // 顶层：客户端从这里取游标（见上面第 1 条）。
        epoch: payload?.epoch ?? 'fixture-epoch',
        seq: payload?.seq ?? 0,
        snapshot: payload,
      }),
    ),
  );
  const deltas = scene.frames.filter((frame) => frame.kind === 'delta');
  deltas.forEach((frame, index) => {
    setTimeout(
      () => {
        if (!subscriptions.has(sessionId)) return;
        socket.write(
          encodeText(
            JSON.stringify({
              type: 'runtime_delta',
              session_id: sessionId,
              epoch: frame.epoch,
              // 连续编号：snapshot 的 seq 是 0，第一个 delta 就是 1。
              seq: index + 1,
              delta: frame.delta,
            }),
          ),
        );
      },
      120 * (index + 1),
    );
  });
}

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fixed fixture server on http://127.0.0.1:${PORT}\n`);
});
