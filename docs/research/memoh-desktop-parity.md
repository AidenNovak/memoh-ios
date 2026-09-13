# Memoh 桌面端页面与信息架构清单（用于 iOS 对齐）

研究对象：`/Users/lijixiang/projects/reference/memoh/apps/web`（Vue 3 + Tailwind）。
对照对象：`/Users/lijixiang/projects/memoh-ios/apps/mobile`（当前 4 页：Home / Chat / Settings / Login）。

全文只读代码得出，路径相对 `/Users/lijixiang/projects/reference/memoh/`。

---

## 0. 读之前先知道三件事

1. **桌面端的"页面"分三种，导航方式完全不同**：
   - **设置区**：真路由 + 侧栏导航（`apps/web/src/router.ts` 的 `/settings/*`）。
   - **聊天区**：**不是路由内容**。`router.ts` 里 `/` 和 `/bot/:botName` 的组件是 `{ render: () => null }`，真正的聊天 UI（侧栏 + dockview）由 `App.vue` 常驻挂载，路由只负责 URL 与面包屑同步。原因写在注释里：进设置（浮层）再回来时聊天不能 unmount，否则丢布局和滚动位置。
   - **Bot 详情**：在设置路由树里（`/settings/bots/:botName`），但自带独立侧栏（19 个 tab），会顶掉设置侧栏（`pages/settings-section/index.vue` 的 `isBotDetail`）。
2. **文案表就是功能清单**：`apps/web/src/i18n/locales/zh.json`（3821 行）按功能域分组：`chat` / `bots` / `sidebar` / `usage` / `supermarket` / `memory` / `providers` / `webSearch` / `voice` / `video` / `email` / `people` / `about` / `onboarding` / `auth` / `settings` / `mcp` / `connectors` / `errors` / `runtimes` / `models` / `network` / `transcription` / `speech` / `deviceCode` / `desktopConnection` / `computerAccess`。
3. **Web 端自己已有一套窄屏（<768px）移动壳**，等于上游已经给过一版"手机上怎么降级"的答案，是 iOS 最该先抄的参照（见 §6.20）。断点定义在 `apps/web/src/composables/useIsMobile.ts`（纯宽度，手机横屏会掉回桌面壳）。

---

## 1. 功能地图：桌面端有哪些顶层页面 / 区域

### 1.1 聊天区（常驻 shell，`/` 与 `/bot/:botName`）

外层 `pages/main-section/index.vue` = 侧栏 + 主区（`components/main-container/index.vue` → `pages/home/index.vue` → `components/chat-workspace.vue`）。

**左侧栏**（`components/sidebar/index.vue`）：

| 位置     | 内容                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 顶部     | Bot 切换器（`bot-switcher.vue`）                                                           |
| 导航行   | 3 个视图 tab：**对话** / **文件**（受 `workspace_read` 权限门控） / **日程**；右侧搜索图标 |
| 主体     | 互斥三面板：`panel-sessions` / `panel-files` / `panel-schedule`，底部渐隐                  |
| 底部固定 | **设置**（跳 `/settings`），独立成行不在 tab 组里                                          |
| 边缘     | 可拖拽调宽 220–480px                                                                       |

**对话面板**（`panel-sessions.vue`）：

- 组头「快捷操作」+ 两行动作：**新建会话**、**Bot 设置**。
- 一个共享滚动区装两段：
  - **文件夹**（`folders-section.vue`）：可折叠组头 + 右侧 ＋；每行 hover 出菜单（重命名 / 归档）与 ＋（在该文件夹新建会话）；展开后内嵌该文件夹的会话列表。
  - **最近**（`recents.vue`）：会话时间线，混含 ACP agent 会话与定时任务运行（每行带类型图标：agent 图标 / 黄色时钟）；游标分页 + 骨架屏 + 空态；折叠状态按 bot 记忆（localStorage）。
- 会话行（`session-item.vue`）：标题（中英混排按脚本分字号）+ 尾部 24px 槽位（生成中转圈 / hover 出的三点菜单：重命名、删除）+ 右键菜单（在新标签打开、重命名、删除）；hover 时标题 marquee 滚动。

**会话搜索**（`session-search-dialog.vue`）：Cmd-Palette 式弹窗，单输入框 + 结果列表（每行带类型图标），Enter 选第一条，空态区分"没搜到"与"暂无会话"。

**日程面板**（`panel-schedule` / `schedule-item.vue`）：按时间分组的任务列表，每项两行（名称 + 时间标签 / 描述），菜单可编辑删除，空态直接给"＋ 新建"。

**文件面板**（`panel-files.vue` → `files-pane.vue`）：工作区文件树，新建文件 / 新建文件夹 / 上传文件 / 上传文件夹 / 刷新；多选有批量操作条；可拖拽接收文件；工具栏按钮 hover 才出现。

**主区 = dockview 工作台**（`chat-workspace.vue`）：可拖拽分割的标签容器，面板 8 种 —— `chat` / `file` / `preview` / `asset` / `terminal` / `browser` / `display`（远程桌面）/ `schedule`。支持左右上下分屏、标签右键菜单（关闭/关闭其他/关闭全部）、未保存文件关闭确认弹窗、空态水印（"暂无打开的标签页 / 从侧栏选择会话，或打开文件、终端、浏览器"）。标签条左侧一排灰按钮：收起侧栏、后退、前进、新建（＋ 菜单：终端 / 浏览器 / 桌面 / 左右分屏 / 上下分屏）。

**这就是桌面端的核心。** 手机端根本不存在"多面板工作台"，见 §5。

### 1.2 设置区（`/settings`，18 页）

侧栏分组定义在 `components/settings-sidebar/index.vue`，**4 组**（分组本身是设计决策，注释写了理由）：

| 组                 | 成员                                                      |
| ------------------ | --------------------------------------------------------- |
| （无组标签）工作区 | 智能体（bots）、电脑（runtimes）、应用市场（supermarket） |
| 模型与能力         | 模型服务商、记忆管理、搜索引擎、语音、视频、邮件服务      |
| 团队               | 成员（admin only）、用量统计                              |
| 偏好               | 外观定制、快捷键、个人资料、关于                          |

各页内容：

- **`/settings/bots`**（`pages/bots/index.vue`）：居中启动器布局 —— Bot 卡片网格 + 一张"创建"卡；>5 个 bot 才出搜索框；导入 Bot 在右上。卡片角标状态：转圈=创建中 / 警告三角=有问题 / 灰点=未激活。
- **`/settings/bots/new`**（`bots/new.vue`）：两个 tab —— **创建** / **从备份导入**；创建表单分卡（基本信息含头像+名称、类型、其他）。
- **`/settings/bots/new/progress`**：创建进度页（创建 → 准备环境 → 就绪）。
- **`/settings/bots/:botName`**：见 §1.3。
- **`/settings/providers`**（`pages/providers/index.vue`）：主从双栏。左是服务商画廊（搜索、预设分组 内置/自定义、空态）；右是新增/编辑表单：名称、API 格式（clientType）、API Key、Base URL、图标、启用、prompt cache、**测试连接**、**自动导入模型**、OAuth；以及该服务商下的模型列表（`model-setting.vue` / `model-list.vue` / `model-item.vue`）：模型 id、显示名、描述、维度、兼容性、上下文窗口、测试、启用、删除、刷新模型。
- **`/settings/runtimes`**（"电脑"）：两块 —— **这台电脑**（连接命令、复制、等待连接、完成）、**其他电脑**（列表、在线状态、吊销、授予 Bot 访问权对话框）。
- **`/settings/web-search`**：两组 —— **搜索提供方** / **抓取提供方**；每个提供方有专属设置组件（`components/` 下 14 个：tavily / exa / bing / google / bocha / brave / jina / jina-reader / searxng / serper / sogou / yandex / duckduckgo / cloudflare-markdown）。
- **`/settings/memory`**：记忆提供方画廊 + 内置配置 + **记忆图谱**（`bots/components/memory-graph/`，ECharts 力导向图，节点/边统计）。
- **`/settings/voice`**：两组 —— **语音合成**（朗读）/ **语音转写**（聆听）。`/settings/speech` 与 `/settings/transcription` 都重定向到这一页。
- **`/settings/video`**：视频生成模型提供方 + 模型导入。
- **`/settings/email`**：邮件服务提供方。
- **`/settings/usage`**（`pages/usage/index.vue`）：筛选（Bot、时间范围含自定义、会话类型 chat/discuss/acp_agent/schedule、按模型）+ 概览（总输入/输出 token、平均缓存命中率、总推理 token）+ 图表（每日 token、缓存分布饼图、模型用量分布）+ **调用记录明细表**（时间 / Bot / 类型 / 模型 / Provider / 输入 / 输出）。
- **`/settings/people`**：成员表（名称、用户名、邮箱、角色、启用、最后登录）+ 新建 + 移除；adminOnly。
- **`/settings/appearance`**：三组 —— **界面偏好**（语言 中/英/日、主题 浅/深/跟随、**配色方案** 5 套：Memoh 紫 / 海洋 / 森林 / 玫瑰 / 琥珀）、**字体与字号**（界面字体、界面字号、代码字体、代码字号）、**代码与图表**（Shiki 浅色主题、Shiki 深色主题、Mermaid 主题，均带搜索）。
- **`/settings/keyboard`**：快捷键表，2 个作用域（全局 / 媒体灯箱），6 条命令（关闭当前标签、保存当前文件、切换侧边栏、打开设置、关闭媒体灯箱、上一张/下一张媒体）；点"编辑"后按键录入，有保留键校验、冲突校验；全部重置。
- **`/settings/profile`**：4 块 —— 身份（头像 + 显示名，hover 编辑，自动保存）；账号（时区、**标题生成模型** title_model、修改密码）；**已连接的 IM 账号**；会话（用户 ID 可复制、退出登录）。
- **`/settings/supermarket`**：3 个 tab —— **连接器** / **技能** / **依赖**；技能 tab 有 registry 分段筛选、卡片列表（作者、分类、registry），可进包详情（`skills/:registryId/:packageId`）；依赖 tab 是工作区依赖目录（检查更新、状态、安装/移除/回滚、进度、脚本）。
- **`/settings/about`**：版本/更新检查（Web 与桌面行为不同）、GitHub、文档、反馈、高级（服务器连接配置）、License。

