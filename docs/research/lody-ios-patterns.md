# 从 `lody-ios` 提取的 iOS-only RN + Swift 工程范式（Memoh iOS 脚手架配方）

- **参考仓库**：`/Users/lijixiang/projects/reference/lody-ios`（只读副本；下文路径相对该仓库或相对 `apps/mobile/`）
- **目的**：把 Lody 的工程骨架、原生模块范式、呈现/导航/i18n/主题分层、验收基建、CI/发布流程整理成"另一个工程师照着就能起步"的可执行配方，用于 Memoh（Go 后端的多 agent 平台）iOS 客户端。
- **事实基线**：iOS 26+（`deploymentTarget: 26.0`）、Expo SDK 57、React Native 0.86.3、pnpm 11.10 workspace、Node ≥ 22.13、Swift 6、单一本地 Expo Swift 模块 `apps/mobile/modules/lody-kit`（TS facade 名 `@lody-ios/kit`）。
- **未验证**：本机是只读副本且**未安装 `node_modules`**，我读的是源码与脚本，没有实际跑过它的构建/验收命令。凡是从代码推断而非文档明说的点都标注"未验证"。

> ## ⚠️ 先决条件：许可证
>
> `lody-ios` 是 **AGPL-3.0-only**（根 `package.json`、`LICENSE`）。**不要把这个仓库的源码文本拷进 Memoh**——AGPL 对"通过网络提供服务"的衍生作品有源码开放义务，会污染 Memoh 的许可证。
> 本文只提取**结构、约定与脚本范式**（目录分层、契约设计、验收流程、CI 拓扑）。照抄目录与契约是安全的；整段复制 `.swift` / `.ts` / `verification/*.py` 的代码文本不安全，请自己重写。下文片段只作"形状"参考。

---

## 0. 一句话总结这套范式的赌注

1. **只做 iOS**：`platforms: ['ios']`，明确禁止 Android 实现与 fallback stub（AGENTS.md:5）。
2. **RN 负责编排（导航、状态、列表壳、表单、文案），Swift/UIKit 负责一切"手感"**：无限列表 UICollectionView、流式文本、diff 高亮、代码视图、玻璃按压、Toast 层级、键盘几何。**RN 达不到的体验就用 Swift 写，而不是用 RN 装饰性覆盖层模拟系统效果**（AGENTS.md:21）。
3. **原生能力只有一个出口**：一个本地 Expo 模块 `LodyKit`，不拆多个 bridge 包；业务代码只能 `import ... from '@lody-ios/kit'`。
4. **验收不是"构建通过"**：模拟器 + 无登录 + 无云端的**行为基线**，截图（视觉状态）与录屏（时间行为）分工，失败即失败，没有 pixel-diff 自动通过。

Memoh 若认同这四条，剩下都可以直接搬；不认同（要 Android、要 Expo Go 快速迭代），这套骨架会变成负担。

---

## 1. 仓库骨架

### 1.1 根目录

```text
lody-ios/
├── AGENTS.md                 # 真·工程宪法（CLAUDE.md 是它的软链）
├── CLAUDE.md -> AGENTS.md
├── README.md                 # 产品/功能/验收命令总览
├── package.json              # 根编排：只做 script 转发 + 4 个 devDependency
├── pnpm-workspace.yaml       # workspace 成员、overrides、patchedDependencies
├── pnpm-lock.yaml
├── tsconfig.json             # { extends: "expo/tsconfig.base" }
├── .prettierrc.json          # { singleQuote: true, trailingComma: "all" }
├── patches/                  # 2 个上游补丁（见 §7）
│   ├── expo-router@57.0.19.patch
│   └── react-native-screens@4.26.2.patch
├── packages/dom-webview/     # vendored @expo/dom-webview（改名 + 单 iOS + 共享 WebView）
├── apps/mobile/              # 唯一的 app
├── docs/                     # architecture.md / webview-runtime-poc.md / superpowers/{plans,specs}
└── .github/{workflows,scripts}
```

`patches/` + `pnpm-workspace.yaml` 的 `patchedDependencies` 是**上游 bug 的显式白账**：每条补丁都在验收 README 里写明"为什么打、何时能删"。`packages/dom-webview` 展示了"必须改上游包时怎么办"：fork 进 workspace、用 `overrides` 顶掉 `expo` 的嵌套依赖、并加运行时自检（`assertVendoredDomWebView()` + Swift `Constants(["vendor": "lody"])`）防止解析回退（`packages/dom-webview/VENDOR.md`）。Memoh 不需要就不建 `packages/`。

### 1.2 `apps/mobile`

```text
apps/mobile/
├── app.config.ts             # 唯一的原生工程真源（ios 段 + plugins + updates）
├── index.js                  # 入口装配：expo-asset → i18n boot → expo-router/entry
├── metro.config.js           # getDefaultConfig + 把 __dirname 混入 cacheVersion
├── tsconfig.json             # strict + paths(@/* → src/*, @lody-ios/kit → modules/lody-kit/src)
├── package.json              # @lody-ios/mobile：脚本 + 依赖
├── Gemfile / Gemfile.lock    # cocoapods ~>1.16 + cocoapods-spm
├── PUSH_NOTIFICATIONS.md
├── assets/
├── locales/{en,zh-Hans}.json # 唯一文案真源（单层扁平 key）
├── plugins/                  # config plugins：withLocales / withPushNotifications / withMarkdownView
│                             #   / withLodyIcons + locales.js + push-extension.rb
├── scripts/
│   ├── build-decoder.mjs     # 生成 modules/lody-kit/ios/Resources（esbuild 打包离屏 HTML + 许可证）
│   └── build-licenses.mjs    # 生成/校验 src/features/licenses/licenses.generated.ts
├── modules/lody-kit/         # ★ 唯一原生模块（Swift + TS facade + 原生行为验证 + 离屏 JS runtime）
│   ├── expo-module.config.json
│   ├── package.json           # name: @lody-ios/kit
│   ├── ios/                   # 98 个 Swift 文件，按功能目录分（Chat/ Chrome/ Cloud/ Diff/ List/ ...）
│   ├── src/                   # TS facade，按同样的功能目录分
│   ├── data-runtime/ decoder/ # 跑在离屏 WebView 里的 TS（CRDT/Streams、旧解码器）
│   ├── live-activity/ notification-extension/ licenses/
│   └── verification/          # ★ 原生行为检查（每 case 一个目录 + main.swift）
├── src/
│   ├── app/          # 仅路由文件（+native-intent / +not-found）
│   ├── screens/      # 仅 *Screen 文件（debug/ 例外）
│   ├── features/     # 领域逻辑（不得 import screens）
│   ├── models/       # 数据形状/解码
│   ├── cloud/        # 云协议：auth / catalog / github / send / kv
│   ├── hooks/screens/# 把 features 接到导航（usePageRuntime、useBindSessionNav…）
│   ├── lib/{presentation,i18n,theme}   # 与业务无关的基础设施
│   └── ui/           # 共享 RN 组件
├── tests/            # Node test runner（.test.mjs）+ fixtures
└── verification/     # ★ 验收基建：build/simulator/clean/native + ui/
```

配置文件职责：

