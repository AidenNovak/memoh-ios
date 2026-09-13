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
- 工具 input/output 暂不展示；附件不下载/预览；思考本轮展开显示。不含完整 Markdown、
  高亮、diff、文本选择菜单或工具交互。这些应分别扩展对应 cell，不加入列表调度器。

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

## 验证与欠账

本轮按要求**未运行 iOS 构建、bundle、模拟器或 UI 验收**。已通过生产 Swift 的
`xcrun swiftc -parse`、两份 JSON 解析、podspec Ruby 语法与 strings 资源语法检查。
parse 不是类型检查或链接检查，不能证明 Expo 注册、Swift 严格并发或 UIKit 集成可用。

`cd apps/mobile && npx tsc --noEmit` 已执行，但全项目未通过：并行新增的
`src/features/activity/useSessionActivity.ts` 在 SessionSnapshot / SessionDelta 上使用
不存在的 session_id，以及未正确收窄的 status。当前诊断没有涉及本模块或 ChatScreen。
这些不在本轮授权范围，未擅自修改、隐藏或排除。

`verification/MessageListTests.swift` 是无网络、无登录的 hosted XCTest 行为测试源码：
覆盖身份稳定、前插、重复 key 拒绝、真实列表虚拟化、贴底、上翻保持、回底与非法帧保留。
**尚未接入 XCTest target，也未执行**。后续应通过 config plugin/测试工程接入已链接
MemohKit 和 ExpoModulesCore 的 iOS hosted XCTest target（不要只手改生成工程）。
现有 `pnpm verify:native` 的 kit-loads 直接 swiftc 编译入口、没有 ExpoModulesCore
链接配置，不能替代此测试或正常 App 构建。

人工验收需用生产组件的独立 Debug 场景，至少检查：

- 千条历史中最后一项持续增字，录屏观察换行与贴底，无闪烁/跳动；用 Instruments 看帧耗时。
- 上翻期间持续流式输出，不夺走位置；前插历史保持同一行；回底按钮恢复跟随。
- 字号切到最大、亮暗切换、横竖屏/iPad、键盘开合，确认高度、锚点和按钮安全区。
- VoiceOver 朗读角色/工具状态、三指滚动与回底、超长单块、空态、全部 block 类型。
- 无原生模块的旧 dev client 能显示不可用提示；标题、输入器、审批流程未回归。

截图记录视觉状态，录屏记录时序；以上均为待验证项，不是已通过结论。
