#!/usr/bin/env python3
"""Case `chat-roundtrip`: 连真实 Memoh 跑完一轮对话，看流式回复出现在屏幕上。
## 它验证什么

这是唯一一个**必须连活服务端**的 case，所以归在 `live` 批次里，默认不跑——
`pnpm verify:ui` 不带参数时只跑不依赖外部环境的 case。它证明的是只有真机能证明的事：

  - App 真的连得上 Memoh（真实隧道、真实 JWT、真实 WebSocket）
  - 回复真的出现在屏幕上，且**streaming 期间能看到它变长**
  - 屏幕上是产品组件本身，不是测试替身

## 怎么驱动

`simctl` 没有点击能力。要点击就得引入 XCUITest / Appium / Maestro，那会给项目加
一整套重型依赖，也让验收脚本离"能被人看懂"越来越远。

所以这里用**启动种子**：脚本往 App 沙箱里放一个 JSON，App 在开发构建下读它，
自动登录、打开会话、发一条固定消息（见 `apps/mobile/src/features/verify/`）。
被验证的是真实路径——真实网络、真实协议、真实 reducer、真实渲染；省掉的只有
"手指点屏幕"这一段。

## 前置

    pnpm dev:env                 # SSH 隧道到 vultr-sg 上的 Memoh dev
    ~/.config/memoh-ios/dev.env 里有 MEMOH_DEV_BASE_URL / MEMOH_ADMIN_PASSWORD

由 run.py 启动：

    python3 ui/cases/chat-roundtrip.py --udid <udid> --app <path.app> --output <dir>
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from driver import Driver, DriverError  # noqa: E402

ENV_PATH = Path.home() / '.config' / 'memoh-ios' / 'dev.env'
SEED_NAME = 'memoh-verify-seed.json'
PROMPT = 'Say exactly: pong'
# 模型被明确要求回这两个字；OCR 认错一两个字母也不影响判定，只要出现它就算过。
EXPECTED = ('pong',)


def fail(message):
    print(f'FAILED: {message}', file=sys.stderr, flush=True)
    raise SystemExit(1)


def load_env():
    env = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        env[key] = value
    return env


def launch_arguments(port, language):
    """与 app-launch 一致：真正要的是 App 的首屏，不是 dev launcher 的工具界面。"""
    return [
        '--initialUrl', f'http://127.0.0.1:{port}?disableOnboarding=1',
        '-expo.devlauncher.hasGrantedNetworkPermission', 'YES',
        '-EXDevMenuShowsAtLaunch', 'NO',
        '-EXDevMenuIsOnboardingFinished', 'YES',
        '-EXDevMenuShowFloatingActionButton', 'NO',
        '-AppleLanguages', f'({language})',
        '-AppleLocale', 'en_US' if language == 'en' else 'zh_CN',
        '-AppleKeyboards', '(en_US@sw=QWERTY)',
    ]


def write_seed(driver, base_url, password):
    """把种子放进 App 的 Documents。必须在启动前写入。"""
    documents = driver.container('data') / 'Documents'
    documents.mkdir(parents=True, exist_ok=True)
    seed_path = documents / SEED_NAME
    seed_path.write_text(
        json.dumps(
            {
                'baseUrl': base_url,
                'username': 'admin',
                'password': password,
                'scenario': 'chat',
                'message': PROMPT,
            },
            ensure_ascii=False,
        ),
        encoding='utf-8',
    )
    return seed_path


def preflight(base_url):
    """先确认服务端真的可达。

    没有这一步，隧道的断裂会伪装成"某个 UI 元素没出现"，读日志的人会去查 App 的
    渲染，而真正的问题是网络。验收脚本有责任把失败归因到正确的地方。
    """
    import urllib.error
    import urllib.request

    probe = f'{base_url.rstrip("/")}/bots'
    try:
        # 401 也算可达：说明服务端在响应，只是没带凭据。
        urllib.request.urlopen(probe, timeout=8)
    except urllib.error.HTTPError:
        return
    except Exception as error:  # noqa: BLE001 - 任何连不上都算不可达
        fail(
            f'服务端不可达：{probe} —— {error}\n'
            '先跑 `pnpm dev:env` 建立隧道，再用 `pnpm dev:env` 的状态确认它是活的。'
        )


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--udid', default=os.environ.get('MEMOH_UI_UDID'), required=False)
    parser.add_argument('--app', type=Path, default=os.environ.get('MEMOH_UI_APP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', 'ai.memoh.ios'))
    parser.add_argument('--language', default=os.environ.get('MEMOH_UI_LANGUAGE', 'en'))
    parser.add_argument(
        '--metro-port', type=int, default=int(os.environ.get('MEMOH_UI_METRO_PORT', '8097'))
    )
    parser.add_argument('--timeout', type=float, default=180.0, help='等回复的秒数')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if not arguments.udid:
        fail('no Simulator: pass --udid or run this through pnpm verify:ui')

    env = load_env()
    base_url = env.get('MEMOH_DEV_BASE_URL')
    password = env.get('MEMOH_ADMIN_PASSWORD')
    if not base_url or not password:
        fail(
            f'{ENV_PATH} 缺 MEMOH_DEV_BASE_URL 或 MEMOH_ADMIN_PASSWORD；'
            '先跑 pnpm dev:env，见 docs/environment.md'
        )

    # 先证明服务端活着，否则后面的失败会指向错误的方向。
    preflight(base_url)

    driver = Driver(
        arguments.udid,
        arguments.output,
        bundle_id=arguments.bundle_id,
        language=arguments.language,
        app=arguments.app,
    )

    seed_path = None
    try:
        driver.install()
        seed_path = write_seed(driver, base_url, password)

        driver.terminate()
        driver.launch(launch_arguments(arguments.metro_port, arguments.language))

        # 1) 首页。种子里有凭据，所以这里应该直接进主界面而不是登录页。
        #    注意：wait_for_text 的 capture_name 只写 .txt；声明的截图证据要的是真
        #    PNG，所以每一步都要再 capture 一次。
        driver.wait_for_text(('Sessions',), timeout=150)
        driver.capture('home')

        # 2) 对话页。脚本会把界面推到 /chat/<id>。
        driver.wait_for_text(('Message',), timeout=90)
        driver.capture('composer')

        # 3) 核心断言。
        driver.wait_for_text(EXPECTED, timeout=arguments.timeout)
        driver.capture('reply')

        # 4) 稳定态：run 结束后"停止"按钮消失。
        #    发送按钮是一个 ↑ 字形，OCR 读不出有意义的文本，所以断言"停止"消失，
        #    而不是"发送"出现——后者永远不可能通过。
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            payload = driver.capture('settled')
            if 'stop' not in payload['text'].casefold():
                break
            time.sleep(2.0)
        else:
            fail('"Stop" 一直没消失，run 可能没有收敛')

        if EXPECTED[0].casefold() not in payload['text'].casefold():
            fail(f'稳定态下回复不见了，屏幕上是：{payload["text"]!r}')
    except DriverError as error:
        fail(str(error))
    finally:
        # 种子里有密码，用完必须删。
        if seed_path is not None and seed_path.exists():
            seed_path.unlink()

    print(f'ok chat-roundtrip prompt={PROMPT!r} reply matched {EXPECTED[0]!r}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
