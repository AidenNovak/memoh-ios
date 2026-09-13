# Memoh iOS 设计基线

> 版本：v1（设计基线，非实现规格） · 目标设备：iPhone 优先，iPad 后续
> 技术路线：Expo + React Native 基座，关键交互（Chat 消息流、输入器、sheet）用 Swift/UIKit 原生实现
> 事实源：`reference/memoh/apps/web`（Vue 3 Web 前端）、`reference/memoh/spec/swagger.json`
> 注：`packages/ui`（@felinic/ui）是未初始化的 git submodule，token 精确值从 Web 消费侧（`apps/web/src/style.css`、`pages/dev` 设计系统墙、`constants/color-schemes.ts`）重建，个别值标注"仅锚点"。

---

## 0. 一页结论

1. **iOS 端 = Chat 主轴 + 审批中枢**。Web 的落地页即 Chat（`router.ts:20-28`），iOS 继承这一决策：打开 App 就是"最近的会话"，而不是 dashboard。
2. **手机上最大的差异化价值是 tool-approval（工具审批）**——agent 7x24 在线，用户在路上点"允许/拒绝"是桌面替代不了的场景。审批必须做成系统级体验（push 通知 → 一键进审批 sheet）。
3. **配置重型全部砍掉或降级为只读**：providers/web-search/memory/voice/video/email 六个设置页、bot 详情 18 个 tab，手机上只保留"看状态 + 开关"，全量编辑回 Web。
4. **视觉语言继承 Web 的四个核心决策**：单一紫色 accent 的克制使用、发丝线代替阴影、easeOutExpo 单一动画曲线、双平面分层背景——但全部翻译为 iOS 语义色与原生控件，不搬运 CSS。
5. **Web 的中英分 script 字重补偿（Latin 420 / CJK 340）不要搬**。那是补偿 Inter/MiSans 光学差的 hack；SF Pro + PingFang 由系统免费完成同样的事，直接用 Dynamic Type 档位。

---

## 1. Web 端信息架构盘点与 iOS 取舍

### 1.1 Web 路由全表（`apps/web/src/router.ts`）

顶层 5 个 + dev-only 1 个。所有业务路由需 auth（`router.ts:259-290`）。

| 路径 | 页面 | 性质 |
|---|---|---|
| `/` | **渲染 null**，chat UI 常驻挂载在 App.vue | 落地页 = Chat |
| `/bot/:botName?` | 同上，仅同步 URL | Chat |
| `/settings/*` | 15 个子路由 | 配置/查看混合 |
| `/onboarding` | 5 步向导 | 首次配置 |
| `/login` | 登录 | — |

`/settings` 子路由（`router.ts:61-208`）：

| 页面 | 性质 | iOS 取舍 |
|---|---|---|
| `bots`（含 new/progress/:botName） | bot 列表 + 详情 **18 个 tab**（`bots/detail.vue:417-437`） | **列表保留；详情降级**为 overview/schedule/channels 状态查看 |
| `providers` / `web-search` / `memory` / `voice` / `video` / `email` | 同一模式：BackendCard 列表 + provider 模板表单，**全部配置重型** | **砍**。只读状态并入"设置→能力"一页 |
| `runtimes` | runtime 管理 | **砍**（查看态并入 bot 详情） |
| `usage` | token 用量图表（`usage/index.vue:1-31`） | **保留**（查看型，天然适合手机） |
| `people` | 成员表格，adminOnly | **砍** |
| `supermarket` | skills/connectors 商店 | **降级**为浏览（安装回 Web），MVP 砍 |
| `appearance` / `profile` / `about` | 轻表单 | **保留**（原生 Settings 形态） |
| `keyboard` | 桌面快捷键 | **砍** |
| `memory-graph` | 记忆图谱可视化 | **砍**（Web 差异化能力） |

### 1.2 Web 导航结构（`src/layout/` + `src/components/sidebar/`）

- Chat 区侧栏三段：**BotSwitcher（顶部）→ 三视图切换 sessions/files/schedule（`sidebar/index.vue:59-103`）→ Settings 入口（底部）**。
- 设置区侧栏四组：Bots/Runtimes/Supermarket；capabilities（Providers…Email）；team（People/Usage）；preferences（Appearance/Keyboard/Profile/About）（`settings-sidebar/index.vue:246-284`）。
- Web 移动端（<768px）是 MobileTopBar + 左滑 Sheet 导航（`mobile-nav-sheet.vue:1-70`），**没有底部 tab bar**——Web 移动端不是我们的参照，iOS 原生自己定义。