### 1.3 Bot 详情页（19 个 tab，4 组）

`pages/bots/detail.vue`，分组见 `groupedTabs`：

| 组           | tab                                                               |
| ------------ | ----------------------------------------------------------------- |
| core         | 概览、通用、平台                                                  |
| capabilities | 技能、Hooks、工具审核、Agent、连接器（条件显示）、MCP、依赖、记忆 |
| runtime      | 桌面、电脑、工作区、网络、定时任务、上下文压缩                    |
| security     | 访问控制、邮件                                                    |

侧栏顶部是返回行 + 一张身份卡（头像、名称、状态点+文案）；tab 列表上方有搜索框（搜 tab 名与关键词，命中时**原地收窄**分组，不换成另一个结果列表）。

各 tab 主要内容：

- **概览**：待处理提醒列表（每条一个动作按钮）、平台连接状态、配置摘要（模型 / 记忆条数）、**近 30 天用量**、**运行状态**（CPU/内存实时采样）、诊断横幅。
- **通用**：4 张设置卡 —— 全局设置、交互方式（对话模型、语言、默认 Agent、IM 里是否显示工具调用）、上下文与记忆（搜索/抓取/记忆提供方、压缩阈值与压缩模型）、多媒体（TTS / 转写 / 图片 / 视频模型）；外加危险区（删除 Bot）。
- **平台**：Telegram / Discord / 飞书 / 钉钉 / 微信 / 微信服务号 / 企业微信 / Slack / LINE / QQ / Matrix / Misskey / Web / 本地 CLI 的接入；每种有凭据表单、启用/停用、webhook 回调 URL（含"公开地址待配置""隧道启动中"等状态）、危险区删除。
- **工具审核**：按"位置"（工作区 / 每台电脑）分别配置 —— 开关、三种模式（允许 / 询问 / 拒绝）、默认行为（默认需审核 / 默认自动放行）、**自动放行路径/命令白名单**、**必须审核路径/命令黑名单**、恢复推荐配置；有 glob 与通配符语法提示。
- **Hooks**：JSON 配置编辑器（事件、规则、动作）、启用/缺失/非法三态、模板、**测试事件**。
- **Agent**：ACP agent 列表与新增（配置方式：API Key / OAuth / 自行配置；命令入口、启动参数）、启用停用、类型徽章。
- **连接器**：已连接 / 浏览目录、OAuth 授权（等待授权、重新授权、断开）、认证方式选择。
- **MCP**：MCP server 列表（命令、cwd、env、启用）、新增/编辑、导入 JSON、导出、**探测连接**、发现到的工具列表与数量。
- **依赖**：工作区依赖目录、检查更新、行内状态与动作（安装/移除/脚本/回滚）、进度对话框、预检失败详情。
- **记忆**：记忆列表（搜索、新增、编辑、删除、降级提示、摄取）、记忆图谱、压缩记忆（压缩比 轻/中/激进、衰减日期）。
- **上下文压缩**：开关、阈值、压缩后保留比例、压缩模型、**压缩日志**（状态/时间/耗时/错误，可清空）。
- **技能**：发现路径（管理路径 / 自定义路径 / 恢复默认）、技能库、包徽章、启用停用、shadowed / legacy / compat 徽章、内容编辑、从市场打开包。
- **访问控制**：黑/白名单模式、默认效果、规则列表（平台 × 用户 × 会话范围 × 会话类型 × 具体会话 id）、按身份/会话搜索候选、启用停用、增删改。
- **工作区容器**：状态（created/running/stopped/exited）、启动停止删除、快照（创建/恢复/回滚）、资源指标（CPU/内存/存储）、资源限额、数据保留、GPU 与 CDI 设备、镜像。
- **桌面**：启用远程桌面（Xvnc），可实时观看并接管。
- **电脑（remote-runtime）**：使用位置列表（云端电脑 / 已连接的电脑）、默认位置、"使用这台电脑"开关、跳转电脑设置。
- **网络**：私有网络（SDWAN）接入、出网位置。
- **定时任务**：列表（名称、cron、启用、调用次数、下次运行、创建/更新时间，可按名称/状态/下次运行排序）、创建/编辑（可视化选择器 + 表单：cron、最大调用次数、执行配置）、删除。
- **邮件**：邮箱绑定（地址、读/写/删权限）、收件箱 / 发件箱（发件人、收件人、主题、状态、时间）、解绑。

### 1.4 其他路由

- **`/onboarding`**（`pages/onboarding/`）：5 步向导 —— 欢迎（打字机自我介绍）→ 外观（语言、主题、配色）→ 配置服务商（预设 + 自定义表单，四类错误文案：连接失败 / 密钥无效 / 不可达 / 无模型，可重试或手动添加模型）→ 创建第一个 Bot（随机取名、选模型、ACP 授权延后提示）→ 完成（推荐 IM / 语音 / 搜索）。步间转场动画、可跳过。
- **`/login`**（`pages/login/index.vue`）：一个居中卡片（logo、标题、副标题、用户名、密码、继续按钮），点阵背景，无 OAuth、无多步；进入/退出有缩放转场。
- **`/oauth/mcp/callback`**：MCP OAuth 回调落地点。
- **`/dev/components`**（仅 dev 构建）：组件墙，11 个 section（Tokens / Type / Spacing / Layout / Navigation / InputsForms / DataDisplay / Feedback / Overlays / Atoms / Accents），顺带是一份设计系统清单。

---

## 2. 每个桌面页面 → iOS 等价物

四档判断：**照做** / **降级**（换形态）/ **收进设置** / **砍**。

| 桌面页面                                                                   | iOS 判断                   | 具体形态                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 聊天区（sessions 面板）                                                    | 照做                       | 就是你现在的 Home 列表。缺文件夹分组、搜索、会话行类型图标与生成中状态（见 §5.3）                                   |
| 聊天区（files 面板）                                                       | 降级                       | 文件树在手机上很难用，但**只读浏览 + 预览**有价值（"它改了什么文件"）。做成对话页里的 push 页或 sheet，不要独立 tab |
| 聊天区（schedule 面板）                                                    | 降级 + 收进设置            | 手机上属于"看状态、开关一下"，不是"用选择器编辑 cron"。列表 + 启停即可，编辑跳桌面                                  |
| 会话搜索弹窗                                                               | 照做                       | 列表顶部下拉出搜索框（原生 `searchController`），不要 Cmd-Palette 弹窗                                              |
| 对话页                                                                     | 照做（核心）               | 见 §4                                                                                                               |
| dockview 工作台（终端 / 浏览器 / 远程桌面 / 分屏）                         | **砍**                     | 手机没键盘、没指针、屏幕装不下分屏。远程桌面偶尔有用，但属于"远看一眼它在跑"，不是操作                              |
| Bot 详情 19 个 tab                                                         | **不照做**                 | 不做"19 tab 设置页"。按"手机上会不会改"筛出一小撮，其余明说"请在桌面端配置"                                         |
| ├ 概览                                                                     | 降级                       | 值得做一个 **Bot 状态页**：提醒、平台连接、模型、近 30 天用量、运行状态。这是手机上唯一"想看一眼"的 bot 页面        |
| ├ 通用                                                                     | 降级                       | 只保留**对话默认模型**与**显示工具调用**；其余跳桌面                                                                |
| ├ 平台（IM 接入）                                                          | 降级                       | 只读展示"已连接 Telegram/飞书…"，加一个"打开 webhook 配置"或直接砍                                                  |
| ├ 工具审核                                                                 | 砍（但**审批本身要照做**） | 白/黑名单 glob 规则是坐电脑前配一次的东西。手机只处理**当下这一条**审批                                             |
| ├ Hooks / MCP / 依赖 / 连接器 / 技能 / 访问控制 / 网络 / 工作区容器 / 邮件 | 砍                         | 全是配置型、要键盘与长文本输入                                                                                      |
| ├ 定时任务                                                                 | 降级                       | 列表 + 启停 + 看下次运行时间；编辑跳桌面                                                                            |
| ├ 桌面 / 电脑（使用位置）                                                  | 一部分降到 composer        | "这个会话在哪台电脑上跑"值得在对话页显示（桌面端就是在 composer 里选的，见 §4.9），"管理电脑"砍                     |
| ├ 记忆                                                                     | 降级                       | 只读记忆列表 + 搜索（"它记住了什么"是高频好奇点），编辑跳桌面                                                       |
| ├ 上下文压缩（日志）                                                       | 砍                         | 但"上下文快满了"这个**信号**要在对话页显示（桌面端有环，见 §4.10）                                                  |
| `/settings/bots`（列表/新建/导入）                                         | 降级                       | 你的 BotSwitcher 覆盖了"切换"；"新建/导入"收进设置，只在真需要时做                                                  |
| `/settings/providers`                                                      | 砍                         | 上百字段的表单，手机上是灾难                                                                                        |
| `/settings/runtimes`（电脑）                                               | 砍                         | 连接要复制命令到终端，手机做不到                                                                                    |
| `/settings/web-search`                                                     | 砍                         | 14 种提供方的专属表单                                                                                               |
| `/settings/memory`                                                         | 砍                         | 同 Bot 详情的记忆，可留只读入口                                                                                     |
| `/settings/voice` / `video` / `email`                                      | 砍                         | 提供方配置                                                                                                          |
| `/settings/usage`                                                          | **降级但该做**             | "这个月花了多少 token"有价值。做：总输入/输出 + 缓存命中率 + 每日曲线 + 按模型分布；明细表砍                        |
| `/settings/people`                                                         | 砍                         | 成员管理是 admin 在电脑上干的活                                                                                     |
| `/settings/appearance`                                                     | **部分照做**               | 语言、主题（含 OLED）你已有。5 套配色方案不要做（iOS 该跟系统语义色，你的 AGENTS.md 也是这么定的）；字体字号不做    |
| `/settings/keyboard`                                                       | 砍                         | 手机没键盘                                                                                                          |
| `/settings/profile`                                                        | **照做**                   | 头像/显示名/密码/退出你已有；缺**时区**、**标题生成模型**（可展示不必可改）、**已连接 IM 账号**的只读展示           |
| `/settings/supermarket`                                                    | 降级                       | 技能/连接器的"浏览 + 安装"在手机上是有意义的（桌面把它放在设置里，说明它低频）。可只读列表 + 安装到当前 bot         |
| `/settings/about`                                                          | 照做                       | 你已有版本号；补检查更新与文档/反馈入口                                                                             |
| `/onboarding`                                                              | 降级                       | 手机上一句"先在桌面端完成初始化"即可；不要复刻（尤其填 API Key 那步）                                               |
| `/login`                                                                   | 照做                       | 你已有。可抄：**登录转场的缩放动画**，以及"只有用户名+密码、不搞 OAuth"的克制                                       |
| `/oauth/mcp/callback`                                                      | 砍                         | 深链回落即可                                                                                                        |
| `/dev/components`                                                          | 不适用                     | 但"组件墙"这个习惯值得搬：iOS 也该有能看全部原生控件变体的 debug 入口（你的 `/debug` 已在做）                       |

