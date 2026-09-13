# Memoh API 调研（面向 iOS 原生客户端）

> 读者：实现 iOS 客户端的工程师。
> 依据：`/Users/lijixiang/projects/reference/memoh` 只读副本（HEAD `c2bc823`）、`spec/swagger.json`（swagger 2.0，254 路径）。
> 凡结论都尽量落到 `文件:行号`；从 swagger 摘要猜的东西会明确标注。
> 标注 **【未验证】** 的条目 = 我读了代码但没跑起来实测，或者证据只够支撑"很可能如此"。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| App 实时通道 | **WebSocket `/bots/{bot_id}/web/ws`**，不是 SSE。聊天内容、审批、中断全走它 |
| 鉴权 | `POST /auth/login` → HS256 JWT，默认 168h，**无 refresh token**，`/auth/refresh` 只能拿未过期 token 续期 |
| 存 token | Keychain。禁止 localStorage/cookie 那套（那是 Web 的） |
| API key | **没有**通用 API key / PAT；`/users/me/runtimes` 的 key 只对 Remote Runtime 反向 RPC 管道有效，不能当 API token |
| OAuth / device flow | **没有**面向 Memoh 账号的。仓库里唯一的 device flow 是 Codex CLI 登录（`/bots/{bot_id}/agents/{id}/codex/login/device/*`），与本 App 登录无关 |
| 关键坑 1 | 发消息的连接**不会**直接收到文本流；必须先 `runtime_subscribe` 订阅该会话，否则只有 `run_accepted` 和错误帧 |
| 关键坑 2 | 服务端 WS **没有心跳/ping**，移动网络下 NAT 超时会静默断连，客户端必须自己保活 + 重连 + 靠 snapshot 恢复 |
| 关键坑 3 | `?token=` query 只保留给浏览器（WebSocket 不能设 header）。原生 App **应当**用 `Authorization` header |
| 关键坑 4 | `GET /container/fs/list` 的 JSON key 是 **camelCase**（`modTime`/`isDir`），全仓其余是 snake_case |
| 关键坑 5 | 除公开 webhook 外**没有请求体大小限制**，`fs/read` 会把整个文件读进内存再 JSON 化 |
| SDK | `@memohai/sdk` 是纯 fetch 生成的 TS，**无 Node 内建依赖**；唯一 RN 不友好处是 SSE helper（`ReadableStream` + `TextDecoderStream`）。REST 部分大概率能直接用于 RN |
| 官方移动端 | **没有原生 App 计划**。唯一相关文档是 `docs/design/web-mobile-shell/PLAN.md`——那是 **Web 响应式**（Vue 断点分叉），不是原生客户端 |

---

## 1. 认证

### 1.1 登录

`POST /auth/login`，body `{username, password}`（`internal/handlers/auth.go:25-33`）。该路径**跳过 JWT 中间件**（`internal/server/server.go:102-104`）。

响应（`internal/handlers/auth.go:35-43`）：

```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_at": "2026-09-20T10:00:00Z",
  "user_id": "uuid",
  "role": "admin",
  "display_name": "Aiden",
  "username": "admin",
  "timezone": "Asia/Shanghai"
}
```

注意：`user_id` / `role` / `display_name` / `timezone` 是登录独有的便利字段，`/auth/refresh` **不返回**这些（`internal/handlers/auth.go:103-107` 只有 `access_token`/`token_type`/`expires_at`）。App 应在登录时把 profile 落盘，别指望 refresh 能拿到。

### 1.2 Token 形态与有效期

- 算法 **HS256**，`TokenLookup: "header:Authorization:Bearer ,query:token"`（`internal/auth/jwt.go:33-42`）。
- Claims 只有 `sub` / `user_id` / `iat` / `exp`（`internal/auth/jwt.go:110-115`）；**没有 scope/role 声明**，权限每次请求由服务端查库（`internal/bots` 的 `ResolveUserPermissions`）。
- 默认有效期 **168h = 7 天**（`conf/app.docker.toml:38-41`、`conf/app.example.toml:64-65`、`conf/app.apple.toml:33-34` 全是 `168h`）。配置文件可改。
- 中间件每次请求还会做一次**服务端会话校验**（`UserSessionValidator`，`internal/auth/jwt.go:43-65`）——账号被停用/删除会立刻 401，即使 token 未过期。App 必须把 401 当作"回登录页"信号，不能只按 exp 判断。

### 1.3 续期：没有 refresh token

`POST /auth/refresh` 需要**带当前有效 Bearer**，服务端从 context 里取出旧 claims 复制一份、只换 `iat`/`exp`（`internal/auth/jwt.go:199-236`、`internal/handlers/auth.go:107-122`）。

含义：

- 只要还有效，续期是**无限期**的（每次续 168h）。
- **一旦过期就只能重新登录**——没有 refresh token 可以救。
- App 策略建议：进入前台时若 `expires_at - now < 84h` 就静默 refresh 一次；任意请求收到 401 一律清 Keychain 回登录页。这与 Web 端 `apps/web/src/lib/api-client.ts:80-94, 114-118` 的处理一致（Web 就是 401 → 清 localStorage → 通知上层）。

### 1.4 存哪里（原生 App）

Web 端把 token 放 `localStorage.token` 并作为 `Authorization: Bearer` 发出（`apps/web/src/lib/api-client.ts:120-147`），WebSocket 因为不能设 header 而改用 query（`apps/web/src/lib/api-client.ts:18-26` + `apps/web/src/composables/api/useChat.ws.ts:131-137`）。

**这是浏览器限制，不是服务端要求。** 服务端同时接受 header 和 query（`internal/auth/jwt.go:37`）。iOS 侧应当：

- token 存 **Keychain**（`kSecAttrAccessibleAfterFirstUnlock`），不要 UserDefaults；
- 所有 HTTP 走 `Authorization: Bearer <jwt>`；
- WebSocket 也用 header（`URLRequest.setValue("Bearer …", forHTTPHeaderField: "Authorization")`）——服务端升级前全局中间件就已校验（`internal/server/server.go:81-83`），不依赖 query。

> 顺带：`CheckOrigin: func(_ *http.Request) bool { return true }`（`internal/handlers/local_channel.go:911-913`），原生客户端无 Origin 也能连。

### 1.5 `/users/me`

`GET /users/me` → `accounts.Account`（`internal/handlers/users.go:125-138`，结构见 `internal/accounts/types.go:8-26`）：

```json
{
  "id": "uuid", "username": "admin", "email": "admin@memoh.local",
  "role": "admin", "display_name": "Admin", "avatar_url": "",
  "timezone": "Asia/Shanghai", "is_active": true,
  "principal_is_active": true, "membership_is_active": true,
  "metadata": {}, "created_at": "...", "updated_at": "...",
  "joined_at": "...", "membership_updated_at": "...", "last_login_at": "...",
  "title_model_id": ""
}
```

另有 `PUT /users/me`（改 profile）、`PUT /users/me/password`（改密码）。

### 1.6 有没有更适合 App 的方式？

- **OAuth / OIDC / device flow：没有。** 仓库里所有 `oauth` 路径都是第三方集成的（MCP server OAuth、provider OAuth、email OAuth），不是 Memoh 账号的登录方式。swagger 里 `securityDefinitions` 是空的，唯一公开鉴权入口就是 `/auth/login`（`conf/app.example.toml` 的 `[auth]` 段也只有 `jwt_secret` / `jwt_expires_in`）。
  唯一的 device flow 是 `POST /bots/{bot_id}/agents/{id}/codex/login/device/{authorize,poll,cancel}` —— 那是给 Codex CLI 登录用的，与客户端登录无关。
- **API key：没有通用的。** `POST /users/me/runtimes` 会签发一个 token，但它的用途被限定得很死：`internal/handlers/user_runtime.go:12-13` 注释明确写 "only manages the long-lived credential used by the reverse-RPC WebSocket"，认证入口是 `/runtimes/connect`（`internal/handlers/runtime_connect.go:47-60`），走 `memoh.runtime.v1.grpc` 子协议。**不能拿来当 REST 的 Bearer**。
- **结论：login + Keychain + 401 兜底就是现阶段唯一的正路。** 若产品需要"免密码多设备"，那要先给上游提需求（issue），不要自己造。

