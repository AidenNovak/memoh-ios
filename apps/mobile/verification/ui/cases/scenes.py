#!/usr/bin/env python3
"""Case `scenes`: 每个固定场景都用真实组件渲染出来，留一张截图。

这条 case 回答的问题是："这些状态的界面，现在长什么样？"

它**不连服务端、不需要登录**（场景数据是本地帧回放），所以它是整套验收里最快、
最稳的一条——也是设计迭代时最常跑的一条。设计改动看这里，而不是每次都去连真
服务端跑一轮：真服务端的回复每次都不同，没法比较"改之前和改之后"。

对每个场景 × 每种外观（light / dark）：

  1. 改 App 沙箱里的验收种子（`scene` 字段）切到该场景；
     **不用 deep link**——`simctl openurl` 在 iOS 26 会弹系统确认框，模拟器点不了它；
  2. 等场景标题出现在屏幕上——用屏幕上的文字确认**确实是这个场景**，
     而不是"截图命令没报错所以大概对"；
  3. 等回放跑完（进度文案从 `frame i/n` 变成 `replayed n/n`），
     确认抓到的是终态而不是中间帧；
  4. 截图。

一个场景失败不会中断其他场景：全部跑完再一起报，这样一轮就能看到所有问题。

由 run.py 启动：

    python3 ui/cases/scenes.py --udid <udid> --app <path.app> --output <dir>
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from driver import Driver, DriverError  # noqa: E402

ROOT = HERE.parents[4]
SCENES = ROOT / 'apps/mobile/src/features/verify/scenes.ts'

APPEARANCES = ('light', 'dark')


def fail(message):
    print(f'FAILED: {message}', file=sys.stderr, flush=True)
    raise SystemExit(1)


def scene_ids():
    """从 scenes.ts 里读场景 id 与标题。

    刻意从源文件读而不是在这里再列一遍：列两遍就会漂移，而漂移的场景清单意味着
    "新加了场景但没人截图"——那正是这条 case 要防的事。

    解析只认 SCENES 数组**顶层**的条目（缩进两个空格的 `{`）。帧里的 `id:`、
    `approval_id:` 这些都在更深一层，不会被当成场景——否则场景清单会混进一堆
    `scene-approval-1` 之类的假条目。
    """
    text = SCENES.read_text(encoding='utf-8') if SCENES.exists() else ''
    marker = 'export const SCENES'
    if marker not in text:
        fail(f'{SCENES} has no SCENES export; the scene case cannot find its list')
    body = text.split(marker, 1)[1]

    found = []
    for chunk in re.split(r'\n  \{', body)[1:]:
        scene_id = re.search(r"\bid:\s*'([^']+)'", chunk)
        title = re.search(r"\btitle:\s*'([^']+)'", chunk)
        if scene_id is None or title is None:
            continue
        found.append((scene_id.group(1), title.group(1)))
    if not found:
        fail(f'no scenes found in {SCENES}')
    return found


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


def write_seed(driver, scene_id):
    """把验收种子写进 App 沙箱。

    两个用途合一：启动时告诉 App"进场景模式"，之后**再写同一份文件**就是"切到这个
    场景"——App 轮询它（见 `src/features/verify/seed.ts` 的 `watchVerifyScene`）。

    刻意不写 username / password：场景模式本来就不该登录，种子里没有凭据时如果 App
    还去连服务端，这条 case 会立刻挂——约束就这样被钉住了。
    """
    documents = driver.container('data') / 'Documents'
    documents.mkdir(parents=True, exist_ok=True)
    payload = {
        'baseUrl': 'http://scene.invalid',
        'username': '',
        'password': '',
        'scenario': 'scene',
        'scene': scene_id,
    }
    target = documents / 'memoh-verify-seed.json'
    # 先写临时文件再原子替换：App 每 600ms 读一次，直接覆写可能让它读到半截 JSON。
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload), encoding='utf-8')
    temporary.replace(target)


def clear_seed(driver):
    seed = driver.container('data') / 'Documents' / 'memoh-verify-seed.json'
    if seed.exists():
        seed.unlink()


def wait_for_settled(driver, scene_id, timeout=45.0, interval=1.0):
    """等回放跑完。

    判定依据是屏幕上的进度文案。等终态而不是等固定秒数：固定 sleep 要么白等，
    要么在慢机器上抓到中间帧——而中间帧的截图会让人误以为界面漏了内容。

    同时要求场景 id 仍在屏幕上：切场景时上一个场景的画面会残留一瞬间，
    只看 `replayed` 有可能把上一个场景的终态当成这一个的。
    """
    deadline = time.time() + timeout
    last = ''
    while time.time() < deadline:
        shot = driver.output / 'settle-probe.png'
        driver.screenshot(shot)
        last = driver.read_text(shot).get('text', '')
        if 'replayed' in last and f'#{scene_id}' in last:
            return True
        time.sleep(interval)
    print(f'  (settle timeout; last text: {last[:200]!r})', flush=True)
    return False


def capture_scene(driver, scene_id, appearance, results):
    # 切场景靠改种子文件，不靠 deep link：`simctl openurl` 在 iOS 26 上会弹
    # "Open in Memoh?" 的系统确认框，而模拟器点不了它（截图会被弹窗污染）。
    write_seed(driver, scene_id)

    name = f'{scene_id}-{appearance}'
    path = driver.output / f'{name}.png'

    # 先等场景 id 出现，确认切到了对的场景（页头上有 `#<id>`）。
    try:
        driver.wait_for_text([f'#{scene_id}'], timeout=30, interval=1.0)
    except DriverError as error:
        results.append({'scene': scene_id, 'appearance': appearance, 'status': 'failed', 'reason': str(error)})
        print(f'  FAIL {name}: {error}', flush=True)
        driver.screenshot(driver.output / f'{name}-FAILED.png')
        return

    settled = wait_for_settled(driver, scene_id)
    driver.screenshot(path)
    results.append(
        {
            'scene': scene_id,
            'appearance': appearance,
            'status': 'passed' if settled else 'unsettled',
            'screenshot': path.name,
            'bytes': path.stat().st_size,
        }
    )
    print(f'  {"ok" if settled else "UNSETTLED"} {name} ({path.stat().st_size} bytes)', flush=True)


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--udid', default=os.environ.get('MEMOH_UI_UDID'), required=False)
    parser.add_argument('--app', type=Path, default=os.environ.get('MEMOH_UI_APP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', 'ai.memoh.ios'))
    parser.add_argument('--language', default=os.environ.get('MEMOH_UI_LANGUAGE', 'en'))
    parser.add_argument('--metro-port', type=int, default=int(os.environ.get('MEMOH_UI_METRO_PORT', '8097')))
    parser.add_argument('--appearance', action='append', choices=APPEARANCES,
                        help='只跑指定外观，可重复。默认两种都跑。')
    parser.add_argument('--scene', action='append', help='只跑指定场景，可重复。默认全部。')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if not arguments.udid:
        fail('--udid or MEMOH_UI_UDID is required')

    scenes = scene_ids()
    if arguments.scene:
        wanted = set(arguments.scene)
        scenes = [entry for entry in scenes if entry[0] in wanted]
        if not scenes:
            fail(f'no matching scenes for {sorted(wanted)}')

    appearances = tuple(arguments.appearance) if arguments.appearance else APPEARANCES
    driver = Driver(arguments.udid, arguments.output, bundle_id=arguments.bundle_id,
                    language=arguments.language, app=arguments.app)
    if arguments.app is not None:
        driver.install()

    # 用第一个场景的种子上车；之后靠 deep link 切换，不必反复冷启动。
    write_seed(driver, scenes[0][0])
    driver.launch(launch_arguments(arguments.metro_port, arguments.language))

    results = []
    try:
        # 冷启动后先确认外壳起来了（否则后面的失败信息会很难读）。
        #
        # 两个可接受的首屏：场景页（种子直接送过去）或首页（种子没送到，靠下面的
        # deep link 进）。不要求"启动即场景页"——那会把验收绑死在 runner 的推送
        # 时机上，而 deep link 才是更接近真实的入口。
        driver.wait_for_text(['Sessions', f'#{scenes[0][0]}'], timeout=90, interval=1.0)
        for appearance in appearances:
            # 外观在整组之前切一次：App 通过 useColorScheme 实时跟系统外观走，
            # 不需要重开。切换后给一帧时间生效，否则第一张会抓到上一个外观。
            driver.set_appearance(appearance)
            time.sleep(1.0)
            for scene_id, _title in scenes:
                capture_scene(driver, scene_id, appearance, results)
    except DriverError as error:
        fail(f'driver error: {error}')
    finally:
        clear_seed(driver)

    passed = sum(1 for entry in results if entry['status'] == 'passed')
    print(json.dumps({'case': 'scenes', 'passed': passed, 'total': len(results), 'results': results},
                     ensure_ascii=False))
    if passed != len(results):
        fail(f'{len(results) - passed} of {len(results)} scene captures did not settle')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
