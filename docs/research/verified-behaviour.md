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

## 9b. `simctl openurl` 在 iOS 26 上会弹系统确认框（deep link 用不了）

**不是探针，是踩坑**：想用 `memoh:///debug/scene/<id>` 深链切换验收场景，结果每张
截图都带着一个系统弹窗——**而场景压根没切过去**：

```
Open in "Memoh"?
Cancel        Open
```

它**两种情况都会弹**：App 已在前台时弹；先 `terminate` 再 openurl（冷开）照样弹。
所以这不是"先关掉 App 就行"的问题。

**为什么致命**：这个项目没有点击能力（第 8 条），弹窗没人能点，于是"用 deep link
切场景"这条路直接堵死，截图还被弹窗污染成验收垃圾。

**改用什么**：让验收脚本直接改 App 沙箱里的种子文件，App 轮询它
（`src/features/verify/seed.ts` 的 `watchVerifyScene`）。好处不只是绕过弹窗：

- 不需要冷启动——一次启动看完全部场景，省掉十几次重启；
- 切换是确定的，没有"弹窗会不会出现"这种赌博；
- 仍然走真实路由与真实组件，省掉的只是"从外部唤起"这一步。

**写入必须原子**：脚本先写临时文件再 `replace()`。App 每 600ms 读一次，直接覆写
可能让它读到半截 JSON——"半截文件"是最难查的一类间歇失败。

---

## 怎么加一条记录

1. 写一个能独立跑的小探针放 `tools/`（用 `tools/` 下的既有脚本当模板）。
2. 跑它，把**原始输出**贴进来——不要转述，转述会丢掉边界情况。
3. 写清"这改变了哪里的做法"。没有落到代码上的结论，下一轮就会忘。

## 10. 审批的 `options` 可能整个缺失

**探针**：`tools/approval-shape.mjs`

打开审批后，服务端返回的 approval 原始形状：

```json
{
  "approval_id": "38f27df8-3f1c-4e98-ac22-c5b26632aea1",
  "short_id": 1,
  "status": "pending",
  "can_approve": true
}
```

**没有 `options` 字段**——不是空数组，是根本不存在。

**含义（这条最要紧）**：客户端必须回退到"批准 / 拒绝"两个动作，否则界面上是一个
**没有按钮的审批框**，而 run 永远停在 `waiting_decision`。用户看到的是"卡住了"，
而且完全不知道为什么。

回退时**不能回传伪造的 option_id**——服务端匹配不到。用 `decision: 'approve' | 'reject'`。
官方 Web 客户端的回退逻辑在 `apps/web/src/components/tool-approval-actions.vue`：
没有 agentOptions 时给 `binary:approve` / `binary:reject` 两个动作。

## 11. 审批默认是关的

`bot.settings.tool_approval_config.enabled` 默认 `false`，且 `write.require_approval`
默认 `true` 但 `bypass_globs` 含 `/data/**` 与 `/tmp/**`（工作区路径基本都被豁免）。

**含义**：任何"顺畅对话"测试都覆盖不到审批路径。要测就必须显式打开，并且用
`force_review_commands` 把命令列进去——只设 `require_approval: true` 时，
"简单可执行文件 + 无危险特征"的命令仍可能被放行（判定顺序见
`internal/agent/decision/approval/policy.go`）。

**注意**：`PUT /bots/{id}/settings` 的 `tool_approval_config` 形状必须与 GET 返回的
完全一致（**没有 `mode` 字段**）。多传字段会让整个 PUT 被拒，而失败信息不明显——
看起来像"设置没生效"。

## 12. 模型之间在"是否真的用工具"上差异很大

**探针**：`tools/tool-compare.mjs`

同一个 bot、同一句提示（"用你的 shell 工具跑 echo …"）：

| 模型              | 结果                                    |
| ----------------- | --------------------------------------- |
| k3                | 走工具通道，真的执行了 `exec`，拿到输出 |
| deepseek-v4-flash | 回复"这个会话里没有暴露 shell/执行工具" |

**含义**：测工具链路必须挑对模型，否则测的是"这个模型不用工具"而不是"工具链路坏了"。
k3 也偶发把工具调用当**文本**吐出来（`<tool_calls><invoke name="Bash">…`），这时
正文里会出现看起来像 XML 的内容——但那不是工具调用，客户端不应该去解析它。

## 13. 上游偶发：`persistence fence is stale`

**现象**：k3 偶尔在 `admitting` 之后失败，服务端日志：

```
level=ERROR msg="agent stream error" error="twilightai: commit step 0: session runtime persistence fence is stale"
```

run 落盘为 `state=failed, error_code=agent.response_interrupted`；客户端侧表现为
"收到 run_accepted，然后 3 帧之后没下文"。

**排查过程**（都做过，都没能稳定复现）：

- 单独跑 k3：4/4 通过
- 换时序（订阅后 1.2s vs 4s 再发）：都通过
- 并发两个会话同时跑：都通过
- 但服务端日志在并发那次仍出现了一次该错误

**判定**：上游偶发，与客户端无关。`internal/runtimefence/fence.go` 的注释说明
"a newer run increments Token and permanently invalidates older fences"——`agent`
技能也会触发同一条路径。

**对客户端的要求**：不能假设 run 一定会到 `completed`。要能显示"运行失败"并允许重试。
测试里把这种情况与"真卡住"分开报（见 `tools/api-scenarios.mjs` 的 `classify()`），
否则偶发会淹掉真信号。