### 1.7 本地开发的默认凭据

`conf/app.example.toml:56-60` / `conf/app.docker.toml`：`admin` / `admin123`。**必须在部署时改掉**（`DEPLOYMENT.md` 的 Security Warnings 也这么写）。

---

## 2. 会话与实时通道

### 2.1 五个端点是什么关系

路由注册在 `internal/handlers/local_channel.go:162-169`（`prefix = /bots/:bot_id/<channelType>`，channelType 对 Web 是 `web`）和 `internal/handlers/message.go:121-133`。

| 端点 | 协议 | 用途 | App 该不该用 |
|---|---|---|---|
| `GET /bots/{bot_id}/web/ws` | WebSocket | **双向**：发消息、中断、审批、`runtime_subscribe`，也是唯一回传聊天内容的通道 | ✅ **核心通道** |
| `GET /bots/{bot_id}/web/stream` | SSE | 只读的**本地 channel 出站事件流**（`channel.StreamEvent`），属于旧的 channel 抽象 | ❌ 不用 |
| `POST /bots/{bot_id}/web/messages` | HTTP | 旧的一次性发消息入口。**服务端主动拒绝 slash 控制输入**（`internal/handlers/local_channel.go:853-862` 返回 `CodeUnsupportedLegacyEndpoint`） | ❌ 不用 |
| `GET /bots/{bot_id}/sessions/events` | SSE | **bot 级会话活动流**：`session_touched` / `session_title_changed` / `session_created` / `session_compaction` / `dropped` / `ping`。**不含消息体** | ✅ 可选，用于会话列表实时排序 |
| `GET /bots/{bot_id}/sessions/{session_id}/status` | HTTP | 会话上下文用量/缓存命中/技能列表（**不是**运行状态） | ✅ 按需 |

关于 `/web/stream` 和 `/web/messages` 的判定依据：当前 Web 前端**完全没有调用它们**——`grep` 全仓 `apps/web/src` 与 `apps/desktop/src` 只有 SSE 的 `sessions/events` 和 WS 的 `web/ws` 被使用（`apps/web/src/store/chat/realtime.ts:1-14`、`apps/web/src/composables/api/useChat.message-api.ts:158`）。SDK 里虽然生成了 `getBotsByBotIdWebStream` / `postBotsByBotIdWebMessages`（`packages/sdk/src/sdk.gen.ts:1812, 1825`），但它们是历史遗留。**iOS 不要碰**。

`/sessions/events` 的心跳与重连语义（`internal/handlers/message_stream.go`）：

- 心跳 **20s** 一次，发 `{"type":"ping"}`，且每次心跳会**重发** `session_compaction`（`internal/handlers/message_stream.go:27`、`:100-109`）——注释说这是为了在 subscriber buffer 溢出后自我修复。
- 缓冲溢出不阻塞生产者，而是丢事件并**在下一帧前**发 `{"type":"dropped","count":N}`（`internal/chat/event/hub.go:52-74`、`internal/handlers/message_stream.go:114-124`）。客户端应把它当成"视图已过期，去 REST 拉一次"。
- 鉴权只在建连时做一次（注释承认 revoke 要靠代理 ~30s 重连窗口才生效，`internal/handlers/message_stream.go:69-72`）。

### 2.2 WebSocket 协议（这是 App 的主战场）

#### 连接

```
GET /bots/{bot_id}/web/ws HTTP/1.1
Upgrade: websocket
Authorization: Bearer <jwt>
```

权限门：需要 `workspace_exec` **或** `manage`（`internal/handlers/local_channel.go:2697-2699` 的 `canOpenLocalWebSocket`，调用点 `:1815`）。注意 —— 只有 `chat` 权限的用户**连不上这个 socket**。这是 iOS 端必须在 UI 上处理的现实（"只有 chat 权限"的成员看不到实时流，只能拉 REST 历史）。

【未验证】没有实测过仅 `chat` 权限的账号是否真会被 403；逻辑上 `canOpenLocalWebSocket` 只认 `workspace_exec`/`manage`。

全部帧都是 **text frame**（`internal/handlers/local_channel.go:1176-1182` 用 `websocket.TextMessage`），内容是 JSON。

#### 客户端 → 服务端（`wsClientMessage`，`internal/handlers/local_channel.go:933-975`）

`type` 取值与必填字段：

| type | 必填 | 可选 |
|---|---|---|
| `message` | `invocation_id` | `session_id`（空则自动建会话）、`text`、`attachments`、`requested_skills`、`model_id`、`reasoning_effort`、`workspace_target_id`、`composer_scope` |
| `retry_message` | `invocation_id`, `session_id`, `turn_id` | `model_id`, `reasoning_effort`, `workspace_target_id`（`message_id` 是 `turn_id` 的废弃别名） |
| `edit_message` | `invocation_id`, `session_id`, `turn_id` | `text`, `attachments`, + 同上 |
| `abort` | `run_id`, `session_id`, `control_id` | —— |
| `tool_approval_response` | `run_id`, `session_id`, `decision_id`, `control_id` | `decision`(`approve`/`reject`)、`option_id`、`reason` |
| `user_input_response` | `run_id`, `session_id`, `decision_id`, `control_id` | `answers`, `canceled`, `reason` |
| `runtime_subscribe` | `session_id` | `cursor` `{epoch, seq}` |
| `runtime_unsubscribe` | `session_id` | —— |

三个 id 的语义（源码注释 `internal/handlers/local_channel.go:915-932`，值得原样搬到 iOS 注释里）：

- `invocation_id`：**客户端生成**，代表"意图"，是启动一轮的幂等键。重发同一个 invocation 不会产生第二轮，会拿到 `duplicate: true` 的 `run_accepted`。
- `run_id`：**服务端生成**，代表"一次执行"。只有它是 `abort` / 决策响应的寻址方式。
- `turn_id`：**服务端在执行准入时生成**，代表"一轮对话"。`retry`/`edit` 用它。

`control_id` 是控制类请求（abort/审批/回答）的幂等键（`:963-969`）。

#### 服务端 → 客户端（`wsOutboundEvent`，`internal/handlers/local_channel.go:977-1007`）

```
run_accepted            ← 每个 run 的第一个事件，唯一引入 run_id 的地方
run_rejected            ← 提交不会成为 run（带稳定 code，客户端据此决定能否原样重试）
session_created         ← 无 session_id 首发时，服务端建好会话后告知
model_preference_settled← (model, effort) 落定
error                   ← 带 run_id/invocation_id/session_id, code, message
control_ack             ← abort/审批/回答的结果 {control, control_id, applied, code}
command_result / command_error  ← slash 命令结果
runtime_snapshot / runtime_delta / runtime_dropped  ← 会话投影（订阅后才来）
```

字段定义：`internal/handlers/local_channel.go:977-1007`。`applied: false` + `code: ""` 表示"控制被处理了但什么都没改变（run 已结束）"，**这与 "code 非空"（请求根本没到达 owner，值得重试）是两件事**（`:1330-1335` 注释）。

`run_accepted` 结构（`internal/handlers/local_channel.go:1304-1315`）：

```json
{ "type":"run_accepted", "run_id":"…", "invocation_id":"…", "session_id":"…",
  "turn_id":"…", "epoch":"…", "seq":42, "duplicate":false }
```

#### ⚠️ 最关键的机制：发消息的连接收不到正文

`forwardWSStreamEvents`（`internal/handlers/local_channel.go:1406-1460`）的循环体**只做两件事**：把事件喂给 session runtime（`HandleAgentEvent`），以及当事件是 error 时给本连接发一帧 `error`。**文本/思考/工具增量不直接写给发送方 socket。**

正文的送达路径是 `runtime_delta`，而它只发给**订阅了该 session 的连接**（`internal/handlers/runtime_ws.go:276-345`，实现见 `:287`）。

所以 iOS 客户端的正确顺序是：

1. 连 WS（每个 bot 一条即可）。
2. 进入某会话 → 立刻 `{"type":"runtime_subscribe","session_id":"…"}`（重连时带上已知 `cursor`）。
3. 收到 `runtime_snapshot` 才是"第一次拿到权威状态"。
4. 之后才 `message` 发消息。

