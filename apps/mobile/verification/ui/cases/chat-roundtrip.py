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
sys.path.insert(0, str(HERE))
from driver import Driver, DriverError  # noqa: E402

SEED_NAME = 'memoh-verify-seed.json'
PROMPT = 'Say exactly: pong'
# 模型被明确要求回这两个字；OCR 认错一两个字母也不影响判定，只要出现它就算过。
EXPECTED = ('pong',)

from roundtrip_common import (  # noqa: E402 - 需要先把 cases 目录加进 sys.path
    fail,
    preflight,
    require_env,
    launch_arguments,
    write_seed,
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

    base_url, password = require_env()

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
        # 先清钥匙串：上一次跑 case 留下的凭据会跨安装存活。
        driver.reset_keychain()
        # 种子必须带上要发的那句话——`write_seed` 的公共部分只管登录与场景，
        # 场景自己的参数走 `extra`。（重构共用模块时漏过这一项，结果 case "通过"了
        # 前两步却永远等不到回复：它压根没发消息。）
        seed_path = write_seed(driver, base_url, password, extra={'message': PROMPT})

        driver.terminate()
        driver.launch(launch_arguments(arguments.metro_port, arguments.language))

        # 1) 证明已经登录进主界面。
        #
        #    注意：验收脚本（`src/features/verify/`）会在登录后**自动跳到对话页**，
        #    跳转可能发生在第一次轮询之前。所以这里接受"首页或对话页"任意一个，
        #    断言的是"过了登录页"这件事，而不是"停在首页"——后者依赖跳转的时机，
        #    是个会随机失败的断言。
        driver.wait_for_text(('Sessions', 'Message'), timeout=150)
        driver.capture('entered')

        # 2) 对话页。
        driver.wait_for_text(('Message',), timeout=90)
        driver.capture('composer')

        # 3) 自己那句话真的发出去了——屏幕上能看到它。
        #
        #    这一步是为了**把失败归因分清楚**：没有它的话，"消息根本没发出去"会表现成
        #    "等回复等到超时"，读日志的人会去查模型或服务端，而真正的问题是种子
        #    （真发生过：重构时漏传 message，case 白等三分钟）。
        prompt_head = PROMPT.split(':')[0]
        driver.wait_for_text((prompt_head,), timeout=60, capture_name='sent')

        # 4) 核心断言。
        driver.wait_for_text(EXPECTED, timeout=arguments.timeout)
        driver.capture('reply')

        # 5) 稳定态：run 结束后"停止"按钮消失。
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
