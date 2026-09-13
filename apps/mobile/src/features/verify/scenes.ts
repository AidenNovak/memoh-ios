/**
 * 验收场景的固定数据（仅开发构建）。
 *
 * ## 为什么用"帧回放"而不是手搓状态
 *
 * 每个场景是一串**协议帧**（snapshot / delta），由真实 reducer 回放成状态。
 *
 * 手搓一个 `ChatState` 更快，但那样场景截的图证明不了任何事——它只能证明"我能把
 * 这个对象画出来"，而不能证明"服务端发这些帧时界面是对的"。用帧回放以后，每个
 * 场景顺带就是 reducer 的一条集成测试：形状错了、字段名变了、顺序不对，场景自己
 * 就会显示出来。
 *
 * ## 形状的来源
 *
 * 帧的形状全部取自 `docs/research/verified-behaviour.md` 里实测到的真实数据，
 * 不是照着 swagger 猜的。特别是这几条：
 *   - `message_appends` 按 id 追加（流式）
 *   - 用户轮与助手轮在 REST 里是两条独立记录
 *   - 审批的 `options` 可能**整个缺失**（这时 UI 必须给兜底动作）
 *   - 工具调用走 `type: 'tool'` 的整块 upsert，带 `running` 与 `execution_location`
 */

import type { RuntimeDelta, RuntimeSnapshotPayload } from '../../api/protocol.ts';

export interface Scene {
  id: string;
  /** 人类可读的场景说明，出现在 Debug 页与截图文件名里。 */
  title: string;
  /** 这个场景要验证什么。写清楚，否则下一轮没人知道它为什么存在。 */
  intent: string;
  /** 回放用的帧序列。按顺序喂给 reducer。 */
  frames: SceneFrame[];
  /** 回放完之后的界面该长什么样（用于人工核对，不用于自动断言）。 */
  expect: string;
}

export type SceneFrame =
  | { kind: 'snapshot'; payload: RuntimeSnapshotPayload }
  | { kind: 'delta'; epoch: string; seq: number; delta: RuntimeDelta };

const EPOCH = 'scene-epoch';
const SESSION = 'scene-session';

/** 造一串流式文本追加帧。真实流式就是这种逐块追加。 */
function streamText(id: number, chunks: string[], startSeq: number): SceneFrame[] {
  return chunks.map((content, index) => ({
    kind: 'delta' as const,
    epoch: EPOCH,
    seq: startSeq + index,
    delta: { message_appends: [{ id, type: 'text' as const, content }] },
  }));
}

/** 造一串思考块的追加帧。 */
function streamReasoning(id: number, chunks: string[], startSeq: number): SceneFrame[] {
  return chunks.map((content, index) => ({
    kind: 'delta' as const,
    epoch: EPOCH,
    seq: startSeq + index,
    delta: { message_appends: [{ id, type: 'reasoning' as const, content }] },
  }));
}

function emptySnapshot(): SceneFrame {
  return {
    kind: 'snapshot',
    payload: {
      bot_id: 'scene-bot',
      session_id: SESSION,
      epoch: EPOCH,
      seq: 0,
      current_run_view: null,
    },
  };
}

function runningSnapshot(seq: number): SceneFrame {
  return {
    kind: 'snapshot',
    payload: {
      bot_id: 'scene-bot',
      session_id: SESSION,
      epoch: EPOCH,
      seq,
      current_run_view: {
        run_id: 'scene-run',
        turn_id: 'scene-turn',
        status: 'running',
        started_at: '2026-09-13T18:00:00Z',
        updated_at: '2026-09-13T18:00:00Z',
        messages: [],
        user_turns: [],
      },
    },
  };
}

/** 让 run 停在等待决策上。这是"正在等你批准"的权威信号。 */
function waitingSnapshot(seq: number, messages: RuntimeDelta['message_upserts']): SceneFrame {
  return {
    kind: 'snapshot',
    payload: {
      bot_id: 'scene-bot',
      session_id: SESSION,
      epoch: EPOCH,
      seq,
      current_run_view: {
        run_id: 'scene-run',
        turn_id: 'scene-turn',
        status: 'waiting_decision',
        started_at: '2026-09-13T18:00:00Z',
        updated_at: '2026-09-13T18:00:10Z',
        messages: messages ?? [],
        user_turns: [],
      },
    },
  };
}

const TURN_USER = 'scene-turn';

// ---------------------------------------------------------------- 场景表