Web 端就是这么做的：`apps/web/src/store/chat/runtime-client.ts:46-72` 在订阅时带 cursor，`onConnected` 时全部重订阅（`:208-214`）。

**cursor 语义（重要，别照抄直觉）**：源码明确写——cursor 被接受并回报，但**不用来续传**。"live projection 背后没有持久事件日志，对任何 cursor 唯一诚实的回答就是当前权威 snapshot + 后续真实 delta；在客户端位置和现在之间合成增量等于伪造历史。"（`internal/handlers/runtime_ws.go:276-287`）客户端发现 snapshot 比自己的 cursor 新，就丢弃本地状态重建。

#### 运行状态机

`internal/agent/runtime/session/types.go:22-32`：

```
admitting → running → waiting_decision → running → finishing → completed
                    ↘ aborting → aborted
                    ↘ errored / lost
```

`waiting_decision` 是"run 还活着，但原生执行停在了一个持久的审批/提问决策上"（`:24-26`）。**这就是 iOS 上"正在等待你批准"的权威信号**，比在 UI 层看 tool block 的 `approval.status` 更可靠。

#### 事件序号与恢复（`RuntimeDelta` / `Snapshot`）

帧外层（`internal/handlers/runtime_ws.go:211-222`）：

```json
{ "type":"runtime_snapshot", "session_id":"…", "epoch":"e1", "seq":42,
  "snapshot": { … } }
{ "type":"runtime_delta",    "session_id":"…", "epoch":"e1", "seq":43,
  "delta": { … } }
{ "type":"runtime_dropped",  "session_id":"…", "epoch":"e1", "seq":43,
  "message":"runtime subscription gap" }
```

`epoch` + `seq` 是**一对**：epoch 变了 seq 从 0 重来（backend 丢状态会换 epoch），跨 epoch 比较 seq 没有意义（`internal/agent/runtime/session/types.go:237-248`）。

客户端必须实现的校验（照抄 `apps/web/src/store/chat/runtime-client.ts:157-206` 的逻辑）：

- `event.epoch != 本地 epoch` → 重订阅（要 snapshot）
- `event.seq <= 本地 seq` → 丢弃（重复帧）
- `event.seq != 本地 seq + 1` → **有空洞**，重订阅要 snapshot
- 收到 `runtime_dropped` → 重订阅

`RuntimeDelta` 的字段（`internal/agent/runtime/session/types.go:336-346`）：

```json
{
  "current_run_view": { …整个 run 的视图，仅在需要时… },
  "run": { "run_id":"…", "status":"running", "error_code":"", "error":"",
           "updated_at":"…", "owner_lease_expires_at":"…" },
  "user_turn_upserts":   [ …UITurn… ],
  "steer_turn_upserts":  [ …SteerTurnView… ],
  "steer_turn_removals": [ "item_id" ],
  "message_appends":     [ { "id":3, "type":"text", "content":"Hello" } ],
  "progress_appends":    [ { "id":5, "progress":{…}, "input":{…} } ],
  "message_upserts":     [ …UIMessage… ],
  "reset_messages":      false
}
```

增量语义由 `internal/agent/runtime/session/state.go:13-47` 决定：

| agent 事件 | 投影 |
|---|---|
| `text_delta` / `reasoning_delta` | `message_appends`（**按 id 追加内容**，不是整块替换） |
| `tool_call_progress` | `progress_appends` |
| `agent_end` / `agent_abort` / `error` | `message_upserts`（整块） |
| `retry` | `reset_messages: true` |
| 其余（含 `tool_call_start/end`、审批） | `message_upserts`（整块） |

**这是 iOS 渲染的核心性能契约**：流式文本走 append，`type` 只有 `text`/`reasoning`（`internal/agent/runtime/session/types.go:357-361` 的 `RuntimeMessageAppend`）。别把它当 upsert 处理，否则每帧重排整块。

`Snapshot`（`internal/agent/runtime/session/types.go:220-227`）与 `CurrentRunView`（`:254-291`）：

```json
{
  "bot_id":"…", "session_id":"…", "epoch":"e1", "seq":42, "updated_at":"…",
  "current_run_view": {
    "run_id":"…", "turn_id":"…", "invocation_id":"…", "generation":"…",
    "status":"waiting_decision", "owner_id":"…", "owner_lease_expires_at":"…",
    "started_at":"…", "updated_at":"…",
    "messages": [ …UIMessage… ],
    "user_turns": [ …UITurn… ],
    "steer_supported": true,
    "steer_turns": [ { "item_id":"…", "status":"claimed", "text":"…",
                       "turn_id":"…", "after_message_id":4, "timestamp":"…" } ],
    "error_code":"", "error": "",
    "proposed_terminal_status":"", "finish_proposed_at":null,
    "operation": { "kind":"retry", "replace_from_message_id":"…",
                   "replacement_user_turn": {…} }
  }
}
```

`current_run_view` 缺失 = 该会话当前没有活跃 run。

#### 心跳 / 重连 / 保活

**服务端不发 ping、不设 read limit、不设 read deadline。**

证据：`internal/handlers/local_channel.go:1802-1875` 的连接循环只有 `conn.ReadMessage()` + 分发，没有 `SetPingHandler`/`WriteControl`；`grep SetReadLimit` 全仓只命中 `internal/handlers/runtime_connect.go:168`（那是另一个独立端点）。`wsWriter.loop`（`:1167-1183`）也只写 text message。

后果与对策（iOS 侧）：

- NAT / 运营商在无数据时通常 30s–5min 断 HTTP 长连（**不发送任何 TCP close**）。iOS 会收到 `URLSessionWebSocketTask` 的错误，但可能延迟很久。
- **必须在客户端自己发应用层心跳**。可选方案：(a) 定时发 `runtime_subscribe`（幂等，服务端会替换旧订阅，`internal/handlers/runtime_ws.go:276-280`）；(b) 直接发 WebSocket ping frame（服务端 gorilla 默认会自动回 pong——**但注意**：处理 ping 需要连接在读循环里，ok，这条路可行）；(c) 发一个自带幂等语义的 `runtime_unsubscribe`。
  推荐 (a)：订阅是幂等的、服务端会重发 snapshot，既能保活又能顺带纠正状态。间隔建议 25–45s。
- 断连后：重连 → 重订阅所有活跃会话（带 cursor）→ 收到 snapshot 后重建。run 在服务端**不会**因为 socket 断开而停止（`internal/handlers/runtime_ws.go:354-355` 注释、`internal/handlers/local_channel.go:1815`），这跟 Web 端一致。
- 代理超时参考：仓库 nginx 对普通路径 `proxy_read_timeout 300s`，对 SSE 路径单独放宽到 1h（`docker/nginx-app.conf:38-39, 55-62`）。**WS 走的是 `/api/bots/.../web/ws`，落在普通 location，300s。** 所以 45s 心跳是必要的。

---

## 3. 会话列表与历史消息（REST）

### 3.1 会话

- `GET /bots/{bot_id}/sessions?limit&cursor&types&parent_session_id&workdir_id`（`internal/handlers/session.go:138-147`）
  - 响应 `{"items":[Thread…], "next_cursor":"…"}`（`internal/handlers/session.go:640-645`）
  - 默认 `limit=50`，上限 `200`（`:648-651`）
  - `next_cursor` 为空 = 到底了，不要再去请求空页
  - 默认只列 user-facing 类型（chat/discuss + 标记可见的 schedule）（`parseSessionTypesParam`，`internal/handlers/session.go:680`）
  - 有 `manage` 权限看到 bot 全部会话；否则只能看到自己创建的（`:594-611`）
- `GET /bots/{bot_id}/sessions/{session_id}` → 单会话
- `POST /bots/{bot_id}/sessions` → 建会话（`createSessionRequest`，`internal/handlers/session.go:149-172`）
- `PATCH /bots/{bot_id}/sessions/{session_id}` → 改标题/模型偏好
- `POST /bots/{bot_id}/sessions/{session_id}/fork`
- `GET /bots/{bot_id}/sessions/model-preference-seed` → 新会话输入器该预填的 (model, effort)

App 通常**不需要**显式建会话：WS 发 `message` 时 `session_id` 留空，服务端会建好并回 `session_created`（`internal/handlers/local_channel.go:2246`）。这与 Web 的"无会话时直接发首条消息"一致。

