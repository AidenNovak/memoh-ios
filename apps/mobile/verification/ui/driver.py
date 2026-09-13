"""Simulator primitives for UI cases, built on `xcrun simctl` only.

Every call names an explicit device: no case may fall back to "booted". Evidence
comes in two shapes and they are not interchangeable - a screenshot proves a
visual state, a recording proves timing. Text assertions read the screenshot
(`textdump.swift`, Vision) so a case can say "the user can read this" without
introducing Appium / Detox / AXe.
"""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent
VERIFICATION = HERE.parent
ARTIFACTS = VERIFICATION / '.artifacts'
TEXTDUMP_SOURCE = HERE / 'textdump.swift'
TEXTDUMP_BINARY = ARTIFACTS / 'textdump'
RECORDING_START_TIMEOUT = 20
BUNDLE_ID = 'ai.memoh.ios'


class DriverError(RuntimeError):
    pass


def simctl_binary():
    return ['xcrun', 'simctl']


def compile_textdump(source=TEXTDUMP_SOURCE, binary=TEXTDUMP_BINARY, run=subprocess.run):
    """Compile the OCR helper once per checkout; it is a host macOS binary."""
    source, binary = Path(source), Path(binary)
    if binary.exists() and binary.stat().st_mtime >= source.stat().st_mtime:
        return binary
    binary.parent.mkdir(parents=True, exist_ok=True)
    run(['xcrun', 'swiftc', '-O', str(source), '-o', str(binary)], check=True, timeout=300)
    return binary


def parse_textdump(output):
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as error:
        raise DriverError(f'textdump printed no JSON: {error}') from error
    return payload


class Driver:
    def __init__(self, udid, output, bundle_id=BUNDLE_ID, language='en', app=None):
        self.udid = udid
        self.bundle_id = bundle_id
        self.language = language
        self.app = Path(app) if app else None
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)

    # -- simctl --------------------------------------------------------------

    def simctl(self, *command, check=True, timeout=120):
        """simctl, with its failures translated into reasons a reader can act on."""
        try:
            return subprocess.run(
                [*simctl_binary(), *command], check=check, capture_output=True, text=True, timeout=timeout
            )
        except subprocess.CalledProcessError as error:
            detail = ((error.stderr or '') + (error.stdout or '')).strip().splitlines()
            reason = detail[-1] if detail else f'exit {error.returncode}'
            raise DriverError(f'simctl {command[0]} failed: {reason}') from error
        except subprocess.TimeoutExpired as error:
            raise DriverError(f'simctl {command[0]} timed out after {timeout}s') from error

    def install(self, app=None):
        app = Path(app or self.app)
        if not app.exists():
            raise DriverError(f'{app} does not exist; build it with pnpm verify:build')
        self.simctl('install', self.udid, str(app), timeout=300)

    def terminate(self):
        self.simctl('terminate', self.udid, self.bundle_id, check=False)

    def launch(self, arguments=(), extra=None):
        """Cold launch; returns the PID the Simulator reports for the process."""
        command = ['launch', self.udid, self.bundle_id, *arguments]
        result = self.simctl(*command, timeout=120)
        report = result.stdout.strip()
        if ':' not in report:
            raise DriverError(f'unexpected launch report: {report!r}')
        return int(report.rsplit(':', 1)[1].strip())

    def running_pid(self):
        """The app's PID from launchctl; None when it is not running."""
        listing = self.simctl('spawn', self.udid, 'launchctl', 'list', check=False).stdout.splitlines()
        marker = f'UIKitApplication:{self.bundle_id}['
        for line in listing:
            if marker in line:
                return int(line.split()[0])
        return None

    def container(self, kind='data'):
        return Path(self.simctl('get_app_container', self.udid, self.bundle_id, kind).stdout.strip())

    def set_appearance(self, appearance):
        self.simctl('ui', self.udid, 'appearance', appearance)

    def set_content_size(self, size='large'):
        self.simctl('ui', self.udid, 'content_size', size)

    def app_log(self, path, minutes=3, process=None):
        """Recent device log for the app; the only place crash reasons show up."""
        predicate = f'process == "{process or self.bundle_id}"'
        result = self.simctl(
            'spawn', self.udid, 'log', 'show', '--last', f'{minutes}m', '--style', 'compact',
            '--predicate', predicate, check=False, timeout=120,
        )
        Path(path).write_text(result.stdout + result.stderr)
        return Path(path)

    # -- evidence ------------------------------------------------------------

    def screenshot(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.simctl('io', self.udid, 'screenshot', str(path), timeout=60)
        if not path.exists() or path.stat().st_size == 0:
            raise DriverError(f'screenshot was not written: {path}')
        return path

    def read_text(self, screenshot):
        """Text visible in a screenshot, via the compiled Vision helper."""
        binary = compile_textdump()
        result = subprocess.run([str(binary), str(screenshot)], capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise DriverError(f'textdump failed: {result.stderr.strip() or result.returncode}')
        return parse_textdump(result.stdout)

    def capture(self, name):
        """Named evidence: <name>.png plus <name>.txt (the text on screen)."""
        screenshot = self.screenshot(self.output / f'{name}.png')
        payload = self.read_text(screenshot)
        (self.output / f'{name}.txt').write_text(payload['text'])
        return payload

    def record_start(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        process = subprocess.Popen(
            [*simctl_binary(), 'io', self.udid, 'recordVideo', '--codec=hevc', '--force', str(path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + RECORDING_START_TIMEOUT

        def abandon(reason):
            """Never leave a half-started recorder behind."""
            process.kill()
            process.wait()
            raise DriverError(reason)

        while time.monotonic() < deadline:
            if select.select([process.stderr], [], [], 0.5)[0]:
                line = process.stderr.readline()
                if b'Recording started' in line:
                    return process
                if not line:
                    abandon('the video recorder exited before its first frame')
        abandon(f'the video recorder did not start within {RECORDING_START_TIMEOUT}s')

    def record_stop(self, process, path):
        """Stop a recording and refuse to call a zero-frame file evidence."""
        path = Path(path)
        if process is None:
            return
        try:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        finally:
            process.stderr.close()
        if not path.exists() or path.stat().st_size == 0:
            raise DriverError(f'required video was not captured: {path}')

    # -- waiting -------------------------------------------------------------

    def wait_for_text(self, expected, timeout=90, interval=2.0, capture_name=None):
        """Poll the screen until one of `expected` is readable; returns (text, found).

        Raises with the last screen's text so the failure says what was on screen
        instead of only that something timed out.
        """
        deadline = time.monotonic() + timeout
        last = ''
        while True:
            screenshot = self.screenshot(self.output / '.wait.png')
            payload = self.read_text(screenshot)
            last = payload['text']
            for candidate in expected:
                if candidate and candidate.casefold() in last.casefold():
                    if capture_name:
                        (self.output / f'{capture_name}.txt').write_text(last)
                    return last, candidate
            if time.monotonic() >= deadline:
                raise DriverError(
                    f'none of {list(expected)} appeared within {timeout}s; screen showed: {last!r}'
                )
            time.sleep(interval)


def default_bundle_id():
    return os.environ.get('MEMOH_UI_BUNDLE_ID', BUNDLE_ID)