### 1.3 关键能力裁决

| 能力 | Web 实现 | iOS 裁决 | 依据 |
|---|---|---|---|
| 容器桌面串流 | WebRTC `<video>` + 键鼠回传（`display-pane.vue:883-895`） | **砍**。MVP 不做；远期可做"看"不做"控" | 手机屏上远程桌面是伪需求，键鼠回传在小屏无意义 |
| 终端 | xterm pane（`terminal-pane.vue`） | **砍**。远期只读 tail | 手机打字进终端体验极差 |
| dockview 多 pane 分屏 | chat/file/preview/asset/terminal/browser 六 pane（`chat-workspace.vue:43-48`） | **砍**，改为全屏页间切换 | 手机没有多窗格空间 |
| Chat 流式 + 工具调用 + 审批 | local-channel WS（swagger `:10417`）、composer-panel-approval | **全量保留，原生实现** | 核心价值 |
| 会话/文件/定时任务 | 侧栏三 panel | **保留**，files 只读浏览 + 预览 | swagger containerd 域有完整文件 CRUD |
| 用量 | 图表 + 过滤器 | **保留** | 查看型 |
| provider 配置族 | 6 页表单 | **砍**为只读状态行 | 手机上是"看状态"不是"全量编辑" |
| onboarding 建 bot | 5 步向导 | **砍**。手机上不允许创建 bot，提示去 Web | 创建涉及 provider 选择等重决策 |

**一句话取舍原则：手机 = agent 的遥控器与审批台，不是 agent 的产房。**

---

## 2. 设计语言提取与 iOS 映射

### 2.1 色彩

品牌默认方案 `memoh` = 紫色系（`constants/color-schemes.ts:17-19`）：

| 角色 | Light | Dark | iOS 映射 |
|---|---|---|---|
| background | `oklch(0.984 0.0024 72)` ≈ `#FBFAF8` 微暖 | `oklch(0.152 0 0)` | **自定义** `backgroundPrimary`（微暖是品牌特征，不用纯白 systemBackground） |
| card/editor | `#FFFFFF` | `oklch(0.21 0 0)` | `backgroundElevated` ≈ secondarySystemBackground 角色 |
| chrome 面 | ≈`#F9F9F9`（`style.css:56-76`） | `oklch(0.185)` | `backgroundChrome` ≈ tertiarySystemBackground 角色 |
| foreground | `oklch(0.21 0.004 95)` | `oklch(0.86 0 0)` | 直接映射 **label / secondaryLabel** |
| **brand 紫** | `oklch(0.55 0.22 290)` | `oklch(0.72 0.16 290)` | **全局 tintColor**，SwiftUI `.tint`，UIKit `UIView.tintColor` |
| 用户气泡 | 浅薰衣草 `rgb(238,229,254)` / 深紫黑字；暗色**翻转为实心深紫 `rgb(83,45,141)` + 白字**（`style.css:153-173, 188-193`） | 同左 | 自定义 `chatUserBubble` / `chatUserBubbleForeground`，亮暗两套**不是简单反相** |
| 语义色 | success/warning/info 各五件组（soft 底 + 深字 + border，`token-catalog.ts:17-64`），destructive 红 | 同左 | 映射 systemGreen/Orange/Blue/Red 的 **soft 变体**（`UIColor.systemGreen.withAlphaComponent(0.12)` 底 + 纯色字），保持"soft 底 + 深字"克制风格 |
| 分隔线 | `rgb(240 239 237)` 1.2px / 原生接缝 6-7% 黑（`style.css:88-99`） | — | **separator**，hairline（1/scale px），无色差惊喜 |

换肤方案（ocean/forest/rose/amber）是 Web 差异化功能，**iOS 不做**，只取 memoh 一套。

**必须自定义、无法用系统语义色的**：微暖背景、品牌紫（含亮暗两档）、用户气泡两档、chat 过程标题色（`--cop-title`，比 secondaryLabel 再弱一档）。其余全部用系统语义色，让 App 跟随系统的无障碍与外观设置。