### 3.2 模型 / 思考强度选择

- 模型目录：`GET /models`（全量），`GET /providers`（`apps/web/src/composables/useAgentModelCatalog.ts:96-110`）。
- 会话的 (model, effort) 是**一对**，写 `preferred_chat_model_id` + `preferred_reasoning_effort`。
- 思考强度允许值（`internal/reasoning/vocabulary.go:20-33`）：
  `minimal` | `low` | `medium` | `high` | `xhigh` | `max`，外加 `disable` 表示关闭。
  但**具体模型能选哪些要以该模型声明的列表为准**——`internal/reasoning/vocabulary.go:2-7` 的注释明确说"选择器展示的"和"实际发上线的"必须同源，且模型可以只支持 `minimal/high` 之类。iOS 端应从模型元数据里读可选项，不要硬编码全集。
- `PATCH /sessions/{id}` 改这一对是 **compare-and-set**：必须带 `expected_model_preference_revision`（`internal/handlers/session.go:183-189`）。iOS 若不做模型切换 UI，可以完全忽略这条。

发送时的 (model, effort) 走 WS `message` 的 `model_id` / `reasoning_effort` 字段（`internal/handlers/local_channel.go:2374-2375` 赋值给 `ChatRequest.Model/ReasoningEffort`）。首次发消息建会话时会做一次 reconcile，非法的 effort 会被规整（`createWSChatSession`，`internal/handlers/local_channel.go:2606`）。

### 3.3 历史消息

`GET /bots/{bot_id}/messages?session_id=…&limit=…&before=…&before_message_id=…`（`internal/handlers/message.go:177-240`）

```json
{ "items": [ /* UITurn[]，见 §5 */ ] }
```

- `limit` 默认 30，上限 100（`internal/handlers/message.go:168`、`:194-199`）。
- 分页游标两种：`before`（RFC3339 或 epoch millis，见 `parseBeforeParam` :581-596）或 `before_message_id`（uuid）。
- **服务端会把页首向前延伸到 turn 边界**，最多 200 行（`extendToUITurnHead`，`:604-669`）。所以返回条数可能多于 `limit`——App 不要用 "返回数 < limit 就是到底" 来判断结束，要用返回的 `turn_id` 去重 + 自己在本地判断。
- 没有 `has_more` 字段。判断到底只能靠"返回空"或"最老的那条就是会话第一条"。
- **消息按 turn 聚合，不是按条**：`items` 是 `UITurn[]`，assistant 的一个 turn 里含多个 block。
- `GET /bots/{bot_id}/messages/locate?session_id=&external_message_id=&before=&after=` → 定位到某条外部消息附近的窗口（`:292-339`），用于跳转/搜索定位。

### 3.4 会话状态（`/status`）

`GET /bots/{bot_id}/sessions/{session_id}/status`（`internal/handlers/session_info.go:45, 96-140`）：

```json
{
  "message_count": 128,
  "context_usage": { "used_tokens": 34210, "context_window": 200000,
                     "breakdown": […], "tool_defs": […], "budget_plan": {…},
                     "compaction": { "enabled": true, "auto_tokens": 160000 } },
  "cache_stats": { "cache_read_tokens": 1000, "total_input_tokens": 5000,
                   "cache_hit_rate": 0.2 },
  "skills": ["…"]
}
```

**这不是"正在生成/已停止"**——那是 `RuntimeCurrentRunView.status` 的事。别混。

### 3.5 队列与 steer（发消息协议的一部分）

`internal/handlers/session_queue.go:38-51` 注册了：

| 端点 | 含义 |
|---|---|
| `GET /sessions/{id}/queue` | 一次拿全：`{steer_supported, steer:[…], follow_up:[…]}`（`:372-386`） |
| `POST /sessions/{id}/steer-queue` | 把一段文字**插进正在跑的 run**，在下一个 step 边界生效 |
| `POST /sessions/{id}/follow-up-queue` | 把一段文字排到**当前 run 结束后**作为新一轮 |
| `POST /sessions/{id}/follow-up-queue/{item_id}/steer` | 把排队的 follow-up 提升为 steer |
| `PATCH/DELETE .../{item_id}` | 编辑/取消 |
| `PUT .../reorder` | 重排（body 是 `{item:{item_id}, before:{item_id}}`） |

两者入参都是 `{invocation_id, text}`（`:53-56`），`invocation_id` 同样是幂等键。错误码映射在 `queueAdmissionError`（`:174-193`）：`queue_steer_unsupported`（该 run 不支持 steer）、`queue_no_active_run`、`queue_capacity_exceeded` 等。

WS 侧的等价能力：发 `text = "/steer <内容>"` 或 `/queue <内容>`（`internal/handlers/local_channel.go:670-712` 的 `executeWSQueueCommand`），会先 REST 入队再回 `command_result{kind:"queue_accepted"}`。

`steer_supported` 是**能力标志，只在确实装了 step-boundary consumer 时才为 true**（`internal/agent/runtime/session/types.go:280-282`）。iOS 应先读 `/queue` 的 `steer_supported`，false 就不要给用户 steer 入口。

UI 表达建议：`FollowUpItem.Status`（`internal/handlers/session_queue.go:67-73` 的 `QueueStatus`）+ `SteerTurnView.status`（`claimed` = 已领取还没落地，`applied` = 已写入历史）。

---

## 4. 工具批准

### 4.1 请求长什么样

批准请求不是一个独立对象，它**挂在 tool block 上**（`UIToolApproval`，`internal/agent/view/uimessage.go:94-110`）：

```json
{
  "id": 7,
  "type": "tool",
  "name": "Bash",
  "tool_call_id": "toolu_01…",
  "input": { "command": "rm -rf build" },
  "running": false,
  "approval": {
    "approval_id": "9f1c…",          // 提交决定时用这个
    "short_id": 3,                    // 终端风格里给用户看的短号
    "status": "pending",              // pending / approved / rejected / expired / …
    "decision_reason": "",
    "can_approve": true,              // 服务端算好的"你现在能不能批"
    "options": [
      { "id": "allow_once",   "name": "Allow once",    "kind": "allow_once" },
      { "id": "allow_always", "name": "Always allow",  "kind": "allow_always" },
      { "id": "reject_once",  "name": "Reject",        "kind": "reject_once" }
    ],
    "selected_option_id": ""
  }
}
```

来源：流的 `tool_approval_request` 事件（`internal/agent/view/uimessage_stream.go:170-216`），或历史读取时由 `mergeToolApprovals` 补挂（`internal/handlers/message.go:482-523`）。

### 4.2 App 需要展示/使用的字段

| 字段 | 用途 |
|---|---|
| `name` + `input` | 用户真正要看的东西（要执行什么命令、改哪个文件） |
| `approval.approval_id` | 提交决定的主键 |
| `approval.options[]` | **一个 option 一个按钮**，按 `id` 回传。`kind` 是 `allow_once`/`allow_always`/`reject_once`/`reject_always`——iOS 可以直接用它选图标/文案（`apps/web/src/composables/api/useChat.types.ts:222-226` 的 TS 类型里带这四个枚举） |
| `approval.status` | `pending` 才显示可操作按钮 |
| `approval.can_approve` | 服务端权限判定，false 时按钮应禁用+给理由 |
| `approval.selected_option_id` | 已选过的项，回显用 |
| `approval.short_id` | 与终端输出对照（可选） |

**`options` 是 agent 自己的权限选项，原样透传**（源码注释 `internal/agent/view/uimessage_stream.go:208-210`："没有它们，实时卡片只能给二元的答案，用户永远选不到 agent 的 session/always 作用域"）。**iOS 必须渲染 options，不要只做 approve/reject 两个按钮**——否则 ACP/Claude Code 那类需要选作用域的 agent 会卡住。

### 4.3 提交决定

两条路，任选一条：

**A. REST**（简单，但要知道 `run_id` 才能走 WS；REST 不需要）

```
POST /bots/{bot_id}/tool-approvals/{approval_id}/approve
POST /bots/{bot_id}/tool-approvals/{approval_id}/reject
Body(可选): { "control_id": "…", "option_id": "allow_once", "reason": "" }
→ 200 { "status": "approve" | "reject" }
```