---

## 3. 信息架构：桌面端为什么这么分组，iOS 怎么映射

### 3.1 桌面端的两层导航

**第一层（聊天 shell）只有 4 项**：对话 / 文件 / 日程 + 设置。这是**按使用频次分**，不是按概念分：

- 对话 = 一直在用的。
- 文件 / 日程 = 同一个 bot 的另外两种资源，需要时切过去看一眼。
- 设置 = 低频，钉在最底部（`sidebar/index.vue` 里它是独立一行，不在 tab 组里）。

**第二层（设置侧栏）4 组**，注释给的理由是"按用户来这里要干的事"排：

1. **无标签的"你自己的东西"**：bot、电脑、应用市场 —— "我拥有的实体"。第一组故意不给标签，让它在视觉上直接承接顶部，读起来像"主区"而不是"某一类"。
2. **模型与能力**：服务商、记忆、搜索、语音、视频、邮件 —— 注释明确写了这 6 个是**同一个页面类型**（一个提供方画廊，配一次，之后在 bot 里选），把它们拆到不同组只会掩盖这个共性。
3. **团队**：成员、用量 —— 组织级视角。
4. **偏好**：外观、快捷键、个人资料、关于 —— 关于"我自己"。

注意 `profile` 和 `about` 都在"偏好"里，不在第一组 —— 说明桌面端的分组原则是"谁在配置 / 配置什么"，不是"重要性"。

**Bot 详情的 4 组走另一套逻辑**：**core（是什么）/ capabilities（会什么）/ runtime（跑在哪）/ security（谁能用）**。这是"名词分类"，跟设置侧栏的"动作分类"不同 —— 因为 Bot 详情是"一个实体的全部属性"，天然按属性维度分。

### 3.2 映射到 iOS

你现在是 `HomeScreen` → `chat/[sessionId]` 两级 push，设置单独一页。建议：

- **不要做 tab bar。** 桌面的"3 个视图"是同一个 bot 的三种资源，不是三个平行的 App 分区。iOS 上正确映射是：**Bot 切换放导航栏标题（你已有 BotSwitcher），文件/日程作为对话页的 push 或 sheet，设置作为导航栏右侧按钮。** 这是"单一栈 + 顶部切换"的标准做法，也保住你 AGENTS.md 里"单一 native stack"的约束。
- 若要一个入口承载"每个 bot 的设置"，用**长按 Bot 切换器**或 Bot 列表行右侧的 ⓘ，不要给每个 tab 一条 tab bar item。
- 桌面的"设置分 4 组"仍有用，但**只映射到你保留的那几页**：账号 / 外观 / 用量 / 关于 / Debug。手机上的分组语义退化成 2 组就够（"这个 App" / "我的账号"）。你现在的 `SettingsScreen.tsx` 已是这个形状（account / appearance / language / about），**不用改结构，只加页面**。

---

## 4. 对话页的信息层级（最详细）

核心文件：

- `apps/web/src/pages/home/components/chat-pane.vue`（3688 行，整个 pane）
- `message-item.vue`（925 行，单条消息的块渲染）
- `tool-call-group.vue` / `tool-call-inline.vue` / `tool-call-registry.ts`（1094 行，工具行语法）
- `thinking-block.vue` / `reasoning-timing.ts` / `process-collapse.ts`
- `composer-dock.vue` / `composer-panel.vue` / `composer-panel-approval.vue` / `chat-user-input-form.vue` / `components/tool-approval-actions.vue`
- `session-info-ring.vue` / `session-info-panel.vue` / `context-usage-breakdown.vue`
- `session-follow-up-queue.vue` + `use-session-follow-up-queue.ts`
- `composables/useChatScroll.ts`（900+ 行，滚动语义）

### 4.1 页面骨架

```
<section px-3 sm:px-5 lg:px-8>
  <section absolute inset-0>                  ← 滚动层，绝对定位填满父级
    <ScrollArea>                              ← 唯一滚动容器
      <div max-w-[840px] mx-auto px-4 pt-6 space-y-6>
        [loadMoreSentinel]                    ← 顶部哨兵，向上加载更早
        [loadingOlder 小转圈]
        [空态 / 加载态分支]
        <div v-for="turn in messageTurns" data-chat-turn>   ← 每轮一个常驻容器
          <div data-turn-motion space-y-6>
            [ForkSourceDivider]               ← "分叉自 {session}" 分隔线
            <div :data-message-id>
              <MessageItem />
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
    <ChatScrollRail />                        ← 右侧滚动轨（仅 md+）
  </section>

  [MediaGalleryLightbox ×2]                   ← 消息内 / composer 预览
  [粘贴内容查看 Dialog] [分叉命名 Dialog]

  <div absolute bottom-0>                     ← composer 停靠层
    [不透明背景遮罩，只升到输入框最宽点（即其垂直中心）]
    [欢迎态才有问候语 h1]
    <ComposerDock>
      <ComposerPanel />                       ← 审批/命令结果/错误/压缩 栈层
      <ChatUserInputForm />                   ← ask_user 胶囊（占据输入槽）
      <div v-show="composerVisible">[composer 本体]</div>
    </ComposerDock>
  </div>
  [FileDropOverlay]                           ← 拖拽落点反馈
</section>
```

关键：**每轮一个常驻容器，按轮的开头消息 id 作 key；发送是追加容器，不重排已有 DOM**（注释写明这是为滚动锚定）。

### 4.2 一条消息由哪些块组成

块类型定义在 `apps/web/src/store/chat/types.ts`：

```ts
type ContentBlock =
  TextBlock | ThinkingBlock | ToolCallBlock | AttachmentBlock | ErrorBlock | NoticeBlock;
```

非 assistant 的还有：`ChatUserTurn`（文本 + 附件 + 回复引用 + 转发引用 + 技能激活）、`ChatSystemTurn`（`kind: 'background_task'`）。

`message-item.vue` 的 `renderNodes` 把块合并成渲染节点（**最有价值的一条规则**）：

> 连续的 **tool 和 reasoning** 块合并成一个 **process 段**；任何别的块（text / error / notice / attachments）**打断**这个段。

所以一条 assistant 回复在屏幕上的实际形状是：

```
[process 段：思考 + 读文件 + 跑命令]     ← 一个可折叠的组
[文本段：Markdown 正文]
[process 段：又调用了两个工具]
[文本段：结论]
[error 块 / notice 块（如果有）]
[attachments 块（如果发了图）]
[MessageActions 行：复制 / 重试 / ⋯ 菜单]
```

单个 item 的段不渲染组头，直接一行；多个 item 才成组。

各块呈现（`message-item.vue`）：