### 2.2 明暗主题

Web：`useColorMode` 加 `.dark` class，默认 system 跟随（`store/settings/index.ts:34,105-108`）。
iOS：**什么都不用做**——全部颜色走 asset catalog 的 light/dark 变体 + SwiftUI `Color(.label)` 系。设置里提供"跟随系统/浅色/深色"三档（`UIUserInterfaceStyle` 覆盖），与 Web 对齐。

### 2.3 字体与层级

Web：Inter + MiSans，UI 16px，chat 正文 16px/行高 1.48，字重按 script 光学补偿（`style.css:330-400`）。
iOS：**SF Pro / PingFang 系统栈，全部 Dynamic Type**：

| Web 用法 | iOS 文本样式 | 备注 |
|---|---|---|
| chat 正文 16px | `.body` | 不 pin 死，跟随系统字号 |
| 工具卡内文 13.5px | `.footnote` | |
| 消息 meta 12px | `.caption` | |
| 区块标题 | `.headline` / `.title3` | |
| 代码 13px | 13pt `UIFont.monospacedSystemFont`，**代码块可不跟随 Dynamic Type**（等宽排版稳定性优先） | |
| 按钮 14px wght 450 | `.body` + `.medium`（SF 的 medium ≈ 光学 450） | 不要搬 420/340 那些数字 |

### 2.4 圆角 / 间距 / 阴影 / 动效

| 项 | Web 值 | iOS 决策 |
|---|---|---|
| 卡片圆角 | `--radius-menu-shell`（小圆角 + border） | **10pt 连续圆角**（列表卡）/ **16pt**（气泡、composer，对应 Web `rounded-2xl`）/ inset grouped list 用系统默认 |
| 气泡 | `rounded-2xl` 16px（`message-item.vue:756`） | 16pt，带附件一侧角不变尖（Web 的尖角是桌面语言，iOS 气泡统一圆角） |
| 间距 | Tailwind 4px 基，语义 rung（`SectionSpacing.vue:33-46`） | 4pt 基网格：4/8/12/16/20/24/32，与 Web rung 一一对应 |
| 阴影 | **体系性排斥**，只留真浮层（`style.css:196-199`，全 app 仅 7 处） | **天然一致**：iOS 同样只在 floating 层（alert、popover、悬浮 pill）用系统投影，内容一律 hairline 分隔 |
| 动画曲线 | easeOutExpo `cubic-bezier(0.16,1,0.3,1)` 全家统一（`style.css:237-243`） | SwiftUI `.interpolatingSpring` 或 `timingCurve(0.16,1,0.3,1)` 自定义；按压 scale 0.97/150ms 直接继承 |
| 流式 shimmer | `tool-shimmer-text` 1.6s 扫光（`style.css:565-582`） | 原生复刻：渐变 mask 扫过 muted 文字，**尊重 Reduce Motion**（Web 也有 `prefers-reduced-motion` 降级，`style.css:608-622`） |

### 2.5 Web 惯用但 iOS 上"不原生"的做法 → 替代方案

| Web 做法 | 为什么不原生 | iOS 替代 |
|---|---|---|
| 居中 Dialog（无 X，靠 Cancel/Esc， `SectionOverlays.vue:36-60`） | iOS 居中弹窗仅用于 alert（破坏性确认） | **sheet（.sheet / pageSheet）**，iPhone 上从底部升起 |
| hover 态语言（`--ui-hover` 浅灰 overlay、tooltip、HoverCard） | 触屏无 hover | **按压态**（高亮 + 0.97 缩放），tooltip 信息改为长按 context menu 或页面内常驻说明 |
| 5px 自绘滚动条（`style.css:770-800`） | iOS 滚动条是系统瞬态指示器 | 不做任何自绘，用系统 |
| 小圆角卡片 + 边框做设置列表 | iOS 设置列表的母语是 inset grouped | **SwiftUI Form / inset grouped List**，separator 对齐 text |
| ghost hover 按钮 | 同上 | iOS 的 ghost = **`.borderless` / tint 文字按钮**，按压显灰底 |
| 链接点状下划线 + hover 变紫（`style.css:640-760`） | 触屏不需要悬停反馈 | 直接 brand 紫着色（SF 风格），不加下划线 |
| 搜索框在侧栏顶部 | — | `.searchable` + 导航栏搜索框（下滑出现） |
| 右键 ContextMenu | — | **长按 context menu**（原生 UIContextMenu），顺带预览 |
| 键盘快捷键页 | — | iPad 上改做 keyboard commands（⌘），不做页面 |