（`internal/handlers/tool_approval.go:53-57, 93-121`）

**B. WebSocket**（与流在同一连接，推荐）

```json
{ "type":"tool_approval_response", "run_id":"…", "session_id":"…",
  "decision_id":"<approval_id>", "control_id":"<客户端生成 uuid>",
  "decision":"approve", "option_id":"allow_once" }
```

`decision_id` 就是 `approval_id`（`internal/handlers/local_channel.go:1917-1929` 显式 `ApprovalID: decisionID, ExplicitID: decisionID`）。

**回执**：`{"type":"control_ack","session_id":"…","run_id":"…","control":"tool_approval_response","control_id":"…","applied":true,"code":""}`（`sendWSControlAck`，`:1337-1347`；调用点 `:1935-1947`）。

错误码映射（`internal/handlers/tool_approval.go:123-145`）：
`ErrForbidden`→`tool_approval_forbidden`、`ErrNotFound`→`not_found`、`ErrAlreadyDecided`→`tool_approval_expired`（**已决定 = 过期**，不是一个独立分支）、`ErrAmbiguous`→ambiguous、`ErrOptionUnavailable`→`request_invalid`。

**幂等**：同一个 `control_id` 重发返回首次结果；用同一个 `control_id` 发**不同**的决定会返回 `request_invalid`（`ErrCommandPayloadConflict`，`:138-141`）。

### 4.4 时序

1. run 进入 `waiting_decision`（`internal/agent/runtime/session/types.go:24-26`；由 `pendingDecisionEvent` 判定，`internal/agent/runtime/session/state.go:53-61`）
2. delta 里出现带 `approval.status == "pending"` 的 tool block
3. 用户操作 → 提交 → `control_ack.applied == true`
4. 下一个 `runtime_delta` 会 upsert 同一个 tool block，`approval.status` 变成 `approved`/`rejected`，run 状态回到 `running`
5. 如果 agent 提供了选项，第 3 步必须带 `option_id`，否则会话可能在同一处再次 pending

`user_input_response` 是同样的机制，用于 agent 主动提问（`ask_user`），字段换成 `answers: [{question_id, option_ids[], custom_text, text, skipped}]`（TS 侧 `WSUserInputAnswer`，`apps/web/src/composables/api/useChat.ws.ts:10-16`）。iOS 若只做批准不做提问，遇到它会卡住——**至少要能渲染并回答**，否则 `waiting_decision` 会永久挂住。这一点建议列入 MVP 之外但尽快补。

---

## 5. 消息内容模型（iOS 渲染的核心契约）

一条消息 = 一个 `UITurn`；assistant turn 里是 `messages: UIMessage[]`（block 列表）。

### 5.1 UITurn

`internal/agent/view/uimessage.go:121-145`。

```json
{
  "turn_id": "uuid",
  "turn_position": 17,
  "role": "user",              // user | assistant | system
  "kind": "",
  "text": "帮我看看这个文件",
  "user_message_kind": "",     // 非空表示这是技能激活等特殊用户消息
  "attachments": [ …UIAttachment… ],
  "reply": { "message_id":"…", "sender":"…", "preview":"…" },
  "forward": { … },
  "timestamp": "2026-09-13T10:00:00Z",
  "platform": "web",
  "sender_display_name": "Aiden",
  "sender_user_id": "uuid",
  "id": "uuid"
}
```

assistant turn：

```json
{
  "turn_id": "uuid", "turn_position": 18, "role": "assistant",
  "messages": [ …UIMessage… ],
  "timestamp": "2026-09-13T10:00:05Z"
}
```

`turn_position` 是准入时预留的**不可变**顺序号，客户端应该用它排序（源码注释 `:124-126`：永远不要从文本或时间戳推导顺序）。**REST 历史里有，实时路径里要从 `run_accepted`/`current_run_view` 学。**

`role: "system"` + `kind: "background_task"` 是后台任务的生命周期通知 turn（TS 类型 `UISystemTurn`，`apps/web/src/composables/api/useChat.types.ts:322-330`）。

### 5.2 UIMessage 的六种 block

`internal/agent/view/uimessage.go:11-24` 定义了**只有 6 种** `type`：

| type | 含义 | 关键字段 |
|---|---|---|
| `text` | 助手正文 | `content` |
| `reasoning` | 思考过程 | `content`, `reasoning_timing.duration_ms` |
| `tool` | 工具调用 | `name`, `input`, `output`, `tool_call_id`, `running`, `progress[]`, `approval`, `user_input`, `execution_location`, `background_task` |
| `attachments` | 附件块 | `attachments[]` |
| `error` | 错误 | `code`, `content`, `args` |
| `notice` | 运行时降级提示 | `name`（机器码）, `content`（人话）, `args` |

**注意没有"文件改动"专有 type。** 文件改动是通过 `tool` block 的 `execution_location` + `input`/`output` 表达的；图片/音视频走 `attachments`。如果设计稿里有"文件改动卡片"，它得从 tool 的 input/output 里推导，或者用 `notice` 的 `name` + `args`。

共同字段（`internal/agent/view/uimessage.go:57-80`）：

```json
{ "id": 3, "type": "text", "content": "…", "name": "", "input": null,
  "output": null, "tool_call_id": "", "running": null, "progress": null,
  "approval": null, "execution_location": null, "user_input": null,
  "attachments": null, "background_task": null, "reasoning_timing": null,
  "code": "", "args": null }
```

**`id` 是 block 在一条 assistant turn 内的序号（int），不是全局 id。** 客户端按 `id` 排序和 upsert（源码注释 `internal/agent/view/uimessage_stream.go:338-345`）：工具块按 `tool_call_id` 匹配，text/reasoning 按位置匹配。

### 5.3 一个 assistant turn 的完整示例

```json
{
  "turn_id": "6b0f…", "turn_position": 18, "role": "assistant",
  "timestamp": "2026-09-13T10:00:05Z",
  "messages": [
    { "id": 0, "type": "reasoning",
      "content": "用户想让我看 a.md，先读一下。",
      "reasoning_timing": { "duration_ms": 1840 } },

    { "id": 1, "type": "text", "content": "我先读一下这个文件。" },

    { "id": 2, "type": "tool", "name": "Read", "tool_call_id": "toolu_01",
      "input": { "path": "/workspace/a.md" },
      "output": { "content": "# 标题\n…" },
      "running": false,
      "execution_location": { "kind": "workspace", "name": "primary" } },

    { "id": 3, "type": "tool", "name": "Bash", "tool_call_id": "toolu_02",
      "input": { "command": "git status" },
      "running": false,
      "approval": {
        "approval_id": "3f9a…", "short_id": 4, "status": "pending",
        "can_approve": true,
        "options": [
          { "id":"allow_once",   "name":"Allow once",   "kind":"allow_once" },
          { "id":"allow_always", "name":"Always allow", "kind":"allow_always" },
          { "id":"reject_once",  "name":"Reject",       "kind":"reject_once" }
        ]
      } },

    { "id": 4, "type": "attachments",
      "attachments": [
        { "type": "image", "name": "chart.png", "mime": "image/png",
          "size": 20480, "content_hash": "sha256:…", "bot_id": "uuid" }
      ] },

    { "id": 5, "type": "notice", "name": "workspace_dependency_missing",
      "content": "缺少依赖 ffmpeg，无法继续。",
      "args": { "dep_id": "ffmpeg", "install_task_id": "…" } },

    { "id": 6, "type": "error", "code": "provider_rate_limited",
      "content": "上游限流，请稍后重试。",
      "args": { "retry_after_seconds": "30" } }
  ]
}
```

（上面这个 `messages` 数组是把 6 种 type 都摆出来示意；真实一条 turn 只会出现其中若干种。）

### 5.4 附件的取用

`UIAttachment`（`internal/agent/view/uimessage.go:26-40`）：

```json
{ "id":"", "type":"image", "path":"", "url":"", "base64":"",
  "name":"chart.png", "content_hash":"sha256:…", "bot_id":"uuid",
  "mime":"image/png", "size":20480, "storage_key":"", "metadata":{} }
```

