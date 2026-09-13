# MemohKit

本地、仅 iOS 的 Expo Swift 模块，唯一 JS 出口为 `@memoh-ios/kit`。本轮只承接消息
列表，未迁移其他原生能力；不提供 Android 实现，也不提供第二套 RN 消息渲染。
参考 Lody 的目录与桥接契约，代码独立实现。

## 使用

```tsx
import { NativeMessageList } from '@memoh-ios/kit';

<NativeMessageList
  key={sessionId}
  turnsJson={JSON.stringify(turns)}
  onReachTop={loadEarlier}
  emptyTitle="Say something"
  emptyBody="This agent is online and waiting."
  style={{ flex: 1 }}
/>;
```

`turns` 必须是 `src/models/chat.ts` 的 `RenderTurn[]`；排序、实时协议、文本追加、
审批和历史分页属于上层。列表不自行请求网络。`ChatScreen` 已接入，未新增分页 API；
有分页能力的宿主可接 `onReachTop`，由宿主负责请求去重和是否还有历史。事件只在用户
进入顶部区域时触发，离开再进入才再次触发，不因布局更新循环请求。

切换会话必须改变 React `key`，销毁旧列表及其跟随状态。没有原生模块或相应 View
时，只展示不可用提示（可传 `unavailableLabel`），不在 import 时加载原生 View，
不暗中切换到 FlatList。安装到旧开发客户端后需要正常 prebuild / pods / 签名构建。

## 渲染与滚动边界

- 使用 UICollectionView、diffable data source、自适应高度和六种独立 cell reuse 类型。
  文本、思考、工具摘要、错误、通知和附件名称均可显示。助手全宽左对齐；用户右对齐、
  最宽 78%，采用系统语义背景与文本色，不沿用 Web 品牌紫。
- **表面的分工**：用户气泡用 `.secondarySystemBackground`（实心，你说的话是实体），
  agent 的机器活动卡片（工具／思考／附件）用 `.tertiarySystemBackground`（容器，
  装着机器活动）。两者**必须不同**——曾经用同一种灰，实测一张工具场景截图里那种灰
  占了 49% 的像素，整屏没有层级。政策由 `MessageListMetrics.{userSurface,activitySurface}`
  表达，颜色映射只在 `MessageBlockCell.color(for:)` 一处。层级靠形态区分，不靠第三个
  灰阶：浅色模式里根本没有第三个能和页面分开的灰。
- **工具出错不着色**。上游把这条写成了明确规则（`tool-call-inline.vue:225`）：
  工具试错是正常的长任务行为，非零退出码或 `isError` 不等于任务失败，真正的失败
  由回合级错误反馈表达。把工具行染红会让正常试错看起来像事故。诊断信息照常显示，
  只是不用颜色替用户下结论。见 `docs/research/verified-behaviour.md` 第 15 条。
- 工具卡片两行：`<工具名> <状态 · 执行位置>` 然后入参。工具名是 headline（主体），
  状态是 subheadline + 次要色（它的修饰）——曾经两者都是 headline 且各占一行，
  分不清哪个是主体。
- **状态词与状态图标只在需要说明时出现**：`running`（用户正等着）与 `failed`
  （服务端说这条出错了）。`done` 与 `unknown` **不贴标签、也不给图标**——
  所有工具都会完成，给每一个都贴 "Done" 是一屏重复十几次的噪声；
  而一枚对勾等于在断言"这次调用成功了"，与"不能从一次工具调用推导成败"相冲
  （上游 `tool-call-inline.vue` 那一行根本没有状态图标，只有未完成时的 shimmer）。
  执行位置挂在**标题行**（`exec · workspace`），它是"这个工具在哪儿跑"的修饰。
- **执行中显示转圈 spinner**（`UIActivityIndicatorView`），完成/失败显示静态图标。
  静止的图标在等几秒后会被读成"卡住了"；而 spinner 只旋转、不改布局，不会在流式
  追加时造成抖动。`prepareForReuse` 里会停掉它。
- 状态**文字**必须保留（"Running"/"Failed"），颜色只做辅助——色盲用户与强光下
  都要能读。完成态靠图标形状（对勾/转圈/问号）区分，同样不依赖颜色。
- 工具标题只在补充信息时显示。上游的 `title` 经常就是整条命令而 `input` 里又有
  `command: 同一条命令`，实测三张卡有两张把同一条命令写了两遍。判定在
  `MessageListMetrics.showsToolTitle`。
- 用户气泡上**不写** "You"：右对齐 + 实心气泡已经说明是谁，贴一个 headline 字号的
  "You" 会比用户自己写的话还显眼。屏幕阅读器仍会念角色。
- 复合标识包含 turn、message、role、block 和 kind，不包含文本/时间/高度。
  同一内容增长只 reconfigure 已变化的 item，无 reloadData、无差异动画。
  输入顺序是权威顺序。相同身份的重复块或无效 JSON 拒绝整帧，保留上次有效内容；
  空列表解码失败显示错误提示，不输出原始 JSON 或错误内容到日志。
- 输入合并到最多约 30 次/秒，解码放在后台且一次只有一个解码任务。完成帧仍发布，
  避免高频输入导致饿死；UIKit 与 snapshot 应用只在主线程。完整 JSON 序列化、
  解码与差异比对仍是 O(n)，不是零成本增量协议，不能据此宣称几千条下无掉帧。
- 默认贴底。用户拖动先解除跟随，距底部 24pt 内可重新跟随；上翻露出 44pt 系统
  回底按钮。历史前插/上方高度变化时恢复首个可见 item 的相对位置。估算高度后续
  收敛及容器变化也会重新贴底；跟随期间不播放滚动动画，不抢正在拖动的手势。
