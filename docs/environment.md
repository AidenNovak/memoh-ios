# 联调环境

这个项目的开发环境分两层：**App 跑在本机模拟器上**，**Memoh 服务端跑在 vultr-sg 上**。
两者之间用一条 SSH 隧道连接。

## 为什么这样分

- 本机（Mac mini / MacBook）只跑 Xcode 与模拟器。iOS 构建本身就已经很吃资源了，
  再叠一个 Go 服务端 + PostgreSQL + 容器运行时没有意义。
- vultr-sg 上有 Memoh 的容器运行时需要的条件（containerd、CNI、cgroup v2），
  而这些在 macOS 上要么没有、要么要靠 Docker Desktop 虚拟机绕一大圈。
- 更重要的是：**给 agent 用的开发环境必须是可复现的**。写在服务器上的脚本能被
  任何人（或任何 agent）重新跑一遍得到同样的环境；写在某台 Mac 上的不行。

## 拓扑

```
┌───────────────────────────┐         ┌────────────────────────────────────────┐
│ 本机（macOS）              │         │ vultr-sg（Linux, 31 GiB）              │
│                            │         │                                        │
│  iOS Simulator             │         │  /opt/memoh-dev/                       │
│      │                     │         │    ├── src/          我们的 fork 检出   │
│      │ http://127.0.0.1    │  SSH    │    ├── config.toml   （600，含密钥）    │
│      ▼                     │ 隧道    │    ├── secrets/      （700）           │
│  ssh -L 18080 / 18082  ────┼────────▶│    ├── ops/          运维脚本           │
│                            │         │    └── docker-compose.override.yml     │
└───────────────────────────┘         │                                        │
                                      │  memoh-dev compose project             │
                                      │   server  127.0.0.1:18080              │
                                      │   web     127.0.0.1:18082              │
                                      │   postgres / pgvector / channel         │
                                      │                                        │
                                      │  ⚠️ 与同机生产 meimaobing-alpha 完全隔离 │
                                      └────────────────────────────────────────┘
```

**隔离措施**（这台机器同时跑着生产「没猫饼」）：

| 手段                 | 说明                                                       |
| -------------------- | ---------------------------------------------------------- |
| 端口只绑 127.0.0.1   | `docker-compose.override.yml` 里覆盖了 `ports`，公网不可达 |
| 资源上限             | server 3 CPU / 3 GiB，postgres 1 GiB，其余更小             |
| 独立 compose project | `memoh-dev`，与 `meimaobing-alpha` 的容器/网络/卷完全分开  |
| 独立目录             | `/opt/memoh-dev`，不碰 `/opt/meimaobing-alpha`             |

## 一次性准备

### 1. 在 vultr-sg 上起 Memoh

```bash
# 从仓库里推上去（首次或脚本有更新时）
scp infra/vultr-sg/*.sh infra/vultr-sg/*.py vultr-sg:/opt/memoh-dev/ops/
ssh vultr-sg "chmod +x /opt/memoh-dev/ops/*.sh"

# 拉代码 + 生成配置与密钥（幂等）
ssh vultr-sg "bash /opt/memoh-dev/ops/bootstrap.sh"

# 起服务
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh up"
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh health"
```

### 2. 准备一个能对话的 bot

服务端起得来不等于能对话：还需要一个模型提供商、一个导入并**启用**的模型、
一个 bot，以及把模型设成 bot 的默认对话模型。

```bash
# provider 的 API key 只存在服务器上，不进仓库、不打印
ssh vultr-sg "cat > /opt/memoh-dev/secrets/provider.env <<'EOF'
MEMOH_DEV_PROVIDER_TEMPLATE=deepseek
MEMOH_DEV_PROVIDER_API_KEY=<在这里填 key>
EOF
chmod 600 /opt/memoh-dev/secrets/provider.env"

ssh vultr-sg "bash /opt/memoh-dev/ops/seed-dev-bot.sh"
```

脚本是幂等的。注意两个容易踩的点，脚本里已经处理：

- 导入的模型默认 **disabled**，要显式启用，否则 run 在解析阶段就失败；
- 对话模型是写在 **bot settings** 里的（`PUT /bots/{id}/settings`），不是 bot 记录上。

### 3. 本机开隧道

```bash
pnpm dev:env          # 建立 18080 / 18082 隧道
pnpm dev:env:stop     # 关掉
```

隧道建立后：

- API `http://127.0.0.1:18080`
- Web UI `http://127.0.0.1:18082`（可以直接在浏览器里对照官方前端的行为）

App 的登录页默认填的就是 `http://127.0.0.1:18080`。

## 凭据放在哪

| 位置                                            | 内容                               | 权限 |
| ----------------------------------------------- | ---------------------------------- | ---- |
| `vultr-sg:/opt/memoh-dev/secrets/memoh-dev.env` | 数据库密码、JWT secret、admin 密码 | 600  |
| `vultr-sg:/opt/memoh-dev/secrets/provider.env`  | 模型提供商的 API key               | 600  |
| `vultr-sg:/opt/memoh-dev/config.toml`           | 服务端配置（含上面几个 secret）    | 600  |
| 本机 `~/.config/memoh-ios/dev.env`              | 上面第一份的副本，供本机脚本读     | 600  |

**这些文件都不进 Git。** 仓库里的脚本只负责读写它们，从不打印内容。

## 常用运维

```bash
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh ps"          # 容器状态
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh health"      # 健康检查 + 资源占用
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh logs server" # 服务端日志
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh pull"        # 拉新镜像并重启
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh psql"        # 直连数据库
```

## 协议冒烟测试与集成测试