| 块                            | 呈现                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **text**（assistant）         | `prose prose-sm` Markdown，`markstream-vue` 渲染；流式有打字机 + 淡入 + 批量渲染；代码块走自定义 `ChatCodeBlock`（不用 Monaco 重型版），Mermaid 用主题化块，支持 KaTeX；标题分两档间距（h1–h3 是分段，h4–h6 是小标签） |
| **文本**（user）              | 右对齐气泡，`bg-chat-user-bubble`，`whitespace-pre-wrap`；超长折叠；最大宽度 **70%** 列宽                                                                                                                              |
| **reasoning**                 | 见 §4.5                                                                                                                                                                                                                |
| **tool**                      | 见 §4.3 / §4.4                                                                                                                                                                                                         |
| **error**                     | 红色描边卡片 `border-destructive/25 bg-destructive/10`，`CircleAlert` + 文本                                                                                                                                           |
| **notice**                    | 警告色卡片（比 error 安静）`border-warning-border bg-warning-soft`，`TriangleAlert` + 文本。语义是"运行时想让你知道的降级"（工具不可用、某次交互被拒），**这一轮还在继续**                                             |
| **attachments**               | 图片/视频按**自然宽高比**内联（`max-h-80 object-contain`，不是方形缩略图）；音频 `<audio controls>`；容器文件走文件管理器；上传文件走预览标签页                                                                        |
| **background_task**（system） | 一条横幅：状态图标（转圈/对勾/叉/警告）+ 状态文案 + 命令（等宽）+ 元信息（`exit N \| 时长 \| 输出文件`），上下细边线；下方相对时间                                                                                     |
| **ask_user 完成态**           | **从 process 段里拆出来**，渲染成独立 Q&A 卡片（`chat-answers-card.vue`）：问题灰、答案正文色；卡片宽度贴合内容（`w-fit`）不平铺                                                                                       |
| **技能激活消息**（user）      | 气泡里换成 ✨ + "已激活 Skill" + 技能名 + Prompt                                                                                                                                                                       |

用户消息还有：**回复引用**（左侧 3px 竖条 + 发送者 + 两行预览 + 可选缩略图，可点跳转）、**转发标记**（"转发自 X"）、**编辑**（点编辑把气泡换成 textarea，Cmd/Ctrl+Enter 提交，Esc 取消）。

### 4.3 process 段（桌面端最强的设计）

`tool-call-group.vue`。这是"agent 干活"这件事上最值得整体搬走的部分。

**组头**（折叠态）是一行**两段式**短语：

```
[连接器图标…] 探索中  12 次文件操作、4 次搜索、3 条命令      +284  -96  ⌄
```

逐条依据：

1. **动词 = 阶段，时态 = 这个段自己的生命周期。** 正在流式用现在时（"探索中"），一旦被后续内容取代就用过去时（"已探索"）。阶段由段内工具的"桶"多数决定，桶定义在 `tool-call-registry.ts` 的 `BUCKETS`：`browse / edit / run / message / schedule / media / agent / other`；并列时按这个顺序打破平局，且 `other` 永远不赢（"处理中"不提供信息）。**全是 GUI 工具时一律"浏览中/已浏览"**，不管混合比例。
2. **细节 = 裸计数，按固定顺序拼接**："12 次文件操作、4 次搜索、3 条命令"。片段种类比桶更细（`SummaryFragment`：fileOperations / searches / commands / messages / schedules / media / agents / steps），因为把读文件和网页搜索混成一个"浏览"会让组头**说谎**。文件类工具数的是**调用次数**不是唯一文件数（一次 patch 可能动多个文件）。任何没登记的工具落到 `steps`，宁可退化成"12 步"也不编造名词。GUI 运行改成报域名（"浏览了 example.com"）或网站数。
3. **只有流式的那一段有动词。** 单工具段不给动词 —— "Run ls /tmp" 本身就是具体信息，再加"运行中"会变成"运行中 Run ls /tmp"（结巴），而且和下面的 now line 重复。
4. **段级 diff 总数只在段结束后显示**（`+284 -96`），从各行自己的算法求和，保证组头和内容永不不一致。流式中不显示，因为每行已有自己的 diff 数字，再显示一个增长总额是重复。
5. **连接器 logo**：这个段碰过的**所有**连接器都列出来（不只第一个），按首次调用顺序，同一连接器的两个绑定算两个 mark。理由是折叠的组头是用户唯一能看到"这次碰了哪些外部系统"的地方。
6. **流式中且未展开时，组头下面有一行 "now line"**：滚动显示**当前正在跑的那一项**的标题，每换一项做一次上下滚动动画（300ms）。它不是 loading 组件，是"过程链的第一环"。文字采样自最后一项：reasoning 尾巴 → "正在思考如何处理"，工具 → 它自己的行标签。

**展开后**是一个 `Capsule`（`rounded-md bg-muted px-2.5 py-1.5`，比根级小一号的字号 + 更紧行高，让嵌套行读起来"下钻一层"），按顺序列每个工具行 / 思考行。**胶囊内部故意不自己滚动** —— 过程体必须跟着主聊天滚动，鼠标滚轮永不被锁在胶囊里。

**折叠状态纯用户驱动，且跨"回合结束后重新拉取"持久化**（`process-collapse.ts`）：模块级 Map，key 是「messageId + 块的后端 id」，`MAX_OPEN_STATES = 2048` 做 LRU。注释写明：不自动展开、不自动收起。理由是回合结束时整条消息会被重新拉取重挂载，不做持久化就会出现"我展开了，回合结束啪一下又合上"。**这条 iOS 一定要照抄**，否则流式→稳定的过渡会持续抖。

### 4.4 工具调用行：标题语法

`tool-call-registry.ts` 的 `getToolDisplay(block)` 为 **50 个具名工具 + 1 个兜底**定义了整行的全部内容。结构：

```
[连接器 logo?] [动作词] [目标] [· 执行位置?] [+增行数?] [-删行数?] [审批标记?] [用户输入标记?] [⌄]
```

- **动作词**来自 i18n（`chat.tools.*`），如 "读取"/"写入"/"编辑"/"应用补丁"/"列出目录内容"/"执行"/"搜索网络"/"抓取"/"派遣智能体"/"生成图像"…。GUI 工具的动作词是**二级命名空间**（`chat.tools.browserAction.click` → "点击"），并且**有变体**：`scroll` 带 direction 时变成"向上滚动/向下滚动"，`click` 带 button=right 时变成"右键点击" —— 因为方向/键位正是用户扫这一行要看的那一个信息。
- **pending 态**：工具已开始但参数还没流完（`!done && input == null`）时，动作词换成"正在写入文件/正在编辑文件/正在应用补丁/正在准备下一步"。
- **目标**：文件类工具只显示**文件名**，完整路径进原生 tooltip（`fullTarget`）。`read` 还细分：图片扩展名 → "查看图片"，PDF → "阅读文档"，带行范围 → "读取第 10–25 行" / "从第 120 行开始读取"。`exec` 显示描述（有 description 时隐藏动作词，避免"执行 Run …"），**完整命令不进 tooltip**（多行内容不能塞进原生 tooltip），只进展开详情。`web_search` 显示 `"查询词"`。
- **diff 数字**：`write`/`edit`/`apply_patch` 行上直接给 `+N` `-M`（成功绿 / 危险红）。`write` 用 `content_line_count` 避免为显示行数去切字符串。
- **执行位置**：只有当一条消息里的工具跑在**多于一个位置**时才显示（`message-item.vue` 对整条回复求集合），显示为 `· 名称`，native 显示"云端电脑"。
- **审批 / 用户输入标记**：`#4821 等待审核` / `已回答`、`已取消`、`失败`、`已过期` —— warning 色等宽小字。**行上只有只读状态，没有按钮**（见 §4.6）。
- **可展开性**：有 `detail` 组件、显式 `expandable`、或结果 `isError` 时为真。`write` 特殊：只有真的有 content 才可展开。
- **`defaultOpen`**：`apply_patch` 和带多文件的 `write` 默认展开（diff 是主内容）；其他默认折叠。
- **流式 shimmer**：延迟 250ms 才出现的微光文字（`tool-shimmer-text`），因为快工具（send/memory）100ms 内就结束，马上显示会闪。**shimmer 只加在动词上，不加在计数上**（组头注释："把计数也闪光会让整行变成均匀噪声，杀掉阶段与进度的对比"）。
- **失败不染色**：`tool-result-error.ts` 与 `tool-call-inline.vue` 注释明确写了 —— 工具结果里的 `isError` / 非零退出码**不是用户任务的失败**，agent 在虚拟机里试错、检查、修命令是正常的长任务行为。所以行标题保持中性色，不加退出码、不染红；诊断留在展开详情里，真正的任务失败由**回合级** error 块表达。

**19 个专用详情组件**（`tool-call-detail-*.vue`）+ 1 个通用兜底：

