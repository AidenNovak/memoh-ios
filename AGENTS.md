# Memoh iOS

- 这是一个 **iOS-only** 客户端，pnpm workspace + Expo Router + React Native，加一个本地 Expo Swift 模块。
- 所有一方原生能力与原生 UI 都住在 `apps/mobile/modules/memoh-kit`。通过 `MemohKitModule` 注册；不要新建第二个 bridge 包。RN 达不到 UI 要求时就用 Swift/UIKit 或 SwiftUI 实现，**而不是用 RN 去模仿一个系统效果**。
- 不要添加 Android 实现、fallback stub 或 Android 构建脚本。
- `apps/mobile/ios` 是 Expo prebuild 生成的产物，且被 gitignore。改动只能落在 app config、本地 config plugin、或 MemohKit，**永远不要只改生成物**。
- 保持正常的 Xcode 签名开启，包括模拟器校验。不要用 `CODE_SIGNING_ALLOWED=NO`。
- 凭据走 Keychain（通过 MemohKit）。**绝不**把 token、密码、会话内容或私有服务配置复制进仓库。
- 不要向上游 `felinics/Memoh` 提交任何东西；需要服务端改动时走我们的 fork `AidenNovak/Memoh`，并在 `docs/upstream-deviations.md` 记录原因。
- 保留用户的改动。破坏性 revert/restore/rollback 之前先看工作树并取得明确确认。
- 改原生代码后用 `pnpm check`、`pnpm bundle`，并在模拟器上构建。优先**行为校验**而不是实现快照。
- 不要嵌套三元表达式。一个 `cond ? a : b` 可以；任一分支里再有 `?` 就不行。封闭集合用字典映射，有序或重叠条件用 `if` / `switch`。可选链和 `??` 不算三元。

## 分层

- 路由在 `src/app`，屏幕在 `src/screens`，领域逻辑在 `src/features`，数据形状在 `src/models`，API 与实时协议在 `src/api`，共享 UI 在 `src/ui`，基础设施在 `src/lib`（`presentation` / `i18n` / `theme`）。
- **features 不得 import screens**；打开一个会话走 `sessionNav` 信箱。
- `src/screens/` 只放 `*Screen` 文件。
- API 协议代码与 UI、原生代码分开。**只有在真的需要时才加状态库。**
- 依赖方向单向：`app → screens → features → models/api → lib`。反过来就是错的。

## UI 基线

- **Apple HIG 是主要 UI 要求。** 系统语义色、自动明暗适配、Dynamic Type、SF Pro / SF Mono。
- 用 UIKit 语义色做原生内容，动作用 system blue，背景用中性系统背景。不要用装饰性的自定义色去覆盖系统行为。
- 保留原生导航、安全区、VoiceOver 标签，触控目标至少 44pt。
- 提交按钮之类的原生控件优先用系统的（`UICollectionViewListCell`、原生 sheet、原生 search）。**系统有现成的东西就用现成的。**
- 导航用单一 native stack，透明 header + 软滚动边缘。瞬时流程走 `present()` 打开原生 sheet，不要自己写第二套 Modal 管理器。
- 参考 `docs/research/memoh-design-baseline.md` 的设计决策；Web 端的 CSS 手法（卡片阴影、hover、居中 dialog）不要搬。

## 页面与原生 API

- 复用 `src/lib/presentation` 的 `definePage` / `usePageRuntime` / `present` 契约。路由文件导出 `page.Route`；返回结果的瞬时流程 `await present(page, params, options)` 并检查 completed/cancelled。
- `present` 的参数只存在内存里，只有 `presentationId` 进 URL。原生返回/侧滑/卸载都必须 settle 取消并释放会话。
- 首页路径（bots → sessions → messages）在 native stack 上用 `style: push`，带系统返回和交互式 pop。sheet 留给瞬时流程和 Debug 演示。
- 只从 `@memoh-ios/kit` 导入原生 API。typed NativeModule facade、原生 View wrapper、Swift 实现三者放在对应的 feature 目录里，一一对应。模块事件订阅必须在 unmount 时移除；UIKit 工作跑在主队列。
- 复杂结构体传给原生 View 用 JSON 字符串 prop，不要跨桥传嵌套对象。
- 故障注入、运行时内部状态、Router/原生演示都放在 dev-only 的 `/debug` 页面（从 Settings 进入）。产品屏幕只暴露可操作的连接状态。