---

## 3. iOS 信息架构

### 3.1 导航形态

**底部 Tab Bar（3 个）+ 原生 stack push + sheet**，替代 Web 的"侧栏三视图 + 设置覆盖层"：

```
┌─────────────────────────────┐
│  Tab 1: 会话 (Sessions)      │  ← 默认 tab，落地即最近会话列表
│  Tab 2: 定时 (Schedule)      │  ← 定时任务查看/启停
│  Tab 3: 我的 (Settings)      │  ← 设置/用量/能力状态/关于
└─────────────────────────────┘
```

全局第一交互 **BotSwitcher** 从 Web 侧栏顶部移到**导航栏标题位**（大号标题 + 下拉菜单，类似 Files/Mail 的邮箱切换）。

页面层级（→ = push，⇑ = sheet）：

```
会话 Tab
 ├→ Chat（默认落地 = 当前 bot 最近会话）
 │   ├→ 会话内文件改动详情（diff 全屏）
 │   ⇑ 工具审批 sheet（也可从 push 通知冷启动直达）
 │   ⇑ 图片/文件预览（QLPreview / 全屏 lightbox）
 │   ├→ 后台任务列表（subagent/后台命令状态）
 ├→ 文件浏览器（Chat 内入口或会话页工具栏）
 │   ├→ 文件预览（代码/图片/markdown）

定时 Tab
 ├→ 任务详情（执行历史、启停开关）
 ⇑ 新建/编辑定时任务（简表单：cron + prompt，MVP 可只读）

我的 Tab（inset grouped list）
 ├→ Agents 列表（bot 状态总览：在线/用量/通道）
 │   ├→ Agent 详情（overview：状态、模型、通道、定时、用量）※只读为主
 ├→ 用量（图表 + bot/时间筛选）
 ├→ 能力状态（Providers/Memory/Search/Voice… 只读状态行 + "去 Web 配置"提示）
 ├→ 外观 / 通知 / 关于 / 账号
```

**present vs push 规则**：
- **sheet（present）**：审批请求、新建/编辑类短任务（定时任务）、媒体预览、BotSwitcher（下拉菜单式 sheet）、登录/onboarding。特征：完成即消失、与当前上下文平行。
- **push**：一切"往里钻"的浏览行为——会话→Chat→diff、文件目录→文件、列表→详情。
- **alert（UIAlertController）**：仅破坏性确认（删除会话），对应 Web 的 ConfirmDeleteDialog。

### 3.2 首页（会话 Tab 落地页）两个方向

#### 方案 A：「会话优先」—— 列表即首页（类似 iMessage/Telegram）

```
┌──────────────────────────────┐
│  ⌄ Memo (bot 切换)      ⚙︎…   │ 导航栏标题=BotSwitcher 下拉
│  ┌────────────────────────┐  │
│  │ 🔍 搜索                 │  │ .searchable
│  └────────────────────────┘  │
│  ── 进行中 ───────────────── │
│  ● 修复登录页的 race…    ⋯   │ ● = 流式进行中（呼吸紫点）
│    正在运行 Bash · 2分钟前   │ 副标题=当前动作 + 时间
│  ── 今天 ────────────────── │
│  ○ 整理周报数据          2   │ 2 = 待审批计数（warning 色徽标）
│    等待审批 · 10:42          │
│  ○ 翻译第三章                │
│    已完成 · 09:15            │
│  ── 更早 ────────────────── │
│  …                           │
├──────────────────────────────┤
│ [会话]      [定时]      [我的] │
└──────────────────────────────┘
```

- **优点**：与 Web "落地即 Chat" 心智一致；待审批/进行中的会话天然冒泡到顶，审批中枢价值直接兑现；多 agent 用户一眼看到"哪个 bot 在干什么"。
- **缺点**：跨 bot 时需要先切 bot 再看会话（两层）；单 bot 用户会感觉多一层列表。
- **适用**：bot ≥2、会话并发多的重度用户——这是 Memoh 的目标画像。