## 14. Web 端把 `settings` 的写入形状定义得很死

`PUT /bots/{id}/settings` 只接受与 GET 完全一致的字段集。传入多余字段（例如给
`read`/`write`/`exec` 加一个 GET 里没有的 `mode`）会让整个请求被拒，而**响应仍是 200**
且返回当前的（未改变的）配置。

**含义**：这类"200 但没生效"是最难查的一类。写 settings 的代码必须：

1. 先 GET 拿到当前形状；
2. 只改要改的字段；
3. 写完再 GET 一次确认。

`tools/approval-flow.mjs` 就是这么做的，并且会在结束时**恢复原设置**——
留下一个"每个工具都要审批"的配置会让其他验收莫名卡住。

## 15. 工具失败不是任务失败（上游的明确规则）

**来源**：上游 Web 客户端源码，`apps/web/src/pages/home/components/tool-call-inline.vue:225`。
这不是我的推断，是产品方自己写下的规则：

> 工具标题是执行过程摘要。Agent 在虚拟机中试错、检查并修复命令是正常的
> 长任务行为；非零退出码（包括 -1）或工具 isError 不等于用户任务失败。
> 标题保持中性色，不附加退出码或错误染色；诊断留在展开详情中，真正的
> 任务失败由回合级错误反馈表达，不能从某一次工具调用推导。

**协议层面**：`internal/agent/view/uimessage.go:58` 的 `UIMessage` 只有
`running *bool`，**没有** `is_error` / `status` 字段。所以"这个工具失败了"在传输层
根本不存在——只有"跑完了"和"还在跑"。

**那 Web 端怎么显示错误？** `apps/web/src/pages/home/components/tool-result-error.ts`：

```
result.isError === true || result.structuredContent.isError === true
```

即**从 output 对象内部**读，而且只在 `done` 之后。注意 `exit_code !== 0` 只被用来
显示退出码（`tool-call-detail-exec.vue`），**不当作失败**。

**落到我们的实现**：

- `toolStatusFrom` 把 `running:false` 一律映射成 `done` —— 这**是对的**，不是 bug。
- 工具行的标题**不着色**。把工具行染红会让正常试错看起来像事故，还会把真正该注意的
  回合级错误淹掉。
- 服务端明确发的 `type: 'error'` 消息块是另一回事，那个该醒目——它是回合级的错误反馈。

**一条容易搞反的**：验收场景里"工具的 output 写着构建失败"不能推断成"这个任务失败了"。
要断言任务失败，看 run 的终态（`errored`），不要看某一次工具调用的输出内容。

---

## 16. 上游会延迟 250ms 才显示"运行中"

**来源**：同上文件，`RUNNING_SHIMMER_DELAY_MS = 250`。注释写得很清楚：

> Brief tools (e.g. send/memory) finish in <100ms. Showing the running shimmer
> for them flickers, so we only display it after a short delay.

**我没有跟着做**，理由要写清楚，免得后来的人以为漏了：他们延迟的是**循环动画**
（shimmer），一个持续闪动的效果闪一下就非常显眼。我们用的是静态图标 + 文字
（"Running"/"Done"），快工具只是文字换一次，一帧的事，不值得为它引入一套
逐行的延迟计时器——那反而是抖动和状态错乱的来源。如果以后把 running 换成动画，
这条就得重新考虑。

## 17. 工具块没有失败状态，诊断只在 output 里

**协议**：`internal/agent/view/uimessage.go:58` 的 `UIMessage` 只有 `running *bool`。
没有 `is_error`、没有 `status`。所以服务端能表达的只有"跑完了"和"还在跑"。

**上游怎么判断工具出错**：`apps/web/src/pages/home/components/tool-result-error.ts`
从 output **内部**读：

```
result.isError === true || result.structuredContent.isError === true
```

错误正文从 `content[].text`（或 `structuredContent.content[].text`）取。

**明确不算失败的**：`exit_code !== 0`。上游只用它显示退出码
（`tool-call-detail-exec.vue`），不当作失败——agent 跑一个非零退出的命令是正常干活。

**这条的后果（踩到了）**：我们的工具卡片原来读 `block.error`，而协议里工具块**没有**
这个字段，所以那行永远是空的。于是"构建失败"的工具在界面上和成功的一模一样——
视觉评审直接指出「第三张卡写着 Done，下面的回复却说构建失败了」。

现在从 output 读诊断并显示，但**不给标题染色**（理由见第 15 条）。

---

## 18. 跨主机的构建/测试分布（本机不是构建机）

**不是协议，是环境约束**，但踩过就要记：

- 本机 Mac 上跑 iOS 构建会把 load 推到 165+（实测），而本机还在同时跑别的活。
- Swift **纯逻辑**测试（不依赖 UIKit 的那些）可以在构建机的 swift 容器里编译运行：
  `tools/run-logic-tests.sh`。它是 `swift-corelibs-xctest` 的标准用法，
  和 CI 行为一致；在 macOS 上用命令行跑 XCTest 反而要折腾 `libXCTestSwiftSupport`
  的运行环境，不值得。

**做得到的**：`#if !canImport(UIKit)` 那一半（数据、政策、布局计算、诊断解析）。
**做不到的**：任何 `canImport(UIKit)` 的断言（颜色映射、cell 复用、列表虚拟化）——
那些必须在 iOS hosted XCTest target 里跑，目前**尚未接入**。
不要把"纯逻辑测试通过"说成"模块测试通过"，那是两件事。