- Dynamic Type 使用 preferredFont 与自动字号更新，所有颜色用 UIColor 语义色。
  VoiceOver 标签包含角色和内容；工具状态用文字，不仅靠颜色。原生静态文案资源
  随模块提供中英两种语言，空态文案由宿主现有 i18n 传入。
- 工具入参已展示（扁平对象摊成 `key: value`，嵌套退回紧凑 JSON，按 600 字符 /
  5 行截断）；**output 仍不展示**；附件不下载/预览；思考可展开收起。不含完整
  Markdown、高亮、diff、文本选择菜单或工具交互。这些应分别扩展对应 cell，
  不加入列表调度器。

没有模块级事件订阅；view 事件随 React View 生命周期解绑。UIKit delegate 是弱引用，
布局回调及后台任务返回均弱持有 view，不会在卸载后保活视图。trait 注册随 view 释放。

## 新增 View

1. 在 `ios/<Feature>/` 添加 ExpoView，UIKit 更新留在主线程；复杂 props 使用 JSON 字符串。
2. 在现有 `MemohKitModule.definition()` 注册 View、Prop 和 Events；不创建第二个模块。
3. 在 `src/<feature>/` 添加 typed wrapper，由 `src/index.ts` 导出。命令式能力应在同一
   feature 建 typed facade，异步 UIKit 方法显式 `.runOnQueue(.main)`。
4. 需要订阅模块事件时，在 React effect cleanup 中 remove；原生侧释放 observer/task。
5. 加无凭据行为检查，并在每个宿主补截图和时序录屏。不要只改生成的 `apps/mobile/ios`。

Expo 配置、package、podspec 已提供，不增加第三方 Swift 依赖；现有 tsconfig 已有别名。
Podspec 的源码范围仅 `ios/`，verification 不参与产品构建。

## 验证

纯逻辑部分（数据、政策、折叠状态、布局计算）**已能在任何机器上跑**：

```sh
pnpm test:swift        # 传到构建机的 swift 容器里编译运行，不需要模拟器
pnpm typecheck:kit     # UIKit 文件的类型检查（本机，几秒）
```

`test:swift` 跑 `verification/MessageListTests.swift` 里 `#if !canImport(UIKit)` 那一半
（Foundation-only，用 swift-corelibs-xctest 的 runner）。当前 10 项通过。

但**它看不见 UIKit 文件里的编译错误**——踩过两次（`let` 变量做 `+=`、把 UILabel 属性
遮蔽成 String），都是纯逻辑测试全绿、iOS 构建才报错，代价是等一轮几分钟的 xcodebuild。
`typecheck:kit` 补上这一环：`swiftc -typecheck` 走完整类型检查但不链接、不要模拟器，
几秒出结果，已接进 `pnpm check`。

覆盖范围有边界，别当成"Swift 都查了"：它检查 `MessageCells.swift`（六种 cell 的
渲染逻辑，也就是上面那两个错所在），**不检查 `NativeMessageList.swift`**——那个文件
`import ExpoModulesCore`，而 Pods 里那份预编译 xcframework 是稍旧的编译器构建的
（SDK 6.3.1 vs 本机 6.3.3），本机 swiftc 解析不了它的 swiftinterface。列表调度那一块
只能靠真正的 xcodebuild 兜底。

UIKit 宿主部分（`testActivitySurfaceDiffersFromUserBubble`、工具卡片两行结构、
列表虚拟化、贴底、上翻保持、回底与非法帧保留）仍是源码，
**尚未接入 XCTest target**。后续应通过 config plugin/测试工程接入已链接
MemohKit 和 ExpoModulesCore 的 iOS hosted XCTest target（不要只手改生成工程）。

视觉与交互的现状用**场景截图**看，不靠回忆（8 个场景 × 2 种外观，不需要服务端
也不需要凭据）：

```sh
pnpm verify:simulator --name scenes -- zsh -euc '
  pnpm verify:build
  pnpm verify:ui --app "$(pnpm --silent verify:build)" --case scenes
'
```

看图之前可以先量一遍硬数据：

```sh
python3 verification/ui/tools/measure_surfaces.py <screenshot.png>
```

它输出配色占比与每种颜色的出现区间。**不能替代看图**（字号、间距、截断它看不到），
但能回答"两种东西是不是同一个颜色"这类不靠眼睛的问题——上面那条 49% 同色就是它
发现的。

人工验收仍需检查（待验证项，不是已通过结论）：

- 千条历史中最后一项持续增字，录屏观察换行与贴底，无闪烁/跳动；用 Instruments 看帧耗时。
- 上翻期间持续流式输出，不夺走位置；前插历史保持同一行；回底按钮恢复跟随。
- 字号切到最大、亮暗切换、横竖屏/iPad、键盘开合，确认高度、锚点和按钮安全区。
- VoiceOver 朗读角色/工具状态、三指滚动与回底、超长单块、空态、全部 block 类型。
- 无原生模块的旧 dev client 能显示不可用提示；标题、输入器、审批流程未回归。

截图记录视觉状态，录屏记录时序；以上均为待验证项，不是已通过结论。

## 设计决定为什么这么定

这个模块的每条视觉规则都应该能回答"为什么"，否则下一轮改的人会以为是随手写的。
依据分三类，都写在代码注释里：

1. **平台惯例**：用户气泡不写 "You"、"工具名是主体状态是修饰" 这类。
2. **上游产品规则**：工具出错不着色直接引自上游 Web 客户端的注释
   （`apps/web/src/pages/home/components/tool-call-inline.vue:225`），
   见 `docs/research/verified-behaviour.md` 第 15 条。
3. **实测数据**：表面分层那条来自真实截图的像素测量，不是审美偏好。

如果你要推翻某条规则，请连依据一起推翻——"我觉得不好看"不足以推翻第 2、3 类。
