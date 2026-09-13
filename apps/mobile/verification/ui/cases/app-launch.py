#!/usr/bin/env python3
"""Case `app-launch`: the app cold starts and its first screen is readable.

这是最小的一条真实 case，也是这套基建的自检：它回答"这个 Debug 构建在干净的
模拟器上还能起得来吗，首屏是不是该有的那一屏"。它不注入任何 fixture —— 走的是
App 自己的启动路径，所以一旦首屏被改坏（白屏、只停在 dev launcher、崩在启动
阶段、跳过鉴权直接进主界面），这条 case 会失败，并且把当时屏幕上的文字原样报
出来。

当前预期：**没有凭据的全新安装，首屏是登录页**（`login.title`）。这正是
AGENTS.md 的"不登录也能跑"在 App 侧的表现；App 之后如果加了 dev-only 的
`EXPO_PUBLIC_UI_VERIFY` 旁路（跳过鉴权直接进 Debug 场景），这条 case 的预期要
跟着换成那个场景的文案——那是行为变了，不是 case 坏了。

证据：`launch.png`（截图，视觉状态）+ `run.mp4`（录屏，冷启动时序）。
预期文案取自 `locales/<language>.json`，所以这条 case 同时证明了本轮跑的是哪个
语言。临时换文案：`MEMOH_UI_EXPECT_TEXT='...'`。

由 run.py 启动：

    python3 ui/cases/app-launch.py --udid <udid> --app <path.app> --output <dir>
"""
import argparse
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from driver import Driver, DriverError  # noqa: E402

ROOT = HERE.parents[4]
LOCALES = ROOT / 'apps/mobile/locales'
# 无凭据时的首屏是登录页；文案从 locales 取，断言顺带证明本轮跑的是哪个语言。
EXPECTED_KEYS = ('login.title',)
LOCALES_BY_LANGUAGE = {'en': 'en', 'zh-Hans': 'zh-Hans'}


def fail(message):
    print(f'FAILED: {message}', file=sys.stderr, flush=True)
    raise SystemExit(1)


def expected_texts(language):
    """Copy the assertions come from, so a case also proves which language ran."""
    override = os.environ.get('MEMOH_UI_EXPECT_TEXT')
    if override:
        return [part.strip() for part in override.split(',') if part.strip()]
    catalog = json.loads((LOCALES / f'{LOCALES_BY_LANGUAGE[language]}.json').read_text())
    return [catalog[key] for key in EXPECTED_KEYS if key in catalog]


def launch_arguments(port, language):
    return [
        '--initialUrl', f'http://127.0.0.1:{port}?disableOnboarding=1',
        # 关掉 dev launcher 自己的浮层和引导：验收要的是 App 的首屏，不是工具界面。
        '-expo.devlauncher.hasGrantedNetworkPermission', 'YES',
        '-EXDevMenuShowsAtLaunch', 'NO',
        '-EXDevMenuIsOnboardingFinished', 'YES',
        '-EXDevMenuShowFloatingActionButton', 'NO',
        '-AppleLanguages', f'({language})',
        '-AppleLocale', 'en_US' if language == 'en' else 'zh_CN',
        '-AppleKeyboards', '(en_US@sw=QWERTY)',
    ]


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--udid', default=os.environ.get('MEMOH_UI_UDID'), required=False)
    parser.add_argument('--app', type=Path, default=os.environ.get('MEMOH_UI_APP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', 'ai.memoh.ios'))
    parser.add_argument('--language', default=os.environ.get('MEMOH_UI_LANGUAGE', 'en'))
    parser.add_argument('--metro-port', type=int, default=int(os.environ.get('MEMOH_UI_METRO_PORT', '8097')))
    parser.add_argument('--timeout', type=float, default=120.0, help='Seconds to wait for the first screen')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if not arguments.udid:
        fail('no Simulator: pass --udid or run this through pnpm verify:ui')
    expectations = expected_texts(arguments.language)
    if not expectations:
        fail(f'no expected copy for language {arguments.language}; check {LOCALES}')

    driver = Driver(
        arguments.udid,
        arguments.output,
        bundle_id=arguments.bundle_id,
        language=arguments.language,
        app=arguments.app,
    )
    try:
        # 先清钥匙串：凭据是跨安装存活的，不清就会出现"期望登录页、实际直接进了
        # 主界面"的失败——那是上一轮验收的残留，不是 App 坏了。
        driver.reset_keychain()
        # 冷启动：先终止，确保读到的不是上一个 case 留在屏幕上的内容。
        driver.terminate()
        pid = driver.launch(launch_arguments(arguments.metro_port, arguments.language))
        text, found = driver.wait_for_text(expectations, timeout=arguments.timeout)
        payload = driver.capture('launch')
        if found.casefold() not in payload['text'].casefold():
            fail(
                f'first screen lost {found!r} between reads (screen now: {payload["text"]!r}); '
                'a first screen that changes this fast is not a stable baseline'
            )
        if driver.running_pid() != pid:
            fail(f'the app left the foreground after its first screen (pid {pid} is gone)')
    except DriverError as error:
        fail(str(error))
    print(f'ok app-launch pid={pid} matched={found!r} text={text!r}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