- `type` 归一化规则：显式 kind 优先，否则按 mime 前缀 → `image`/`audio`/`video`/`file`（`normalizeUIAttachmentType`，`internal/agent/view/uimessage.go:195-211`）。
- 服务端会**把出站附件落库并改写成 `content_hash` 引用**（`wsIngestAttachments`，`internal/handlers/local_channel.go:2806-2850`）。所以实时流里 `base64` 可能被替换成 `content_hash`。
- 取文件：`GET /bots/{bot_id}/media/{content_hash}`（`internal/handlers/message.go:804-845`，`Cache-Control: private, max-age=86400`，`Content-Type` 用 asset 的 mime）。**带鉴权**，所以 iOS 不能把它直接喂给 `AsyncImage(url:)`——需要自己带 header 下载成 Data。
- 实时路径下图片会**先闪一下再消失**的历史 bug 是被 `ConvertTerminalMessages` 的 ID 复用逻辑修掉的（`internal/agent/view/uimessage_stream.go:336-345` 的注释）。客户端只要按 `id` upsert 就不会重现——**不要按 type 重建整个列表**。

### 5.5 后台任务

`UIBackgroundTask`（`internal/agent/view/uimessage.go:147-161`）挂在 tool block 的 `background_task` 上：`{task_id, status, command, agent_id, agent_session_id, output_file, exit_code, duration, output_tail, stream, chunk, stalled}`。

`status` 可能是 `queued` / `running` / `stalled` / 终态。判定逻辑见 `backgroundTaskFromToolResult`（`internal/agent/view/uimessage_convert.go:1348-1379`）——注意**只有 `background_started`/`auto_backgrounded`/`started`/`queued` 这些 marker 才算"后台交接"**，普通的查询类 tool 结果是终态的。

---

## 6. 工作区文件

路由：`internal/handlers/containerd.go:327-337`。全部需要 `workspace_read`（写操作需要 `workspace_write`），但 `fs/download` 对媒体路径降级为 guest 权限（`internal/handlers/filemanager.go:463-470`）。

| 端点 | 方法 | 说明 |
|---|---|---|
| `/container/fs` | GET | stat；`?path=`，默认 `/` |
| `/container/fs/list` | GET | 列目录 |
| `/container/fs/read` | GET | **按文本读**，返回 JSON string |
| `/container/fs/download` | GET | 二进制流；path 是目录则自动打 tar.gz |
| `/container/fs/upload` | POST | multipart：`path` + `file` |
| `/container/fs/write` | POST | 写文本，`expectedRevision` 做乐观锁 |
| `/container/fs/{mkdir,delete,rename,archive,extract}` | POST | 常规操作 |

### 6.1 ⚠️ `fs/list` 的 JSON 是 camelCase

```json
{ "path": "/workspace",
  "entries": [
    { "name": "a.md", "path": "/workspace/a.md", "size": 1024,
      "mode": "-rw-r--r--", "modTime": "2026-09-13T10:00:00Z", "isDir": false }
  ] }
```

（`FSFileInfo`，`internal/handlers/filemanager.go:28-35`）

**`modTime` / `isDir` 是全仓唯一的 camelCase。** iOS 的 `Codable` 要么给这两个字段单独写 `CodingKeys`，要么整体配 `convertFromSnakeCase` 后给这两个加例外。这种不一致极容易在实现期被当成"服务端 bug"，其实是既定契约。

`path` 会被服务端 `path.Clean` 归一化（`resolveContainerPath`，`:102-111`），拒绝 `..`。返回的 `entries[].path` 是拼出来的绝对路径，客户端可以直接用（不要再自己拼）。

### 6.2 ⚠️ `fs/read` 的硬伤

```json
{ "path":"/workspace/a.md", "content":"…", "size":1024, "revision":"sha256:…" }
```

（`FSReadResponse`，`internal/handlers/filemanager.go:42-47`）

- 实现是 `io.ReadAll(rc)` 后 `string(data)`（`internal/handlers/filemanager.go:431-441`）——**没有任何大小限制**。读一个 500MB 的日志会把服务端内存打爆，也会把 iOS 端 JSON 解析压垮。
- `string(data)` 对二进制是**有损**的：Go 的 `json.Marshal` 会把非法 UTF-8 字节替换成 U+FFFD。所以 PNG/zip 走 `read` 会拿到垃圾。
- 全局 `BodyLimit` 1M 只作用于 `/channels/*/webhook/*`（`internal/server/server.go:53-57` + `shouldLimitPublicRequestBody` `:155-157`），**护不到这里**。

**iOS 侧纪律**：
- `read` 只用于**文本且已知较小**的文件，先看 `list` 里的 `size` 再决定，超过阈值（建议 256KB–1MB）就别调。
- 二进制一律走 `download`，且要能流式落盘（不要 `Data(contentsOf:)`）。
- 大文本预览自己分页，不要依赖服务端。

### 6.3 `download`

- 目录 → 返回 `application/gzip`，`Content-Disposition: attachment; filename="…tar.gz"`（`internal/handlers/filemanager.go:490-494`）。
- 文件 → 原始字节流。
- 服务端不设大小上限；超时/断流由代理和客户端处理（nginx 普通路径 300s，`docker/nginx-app.conf:38-39`）。

### 6.4 上传

multipart `path` + `file`（`FSUpload`，`:721-768`）。**HTTP 层没有大小限制**，但受 `workspace_write` 权限门控。iOS 建议自己做体积上限（比如 50MB）并在 UI 上给进度。

---

## 7. 本地开发与联调

### 7.1 最短路径：Docker Compose

`DEPLOYMENT.md` 顶部就是官方流程：

```bash
git clone --recurse-submodules https://github.com/felinics/Memoh.git
cd Memoh
cp conf/app.docker.toml config.toml
nano config.toml         # 改 admin.password、auth.jwt_secret、postgres.password
docker compose up -d
# Web UI: http://localhost:8082
# API:    http://localhost:8080
```

**必须创建 `config.toml`**，`docker-compose.yml` 会挂载它（`docker-compose.yml` 的 `migrate`/`server`/`channel` 服务都 `- ${MEMOH_CONFIG:-./config.toml}:/app/config.toml:ro`），没有它起不来。默认账号 `admin` / `admin123`（`conf/app.docker.toml:26-30`）。

`server` 容器是 `privileged: true` + `pid: host`（`docker-compose.yml:59-62`）——它内嵌 containerd 来跑 bot 的 workspace 容器。**这会占据宿主机的容器运行时**，别在已经有生产 Docker 的机器上裸跑。开发建议用一台专门的机器或 VM。

Web 容器监听 `8082`（`docker-compose.yml:208-218`），nignx 里 `/api/` 反代到 `server:8080`。

### 7.2 mise 任务（开发模式）

- `mise run dev` → `scripts/dev-compose.sh devenv/docker-compose.yml`（`mise.toml:90-93`），用 `devenv/` 那套（带热重载）。
- `mise run db-up` / `db-down` → 只起数据库（`mise.toml:256-263`）。
- `mise run dev:logs` / `dev:restart -- server`（`mise.toml:216-232`）。
- `mise run desktop:dev` / `desktop:build:mac:arm64` 等（`mise.toml:403-448`）。

### 7.3 最小配置

跑一个 App 能连的服务端，`config.toml` 至少要有：

```toml
[auth]
jwt_secret = "<openssl rand -base64 32>"
jwt_expires_in = "168h"

[admin]
username = "admin"
password = "<改掉>"

[database]
driver = "postgres"

[container]
backend = "containerd"      # compose 部署只能用这个
default_image = "memohai/workspace:debian-latest"
```

（模板见 `conf/app.docker.toml`，`[container]` 的取值约束在 `:41-52` 的注释里：在 Compose 里改成 `docker` 需要额外的宿主 bind mount 和 docker socket。）

### 7.4 关于 HTTPS —— iOS 特有

**仓库里的 compose 默认只有 HTTP。** `web` 服务只暴露 `8082`，8443 那段是注释掉的（`docker-compose.yml:213-217`），注释还说得很明白："HTTPS + HTTP/2：h2 多路复用可避免多标签页的 SSE 长连接占满浏览器对单 origin 的 ~6 条 HTTP/1.1 连接（#822）"。

对 iOS 影响：

