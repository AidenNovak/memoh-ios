# UI 行为基线

这里跑的是**用户能看见的行为**：真实 Debug App、租来的模拟器、真实截图与录屏。
它不依赖登录、不依赖云端、不依赖任何凭据——验收必须在别人的机器上、空手也能复现。

三层基建的分工（越往上越贵、越接近用户）：

| 层       | 命令                 | 断什么                                                                                     |
| -------- | -------------------- | ------------------------------------------------------------------------------------------ |
| 逻辑单测 | `pnpm test`          | 纯函数、协议、**验收基建自身**（`runner_test.py` / `simulator_test.py` / `build_test.py`） |
| 原生行为 | `pnpm verify:native` | 生产 Swift 类型的行为，不碰 UI 像素                                                        |
| UI 行为  | `pnpm verify:ui`     | 模拟器上真实 App 的用户可见状态与时序                                                      |

## 本地怎么跑

```sh
# 一个验收名包住"构建 + 多检查"：租约把设备 UDID 放进 $MEMOH_VERIFY_UDID
pnpm verify:simulator --name 'app-launch' -- zsh -euc '
  pnpm verify:native
  pnpm verify:ui --app "$(pnpm --silent verify:build)" --case app-launch
'

pnpm verify:clean                                  # 定期回收磁盘
pnpm verify:simulator --list                       # 池子里有哪些设备、谁在用
pnpm verify:simulator --release 'app-launch'       # 收掉一台忘了关的设备
```

几个刻意的约定：

- **不要自己 `simctl create`**：`verification/simulator.py` 是唯一能创建设备的地方，
  它只挑 `Memoh * Verify` 且 runtime 匹配的设备，绝不会碰你的个人设备。
- **不要传 `--udid`**：让脚本租一台；只有 CI 才自己建一次性设备并显式传。
- 默认租约**保持设备开机**以便复用（不 erase、不删）；`--shutdown-after` 才会关机。
- 构建永远只有一份共享 DerivedData（`verification/.artifacts/derived-data`）：
  不要给每个任务传自己的 `-derivedDataPath`，那会让每次构建都冷启动并且吃掉几 GB。

## 加一个 case

一个 case = 一个**可重置的 Debug 场景** + 它欠的证据。

1. 写场景脚本：`ui/cases/<name>.py`，接收 `run.py` 传的
   `--udid / --app / --output / --bundle-id / --language / --metro-port`。
   用 `driver.Driver` 的原语（`launch` / `terminate` / `capture` / `wait_for_text` /
   `record_start`）。**不要**引入 Appium / Detox / AXe：只用 `xcrun simctl`。
2. 在 `ui/run.py` 的 `CASES` 里注册：名字、batch、说明、脚本路径、
   **要交的截图名**（`screenshots=('composer',)` 之类）、是否需要录屏、超时。
   再把名字放进 `BATCHES` 的某个批次。
3. 场景自己产出证据：`driver.capture('composer')` 会写 `composer.png` +
   `composer.txt`（`textdump.swift` 用 Vision 读出屏幕上的文字）。
4. 跑它：

```sh
pnpm verify:simulator --name '<新验收名>' -- zsh -euc '
  pnpm verify:ui --app "$(pnpm --silent verify:build)" --case <name>
'
```

`pnpm verify:ui --list` 列出所有 case、批次、证据要求和超时。

### 场景必须遵守的两条

- **用生产组件，只在边界注入确定性数据**：把生产屏幕复制成一个假 UI，会随时间
  和生产漂移，验收就变成自欺。需要 fixture 就放在 dev-only 的 `/debug` 页面里。
- **不登录、不联网、不需要凭据**：验收的每个 case 都必须在干净的模拟器上直接跑起来。

## 证据规则（硬要求）

**截图证视觉状态，录屏证时序行为。** 两者不可互换，缺一即失败。

- case 在 `CASES` 里声明自己欠哪些截图；少一张、或者写出来是 0 字节 → **该 case 失败**。
- `video=True` 的 case 必须有非空的 `run.mp4`；录屏在 20 秒内没起来 → 失败。
- case 脚本超时（默认 180s，按 case 可调）→ 失败。
- case 脚本非零退出 → 失败，并且失败原因是脚本自己打印的 `FAILED: ...` 那一行
  （不是 exit code），例如 `none of ['Sessions'] appeared within 90s; screen showed: '...'`。