| 组件                                           | 用于                                     | 展开后显示                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`                                       | read / list / generate_video             | 带语法高亮的代码块（文件名当语言提示），最多 max-h-72（18rem）滚动，双向可滚                                                                                                |
| `exec`                                         | exec                                     | `$ 命令` + 非零退出码 + 后台任务元信息（taskId/状态/时长/输出文件）+ stdout / stderr（红）/ 错误文本 / 进度流，各自独立滚动（max-h-72）；全空时显示"等待输出中"或"暂无输出" |
| `apply-patch`                                  | write（多文件）/ apply_patch             | 文件列表（A/M/D 方框标记 + 路径）+ 摘要 + **Shiki 高亮的完整 diff**（max-h-96 双向滚动）+ 出错文本；高亮加载中转圈                                                          |
| `edit`                                         | edit                                     | 原文 / 新文对照                                                                                                                                                             |
| `write`                                        | write（单文件）                          | 写入内容预览（超长给"预览已截断，完整写入大小 N 字节"）                                                                                                                     |
| `web-search`                                   | web_search                               | 结果条目：标题（可点链接）+ URL + 两行描述                                                                                                                                  |
| `web-fetch`                                    | web_fetch                                | 提供方、格式、标题、摘要（斜体）+ 内容预览（上限 800 字符）                                                                                                                 |
| `browser`                                      | browser_action / browser_observe         | 页面结构快照、可交互元素数、URL、选择器、截图路径、坐标、CDP 地址、目标页                                                                                                   |
| `computer`                                     | computer_action / computer_observe       | 桌面动作、坐标、键位、截图                                                                                                                                                  |
| `remote-session`                               | browser_remote_session                   | 会话状态 / CDP                                                                                                                                                              |
| `memory`                                       | search_memory                            | 命中记忆                                                                                                                                                                    |
| `contacts`                                     | get_contacts                             | 联系人                                                                                                                                                                      |
| `email-accounts` / `email-list` / `email-read` | 邮件三件套                               | 账号 / 列表 / 正文（无主题时"（无主题）"）                                                                                                                                  |
| `schedule`                                     | list_schedule                            | 定时任务列表（未命名时"（未命名）"）                                                                                                                                        |
| `send`                                         | send                                     | 消息全文 / 回复对象 / 附件                                                                                                                                                  |
| `spawn`                                        | spawn_agent / send_message / list_agents | 子 agent 列表（agent id + 状态 + **可点跳转到那个会话**）                                                                                                                   |
| `image`                                        | generate_image                           | 图片（base64 内联，max-w-xs / max-h-64）+ 路径                                                                                                                              |
| `generic`                                      | 兜底 / 一切失败结果                      | 输入的 key: value 行（等宽）+ 错误文本（红）或结果文本                                                                                                                      |

`tool-result-error.ts` 有一条重要行为：**结果失败时用通用诊断组件替换专用组件，但标题不变**（"专用面板描述的是成功结果或尝试过的输入；失败要展示诊断，不该顺便改掉中性标题"）。而且它会把 `structuredContent` 里除 `isError/content/structuredContent` 之外的字段全部 JSON 化保留，避免"明明有诊断信息却显示空面板"。

### 4.5 思考块（reasoning）

`thinking-block.vue` + `reasoning-timing.ts`：

- 形状：一行可点文本 + 右侧 chevron。有正文时才是 button，没正文时是不可点的 div。
- **文案三态**：
  - 流式中 → "正在思考如何处理" + shimmer。
  - 有测量时长且 ≥ 1s → "已思考 {N} 秒"（四舍五入）。
  - 其他（历史块、或**亚秒级**）→ "思考了几秒"。
  - 亚秒判定的理由写在注释里：provider 把 reasoning 缓冲后一次性吐出时，量到的是**投递时间不是思考时间**，向上取整成 "1s" 会夸大一个可能想了很久的思考。
- **耗时两级来源**：优先用服务端在 assistant 行上持久化的 `reasoning_timing.duration_ms`；客户端计时是兼容旧行/旧服务的回退。客户端计时由 `message-item.vue` **集中**驱动（不是只测最后一个块）：流式中第一次见到某个块就打时间戳，**后面出现任何新块或回合结束就结算** —— 这样"刚思考完立刻调工具"的那种思考也有真实秒数，而不是干巴巴一个"已思考"。
- **展开态**：折叠区（grid 0fr↔1fr，400ms 缓动），正文 `whitespace-pre-wrap text-muted-foreground`，`trim()` 过以免开头空行。折叠状态同样按 key 持久化。
- 在 process 段内部时继承卡片的更小字号与更紧行高。

### 4.6 审批（approval）

桌面端**不做消息内联审批按钮**。两处配合：

**（a）工具行上的只读标记**（`tool-call-inline.vue`）：`#4821 等待审核`。注释明确写了："旧的 inline Allow/Reject 按钮用了绕过 Button 变体的裸颜色类，没什么值得留的。"

**（b）composer 上方停靠的审批卡**（`composer-panel-approval.vue` + `components/tool-approval-actions.vue`）。这是**唯一**能回应审批的地方。

布局：

```
[标题：能力名（如"执行命令"）  +  目标（非 exec 时显示）]
[Capsule 预览：
   exec             → 语法高亮的 bash 命令（max-h-48 滚动）
   permission       → 请求正文（按 request_lang 高亮）
   write/edit/patch → 复用该工具的详情组件
]
[小字状态行：#4821 等待审核 · 云端电脑 · 还有 2 项]
[按钮区]
```

关键行为：

- **标题用"能力"不是"每调用动词"**：优先查 `bots.toolApproval.toolNames.<toolName>`（读取文件 / 写入文件 / 执行命令），查不到才回退到工具行标签。理由："审批要授予的是能力。"
- **`permission` 特殊**：这是"映射不到具体工具的 agent 提问"（网络访问、模式切换、elicitation 兜底），带 agent 自己的 title 和 request，所以渲染那两个字段而不是工具名。
- **选项来自 agent，不写死**（`tool-approval-actions.vue`）：
  - 有 `options[]` → 每个 option 一个按钮，名字由 `kind` 映射：`allow_once` 仅允许本次 / `allow_always` 允许后续使用 / `reject_once` 仅拒绝本次 / `reject_always` 始终拒绝；option 带 name 时在按钮里追加 `— Agent 选项: <bdi>name</bdi>`（`bdi` 为双向文本安全）。**任何一个选项是 reject 类时，不再追加通用"拒绝"按钮**（避免重复）。
  - 没有 options（或都不带 id）→ 回退成两个按钮：**允许 / 拒绝**。
  - 允许类是 `default`（主）变体，拒绝类是 `secondary`。
- **拒绝要填理由**：点拒绝不立刻发，先展开一个 Textarea（autofocus，可空，"拒绝理由"）+ 取消 / 拒绝（destructive）两个按钮。
- **队列 FIFO，一次只有一张**：`usePendingApprovals` 给队列，`composer-panel.vue` 只渲染 `approvals[0]`；解决后下一张**原地交叉淡入**，容器高度用 `AutoHeight` 补间（"框不会跳"）。卡上写"还有 N 项"。
- **乐观且无 spinner**：store 立刻翻状态、面板换下一张，`responding` 标志只用来防双击。失败（WebSocket 断了）时卡片留在原地并重新启用按钮，用户可重连后重试。
- **审批卡和 composer 同时存在**：这是"栈层 vs 槽位"的设计（`composer-dock.vue` 注释）。理由：**回答审批是一次点击，不是打字，所以它不能抢走输入框** —— 用户可能想打一句"别这么干"。

### 4.7 user_input（ask_user 提问）

`chat-user-input-form.vue`。和审批相反，这个**会抢走输入槽**：`composer-dock.vue` 里 composer 用 `v-show` 隐藏（不是卸载，保住草稿），胶囊顶上来。注释写明这是刻意的产品决策：agent 在问的时候，回答是唯一重要的输入，而胶囊自己的自由文本框**就是**替代输入。用户点"取消"时才把 composer 还回去并聚焦。

形态：

```
[Capsule]
  每个问题一块（多问题之间细线分隔）：
    [问题文本，可换行，中等字重]
    [选项行：单选 = Circle/CircleDot，多选 = Square/SquareCheck，整行可点，
             选项描述进 tooltip，label 可换行]
    ["其他" 行（allow_custom 且非单选时）]
    [内联文本输入（text 类型问题或选中"其他"时）]
  ── 细线 ──
  [底部自由输入框（单个问题：text 类型或允许自定义时）]
  [提交（主） / 取消（次），等高 36px，各占一半]
```

逻辑细节：

- 单选：选项与自定义互斥；在底部输入框打字会清掉已选选项（后端只接受二者之一）。
- 多选：`custom_exclusive` 时选自定义清空选项、反之亦然。底部输入框**不出现在多选**（"一个底部输入框没法一次回答多个文本问题"）。
- 必填校验：`required !== false` 的问题必须答；可选问题未答时**显式发 `skipped: true`**（ACP 表单靠这个区分"没答"和"跳过"）。
- 换 `user_input_id` 时清空所有草稿。
- 取消时发 `{canceled: true, reason: 'user_canceled'}`。

**这一步 iOS 不能省**：漏掉 user_input 响应会让 run 永久卡在 `waiting_decision`（你自己的 AGENTS.md 也写了这条）。

### 4.8 输入队列（steer / follow-up）

`session-follow-up-queue.vue` + `use-session-follow-up-queue.ts`。生成中再发消息不进正文，进**队列**，两种语义：

- **steer（插入当前回复）**：在下一次调用工具的"安全步骤"处并入当前 run。文案："已加入当前回复队列"。
- **follow-up（添加到接下来）**：当前 run 结束后自动发。

每条队列项是一行：`⠿ 拖动柄 + 可编辑文本框 + [排到本次运行之后 / 插入当前运行] 按钮 + 删除`。支持 **drag 排序**（sortablejs）。已是 steer 的项改成一个绿色对勾状态。刷新由运行时投影事件触发（steer 被领取/应用、run 进入终态），10 秒定时器只是兜底。

**这一整块在 iOS 上是空白，而它恰恰是"人在外面"最需要的能力之一** —— 你不想打断 agent，但想追加一句。

### 4.9 composer 的能力清单

`chat-pane.vue` 第 390–1016 行是 composer 本体。它是**固定两行卡片**（textarea 行 + 控件行），不做"胶囊↔多行"的形状变换（形状永不随内容变）。欢迎态（`min-h-28` / `p-3`）比停靠态（`p-2.5` / `min-h-10`）更宽裕。

**上排（占满宽）：**