| 文件                           | 承担什么                                                                                                                                                                                                                   | 关键点                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.config.ts`                | 原生工程**唯一真源**：name/slug/version/platforms/scheme/orientation/icon、`ios.deploymentTarget`、bundleIdentifier、`appleTeamId`、`supportsTablet`、`infoPlist`、`plugins[]`、`experiments`、`runtimeVersion`、`updates` | `platforms: ['ios']`；`experiments: { typedRoutes: true, reactCompiler: true }`；`runtimeVersion: { policy: 'fingerprint' }`；OTA `updates.url` + `requestHeaders['expo-channel-name']` |
| `pnpm-workspace.yaml`          | `packages: [apps/*, packages/*]`、`overrides`（顶掉 `@expo/dom-webview`）、`allowBuilds.esbuild`、`nodeLinker: hoisted`、`patchedDependencies`                                                                             | `hoisted` 让 Swift/JS 工具链只解析到一份依赖                                                                                                                                            |
| `tsconfig.json`（根 + mobile） | 根只 `extends expo/tsconfig.base`；mobile 里 `strict: true` + path alias                                                                                                                                                   | `@lody-ios/kit → modules/lody-kit/src` 是"本地模块不以 node_modules 形式存在"的关键（未验证：依赖 Expo CLI 对 tsconfig `paths` 的 Metro 解析，SDK 49+ 默认支持；本机未装依赖没实测）    |
| `metro.config.js`              | `getDefaultConfig(__dirname)`；**只加一行** `config.cacheVersion += ':' + __dirname`                                                                                                                                       | 防多 worktree 共享 Metro/DOM 缓存（Expo DOM transform 会内联绝对路径）                                                                                                                  |
| `index.js`                     | `expo-asset` → `./src/lib/i18n/boot.ts` → `expo-router/entry`                                                                                                                                                              | **i18n 必须在 router 之前**，否则首帧文案/原生 prop 读到默认 locale                                                                                                                     |
| `babel`                        | **仓库里没有 `babel.config.js`**；`babel-preset-expo`/`@babel/core` 只在根 devDependencies                                                                                                                                 | 未验证：SDK 57 由 Metro 提供默认 transform，需要自定义时才补 config                                                                                                                     |
| `plugins/*`                    | `withLocales`（→ xcstrings）、`withPushNotifications`（NSE + App Group + SDK pin）、`withMarkdownView`（SPM）、`withLodyIcons`                                                                                             | 生成的 `ios/` 是**被 gitignore 的产物**，所有改动必须落在 app config / plugin / LodyKit                                                                                                 |

关键脚本（根 `package.json`）：

| 命令                      | 实际执行                                                                                                                                                                                                                              | 作用                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm start` / `pnpm ios` | 转发到 `@lody-ios/mobile`                                                                                                                                                                                                             | `start = expo start --dev-client`；`ios = prebuild && pods && expo run:ios --no-install`                                                          |
| `pnpm prebuild`           | `native:assets && expo prebuild --platform ios --no-install`                                                                                                                                                                          | 先生成原生资源（离屏 HTML、许可证、图标 PNG），再生成 `ios/`                                                                                      |
| `pnpm bundle`             | `native:assets && EXPO_NO_BUNDLE_SPLITTING=1 expo export --platform ios --output-dir .expo/export-check`                                                                                                                              | **不发版**的打包冒烟：能在 CI ubuntu 上验证 bundle 可产出                                                                                         |
| `pnpm check`              | `typecheck && i18n:check && licenses:check && format:check`                                                                                                                                                                           | typecheck = `tsc --noEmit`；i18n:check = `node apps/mobile/scripts/check-locales.mjs`；licenses:check = `node scripts/build-licenses.mjs --check` |
| `pnpm test`               | `node --experimental-strip-types --experimental-test-module-mocks --test apps/mobile/tests/**/*.test.mjs` + `python3 verification/ui/runner_test.py` + `simulator_test.py` + `build_test.py` + `pnpm --filter @expo/dom-webview test` | 纯逻辑单测 + **验收基建自身的单测**（租约、并行编排、构建脚本）                                                                                   |
| `pnpm verify:build`       | `python3 apps/mobile/verification/build.py`                                                                                                                                                                                           | 构建 Debug 模拟器 App；stdout 只有 App 路径，stderr 是进度与日志位置；`--json` 给 app/derivedData/log                                             |
| `pnpm verify:ui`          | `python3 apps/mobile/verification/ui/run.py`                                                                                                                                                                                          | 跑 UI 行为基线（默认全量；`--case` / `--batch` / `--parallel`）                                                                                   |
| `pnpm verify:native`      | `python3 apps/mobile/verification/native.py`                                                                                                                                                                                          | 编译并运行 Swift 行为断言（不依赖云端/凭据）                                                                                                      |
| `pnpm verify:simulator`   | `python3 .../simulator.py --name X -- <cmd>`                                                                                                                                                                                          | 租一台 `Lody X Verify` 模拟器，导出 `LODY_VERIFY_UDID` 给子命令                                                                                   |
| `pnpm verify:clean`       | `python3 .../clean.py`                                                                                                                                                                                                                | 列出（`--apply` 删除）临时目录里被遗忘的 DerivedData / 复制的 checkout                                                                            |

依赖要点（`apps/mobile/package.json`）：`expo ~57.0.20`、`expo-router`、`expo-dev-client`、`expo-updates`、`expo-localization`、`react-native 0.86.3`、`react-native-reanimated 4.5.1`、`react-native-screens`、`react-native-safe-area-context`、`react-native-worklets`、`react 19.2.3`；devDeps 只有 `@react-native/metro-config`、`@types/react`、`typescript ~6.0.3`。**没有**状态库——AGENTS.md:10 明确"add state libraries only when needed"。

---

## 2. 原生模块范式（`modules/lody-kit`）

### 2.1 四件套

```jsonc
// modules/lody-kit/expo-module.config.json
{
  "platforms": ["ios"],
  "ios": { "modules": ["LodyKitModule"], "appDelegateSubscribers": ["PushAppDelegateSubscriber"] },
}
```

```jsonc
// modules/lody-kit/package.json
{ "name": "@lody-ios/kit", "version": "0.1.0", "private": true, "main": "src/index.ts" }
```

```ruby
# modules/lody-kit/ios/LodyKit.podspec
s.platform = :ios, '26.0'; s.swift_version = '6.0'; s.static_framework = true
s.libraries = 'sqlite3'
s.dependency 'ExpoModulesCore'
s.dependency 'OneSignalXCFramework/OneSignal', '5.5.1'
# 关键坑：Expo 预编译模式下 autolinking 不注入 macro 插件，必须手写
macros_plugin = File.join(File.dirname(`node --print "require.resolve('@expo/expo-modules-macros-plugin/package.json')"`.strip), 'apple')
s.pod_target_xcconfig = { 'OTHER_SWIFT_FLAGS' => "$(inherited) -Xfrontend -load-plugin-executable -Xfrontend \"#{macros_plugin}/ExpoModulesMacros-tool#ExpoModulesMacros\"" }
s.spm_dependency 'MarkdownView/MarkdownView'   # 需要 Gemfile 里的 cocoapods-spm
s.source_files = '**/*.{swift,h,m}'
s.resource_bundles = { 'LodyKitShaders' => ['Chat/Shaders/*.metal'] }
```

这是 `EXPO_USE_PRECOMPILED_MODULES` 相关坑的全部代价。从零起步可以不用预编译（Lody 的 release workflow 也显式设 `EXPO_USE_PRECOMPILED_MODULES=0`），把 macro 注入那段删掉。

### 2.2 目录组织 = 一一对应的三层

`src/`（TS facade）与 `ios/`（Swift）**同名功能目录**，功能内按 UI 部件继续对齐：

| TS（`modules/lody-kit/src/`）                                                                                                   | Swift（`modules/lody-kit/ios/`）                                           | 注册名                          |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `runtime/LodyKit.ts`（NativeModule facade）                                                                                     | `LodyKitModule.swift`                                                      | `@ExpoModule("LodyKit")`        |
| `chat/NativeChat.tsx`                                                                                                           | `Chat/LodyChatView.swift`（+ `ChatTranscript.swift` 等）                   | `View(LodyChatView.self)`       |
| `chat/NativeComposer.tsx`                                                                                                       | `Chat/LodyComposerView.swift`、`ChatComposerView.swift`                    | `View(LodyComposerView.self)`   |
| `diff/NativeCodeView.tsx`                                                                                                       | `Diff/LodyCodeView.swift`                                                  | `View(LodyCodeView.self)`       |
| `diff/NativeInlineDiff.tsx`                                                                                                     | `Diff/LodyInlineDiffView.swift`                                            | `View(LodyInlineDiffView.self)` |
| `list/NativeGroupedList.tsx` / `NativePagedList.tsx` / `NativeSidebar.tsx`                                                      | `List/LodyGroupedList.swift` / `LodyPagedList.swift` / `LodySidebar.swift` | `View(...)`                     |
| `chrome/NativeSymbolButton.tsx`、`NativeMenuButton.tsx`、`NativeSearchToolbar.tsx`、`NativeSplit.ts`、`NativeFloatingPanel.tsx` | `Chrome/LodySymbolButton.swift` …                                          | `View(...)`                     |
| `press/NativePressable.tsx`、`NativeGlassSurface.tsx`                                                                           | `Press/LodyPressable.swift`、`LodyGlassSurface.swift`                      | `View(...)`                     |
| `notifications/notifications.ts`                                                                                                | `Notifications/{PushNotifications,PushClickBuffer,LiveActivities}.swift`   | `AsyncFunction` + `Events`      |

### 2.3 Swift 侧的四种出口

`ios/LodyKitModule.swift` 是全部注册的单一入口（~500 行）：

```swift
@ExpoModule("LodyKit")
public final class LodyKitModule: Module, @unchecked Sendable {
  // ① 常量：RN 启动时同步读到，用来做"本次启动是不是离线验收"这类开关
  @JS var runtimeInfo: LodyRuntimeInfo { ... }        // @Record struct，非 JSON 字符串

  // ② 事件：先声明，再 sendEvent
  @Event("onAppActive") var onAppActive: () -> Void

  public func definition() -> ModuleDefinition {
    Events("onDataRuntime", "onPushClick", "onAttachmentUploadProgress")

    // ③ 命令式方法：UIKit 一律显式回主队列
    AsyncFunction("copyText") { (text: String) in ... }.runOnQueue(.main)
    AsyncFunction("readLocalValue") { (key: String) in try self.localStore.read(key) }
      .runOnQueue(LocalStore.queue)                    // 非 UIKit 工作显式指定自己的队列

    OnAppBecomesActive { self.onAppActive() }

    // ④ 原生 View：Prop / Events 全部显式声明
    View(LodyChatView.self) {
      Events("onStop", "onSend", "onTitlePress", ...)
      Prop("entriesJSON") { (view: LodyChatView, value: String) in view.setEntries(value) }
    }
  }
}
```

约定：

- **所有 `AsyncFunction` 都写 `.runOnQueue(...)`**；碰 UIKit 的用 `MainActor.assumeIsolated {}` 包裹（Swift 6 严格并发下的既定写法）。
- **错误用 `throw` / `promise.reject(code, message)`**，不在 Swift 侧吞掉。
- Debug-only 能力用 `#if DEBUG` 包住（`verifyPushSubscription`、`debugLiveActivity`、`--ui-verify` fixture 拦截）。
- 类声明 `Module, @unchecked Sendable`；`didCreate()` / `willDestroy()` 里注册与反注册（`willDestroy` 停 runtime、清 SDK 回调）。
- View 的复杂数据用 **JSON 字符串 prop**（`entriesJSON`、`composerJSON`、`payload`），Swift 侧 `Decodable` 解析（见 `Chat/ChatTranscript.swift`）。原因：跨桥对象形状会随实现漂移，字符串边界让 schema 与解析失败在 Swift 侧显式暴露。只有稳定的小型结构（`LodyRuntimeInfo`）才用 `@Record`。

### 2.4 TS 侧两种封装

命令式（`src/runtime/LodyKit.ts`）：手写 interface + `requireNativeModule`，再包一层命名导出。

```ts
declare class LodyKitNativeModule extends NativeModule<Events> {
  readLocalValue(key: string): Promise<string | null>;
  sendSessionTurn(payload: string): Promise<string>;
  readonly runtimeInfo: RuntimeInfo;
}
export const native = requireNativeModule<LodyKitNativeModule>('LodyKit');
export const readLocalValue = (key: string) => native.readLocalValue(key);
export const addDataRuntimeListener = (l: (e: DataRuntimeEvent) => void) =>
  native.addListener('onDataRuntime', l);
```

View 型（`src/diff/NativeCodeView.tsx`）：类型化 props 只是**类型**，实现是 `requireNativeView`。

```tsx
export const NativeCodeView: ComponentType<NativeCodeViewProps> = requireNativeView(
  'LodyKit',
  'LodyCodeView',
);
```

`src/index.ts` 是唯一出口：业务代码 `import { NativeChat, sendSessionTurn } from '@lody-ios/kit'`，禁止深路径 import（AGENTS.md:31）。

### 2.5 事件订阅 / Watchdog 生命周期约定

- **RN 侧**：`addXxxListener(...)` 返回 subscription，必须在 `useEffect` cleanup 里 `subscription.remove()`。
- **Swift 侧**：`willDestroy()` 停 runtime、清 `onClickAvailable` 之类回调，避免模块销毁后仍向 JS 发事件。
- **Watchdog（`Cloud/RuntimeHealth.swift`）**：不是 JS `setTimeout` 健康检查，而是 Swift 持有状态机——启动/心跳截止、`acknowledged()` 重置、重启预算（防无限重启）、`suspend()/resume()` 保证前台恢复不追讨后台挂起时间。它有一份**纯逻辑的确定性检查**（`modules/lody-kit/verification/watchdog/main.swift`，纯整数时间戳断言 + `print("PASS: ...")`），不需要模拟器与网络：

```swift
var health = RuntimeHealth()
health.started(at: 100)
assert(!health.timedOut(at: 119.9)); assert(health.timedOut(at: 120))
health.acknowledged(at: 120)
assert(!health.allowRestart(at: 160))   // No infinite restart loop.
health.suspend(); assert(!health.timedOut(at: 5000)); health.resume(at: 5000)
assert(health.ready)
print("PASS: startup/heartbeat deadlines, restart budget, foreground grace")
```

Memoh 的宿主侧（Go 后端、SSE 长连接、agent 会话）若要 watchdog，请照这个形状：**状态机在 Swift、策略用纯函数、策略本身被纯逻辑检查覆盖**。

### 2.6 最小"新增一个 Native 模块"步骤

以新增 `MemohCard`（原生卡片 + onPress）和 `memohPing()` 为例：

1. **Swift 视图**：`modules/memoh-kit/ios/Cards/MemohCardView.swift`，`final class MemohCardView: ExpoView`，暴露 `setTitle(_:)` 与 `EventDispatcher` 的 `onPress`。UIKit 更新一律 `@MainActor`。
2. **注册**：在 `ios/MemohKitModule.swift` 的 `definition()` 里加
   ```swift
   AsyncFunction("memohPing") { () -> String in "pong" }.runOnQueue(.main)
   View(MemohCardView.self) {
     Events("onPress")
     Prop("title") { (view: MemohCardView, value: String) in view.setTitle(value) }
   }
   ```
   新模块要改 `expo-module.config.json` 的 `ios.modules` 与 `@ExpoModule("MemohKit")`（必须一致）。
3. **TS wrapper**：`modules/memoh-kit/src/cards/NativeMemohCard.tsx`
   ```tsx
   export const NativeMemohCard: ComponentType<
     ViewProps & {
       title: string;
       onPress?: () => void;
     }
   > = requireNativeView('MemohKit', 'MemohCardView');
   ```
   命令式方法加进 `src/runtime/MemohKit.ts` 的 interface 并导出 `memohPing`。
4. **出口**：`src/index.ts` 加 `export { NativeMemohCard } from './cards/NativeMemohCard';`
5. **路径**：确认 mobile 的 `tsconfig.json` `paths` 指向新模块目录（`@memoh-ios/kit`），业务代码只用这个 alias。
6. **文案**：给用户看的字串进 `locales/{en,zh-Hans}.json`；Swift 要读的用 `native.*` 前缀 key（会被 `withLocales` 投成 `Localizable.xcstrings`），用 Swift 侧 `MemohStrings` 读取。**不要硬编码中文**——`check-locales.mjs` 会扫 `modules/*/ios/**/*.swift` 与 `src/**/*.{ts,tsx}` 的 CJK 并 fail。
7. **验收**：行为断言加进 `modules/memoh-kit/verification/cards/main.swift`，并在 `verification/native.py` 的 `checks` 字典注册；需要 UIKit 布局的进 "simulator" 白名单，纯逻辑的直接 `xcrun swiftc` 跑。
8. **UI 基线**：若它出现在某页面，照 §4 加用例；若是共享控件，必须在**每个宿主**（聊天页 / 新建会话 sheet）各跑一遍。

---

## 3. presentation / 导航 / i18n / 主题

### 3.1 `definePage` / `usePageRuntime` / `present` 契约

动机：RN 里"打开一个能返回结果的页面"和"打开一个稳定 URL 的页面"通常会长出两套机制（Modal 管理器 vs Router）。Lody 的做法是**一个页面定义、两种入口**：

```tsx
// src/screens/EnvironmentScreen.tsx
export const EnvironmentScreen = definePage<EnvironmentParams, RuntimeInfo>({
  id: 'environment',
  title: '运行环境',
  Component: View,
  parseRouteParams: ({ message }) => ({ message: first(message) ?? '直接路由入口' }),
  presentation: { style: 'pageSheet', headerVariant: 'transparent' },
});
```

- `definePage` 返回 `{ Component, id, title, presentation, presentationPath?, Route }`；`Route` 给 `src/app/*.tsx`（`export default EnvironmentScreen.Route`）。
- 结果返回型入口：`const result = await present(EnvironmentScreen, params, options)`；结果只有 `{status:'completed', value}` 与 `{status:'cancelled'}`。
- 页面内部：`const { params, source, finish, cancel, present, push } = usePageRuntime<TParams, TResult>()`，`source` 区分 `'route' | 'presentation'`。
- **参数只在内存**（`presentationStore.ts` 的模块级 `sessions` 数组），URL 里只有 `presentationId`。`present` 失败时 Promise reject 且 session 释放（`tests/presentation/presentation.test.mjs` 覆盖）。
- **原生手势关闭 / 返回 / 路由卸载都要 settle**：`PresentedPage.tsx` 里 `navigation.addListener('beforeRemove', () => cancelPresentation(id))` + cleanup 再调一次（幂等）。所以"下滑关闭"、"返回键"、"调用方先 finish 再卸载"三条路径结果一致。
- `presentationStore` 支持 `options.host`：让原生宿主（iPad 面板）在**不经过 Router modal**的情况下渲染同一页面——"同一页面两种宿主"的扩展点。
- **不要再造第二个 React Modal 管理器**（AGENTS.md:27）。

样式映射在 `PresentedPage.tsx` 的 `nativePresentationStyle` / `nativeAnimation`：`push→card`、`formSheet→formSheet`（+detents+grabber）、`fullScreen→fullScreenModal`、`overFullScreen→transparentModal`、`pageSheet→pageSheet`。`SheetStack.tsx` 负责 sheet 内部的**多级 stack**（sheet 里再 `present` 一层，返回留在上一层），并暴露 `SheetHeaderContext` / `SheetSearchContext` 让子页面把原生导航栏按钮与 search bar 交回宿主。

### 3.2 路由与分层规则

```
src/app/           路由与导航布局（Stack / NativeTabs / presented/[presentationId]）
src/screens/       只有 *Screen；页面用 definePage 定义（debug/ 例外，放 preview/fixtures）
src/features/      领域逻辑；**不得 import screens**
src/models/        数据形状
src/cloud/         云协议（auth/catalog/github/send/kv），与 UI、原生代码分离
src/hooks/screens/ 把 feature 接到导航（present/路由）
src/lib/           presentation / i18n / theme（与业务无关的基础设施）
src/ui/            共享 RN 组件
```

反例防线：**"打开一个会话"不走组件回调链，而走 mailbox**（`src/features/sessions/sessionNav.ts`：`requestOpenSession(session)` → `subscribeSessionNav(handler)`，带 `AbortController` 与串行 flush）。这样 `features` 不需要引用 `screens`，Tab 层的 bind hook（`useBindSessionNav`）负责消费，导航需求可被单测（`tests/sessions/session-nav.test.mjs`）。

导航栈形状（`src/app/_layout.tsx`）：Native Stack，`headerTransparent: true`、`headerBackButtonDisplayMode: 'minimal'`、`headerShadowVisible: false`、`scrollEdgeEffects: softScrollEdgeEffects`（iOS 26 软滚动边缘）；主页路径（项目→会话→消息）用 `style: 'push'`，瞬时流程/结果返回用 sheet。

### 3.3 i18n：单层 catalog → xcstrings 投影

- 真源：`apps/mobile/locales/{en,zh-Hans}.json`，**扁平单层 key**（`native.chat.composer.fastOn`、`diff.reason.notChanged`…），复数用 `key.one` / `key.other` 成对。
- RN 侧 `src/lib/i18n/index.ts`：直接 `import en from '../../../locales/en.json' with { type: 'json' }`，`t(key, vars)` / `tp(key, count, vars)`；`TranslationKey = keyof typeof zhHans` 让 key 打错在编译期就死。`boot.ts` 用 `expo-localization` 读系统语言并 `setLocale`，由 `index.js` 在 router 之前执行。
- Swift 侧**读同一份数据**：`withLocales.js` 在 prebuild 的 `withDangerousMod('ios')` 里把 `native.*` 前缀的 key 写成 `Localizable.xcstrings`，复数转成 Foundation 的 `variations.plural`，`{count}` 替换为 `%lld`；并把 `INFO_KEYS`（`ios.info.bundleDisplayName` → `CFBundleDisplayName`、`ios.info.photoLibraryUsage` → `NSPhotoLibraryUsageDescription`）写成 `InfoPlist.xcstrings`。第二个 mod（`withXcodeProject`）把两个资源加进 target，并**显式把 file type 设成 `text.json.xcstrings`**——否则 Xcode 只是拷贝而不编译 catalog（插件注释里写明的坑）。
- `LodyStrings.swift` 用 `Bundle.main.localizedString(forKey:value:table:)` 取值，自己做**单遍** `{name}` 替换（"a substituted value is never rescanned for placeholders"）；纯逻辑检查 `modules/lody-kit/verification/strings/main.swift` 覆盖：重复占位符、缺失变量保留原文、替换值不再扫描、复数与数字格式化。
- 校验：`scripts/check-locales.mjs`（`pnpm i18n:check`）三件事——键集对齐、占位符集合对齐、**扫描 `modules/*/ios/**/*.swift`、`live-activity/**/*.swift`、`src/**/*.{ts,tsx}`（排除 `debug`）里的 CJK 字符**。断言侧 `verification/ui/catalog.py` 读同一个 json，用例断言的是"当前语言的生产文案"，不是硬编码句子。

### 3.4 主题与语义色

- `src/lib/theme/tokens.ts`：纯常量（`accent`、`systemBackground`、`softDarkBackground #111113`、`separator`、`danger`、字号/行高 `type`、间距 `space`、`FONT_SCALE_MIN/MAX`）。
- `src/lib/theme/palette.ts`：`usePalette()` 组合 `useColorScheme()` + `PlatformColor('label'/'secondaryLabel'/'systemOrange'/'systemRed'/…)`，产出角色色（`ColorRole`）；暗色"柔和"模式用 `softDarkBackground` 覆盖 `background/reading`。Expo Router 的导航主题（`navigationThemes`）也在这里。
- `src/lib/theme/appearance.tsx`：`darkBackground: 'soft' | 'black'` 用户偏好，**初值来自原生**（`initialDarkBackground`，Swift 读 `UserDefaults`），写入也走原生（`saveDarkBackground`）。
- 硬规则（AGENTS.md:19）：**不用绿色强调色/绿色底**；原生内容用 UIKit 语义色、操作用 system blue、背景用系统中性色；保持自动暗色与对比度适配；至少 44pt 触控目标与 VoiceOver label；不专门为超大字体重排布局（MVP 用默认字号）。

---

## 4. 验收基建（最重要的一节）

三层，越往上越贵、越接近"用户看得见的行为"：

| 层            | 命令                 | 跑在哪                                          | 断什么                                               |
| ------------- | -------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| ① 逻辑单测    | `pnpm test`          | 本机 / CI ubuntu                                | 纯函数、协议、presentation session、**验收基建自身** |
| ② 原生行为    | `pnpm verify:native` | macOS + 模拟器（`simctl spawn`）或直接 `swiftc` | 生产 Swift 类型的行为（不含 UI 像素）                |
| ③ UI 行为基线 | `pnpm verify:ui`     | macOS + 租约模拟器 + 自有 Metro                 | 真实 App 可访问性树上的用户可见断言 + 截图 + 录屏    |

### 4.1 模拟器租约（`verification/simulator.py`）

核心：**别自己 `simctl create`**，统一从 `Lody * Verify` 池里租。

```python
DEVICE_TYPES = {'iphone': '...iPhone-17-Pro', 'ipad': '...iPad-Air-11-inch-M2'}
RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
MANAGED_NAME = re.compile(r'^Lody .+ Verify$')
# 锁目录：~/Library/Caches/app.innei.lody/verify-simulators
```

`SimulatorPool.lease(verify_name)` 语义（照抄即可）：

1. 先拿 `.pool.lock`（`flock` 排他）串行化"选择设备"。
2. 只考虑 `isAvailable` + deviceType 匹配 + 名字匹配 `Lody * Verify` 的设备——**个人设备、别的项目、旧 runtime 永不入选**。
3. 候选按 `state != 'Shutdown'` 排序；已被别人锁住（`<udid>.lock` 非阻塞 `flock` 失败）的跳过；无空闲则 `simctl create 'Lody <name> Verify' <deviceType> <runtime>`。
4. 拿到后 `shutdown → rename 成当前验收名 → boot → bootstatus -b`（300s 超时），把 `LODY_VERIFY_UDID` 传给子进程。
5. `finally` 里 `shutdown`，**不 erase**（保留复用），删除 `.managed` 标记；清理失败时若业务本身也失败就只打日志，否则抛出。
6. 中断遗留的 booted 设备：标记不存在视为可回收；无标记的 booted 设备视为被占用。

`--udid` 可旁路租约（CI 用），代价是**调用方自己承担全生命周期**。

推荐用法：

```sh
pnpm verify:simulator --name 'File Preview' -- zsh -euc '
  pnpm verify:native
  pnpm verify:ui --app "$(pnpm --silent verify:build)" \
    --case file-preview --output .artifacts/file-preview
'
```

### 4.2 构建（`verification/build.py`）+ 清理（`verification/clean.py`）

- 固定 workspace + scheme，`-sdk iphonesimulator`。
- destination：有租约就 `id=$LODY_VERIFY_UDID`（单架构更快），否则 `generic/platform=iOS Simulator`。
- **共享一份 DerivedData**（Xcode 自己维护的 `DerivedData/<App>-*`），故用 `flock(.artifacts/verify-build.lock)` 串行化并发构建；禁止给每任务传 `-derivedDataPath`，也禁止把 checkout 复制到临时目录——`clean.py` 就是回收这两类废弃物的（识别 `Build/Products`、`ModuleCache.noindex`+`SDKStatCaches.noindex`、名字以 `lody-`/`expo-` 开头且含 `apps/mobile` 的目录）。
- 产物路径不是猜的：跑 `xcodebuild -showBuildSettings -json` 取 `TARGET_BUILD_DIR`/`FULL_PRODUCT_NAME`；stdout 只输出 App 路径（方便 `$(pnpm --silent verify:build)`），进度与日志路径走 stderr，完整日志落 `.artifacts/ui-build/build.log`。
- 构建前自动跑 `pnpm native:assets`（`--skip-assets` 可跳）。

### 4.3 runner（`ui/run.py` + `orchestrator.py` + `driver.py` + `catalog.py`）

**用例注册表**（全是 Python 常量，改这里就是加用例）：

```python
BATCHES = {'pages': [...16...], 'send': [...20...], 'chat': [...13...]}
PAD_CASES = ['ipad','ipad-chrome','native-shell','native-collection']  # 需显式 --case 才租 iPad
HOME_CASES = {'home','licenses','navigation','mentions-production','project-history-entry','ipad','ipad-chrome'}
PREVIEW = {'send': 'send-preview', 'composer': 'composer-preview', ...}   # case → Debug 页入口行的 AXUniqueId
READY   = {'send': 'send-status', 'composer': 'create-session-input', ...} # case → 场景就绪的 AXUniqueId
```

**每个 case 的执行流程**（`run.py` 主循环，逐条对应）：

1. `simctl spawn <udid> defaults write` 关自动键盘最小化、把键盘固定成 `en_US@sw=QWERTY`；编译并运行 `software-keyboard.m`（host-only CoreSimulator helper）**断开硬件键盘**，保证测的是软键盘几何。
2. `simctl install` → `simctl ui content_size large`。
3. 对 `['light','dark']` 两遍；每遍内先 `HOME_CASES` 再其他。
4. 起录屏 `xcrun simctl io <udid> recordVideo --codec=hevc <out>/run.mp4`，**等 stderr 出现 `Recording started` 才继续**（20s 超时）。
5. 启动 App：`simctl launch app.innei.lody --ui-verify [--ui-verify-home] [--ui-verify-mentions] [--ui-verify-scroll] [--ui-verify-throw] --initialUrl http://127.0.0.1:<port>?disableOnboarding=1 -expo.devlauncher... -AppleLanguages (<lang>) -AppleLocale ... -AppleKeyboards ...`。同一 `launch_mode` 下**不重启进程**，而用 CDP 调 `globalThis.__lodyUiVerifyReset()` 回 Debug 根（记录 `appLifecycle: 'return-to-root'` 并**断言 PID 未变**；变了即失败）。
6. 等 `ui-verify-ready`（180s）。非 HOME case 先在 Debug 列表里**向上滑最多 8 次**找到 `PREVIEW[case]` 那一行再 tap（原生 UICollectionView 的屏外行不在可访问性树里）。
7. `ui.capture('before')` → 跑 `verification/ui/<case>.py`（或 `modules/lody-kit/verification/chat/<case>.py`），stdout/stderr 写 `check.log`，超时按 case 分级（180/300/480s）。case 脚本 argv 是 `(udid, output)`，语言与 Metro 端口经 `LODY_UI_LANGUAGE` / `LODY_UI_METRO_PORT` 传入。
8. `ui.capture('after')` → `status: 'passed'`。异常路径：抓 `failure` 截图、`simctl spawn log show --last 5m --predicate 'process == "Lody"'` 写 `native.log`、探活 Metro 写 `metro-failure.json`，并**显式重置 `launch_mode`**（失败可能留下系统弹窗）。
9. `finally`：SIGINT 停录屏、等 15s 再 kill；**录屏缺失或 0 字节 → 该 case 判失败**（`'Required video was not captured'`）。结果**增量**写 `results.json` 并逐行 print JSON。
10. 收尾：`if not results or any(r['status'] != 'passed') → exit 1`。

**driver（`driver.py`）**：只有 `axe` 子进程封装 + 四个原语——`wait(predicate)`、`element(identifier)`、`capture(name)`（同时写 `<name>.json` 可访问性树 + `<name>.png`），以及两个"真实输入"路径：`type_into`（中文 App Language 会拉起拼音 IME，必须切英文键盘重敲并断言 `AXValue` 已提交）、`paste_file`/`paste_video`（编译 `*-pasteboard.swift`、`simctl spawn` 起剪贴板 provider、长按弹系统编辑菜单、按 label 找 Paste 点掉，再断言附件 chip 的 label 出现）。`state()` 在 install+launch 后允许 6 次重试（模拟器可能短暂拒绝 `describe-ui`）。

**catalog（`catalog.py`）**：断言用的生产文案 + UIKit 系统控件文案表（`Clear text`/`Close`/`Cancel`/`Paste`/`Next keyboard`…按语言分表）。用例写 `catalog.text('native.chat.attachment.preview', name=...)`，因此**断言同时证明了"当前跑的是哪个语言"**。

**Metro 编排（`orchestrator.py`）**：

- `managed_metro()`：先 `socket.create_connection` 探端口，**被占用就报错退出**（绝不挂到别人的 server/bundle）；用 `pnpm --filter @lody-ios/mobile exec expo start --dev-client --host lan --port N` 起独立进程组；环境注入 `EXPO_PUBLIC_UI_VERIFY=1`、`CI=1`、`EXPO_NO_DOTENV=1`、`REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1`、`NODE_OPTIONS --require metro-diagnostics.cjs`；等 `/status` 返回 `packager-status:running`（90s）→ 请求 manifest 并把 `launchAsset` 完整读一遍（**预热 bundle**）。
- `diagnose_metro()`：只探 `/status` + HEAD/GET `/?disableOnboarding=1`，记录状态码、字节数、耗时；注释明确**不记录 header、manifest、包体与环境变量**。
- `run_batches()`：先全部 `Popen`（各自进程组 + `worker.log`）再轮询；**一个 batch 失败不取消兄弟**；最后合并 `results.json` 与 `batches.json`。
- `--parallel`：父进程持有一个 Metro，三个 batch worker 各自租一台 iPhone，`--shared-metro` 让 worker 不自己起 server；`--parallel` 与 `--udid` 互斥。

**产物**（`.artifacts/ui/…`；`--output` 目录里若有上次的 `results.json`/`batches.json`/`environment.json`/`metro.log` 会先整目录删除，**重跑复用同一路径**，只有 A/B 对比才换路径）：
`environment.json`（node/xcode/axe 版本、batch、cases、metroPort、udid、app、language、baseCommit、worktreeDirty）、`metro.log`、`metro-startup.json`、`results.json`、`batches.json`、每 case 每外观的 `before/after/failure.{png,json}`、`run.mp4`、`check.log`、失败时的 `native.log` / `metro-failure.json`。

### 4.4 "不依赖登录与云端"是怎么做到的

三条独立闸门，缺一不可：

1. **bundle 级**：Metro 以 `EXPO_PUBLIC_UI_VERIFY=1` 起（CI 里也给 build job 设了同名 env），`__DEV__ && process.env.EXPO_PUBLIC_UI_VERIFY === '1'` 在任何**生产**构建里都取不到。
2. **JS 级**：`src/screens/debug/uiVerify.ts` 导出 `uiVerify`。`src/app/index.tsx`：`if (uiVerify && !homeVerify) Entry = DebugRedirect`（直接进 Debug 列表）；`AuthProvider` 在 `uiVerify` 下**在 Keychain/SQLite 读取之前就短路**，不恢复账号；`PushCoordinator`、community notice 同样短路。
3. **launch argument 级**：`--ui-verify` 才允许 Debug 里的 fixture 拦截（`LodyKitModule` 里大量 `#if DEBUG if ProcessInfo...contains("--ui-verify") { promise.resolve(fixture) }`）；`--ui-verify-home` 让 `RootLayout` 用 `HomePreviewProviders`（内存 Auth/Catalog Provider + 假工作区/项目/会话）替掉真实 Provider；`--ui-verify-scroll`/`--ui-verify-throw`/`--ui-verify-mentions` 分别打开几何采样、抛物线采样、@ 引用 fixture。`runtimeInfo.uiVerifyHome` 由 Swift 读 `ProcessInfo.arguments` 得出——**JS 无法伪造，Release 也编不进去**。

准则（AGENTS.md:49）：Debug 场景必须**用生产组件 + `present` 契约**，只在**归属边界**注入确定性数据/服务结果；**不要把生产页面复制成一个假 UI**（复制品一旦和生产漂移，验收就成了自欺）。`HOME_CASES` 就是这条准则的产物：真实 `InboxScreen`、真实 Settings sheet，只是 Provider 换成内存实现。

### 4.5 截图 vs 录屏的分工（README 明写的边界）

- **截图**（`capture()` = 可访问性树 json + png）：**视觉状态**——配色、明暗、布局、控件是否出现。
- **录屏**（`run.mp4`，hevc）：**时间行为**——键盘、滚动、手势、转场、动画。
- 明确写了：**没有 pixel-diff 门禁**，"screenshots are evidence, not automatic proof of typography or animation quality"；基线变更需人工 review，绝不自动批准失败对比。
- 性能类 case（`chat-performance` / `chat-stream-performance` / `smooth-scroll` / `send*` 抛掷）额外产出 raw JSON 采样（`loading.json`、`performance-summary.json`、`run-1..3.json`、`throw-summary.json`、`stream-summary.json`），断言的是**结构性质**（完整数据、双向滚动、>70000pt 行程、回调间隔 < 50ms、位置不连续 < 1.5pt、最终底部对齐），**不设任意 FPS 阈值**。
- 取证边界写得很硬：Simulator Debug 的数字是回归基线，不能声称真机 Release 性能、触感或云端持久化；探针只在 Debug 编译、视图离窗即停；视频不得上采样后当作额外证据。

### 4.6 失败判定规则（清单）

1. case 脚本非零退出 / 抛异常 / 超时（180/300/480s 分级）。
2. 就绪元素（`READY[case]` / `ui-verify-ready`）在 180s 内未出现。
3. 录屏没起来（`Recording started` 20s 内未出现），或 `run.mp4` 缺失/0 字节。
4. `return-to-root` 时 **PID 变了**（进程被意外重启）。
5. 产物缺 `before/after` 证据（用例自己 `capture` 的命名缺失即在脚本内断言失败）。
6. 约定性失败示例：`fast.py` 的 "Fast state did not return from RN"、44pt 触控目标断言、`appearance.py` 的选中态互斥；抛掷采样里"回调间隔 > 50ms / 位移不连续 > 1.5pt / 飞行段倒退 / 静止内帧"。
7. 整体：`results.json` 任一 case 非 `passed` → `exit 1`。
8. 验收 round 导出器（`acceptance-round.py`）额外规则：claim 的 case 没结果、或声明的证据类型缺失 → **拒绝写 round**；round 不可变（修复要导新 round），普通回归 run 永不被 ingest。

### 4.7 在 CI 里怎么跑

`build` job 产出 `lody-simulator-<sha>.tar.gz`（`tar` 保符号链接与可执行位），三个 `ui` matrix job 下载同一个 tar，各自 `simctl create 'Lody Offline UI'` 一台一次性模拟器并用 `--udid` 跑一个 batch，`if: always()` 上传证据、`if: always()` 删模拟器。**本地用租约池、CI 用一次性自建自删**是这套设计刻意的分工。

### 4.8 要把这套搬到 Memoh，最小文件集

```text
apps/mobile/verification/
├── simulator.py        # 租约（改 MANAGED_NAME 前缀、DEVICE_TYPES、RUNTIME、锁目录）
├── build.py            # 构建（改 WORKSPACE/SCHEME/日志路径）
├── clean.py            # 临时垃圾回收（改 PROJECT_PREFIXES）
├── native.py           # Swift 行为检查（改 checks 字典与 kit 路径）
├── simulator_test.py / build_test.py   # 基建自身的单测（强烈建议保留）
└── ui/
    ├── README.md       # 用例清单 + 规则（新项目的"验收宪法"）
    ├── run.py          # BATCHES/PAD_CASES/HOME_CASES/PREVIEW/READY + 主循环
    ├── orchestrator.py # 独有 Metro + 并行编排
    ├── driver.py       # AXe 原语 + 粘贴/输入
    ├── catalog.py      # 断言用生产文案
    ├── inspector.py    # 只对目标设备的 app 发 CDP（按 deviceName+appId 匹配）
    ├── software-keyboard.m / *-pasteboard.swift   # host helper
    ├── acceptance-round.py                        # 可选：需求对齐 round 导出
    └── <case>.py
```

**必须全局替换的硬编码**（漏一个就静默跑错设备/错误 app）：`Lody * Verify`（simulator.py）、`app.innei.lody`（run.py 与 inspector.py）、`Lody.xcworkspace` / `SCHEME='Lody'`（build.py）、`app.innei.lody/verify-simulators`（锁目录）、`lody-`/`expo-`（clean.py 前缀）、`@lody-ios/mobile`（Metro 启动命令）、`iPhone-17-Pro` / `iPad-Air-11-inch-M2` / `iOS-26-5`、`--ui-verify*` 参数名（run.py 与 Swift 侧必须一致）、`catalog` 的语言表。

---

## 5. CI / 发布

三个 workflow，职责互不重叠。

### 5.1 `verify.yml`（PR + push main + dispatch，`concurrency: verify-<ref>` 可取消）

| job      | runner                                              | 上限        | 干什么                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks` | ubuntu                                              | 20 min      | `pnpm install --frozen-lockfile` → `pnpm check` → `pnpm test` → `pnpm bundle`                                                                                                                                                                                                     |
| `native` | macos-26, Xcode 26.5                                | 20 min      | `simctl create 'Lody Offline UI'`（一次性）+ boot → `pnpm verify:native --udid`，`always()` 删设备                                                                                                                                                                                |
| `build`  | macos-26, Xcode 26.5, env `EXPO_PUBLIC_UI_VERIFY=1` | 45 min      | ruby/bundler 缓存 → `pnpm prebuild` + `bundle exec pod install` → `APP=$(pnpm --silent verify:build --derived-data "$RUNNER_TEMP/lody-build")` → `tar` → 上传 `lody-simulator-<sha>`（保权限/符号链接，retention 3 天）与 `.artifacts/ui-build` 日志（14 天）                     |
| `ui` ×3  | macos-26                                            | 60 min each | `needs: build`、`strategy.fail-fast: false`、matrix `[pages, send, chat]` → 安装**固定版本并校验 sha256 的 AXe 1.8.0** → 下载同一个 App tar → 自建模拟器 → `pnpm verify:ui --udid "$UI_UDID" --app ... --batch <m>` → `always()` 上传 `.artifacts/ui`（14 天）→ `always()` 删设备 |

要点：**缓存**是 pnpm 官方 action 默认缓存 + ruby `bundler-cache`；**并行**是"构建一次、三个 UI batch 并行消费同一产物"，而不是每 batch 各建一次；batch 间 `fail-fast: false` 保证一个红不影响另两个出证据。README 还提示：要把 Checks / Native behavior / Build iOS Simulator / 三个 UI check 都配成 branch rules 的 required checks，否则它们只是"绿了个寂寞"。

### 5.2 `ship.yml`（push main / 手工 dispatch，`concurrency: ship` **cancel-in-progress: true**）

三 job：`decide` → `ota` | `testflight` (+ `notify`)。

- `decide`（ubuntu）：算 `npx fingerprint fingerprint:generate --platform ios` 的 hash → 从 Actions artifacts 读最近未过期的 `ios-fingerprint`（baseline）→ 路由规则：**push 到 main 一律 TestFlight**；手工 dispatch 且 fingerprint == baseline → **OTA**；fingerprint 变了（或没有 baseline）→ TestFlight。
- `ota`（ubuntu，30 min）：`npx --yes easc@latest update --channel production --non-interactive`，环境带 `OTA_SERVER`/`OTA_API_KEY`（secrets）、`EXPO_UPDATES_FINGERPRINT_OVERRIDE=<hash>`、`EASC_SOURCE_COMMIT`。
- `testflight`：`uses: ./.github/workflows/release.yml`，把 `runtime_fingerprint` 传进去做**交叉校验**。

这套"fingerprint 决定路线"是 OTA 安全性的关键：`runtimeVersion: { policy: 'fingerprint' }` 让任何原生改动（podspec / ios 文件 / app config / 原生资源）都改变 runtime，OTA 只会发给 runtime 完全匹配的已装版本；`release.yml` 存档后还会验证 archive 的 runtime 与 fingerprint 一致，不一致直接失败。

### 5.3 `release.yml`（TestFlight，`workflow_call` + dispatch，`concurrency: testflight` 不取消）

顺序（每步都有显式校验，**没有"希望它是对的"**）：

1. checkout → 记录短 sha → 装 Xcode latest-stable / pnpm / node 22 / `asc` 4.11.0。
2. `pnpm install --frozen-lockfile` → `pnpm native:assets` → 算 fingerprint（上游传了期望值就比对）→ 写 `EXPO_UPDATES_FINGERPRINT_OVERRIDE`。
3. 把 `ASC_API_KEY_P8` 写到 `$RUNNER_TEMP/AuthKey_<id>.p8`（0600）。
4. `npx expo config --json` 取 marketing version（正则校验三段式）→ `asc builds next-build-number` 取 build number（**让 App Store Connect 决定，不自增本地计数器**）→ 写进 `GITHUB_ENV` 与 outputs。
5. `npx expo prebuild --platform ios --non-interactive --no-install` → `PlistBuddy` 把 `CFBundleVersion` 改成 BUILD_NUMBER 并**读回校验**。
6. `bundle install` + `pod install`（brew ruby 前缀）→ `.github/scripts/verify-ios-build-mode.sh`：**拒绝"Expo 模块预编译但 RN 从源码编译"的混合模式**（构建诡异失败的高频来源）。
7. 签名：临时 keychain → 导入 `IOS_DIST_CERT_P12`（base64）+ 密码 → `security set-key-partition-list` → 断言存在 `Apple Distribution:` 身份并读 serial。
8. Provisioning：用 `expo/config-plugins` 的 `getPbxproj` 扫 **Release** 配置里所有 `PRODUCT_BUNDLE_IDENTIFIER`（含 `.notification-service` / `.live-activity` 后缀），交给 `.github/scripts/install-app-store-profiles.sh`；然后把每个 id 的 Release 配置改成手动签名（`CODE_SIGN_STYLE=Manual`、`CODE_SIGN_IDENTITY="Apple Distribution"`、`DEVELOPMENT_TEAM`、`PROVISIONING_PROFILE_SPECIFIER`），最后用 jq 规则文件（`.github/scripts/verify-signing-settings.jq`）验证 `-showBuildSettings` 真的生效。
9. `xcodebuild archive`（覆盖 `DEVELOPMENT_TEAM` / `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION`）→ `xcbeautify` 输出。
10. 校验 archive：bundle id、build number、marketing version，以及 **`EXUpdatesRuntimeVersion` 与 fingerprint 一致**（从 `EXUpdates.bundle/fingerprint` 读，或直接用 plist 里的固定值）。
11. `-exportArchive`（`method: app-store-connect`、manual signing、`manageAppVersionAndBuildNumber: False`）→ 校验 IPA：解包 + `.github/scripts/verify-apple-bundle-linkage.sh`（检查 embedded framework 链接问题）。
12. `asc builds upload --wait` → 可选加入 `vars.TESTFLIGHT_GROUP` → 把 fingerprint 写成 artifact `ios-fingerprint`（**这就是下一次 ship 的 baseline**，retention 90 天）。
13. `always()` 清理：删 keychain、p12、p8、mobileprovision（含 Xcode 的 Provisioning Profiles 目录）。
14. `notify`：`needs: submit, if: always()`，`TELEGRAM_BOT_TOKEN` 存在才发，`continue-on-error: true`。

**密钥注入方式**：全部 GitHub **secrets**（`ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_API_KEY_P8`、`IOS_DIST_CERT_P12`、`IOS_DIST_CERT_PASSWORD`、`OTA_SERVER`、`OTA_API_KEY`、`TELEGRAM_BOT_TOKEN`）+ 少量 **vars**（`TESTFLIGHT_GROUP`）；只在需要的 step 用 `env:` 注入，p8/p12 只以临时文件存在并立即删除；app 本身不含任何 REST API key / APNs 私钥（`PUSH_NOTIFICATIONS.md` 明说）。唯一"编译期常量"是 OneSignal App ID（`LODY_ONESIGNAL_APP_ID` 可覆盖，空值禁用）。**仓库里没有 `.env`。**

---

## 6. `AGENTS.md` 约束提炼（逐条 + 它防住的坑）

`AGENTS.md`（`CLAUDE.md` 是软链）是这套范式最值钱的文件。

| #   | 规则（原文要点）                                                                                                                                                                                                                                                                                                                                                                                                                               | 防住什么坑                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | iOS-only；**不加 Android 实现、fallback stub 或 Android 构建脚本**                                                                                                                                                                                                                                                                                                                                                                             | 半吊子的 `Platform.OS` 分支会腐蚀每个原生模块的接口设计；一旦允许 stub，接口会退化成"两边都能编"的最小公倍数                    |
| 2   | **所有一方原生能力与原生 UI 只放 `modules/lody-kit`**，统一从 `LodyKitModule` 注册，不建独立 bridge 包；**RN 达不到的 UI 要求就用 Swift/UIKit 或 SwiftUI**                                                                                                                                                                                                                                                                                     | 多 bridge 包 → 多个 autolink 边界、多套并发约定；用 RN overlay 模拟系统效果 → 永远达不到 HIG 手感却看起来"差不多"，事后无人敢删 |
| 3   | `apps/mobile/ios` 是 prebuild 产物；**改动必须落在 app config / 本地 config plugin / LodyKit，绝不能只改生成文件**                                                                                                                                                                                                                                                                                                                             | 手改生成物的下场是下次 `expo prebuild` 静默回滚，且表现为"本地好的、CI 坏"——最难查的一类回归                                    |
| 4   | **保持正常 Xcode 签名（含 simulator 校验），不许 `CODE_SIGNING_ALLOWED=NO`**                                                                                                                                                                                                                                                                                                                                                                   | 关签名能把"编不过"变成"编过"，从而丢失签名/entitlement 的真实错误；验收 App 与发布 App 的差异被掩盖                             |
| 5   | 云集成只对官方后端；**不要 import 会让 Metro 打不进的包**（Node/CRDT/Zstd 根入口）；用已验证的 RN-safe 子路径；不要跨 checkout 绝对 import 或私有后端包                                                                                                                                                                                                                                                                                        | Metro 不是 Node：引入 Node 内置依赖的症状要到打包期或运行期才炸；跨 checkout 引用让 build 不可复现                              |
| 6   | **凭据只经 LodyKit 进 Keychain**；绝不把桌面凭据/token/transcript/私有服务配置拷进仓库                                                                                                                                                                                                                                                                                                                                                         | 移动端最常见的泄漏路径就是"从桌面临时拷一份方便调试"                                                                            |
| 7   | 分层：routes/screens/features/models/cloud/ui + lib 基础设施；**features 不得 import screens**；打开会话走 `sessionNav` mailbox；`src/screens/` 只放 `*Screen`                                                                                                                                                                                                                                                                                 | 循环依赖与"UI 逻辑长在 feature 里"；mailbox 让导航需求可被单测                                                                  |
| 8   | 原生导航栏统一透明 + 软滚动边缘；滚动页用 `ScrollViewMarker` + `softScrollEdgeEffects` + 自动 insets                                                                                                                                                                                                                                                                                                                                           | 逐页手调 inset 必然漂移；iOS 26 滚动边缘是系统能力，别自己画                                                                    |
| 9   | 改动前保留用户编辑；**破坏性 revert/restore/rollback 前必须看工作树并取得明确确认**                                                                                                                                                                                                                                                                                                                                                            | 防 agent 顺手"清理"用户未提交的工作                                                                                             |
| 10  | 改原生代码要用 `pnpm check`、`pnpm bundle` 和一次模拟器构建来验收；**优先行为检查而不是实现快照**                                                                                                                                                                                                                                                                                                                                              | 实现快照（常量表、内部字段）会随重构频繁变红，且红的时候不说明用户可见行为坏了；行为检查才拦得住真回归                          |
| 11  | **不许嵌套三元**；闭集用字典映射，有序/重叠条件用 `if`/`switch`；`?.` 与 `??` 不算三元                                                                                                                                                                                                                                                                                                                                                         | 嵌套三元的可读性灾难（有 `.cursor/rules/no-nested-ternary.mdc`）                                                                |
| 12  | UI 基线：**Apple HIG 是首要要求**；不用绿色强调色/绿色底；用 UIKit 语义色 + system blue + 中性系统背景；保持自动暗色与对比度；保留原生导航/安全区/VoiceOver label/≥44pt；MVP 用默认字号，不为超大字号加特殊布局或 remount 逻辑                                                                                                                                                                                                                 | 避免"品牌色盖系统语义色"导致暗色/对比度不可访问；避免为 AX 字号写第二套布局而无人维护                                           |
| 13  | **不要用装饰性 RN overlay 模拟不可用的原生效果**；原生 UICollectionView 必须直接向 UIKit 注册；`ScrollViewMarker` 只接受 RN ScrollView                                                                                                                                                                                                                                                                                                         | 和 #2 呼应的第二道防线：RN 的假玻璃/假 header 是长期维护债                                                                      |
| 14  | 原生列表行选中态：跟随导航转场取消选中、交互式返回被取消时恢复；**不要在 diffable snapshot completion 里重新选中**（可能晚于返回时的取消）                                                                                                                                                                                                                                                                                                     | UIKit 列表最经典的"幽灵选中"竞态                                                                                                |
| 15  | 页面：复用 `definePage`/`usePageRuntime`/`present`；路由文件只导出 `page.Route`；**不要再实现第二套 Modal 管理器**；`present` 参数只在内存、URL 只含 presentationId、原生返回/手势/卸载必须 settle                                                                                                                                                                                                                                             | 两套模态机制 = 打开顺序/生命周期互相打架                                                                                        |
| 16  | 主页路径用 `style: 'push'` + 系统返回与交互式 pop；sheet 只给瞬时流程与 Debug 演示；Tab 用 NativeTabs 且每 tab 自带原生 Stack                                                                                                                                                                                                                                                                                                                  | 用 sheet 承载主路径会丢掉 iOS 的返回手势预期                                                                                    |
| 17  | **原生 API 只能从 `@lody-ios/kit` import**；TS facade / View wrapper / Swift 实现放在匹配的功能目录；**模块事件订阅必须在 unmount 时移除；UIKit 工作跑主队列**                                                                                                                                                                                                                                                                                 | 事件订阅泄漏 + 非主线程 UIKit 崩溃（两个都上线后才发现的）                                                                      |
| 18  | 故障注入、runtime 内部状态、Router/原生 demo 全部留在 dev-only `/debug`（从 Settings 进入）；**产品页面只暴露可行动的连接状态**                                                                                                                                                                                                                                                                                                                | 防止调试后门进入产品 UI                                                                                                         |
| 19  | Swift 持有离屏 WebView 与 watchdog；**启动/心跳截止不能放 JS**；忽略被替换视图的回调；限制自动重启次数；**后台挂起不算 watchdog 失败**（保留 WebView、重置心跳、回前台恢复；只在缺失/失败时重建）；用户发起的发送只用短时 `UIApplication` 后台额度，**绝不请求会弹系统 Live Activity 的 `BGContinuedProcessingTask`**，不用 idle keepalive                                                                                                     | 把健康判定放进会被挂起的 JS → 后台误判重启风暴；滥用后台任务 → 被系统杀 + 用户看到莫名灵动岛                                    |
| 20  | 只有短时 Streams grant 进 bundled WebView，长期凭据留 Keychain；不加载远程脚本、不在诊断里暴露 token；登出/退订必须停掉自有 runtime                                                                                                                                                                                                                                                                                                            | 减少可被离屏 WebView 窃取的凭据面                                                                                               |
| 21  | 原生输入 `ChatComposerView` 拥有共享草稿/恢复/模型控件；聊天直接内嵌，新建会话用 `NativeComposer`；**原生宿主在 window 坐标里测键盘重叠，不要套 RN 键盘避让**（sheet 局部坐标会低估）；sheet 宿主自行留底部安全区                                                                                                                                                                                                                              | 键盘几何是这类 App 最容易反复回归的点；两套避让同时生效 = 抖动/回弹                                                             |
| 22  | **UI 基线必须无登录、无凭据、无云访问、无连接机器**；用生产组件 + `present` 加可独立重置的 Debug 场景，在边界注入确定性数据/服务结果；共享控件必须在**每个宿主**都跑；本地检查省略 `--udid` 走租约池、用 `verify:build`（一份 DerivedData、禁止 per-task `-derivedDataPath`、禁止复制 checkout、用 `verify:clean` 回收）、`verify:simulator --name` 包裹多步流程、**绝不直接 `simctl create`**；显式 `--udid` 只给 CI 这类调用方自己拥有的设备 | "需要登录才能验收"会让验收在 CI 里变成不可能；每任务一份 DerivedData 会让磁盘与构建时间爆炸                                     |
| 23  | 截图证视觉状态、录屏证时间行为；**缺场景/超时即失败；截图本身不证明视觉正确**                                                                                                                                                                                                                                                                                                                                                                  | 阻止"截了张图就算验过"的自欺                                                                                                    |
| 24  | 推送：OneSignal 归 LodyKit 所有（RN 前初始化、缓存点击直到 JS ack、unmount 移除订阅）；NSE/App Group/SDK pin/entitlements 通过 plugin 持久化，**不要只改生成文件**；通知导航只接受旧 workspace/session 路由并对已登录用户的 catalog 解析；`recipientUserId` 给切换账号后的点击上锁；Debug 的离线通知 fixture 绝不初始化 SDK 或请求真实权限                                                                                                     | 账号切换后串号推送（事故级）、prebuild 回滚（同 #3）                                                                            |

只能搬三条就搬：**#2/#3（原生只在一个 Kit、只改真源）**、**#22（验收必须无凭据可复现）**、**#10/#23（行为优先、证据分工）**。

---

## 7. 该抄 / 不该抄

### 可直接搬（与产品无关的工程骨架）

1. **pnpm workspace + 单 app + 单本地原生模块**：根 `package.json` 只做脚本转发，`apps/*` + `packages/*`，`nodeLinker: hoisted`。
2. **`apps/mobile` 的分层**（app/screens/features/models/cloud/hooks/lib/ui）+ 依赖方向规则 + `*Screen` 命名约束 + mailbox 模式。
3. **`presentation` 契约**（`definePage` / `usePageRuntime` / `present` / `PresentedPage` / `SheetStack`）：内存参数 + URL 只有 id + 三种关闭路径都 settle + 一套样式映射；带单测（`tests/presentation/`），搬过去先跑通那几个测试。
4. **i18n 单 catalog + xcstrings 投影插件 + `check-locales.mjs`**（键/占位符对齐 + 硬编码 CJK 扫描）+ Swift 侧读同一 bundle。Swift 侧替换逻辑要自己重写并照 §4 加纯逻辑检查。
5. **主题 tokens/palette/appearance 三层**：语义色角色 + `PlatformColor` + 暗色背景偏好持久化走原生。
6. **整套 `verification/`**（租约 / build+clean / native 行为检查 / ui runner+driver+orchestrator+catalog / 基建自测）。这是 Lody 最值得抄的部分，改常量比重新设计便宜得多。
7. **Debug-only 场景 + `#if DEBUG` launch argument 闸门 + 内存 Provider 覆盖登录/云端**（含 `runtimeInfo` 这种"JS 无法伪造"的原生开关）。
8. **AXe 作为 UI 驱动层**（`axe describe-ui` 拿可访问性树、`tap --id/--label`/坐标、`type`、`key`、`swipe`、`touch`），以及"用可访问性标识当选择器"的纪律（`PREVIEW`/`READY` 两张表）。
9. **验收基建自身的单测**（`simulator_test.py`、`build_test.py`、`runner_test.py`：并行不互相取消、端口被占必须拒绝而非复用、租约语义）。这是让基础设施长期可信的关键。
10. **CI 四段式**：checks / native / build(产物 tar) / ui(matrix 并行消费同一产物, fail-fast false) + AXe 固定版本 + sha256 校验 + 每批独立模拟器 + 证据 always 上传。
11. **fingerprint 驱动的 OTA/TestFlight 分流**（`decide` job + `ios-fingerprint` baseline artifact + `EXPO_UPDATES_FINGERPRINT_OVERRIDE` + archive/OTA 双端校验）。
12. **TestFlight 流水线的"每步显式校验"风格**：ASC 决定 build number、PlistBuddy 写完读回、`verify-ios-build-mode.sh` 拒绝混合原生模式、签名后 jq 校验、archive 后校验 runtime/version、导出后校验 IPA 链接、`always()` 清理签名资产。Memoh 就算不用 TestFlight，这套"发布即取证"的写法也值得照搬。
13. **`patches/` 目录 + 每条补丁写明"何时可删"**；**vendored workspace 包 + 运行时自检**（只在真的必须改上游时才用）。
14. **许可证清单生成/校验**（`build-licenses.mjs` + `licenses.generated.ts` + `licenses:check` 进 `pnpm check`）。
15. **工程宪法 `AGENTS.md` + `CLAUDE.md` 软链**：把 §6 那张表改写成 Memoh 版本，是这次搬迁里性价比最高的一件事。

### 不该抄（Lody 特有 / 与 Memoh 无关）

1. **云协议与 CRDT 全栈**：`src/cloud/**`（auth/catalog/github/send/kv）、`modules/lody-kit/{data-runtime,decoder}`、Loro/Flock、uint32 大端长度帧、8 MiB 单副本上限、"先持久化用户历史再写派发指针"、"machine ACK 是投递不是完成"、"跨恢复绝不自动重放"、SQLite 投影 + 后台同步。Memoh 是 Go 后端多 agent 平台，协议完全不同（HTTP/SSE/WS 由你定），这些约定不可移植。
2. **离屏 `WKWebView` + WASM 解码器**（`build-decoder.mjs` 生成的 `FlockDecoder.html`/`DataRuntime.html`、CSP、`DomWebView` vendor 包、共享 WebView 在 warmer 与页面间搬移）。除非 Memoh 也要在移动端跑 WASM/CRDT，否则是纯负债。
3. **Watchdog / `SessionBackgroundTasks` / `BGContinuedProcessingTask` 的整套后台语义**：与"长驻云端会话 + CRDT 增量"绑定；但**"健康状态机放原生、策略可纯逻辑测试"这个形状**可以借。
4. **Device Flow + `SFSafariViewController` + Keychain token 的具体实现**（含 `url.host == "lody.ai"` 这类硬校验）。Memoh 走自己的 OIDC/device flow；能抄的是"凭据只进 Keychain、浏览器关闭由 JS 显式调用、不开自己的 webview 收凭据"这些原则。
5. **OneSignal + NSE + Live Activity (Widget Extension) + App Group**：`Notifications/**`、`live-activity/**`、`notification-extension/**`、`plugins/withPushNotifications.js`、`push-extension.rb`。Memoh 若用别的推送（或自建 APNs）就整块换掉；Live Activity 尤其与"多 agent 跑任务"这个产品形态强绑定。
6. **iPad 悬浮面板线**：`PadHomeScreen`、`NativeSplit`、`NativeSidebar`、`Chrome/LodyNativeShellPOC`、`List/LodySidebar*`、`ipad*.py` 用例。iPhone-only 起步就不需要，且它是"两套容器共享内容"的复杂来源（AGENTS.md 也承认 sidebar/grouped list 是独立容器）。
7. **`ChatComposerView` / `LodyChatView` / Markdown / diff / file-icons 这一坨聊天专用 UI**（`@pierre/diffs`、`MarkdownView`+`Litext` SPM、`ChatMarkdown*`、`Diff/*`、`file-icons/*`）。**架构启示**可借（无限列表用 UICollectionView + 动态测量、流式文本增量、native block layout parity、抛掷曲线采样），代码不可借（AGPL + 领域耦合）。
8. **GitHub PR / mentions / licenses / community notice** 等产品功能。
9. **所有 Lody 身份常量**：`app.innei.lody`、`appleTeamId KAMM5N88X3`、`scheme lody`、OTA `https://ota.innei.in/manifest`、OneSignal App ID、`@order_usagi` Telegram 通知、`group.app.innei.lody`、`lody://`、NSE / Live Activity 的 bundle id 后缀。
10. **AGPL 源码文本本身**（见开头警告）。

---

## 8. 脚手架配方：从零 bootstrap 一个同构的 Memoh iOS

> 目标形态：`memoh-ios/`（pnpm workspace）→ `apps/mobile`（Expo + RN）+ `apps/mobile/modules/memoh-kit`（Swift）+ `apps/mobile/verification`（验收）。
> 下面是"照做能起步"的清单，不是脚本；每步标了"抄 Lody 的哪个文件当模板"。

### 步骤 0：机器前置（macOS 构建机）

```sh
xcodebuild -version                 # 需要 Xcode 26.5 / iOS 26.x SDK
node --version                      # >= 22.13（要用 --experimental-strip-types 与 test module mocks）
corepack enable && corepack prepare pnpm@11.10.0 --activate
python3 --version                   # >= 3.11（verification 脚本）
brew install cocoapods
gem install cocoapods-spm           # 只有用 SPM 依赖时才需要（见 Gemfile）
# AXe（UI 驱动，固定版本并记录 sha256；CI 里也一样钉住）
mkdir -p ~/bin/axe
curl -fL https://github.com/cameroncooke/AXe/releases/download/v1.8.0/AXe-macOS-v1.8.0-universal.tar.gz -o /tmp/axe.tgz
shasum -a 256 /tmp/axe.tgz          # 记下 hash，写进 CI
tar -xzf /tmp/axe.tgz -C ~/bin/axe && export PATH="$HOME/bin/axe:$PATH"
axe --version                       # run.py 的 environment.json 会记录它
```

iOS 26 模拟器 runtime：`xcodebuild -downloadPlatform iOS`（或 Xcode Settings → Components），确认 `xcrun simctl list runtimes` 里有 `iOS 26.x`。

### 步骤 1：workspace 骨架

```sh
mkdir -p memoh-ios/apps/mobile/modules/memoh-kit
cd memoh-ios
# 抄 lody-ios 的：package.json（改名、改 filter 名）、pnpm-workspace.yaml、tsconfig.json、
# .prettierrc.json、.prettierignore、.gitignore
# .gitignore 务必含：apps/mobile/ios/、.expo/、node_modules/、.artifacts/、*/ios/Resources/、*.tsbuildinfo
```

起步版 `pnpm-workspace.yaml`（不需要 `patches`/`overrides`/dom-webview 项）：

```yaml
packages: [apps/*, packages/*]
nodeLinker: hoisted
```

### 步骤 2：初始化 Expo 工程

```sh
cd apps/mobile
pnpm dlx create-expo-app@latest . --template blank-typescript   # 或手写 package.json 后 pnpm install
pnpm add expo@~57 expo-router expo-dev-client expo-updates expo-localization \
         expo-constants expo-linking expo-status-bar expo-system-ui expo-asset
pnpm add react@19.2 react-native@0.86 react-native-reanimated react-native-screens \
         react-native-safe-area-context react-native-worklets react-native-web react-dom
pnpm add -D @react-native/metro-config typescript @types/react
cd ../.. && pnpm add -Dw @babel/core babel-preset-expo esbuild prettier
```

照抄并改名：

- `app.config.ts`：`name: 'Memoh'`、`slug: 'memoh-ios'`、`platforms: ['ios']`、`scheme: 'memoh'`、自己的 `bundleIdentifier` / `appleTeamId`、`ios.deploymentTarget: '26.0'`、`experiments: { typedRoutes: true, reactCompiler: true }`、`runtimeVersion: { policy: 'fingerprint' }`。**先不写 `updates` 段**（等 OTA 服务就绪）。
- `metro.config.js`：保留 `config.cacheVersion += ':' + __dirname;` 那一行。
- `index.js`、`tsconfig.json`（`paths` 里的 kit alias 指向 `./modules/memoh-kit/src`）。
- `Gemfile`：`gem "cocoapods", "~> 1.16"`（用 SPM 依赖才加 `cocoapods-spm`）。

### 步骤 3：i18n 与生成原生资源

- `locales/{en,zh-Hans}.json`：从最少 key 开始，但**必须先有** `ios.info.bundleDisplayName`、`ios.info.photoLibraryUsage`（`plugins/locales.js` 的 `INFO_KEYS` 强制要求，缺了 `i18n:check` 直接 fail）。
- 抄 `plugins/locales.js`（键集/占位符/复数成对校验）、`plugins/withLocales.js`（`native.*` → `Localizable.xcstrings`，`INFO_KEYS` → `InfoPlist.xcstrings`，注意 `lastKnownFileType = "text.json.xcstrings"` 那一处）。
- 抄 `scripts/check-locales.mjs`，把 `SOURCES` 改成 `['modules/memoh-kit/ios','**/*.swift']` 与 `['src','**/*.{ts,tsx}']`。
- `scripts/build-licenses.mjs` 照抄改包名（`licenses:check` 进 `pnpm check`）。
- `native:assets` script：Lody 用它生成离屏 WebView HTML + 许可证 + 文件图标 PNG。Memoh 若不用 WASM，就写一个只做"许可证 + 图标"的最小脚本，但**保留这个 npm script 名字**（`build.py` 与 workflow 都调它）。

### 步骤 4：原生模块 `memoh-kit`

```sh
mkdir -p apps/mobile/modules/memoh-kit/{ios/{Chrome,Cards},src/{chrome,cards,runtime},verification}
```

抄并改名：

- `expo-module.config.json` → `{ "platforms": ["ios"], "ios": { "modules": ["MemohKitModule"] } }`
- `package.json` → `name: "@memoh-ios/kit"`, `main: "src/index.ts"`
- `ios/MemohKit.podspec` → `platform :ios, '26.0'`、`swift_version = '6.0'`、`static_framework = true`、`dependency 'ExpoModulesCore'`、`source_files = '**/*.{swift,h,m}'`。**先不要**预编译相关的 `macros_plugin` xcconfig 与 `spm_dependency`，等真的启用预编译/SPM 再加。
- `ios/MemohKitModule.swift` → 照 §2.3 的形状起最小模块（一个 `@JS` 常量 + 一个 `AsyncFunction` + 一个 `View`），先证明 autolinking 通了再长大。
- `src/runtime/MemohKit.ts`（`requireNativeModule` + 类型）、`src/index.ts`（唯一出口）。

验证 autolink：

```sh
pnpm --filter @memoh-ios/mobile prebuild     # 生成 ios/
cd apps/mobile/ios && bundle exec pod install
cd .. && pnpm ios                            # 或 xcodebuild 编到模拟器
```

### 步骤 5：presentation / 导航 / i18n / 主题（RN 骨架）

按 §3 抄：`src/lib/presentation/{page.tsx,presentationStore.ts,PresentedPage.tsx,SheetStack.tsx,index.ts}`、`src/hooks/screens/usePageRuntime.ts`、`src/lib/i18n/{index.ts,boot.ts,format.ts}`、`src/lib/theme/{tokens.ts,palette.ts,appearance.tsx,motion.ts}`、`src/app/_layout.tsx` + `src/app/presented/[presentationId].tsx`。同时把 `tests/presentation/presentation.test.mjs` 搬过来跑通（它 mock `expo-router`，不需要模拟器）。

### 步骤 6：验收基建

```sh
mkdir -p apps/mobile/verification/ui
# 抄 apps/mobile/verification/{simulator.py,build.py,clean.py,native.py,simulator_test.py,build_test.py}
# 抄 apps/mobile/verification/ui/{run.py,orchestrator.py,driver.py,catalog.py,inspector.py,
#                                   software-keyboard.m,metro-diagnostics.cjs,runner_test.py,README.md}
```

按 §4.8 的替换清单改常量，然后：

```sh
pnpm test                                        # 基线自测（不需要 App）
# 造一个 Debug-only 最小场景 + 一条 case 脚本（例如 ui/smoke.py：等一个 AXUniqueId 再 capture）
pnpm verify:simulator --name 'Smoke' -- zsh -euc '
  pnpm verify:ui --app "$(pnpm --silent verify:build)" --case smoke --output .artifacts/smoke
'
pnpm verify:clean                                # 养成清理习惯
```

只跑通"一条 case 的 light/dark 两遍 + 截图 + 录屏 + results.json"，整套基建就算落地；后面每条 case 是同一模板的复制。

### 步骤 7：AGENTS.md 与 CI

- 写 `AGENTS.md`：以 §6 的表为骨架，把 `lody-kit`→`memoh-kit`、`@lody-ios/kit`→`@memoh-ios/kit`、验收命令与模拟器名换成 Memoh 的；`ln -sf AGENTS.md CLAUDE.md`。
- 写 `.github/workflows/verify.yml`：照 §5.1 的四 job，把 `EXPO_PUBLIC_UI_VERIFY=1`、`--batch` 三段、artifact 上传与 `always()` 删模拟器照搬。
- 发布线（`{ship,release}.yml`）**等真有发布需求再建**：需要先决定 OTA 服务与 App Store Connect API key。起步阶段 `pnpm bundle` + 手工上传 TestFlight 足够。

### 步骤 8：每天怎么用（写进 README）

```sh
pnpm ios                                        # 改原生代码后重编
pnpm start                                      # 只改 JS 时用 Metro
pnpm check && pnpm bundle                       # 提交前
pnpm verify:simulator --name 'Chat' -- zsh -euc 'pnpm verify:native; pnpm verify:ui --app "$(pnpm --silent verify:build)" --batch chat --output .artifacts/ui-chat'
pnpm verify:clean                               # 定期回收磁盘
```

### 搬过去的顺序建议（每步都要绿）

1. workspace + Expo 空工程 + `app.config.ts`（能 `pnpm ios` 跑起一个空 App）
2. i18n 三件套 + `check-locales`（`pnpm check` 绿）
3. `memoh-kit` 最小模块（一个常量 + 一个 AsyncFunction + 一个 View，App 里显示 "pong"）
4. `presentation` + 主题（一个页面能以 pageSheet/formSheet/push 三种方式打开并拿到结果，`pnpm test` 绿）
5. `verification` 全量骨架 + 一条 smoke case（能出截图与录屏）
6. `AGENTS.md` + `verify.yml`（PR 上能看到 4 个 check）
7. 之后每加一个产品功能，同时加一条 case——**不要攒着验收**。
