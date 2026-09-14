#!/usr/bin/env python3
"""Case `chat-info`：连真实服务端打开会话信息面板，验证显示的数字是真的。

## 它验证什么

这是**唯一**能证明"面板里的数字来自服务端"的 case。场景台（`scenes.py`）渲染的
是固定值——它能证明布局对，但证明不了 App 真的去取了 `/status`、也证明不了取值
路径对。所以这条归在 `live` 批次，默认不跑。

它断言两件事，都来自 `/status` 的真实响应形状（2026-09-14 实测）：

  1. 面板出现，且显示**服务端真实给**的字段：消息数、已用 token、缓存命中率；
  2. **不出现"上下文用量/百分比"那一行**——这台部署不返回 `context_window`，
     没有分母就不该有百分比。这是本 case 的核心断言：面板宁可少一行，
     也不能给一个编出来的分母。服务端哪天给了窗口，这条断言会失败一次，
     那时把它改成"必须有百分比"即可（失败的提示里写了怎么做）。

## 怎么驱动

`simctl` 没有点击能力，而面板是点标题才出现的。种子里的 `openSessionInfo` 让
对话页进来就调**产品里同一个** `openInfo`——真实 store 拉 `/status`、真实渲染，
省掉的只有"手指点标题"。

由 run.py 启动：

    python3 ui/cases/chat-info.py --udid <udid> --app <path.app> --output <dir>
"""
import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from driver import Driver, DriverError  # noqa: E402
from roundtrip_common import (  # noqa: E402
    common_arguments,
    fail,
    launch_arguments,
    preflight,
    require_env,
    write_seed,
)
# 面板标题与分组名（英文界面）。
PANEL = ('Session info',)
# 服务端真实给的字段，OCR 之后应该都能看到。
SERVER_FIELDS = ('Messages', 'Tokens used', 'Cache hit rate')


def format_token_count(value):
    """与产品里 `formatTokenCount` 同一口径（<1000 原样，否则 K/M 一位小数）。

    刻意在验收侧再写一遍而不是 import：验收要能**独立**判断界面显示得对不对；
    复用产品的实现会把同一个 bug 复制到断言里，两边一起错就查不出来了。
    """
    if value < 1000:
        return str(round(value))
    if value < 1_000_000:
        return f'{value / 1000:.1f}K'
    return f'{value / 1_000_000:.1f}M'


def api_login(base_url, password):
    """拿一个 admin token，用来核对屏幕上的数与本机直查服务端的结果是否一致。"""
    import urllib.request

    payload = json.dumps({'username': 'admin', 'password': password}).encode()
    request = urllib.request.Request(
        f'{base_url.rstrip("/")}/auth/login',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)['access_token']