- iOS 的 **App Transport Security 默认禁止明文 HTTP**。连 `http://192.168.x.x:8080` 需要在 `Info.plist` 加 `NSAppTransportSecurity` 例外（`NSAllowsLocalNetworking` 或针对域名的 `NSExceptionAllowsInsecureHTTPLoads`）。
- 开发机推荐用 **mkcert / 自签证书 + 反向代理**（仓库也提供了 `docker/nginx-https.conf`、`docker/nginx-enable-https.sh`，注释说 mkcert 自签也接受）。自签证书在 iOS 上还要装描述文件并信任，比较烦；**用 Cloudflare Tunnel / ngrok 这类给真证书的隧道反而更省事**（仓库甚至内置了 `dev:webhook-tunnel` 任务和 cloudflared 配置，`conf/app.example.toml:45-55`）。
- **WebSocket 也受 ATS 管**：`ws://` 和 `wss://` 同样要过 ATS。

### 7.5 Web 端怎么配后端地址

`apps/web/src/lib/api-client.ts:158-171`：

```ts
const apiBaseUrl = options.baseUrl?.trim()
  || import.meta.env.VITE_API_URL?.trim()
  || '/api'                        // 默认
const agentBaseUrl = import.meta.env.VITE_AGENT_URL?.trim() || '/agent'  // 声明了但未使用
client.setConfig({ baseUrl: apiBaseUrl, fetch: createApiFetch(options.fetch) })
```

- 两个环境变量：**`VITE_API_URL`**（在使用）和 **`VITE_AGENT_URL`**（声明了但代码里 `void agentBaseUrl`，是死的）。
- 仓库里**没有 `.env` 文件**（`apps/web` 下无 env 文件）；默认走相对路径 `/api`，由 nginx 反代。
- 授权头注入在 `installAuthRequestInterceptor`（`:149-152`），401 处理在 `:80-118`。
- WebSocket / SSE 的 URL 是**从 baseUrl 推导**的：`sdkWebSocketUrl` 把 `http`→`ws`、`https`→`wss`（`:60-64`），并在 query 上挂 `?token=`（因为浏览器 WS 不能设 header）。
- 桌面壳（Electron）会传一个 `baseUrl` 指向本机 server（注释 `:40-47`）。

**对 iOS 的启示**：地址应该是用户可配的（自托管产品必然如此），至少要有"服务器地址 + 登录"两步。可以学 `lody-ios` 那套（如果它有）；Memoh 这边没有现成约定，需要自己定。

---

## 8. 风险与坑

### 8.1 浏览器耦合的部分（iOS 必须绕开或替代）

| 位置 | 耦合点 | iOS 对策 |
|---|---|---|
| WS 鉴权 | Web 用 `?token=`（`apps/web/src/lib/api-client.ts:18-26`） | 用 `Authorization` header，服务端原生支持（`internal/auth/jwt.go:37`） |
| token 存储 | Web 用 `localStorage` + `window.location`（`api-client.ts:36-38`） | Keychain |
| 所有 SSE | `sessions/events`、`web/stream` 靠 `EventSource`/`ReadableStream` | 只需实现 `sessions/events`；用 `URLSession` 的 bytes stream 或干脆轮询 REST 兜底 |
| **WebRTC 桌面串流** | `POST /container/display/webrtc/offer`（`internal/handlers/display.go:135`），body `{type, sdp, session_id?, candidate_host?}`，返回 `{type, sdp, session_id}` | **协议本身是标准 SDP offer/answer，iOS 可以用 WebRTC.framework 接。** 但这是 P2P 到 bot 容器的方案，涉及 ICE/网络穿透，工程量大。**建议 MVP 直接砍掉**，只做"看状态"（`GET /container/display` 返回 `enabled/available/running/transport/encoder` 等，`displayInfoResponse` `internal/handlers/display.go:25-38`） |
| 容器终端 | `GET /container/terminal/ws`（WebSocket） | 协议是 JSON 控制帧 + 数据帧（`internal/handlers/containerd_terminal.go:29-33`），**没有浏览器耦合**，iOS 可以接。但需要 `workspace_exec` 权限，30 分钟空闲超时（`:19-21`） |
| CORS | `AllowOrigins: ["*"]`（`internal/server/server.go:58-63`） | 原生 App 无 CORS，忽略即可。**注意 `AllowHeaders` 白名单里没有自定义头**（只有 Origin/Content-Type/Accept/Authorization/X-Request-ID），所以别指望在 Web 上带自定义头 |
| `/web/*` 命名 | `web` 是 channelType 的取值（`prefix = /bots/:bot_id/<channelType>`，`internal/handlers/local_channel.go:163-164`） | 名字里有 web，但**协议与浏览器无关**。别被名字误导 |

### 8.2 速率限制

**服务端没有任何应用层限流。** `grep ratelimit/throttle` 在 `internal/` 下只命中 Codex 协议生成的类型定义（那是 Codex 上游的限额模型，不是 Memoh 自己的）。nginx 配置里也没有 `limit_req`/`limit_conn`（`docker/nginx.conf`、`docker/nginx-app.conf`）。

这意味着：

- 好处：iOS 可以放心重连、重订阅。
- 坏处：**没有服务端保护，客户端 bug 会直接打穿到 LLM 上游**（比如重连风暴导致重复 run）。所以 `invocation_id` 的幂等性必须真的用对——它是唯一防线（`internal/handlers/local_channel.go:915-922` 注释："redelivered send resolves to the run it already started instead of a second one"）。
- 反向风险：自托管用户可能在前面挂了自己的 WAF/限流，**不要给客户端设计"无限重试"**。

### 8.3 其它已知雷区

1. **`chat` 权限进不了 WS**（`canOpenLocalWebSocket`，`internal/handlers/local_channel.go:2697-2699`，调用点 `:1815`）。低权限成员只能读 REST 历史，看不到流式输出。UI 要能优雅降级。
2. **WS 无心跳**（§2.2 末尾）。移动网络下这是最高频的线上故障源。
3. **`steer_supported` 可能为 false**（`internal/agent/runtime/session/types.go:280-282`）。别把 steer 当必有能力。
4. **`run_rejected` 与 `error` 的区别**：`run_rejected` 是"这次提交不会变成 run"（带稳定 code，客户端可决定是否原样重试）；`error` 是运行期错误（`internal/handlers/local_channel.go:1317-1328` 注释）。分开处理。
5. **`control_ack.applied=false` + `code=""` ≠ 失败**（§2.2）。
6. **attachment 超 200MB 会静默丢持久化**：`ingestSingleAttachment` 失败只 log warn，然后把**未落库的原始 base64** 留在实时事件里（`internal/handlers/local_channel.go:3012-3018` 的注释明说这种情况"在实时轮里能看到、刷新后从历史里消失"）。上限是 `MaxAssetBytes = 200 * 1024 * 1024`（`internal/media/limits.go:10-11`）。iOS 上传前自己限体积。
7. **`/messages` 返回行数可超过 `limit`**（§3.3），分页逻辑要按 turn 去重，不能按行数判断结束。
8. **slash 命令走 WS，不走 REST**：`/web/messages` 遇到非普通聊天输入会直接返回 `command_error{code: unsupported_legacy_endpoint}`（`internal/handlers/local_channel.go:853-862`）。如果 iOS 输入框允许用户打 `/steer`、`/queue`、`/help`，必须走 WS。
9. **`/container/fs/list` 的 camelCase**（§6.1）。
10. **`fs/read` 无上限 + 二进制有损**（§6.2）。

### 8.4 官方有没有移动端计划？

**没有原生移动端的计划。** 全仓 grep `mobile|ios|android|react native` 的结果里：

- 唯一实质内容是 `docs/design/web-mobile-shell/PLAN.md`。读完之后结论很明确：那是**给 `apps/web` 做响应式移动壳**的方案——`useIsMobile()` 断点分叉、dockview 单 group 约束、Sheet 导航、iOS 键盘遮挡。文中的"Phone"，指的是浏览器里的 768px 断点，不是 App。
- 那份 PLAN 的 "明确不做" 清单里还写了 "PWA"（`:124`），说明官方对移动的态度就是"先把 Web 在手机上能用"。
- 没有任何 iOS/Android 工程目录；`apps/` 下只有 `web` 和 `desktop`（Electron）。
- 没有找到 issue tracker 的本地镜像，无法核对上游是否有人在讨论 mobile。**【未验证】**：`docs/` 与 README 里没有出现 "mobile app" 的路线图条目。

