# Memoh iOS

独立维护的 **Memoh** 原生 iOS 客户端。不是 Memoh 官方项目，与上游团队无关；本仓库的问题请反馈到这里，不要提交给上游。

- 上游 Memoh：https://github.com/felinics/Memoh （AGPL-3.0）
- 我们的 fork：https://github.com/AidenNovak/Memoh （只用于后端联调与必要的补丁，不向上游提交）
- 本仓库：https://github.com/AidenNovak/memoh-ios

## 这是什么

Memoh 是一个多 agent 平台：每个 agent 拥有自己的云电脑（文件系统、桌面、浏览器、网络、长期记忆），7x24 在线，可接入 Claude Code / Codex 这类编码 agent，也能接 MCP 工具与定时任务。它现在只有 Web 与桌面端。

这个 App 要回答的问题是：**人离开电脑的时候，还能不能接着干活。** 具体是——在手机上看 agent 跑得怎么样、回一句话、批准它要确认的操作。

## 技术路线

沿用 Lody iOS 验证过的路线：

- **Expo + React Native 做基座**：导航、状态、列表壳、表单、文案。
- **Swift/UIKit 做手感**：凡是 RN 达不到的体验（无限消息流、流式文本、键盘几何、原生列表行、大文件 diff），一律写原生，而不是用 RN 装饰层去模仿系统效果。所有原生能力收口在 `apps/mobile/modules/memoh-kit`，业务代码只从 `@memoh-ios/kit` 导入。
- **只做 iOS**：不要 Android 实现、不要 fallback stub、不要 Android 构建脚本。
- **验收优先行为**：单元测试、类型检查、构建通过都不算验收。验收要落成不可修改的轮次，带截图（视觉状态）或录屏（时间行为）证据。

目录约定与硬约束见 [AGENTS.md](AGENTS.md)。

## 快速开始

```bash
# 1. 起本地联调隧道（把 vultr-sg 上的 Memoh dev 环境映射到 127.0.0.1:18080 / 18082）
pnpm dev:env

# 2. 装依赖
pnpm install

# 3. 跑起来
pnpm ios          # prebuild + pods + expo run:ios
```

开发用的 Memoh 环境跑在 `vultr-sg`（与同机生产隔离，端口只绑 127.0.0.1），不依赖任何云端账号。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm start` | Metro（dev client） |
| `pnpm ios` | prebuild + CocoaPods + 构建并安装到模拟器 |
| `pnpm bundle` | 不发版的打包冒烟，验证 bundle 可产出 |
| `pnpm check` | typecheck + i18n 校验 + 格式检查 |
| `pnpm test` | 纯逻辑单测 + 验收基建自身的单测 |
| `pnpm verify:build` | 构建 Debug 模拟器 App（产物路径给下游脚本用） |
| `pnpm verify:ui` | 跑 UI 行为基线 |
| `pnpm verify:simulator --name X -- <cmd>` | 租一台模拟器跑命令，`$MEMOH_VERIFY_UDID` 可用 |

## 文档

- [AGENTS.md](AGENTS.md) — 工程宪法，改代码前先读
- [docs/research/memoh-api.md](docs/research/memoh-api.md) — Memoh 服务端 API、WebSocket 协议、消息渲染契约
- [docs/research/memoh-design-baseline.md](docs/research/memoh-design-baseline.md) — iOS 设计基线
- [docs/research/lody-ios-patterns.md](docs/research/lody-ios-patterns.md) — 参考项目的工程范式提取
- [docs/environment.md](docs/environment.md) — 开发/联调环境怎么起、怎么连

## 许可证

AGPL-3.0-only。参考项目 `lody-ios` 同为 AGPL-3.0-only：本仓库借鉴其**结构与契约**，不复制其源码文本。
