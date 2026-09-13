# 实测记录

`docs/research/` 里的结论大多来自读代码；这里记的是**跑起来之后才确认的事实**。
两者的区别很重要：读代码能看出"应该怎样"，跑起来才知道"实际怎样"。

每条都附可复现的探针脚本。这些脚本不是一次性的——上游协议变了，重跑它们比重读
整个 Go 实现快得多。

## 1. run 期间服务端不保证给 `user_turns`

**探针**：`tools/turn-probe.mjs`

**现象**：新建会话、订阅、发一条消息，观察 `current_run_view`：

```
[首个 snapshot] current_run_view: null
[delta 里的 current_run_view]  run status: admitting
  user_turns: null
  messages: (空)
```

**含义**：`admitting` 阶段用户轮次是 `null`，权威内容要等 REST 历史。任何"看到
invocation_id 匹配就把本地乐观消息删掉"的实现，都会在屏幕上把用户提问弄丢。

**落到代码**：`hasServerTurn()` 的判据是 `run.user_turns?.length > 0`，不是
`run.invocation_id === invocationId`。

## 2. 助手回复与用户消息在 REST 历史里是**两条独立轮次**

**探针**：同上

```
[REST 历史] 2 轮:
  role=user      pos=1 text="Say exactly: beta" msgs=
  role=assistant pos=1 text=""                   msgs=reasoning+text
```

**含义**：
- 两条轮次的 `turn_position` **都是 1**，所以不能靠 position 区分先后，要靠数组顺序。
- 渲染时不应指望"一轮里同时有 user 和 assistant"——列表给的是两条。
- 助手轮次的内容在 `messages[]` 里，用户轮次的内容在 `text` 字段里。两种形状。

## 3. `/sessions/{id}/status` 不含运行状态

**探针**：`tools/status-probe.mjs`

```
keys: message_count, context_usage, cache_stats, skills
{"message_count":4,"context_usage":{"used_tokens":1869},"cache_stats":{...},"skills":[]}
```

**含义**：想知道"这个会话是不是在等我批准"，`/status` 帮不上忙。唯一权威来源是
runtime snapshot 的 `current_run_view.status === 'waiting_decision'`——也就是必须订阅。

## 4. `/sessions/events`（SSE）不含决策状态

**探针**：`tools/sse-probe.mjs`

跑一轮真实对话期间采集，全部事件只有：

```
类型: ping, session_touched
```

**含义**：这个流只告诉你"某个会话被碰到过"，不告诉你它在等什么。跨 bot 的待审批
聚合因此必须靠订阅 runtime（见 `src/features/activity/useSessionActivity.ts`）。

## 5. WebSocket 接受 `Authorization` header

**探针**：`tools/protocol-smoke.mjs` 的第 4 步，以及原始握手：

```
$ curl -i -H "Upgrade: websocket" -H "Connection: Upgrade" \
       -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
       -H "Sec-WebSocket-Version: 13" \
       -H "Authorization: Bearer $TOKEN" \
       http://127.0.0.1:18080/bots/$BOT/web/ws
HTTP/1.1 101 Switching Protocols
```

**含义**：原生客户端走 header（`?token=` 是给浏览器的妥协）。Node 内置的 WebSocket
不支持自定义 header，所以集成测试注入 `ws` 包——跑的仍是同一份源码。

## 6. 流式正文只在 `runtime_delta` 里，且按 id 追加

**探针**：`tools/protocol-smoke.mjs`

```
delta seq=10 reasoning#0:"The"
delta seq=11 reasoning#0:" user"
delta seq=24 text#1:"hello"
delta seq=29 reasoning#0 | text#1 run=completed
```

**含义**：文本与思考各自按 `id` 独立累加（这里是 `0` 和 `1` 两个 id）。把它当整块
upsert 处理，长回复会每帧重排整块。

## 7. 模型导入后默认是 disabled

**不是探针，是踩坑**：`POST /providers/{id}/import-models` 导入的模型 `enable=false`，
不显式启用的话 run 会在解析阶段失败：

```
ERROR: resolve: chat model deepseek-v4-flash is disabled
```

另外 `PUT /models/{id}` 只传 `enable` 会被校验拒绝——`model_id` / `provider_id` /
`type` 都是必填。已固化在 `infra/vultr-sg/seed-dev-bot.sh` 里。

对话模型写在 **bot settings**（`PUT /bots/{id}/settings`）而不是 bot 记录上；不设的话
报 `chat model not configured`。

## 8. `simctl` 没有点击能力

**不是探针，是约束**：`xcrun simctl` 只能 launch / terminate / screenshot / recordVideo，
不能 tap。要在模拟器里驱动真实交互，只有三条路：

1. 引入 XCUITest / Appium / Maestro —— 一整套重型依赖；
2. 未公开的 `simctl` 子命令 —— 不可靠；
3. **启动种子**：App 读沙箱里的一个 JSON，自动执行一段固定动作。

本项目选 3（`src/features/verify/`），因为它验证的仍是真实路径——真实网络、真实
协议、真实 reducer、真实渲染——省掉的只有"手指点屏幕"。种子只在 `__DEV__` 下生效。

## 9. 钥匙串凭据跨安装存活

**不是探针，是踩坑**：重装 App **不会**清掉 Keychain。于是"期望看到登录页"的验收
在第二次跑的时候直接进了主界面，看起来像 App 坏了。现在每个 case 开头都
`xcrun simctl keychain reset`。

---

## 怎么加一条记录

1. 写一个能独立跑的小探针放 `tools/`（用 `tools/` 下的既有脚本当模板）。
2. 跑它，把**原始输出**贴进来——不要转述，转述会丢掉边界情况。
3. 写清"这改变了哪里的做法"。没有落到代码上的结论，下一轮就会忘。
