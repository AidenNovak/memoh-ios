#!/usr/bin/env python3
"""连真实服务端的 case 共用的几件事：环境变量、启动参数、种子文件、可达性预检。

`chat-roundtrip` 与 `chat-info` 都要"登录 → 进对话页 → 看屏幕上有没有东西"，
差别只在最后断言什么。启动参数和种子文件的形状必须一模一样——两处各写一遍就会
漂移，而漂移的表现是"一条 case 过了另一条没过"，查起来很费时间。
"""
from pathlib import Path
import json
import os
import sys

ENV_PATH = Path.home() / '.config' / 'memoh-ios' / 'dev.env'
SEED_NAME = 'memoh-verify-seed.json'


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


def require_env():
    """取出连服务端要用的两项，缺了就带指引地失败。"""
    env = load_env()
    base_url = env.get('MEMOH_DEV_BASE_URL')
    password = env.get('MEMOH_ADMIN_PASSWORD')
    if not base_url or not password:
        fail(
            f'{ENV_PATH} 缺 MEMOH_DEV_BASE_URL 或 MEMOH_ADMIN_PASSWORD；'
            '先跑 pnpm dev:env，见 docs/environment.md'
        )
    return base_url, password


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


def write_seed(driver, base_url, password, scenario='chat', extra=None):
    """把种子放进 App 的 Documents。必须在启动前写入。

    `extra` 用来加场景特有的开关（如会话信息面板的 `openSessionInfo`）。
    """
    documents = driver.container('data') / 'Documents'
    documents.mkdir(parents=True, exist_ok=True)
    seed_path = documents / SEED_NAME
    plan = {
        'baseUrl': base_url,
        'username': 'admin',
        'password': password,
        'scenario': scenario,
    }
    plan.update(extra or {})
    seed_path.write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
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


def common_arguments(parser):
    """两条 live case 共用的命令行参数。"""
    parser.add_argument('--udid', default=os.environ.get('MEMOH_UI_UDID'), required=False)
    parser.add_argument('--app', type=Path, default=os.environ.get('MEMOH_UI_APP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', 'ai.memoh.ios'))
    parser.add_argument('--language', default=os.environ.get('MEMOH_UI_LANGUAGE', 'en'))
    parser.add_argument(
        '--metro-port', type=int, default=int(os.environ.get('MEMOH_UI_METRO_PORT', '8097'))
    )
    return parser