- **附件行**（grid 0fr↔1fr 展开，230ms）：每个附件一张 120px 方卡，四种形态 —— 媒体（图片/视频封面）、粘贴（前 4 行文本 + "粘贴"徽章）、文件（图标 + 扩展名 + 行数）、加载中骨架。可移除；点粘贴卡开全文查看器，点媒体卡开灯箱。
- **已选 Skill 芯片行**：✨ + 名称 + ✕。
- **语音录制条**（录音/转写中**替代** textarea，同高度所以盒子不跳）：实时音量条（条数由测量宽度推出，最新样本贴右缘，安静历史淡出成点）+ 秒数计时；取消 ✕ / 完成并转写 ✓。
- **textarea**：`field-sizing-content`，`max-h-52`，自动增高，`min-h-10`（欢迎态 `min-h-12`）。

**下排控件（从左到右）：**

1. **＋ 菜单**（`chat.composerActions` = "添加文件或切换 Agent"）：
   - **Agent**（仅会话还没有任何轮次时可切）：Memoh / 每个已启用的外部 agent，当前项打勾。
   - **文件夹**绑定：草稿态可选（含"不放入文件夹"），会话一旦建立就锁定成只读一项（因为工作区目标终身不变）。
   - **上传文件**。
   - 禁用条件很清楚：只读会话、流式中、加载中都不给点。
2. **目的地选择器**（`composer-continue-on.vue`，`chat.continueOn.label` = "继续位置"）：默认目标是云端电脑时只是一个图标圆钮；一旦会话被钉到真机或选中非默认项，**同一个元素**展开成带文字的 pill（`Laptop` 图标 + 名称 + chevron）。菜单里有"添加电脑 / 管理访问权 / 管理电脑"，以及"此 Bot 暂无电脑访问权"的空态。手机上永远不展开（宽度会挤死模型选择器）。
3. **上下文环**（`session-info-ring.vue`）：一个 24px 的 SVG 进度环，颜色随压力变化，hover 150ms 后弹出 320px 的信息面板。见 §4.10。
4. **模型选择器**：pill 形状（当前模型名 + chevron），弹出 320px 菜单，内含**三段**：
   - **会话模式**（仅 ACP 运行时且该 agent 声明了模式）：Select + 每个模式的描述 + 一句警示"切换会话模式可能改变外部 Agent 可执行的操作。工具授权仍需单独确认。"（warning 底色）。
   - **模型列表**：搜索 + 虚拟滚动 + 分组 + 描述 tooltip。
   - **推理强度**：关闭 / 自适应 / 极简 / 低 / 中 / 高 / 极高 / 最大。
   - 加载中 → "加载中…"；出错 → 错误文案 + 一个按钮（需要授权时"打开设置"，否则"重试"）。
5. **麦克风 / 发送（同一个位置，永不同现）**：
   - 无内容时是**实心 primary 圆的麦克风**（"语音输入就是这个位置的默认能力"）。
   - 有内容时**交叉淡入**成品牌色圆的 ↑。
   - 流式中**同一个圆**变成 ■（停止），保持可点。按钮表面在三态间**不变**，只有字形交叉淡入，所以不会在回合中途闪形状/闪颜色。
   - 语音输入有 7 种失败文案：未配置转写模型 / 浏览器不支持 / 麦克风权限被拒 / 没识别到内容 / 转写失败等。
6. 手机上（`max-md`）＋、麦克风、模型触发器、发送环都涨到 **44px**。

**键盘**：Enter 发送，Shift/Ctrl/Meta/Alt+Enter 换行；输入法组合中（`isComposing` / keyCode 229）不发送；Escape 关命令结果面板；上下键在斜杠面板/命令面板里导航，有高亮项时 Enter 选中它。

**粘贴**：超过 50 行或 2000 字符时**捕获成附件卡**（原文仍作为 .txt 随消息发出），避免大段文本淹掉输入框并把控件顶走。文本类文件（30+ 扩展名）在卡片上显示行数。

**斜杠命令面板**（composer 上方的 Command 弹层）：三组 —— 快捷操作（`/help`、`/skill list`…）、**Agent 命令**（外部 agent 自己声明的，带描述与 input hint）、**Skills**（每个带描述）。空结果有专门的"没有匹配的 slash 操作"，技能目录加载中有"正在加载 Skills"。

### 4.10 会话头部 / 会话信息

**桌面端没有"会话顶部栏"** —— 这是和 iOS 最大的形状差异。会话标题在侧栏行里、在浏览器标签上，聊天区顶部直接是消息。状态信息全收在两处：

**（a）composer 上方的浮层**（`chat-pane.vue` 240–275 行）：

- **后台任务 pill**（`bg-task-pill.vue`）：`⏳ 3 个运行中 · <最新一行输出>`，可点跳到底部；已完成时变成 `✓ 3 个已完成`。最新输出用 `live-peek-line` 节流到 240ms 刷一次（"追逐原始 token 流看得很累"）。
- **跳到最新按钮**：不在底部时才出现的圆形 ↓ 按钮。

**（b）上下文环 → 会话信息面板**（`session-info-panel.vue`），"关于这次会话我知道什么"的完整清单：

| 行                                      | 内容                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消息数                                  | `message_count`                                                                                                                                                                                                                                                                  |
| 上下文使用率                            | `~{已用} / {窗口}` + 百分比（估算时前面带 `~`），下面接**组成条**                                                                                                                                                                                                                |
| 组成条（`context-usage-breakdown.vue`） | 一条横向堆叠条 + 图例：系统提示词 / 工作区规则 / 工具 / 技能 / 记忆 / 摘要 / 对话 / 其他 + **输出预留**（灰）+ **剩余空间**；条上有一条**自动压缩阈值刻度线**；条下写"自动压缩阈值 ~N"                                                                                           |
| 供应商输入                              | 最新一轮 provider 报的实际输入 token（"唯一一座实际↔估算的桥"）                                                                                                                                                                                                                  |
| Cache 命中率                            | 百分比                                                                                                                                                                                                                                                                           |
| Cache 读取                              | token 数                                                                                                                                                                                                                                                                         |
| 立即压缩                                | 按钮（仅 native runtime 有；模型自管上下文时不显示）                                                                                                                                                                                                                             |
| 上下文检查器                            | 打开 Dialog（`context-lifecycle-dialog.vue`）：按轮次列出每次请求的组成（入选/丢弃/截断数量、丢弃原因、信任分布 系统/工作区/用户/外部、变更、步骤、窗口、稳定前缀、cache 读/写、状态 已完成/回退/预算失败/供应商失败/已中止），可"加载至多 N 轮"，有"本页之外还有更早的轮次"提示 |
| 子智能体                                | 列表（agent id + 跳转外链）                                                                                                                                                                                                                                                      |
| Skills                                  | 这次会话用过的技能名列表，空态"此会话未使用任何 Skill"                                                                                                                                                                                                                           |

没有会话时整块显示"暂无数据"。

### 4.11 空态 / 加载态 / 错误态

`chat-pane.vue` 里这段有明确分支：

| 情形                                                 | 呈现                                                                                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 没选 bot                                             | `PanePlaceholder`："选择一个 Bot" / "从侧边栏选择一个 Bot 开始对话"                                                                                                                                             |
| 有活跃 run 但还没有任何消息（比如子 agent 还没产出） | 居中的转圈（**不是**空态 —— "读起来是'正在开始'而不是'空的'"）                                                                                                                                                  |
| 只读会话（系统会话 / 同步的频道会话）且没消息        | "系统会话暂无记录"，居中灰字                                                                                                                                                                                    |
| 新会话（可写、无消息）                               | **欢迎态**：composer 抬到垂直居中，上面一句问候语 `h1`；问候语从 12 句里随机（"我们从哪里开始？"/"在想些什么？"/"需要帮你做点什么？"…），每次进入新会话重抽；文件夹会话用带名字的变体"要在 {name} 里做点什么？" |
| 向上加载更早                                         | 顶部细线哨兵进入视口即加载，加载中小转圈                                                                                                                                                                        |
| 消息列表加载失败                                     | store 层 toast                                                                                                                                                                                                  |
| run 失败                                             | **回合级 error 块**（红卡），不是 toast                                                                                                                                                                         |
| 运行时降级                                           | **notice 块**（黄卡），"这一轮还在继续"                                                                                                                                                                         |
| 发送失败                                             | composer 面板里的错误行（`composer-panel-error.vue`），红图标 + 文本，随 composer 一起，不飘走                                                                                                                  |
| 命令/slash 报错                                      | 同一面板的 command 段（标题红 + ✕ 关闭 + 可选项列表），约 20 条具体错误 key（未知 slash、不支持附件、skill 找不到/歧义/被禁用、权限不足、需要 WebSocket 重连…）                                                 |
| 正在压缩上下文                                       | 面板里一行 shimmer "正在压缩上下文…"                                                                                                                                                                            |
| WebSocket 断连                                       | toast 提示重连；审批卡因发送失败留在原地可重试                                                                                                                                                                  |

### 4.12 滚动行为

`useChatScroll.ts`（900+ 行）是桌面端最讲究的一块，值得照抄的语义：