export const SCENES: Scene[] = [
  {
    id: 'chat-tools',
    title: '工具调用：执行中 / 完成 / 输出里有错误',
    intent:
      '连续工具合并为一行灰字，执行中靠行尾 spinner 表达，不靠颜色。' +
      '「输出里有错误」刻意不等于「失败」——协议层没有工具失败状态，' +
      '上游也明确说不能从一次工具调用推导任务失败（见 verified-behaviour 第 15 条）。',
    expect:
      '三个工具合成一行「执行了命令、编辑了文件」，前导工具图标、右侧一个 spinner；' +
      '无卡片、无状态词、无红色诊断；VoiceOver 保留 exec、fs_write、exec 全部工具名。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [
            {
              turn_id: TURN_USER,
              role: 'user',
              text: '把报告的图表重新生成，然后跑一遍测试',
              turn_position: 1,
            },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 3,
        delta: {
          message_upserts: [
            {
              id: 10,
              type: 'tool',
              name: 'exec',
              running: true,
              input: { command: 'pytest -q tests/reports' },
              execution_location: { kind: 'container', name: 'workspace' },
            },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 4,
        delta: {
          message_upserts: [
            {
              id: 11,
              type: 'tool',
              name: 'fs_write',
              running: false,
              input: { path: '/data/reports/chart-1.png' },
              output: 'wrote 240 KB',
            },
            {
              id: 12,
              type: 'tool',
              name: 'exec',
              running: false,
              input: { command: 'npm run build' },
              // 真实的工具输出形状：诊断藏在 output 内部（`isError` + `content[].text`），
              // 而 `running: false` 一律映射成 done——协议层没有"工具失败"这个状态。
              // 场景要照实反映这一点，否则截图会给人"服务端会给失败状态"的错觉。
              output: {
                isError: true,
                content: [{ type: 'text', text: 'Module not found: @scope/missing' }],
              },
            },
          ],
        },
      },
      // 刻意**停在这里**：一个工具还在跑，所以没有最终回复。
      //
      // 原来这个场景结尾写了一句"三个图表已重新生成；构建失败了"并把 run 置为
      // completed——那是自相矛盾的：真实的 agent 循环里最终回复要等所有工具结束，
      // 而且那句话声称生成了三个图表、实际只有一次写入调用。视觉评审把这两点
      // 都指出来了。场景要么是一次真实的"进行中"切面，要么是一次真实的"已完成"，
      // 不能为了多展示几个状态就把两个时刻拼在一起。
    ],
  },

  {
    id: 'chat-reasoning',
    title: '思考过程与正文的分层',
    intent: '思考块是次要信息，不能和正文抢注意力；长思考不能把正文挤出屏幕。',
    expect: '思考块有明显的"这是过程、不是结论"的视觉处理，且默认可折叠或折行收敛。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [
            {
              turn_id: TURN_USER,
              role: 'user',
              text: '为什么昨天那个部署脚本在 CI 上超时？',
              turn_position: 1,
            },
          ],
        },
      },
      ...streamReasoning(
        20,
        [
          '用户问的是',
          'CI 超时',
          '。我需要',
          '先看脚本',
          '里的等待逻辑',
          '，',
          '再看 CI 的',
          '超时配置',
          '。',
          '可能是',
          '轮询间隔',
          '太短',
          '导致',
          '重试',
          '次数',
          '过多',
          '，也',
          '可能是',
          '镜像拉取',
          '慢。',
          '先假设',
          '是前者',
          '，因为',
          '本地很快',
          '。',
        ],
        3,
      ),
      ...streamText(
        21,
        [
          '最可能的原因是',
          '脚本里轮询间隔',
          '只有 1 秒',
          '，CI 上',
          '镜像拉取慢',
          '导致重试',
          '把总时长',
          '推过了',
          '超时上限',
          '。',
        ],
        30,
      ),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 45,
        delta: { run: { run_id: 'scene-run', status: 'completed' } },
      },
    ],
  },

  {
    id: 'approval-with-options',
    title: '审批：agent 定义了选项',
    intent: 'agent 给的选项要**逐字呈现**——用户需要能选到"始终允许"这类作用域。',
    expect: '每个选项一个按钮，语气（允许/拒绝）可辨；工具与入参能看清。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [
            {
              turn_id: TURN_USER,
              role: 'user',
              text: '帮我把这次改动提交到 feature 分支',
              turn_position: 1,
            },
          ],
        },
      },
      waitingSnapshot(3, [
        {
          id: 30,
          type: 'tool',
          name: 'git_commit',
          running: false,
          input: {
            command: 'git commit -m "feat: 重构报告导出"',
            cwd: '/data/repo',
          },
          approval: {
            approval_id: 'scene-approval-1',
            short_id: 1,
            status: 'pending',
            can_approve: true,
            options: [
              { id: 'allow_once', name: 'Allow once', kind: 'allow_once' },
              { id: 'allow_always', name: 'Always allow git_commit', kind: 'allow_always' },
              { id: 'reject_once', name: 'Deny', kind: 'reject_once' },
            ],
          },
        },
      ]),
    ],
  },

  {
    id: 'approval-no-options',
    title: '审批：agent 没给选项（必须兜底）',
    intent:
      '实测服务端在 agent 未定义选项时**完全不返回 options 字段**。' +
      '这时必须给"批准/拒绝"兜底——否则是一个没有按钮的审批框，run 永远卡住。',
    expect: '有两个可点的动作，且不显示任何来自 agent 的选项名。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [
            { turn_id: TURN_USER, role: 'user', text: '清掉 /tmp 下的构建缓存', turn_position: 1 },
          ],
        },
      },
      // 注意：approval 里**没有 options**，这是真实形状。
      waitingSnapshot(3, [
        {
          id: 31,
          type: 'tool',
          name: 'exec',
          running: false,
          input: { command: 'rm -rf /tmp/build-cache', cwd: '/data' },
          approval: {
            approval_id: 'scene-approval-2',
            short_id: 2,
            status: 'pending',
            can_approve: true,
          },
        },
      ]),
    ],
  },

  {
    id: 'chat-error',
    title: '运行失败与内联错误',
    intent: '失败必须说清"哪一步、为什么"，并且给出可操作的下一步；不能只写"出错了"。',
    expect: '顶部有失败条并带原因；对话流里的错误块与工具失败可区分。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [
            {
              turn_id: TURN_USER,
              role: 'user',
              text: '把 config.toml 里的超时改成 30 秒',
              turn_position: 1,
            },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 3,
        delta: {
          message_upserts: [
            {
              id: 40,
              type: 'tool',
              name: 'fs_write',
              running: false,
              input: { path: '/data/config.toml' },
              output: 'permission denied',
            },
            {
              id: 41,
              type: 'error',
              content: '权限不足：目标文件在只读挂载上。',
              code: 'fs.readonly',
            },
            { id: 42, type: 'notice', content: '已回退到上一个可用配置。', name: 'rolled_back' },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 4,
        delta: {
          run: {
            run_id: 'scene-run',
            status: 'errored',
            error: '写入被拒：/data 是只读挂载',
          },
        },
      },
    ],
  },

  {
    id: 'chat-long',
    title: '长会话与滚动位置',
    intent: '用户往回翻看历史时，新内容到达不能把他拽回底部；同时要有明显的"回到底部"入口。',
    expect: '上翻后停留在原处；底部出现"回到底部"按钮；按钮不遮挡内容。',
    frames: [
      emptySnapshot(),
      ...Array.from({ length: 6 }, (_, index) => [
        {
          kind: 'delta' as const,
          epoch: EPOCH,
          seq: index * 3 + 1,
          delta: {
            user_turn_upserts: [
              {
                turn_id: `scene-turn-${index}`,
                role: 'user' as const,
                text: `第 ${index + 1} 个问题：这段流程还能再简化吗？`,
                turn_position: index * 2 + 1,
              },
            ],
          },
        },
        {
          kind: 'delta' as const,
          epoch: EPOCH,
          seq: index * 3 + 2,
          delta: {
            message_upserts: [
              {
                id: 100 + index,
                type: 'text' as const,
                content:
                  `可以。第 ${index + 1} 步里有两个重复的校验，合并成一个之后` +
                  '主流程会短一行，而且错误信息更集中。',
              },
            ],
          },
        },
        {
          kind: 'delta' as const,
          epoch: EPOCH,
          seq: index * 3 + 3,
          delta: { run: { run_id: 'scene-run', status: 'completed' as const } },
        },
      ]).flat(),
    ],
  },

  {
    id: 'chat-disconnected',
    title: '连接断开与视图过期',
    intent:
      '移动网络下断开是常态。界面必须诚实说明"你现在看到的可能不是最新的"，' + '而不是假装还连着。',
    expect: '顶部明确显示断开状态，且不把已有内容清空——用户仍能读历史。',
    frames: [
      emptySnapshot(),
      runningSnapshot(1),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          user_turn_upserts: [{ turn_id: TURN_USER, role: 'user', text: '继续', turn_position: 1 }],
        },
      },
      ...streamText(50, ['正在', '处理', '…'], 3),
      // 注意：没有终态。界面应当表现为"可能已经断了"。
    ],
  },

  {
    id: 'chat-attachments',
    title: '附件与图片',
    intent: '图片要能预览，非图片要能看清是什么文件；两者在消息流里都不可喧宾夺主。',
    expect: '图片以缩略图呈现且有合理最大尺寸；文件名可读、可点。',
    frames: [
      emptySnapshot(),
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 1,
        delta: {
          user_turn_upserts: [
            {
              turn_id: TURN_USER,
              role: 'user',
              text: '这版 UI 截图和日志都在这里了',
              turn_position: 1,
              attachments: [
                {
                  id: 'a1',
                  type: 'image',
                  name: 'screenshot.png',
                  mime: 'image/png',
                  size: 240_000,
                },
                {
                  id: 'a2',
                  type: 'file',
                  name: 'build-2026-09-13.log',
                  mime: 'text/plain',
                  size: 1_240_000,
                },
              ],
            },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 2,
        delta: {
          message_upserts: [
            {
              id: 60,
              type: 'text',
              content: '看到了。截图里输入框和键盘之间的间隙偏大，日志里是同一个原因。',
            },
          ],
        },
      },
      {
        kind: 'delta',
        epoch: EPOCH,
        seq: 3,
        delta: { run: { run_id: 'scene-run', status: 'completed' } },
      },
    ],
  },
];

export function findScene(id: string): Scene | null {
  return SCENES.find((scene) => scene.id === id) ?? null;
}