- 没有 pixel-diff 门禁：**截图是证据，不是自动通过**。视觉基线的变更要人看。

## 结果落在哪，为什么不能改

```
ui/results/<run-id>/            # run-id = UTC 时间戳 + 验收名 + 提交短 sha
  environment.json              # node/xcode/语言/设备/提交，复现一轮所需的全部信息（无密钥）
  metro.log  metro-startup.json
  results.json                  # 运行中的增量结果
  summary.json                  # 本轮结论，写一次
  COMPLETE
  <case>-<appearance>/
    result.json  check.log
    launch.png  launch.txt      # 声明过的证据
    run.mp4                     # 时序证据
    failure.png  native.log     # 失败时才有
```

- 每次运行**新建**一个 run 目录；`--run-id` 给一个已存在的目录会被拒绝。
- `summary.json` / 每条 `result.json` **只写一次**（`write_new`），后续运行不许覆盖。
- 一轮结论后来发现不对：**新增一轮并纠正**，不要回头改旧记录。

`ui/results/` 不入库（截图/录屏是二进制证据，体积大）。要留档就把 CI 的
`ui-evidence` artifact 存下来；确实需要进 git 时显式 `git add -f` 那一轮的目录。

## 并行与 CI

```sh
# 一个 Metro，N 台租约设备，批次内并行；一个失败不取消兄弟
python3 verification/ui/run.py --app "$APP" --parallel 2
```

`--parallel` 与 `--udid` 互斥：并行时设备由每个 worker 自己租，Metro 由父进程
持有（`--shared-metro` 是内部开关）。所有 worker 共用同一个 bundle，所以它们
之间的差异只有设备——这正是并行结果可比的原因。

`.github/workflows/verify.yml` 里 `build` 只构建一次并把 App 打成 artifact，
`ui` job 拿同一份产物分批并行跑，证据 `if: always()` 上传（保留 14 天）。

## 现在有哪些 case

| case         | 批次     | 场景                    | 证据                | 超时 |
| ------------ | -------- | ----------------------- | ------------------- | ---- |
| `app-launch` | `launch` | 冷启动到 App 自己的首屏 | `launch.png` + 录屏 | 180s |

`app-launch` 断言**没有凭据的全新安装，首屏是登录页**：`locales/<language>.json`
的 `login.title` 必须能在屏幕上读到（中英各跑一遍，所以它同时证明了本轮跑的是
哪个语言）。白屏、卡在 dev launcher、崩在启动阶段、或者跳过鉴权直接进主界面，
都会让这条失败。App 之后加了 dev-only 的 `EXPO_PUBLIC_UI_VERIFY` 旁路之后，把
`ui/cases/app-launch.py` 的 `EXPECTED_KEYS` 换成那个 Debug 场景的文案。

## 还没验证的部分

- **`verify:ui` 从未真正跑过一条 case**：本机还没有 `node_modules` 与 prebuild 出来的
  `ios/`，所以 `verify:build` 和 `verify:ui` 都只验证到"参数解析、规划、证据规则、
  结果落盘"这一层（那部分有单测覆盖，并且 `--dry-run` 能跑）。下面这些是在本机
  单独跑通过的：租约（创建/复用/关机/回收）、`native.py` 工具链检查（在 iOS 26.5
  模拟器里真的编译并执行了）、截图 + Vision 文字读取、录屏起停与 `wait_for_text`
  的成功/失败路径。**没跑通的是**：安装构建产物、`simctl launch` 带 dev-client
  参数、以及首屏文案断言——它们都依赖一个真实的 App。
- **预期文案的取值**：现在断的是 `login.title`（无凭据时的登录页）。第一轮真机跑
  起来之后如果 App 的启动路径变了（例如加了 `EXPO_PUBLIC_UI_VERIFY` 旁路），
  要跟着改 `EXPECTED_KEYS`——那属于"case 该断什么"的判断，不是基建问题。
- **Metro 与 dev-client 的启动参数**（`--initialUrl`、`EXDevMenu*`、`-AppleLanguages`）
  沿用参考项目的写法，没有在本项目里真跑过；第一次跑 `verify:ui` 时确认。
- **CI runner 上是否有 iOS 26.5 runtime**：租约只认 `simulator.py` 里钉住的
  runtime，缺了会直接报错并列出已安装的 runtime（而不是静默换一台设备）。