#### 方案 B：「Agent 优先」—— 卡片墙即首页（类似 Home app）

```
┌──────────────────────────────┐
│  Agents                 ⚙︎…   │
│  ┌───────────┐ ┌───────────┐ │
│  │ 🟣 Memo   │ │ 🟢 Scribe │ │ 大号卡片：状态色环
│  │ ● 运行中   │ │ ⏸ 空闲    │ │
│  │ 3 会话·1审批│ │ 今天 12k tok│ │
│  └───────────┘ └───────────┘ │
│  ┌───────────┐ ┌───────────┐ │
│  │ 🔵 Coder  │ │ ＋ 去 Web  │ │ 创建引导到 Web
│  │ ⚠ 需审批 2 │ │   新建     │ │
│  └───────────┘ └───────────┘ │
│  ── 待办 ────────────────── │
│  ⚠ Memo 请求执行 rm -rf…  → │ 跨 bot 审批聚合流
│  ⚠ Coder 请求访问网络    →  │
├──────────────────────────────┤
│ [Agents]    [定时]      [我的] │
└──────────────────────────────┘
```

- **优点**："多 agent 平台"的产品叙事最强；审批聚合跨 bot，单屏看全局；适合 bot 多但每 bot 会话少的用户。
- **缺点**：到具体对话永远多一跳（卡片→会话列表→Chat）；高频聊天场景（Memoh 的主场景）效率低；卡片墙在 3 个 bot 以下显得空。

#### 推荐：**方案 A 为主，吸收 B 的一个能力**

主结构用 A（会话优先，聊天效率最高），把 B 的"跨 bot 待审批聚合"做成 A 列表顶部的**置顶审批区**（有审批时出现，最多 2 条 + "查看全部"），同时兼顾两种画像：

```
│  ── 需要处理 ────────────── │
│  ⚠ Coder 请求网络访问   允许│  行内快捷操作：允许/拒绝
│  ⚠ Memo 请求写文件      详情│  （完整表单进 sheet）
│  ── 进行中 ─────────────── │
```

依据：Web 侧栏把 BotSwitcher 放在会话列表之上（`sidebar/index.vue:28`），说明官方心智就是"bot 是会话的过滤器"而非并列实体；且 Web 落地页是 chat 而非 dashboard（`router.ts:20-28`）。

---

## 4. Chat 页设计规格（核心页）

### 4.1 页面骨架

```
┌──────────────────────────────┐
│  ＜  会话标题          ⋯ ⏸   │ 导航栏：返回 / 标题(可点=会话信息) /
│                              │       菜单(重命名、导出、删除) / 暂停agent
│  ──────── 消息流 ──────────  │
│  （见 4.2 各内容块）          │
│                              │
│  ┌ 审批 panel（如有） ──────┐ │ ⇧ 不占消息流，见 4.4
│  └──────────────────────────┘ │
│  ┌──────────────────────────┐ │
│  │ 📎  输入消息…         ↑  │ │ Composer，见 4.5
│  │ [model▾] [task▾]        │ │
│  └──────────────────────────┘ │
└──────────────────────────────┘
```

实现建议：**消息流 = 原生 UICollectionView（compositional layout + self-sizing cell）或 SwiftUI LazyVStack 包进 UIScrollView 做倒置**；流式高频更新（WS 每 token）下，RN 桥会成为瓶颈，这是"关键交互用 Swift 原生"的首要落点。

### 4.2 消息流内容块