对我们有利的一点：那份 PLAN 里对移动端体验的关键结论（比如 `h-dvh` 不随 iOS 键盘收缩、`visualViewport` 全仓无处理、消息操作条 hover-only）反过来印证了"**Web 壳在手机上体验先天不足**"，也就是我们做原生客户端的产品理由。

---

## 9. 附：`apps/desktop` 与 `packages/sdk`（架构选择的关键）

### 9.1 `apps/desktop` = Electron，不是 Tauri

- `apps/desktop/package.json` 的 deps：`electron@^42`、`electron-vite`、`electron-builder`、`electron-updater`、`@electron-toolkit/*`。`description` 直接写 "Memoh Electron desktop application (self-managed bootstrap reusing @memohai/web components)"。
- 它**复用 Web 的 Vue 组件**（devDeps 里有 `@memohai/web: workspace:*`），只是加了一层 Electron 主进程/预加载/自动更新。
- 仓库根有 `Cargo.toml` + `crates/a11y-cli`，**与桌面端无关**（是个无障碍 CLI）。

**结论：桌面端没有任何可复用到 iOS 的东西。** 它证明的只有一件事——"Memoh 的官方客户端只有浏览器引擎这一条路"，Web 技术栈被吃得很深（dockview 多面板、xterm、WebRTC、shiki 高亮）。

### 9.2 `packages/sdk` 能给 React Native 用吗？

`packages/sdk` = `@memohai/sdk`，由 `@hey-api/openapi-ts` 从 `spec/swagger.json` 生成（`openapi-ts.config.ts`），`package.json` 里 `exports` 直接指向 **TS 源码**（`"./client": "./src/client.gen.ts"`），没有构建产物。

**好消息：**

- **零 Node 内建依赖。** `grep 'node:'|process.env|Buffer'` 在整个 `packages/sdk/src/` 里零命中（只有 `parseAs: 'arrayBuffer'` 这种字符串字面量）。
- 基于 `globalThis.fetch`（`packages/sdk/src/client.gen.ts` 通过 `createClient(createConfig())`），RN 有 fetch。
- 只依赖 `@pinia/colada` 作为**可选** peer（`peerDependenciesMeta` 里标了 optional）。不 import `@memohai/sdk/colada` 就不会拉进来。
- 254 个路径全部生成好了类型（`types.gen.ts`），**对 iOS 的价值主要是"当类型字典"**——即使不用它的运行时代码，也可以参考它来核对字段名和枚举。

**坏消息（只有一个，但是致命的那个）：**

- SSE helper 用了 `response.body.pipeThrough(new TextDecoderStream()).getReader()`（`packages/sdk/src/core/serverSentEvents.gen.ts:139`）。RN 的 fetch **没有 Web 标准的 `ReadableStream`**（更别说 `TextDecoderStream`），这一行在 Hermes 上会直接抛。
- 只有两个端点走 SSE：`/bots/{bot_id}/sessions/events` 和 `/bots/{bot_id}/web/stream`（`grep '\.sse\.get' packages/sdk/src/sdk.gen.ts` 正好两条）。**其余全部是普通 fetch**。
- 【未验证】`exports` 指向 `.ts` 源文件这个做法在 Metro 下能否顺利解析（Metro 默认能转译 TS，理论上 OK，但 exports-map + `workspace:*` 的组合没实测）。

**建议（架构层面）：**

1. **不要**把 `@memohai/sdk` 当运行时依赖塞进 RN。它是一个"为浏览器 + pnpm workspace 优化的生成产物"，把它拖进 Expo 会带来打包/解析的长期摩擦。
2. **要**把 `packages/sdk/src/types.gen.ts` 当作**契约字典**：可以用脚本把它转成 Swift 的 `Codable` 结构体，或者手写时逐字段核对。文档 §5 的 block 模型和 §2 的事件模型都以 Go 源码为准，`types.gen.ts` 是第三份交叉验证。
3. **WS 和 SSE 自己用 Swift 实现**（`URLSessionWebSocketTask` + 手写 SSE 解析）。这部分本来就不能靠 SDK，而且 §2.2 提到的心跳/重连/cursor 校验是 iOS 侧必须自己控制的。
4. 也可以考虑**在 CI 里跑 `mise run sdk-generate`**，用生成的 TS 作为对比基准，写一个脚本 diff 出"服务端契约变了哪些字段"，再同步到 Swift。这比人工盯 OpenAPI 靠谱。

**关于 Expo：** `ws`（Node WS 库）是 `packages/runtime` 的依赖，不是 `packages/sdk` 的——**不会**被 sdk 拉进来。`packages/runtime`（`@memohai/runtime`）是给桌面端做 Remote Runtime 的 Node SDK（依赖 `@grpc/grpc-js` + `ws`），**跟 iOS 完全无关，不要碰**。

---

## 10. MVP 映射与未验证项

### 10.1 需求 → 接口对照

| MVP 能力 | 接口 |
|---|---|
| 登录 | `POST /auth/login`（存 Keychain） |
| bot 列表 | `GET /bots`（`internal/handlers/users.go:100`，响应 `{items:[Bot]}`，`internal/bots/types.go:9-27, 76-78`，含 `current_user_permissions` 用来做 UI 门控） |
| 会话列表 | `GET /bots/{bot_id}/sessions` + SSE `/sessions/events` |
| 历史消息 | `GET /bots/{bot_id}/messages?session_id=` |
| 发消息 + 流式 | WS：`runtime_subscribe` → `message` |
| 停止生成 | WS `abort`（需要 `run_id` + `control_id`） |
| 工具批准 | WS `tool_approval_response`（或 REST approve/reject） |
| token 用量 | `GET /bots/{bot_id}/token-usage?from=&to=`（**`from`/`to` 必填**，`YYYY-MM-DD`，`to` 排他；响应 `{chat, discuss, acp_agent, schedule, by_model}`，`internal/handlers/token_usage.go:61-68, 119-134`）+ `GET /bots/{bot_id}/token-usage/records` |
| 工作区文件 | `GET /container/fs/list` / `fs/read` / `fs/download` |

`GET /bots` 的权限模型：非 admin 只能看到自己可访问的 bot（`ListAccessible`，`internal/handlers/users.go:679-686`），`owner_id` 过滤要 admin。

### 10.2 明确未验证 / 未测的项

1. 【未验证】没有真机/真服务端跑过任何一条协议。本文所有结论来自 Go 源码、TS 源码和 OpenAPI 定义，**没有端到端实测**。
2. 【未验证】仅 `chat` 权限的账号连 WS 是否真的 403（代码逻辑如此，未实测）。
3. 【未验证】`@memohai/sdk` 的 TS-source `exports` 在 Metro 下能否解析（我没有搭 Expo 工程验证）。
4. 【未验证】WebRTC display offer/answer 在 iOS `WebRTC.framework` 上的互通性（协议是标准 SDP，但没有实际 ICE 协商过）。
5. 【未验证】没有核对上游 GitHub issues 里是否有人在推进移动端 —— 本地副本没有 issue 镜像。
6. 【未验证】`sessions/events` SSE 在 iOS `URLSession` 下的分帧行为（服务端每帧是 `data: {...}\n\n`，`internal/handlers/message.go:137-151`，无 `event:` 字段、无 `id:`、无 `retry:`，所以是极简 SSE；实现难度低，但没实测）。
7. 未深读：`internal/agent/runtime/acp/*`（ACP/Claude Code/Codex 这类外部 runtime 在会话模型上与 native 的差异）、`internal/memory/*`、`internal/schedule/*`。如果 iOS 后续要做记忆管理或定时任务，需要单独调研。

### 10.3 给实现者的一句话

**这个 API 是"为 Vue SPA 设计、恰好能用原生接"的形态**：REST 部分干净，WS 部分是真正的核心且必须手写（订阅语义 + 幂等 + cursor 恢复 + 客户端心跳），而最麻烦的桌面串流/终端/多面板在移动端本来就该砍。**先做 WS + REST 的最小闭环，把 `runtime_delta` 的增量语义吃透，其它都是外围。**
