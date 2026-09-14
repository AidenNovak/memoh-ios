#!/usr/bin/env python3
"""Case `pages`: 给**真实页面**留截图（首页、设置页、对话页）。

## 和 `scenes` case 的区别

- `scenes`：渲染本地帧回放，不需要网络。覆盖"消息流内部长什么样"。
- `pages`（本文件）：连一个**说真协议的固定服务端**
  （`verification/fixture/server.mjs`），让 App 走完整的 store → HTTP → 页面链路，
  覆盖"页面本身长什么样"。

两者都要，因为它们是不同的东西：`scenes` 能保证每种消息状态的渲染是对的，
但证明不了页面的头部、空态、分组、按钮长什么样——那些只有在真实页面里才存在。

## 为什么用固定服务端而不是真服务端

真服务端的数据会变（会话标题、时间、模型回复），截图就没法比较"改之前和改之后"。
固定服务端给出的是一份**写死的**数据，同一个页面每次截出来都一样。而且它不需要
凭据、不需要隧道、CI 里能跑。

代价是它要把协议实现一遍——那份活儿只有一次，而且它自己是可验证的
（`verification/fixture/probe.mjs`）。

由 run.py 启动：

    python3 ui/cases/pages.py --udid <udid> --app <path.app> --output <dir>
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from driver import Driver, DriverError  # noqa: E402

ROOT = HERE.parents[4]
FIXTURE = ROOT / 'apps/mobile/verification/fixture/server.mjs'

APPEARANCES = ('light', 'dark')

# 每个画面：名字、要打开的路由、用来确认"已经到位"的屏幕文字、场景名（可选）。
#
# `expect` 是从 **locales 里取不到的**短标识——它们出现在屏幕上、且足够独特，
# 用来确认页面确实渲染完而不是停在加载态。用英文界面跑，所以这些是英文文案。
PAGES = (
    {
        'name': 'home',
        'title': '会话列表',
        'route': '/',
        'expect': ['Sessions'],
    },
    {
        'name': 'home-empty',
        'title': '会话列表（空态）',
        'route': '/',
        'scenario': 'home-empty',
        'expect': ['No sessions'],
    },
    {
        'name': 'settings',
        'title': '设置页',
        'route': '/settings',
        'expect': ['Settings'],
    },
    {
        'name': 'chat',
        'title': '对话页（真实链路：store → HTTP → 页面）',
        'route': '/chat/fixture-session-active',
        # 工具调用现在**聚合成一行**（见 memoh-kit 的 ToolActivityGroup），
        # 所以断言的是聚合后的措辞，不是某条原始命令——原始命令在展开里才看得到。
        'expect': ['Ran commands'],
    },
    {
        'name': 'chat-queue',
        'title': '对话页：待发队列（运行中排队的话）',
        'route': '/chat/fixture-session-active',
        # 队列是 REST 拉的（不是协议帧），所以这条依赖 fixture 服务端的 /queue 返回
        # 固定数据。断言 'Queued' 与 'Steering' 两个 kind 标签：它们只有真的渲染出
        # 队列条时才在屏幕上，能同时证明"拉了队列"和"分得清两条队列"。
        'scenario': 'queue',
        'expect': ['Queued', 'Steering'],
    },
)


def fail(message):
    print(f'FAILED: {message}', file=sys.stderr, flush=True)
    raise SystemExit(1)


def wait_for_fixture(port, timeout=15.0):
    """等服务端起来。它没起来的话后面全是"App 里是空的"，很难查。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/bots', timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:  # noqa: BLE001 - 没起来就是没起来，任何异常都一样
            time.sleep(0.3)
    return False