| 内容块 | 呈现 | 控件/字体/圆角 |
|---|---|---|
| **用户消息** | 右对齐气泡，浅薰衣草底深紫黑字；暗色实心深紫白字（继承 Web 的翻转策略，`style.css:188-193`）。**气泡只靠底色区分，排版与助手完全一致** | 16pt 圆角连续曲线；padding 12×16；`.body`；最大宽 78% 屏宽 |
| **助手文本** | **全宽无气泡**，markdown 直排 | `.body`，行高约 1.5；块间距 12pt；左右边距 16 |
| **思考过程** | 单行折叠 header："Thought for 12s"，`--cop-title` 级弱灰（比 secondaryLabel 再弱）；流式中 shimmer；点按展开 muted 正文 | header `.footnote` + chevron.right 旋转展开；展开正文 `.footnote` secondaryLabel；整行高 28pt |
| **工具调用（单个）** | 裸行：动词 + 目标 + `+N/-N` diff（success/destructive 色）+ 审批徽标（warning），无卡片框 | `.footnote`；行内 icon 12pt；行高 24pt |
| **工具调用（多个）** | **折叠 process 卡**：header 双色调（muted 动词 shimmer "Exploring" → 定稿 "Explored" + 深色计数 N），展开为紧凑胶囊列表。**卡内绝不出第二根滚动条**（Web 原则，继承） | 卡片：10pt 圆角 + hairline 边 + backgroundChrome 底；header `.footnote` wght medium；展开项 `.caption` 等宽目标名 |
| **文件改动卡** | process 卡的一种：文件名（等宽）+ `+N/-N` + 点击 push 全屏 diff（added=systemGreen / removed=systemRed 软底行） | 全屏 diff 用等宽 13pt，行级背景色，不支持编辑 |
| **审批请求** | 消息流内只放状态摘要（"已批准/已拒绝/等待中"徽标）；**交互主体在 composer 上方的 panel**（见 4.4）与 push 通知 | 徽标 = soft 底 + 深字 pill，`.caption` |
| **图片** | 圆角缩略图 inline，点击全屏 lightbox（捏合缩放、下拉关闭） | 10pt 圆角；最大高 240pt；全屏用 QLPreviewController 或自研 zoom |
| **代码块** | hairline 框 + 底（亮=backgroundElevated / 暗=card 灰），copy 按钮常驻右上（ghost，不需要 hover 触发） | 10pt 圆角；等宽 13pt；横向滚动（不换行）；copy=doc.on.doc 图标 |
| **错误/中断态** | 消息流末尾 inline：destructive soft 底横条 + "已中断/重试"操作；对应 Web 的 composer-panel-error | `.footnote`；重试按钮 tint 文字样式 |
| **流式光标** | 助手正文末尾一个 2pt 宽竖条呼吸（brand 紫 40%），**不要用 "▋" 字符闪烁** | 仅最后一条消息显示；消息完成即移除 |

### 4.3 流式输出的视觉稳定（不闪、不跳）

1. **文本追加用 CATextLayer/NSAttributedString 增量更新，不走整段重排**；每 80–120ms 合帧提交一次（不要 per-token setState）。
2. **process 卡高度动画**：折叠/展开用 400ms easeOutExpo（继承 Web `collapse-section.vue:3`），流式期间 header 文案 shimmer 变化但**行高锁死**，动词定稿（Exploring→Explored）不触发布局变化。
3. **消息流底部锚定**：用户未上翻时，新内容到来保持贴底（contentInset 补偿，不要 setContentOffset 每帧硬跳）；用户上翻超过一屏则**停止自动滚动**，右下浮"↓ 新消息"pill（悬浮层允许投影，符合阴影纪律）。
4. **ticker**：流式中 process 卡折叠态下方 1 行高滚动 ticker 显示当前动作（继承 Web 设计），`Marquee` 效果用 mask 渐变而不是跳变文本。
5. Reduce Motion 开启时：shimmer/ticker 全部静态化。

### 4.4 审批 panel（composer 上方）

```
┌────────────────────────────────┐
│ ⚠ 写文件  src/auth/login.ts    │ 标题行：动词 + 目标（等宽）
│ ┌────────────────────────────┐ │
│ │ - 旧代码… (diff 预览3行)    │ │ 可展开完整 diff（push 全屏）
│ └────────────────────────────┘ │
│ [允许一次]  [总是允许]  [拒绝]  │ 主按钮=允许(tint 填充)，
│ ✎ 附加反馈…                    │ 拒绝=destructive 文字按钮
└────────────────────────────────┘
```

- 位置：composer dock 的 stack 层（与 Web 的 composer-panel-approval 一致，`home/components/composer-panel*.vue`），**不占消息流**——因为审批是"当前待办"不是"历史记录"。
- 多个审批排队：panel 顶部加 "1/3" 分页圆点。
- 冷启动路径：push 通知 → 点开直达该会话 + panel 置顶展开。
- 触觉：审批出现 = `UINotificationFeedbackGenerator .warning`；点允许/拒绝 = `.success` / `.error`。