1. **"在底部"是阈值不是像素**：距内容末端 30px 内都算在底部（"低于一行正文，所以刻意上滑仍然能解锁跟随"）。量的是**内容末端**（最后一条消息的下边缘）而不是 `scrollHeight`。
2. **跟随 / 逃离是两个非响应式锁存器**：`isAtBottom` 是唯一喂给 UI 的响应式镜像（只驱动"跳到最新"按钮），热路径锁存器故意不做响应式，避免滚动风暴触发重渲染。
3. **用户意图靠"物理手势信号"判定**（`wheel` / `touchstart` / `pointerdown` / 键盘导航键），而不是靠 scroll 事件 —— 因为程序化滚动不会触发 wheel。目的：区分"用户上滑"和"内容长高导致的滚动"，后者不该打断跟随。
4. **发送 = 退休上一个预留 + 把视口停在新的提示处 + 只把最新一轮的内容向上平移**（外层预留不参与 transform，免得动画互相打架）。`PIN_TOP_OFFSET_PX = 140`：把刚发的提示留在视口顶部下方一点，让上一轮还在上面可见。
5. **每个回合是持久容器**，`min-height` 预留写在最后一轮容器上。
6. **跳转用原生平滑滚动**；`scrollToBottom` 会**重新武装跟随**再缓动下去，期间流式内容继续推进也不会跑偏。
7. **返回隐藏标签页时做一次"追赶"**：`message-item.vue` 监听 `visibilitychange`，回前台时把 smooth-streaming 关掉一帧再打开，让堆积的 token 一次性满上，而不是回前台后"打字"几十秒。
8. **右侧滚动轨**（`chat-scroll-rail.vue`，仅 ≥768px）：折叠态是每个用户回合一个短刻度（当前项更亮）；hover 80ms 后展开成 320px 的**跳转列表**（显示每条用户消息的预览），点击平滑跳转。少于 2 个回合不显示。

---

## 5. iOS 上缺什么

对照 `/Users/lijixiang/projects/memoh-ios/apps/mobile/src`。**块类型层面你已经齐了**（`models/chat.ts` 的 `RenderBlock` 有 text/reasoning/tool/error/notice/attachments，`memoh-kit/ios/Chat/MessageCells.swift` 有对应的六个 Cell）；**缺的是每个块里的信息密度和交互**。

### 5.1 功能缺失 —— 该补

按"手机上真的会用到"排序：

| #   | 缺什么                                    | 桌面端位置                                         | 为什么手机上要                                                                                                     |
| --- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **输入队列（steer / follow-up）**         | `session-follow-up-queue.vue`                      | 人在外面最常见的动作就是"agent 还在跑，我再补一句"。现在只能等它跑完或打断                                         |
| 2   | **会话信息 / 上下文用量**                 | `session-info-ring.vue` + `session-info-panel.vue` | "还要多久会撞上下文上限""这次花了多少 cache"是决定性信息。iOS 完全没有任何上下文数据                               |
| 3   | **工具调用的展开详情**                    | 19 个 `tool-call-detail-*.vue`                     | 现在 `ToolMessageCell` 只有标题行，看不到 diff、命令输出、搜索结果。**审批时看不到要执行什么命令**，这是安全性问题 |
| 4   | **ask_user 提问表单**                     | `chat-user-input-form.vue`                         | 不响应会让 run 永久卡住。`respondUserInput` 已在 store 里，但没有 UI                                               |
| 5   | **拒绝审批时填理由**                      | `tool-approval-actions.vue`                        | 现在是直接拒绝，agent 拿不到原因                                                                                   |
| 6   | **审批队列**                              | `usePendingApprovals.ts`                           | 多个审批同时挂起时，桌面端是 FIFO 一次一张 + "还有 N 项"；iOS 只有一个                                             |
| 7   | **过程段分组（多工具折叠成一段）**        | `tool-call-group.vue`                              | 长任务里工具调用会把消息流冲垮。桌面端把它压成一行"探索中 · 12 次文件操作、4 次搜索"                               |
| 8   | **思考耗时**                              | `reasoning-timing.ts`                              | `RenderBlock.reasoning` 里已有 `durationMs`，但 `chat.reasoning` 只显示一个固定词                                  |
| 9   | **附件发送**                              | `useComposerAttachments.ts`                        | composer 现在只有文本。图片/文件是"在外面"场景的高频输入                                                           |
| 10  | **模型 / 推理强度切换**                   | `chat-pane.vue` 的模型 popover                     | 现在 iOS 完全不能切模型                                                                                            |
| 11  | **会话搜索**                              | `session-search-dialog.vue`                        | 会话多了以后必需                                                                                                   |
| 12  | **会话重命名 / 删除**                     | `session-item.vue` 的菜单                          | iOS 的 `SessionRow` 只有点击，没有 swipe actions                                                                   |
| 13  | **消息级操作：复制 / 重试 / 编辑 / 分叉** | `message-actions.vue`                              | iOS 有 `chat.message.copied` 文案，但看起来没有重试/编辑/分叉                                                      |
| 14  | **后台任务状态**                          | `background-task-block.vue` + `bg-task-pill.vue`   | 长任务在后台跑时，用户需要"它还在跑 / 输出到哪一行了"                                                              |
| 15  | **粘贴大段文本转附件**                    | `useComposerAttachments.ts` 的阈值逻辑             | 手机上粘贴长文更容易发生                                                                                           |
| 16  | **子智能体列表（可跳转）**                | `subagent-list.vue`                                | agent 派了子 agent 时，用户需要能跟进去看                                                                          |
| 17  | **右上/右缘的"跳到最新"与"当前在跑什么"** | `showJumpToBottom` + `bg-task-pill`                | 生成中上滑后没有回底部的路                                                                                         |
| 18  | **用量统计页**                            | `pages/usage/index.vue`                            | token / cache / 推理 token 的按日、按模型拆分                                                                      |

### 5.2 功能缺失 —— 该砍（明确决策，不要犹豫）

- **dockview 多面板工作台、终端面板、浏览器面板、远程桌面面板、分屏**。手机既没指针也没键盘。
- **Bot 详情 19 tab 的绝大多数**：工具审核规则（glob/白名单）、Hooks JSON 编辑、MCP server 配置、依赖管理、访问控制规则、工作区容器（快照/回滚/GPU）、网络、邮件、技能发现路径、上下文压缩阈值。**一条原则**：需要键盘输入结构化文本的，都留在桌面。
- **服务商 / 搜索引擎 / 语音 / 视频 / 邮件提供方配置**（`/settings/providers` 等 6 页）。
- **成员管理（people）**、**快捷键**、**字体字号 / Shiki / Mermaid 主题 / 5 套配色方案**。
- **工作区文件树的全功能版**（新建/上传/批量选择/拖拽）。只留"只读浏览 + 预览"。
- **Onboarding 5 步向导**（尤其要填 API Key 那一步）。
- **多窗口 / 多标签**（dockview 的 tab 语义在手机上不存在）。

### 5.3 信息缺失 —— 同一功能，桌面显示了更多

| 功能     | 桌面显示                                                                                                                   | iOS 现在                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 会话行   | 标题 + 类型图标（agent / 定时任务）+ **生成中转圈** + 相对时间                                                             | 标题 + `source` + 相对时间。**没有生成中状态** —— 用户不知道哪个会话在跑（虽然首页顶部有 ActiveRuns，但列表行本身不区分） |
| 会话标题 | 频道会话显示群名/对端名；未命名显示"未命名会话"                                                                            | 只有 `title`，空标题就空着                                                                                                |
| 工具行   | 动作词 + 目标 + `+N -M` diff + 执行位置 + 审批标记 + 展开                                                                  | 只有 `title` 一行                                                                                                         |
| 思考     | "已思考 12 秒" / "思考了几秒" / 流式三态                                                                                   | 一个静态词                                                                                                                |
| 头部     | 状态收在 composer 附近（后台任务 pill、上下文环、跳到最新）                                                                | 标题 + 副标题（"谁 · 在干什么"）—— 这个副标题做法其实**比桌面端更好**（桌面端根本没有会话头），别丢                       |
| 错误     | 回合级 error 块 + 面板错误行 + 输入框恢复（`restoreInput`）+ 具体错误码文案（20+ 条 slash 错误、20+ 条 `externalAgent.*`） | `runError` 一段文本；且 `runError` 是否同时覆盖 run 失败与连接失败，代码里分不清                                          |
| 审批     | 能力名 + 命令预览（语法高亮）+ 执行位置 + 队列长度 + agent 选项名                                                          | 工具名 + 入参原始 JSON（`ApprovalSheet.tsx` 里的滚动区）                                                                  |
| 消息     | 相对时间 + 日历时间（在 ⋯ 菜单里）                                                                                         | 看不到时间戳展示                                                                                                          |

### 5.4 概念缺失 —— 桌面有、iOS 完全没有

1. **"过程段"（process segment）**：把连续的工具/思考折叠成一个有阶段名和计数摘要的单元。iOS 目前是一堆平铺的块。
2. **回合（turn）作为一等容器**：桌面每轮一个常驻容器、有 `turnId`（重试/编辑/分叉都按 turn 寻址，不是按 message id）、有分叉来源分隔线。你的 `RenderTurn` 已有 `key/position/user/assistant/active`，但没把它当成"可操作单元"。
3. **运行（run）与队列**：run 是一个有终态的对象（`waiting_decision` 是权威信号），可以有 steer / follow-up 挂上去。
4. **执行位置（execution location）**：同一条回复里的工具可能跑在云端容器或某台已连接的电脑上。桌面端在确实混了位置时才显示。
5. **文件夹（folder / workdir）**：会话可以绑到一个工作目录，侧栏按文件夹分组。iOS 完全没有这个维度。
6. **会话类型**：对话 / 讨论（discuss，群聊） / 定时任务 / 子智能体 / 外部 Agent（ACP）。桌面用图标 + 筛选 + 用量统计维度区分。
7. **上下文生命周期**：上下文不是"一个数字"，是每次请求的组装结果（入选/丢弃/截断/信任分布/变更类型）。
8. **后台任务**：`bg_status` / `list_background` / `kill_background` / `wait` 是一整套独立工具与状态。
9. **技能（Skill）与斜杠命令**：`/<skill-name>` 激活、`/help`、`/new`、`/permission`、`/model`、`/compact`。
10. **会话模式与权限模式**（仅 ACP）：会话级可切换，切换会改变 agent 能做什么。
11. **消息级"分叉"**：从某一轮创建新会话，带来源分隔线。
12. **`notice` 与 `error` 的语义区分**（降级 vs 失败）—— 你的模型里有 `notice`，但注意它不能画成红色错误。
13. **只读会话**：IM 频道会话是只读的，桌面端对这类会话隐藏 composer 并给专门文案。
14. **多 bot 并发运行**：桌面上每个 bot 一条 WebSocket，能看到别的 bot 在跑（你的 `useSessionActivity` 已在做这件事，这是 iOS 的强项，保持）。
15. **用量统计**（token / cache / 推理 token 按日、按模型、按会话类型）。
16. **频道（IM）会话**：同一个 bot 在 Telegram / 飞书里的会话和 Web 会话在同一条时间线里，带平台徽章。