## Memoh 协议（这是本项目的核心契约）

- 实时通道是**一条 bot 一条 WebSocket**：`GET /bots/{bot_id}/web/ws`，走 `Authorization: Bearer`。原生客户端不要用 `?token=`（那是浏览器限制），也不要碰 `/web/stream` 与 `POST /web/messages`（历史遗留）。
- **发消息的连接收不到正文。** 必须先 `runtime_subscribe` 再发 `message`；文本/思考/工具增量只以 `runtime_delta` 发给订阅了该会话的连接。见 `docs/research/memoh-api.md` §2.2。
- **流式文本按 id 追加**（`message_appends: [{id, type, content}]`），不是整块替换。把它当 upsert 处理会让长回复直接卡死。只有 `tool_call_*`、审批、终止事件才是整块 `message_upserts`。
- **`epoch` + `seq` 必须校验**：epoch 变了 seq 从 0 重来；`seq != 本地 seq + 1` 视为空洞，重订阅要 snapshot；收到 `runtime_dropped` 也重订阅。不要用 cursor 续传——服务端明确不做增量补齐，任何"合成历史"都是伪造。
- **服务端不发心跳**。iOS 侧必须自己保活（推荐 25–45s 重发一次幂等的 `runtime_subscribe`），并在重连后重订阅全部活跃会话。
- run 状态机的 `waiting_decision` 是"正在等你批准"的**权威信号**，比在 UI 层看 tool block 的 approval 状态可靠。
- 工具批准必须渲染 agent 给的 `approval.options[]`（`allow_once` / `allow_always` / `reject_once` / `reject_always`），不能只做两个写死的按钮。`user_input_response` 走同一套机制，漏掉它会让 run 永久卡在 `waiting_decision`。
- 鉴权只有 `POST /auth/login` → HS256 JWT（默认 168h）。**没有 refresh token**：`/auth/refresh` 需要未过期的 token；过期即重新登录。任意请求 401 一律清 Keychain 回登录页。
- token 存 Keychain（`kSecAttrAccessibleAfterFirstUnlock`），不要 UserDefaults、不要 cookie 那套。
- `GET /container/fs/list` 的 JSON key 是 **camelCase**（`modTime` / `isDir`），仓库其余地方是 snake_case。`fs/read` 无大小限制且对二进制有损，只能用于小文本。

## 验收

- UI 基线必须能在**不登录、无凭据、无云端、无连接机器**的情况下跑。用生产组件加独立可重置的 Debug 场景，并在边界注入确定性的数据/服务结果。
- UI 改动必须补/改 `apps/mobile/verification/ui` 里的行为检查，或复用已有的原生检查。共享控件要在每个受影响的宿主里都跑到。
- **截图证视觉状态，录屏证时序行为。** 缺场景或超时判失败；只有截图不构成视觉正确的证据。
- 本地检查不传 `--udid`，让脚本租一台 `Memoh * Verify` 模拟器；构建走 `pnpm verify:build`。用 `pnpm verify:simulator --name '<当前验收名>' -- <命令>` 包裹"构建 + 多检查"的流程，并用 `$MEMOH_VERIFY_UDID`。不要直接调 `simctl create`。
- 「通过 56 个」不是结论，那 18 个失败才是信息。挂掉的用例必须给根因，没定论就写没定论。
- 验收轮次落盘后不可修改。若后续发现上一轮结论不准确，**如实新增一轮并纠正**，不要回头改旧记录。
- 怎么加一个 case、证据规则、结果目录与并行的约定都写在 `apps/mobile/verification/ui/README.md`；`pnpm verify:ui --list` 列出当前 case，`pnpm verify:native` 跑原生行为检查。

## 汇报纪律

- 只讲结论和需要人决策的事。实现细节、schema 版本号、字段名、测试计数不要拿来汇报——细节留给 README 和 commit message。
- 要报的是「现在能用了吗」「有什么变了吗」「需要我做什么决定」。