### 4.5 Composer（输入器）

```
┌──────────────────────────────────┐
│ 📎   输入消息…              ↑/■  │ 行1：附件 / 文本 / 发送(或停止)
│ [⌁ Claude Sonnet▾] [⚡任务▾]    │ 行2：模型、任务选择 = ghost pill
└──────────────────────────────────┘
```

- 容器：16pt 圆角胶囊，hairline inset 边（**无阴影**，继承 Web 纪律），亮=编辑面同色、暗=card 灰浮起（`style.css:131-149`）。
- 文本框：自增长 UITextView，1–6 行；占位 `.body` placeholderLabel。
- 发送钮：无文字时禁用态（tertiaryLabel）；有内容时 brand 紫实心圆 + 白色 ↑；**流式中变为 ■ 停止钮**（tint 色描边），对应 WS abort（swagger `:10417`）。
- 附件：📎 拉起系统 Photo Picker / 文件 picker；附件以横向滚动缩略图条插在两行之间。
- 模型/任务选择：ghost pill（backgroundChrome 底 + `.footnote`），点击出 sheet 列表选择。
- 键盘：发送不换行（return=send 可在设置里切）；键盘避让用 `keyboardLayoutGuide`（iOS 15+），输入器随键盘带弹簧动画。

### 4.6 滚动行为

- 倒置列表（transform 翻转或 contentOffset 计算），**下拉 = 加载更早历史**（分页），不用 refreshControl（那是"刷新"语义，聊天里是"翻页"）——顶部用 spinner inline。
- 滚动到顶软边缘：rubber-banding 保留，但加载分页时保持视觉锚点（`CATransaction` 禁用动画调整 contentOffset）。
- 长按消息 = context menu：复制 / 引用 / 重新生成（助手消息）/ 删除（用户消息）。

### 4.7 空态与加载态

| 场景 | 呈现 |
|---|---|
| 新会话（无消息） | 居中：bot 头像 48pt + Display 字 "有什么可以帮你？" + 3 个建议 prompt 胶囊（quick-actions，swagger 有对应 tag）。点击即填入 composer |
| 会话列表空 | 插画免了——secondaryLabel 文案 "还没有会话，发一条消息开始" + 主按钮 |
| 消息加载中 | 骨架屏 3 条（灰胶囊呼吸，不调网络期间不闪） |
| 流式等待首 token | 助手位出现 process 卡 header shimmer "Thinking…"（不显示空气泡） |
| agent 离线 | 导航栏标题下加状态行（warning 色 ● 离线），composer 禁用 + 说明条 |
| WS 断连 | composer 上方 inline 条 "连接中断，重试中…"（不弹 alert），指数退避自动重连 |

---

## 5. 手感细节清单（决定像不像原生）