def api_json(base_url, token, path):
    import urllib.request

    request = urllib.request.Request(
        f'{base_url.rstrip("/")}{path}', headers={'Authorization': f'Bearer {token}'}
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def pick_session_with_content(base_url, token):
    """挑一个**真的有内容**的会话。

    空会话的统计全是 0，而"显示 0"与"读不到所以显示 0"在屏幕上长得一样——
    用空会话断言等于没断言。挑有内容的会话，屏幕上的数字才可能出错得看得见。
    返回 (session_id, status)。
    """
    bots = api_json(base_url, token, '/bots')
    items = bots.get('items') or bots.get('bots') or []
    if not items:
        fail('服务端上没有 bot，无法验证会话信息面板')
    bot_id = items[0]['id']

    sessions = api_json(base_url, token, f'/bots/{bot_id}/sessions')
    best = None
    for candidate in (sessions.get('items') or [])[:20]:
        try:
            status = api_json(base_url, token, f'/bots/{bot_id}/sessions/{candidate["id"]}/status')
        except Exception:  # noqa: BLE001 - 单个会话取不到就跳过
            continue
        count = status.get('message_count') or 0
        if count > 0 and (best is None or count > best[1].get('message_count', 0)):
            best = (candidate['id'], status)
    if best is None:
        fail('服务端上找不到有消息的会话；先跑一次 chat-roundtrip 造点内容再来')
    return best


def value_after(text, label):
    """在屏幕文字里找 `label` 下面那一行的值。

    屏幕文字是逐行给的，标签与值各占一行（`Messages` / `4`）。找不到返回 None——
    调用方按"没读到"处理，而不是按空串。
    """
    lines = [line.strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if line == label:
            for following in lines[index + 1 :]:
                if following:
                    return following
    return None


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    common_arguments(parser)
    parser.add_argument('--timeout', type=float, default=180.0, help='等面板出现的秒数')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if not arguments.udid:
        fail('no Simulator: pass --udid or run this through pnpm verify:ui')

    base_url, password = require_env()

    # 先证明服务端活着，否则后面的失败会指向错误的方向。
    preflight(base_url)

    # 先直查服务端：挑一个有内容的会话，并记下它现在真实的统计。
    # 后面拿屏幕上的数跟这份**来自服务端**的数对照——这是这条 case 的核心，
    # 因为面板的整条价值就是"数字是真的"。
    token = api_login(base_url, password)
    session_id, expected = pick_session_with_content(base_url, token)
    usage = expected.get('context_usage') or {}
    cache = expected.get('cache_stats') or {}
    print(
        f'选定会话 {session_id}：消息数 {expected.get("message_count")}，'
        f'已用 {usage.get("used_tokens")} token，命中率 {cache.get("cache_hit_rate")}',
        flush=True,
    )

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
        driver.reset_keychain()
        seed_path = write_seed(
            driver,
            base_url,
            password,
            scenario='chat',
            extra={'openSessionInfo': True, 'sessionId': session_id},
        )

        driver.terminate()
        driver.launch(launch_arguments(arguments.metro_port, arguments.language))

        # 1) 过了登录页。
        driver.wait_for_text(('Sessions', 'Message'), timeout=150)

        # 2) 面板出现，**且里面的数到了**。
        #
        #    必须等数据、不能只等面板标题：`/status` 是异步的，标题先出现、数据后到。
        #    只断言标题的话这条 case 会在"面板还空着"的那一瞬间通过——而"空面板"
        #    本身就是个 bug（真发生过：loading 被写死成 false，面板弹出来是空的、
        #    也不解释为什么空）。所以这里等的是服务端字段，它出现才说明取值链路通了。
        text, _ = driver.wait_for_text(SERVER_FIELDS, timeout=arguments.timeout)
        lowered = text.casefold()

        # 3) 服务端给的字段**全都在**（上一步命中一个就算过，这里补齐其余）。
        missing = [field for field in SERVER_FIELDS if field.casefold() not in lowered]
        if missing:
            fail(f'面板里缺服务端真实字段 {missing}；屏幕上是：{text!r}')

        driver.capture('panel')

        # 4) 核心断言：没有窗口就不许出现"上下文用量"那一行（含百分比）。
        #
        #    字面是 "Context used"。命中率是 "Cache hit rate"，不含这个子串，
        #    所以不会误判。
        if 'context used' in lowered:
            fail(
                '出现了 "Context used" 一行，但**这台部署不返回 context_window**——'
                '那一行的百分比没有分母，是编出来的。要么是取值路径开始兜底编数，'
                '要么是服务端升级后真的给了窗口。前者要修；后者（服务端已给窗口）'
                '就把这条断言改成"必须有 Context used"，并在 docs/environment.md '
                f'里更新能力矩阵。屏幕上是：{text!r}'
            )

        # 5) 【核心】屏幕上的数 == 服务端直查的数。
        #
        #    这是"数字是真的"唯一的硬证据：面板可以渲染得很对却连错端点，
        #    也可以看起来很整齐却把 0 当成兜底。只对着屏幕断言证明不了这些。
        screen_messages = value_after(text, 'Messages')
        if screen_messages != str(expected.get('message_count')):
            fail(
                f'屏幕上的消息数 {screen_messages!r} 与服务端说的 '
                f'{expected.get("message_count")!r} 不一致；屏幕上是：{text!r}'
            )

        # 命中率：服务端给的是浮点百分数，界面四舍五入到整数（formatPercent）。
        expected_rate = cache.get('cache_hit_rate')
        if expected_rate is not None:
            screen_rate = value_after(text, 'Cache hit rate')
            if screen_rate != f'{round(expected_rate)}%':
                fail(
                    f'屏幕上的命中率 {screen_rate!r} 与服务端 {expected_rate!r}'
                    f'（四舍五入应为 {round(expected_rate)}%）不一致；屏幕上是：{text!r}'
                )

        # 已用 token 同理，按 K/M 口径比。
        expected_tokens = usage.get('used_tokens')
        if expected_tokens is not None:
            screen_tokens = value_after(text, 'Tokens used')
            if screen_tokens != format_token_count(expected_tokens):
                fail(
                    f'屏幕上的已用 token {screen_tokens!r} 与服务端 {expected_tokens!r}'
                    f'（应显示为 {format_token_count(expected_tokens)}）不一致；'
                    f'屏幕上是：{text!r}'
                )

        driver.capture('verified')
        print(json.dumps({'case': 'chat-info', 'baseUrl': base_url, 'panel': text[:400]}))
    except DriverError as error:
        fail(str(error))
    finally:
        # 种子里有密码，用完必须删。
        if seed_path is not None and seed_path.exists():
            seed_path.unlink()

    print('ok chat-info 屏幕上的数与服务端一致，且无窗口时不给百分比', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