def set_scenario(port, scenario):
    """切固定服务端的场景（会话列表为空 / 有数据等）。"""
    payload = json.dumps({'scenario': scenario}).encode()
    request = urllib.request.Request(
        f'http://127.0.0.1:{port}/__scenario', data=payload,
        headers={'content-type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read()


def write_seed(driver, port, scenario):
    """把种子写进 App 沙箱：连固定服务端、登录、并打开指定画面。

    凭据是假的，但**形状是真的**——App 会真的走一遍 login → 存 Keychain →
    SessionProvider 取 bots/sessions。省掉的只有"真服务器"。
    """
    documents = driver.container('data') / 'Documents'
    documents.mkdir(parents=True, exist_ok=True)
    seed = {
        'baseUrl': f'http://127.0.0.1:{port}',
        'username': 'fixture',
        'password': 'fixture',
        'scenario': 'route',
        'path': scenario['route'],
    }
    target = documents / 'memoh-verify-seed.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(seed), encoding='utf-8')
    temporary.replace(target)


def clear_seed(driver):
    for name in ('memoh-verify-seed.json', 'memoh-verify-seed.tmp'):
        path = driver.container('data') / 'Documents' / name
        if path.exists():
            path.unlink()


def launch_arguments(port, language):
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


def capture_page(driver, port, page, appearance, results, metro_port, language):
    """重启 App 到指定画面并截图。

    ## 为什么每个画面都重启

    试过"启动一次、切路由走完全部画面"，不行：store 里的会话列表在第一次取数后
    就不再重取，所以切到 `home-empty` 时屏幕上仍然是上一次那四条会话——截图与
    固定服务端的场景对不上，而**失败信息看起来像页面坏了**。

    重启的代价是每次多几秒，换来的是"每个画面都是从零开始的确定状态"。
    验收的确定性比速度重要。
    """
    driver.set_appearance(appearance)
    time.sleep(0.6)
    driver.terminate()
    time.sleep(0.4)

    # 场景必须在 App 起来之前设好——它决定这次启动会看到什么。
    set_scenario(port, page.get('scenario', 'default'))
    write_seed(driver, port, page)
    driver.launch(launch_arguments(metro_port, language))

    name = f'{page["name"]}-{appearance}'
    path = driver.output / f'{name}.png'
    try:
        driver.wait_for_text(page['expect'], timeout=60, interval=1.0)
    except DriverError as error:
        results.append({'page': page['name'], 'appearance': appearance,
                        'status': 'failed', 'reason': str(error)})
        print(f'  FAIL {name}: {error}', flush=True)
        driver.screenshot(driver.output / f'{name}-FAILED.png')
        return

    # 让它稳定一帧再截：列表的异步取数、材质与文字渲染都需要一帧。
    time.sleep(1.5)
    driver.screenshot(path)
    results.append({'page': page['name'], 'appearance': appearance, 'status': 'passed',
                    'screenshot': path.name, 'bytes': path.stat().st_size})
    print(f'  ok {name} ({path.stat().st_size} bytes)', flush=True)


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--udid', default=os.environ.get('MEMOH_UI_UDID'), required=False)
    parser.add_argument('--app', type=Path, default=os.environ.get('MEMOH_UI_APP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', 'ai.memoh.ios'))
    parser.add_argument('--language', default=os.environ.get('MEMOH_UI_LANGUAGE', 'en'))
    parser.add_argument('--metro-port', type=int, default=int(os.environ.get('MEMOH_UI_METRO_PORT', '8097')))
    parser.add_argument('--fixture-port', type=int, default=int(os.environ.get('MEMOH_FIXTURE_PORT', '18099')))
    # 默认跟随编排器给的那一种（`MEMOH_UI_APPEARANCE`）。
    #
    # 编排器本来就按外观循环调这个脚本，所以默认"两种都跑"会让同一份工作做两遍，
    # 而且并行分片时会同时抢模拟器（表现为 simctl launch timed out）。直接单跑时
    # （手动调试）不传就是两种都跑，方便。
    parser.add_argument('--appearance', action='append', choices=APPEARANCES,
                        default=None)
    parser.add_argument('--page', action='append', help='只跑指定画面')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if not arguments.udid:
        fail('--udid or MEMOH_UI_UDID is required')

    pages = list(PAGES)
    if arguments.page:
        wanted = set(arguments.page)
        pages = [page for page in pages if page['name'] in wanted]
        if not pages:
            fail(f'no matching pages for {sorted(wanted)}')
    from_appearance = os.environ.get('MEMOH_UI_APPEARANCE', '').strip()
    if arguments.appearance:
        appearances = tuple(arguments.appearance)
    elif from_appearance in APPEARANCES:
        appearances = (from_appearance,)
    else:
        appearances = APPEARANCES

    if not wait_for_fixture(arguments.fixture_port):
        fail(f'固定服务端没有起来（127.0.0.1:{arguments.fixture_port}）。'
             f'先跑 node verification/fixture/server.mjs --port {arguments.fixture_port}')

    driver = Driver(arguments.udid, arguments.output, bundle_id=arguments.bundle_id,
                    language=arguments.language, app=arguments.app)
    if arguments.app is not None:
        driver.install()
        # 固定服务端的凭据每次都是假的，但 Keychain 会跨安装存活（第 9 条），
        # 不清掉的话 App 会拿着上一次的 token 直接进主界面。
        driver.reset_keychain()

    set_scenario(arguments.fixture_port, pages[0].get('scenario', 'default'))
    write_seed(driver, arguments.fixture_port, pages[0])
    driver.launch(launch_arguments(arguments.metro_port, arguments.language))

    results = []
    try:
        driver.wait_for_text(['Sessions', 'Settings'], timeout=90, interval=1.0)
        for appearance in appearances:
            for page in pages:
                capture_page(driver, arguments.fixture_port, page, appearance, results,
                             arguments.metro_port, arguments.language)
    except DriverError as error:
        fail(f'driver error: {error}')
    finally:
        clear_seed(driver)

    passed = sum(1 for entry in results if entry['status'] == 'passed')
    print(json.dumps({'case': 'pages', 'passed': passed, 'total': len(results), 'results': results},
                     ensure_ascii=False))
    if passed != len(results):
        fail(f'{len(results) - passed} of {len(results)} page captures failed')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