1. **44×44pt 最小触控目标**：工具调用裸行、徽标也要撑够热区（视觉可以小，hit test 不行）。
2. **Dynamic Type 全量接入**：正文到 `.accessibilityExtraExtraExtraLarge` 不截断（气泡 max-width 用比例不用定值）；代码块是唯一豁免。
3. **Safe Area 严格**：composer 贴 `keyboardLayoutGuide` 而非硬编码 34pt Home 条高度；横屏（后续 iPad）消息流最大可读宽 680pt 居中。
4. **软滚动边缘**：消息流顶部/底部保留系统 rubber-band；加载历史时锚点不跳（见 4.6）。
5. **玻璃材质的使用边界**：只有"浮在内容上且需要看到背后"的层用 `.ultraThinMaterial`——composer 背景、审批 panel 背板、↓新消息 pill。**列表、卡片、导航栏一律实色**（iOS 26 后导航栏自带玻璃，不要叠第二层）。
6. **发送动画**：消息从 composer"长"进气泡——200ms easeOutExpo 上滑 + 淡入；发送钮 ↑ 变 ■ 用 20ms 交叉淡化 + 0.9 缩放弹跳，不要旋转。
7. **键盘避让**：用系统 `keyboardLayoutGuide` 弹簧动画；消息流随键盘同步上移（interactive dismissal：聊天页支持**下拖键盘跟随手势** dismiss，`keyboardDismissMode = .interactive`）。
8. **触觉反馈时机**：审批到达 `.warning`、审批操作 `.success/.error`、长按 context menu `.medium` 轻点、下拉触发加载 `.light`。**发送消息不给触觉**（iMessage 也不给），流式 token 绝对不给。
9. **手势冲突**：会话页**下拉刷新**只在列表顶部（offset=0）触发；Chat 页下拉 = 加载历史（不用 refreshControl），全局右缘左滑返回与消息长按不冲突（长按 0.4s 阈值 > 滑动识别）。
10. **列表滑动删除**：会话列表 swipe action = 删除（destructive）+ 置顶；**不要**用全宽红色按钮，用系统 UISwipeActionsConfiguration。
11. **按压反馈**：所有可点 cell 统一 0.97 缩放 + 背景高亮 150ms（继承 Web `style.css:243-250`），SwiftUI 用 `.buttonStyle` 全局封装一个，禁止各处自定义。
12. **分隔线 = hairline**：1/scale px、separator 色、inset grouped 里对齐文字左边距（16pt），卡片之间宁可留白也不画粗线。
13. **状态呼吸**：流式中的 ● 用 1.6s 透明度 1→0.4→1 呼吸（与 Web shimmer 同周期），暂停时静态——运动是"活着"的信号，静止是"等待"的信号。
14. **sheet detent**：审批 sheet 用 `.medium + .large` 双档；模型选择用 `.medium` 单档；grabber 只在可拖 detent 时显示。
15. **push 通知 → 深链**：审批通知带 `sessionId + approvalId`，冷启动直接 push 到会话并展开 panel；通知分类带"允许/拒绝"快捷 action（UNNotificationCategory），不进 App 也能批。

---

## 6. MVP 与后续边界

### 第一周能做完的 MVP 屏幕

| 屏幕 | 范围 |
|---|---|
| 登录 | 服务器地址 + token 登录（对齐 Web `/login` 的最小路径） |
| 会话列表（方案 A） | 单 bot 即可；进行中状态轮询；无跨 bot 审批聚合 |
| Chat | 用户/助手文本、工具调用折叠卡（只读展示）、代码块、错误态、**流式渲染 + 停止** |
| Composer | 文本 + 发送/停止；模型选择只读显示当前值 |
| 审批 | composer panel 内 允许/拒绝（无"总是允许"、无反馈输入） |
| 设置 | 账号、外观（跟随系统/亮/暗）、关于 |
| WS 通道 | local-channel 双向流式 + 断线重连 |

MVP 明确不做：附件、定时任务 tab、用量、文件浏览、push 通知、多 bot 切换 UI（写死第一个 bot）、diff 全屏。

### 之后再说（按优先级排）

| 批次 | 内容 |
|---|---|
| V1.1 | push 通知 + 审批快捷 action；BotSwitcher；附件（图片）；diff 全屏；定时任务只读 tab |
| V1.2 | 文件浏览器（只读 + 预览）；用量页；多审批排队；会话搜索；context menu 完整操作 |
| V1.3 | 能力状态只读页；定时任务编辑；思考块、后台任务列表、quick actions 建议 |
| V2 | iPad 适配（sidebar 双栏）；键盘快捷键；小组件（审批计数）；Share Extension（分享到会话） |
| 不做（回 Web） | 容器桌面串流、终端、provider 配置表单、建 bot 向导、people 管理、memory 图谱、supermarket 安装 |

---

## 附：关键依据索引

- Web 落地即 Chat：`apps/web/src/router.ts:20-28`
- 侧栏三视图 + BotSwitcher：`apps/web/src/components/sidebar/index.vue:28, 59-103`
- bot 详情 18 tab：`apps/web/src/pages/bots/detail.vue:417-437`
- 桌面串流 WebRTC：`apps/web/src/pages/home/components/display-pane.vue:883-895`
- 品牌色：`apps/web/src/constants/color-schemes.ts:17-19`
- 用户气泡亮暗翻转：`apps/web/src/style.css:153-173, 188-193`
- 阴影纪律：`apps/web/src/style.css:196-199`
- easeOutExpo：`apps/web/src/style.css:237-243`
- 中英字重补偿（不搬）：`apps/web/src/style.css:330-400`
- shimmer/ticker：`apps/web/src/style.css:565-606`
- 流式 WS + abort：`spec/swagger.json` local-channel tag
