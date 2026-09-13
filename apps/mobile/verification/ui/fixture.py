#!/usr/bin/env python3
"""固定数据服务端的生命周期管理（给验收用）。

## 为什么单独一个模块

`run.py` 已经有一个管 Metro 的编排器（`metro.py`），做的是同一类事：起一个后台
进程、确认它真的能用了、跑完收掉。固定服务端是第二个这类东西，所以给它同样的形态
——`managed_fixture()` 上下文管理器——而不是在 `run.py` 里塞一堆 subprocess 细节。

## 和 Metro 的一个区别

Metro 必须在**所有 case 之前**起着，因为每个 case 都要它。固定服务端只有需要它的
case 才用（`Case.requires_fixture`）。所以这里按需启动：只有选中的 case 里存在
`requires_fixture` 时才起进程，否则完全不碰。
"""
import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
# HERE = apps/mobile/verification/ui → 上三级到仓库根。
ROOT = HERE.parents[3]
# 服务端脚本在 verification/fixture/（和这个编排器不同目录）：server.mjs 属于
# "固定数据"本身，而 fixture.py 属于"怎么把它挂进验收流程"，两者职责不同。
SERVER = HERE.parent / 'fixture' / 'server.mjs'

DEFAULT_PORT = 18099
STARTUP_TIMEOUT = 20.0


class FixtureError(RuntimeError):
    """固定服务端没能起来或没能响应。"""


def _probe(port):
    """服务端能响应吗。返回 True/False，不抛异常（探测失败是常态）。"""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/bots', timeout=2) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def set_scenario(port, scenario):
    """切固定服务端的场景。"""
    payload = json.dumps({'scenario': scenario}).encode()
    request = urllib.request.Request(
        f'http://127.0.0.1:{port}/__scenario',
        data=payload,
        headers={'content-type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read()


def wait_until_ready(port, timeout=STARTUP_TIMEOUT):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _probe(port):
            return True
        time.sleep(0.25)
    return False


@contextlib.contextmanager
def managed_fixture(port=DEFAULT_PORT, log_directory=None):
    """跑一段代码，期间固定服务端可用；结束后收掉。

    端口已经有人在服务（比如开发者自己开着一个）就直接复用，不去抢——那种情况下
    对方多半是故意的，抢过来会让他的调试会话莫名断掉。
    """
    if _probe(port):
        print(f'复用已在运行的固定服务端（127.0.0.1:{port}）', flush=True)
        yield port
        return

    if not SERVER.exists():
        raise FixtureError(f'找不到固定服务端脚本：{SERVER}')

    log_path = None
    if log_directory is not None:
        log_path = Path(log_directory) / 'fixture.log'
        log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(log_path, 'wb') if log_path is not None else subprocess.DEVNULL

    process = subprocess.Popen(
        ['node', str(SERVER), '--port', str(port)],
        stdout=log,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
    )
    try:
        if not wait_until_ready(port):
            tail = ''
            if log_path is not None and log_path.exists():
                tail = log_path.read_text(encoding='utf-8', errors='replace')[-800:]
            raise FixtureError(
                f'固定服务端在 {STARTUP_TIMEOUT}s 内没有就绪（127.0.0.1:{port}）。'
                + (f'\n日志尾部：\n{tail}' if tail else '')
            )
        yield port
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        if log_path is not None and log_path.exists() and log is not subprocess.DEVNULL:
            log.close()


def needs_fixture(cases):
    return any(getattr(case, 'requires_fixture', False) for case in cases)


if __name__ == '__main__':
    # 直接跑这个文件时：起一下、自检、收掉。用来确认它本身是好的。
    with managed_fixture() as active_port:
        print(f'固定服务端就绪：{active_port}')
        if not _probe(active_port):
            print('自检失败', file=sys.stderr)
            raise SystemExit(1)
    print('已收掉，自检通过')