这是两件不同的事，别混：

| 脚本                         | 验证什么                                                                              | 用什么代码       |
| ---------------------------- | ------------------------------------------------------------------------------------- | ---------------- |
| `tools/protocol-smoke.mjs`   | **我们对协议的理解对不对**——按 iOS 客户端将要走的顺序对活服务端跑一遍                 | 脚本里另写的解析 |
| `tools/live-integration.mjs` | **我们写的那套代码对不对**——直接 import `src/api/*` 与 `src/features/chat/reducer.ts` | App 的真实源码   |

两者都需要隧道开着。改协议层之前/之后都该跑。

```bash
node tools/protocol-smoke.mjs
node tools/protocol-smoke.mjs --keep-session   # 保留测试会话便于排查
node tools/protocol-smoke.mjs --base-url http://其他地址

node tools/live-integration.mjs
node tools/live-integration.mjs --keep-session
```

`protocol-smoke` 覆盖那几条最容易理解错的结论：发消息的连接收不到正文、必须先订阅、
增量是 append 不是 upsert、`invocation_id` 幂等。

## 模拟器里的端到端验收

`chat-roundtrip` 这条 case 在模拟器里真的跑一轮对话（登录 → 会话 → 发送 → 看到回复）。
它归在 `live` 批次里，**默认不跑**——依赖外部服务端的验收不能当基线：

```bash
pnpm dev:env
pnpm verify:simulator --name 'chat roundtrip' -- zsh -euc '
  pnpm verify:ui --app "$(pnpm --silent verify:build | tail -1)" --case chat-roundtrip
'
```

它靠"启动种子"驱动（`simctl` 没有点击能力）：脚本往 App 沙箱放一个 JSON，开发构建
读它并自动执行 `apps/mobile/src/features/verify/` 里定义的动作。被验证的是真实路径，
省掉的只有"手指点屏幕"。种子文件里有密码，拷进模拟器沙箱、用完即删，不进仓库。

### 看界面长什么样：场景台

改设计之前先能**看见**现状。场景台把每种状态渲染出来截图，**不连服务端、不需要凭据**：

```bash
pnpm verify:simulator --name scenes -- zsh -euc '
  pnpm verify:build
  pnpm verify:ui --app "$(pnpm --silent verify:build)" --case scenes
'
```

8 个场景 × 2 种外观，几十秒出全部截图，落在
`apps/mobile/verification/ui/results/<run-id>/`。场景清单与内容在
`apps/mobile/src/features/verify/scenes.ts`——它是**协议帧序列**，由真实 reducer
回放后交给生产组件渲染，所以每个场景顺带就是 reducer 的集成测试。

在模拟器里手点也行：Debug → Scenes → 点进任意场景。

看图之前可以先量一遍硬数据：

```bash
python3 apps/mobile/verification/ui/tools/measure_surfaces.py <screenshot.png>
```

它报告配色占比与每种颜色的出现区间。**不能替代看图**（字号、间距、截断它看不到），
但"两种东西是不是同一个颜色"这类问题不该靠眼睛猜——用户气泡和工具卡片撞色的那个
问题（同一种灰占了整屏 49%）就是它发现的。

两个已知的观感限制，评审时别当成产品问题：

- 场景页有一条极简调试头（标题 + `#id` + `replayed n/n`）。`#id` 是验收脚本确认
  "切对了场景"的依据，删不得；但截图里它确实不是产品的一部分。
- 场景页**没有输入栏**（真实 `ChatScreen` 有）。场景只负责渲染消息流的状态。

## 生产不要照抄的地方

这套环境是**开发用**的，有意做了简化，别拿它当部署模板：

- `config.toml` 里的 admin 密码是脚本生成的随机值，但**没有配 HTTPS**，隧道里走的是明文 HTTP；
- 没有配邮件、没有配 webhook 隧道、没有开连接器 profile；
- 资源上限是按"与生产共存"设的，不是按实际负载调的。

## 真实 API 场景测试

除了"链路通不通"，还要验证**不同模型家族的真实行为差异**——思考块的有无、增量粒度、
工具调用方式、错误码形态。这些只有真打过才知道，而任何一条处理不好，用户看到的就是
"卡住"或"内容丢了"。

```bash
# 跨模型家族的对话行为（思考块、增量粒度、错误态）
node tools/api-scenarios.mjs
node tools/api-scenarios.mjs --scenario tools     # 只测工具调用
node tools/api-scenarios.mjs --list

# 同一个提示打不同模型，分辨"模型不用工具"和"工具链路坏了"
node tools/tool-compare.mjs

# 审批链路（会临时打开审批、造场景、验证、然后恢复原设置）
node tools/approval-flow.mjs

# 单模型稳定性（排除偶发）
node tools/k3-stability.mjs 4
```

### 加一个模型提供商

dev 环境里目前有两个家族（DeepSeek 走模板、Kimi 走自定义端点）。再加一个：

```bash
# spec 从 stdin 传，key 不出现在命令行与历史里
ssh vultr-sg "MEMOH_PROVIDER_SPEC=\"\$(cat)\" python3 /opt/memoh-dev/ops/add-provider.py" < spec.json
```

spec 形状见 `infra/vultr-sg/add-provider.py` 开头。脚本幂等，且**每次都会把
base_url / api_key 更新一遍**——否则复用旧 provider 时会用着上一次的凭据还以为没问题。

两个坑（脚本已处理，但知道有好处）：

- 新建的模型默认 `enable=false`，不显式启用的话 run 会说"chat model is disabled"；
- 那个错误看起来像"模型不可用"，实际是"配置没生效"。
