# Lody iOS 设计系统规格（可执行版）

研究对象：`/Users/lijixiang/projects/reference/lody-ios`（Expo 57 + RN 0.86 + 自研 Swift 模块 LodyKit，iOS 26+ only）。
所有结论都来自仓库内代码，路径相对仓库根。文中「没找到」= 我在仓库里确实没找到对应实现，不是我忘了看。

**一句话总结它的质感来源**：把 RN 当骨架、把 UIKit 当皮肤。列表、聊天、输入框、Diff 全部是原生 Swift；RN 只负责路由、数据订阅和页面组装。配色几乎不自己造（除 accent 与三个手写灰/卡片色外全是 `PlatformColor`/UIKit 语义色）；排版全部走 Dynamic Type 或语义角色；间距只有六档；视觉分层只靠灰度和 hairline，没有卡片边框、没有阴影、没有头像。

---

## 0. 事实来源与优先级

| 文件                                                                  | 价值                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-09-06-design-language-design.md`         | **设计语言总纲**（除聊天页）。分层、色彩规则、状态语言、排版表、信息架构、实施记录、模拟器验收、5 个真 bug、导航栏修正、玻璃 sheet、嵌套栈、composer 不设 lineHeight |
| `docs/superpowers/specs/2026-09-06-chat-redesign-design.md`           | **聊天页规格**：视觉语言、活动行聚合表、投影信封、权限流程、原生手感三个已验证事实、错误与降级                                                                       |
| `docs/superpowers/specs/2026-09-07-markdown-view-design.md`           | MarkdownView/Litext 接入、主题映射、逐字淡入注入点、已知上限                                                                                                         |
| `docs/superpowers/specs/2026-09-08-reusable-diff-rendering-design.md` | Diff 双路径、token、Pierre 覆写点、禁用绿色                                                                                                                          |
| `docs/superpowers/specs/2026-09-11-ask-user-question-design.md`       | 提问 sheet 的呈现规则                                                                                                                                                |
| `AGENTS.md`（= `CLAUDE.md` 软链）                                     | 硬规则：HIG 优先、禁绿色、禁 `headerLeft/Right`、44pt、`definePage/present` 契约、原生列表边界                                                                       |
| `apps/mobile/src/lib/theme/tokens.ts`、`palette.ts`                   | 唯一色值源                                                                                                                                                           |
| `apps/mobile/modules/lody-kit/ios/**`                                 | 全部数值实现                                                                                                                                                         |

---

## 1. 设计系统底座

### 1.1 配色

**双层结构**：RN 侧一份纯数据 token（无 RN 依赖，可被 node test 直跑），UIKit 侧一份 `UIColor` 动态色。两边值必须对齐。设计文档原话：_「`accent` `#3B4FD9` / `#7B8AFF` —— 唯一手写双值的色，其余全部 `PlatformColor`」_。

**手写 token**（`apps/mobile/src/lib/theme/tokens.ts:1-35`）：

| token                           | light     | dark      | 用途                                       |
| ------------------------------- | --------- | --------- | ------------------------------------------ |
| `accent`                        | `#3B4FD9` | `#7B8AFF` | 唯一手写双值。取自 app icon 水母伞盖的靛蓝 |
| `systemBackground`              | `#FFFFFF` | `#000000` |                                            |
| `systemGroupedBackground`       | `#F2F2F7` | `#000000` | 列表底色                                   |
| `softDarkBackground`            | —         | `#111113` | 深色「柔和」背景（用户可切 soft/black）    |
| `opaqueCard`                    | `#FFFFFF` | `#1C1C1E` | 玻璃 sheet 里强制不透明的行卡片            |
| `inset`                         | `#F5F5F5` | `#1C1C1E` | 下沉 chip（浅色 = Tailwind neutral-100）   |
| `label`                         | `#000000` | `#FFFFFF` |                                            |
| `separator`                     | `#C6C6C8` | `#38383A` |                                            |
| `danger`                        | `#FF3B30` | `#FF453A` |                                            |
| `onAccent`                      | `#FFFFFF` | `#FFFFFF` |                                            |
| `lodyInsetSelected`（仅 UIKit） | `#E5E5E5` | `#2C2C2E` | 列表选中态                                 |

**RN 语义角色**（`palette.ts:26-52`，`usePalette()`）：

```
label       → PlatformColor('label')
secondaryLabel / tertiaryLabel → PlatformColor(...)
accent      → accent[theme]          （唯一非 PlatformColor 的语义色）
warning     → PlatformColor('systemOrange')
danger      → PlatformColor('systemRed')
background  → 深色+soft 时为 #111113，否则 systemGroupedBackground
reading     → 深色+soft 时为 #111113，否则 systemBackground   ← 会话页/阅读面用它
card        → PlatformColor('secondarySystemGroupedBackground')
inset       → inset[theme]
separator   → PlatformColor('separator')
fill        → PlatformColor('tertiarySystemFill')            ← 用户气泡底色、输出块底色
onAccent    → #FFFFFF
```

**UIKit 动态色**（`modules/lody-kit/ios/LodyTint.swift:65-124`）：

| 名称                                        | 定义                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIColor.lodyBackground`                    | light `systemBackground`；dark `#111113`（soft）或 `.black`                                                                                       |
| `.lodyGroupedBackground`                    | dark 跟随 `lodyBackground`；light `systemGroupedBackground`                                                                                       |
| `.lodyOpaqueCard`                           | `#FFFFFF` / `#1C1C1E`（注释明确：玻璃上下文里 UIKit 会把 `secondarySystemGroupedBackground` 解析成 vibrant 半透明填充）                           |
| `.lodyAccent`                               | `#3B4FD9` / `#7B8AFF`                                                                                                                             |
| `.lodyUserBubble`                           | `lodyAccent.mixed(with: lodyBackground, amount: 0.10 light / 0.14 dark)` —— **用户气泡不是 accent 实色，是 accent 与画布按 10%/14% 混出来的浅色** |
| `.lodyInset`                                | `#F5F5F5` / `#1C1C1E`                                                                                                                             |
| `.lodyInsetSelected`                        | `#E5E5E5` / `#2C2C2E`                                                                                                                             |
| `.lodyFileGroup` / `.lodyFileGroupSelected` | 复用上面两者                                                                                                                                      |

**两条硬规则**（设计文档）：

1. **强调色只表达两件事**：可点（按钮、链接、Tab 选中）和「进行中」。状态色只在状态语言里出现。
2. accent 两值对 `systemBackground` 对比度都 ≥ 4.5:1，**写成测试**（`tokens.ts:66-86` 提供 `luminance()` / `contrastRatio()` 供测试用）。
3. `AGENTS.md`：**禁用绿色强调和绿色背景**；Diff 的新增/删除用 system blue / system red，不用 GitHub 的绿红。

深色可切换 soft/black（`#111113` vs `#000000`），存 `UserDefaults` key `darkBackground`，native 侧发 `Notification.Name("LodyAppearanceDidChange")` 让所有 `LodyAppearanceView` 子类重绘（`LodyTint.swift:4-40`）。

### 1.2 排版

**语义角色表**（`tokens.ts:37-46`）：

| role        | 字号 / 行高 | 字重 | 颜色           | 其他                                                          |
| ----------- | ----------- | ---- | -------------- | ------------------------------------------------------------- |
| `title`     | 20 / 26     | 600  | label          | 分区标题、Sheet 标题                                          |
| `body`      | 17 / 25     | 400  | label          | 消息正文、列表主标题、输入框                                  |
| `secondary` | 15 / 21     | 400  | secondaryLabel | 行副标题、说明                                                |
| `meta`      | 13 / 18     | 400  | secondaryLabel | 时间、状态、footer                                            |
| `eyebrow`   | 11 / 14     | 600  | secondaryLabel | `textTransform: uppercase`，`letterSpacing: 0.88`（= 0.08em） |
| `mono`      | 13 / 20     | 400  | label          | **仅四类**：路径、分支、ID、代码                              |

**Dynamic Type 的取舍**：RN 侧 `allowFontScaling={false}`，自己按 `useWindowDimensions().fontScale` 缩放，并 **clamp 到 `14/17 ~ 23/17`**（`tokens.ts:48-56`）。原话：_「XS / 默认 Large 到 XXXL，辅助字号 AX\* 不跟随」_。理由写在 `AGENTS.md`：_「MVP 验收按默认字号，保留系统文字行为但不为超大辅助字号加特殊布局或 remount 逻辑」_。

`AppText`（`apps/mobile/src/ui/AppText.tsx`）是唯一文本入口：接受 `variant`，映射 role→色，**业务代码不再出现裸 `fontSize`**。`mono` 用 `fontFamily: 'Menlo'`。

**原生侧同构**（`modules/lody-kit/ios/UIFont+Dynamic.swift`）：

```swift
static func dynamicScale(compatibleWith traits: UITraitCollection? = nil) -> CGFloat {
  let body = preferredFont(forTextStyle: .body, compatibleWith: traits ?? .current).pointSize
  return min(23 / 17, max(14 / 17, body / 17))
}
static func dynamic(of size: CGFloat, weight: UIFont.Weight = .regular, ...) -> UIFont {
  systemFont(ofSize: size * dynamicScale(...), weight: weight)
}
```

即**原生侧也不用 `preferredFont` 计算正文，而是拿同一个 clamp 系数去乘写死的字号**——这样 RN 与原生在并排时不会差一档。只有少量「系统语义位置」直接用 `preferredFont(forTextStyle:)`：列表行（`.body/.headline/.footnote/.caption1/.subheadline`）、导航副标题 `.caption1`、toast `.subheadline`。

**Markdown 主题**（`Chat/ChatMarkdownTheme.swift`）：body 17（`thought` 行 15）、`code` 等宽 13、`codeInline` 12/13、`title` 20 semibold、`largeTitle` 23 semibold、`footnote` 13；段落间距 `paragraph 8`、`headingBefore 12`、`final 0`（_「让行高与现有 25pt 正文接近」_）；`codeBackground = .lodyInset`；链接/强调/highlight 用 `systemBlue`；选中底色 `systemBlue 0.2`。

**聊天页行内字号**（`Chat/ChatCell.swift:151-157`、`LodyChatView+Transcript.swift:119-134`）：

- 用户消息 17，其他行 13（`thought`、`duration`、`summary`、工具行…）
- 行高：user `25`，其他 `18`（都乘 dynamicScale，用 `NSMutableParagraphStyle.minimumLineHeight == maximumLineHeight`，并配 `baselineOffset = (lineHeight - font.lineHeight)/2`）
- `duration`/`summary` 用 `withTabularNumbers()`，避免计时器跳动

**Composer 特例**：`ChatComposerView` 输入框 **17pt、不设 lineHeight**。设计文档专门写了原因：_RN 在 iOS 多行 `TextInput` 上把 `lineHeight` 映射成 `NSParagraphStyle.minimumLineHeight`，多出的高度全加在文字上方——表现为上 padding 大于下 padding、光标被拉长。17pt 自然行高约 20.3，设成 25 就偏 5pt。多行输入框只设 `fontSize` 与对称 padding。_

### 1.3 间距体系

**只有六档**：`space = [4, 8, 12, 16, 20, 24]`（`tokens.ts:48`）。没有 2/6/10/14/18 这些中间值出现在布局里。

- 通用滚动页 `Screen.tsx`：`contentContainerStyle = { padding: 16, gap: 12 }`。设计文档记录了这次收敛：_「`Screen.tsx` 的 `padding: 24, gap: 20` 改成 `16 / 12`，对齐系统分组列表边距」_。
- 聊天气泡/行内：`ChatRowPadding.content = 6`，`durationBottom = 3`，正文跟在 `duration` hairline 之后用 `textBelowDuration = 12`（`Chat/ChatCell.swift:3-14`）。
- 阅读列（`Chat/ChatTranscript.swift:185-201`）：`maximumWidth = 800`、`cellMargin = 20`、`sectionTop/Bottom = 4`。宽屏（iPad/横屏）时整列居中、滚动条仍贴屏幕边缘。
- 原生分组列表行内边距：内容态行 `12 / 22 / 12 / 22`（`LodyGroupedList.swift:675`）；会话行 `11 / 32 / 11 / 16`（`LodySessionRowView.swift:66,144`），compact 密度 `5 / 22 / 5 / 10`。
- Composer：见 §4。

### 1.4 圆角、材质、分隔线

**圆角**（全部配 `cornerCurve = .continuous`，RN 侧写 `borderCurve: 'continuous'`）：

| 元素                         | 值                                      | 出处                                            |
| ---------------------------- | --------------------------------------- | ----------------------------------------------- |
| 用户气泡                     | `19`                                    | `ChatCell.swift:70`、`ChatSendHandoff.swift:98` |
| 输入胶囊                     | `capsule(maximumRadius: 26)`            | `ChatComposerLiquidGlassSurfaceLayout.swift:49` |
| 附件按钮 / 队列面板          | capsule / `corners(radius: .fixed(20))` | 同上 `:54`、`ChatComposerView.swift:50`         |
| 会话列表卡片（outline 分组） | `26`                                    | `List/LodyListCellBackground.swift:33`          |
| 文件行（成组圆角）           | `12`，首行只圆上、末行只圆下            | `Chat/ChatFileCell.swift:26-40`                 |
| 面板 / 代码块 / 输出块       | `18` / `12` / `12`                      | `ChatMentionPanel.swift:68`、`DetailBlocks.tsx` |
| 图片                         | `16`                                    | `ChatImageCell.swift:19`                        |
| Toast 胶囊                   | `min(24, h/2)`                          | `Toast/LodyToastPillView.swift:70`              |
| RN filled 按钮               | `12`                                    | `ui/Button.tsx`                                 |

**材质 / Liquid Glass**（这是「iOS 26 原生味」的主要来源）：

- 输入框用两层玻璃：外层 `UIGlassContainerEffect()` 且 **`spacing = 8`**（让「附件胶囊 + 输入胶囊」像系统那样合并/分离），内层两个 `UIGlassEffect(style: .regular)` 且 **`isInteractive = true`**（`ChatComposerLiquidGlassSurfaceLayout.swift:42-54`）。
- 队列面板同样是 `UIGlassEffect(.regular)` + `isInteractive = true`。
- 回到底部按钮用 `UIButton.Configuration.glass()` + `cornerStyle = .capsule`（`LodyChatView.swift:360-367`）。
- RN 侧需要玻璃时，**不能在 RN 树里塞 effect view**，而是专门的 `NativeGlassSurface` 组件（`Press/LodyGlassSurface.swift`），注释解释了原因：_「RN cannot render UIGlassEffect, and adding the effect view inside a host that also mounts RN children breaks Fabric's indices」_。
- 列表把玻璃「缝合」进滚动边缘：`collection.topEdgeEffect.style = .soft` / `bottomEdgeEffect.style = .soft`，并把悬浮控件注册给 `UIScrollEdgeElementContainerInteraction`（edge `.top`），让 UIKit 围绕它塑形边缘雾化（`LodyGroupedList.swift:256-258,286-289`）。RN 侧对应 `ScrollViewMarker` + `softScrollEdgeEffects = { top: 'soft', bottom: 'soft' }`（`ui/Screen.tsx:5`）。
- **iOS 26 玻璃 sheet**：`src/ui/platform.ts` 导出唯一版本常量 `isIOS26`；sheet 是 `formSheet`/`pageSheet` 且 iOS 26 时把 `contentStyle.backgroundColor` 设为 `transparent`，系统玻璃就显出来；iOS 26 以下必须用实色（那些版本背后没有材质，透明会直接看穿被遮页面）。配套两件事（都不显然）：① 列表自己的底去掉（`transparent` prop → `collection.backgroundColor = .clear`），否则 `systemGroupedBackground` 把玻璃盖死；② **行必须显式取回不透明卡片色**，否则 UIKit 把 `secondarySystemGroupedBackground` 解析成 vibrant 半透明填充、sheet 背后的文字会透过行读出来。

**阴影**：整个 UI 只有一处阴影 —— Toast 胶囊 `shadowColor black / opacity 0.08 / radius 12 / offset (0, 4)`（`LodyToastPillView.swift:25-28`）。列表行、卡片、气泡、按钮一律无阴影。分层靠灰阶 + hairline。

**分隔线**：一律 `1/max(1, displayScale)` 的物理细线，颜色 `.separator`。聊天里的 hairline 是 `duration` 行的底部（`ChatCell.swift:247-248`）；列表分隔线用 `separatorLayoutGuide.leadingAnchor = contentView.leading + 32`，让分隔线与会话行文字对齐（`LodySessionRowView.swift:32-37`）。视觉分层只靠灰度和 hairline，**零边框零卡片**（聊天页）。

### 1.5 用的什么 UI 库 / 为什么这决定了质感

**没有 NativeWind、没有 Tailwind、没有第三方 RN 组件库。** `apps/mobile/package.json` 的 dependencies 里 UI 相关的只有：

```
expo / expo-router(~57.0.8) / react-native(0.86.3) / react-native-screens(~4.26.0)
react-native-reanimated(4.5.1) / react-native-safe-area-context / react-native-worklets
```

另加 `@lody-ios/kit`（本地 Expo Swift 模块）、`packages/dom-webview`（vendored `expo/dom-webview` 只留 iOS）、`@pierre/diffs`。

**五层结构**（设计文档开篇）：

```
src/lib/theme/tokens.ts      纯数据，零 RN 依赖，node test 直跑
src/lib/theme/*.ts           palette / motion / appearance —— hook 层
src/ui/*.tsx                 RN 原语，把原生 view 包成产品语义组件
modules/lody-kit/src/*.tsx   类型化原生组件接口（NativeGroupedList / NativeChat / NativeComposer…）
modules/lody-kit/ios/*.swift Swift 实现，按功能目录（Chat / List / Chrome / Diff / Toast / Press / Menu）
```

原话：_「`ui/` 和 `kit/` 是两层封装。kit 出裸 props 和 id 数组；`ui/` 包成接受闭包、自己管测高与 id 映射的产品组件。业务页只认 `ui/`」_，以及 _「不建 workspace package，`src/theme/tokens.ts` 即可」_。

**为什么这个选择带来质感**：所有「系统感」的部件（分组列表、滚动边缘雾化、玻璃、上下文菜单、滑动操作、键盘避让、列表选中态）都不是 RN 模拟的，而是 UIKit 本体。`AGENTS.md` 把这条写成了硬规则：_「Do not simulate unavailable native effects with decorative RN overlays」_、_「System grouped rows use `LodyGroupedList` / `UICollectionViewListCell`」_、_「A native UICollectionView must register with UIKit directly」_。

代价（必须接受）：iOS-only、RN 与原生之间靠 JSON props 过桥、需要写 Swift 并维护 Expo Module。他们连 Markdown 渲染都没自己写，用 `Lakr233/MarkdownView` + `Litext`（CoreText + cmark-gfm），通过 `cocoapods-spm` 接进 Expo 的 CocoaPods 工程。

---

## 2. 逐屏规格

### 2.0 导航框架（所有页面共用）

- **绝不使用大标题**。`PresentedPage.tsx:130` 写死 `headerLargeTitle: false`；每个 push 页面 `presentation: { style: 'push', headerVariant: 'transparent' }`，配合 `scrollEdgeEffects = softScrollEdgeEffects`。标题形态是「透明 header + 滚动内容顶到 header 下面 + 软雾化边缘」，不是 large title 的收缩动画。
- 页面契约：`definePage({ id, title, Component, presentation })` → `src/lib/presentation/page.tsx`。`present(page, params, options)` 打开一个「会返回结果」的流程，返回 `Promise<completed | cancelled>`；`push` 表示在**当前 sheet 内部**再压一层。参数只在内存里，URL 只有 `presentationId`。
- 三种呈现：`push`（card + 系统返回 + 交互式侧滑）、`formSheet`（带 detent、grabber，**玻璃**）、`pageSheet`/`fullScreen`/`overFullScreen`。默认表：`style: 'pageSheet', headerVariant: 'glass', animationType: 'slide', dismissible: true, headerShown: true`。
- Sheet 内的 header 恒定：`translucent: true` + `backgroundColor: 'transparent'` + `hideShadow: true` + `topInsetEnabled: false` + `backButtonDisplayMode: 'minimal'`；`headerVariant === 'glass'` 用 `blurEffect: 'systemChromeMaterial'`。关闭按钮是 `UIButton(type: .close)`（系统关闭按钮本体），30×30，包在 `ScreenStackHeaderRightView` 里。
- **导航栏 action 必须走 `Stack.Toolbar`**（expo-router 57）：`<Stack.Toolbar placement="right"><Stack.Toolbar.Button icon="plus" tintColor={accent} separateBackground /></Stack.Toolbar>`，菜单用 `Stack.Toolbar.Menu` + `MenuAction`（选中态 `icon="checkmark"` → 实际用 `isOn`），`Spacer` 切分玻璃分组。**`headerLeft` / `headerRight` 在这个代码库里不存在**（设计文档专门写了一节「修正：导航栏按钮必须是原生 UIBarButtonItem」，并删掉了自研 `LodyMenuButton`）。

### 2.1 会话列表 / 首页（InboxScreen）

- 结构：`NativeGroupedList`（`UICollectionViewCompositionalLayout.list(appearance: .insetGrouped)`）+ 透明 header + 集成式搜索栏。
- 导航栏：`title: ''`；左上工作区菜单（`account.workspaces.length > 1` 才显示，头像 = 名称首字 + accent 色或远端图）；右上「视图/排序」筛选菜单 + 齿轮（点进 Settings sheet，长按进 Debug）；底部工具栏是 `SearchBarSlot + Spacer(width 6) + plus(separateBackground, accent)`。
- 内容：分区本身就是排序，全部固定顺序（`src/features/sessions/inbox.ts:17-26`）：
  `attention`（waiting/error）→ `live` → `unread` → `today` → `yesterday` → `week` → `month` → `older`。**空分区整组不渲染**；没有独立筛选器，搜索同时匹配会话标题与项目名，已归档只在搜索里出现。
- 行（`NativeListSection.contentStyle` → `LodySessionRowView`）：
  - 高 ≥ 44；`directionalLayoutMargins = 11 / 32 / 11 / 16`
  - 状态标记：`ring` 14×14（`tint.withAlphaComponent(0.14)` 底 + `cornerRadius 7`，仅 live 时显示）+ `dot` 8×8（`cornerRadius 4`，纯 tint）；`ring.centerY = title.firstBaseline - 5`，`markCenter` 在 leading 18（compact 10）
  - 第一行 meta 行（`UIStackView`，水平、居中、spacing 0，手工 `setCustomSpacing(5,...)`）：`meta`（footnote, secondaryLabel，可含 `pin.fill` 附件 tint systemYellow、`+N −M` 等宽数字 systemBlue/systemRed）+ `model`（footnote secondaryLabel，前面拼 `·`）+ `badge` 胶囊（`caption1 medium`，`textColor = tint`，`backgroundColor = tint.withAlphaComponent(0.16)`，`cornerRadius 9`，内边距 1/7）
  - 第一行右侧 `time`（footnote secondaryLabel，右对齐，压缩阻力 required）
  - 第二行 `title`（`.body`，未读则 `.headline`，最多 2 行，`byTruncatingTail`；`destructive` 时 systemRed），与 meta 行间距 `3`
  - 无 meta 时切到另一套约束（title 顶部对齐、time 与 title 第一基线对齐）
  - 无障碍：整行一个元素，label = `标题, badge, meta, model, value` 逗号连接
- 交互：trailing swipe = `[标记已读（仅未读时）, 归档]`，leading swipe = `[置顶]`（tint yellow）；长按 = `UIContextMenu`，含新建会话 / 置顶 / 归档，且 **`preview: 'session'` 走 `ChatTranscriptPreviewController` 会话预览**（预览宽 320、sectionInset 16、symbol 槽 36）。
- 空态/加载态：`placeholder` 是 collection 的居中 label（`.subheadline` secondaryLabel，`numberOfLines = 0`，四周 inset 32 + 上下 24），文案由 `src/ui/listState.ts` 统一给出：loading / 无匹配 / 离线 / 首次为空 四种，**一套机制，不用裸 `<Text>` 也不用 section footer 塞错误**。下拉刷新用 `UIRefreshControl`。

### 2.2 对话页（**最重要**）

容器：`LodyChatView`（`UICollectionView` + `UICollectionViewFlowLayout`），`minimumLineSpacing = 0`、`minimumInteritemSpacing = 0`、section inset 上下 4；`contentInsetAdjustmentBehavior = .automatic`；`alwaysBounceVertical = true`；`keyboardDismissMode = .interactive`；`backgroundColor = .lodyBackground`，collection 自身透明。

**导航栏**：不是标题字符串，而是一个 `UIButton`（`ChatNavigationTitle`）塞进 `titleView`：

- `UIButton.Configuration.plain()`，`title` = 会话标题（`.headline` 适中字号，`titleAlignment = .leading`，`byTruncatingTail`），`subtitle` = `项目 · 电脑`（`.caption1` secondaryLabel，`byTruncatingMiddle`），项目/电脑前各挂一个 SF Symbol 附件（`folder` / `desktopcomputer`，尺寸 = 字体 size − 3，`renderingMode = .alwaysOriginal` 以便 tint secondaryLabel），符号垂直居中用 `offset = (font.capHeight - image.height)/2`
- `contentInsets = (top 0, leading 8, bottom 0, trailing 0)`；`button.bounds.height = 44`
- `item.style = .browser`，`item.subtitle = nil`（自己画副标题）
- 点击标题 → 弹 Debug 详情 Alert（可复制）
- 返回时若手势取消，要重新挂回 titleView（`titleDisappearing` + `transitionCoordinator` 回调 + KVO 监听 `navigationItem.titleView`）

**转录行的类型与布局**（`ChatRow.kind`，`Chat/ChatTranscript.swift` + `Chat/ChatCell.swift`）：

| kind                    | 视觉                                       | leading | 文本宽                        | 说明                                                              |
| ----------------------- | ------------------------------------------ | ------- | ----------------------------- | ----------------------------------------------------------------- |
| `user`                  | **右侧气泡**，`.lodyUserBubble`，corner 19 | 右对齐  | `width*0.84 - 26`             | 唯一的气泡                                                        |
| `text`（助手正文）      | 全宽无气泡                                 | 0       | 全宽                          | markdown 渲染                                                     |
| `thought`               | 全宽灰字                                   | 0       | 全宽                          | 字号 15、secondaryLabel                                           |
| `duration`              | 灰字 + 底部 hairline                       | 0       | 全宽                          | 「已工作 4 分 20 秒」                                             |
| `summary`（工具聚合）   | 灰字 + 前导小圆点                          | 12      | 全宽                          | `circle.fill` pointSize 6，8×8                                    |
| `tool_call` 等          | 灰字 + SF Symbol                           | 24      | 全宽 − 28（为右侧状态槽预留） | 图标 20×20，pointSize 13                                          |
| `meta`                  | footnote secondaryLabel                    | 0       | 全宽                          | 「模型 · 时间」                                                   |
| `changesHeader`         | 分组头 28pt 高                             | 4       | —                             | 右侧 `+N`(systemBlue) `−M`(systemRed) 等宽数字                    |
| `changes`               | 文件行 44pt                                | —       | —                             | `#F5F5F5/#1C1C1E` 底、成组圆角 12、图标 18 + 间距 8、末行无分隔线 |
| `attachments` / `image` | 附件网格                                   | —       | —                             | 瓦片 76pt 高、间距 8，列数 = `(width*0.84 + 8)/(92+8)`            |

行间距：除 `user` 行外，`rowExtra = ChatRowPadding.top(kind, previousKind) + 6`（默认 6+6=12；紧跟 duration 的正文 12+6=18）；`user` 行额外 +44（给发送动画留位）。**行高有 44pt 地板**（`actionable || summary || pending` 时），但 `duration` 例外 —— 注释说明：_「Duration stays copy-sized even after the folded process makes it tappable — a 44 pt floor would leave an empty gap between the timer and the hairline」_。

**用户气泡的细节**（`Chat/ChatCell.swift:198-220`、`ChatSendHandoff.swift:4-56`）：

- 宽：`expandable ? width*0.84 : 文字宽 + 26`；`bubble` 内边距 `13 / 10`（左右 13、上下 10）
- 折叠：`maximumCollapsedHeight = 140`；超过时 `height + 20 > 140` 判定可展开，折叠态高度 = 该会话第一条发送动画落地时的自然高度（≥68），展开态 = 全文 + 44（给「展开」按钮）
- 折叠时用 `CAGradientLayer` 做底部渐隐（3 段：全黑 → 在 `h-58` 处开始 → `h-30` 处透明），并把可点链接区域限制在 `h-58` 以上
- 展开按钮：`caption1` secondaryLabel、右对齐、`bounds.height - 44` 处、高 44

**轮次结构**（一次 user → assistant 回复）：

```
                                          时间 ⧉   ← 由 duration 行承担时间/可点
已工作 4 分 20 秒 · 读取了文件、执行了命令
─────────────────────────────────────────────  ← hairline（duration 行底部）
助手正文（全宽，markdown，逐字淡入）
              读取了文件、执行了命令  ›           ← summary 行，灰字，点开 sheet
模型 · 时间                                      ← meta 行
文件变更 (3)                    +12  −4
  src/auth.ts                        ›
```

**活动行聚合**（关键决策，设计文档明确写了表）：连续的 `tool_call` 合成**一行灰字**，被 `text`/`thought` 打断则起新行。**不是一个 tool_call 一张卡。**

| kind 集合                            | 图标                       | 措辞                      |
| ------------------------------------ | -------------------------- | ------------------------- |
| `read` / `search`                    | `doc.text.magnifyingglass` | 读取了文件                |
| `edit` / `write` / `move` / `delete` | `square.and.pencil`        | 编辑了 `<path>` `+N` `−M` |
| `execute` / `bash`                   | `terminal`                 | 执行了命令                |
| `fetch`                              | `globe`                    | 访问了网络                |
| `mcp` / `other` / `computer`         | `wrench.and.screwdriver`   | 调用了工具                |
| 混合                                 | `wrench.and.screwdriver`   | 逐类顿号连接，最多三类    |

`+N/−M` 在 runtime 侧算好（逐行比对 diff 数增删行，**不是总行数相减**）。`in_progress` 的行尾挂 20×20 `UIActivityIndicatorView(style: .medium)`（`width - 24`，垂直居中），不换措辞；`failed` 的行转 systemOrange 且措辞前缀「失败：」；`permission.pending` 的行转 systemOrange 且措辞前缀「等待你的批准」。`plan` / `subagent_task` 各自独占一行不参与聚合；`plan` 用 `✓ / › / ○` 前缀。

**点开活动行 → 原生 sheet**，不内联展开（`ItemDetailScreen`，`formSheet`，detents `[0.6, 1]`，初始 0，grabber 可见）。

**空态 / 加载态**：`collection.backgroundView = empty`，居中、16pt、secondaryLabel；文案由 RN 按 `snapshot.status === 'live'` 在「加载中」与「开始对话」之间切（`SessionScreen.tsx:675-679`）。断线/溢出时不换屏，而是在 composer 上方显示一行 notice（见 §4）。

**历史分页**：滚动内容顶部是一个真实 header 按钮（`ChatHistoryHeader`，`.footnote`，可加载时 systemBlue 否则 secondaryLabel，`showsActivityIndicator`），文案「加载更早 / 已是开头 / 加载中」；header 高度 48 仅在「有分页历史且非 process 模式]」时给。

**回到底部按钮**：`UIButton.Configuration.glass()`、capsule、`arrow.down` pointSize 14 semibold、44×44、`centerX` 与 composer 对齐、距 composer 顶 8pt；仅当 `未贴底 && 距底 > 80pt` 时淡入（0.15s，`allowUserInteraction`），`isUserInteractionEnabled` / `accessibilityElementsHidden` 同步切换。

### 2.3 设置页（SettingsScreen）

- 呈现：`formSheet`，`sheetAllowedDetents: [1]`（即只有大 detent），`headerVariant: 'transparent'`。**玻璃 sheet**，所以列表 `transparent`，行取回 `#FFFFFF`/`#1C1C1E`。
- 结构（按顺序）：`account`（头像 + 姓名 + 邮箱，点进账户页）→ `remote`（机器 / Agent / MCP）→ `sessions`（历史导入 / 已归档）→ `connection`（`N 台电脑` + `状态 · 同步于 时间`，离线可点重连）→ `preferences`（外观 / 通知）→ `about`（`Lody for iOS` + `版本 (build)`，行内 value，不点）+ `licenses` → `developer`（仅 `__DEV__`，header + footer）。
- 行样式统一走 `UIListContentConfiguration.subtitleCell()`：主标题 `.body` label；副标题 footnote secondaryLabel（`路径/分支` 类用等宽 `monospacedSystemFont(footnote.pointSize)` —— 兑现「路径归 mono」）；尾部 accessory 依次叠加：value label（secondaryLabel）→ 自定义 view（`+N −M` 或 `UISwitch`，`onTintColor = accent`）→ `checkmark()`（选中）→ `disclosureIndicator()`。
- 图标：`content.image` = SF Symbol，`preferredSymbolConfiguration = .init(textStyle: .title3)`，`tintColor = lodyTint(row.imageTint) ?? (destructive ? .systemRed : accent)`；即**所有行图标默认 accent 靛蓝**（曾经默认是 `.systemBlue`，因与 accent 并排有色差被改成 view 级 accent prop）。
- 危险操作：`content.textProperties.color = .systemRed`（如「退出登录」），点击后弹系统 `Alert.alert` 二次确认（destructive style），错误显示在该 section 的 footer。
- 分组头/尾：`.subheadline` secondaryLabel，`directionalLayoutMargins = 10 / 22 / 10 / 22`；带 headerValue 时头部上下 14。
- 选中项：`UIListSection` 里 `selected: true` → `accessories.append(.checkmark())`（外观页的两选项就是这么做的）。
- 文案规则（设计文档）：删掉营销文案；登录错误从 section footer 移到 toast。

### 2.4 新建会话（CreateSessionScreen）

- 呈现：`formSheet`，`sheetAllowedDetents: [0.62, 1]`，`sheetGrabberVisible: true`，`headerVariant: 'transparent'`。
- 布局：`ComposerSheet` = 「原生分组列表（`flex: 1`）+ 绝对定位在底部的 composer」，composer 高度通过 `onLayout` 回填给列表的 `bottomInset`，避免列表内容被输入框盖住。
- 顶部 `NativePagedList` 分页（`项目 / 对话` 两页，**横向分页而非 segmented**；规格里原本计划的 `UISegmentedControl` 因 RPC 不支持类型字段而未做），`selectedPage` 双向同步。
- 表单行（全部是「行 + chevron」的多选一，点开 `present` 一个 picker sheet，不在行内内联控件）：项目 / 电脑 / 模型 / Agent / 分支（分支用 `Alert.prompt` 纯文本输入，`slice(0, 255)`，可预填当前值）。GitHub 项目时「起始分支」出现、工作方式隐藏。
- **创建和第一条消息是同一个动作**：没有「创建」按钮，底部就是聊天页同一个 composer 组件（`NativeComposer`，`sendHandoff` 可选）。标题由首条消息推导（`draftTitle()` 取第一行前 24 字）。关闭用系统 xmark，不用「取消」文字。
- 失败：不重试写入；发送按钮转 spinner，失败弹 toast 并保留草稿，以同步后的列表为准。

### 2.5 登录 / 引导页（OnboardingScreen）

- 呈现：iPhone `pageSheet`、iPad `formSheet`；`dismissible: false`、`headerShown: false`（全屏感，没有导航栏）。
- 排版（`OnboardingScreen.tsx`）：外层 `ScrollView` `contentContainerStyle = { flexGrow: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 24, gap: 36 }`。
  - 头部：logo 64×64 `borderRadius 15`；标题 30 / 36 / weight 700 / `letterSpacing -0.6` / 居中（**这是全 app 唯一超过 23pt 的字号**）
  - 特性列表：3 行，行 `flexDirection: row, gap: 16`；图标 `NativeSymbol` pointSize 28、tint accent、容器 36×36 且 `marginTop: 2`；文案块 `flex: 1, gap: 2`，标题 weight 600（body）、正文 `variant="secondary"`
  - 底部按钮区：`paddingHorizontal: 24`、`paddingBottom: max(insets.bottom, 16)`、`gap: 14`
- 按钮：`NativePressable` 内叠 `NativeGlassSurface(radius 26, tint = primary ? accent : '')`，`minHeight: 52`，文字 weight 600（玻璃胶囊按钮，不是实色矩形）。
- 动效：`react-native-reanimated` 的 `FadeInUp`，`delay(300 + step*90).duration(500)`、`withInitialValues({ transform: [{ translateY: 14 }] })`，**`useReducedMotion()` 为真时整体不播**（返回 `undefined`）。
- 等待态：不换页，把特性列表换成「验证码卡片 + 转圈」——验证码卡片 `padding 20 / border 16 / continuous / colors.fill / gap 10`，验证码本体 mono 28 / 34 / weight 600 且 `selectable`；下面是 `ActivityIndicator(secondaryLabel)` + `variant="secondary"` 文案，`gap 28`。
- 安全区：唯一手动读 `useSafeAreaInsets()` 的页面（底部 `max(insets.bottom, 16)`）。

### 2.6 次级页面

| 页面                             | 呈现                                 | 要点                                                                                                                                                                          |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账户（AccountScreen）            | push                                 | 1 行账户卡（头像/名/邮箱）+ 1 个 destructive 行「退出登录」（footer 放错误）；确认走 `Alert.alert`                                                                            |
| 外观（AppearanceScreen）         | push                                 | 单分区 + footer 说明；两个选项用 `selected` + checkmark；`accessibilityValue = "已选中"`                                                                                      |
| 已归档（ArchivedSessionsScreen） | push                                 | 同收件箱 `contentStyle` 行 + 分组预览 + 滑动操作，空态走 placeholder                                                                                                          |
| 工具详情（ItemDetailScreen）     | formSheet `[0.6, 1]` 初始 0，grabber | `Screen`（滚动）+ `gap 12` 的块序列；diff 块/命令块/输出块/原始 JSON 折叠块；加载 = `ActivityIndicator` marginTop 24；失败 = meta danger + 重试按钮；truncated 时「加载更多」 |
| 权限 / 提问（PermissionScreen）  | formSheet，自动弹出                  | 必须 `formSheet`（`pageSheet` 下三个 detent 字段全部失效）；选项按钮直接来自 `options[]` 不硬编码「允许/拒绝」；滑掉不写 outcome；提交中保持打开                              |
| 模型（ModelScreen）/ Picker      | push（sheet 内部）                   | sheet 内 push 由嵌套 `ScreenStack` 承载，标题由 `present(..., { title })` 覆写                                                                                                |

---

## 3. iOS 平台细节

### 3.1 材质 / Liquid Glass

见 §1.4。补充三个容易漏的点：

1. **分组玻璃**：多个玻璃元素靠近时必须套一层 `UIGlassContainerEffect(spacing: 8)`，否则两个胶囊不会像系统那样「吸附—融合—分离」。
2. **`isInteractive = true`** 必须显式打开，否则触摸/滚动时不产生系统的形变反馈。
3. **sheet 的透明要配套**：iOS 26 才透明 + 列表透明 + 行显式不透明卡色（三件事缺一不可）。踩坑记录：_「`setTransparent` 里漏掉 `collection.reloadData()`，导致 prop 在 `sections` 之后到达时 cell 已经渲染完，改动完全不生效——两次构建截图一模一样，看起来像效果无效，其实是根本没跑」_。

### 3.2 键盘处理（他们的做法是「不处理」）

三个已验证事实（设计文档原文）：

- **`InputAccessoryView` 是 RN 内置的**，直接挂在 iOS 键盘上。装了它就**不需要 `KeyboardAvoidingView`**，composer 跟随键盘是系统行为。
- 聊天页用的是更彻底的做法：`composer.bottomAnchor == keyboardLayoutGuide.topAnchor`（`LodyChatView.swift:397`）。键盘弹起/交互式收起/快捷栏全由系统驱动，没有动画代码、没有 notification 监听、没有自定义 inset 计算。
- `collection.keyboardDismissMode = .interactive`（**必须 interactive**，不是 onDrag/none），配一个 `cancelsTouchesInView = false` 的 tap 手势做点击空白收键盘，并在 `gestureRecognizer(_:shouldReceive:)` 里排除 `UITextView`（否则点输入框也被收）。
- Sheet 里的 composer（`LodyComposerView`）**在窗口坐标系里量键盘重叠**，把高度上报给 RN 让 sheet detent 跟着让位。注释写明原因：_「Keyboard frames use screen coordinates; RN sheet layout uses local coordinates. Measure the host's actual overlap so sheet detents and its inner header cannot leave the send row under the prediction bar.」_ 也就是：**sheet 内不要用 RN 的键盘避让**，它在局部坐标下会少算。
- 列表页 `keyboardDismissMode = .onDrag`。
- 输入框高度随文字增长：`inputHeight = min(maximumCollapsedHeight, max(expanded ? 68 : 48, 内容高))`，超过上限才 `isScrollEnabled = true`。

### 3.3 触觉反馈（haptics）

| 位置                                          | API                                         | 参数                                                            | 出处                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 发送消息                                      | `UIImpactFeedbackGenerator(style: .medium)` | `impactOccurred(intensity: 0.85)`，且按钮变可用时先 `prepare()` | `ChatComposerView.swift:352,765,902`                                                                                                    |
| 一轮回复完成                                  | `UINotificationFeedbackGenerator()`         | `.notificationOccurred(.success)`，下一轮开始时 `prepare()`     | `LodyChatView+Transcript.swift:236-244` + `ChatHaptics.shouldNotifyTurnCompletion`（只在该轮仍是尾部、在窗口内、非 process 视图时触发） |
| 通用按压缩放按钮                              | `UISelectionFeedbackGenerator`              | `.selectionChanged()`                                           | `Press/LodyPressable.swift:31-33`                                                                                                       |
| 添加/移除附件                                 | `UIImpactFeedbackGenerator(style: .light)`  | `.impactOccurred()`                                             | `ChatComposerView.swift:504,710`                                                                                                        |
| 选择（模型/强度滑杆、附件 sheet、Tab 类选择） | `UISelectionFeedbackGenerator`              | `.selectionChanged()`                                           | `ChatComposerModelPanel.swift:285,294` 等                                                                                               |
| Toast / 横幅                                  | `UINotificationFeedbackGenerator`           | `.error` / `.success`                                           | `Toast/LodyToastOverlay.swift:87`                                                                                                       |
| 长按（图标长按）                              | `UISelectionFeedbackGenerator`              | `.selectionChanged()`                                           | `Chrome/LodySymbolButton.swift:116`                                                                                                     |

统一约束：只在**状态真正改变**时触发（`ChatHaptics` 是纯函数，被单测覆盖），并且所有动画路径都查 `UIAccessibility.isReduceMotionEnabled`。

### 3.4 大标题 vs 内联标题

**他们从不用大标题**：`headerLargeTitle: false` 是写死的（`PresentedPage.tsx:130`），且 header 透明 + 软滚动边缘。聊天页更进一步，是**自定义 `titleView` 按钮**（标题 + 副标题 + 可点），`item.style = .browser`。需要「标题+副标题+可交互」时，正确做法是 `UIButton.Configuration.plain()` + `subtitle` + `titleTextAttributesTransformer`（`.headline` / `.caption1`），不是自己拼两个 label，也不是 `navigationItem.subtitle`（他们只在转场期间用 `subtitle` 兜底，避免标题在返回动画里跳）。

### 3.5 SF Symbols

- 尺寸配置三档写法：`SymbolConfiguration(pointSize:weight:)`（图标按钮、行图标多用途，如行图标 pointSize 13、summary dot pointSize 6、`plus` 17 medium、`chevron.down` 5 medium、`arrow.up` 14 bold）；`SymbolConfiguration(textStyle: .title3, scale: .medium)`（列表行图标）；`SymbolConfiguration(font:)`（导航副标题符号，字号 = 副标题字号 − 3）。
- 颜色：`tintColor` 走 token 解析（`lodyTint()` 支持 `blue/purple/warning/danger/yellow/secondary/tertiary` 或 hex），排除 `destructive` 后默认 accent。
- **没有用 hierarchical / palette rendering / variableValue**（我搜过，仓库里没有）。
- 用了两处 symbol effect：发送按钮模式切换用 `configuration.symbolContentTransition = .init(.replace.byLayer)`（byLayer 只换变化的层，避免整图闪）；Toast 的 checkmark 落地用 `addSymbolEffect(.drawOn, options: .nonRepeating)`，且 `guard !UIAccessibility.isReduceMotionEnabled`。
- 需要「原地换图标」时（`plus` ↔ `xmark`），`LodySymbolButton.setSymbol` 会在 `symbol.fill` 与 `symbol` 之间自动选 `byLayer` 过渡。

### 3.6 下拉刷新与滑动操作

- 下拉刷新：原生 `UIRefreshControl` 挂在 `LodyGroupedList` 的 collection 上，RN 通过 `onRefresh` 事件 + `setRefreshing` / `setRefreshEnabled` 两个 prop 驱动（启用时才挂上，禁用时移除，避免残留）。
- 滑动操作：`UICollectionLayoutListConfiguration.leading/trailingSwipeActionsConfigurationProvider`，由**数据声明**（行里的 `actions` / `leadingActions`），`UIContextualAction(style: destructive ? .destructive : .normal)`，图标 `UIImage(systemName:)`，可指定 `backgroundColor`（置顶用 `yellow`）。
- 一个细节：滑动状态下要**冻结视觉态**，否则行背景会跟着高亮闪 —— `LodyListCellBackground.visualState(for:)` 在 `isSwiped` 时清掉 `isSelected/isHighlighted` 再交给 UIKit。
- 长按菜单：`UIContextMenuConfiguration`，菜单项由 `menuActions` 声明；带 `preview: 'session'` 时给一个真实会话预览 controller；`copyPath` 之类纯 UI 动作在原生侧直接写剪贴板。

### 3.7 过渡与手势

- 页面级：push 用原生 stack 的系统转场 + 交互式 pop；sheet 用 formSheet 的 detent 拖拽 + grabber。
- **选中态与返回的配合**（`AGENTS.md` 硬规则）：导航型行在返回前保持选中，**沿转场同时取消选中**；交互式返回被取消时恢复选中；普通动作行立即取消选中。实现见 `LodyChatView+Scroll.swift:104-119`（`transitionCoordinator.animate` + `context.isCancelled`）。
- 行展开（长消息/附件网格）：`UIView.animate(duration 0.25, .curveEaseInOut, .beginFromCurrentState)`，同时保持内容偏移不跳（`contentOffset.y = min(bottom, max(-top, offset))`），结束时 `UIAccessibility.post(.layoutChanged)`；reduce motion 时直接设置。
- **发送动画（`ChatSendHandoff` + `ChatThrowCurve`）**：从 composer 截一张快照，飞到转录里的目标位置。
  - `duration = 0.300`，位置曲线 `cubic-bezier(0.49, 0.09, 0.41, 0.91)`，二次贝塞尔弧（`arcRatio 0.24`、`arcApex 0.44`）后接一段弹簧收尾（`springResponse 0.32`、`dampingRatio 0.62`，`settleVelocityCarry 0.55`、`settleKick 90`）
  - 形变：`scale` 关键帧 `1 → 0.86(@0.43) → 1.005(@0.71) → 1`；`bounds.size` 用独立曲线 `cubic-bezier(0.54195118, 0, 0.58, 1)` 且 `speed = 2.0`
  - 背景色从采样到的源背景过渡到 `.lodyUserBubble`；快照层与目标文字做 0.3×duration 的交叉淡入
  - 动画期间隐藏目标内容、`UIAccessibility.post`，5 秒超时兜底取消；`UIAccessibility.isReduceMotionEnabled` 时直接落地
- 队列消息的「Steer」是直线轨道（`straightTrack`，同缓动同时长，无弧线、无形变）。
- 返回手势期间的标题处理：`titleDisappearing` 期间把副标题写回 `navigationItem.subtitle`，取消时重挂 `titleView`（否则标题在动画里闪）。
- iOS 26 的滚动边缘：`collection.topEdgeEffect.style = .soft` / `.bottomEdgeEffect.style = .soft`；列表页用 `UIScrollEdgeElementContainerInteraction` 让悬浮分段控件参与边缘塑形。

### 3.8 安全区

- 统一用 `contentInsetAdjustmentBehavior = .automatic`（collection / list 都是），不手算 `safeAreaInsets`。
- composer：`bottom == keyboardLayoutGuide.top`，因此「键盘隐藏时它等于底部安全区」，不需要额外 padding；输入胶囊自身距 composer 底 8pt。
- 聊天滚动 inset：`bottom = max(0, bounds.maxY - composer.minY - collection.safeAreaInsets.bottom) + 8`（再加「锚定用户消息」时的额外留白），`verticalScrollIndicatorInsets.bottom = base`（滚动条**不**被额外留白影响）。注释解释了 0.5pt 死区的原因：_「Compensate even one pixel of reply growth: at 3x, a 0.5pt deadband lets the bottom follower move the pinned turn by 1px and back again.」_
- sheet 内 header 用 `topInsetEnabled: false` + 透明，避免双导航栏和硬边。
- 只有引导页手动读 insets（`max(insets.bottom, 16)`）。

---

## 4. Composer（输入区）细节

文件：`modules/lody-kit/ios/Chat/ChatComposerView.swift`（937 行）+ `ChatComposerLiquidGlassSurfaceLayout.swift`（结构）+ `LodyComposerView.swift`（独立宿主）。

**层级**

```
ChatComposerView (UIView)
└─ composer: UIVisualEffectView   ← UIGlassContainerEffect, spacing = 8
   ├─ mentionPanel      (@ 面板, 高 0 / min(240, rows*(50|58)+12), corner 18)
   ├─ queueView         (UIGlassEffect regular interactive, corner 20, 高 = 前 3 条 * 行高)
   ├─ notice            (UIButton, .dynamic(13), 高 = empty ? 0 : max(44, h+12))
   ├─ attachmentBar     (高 = empty ? 0 : 42, 瓦片 34pt)
   ├─ attachSurface     (44×44 玻璃胶囊，内含 plus 按钮)
   └─ inputSurface      (UIGlassEffect regular interactive, capsule maxRadius 26)
      ├─ input          (UITextView, 17pt，textContainerInset 13/16/13/46 折叠态)
      ├─ hint           (placeholder，距左 21、距顶 = 同 inset)
      ├─ accessoryBar   (高 = focused ? 44 : 0)
      ├─ mentionButton  (44×44, leading 52)
      ├─ modelButton    (高 44, 位于 send 左侧 -2, caption1, chevron 5pt)
      └─ send           (44×44, 内含 30×30 圆形视觉)
```

**关键数值**

- 输入胶囊：距右 16、距底 8；`capsule(maximumRadius: 26)`；正文 `textContainerInset` 折叠态 `top/bottom = max(0, (48 - font.lineHeight)/2)` ≈ 13、`left 16`、`right 46`（给发送键让位），聚焦态统一 13 / 16 / 13 / 16（发送键移到框内右侧）
- 输入高度：折叠最小 48，聚焦最小 68，上限 `maximumCollapsedHeight = 140`，超过转内部滚动
- 聚焦/失焦的**布局形变**：失焦时「附件胶囊」在左（leading 16）、输入胶囊 leading 8 跟随其后（两枚胶囊并排）；聚焦时附件按钮**移动到输入胶囊内部**（leading 22 → 容器 16，按钮 44×44、距内左 6、距底 -2），并换 `plus`（14 regular），整个形变用 `UIView.animate(0.24, .curveEaseOut, .beginFromCurrentState)`；符号用 0.16s、scale 0.7 → 1 的 `curveEaseOut` 弹出；reduce motion 时 `layoutIfNeeded` + 直接显示
- 模型/强度按钮：`caption1` 字体，主色 label、强度 secondaryLabel，`chevron.down` pointSize 5 medium、`imagePadding 5`、内容内边距 `0/8/0/6`，尾部截断；只有聚焦且模型列表非空才显示；点击弹 `UIPopoverPresentationController`（`sourceView = modelButton`, `permittedArrowDirections = .down`），面板宽 320、高 76（无强度档）或 132，行高 44/56/44，corner 14
- 附件菜单：`showsMenuAsPrimaryAction = true` + `UIMenu`（最近照片 / 照片图库 / 文件），三个 `UIAction` 都带 `UIImage(systemName:)`
- 粘贴：自定义 `UITextView` 子类重写 `canPaste` / `paste(itemProviders:)` / `paste(_:)`，`pasteConfiguration` 接受 `UTType.item`，命中附件类型就走附件管线
- 队列（发送中再发）：`ChatQueuedDraft` 行高 `max(44, 15pt行高 + 附件说明(12pt行高+2) + 10)`，最多显示 3 条；每行左侧文字、右侧 `arrow.up.circle`（13 medium）「Steer」按钮 44×44；行间 1px `.separator`（leading 16）
- 计数上限：输入 32000 字符（`shouldChangeTextIn` 里算 UTF-16 长度）

**发送键的三态**（`ChatComposerActionMode`）

| 态                       | 颜色       | 符号                  | 视觉                                                                  |
| ------------------------ | ---------- | --------------------- | --------------------------------------------------------------------- |
| send（有内容）           | systemBlue | `arrow.up`（14 bold） | 30×30 圆形，白色符号                                                  |
| loading（发送中/停止中） | systemGray | 无（换成进度弧）      | 15×15 自绘圆弧，`lineWidth 2.25`、`lineCap .round`、0.8s 线性无限旋转 |
| stop（无内容且正在运行） | systemRed  | `stop.fill`           | 同上 30×30 圆形                                                       |

态与态之间：底色 0.2s `curveEaseInOut`，内容 `transitionCrossDissolve` + 关键帧 `0.72` 缩放回弹（reduce motion 时只做 0.18s 交叉淡入）。不可用时 `sendVisual.alpha = 0.35`。无障碍 label/identifier 随态切换（`session-send` / `session-stop`），并提供「send/stop/sending/stopping」四种可朗读文案。

**状态逻辑**：`stop` 条件 = `无内容 && running`；`canSend` 条件 = `可编辑 && 有内容 && 非 loading && 非 controlling`；`sending` 由 RN 的 `composerJSON` 驱动。notice 文案（断线暂停 / 同步停止 / 失败草稿）也在同一层，可点时变 systemBlue 且 `accessibilityTraits = .button`。

**草稿**：`draftKey` 由 RN 给出（`draft:{userId}:{workspaceId}:{sessionId}`），native 侧 `LocalStore`（SQLite）落盘；`didMoveToWindow == nil` 与进后台时保存；发送时 `takeDraft()` 取走并清空（清空 token 机制 `clearDraft/restoreDraft/pendingSend` 防止重复发送与错位恢复）。**发送失败时把草稿与附件一起还给输入框**（`failedDraft` → 点 notice 合并回 `input.text`）。

**键盘**：`bottom == keyboardLayoutGuide.top`（聊天页）/ 窗口坐标量重叠上报高度（sheet 内）。无 `KeyboardAvoidingView`。

---

## 5. 值得直接抄的 10 条

1. **Composer 钉在 `keyboardLayoutGuide.topAnchor`，删掉 `KeyboardAvoidingView`。** 一行约束换掉整套抖动来源，键盘弹起、交互式收起、快捷栏全部由系统接管。同时 `collection.keyboardDismissMode = .interactive` + `cancelsTouchesInView = false` 的空白点击收键盘（并在 delegate 里排除 `UITextView`）。sheet 内则改为**在窗口坐标量键盘重叠**再上报高度。
2. **用户气泡 = accent 与画布混色 10%（浅）/14%（深），不是 accent 实色。** `UIColor { traits in accent.mixed(with: background, amount: 0.10/0.14) }`，corner `19` + `.continuous`，内边距 13/10，最大宽 `0.84 × 列宽 − 26`，上限 `140pt` 折叠 + `CAGradientLayer` 三档渐隐（`h-58` 起 → `h-30` 结束）+ 44pt 展开按钮。助手正文**全宽无气泡**。
3. **工具调用按连续同类聚合成一行灰字，不是一个 tool_call 一张卡。** 图标 20×20 / pointSize 13 / leading 24，文字 13pt secondaryLabel，措辞按 kind 映射（`read→doc.text.magnifyingglass`、`execute→terminal`、`edit→square.and.pencil` + `+N −M`），`in_progress` 行尾 20×20 spinner，`failed` 转 systemOrange 加「失败：」前缀；点开走原生 sheet。**这一条对「质感」的贡献最大**：转录从「一堆卡片」变成「一段可读的叙事」。
4. **文本角色化 + 六档间距 + 禁裸 `fontSize`。** 一个 `AppText`（title 20/26、body 17/25、secondary 15/21、meta 13/18、eyebrow 11/14+0.08em、mono 13/20）、一个 `space = [4,8,12,16,20,24]`、路径/分支/ID/代码归 mono。缩放 `allowFontScaling={false}` + 自己 clamp 到 `14/17 ~ 23/17`，原生侧用**同一个 clamp 系数**乘字号（`UIFont.dynamic(of:)`），保证 RN 与原生并排不差档。
5. **设置页与所有列表用原生 `UICollectionViewListCell`。** `UICollectionViewCompositionalLayout.list(appearance: .insetGrouped)` + `UIListContentConfiguration.subtitleCell()` + 原生 accessories（`.label` / `.checkmark` / `.disclosureIndicator` / `.customView` / `.outlineDisclosure`）。图标 `textStyle: .title3` + 默认 accent tint；路径类副标题用 `monospacedSystemFont(footnote.pointSize)`；危险行只染红文字。空态用一个居中 `.subheadline` label（不是每页各写一套 loading/empty/error）。
6. **导航栏 action 一律 `Stack.Toolbar`，`headerRight` / `headerLeft` 不用。** `<Stack.Toolbar.Button icon="plus" separateBackground tintColor={accent} />`、`<Stack.Toolbar.Menu>` + `MenuAction`（`isOn` 表选中）、`Spacer` 切玻璃分组、`SearchBarSlot` 配集成搜索栏。RN 视图塞进 header 拿不到尺寸、位置、玻璃分组和溢出菜单。
7. **流式文字：逐字 alpha 淡入 + 时间基滚动收敛，而不是每帧 `scrollToEnd`。** 淡入：每新增字 0.22s 线性 opacity 0→1，`stagger = min(0.012, 0.08/(count-1))`；提交节流 `commitInterval = min(0.096, 0.048*(1 + tailLength/256))`；超过 1024 字符的长回复改用整块动画（避免整 collection 每帧 invalidate）。滚动：`CADisplayLink` + 指数收敛 `next = current + (target - current)*(1 - exp(-elapsed/response))`，跟底 `response 0.10`、行高生长 `0.06`，并对亚像素步长做「直接吸附」处理；贴底跟随只在 `followsBottom && !isDragging && !isDecelerating` 时生效；用户拖动 > 80pt 才显示「回到底部」（玻璃胶囊，44×44，`arrow.down` 14 semibold）。
8. **触感全套 + reduce motion 守卫。** 发送 `UIImpactFeedbackGenerator(.medium).impactOccurred(intensity: 0.85)`（可点前先 `prepare()`）；一轮完成 `UINotificationFeedbackGenerator().notificationOccurred(.success)`；按压/选择 `UISelectionFeedbackGenerator().selectionChanged()`；附件增删 `.light`。**每个动画点都查 `UIAccessibility.isReduceMotionEnabled`**，为真时直接设置终态而不播动画。
9. **玻璃三件套 + 滚动边缘雾化。** `UIGlassEffect(.regular)`（务必 `isInteractive = true`）、多个玻璃元素外面套 `UIGlassContainerEffect(spacing: 8)`、按钮用 `UIButton.Configuration.glass()` + `.capsule`；collection 上 `topEdgeEffect/bottomEdgeEffect = .soft`，悬浮控件注册 `UIScrollEdgeElementContainerInteraction`；iOS 26 的 sheet 透明必须同时做「列表透明 + 行显式不透明卡色 + 变更后 `reloadData()`」。
10. **圆角与线的纪律：所有圆角配 `.continuous`，所有分隔线 `1/displayScale`，全 UI 只有 Toast 一处阴影（opacity 0.08 / radius 12 / offset 0,4）。** 圆角只用 19（气泡）/ 26（分组卡）/ 16（图片）/ 12（文件行、代码块、按钮）/ capsule（胶囊）。这一条是「一眼看出是原生 App 还是网页感」的分水岭。

---

## 6. 他们踩过的坑与明确取舍

**信息架构**

- 首屏从项目列表改成**会话收件箱**：「项目是写代码时的组织单位，不是手机上找东西的方式 —— 它降级成搜索关键词。导航从三层变两层。」删掉 `ProjectSessionsScreen`，Tab 从「电脑」改名「会话」。
- 没有筛选器，搜索同时匹配标题与项目名；已归档不进收件箱，只能搜到。
- 状态语言：「状态永远是**色 + 形**成对出现，不靠颜色单独承载」。`sessionStatus()` 拼进 subtitle 的字符串**全部删除**，状态走独立的 leading accessory 槽位（`circle.fill` 脉冲 / `exclamationmark.circle.fill` / `xmark.octagon.fill` / `circle` / `checkmark` / `archivebox`）。
- 新建会话**删掉「名称」字段**，标题由首条消息推导。

**错误处理**

- 删掉「三套机制」（placeholder 字符串 + section footer 塞错误 + 裸 `<Text>`），收敛成 `ListState`（空态）与 `ToastHost`（错误）。**登录错误从 section footer 移到 toast**。
- Toast 必须活在**独立窗口**（`PassThroughWindow`）而不是 React 树里。原话：_「A React-tree overlay can never sit above a presented sheet, which is where most failures surface.」_
- 载荷超 12 MiB 不再静默丢整帧，改为发 `{ overflow: true }` 空信封 + RN **保留上一份完好快照**并在顶部提示「同步已停止 · 内容可能不是最新」。**不静默，也不清空。**
- 写权限结果：**本地写入不等于机器收到**，sheet 不立即关闭，进「提交中」直到上传确认；结果不明时先重读 `outcome` 再决定，**不盲目重发**（项目硬规则：never automatically replay writes across runtime recovery）。

**性能/架构取舍**

- 不做手写滚动跟随的复杂阈值：`maintainVisibleContentPosition` **不是贴底跟随**（它是为倒置聊天列表设计的），所以「手写跟随不能整段删掉，只能简化」。
- 保持**非倒置列表**：倒置会让轮次头、hairline、滚动边缘效果全部要反过来，代价大于收益。
- 工具 payload **不进流**（`content[]` / `rawInput` / `rawOutput` / terminal 输出留在 doc，点开 sheet 才取），只有正文全量进流。但明确写下了**省什么不省什么**：正文仍与载荷体积线性相关，只是与工具输出总量脱钩 —— _「这个判断需要在第 1 步用真实长会话实测，不成立就直接上增量投影」_。
- `itemId` **绝不用数组下标或内容哈希**（下标在并发插入下会漂移，哈希在流式追加时每帧都变），用 `LoroList.getIdAt()` 的 `{peer, counter}`；而且必须在 WKWebView 投影阶段读出（`toJSON()` 会丢容器身份）。
- 节流**不能只节流 emit**：只挡桥不挡 CPU 的话每次 doc 更新照样全量 `toJSON` + 投影。所以按脏 entry 缓存投影，但「状态翻转、turn 完成、出现待授权请求」**立即刷新**（延迟 200ms 就能被感知）。
- 不自己写 Markdown 渲染：直接用 `MarkdownView` + `Litext`（cmark-gfm + CoreText），只加两个注入点（`TextLabel.Layout` 子类换 `draw`、`MarkdownTextView` 加 `textLabelView` 参数），**fork 只放注入点，淡入实现留在自己仓库**。已知上限也写明：HTML 块按纯文本、列表里的表格/代码块会被提到顶层。
- Diff 分两条路径：全屏走预热过的共享 DOM WebView（`navigationCount` 不增加作为硬门槛），内嵌走自研 UIKit/TextKit（无内层滚动，避免跟 sheet 抢手势）。
- 明确**不做**：Android（连 stub 都不加）、通用 WebView 池、绿色强调、把源码写进日志或 Debug probe。

**具体 bug（都是「看起来像设计没生效，其实是没跑」）**

1. `LodySymbolButton` 用 `Events("onPress")` 与 RN 内建冒泡事件 `topPress` 撞名 → `Invariant Violation` 白屏。改名 `onSymbolPress`。
2. 列表默认图标 tint 是 `.systemBlue`，与 accent 靛蓝并排有色差 → 加 view 级 `accent` prop，所有行统一。
3. 行标题的 `action && !disclosure → accent` 启发式把选择器选项也染蓝 → 删掉这条规则，**标题永远是 label（destructive 除外）**。
4. `setTransparent` 漏 `collection.reloadData()` → 透明 prop 在 sections 之后到达时 cell 已渲染完，完全不生效。
5. `present()` 走扁平根 Stack，sheet 里再 push 会落到 sheet **后面** → sheet 必须自持嵌套 `ScreenStack`（三层关系：expo-router `<Stack>` 是布局层、react-navigation native-stack 是 JS 路由状态层、`react-native-screens` 的 `ScreenStack` 才是真的 `UINavigationController`）。
6. 把 RN 视图塞进 `headerRight` 模仿 bar button → 尺寸/位置/玻璃分组/溢出菜单全拿不到，改 `Stack.Toolbar`。
7. `:unassigned` 项目没有工作目录却出现在选择器里，且三个同名无法区分 → 过滤掉。
8. **composer 不设 `lineHeight`**（见 §1.2）。

**可达性/规模纪律**

- 至少 44pt 触控目标（行高地板、`tapFloor`、`minHeight` 到处体现）。
- `AGENTS.md`：单文件 500 行上限、React 组件 300 行上限。
- 不用 `CODE_SIGNING_ALLOWED=NO`，模拟器也必须正常签名——因为签名相关的行为（Keychain 等）不签名就不成立。
- 验证不靠实现快照：UI 基线必须在**未登录、无凭据、无云、无机器**的条件下跑，用生产组件 + 在边界注入确定性数据；截图给视觉态、视频给时序行为，缺场景/超时算失败。

---

## 7. 如果只能改 5 件事（按性价比排序）

1. **把设置页和所有列表换成原生分组列表**（`UICollectionViewCompositionalLayout.list(appearance: .insetGrouped)` + `UICollectionViewListCell` + `UIListContentConfiguration` + 原生 accessories），同时把配色收敛到 `PlatformColor` 语义色 + 一个 accent 靛蓝、把文本收敛到六个语义角色、间距收敛到六档。这是**面积最大、最容易被感知**的一步，而且几乎不涉及交互逻辑。

2. **重做 Composer**：原生输入胶囊（`UIGlassEffect` + capsule 26）、44pt 按钮、`bottom == keyboardLayoutGuide.top`、三态发送键（blue ↑ / gray 弧 / red ■）、可选模型强度 popover、聚焦时附件按钮并入胶囊内的形变。输入区是用户停留时间最长的部件，且现在是「RN 输入框 + 键盘避让抖动」的典型失分点。

3. **转录重排**：用户右侧 accent 混色气泡（唯一气泡）、助手全宽正文、连续工具调用聚合成一行灰字、轮次头（时间 + 已工作 N 分 M 秒）+ hairline、工具行点开原生 sheet。**不要**给每个 tool_call 做卡片。这条把「聊天记录」从信息堆变成可读叙事。

4. **流式渲染与滚动跟随**：逐字 alpha 淡入（0.22s / stagger ≤12ms）+ 尾沿节流（48–96ms）+ 时间基收敛跟随（`1-exp(-elapsed/response)`，response 0.10）+ 用户上滑暂停、距底 > 80pt 出现玻璃「回到底部」按钮。这一步专治「生成期间文字一跳一跳、视图被拽回底部」这两个最伤的体感问题。

5. **平台细节基线一次性补齐**：全部圆角 `.continuous`、分隔线 `1/displayScale`、只保留 Toast 一处阴影、`keyboardDismissMode = .interactive`、至少 44pt 触控、所有动画加 `isReduceMotionEnabled` 早退、触感按 §3.3 表铺开、导航栏 action 走原生 toolbar、sheet 透明三件套。单条改动都小，但合起来决定「像不像原生 App」。

---

## 附：没找到 / 明确不存在的

- 没有 spacing token 之外的间距常量体系；也没有 radius / shadow / elevation token，三者都是就地写死的字面量（气泡 19、分组卡 26、Toast 阴影 0.08/12/0,4）。
- 没有 Tailwind / NativeWind / 任何 CSS-in-JS；没有 design token 的 JSON 单一源（RN 与 UIKit 各一份，靠人同步）。
- 没有使用 SF Symbols 的 hierarchical / palette / variableValue rendering；symbol effect 只有 `.drawOn`（Toast）与 `contentTransition` 的 `.replace/.byLayer`。
- 没有大标题（`headerLargeTitle: false` 写死）。
- 没有骨架屏（skeleton）；加载态只有三种：列表居中 placeholder、行内 `UIActivityIndicatorView`、详情页 `ActivityIndicator` + marginTop 24。
- 主题里没有「浅色/深色两套排版」差异；只有背景色 soft/black 可切。
- Android 实现不存在，且 `AGENTS.md` 明确禁止添加（连 fallback stub 都不许）。