---

## 6. 值得抄的具体做法（直接可搬）

1. **两段式组头（阶段动词 + 裸计数）**。`探索中 · 12 次文件操作、4 次搜索、3 条命令`。核心不是文字，是三条纪律：(a) 时态跟这个段自己的生命周期走，不是全局；(b) 计数用**比桶更细**的片段种类，宁可退化成"12 步"也不编造名词；(c) 只有多工具段才有动词，单工具段不给。这直接决定 iOS 消息流的"呼吸感"。
2. **折叠状态按稳定 key 持久化，跨"回合结束重新拉取"存活**（`process-collapse.ts`）。不这么做，流式结束的瞬间用户展开的东西会合上。用「messageId + 块的后端 id」而不是内容做 key，上限 2048 条 LRU。
3. **流式 shimmer 延迟 250ms 才出现，且只加在动词上**。"快工具闪烁"和"整行都在闪"是两个不同的体验 bug。
4. **工具失败不染色、不改标题**。`isError` / 非零退出码 ≠ 用户任务失败。诊断进展开详情，任务失败只由**回合级** error 表达。这一条能避免 agent 试错时用户被反复惊到。
5. **思考时长的三级文案 + 亚秒不取整**：流式中 / "已思考 N 秒" / "思考了几秒"。亚秒只说明"provider 缓冲了"，说成 1s 是撒谎。
6. **审批按钮不写死，渲染 agent 的 `options[]`**；allow 类是主按钮、reject 类是次按钮；拒绝时先弹可空理由输入框；有 reject 类选项时不再追加通用"拒绝"；允许类选项名后追 agent 自己的选项名（`允许每次 — Agent 选项: 本项目`）。
7. **审批卡不抢输入框，ask_user 胶囊抢输入框**。前者是"点一下"，用户可能还想打字说"别这么干"；后者是"回答问题"，回答就是唯一输入。这条区分让两种打断各自有正确的分量。
8. **审批队列一次一张 + 原地交叉淡入 + 高度补间**（`AutoHeight`）。框不跳。
9. **审批标题用"能力名"而不是"每次调用的动词"**（"执行命令"而不是"执行 ls -la"），目标/命令正文放在下面的预览里。
10. **输入队列的两种语义**（steer 插入当前 run / follow-up 排在后面）以及拖动排序。这是桌面端对"agent 在跑的时候人想说话"给出的完整答案。
11. **composer 是固定两行卡片，形状永不随内容变**；发送/停止/麦克风三态**共用同一个圆**，只交叉淡入字形，表面不改。这样按钮不会在回合中途闪。
12. **滚动语义**：30px 的"在底部"阈值、量内容末端而不是 `scrollHeight`、用户意图靠物理手势信号而不是 scroll 事件、发送后把新提示停在视口顶部下方 140px、跳到最新时重新武装跟随。**这几条直接决定"生成中滚到底"的手感**，iOS 原生列表也要按这个逻辑写（`UICollectionView` 的 `contentOffset` 调整同理）。
13. **回前台时把堆积的流一次吐完**（`visibilitychange` 那一手）。手机上更常见（切走回微信再回来），比桌面端更重要。
14. **粘贴超过阈值时变成附件卡**（50 行 / 2000 字符），原文仍作为 .txt 随消息发出。
15. **空态按"为什么空"分支**：没选 bot / 有 run 但没产出（转圈，不是空态）/ 只读会话（"系统会话暂无记录"）/ 新会话（问候语 + 居中 composer）。**四态不能合并成一句"暂无消息"。**
16. **欢迎态把 composer 抬到垂直居中并配一句会换的问候语**（12 句随机）。空页面的第一印象就是这个。
17. **消息操作行只在"最新一轮已完成"时常显，历史轮 hover/长按才出现；流式中整行隐藏**。以及整行**预留高度**（`h-8`）让布局永不跳。
18. **`TooltipProvider` 关闭 hoverable content**：指针移开触发器时 tooltip 立刻消失，不留一个悬在已消失按钮上的残影。手机上对应的是"长按预览的按压态要跟手指走"。
19. **错误文案分层**：协议/工具错误 → 展开详情里的诊断；回合失败 → 回合级 error 块；发送失败 → composer 旁的错误行（不飘走、能就地重试）。**三层不要混成一个 toast。**
20. **Web 端自己的窄屏壳（<768px）就是上游给的移动端答案**：`pages/main-section/components/mobile-nav-sheet.vue`（把桌面侧栏整体搬进左侧 Sheet：Bot 切换、3 个视图行、三个面板、设置行；选中即关闭）、`mobile-top-bar.vue`（≡ 开导航 / ← 回到聊天 / 居中标题 / ＋ 菜单里放终端、浏览器、桌面、关闭面板；标题读 active 会话名或 bot 名；图标按钮 44px），`pages/settings-section/index.vue` 里的"设置 = 地址化的列表层（bare `/settings`）+ 内容层（`/settings/x`）+ 抽屉层"三级栈，以及"列表页横滑进、内容页横滑出"的转场。**这三处直接告诉你上游认为手机上哪些该留、哪些该收进菜单 —— 是 iOS 最省力的对齐参照。**
21. **只读态要明说**：`activeChatReadOnly` 时 composer 整个不渲染，空会话给"系统会话暂无记录"，输入框 placeholder 换成"该聊天为只读，无法发送消息"、上方一行"该聊天为只读"。不要只是把发送按钮置灰。

---

## 7. 参考：iOS 侧要动的文件（现状坐标）

- 领域模型：[`apps/mobile/src/models/chat.ts`](../../projects/memoh-ios/apps/mobile/src/models/chat.ts)（`RenderBlock` / `RenderTurn` / `PendingApproval` / `PendingUserInput` / `ToolStatus` 已齐）
- 对话页：[`apps/mobile/src/screens/ChatScreen.tsx`](../../projects/memoh-ios/apps/mobile/src/screens/ChatScreen.tsx)（265 行；composer 只有单行 TextInput + 发送/停止同圆）
- 会话列表：[`apps/mobile/src/screens/HomeScreen.tsx`](../../projects/memoh-ios/apps/mobile/src/screens/HomeScreen.tsx)（`SessionRow` 两行 + 右对齐时间戳 + 缩进分隔线，已是原生做法）
- 审批：[`apps/mobile/src/ui/ApprovalSheet.tsx`](../../projects/memoh-ios/apps/mobile/src/ui/ApprovalSheet.tsx)（已正确渲染 agent options + 二元回退）
- 待办/活动：[`apps/mobile/src/ui/PendingApprovals.tsx`](../../projects/memoh-ios/apps/mobile/src/ui/PendingApprovals.tsx) + `src/features/activity/useSessionActivity.ts`（跨 bot 待办 → 自动切 bot → 跳会话，这条逻辑 iOS 有而桌面端没有）
- 原生消息流：[`apps/mobile/modules/memoh-kit/ios/Chat/MessageCells.swift`](../../projects/memoh-ios/apps/mobile/modules/memoh-kit/ios/Chat/MessageCells.swift)（六种块 Cell + 思考展开状态）、`Transcript.swift`
- 文案表：[`apps/mobile/locales/zh-Hans.json`](../../projects/memoh-ios/apps/mobile/locales/zh-Hans.json)（约 90 个 key；桌面端 `chat.*` 命名空间本身就有 200+ 条）

## 8. 没找到 / 不确定的部分

- **会话头部的"标题"在桌面端何处编辑**：只找到 `renameSession` 的对话框（`components/sidebar/session-dialogs.vue`），没找到自动标题生成的触发点；`/settings/profile` 里有"标题生成模型"（title_model）配置，推断是服务端在首轮之后生成标题。
- **`stop`/abort 的文案**：`chat-pane.vue` 里 send 按钮的 aria-label 是硬编码英文 `'Stop generating response'` / `'Send message'`，没有走 i18n（`aria-label` 那一行）。属于上游的小疏漏，列在这里以免 iOS 照抄时以为它有对应 key。
- **移动壳里"文件/日程"两个视图在真机上的可用性**：`mobile-nav-sheet.vue` 原样搬了 `PanelFiles` / `PanelSchedule`，但 `main-section/index.vue` 只在 `<768px` 用 `MobileTopBar`，没有对这两个面板做移动端专属优化 —— 说明上游自己也没认真验证过手机上的文件/日程。
- **iOS 侧 `runError` 的语义边界**：`ChatScreen.tsx` 里区分"以 `error.` 开头的自造 key → 走 i18n"与"服务端已本地化文案 → 原样显示"，但没找到哪些错误走哪条路的映射表（在 `features/chat/reducer.ts`，本次未逐行读）。
