#!/usr/bin/env python3
"""Run UI behavior baselines on a leased Simulator; see README.md.

    pnpm verify:simulator --name 'app-launch' -- zsh -euc '
      pnpm verify:ui --app "$(pnpm --silent verify:build)" --case app-launch --batch launch
    '

A case is one resettable Debug scene driven through `xcrun simctl` only. Evidence
is not optional: a case declares the screenshots it must produce, and a case with
missing evidence, a missing recording, or a timeout fails - no green without
proof. Failures carry the reason (what the screen showed, what the process
printed), never just an exit code.

Every run writes a new directory under `ui/results/<run-id>/`. A finished round is
never rewritten: re-running creates a new run id, and `--run-id` refuses an
existing directory.
"""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
VERIFICATION = HERE.parent
ROOT = HERE.parents[3]
CASES_DIR = HERE / 'cases'
RESULTS = HERE / 'results'
DEFAULT_PORT = 8097
BUNDLE_ID = 'ai.memoh.ios'
APPEARANCES = ('light', 'dark')

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(VERIFICATION))
import fixture as fixture_orchestrator  # noqa: E402
import metro as metro_orchestrator  # noqa: E402
from driver import Driver, DriverError  # noqa: E402
from simulator import DEVICE_TYPES, SimulatorPool, run_with_simulator  # noqa: E402


@dataclass(frozen=True)
class Case:
    """One resettable Debug scene plus the evidence it owes."""

    name: str
    batch: str
    description: str
    script: Path
    screenshots: tuple = ()
    video: bool = True
    appearances: tuple = APPEARANCES
    timeout: int = 180
    scene: str = ''
    # 需要外部服务端才能跑。**不能进默认选择**——验收基线的定义就是"空手也能复现"。
    requires_live: bool = False
    # 需要本地那个固定数据服务端（verification/fixture/server.mjs）。它不要凭据、
    # 不要隧道、数据写死，所以**可以**进默认选择——和 launch/scenes 一样"空手能跑"。
    requires_fixture: bool = False

    def evidence(self):
        parts = [f'screenshot {name}' for name in self.screenshots]
        if self.video:
            parts.append('video')
        return ', '.join(parts) or 'none'


CASES = {
    'app-launch': Case(
        name='app-launch',
        batch='launch',
        description='冷启动到首屏，首屏上能读到预期文案',
        script=CASES_DIR / 'app-launch.py',
        screenshots=('launch',),
        scene='App 的真实首屏（冷启动，不注入任何 fixture）',
        timeout=180,
    ),
    'scenes': Case(
        name='scenes',
        batch='scenes',
        description='每个固定场景用真实组件渲染一张截图（不连服务端、不需要凭据）',
        script=CASES_DIR / 'scenes.py',
        # 这条 case 自己按场景 × 外观出图，所以不声明固定截图名；
        # 它的产物是 `<scene>-<appearance>.png` 一整套。
        screenshots=(),
        scene='固定帧序列回放：工具状态、思考分层、审批、失败、长会话、断连、附件',
        timeout=900,
    ),
    'pages': Case(
        name='pages',
        batch='pages',
        description='真实页面截图：首页、空态、设置页、对话页（连固定服务端，不需要凭据）',
        script=CASES_DIR / 'pages.py',
        screenshots=(),
        scene='真实页面 × 固定数据：走完整 store → HTTP → 页面链路',
        timeout=900,
        # 需要本地起一个固定服务端（verification/fixture/server.mjs）。
        requires_fixture=True,
    ),
    'chat-roundtrip': Case(
        name='chat-roundtrip',
        batch='live',
        description='连真实 Memoh 服务端跑完一轮对话：登录 → 会话 → 发送 → 收到流式回复',
        script=CASES_DIR / 'chat-roundtrip.py',
        # 每一步都留证据：首页、输入器、回复、稳定态。
        screenshots=('entered', 'composer', 'reply', 'settled'),
        scene='真实服务端往返（需要 pnpm dev:env 隧道 + 服务器上已配好 bot 与模型）',
        timeout=600,
        requires_live=True,
    ),
}
BATCHES = {
    'launch': ['app-launch'],
    'scenes': ['scenes'],
    'pages': ['pages'],
    'live': ['chat-roundtrip'],
}


class CaseFailure(RuntimeError):
    """A case failed for a reason worth printing as-is."""


# --- planning ---------------------------------------------------------------


def plan_cases(case_names=None, batch=None):
    """Resolve --case/--batch to Case objects, rejecting unknown names loudly."""
    if batch:
        if batch not in BATCHES:
            raise SystemExit(f'unknown batch {batch!r}; choose from {", ".join(sorted(BATCHES))}')
        names = list(BATCHES[batch])
    elif case_names:
        names = list(case_names)
    else:
        # 默认只跑不依赖外部服务的 case。要跑 live 的必须显式
        # `--batch live` 或 `--case <名字>`——验收基线是"空手能复现"，
        # 而依赖服务端的检查做不到这一点，混进来只会让基线变得不可信。
        names = [case.name for case in CASES.values() if not case.requires_live]
    unknown = [name for name in names if name not in CASES]
    if unknown:
        raise SystemExit(f'unknown case(s): {", ".join(unknown)}; run --list to see them')
    seen, ordered = set(), []
    for name in names:
        if name not in seen:
            seen.add(name)
            ordered.append(CASES[name])
    return ordered


def shard(cases, workers):
    """Deal cases round-robin so shards differ by at most one case."""
    if workers < 1:
        raise ValueError('workers must be at least 1')
    return [list(cases[index::workers]) for index in range(workers)]


def resolve_appearances(selection, cases):
    wanted = APPEARANCES if selection == 'both' else (selection,)
    return [appearance for appearance in wanted if any(appearance in case.appearances for case in cases)]


def new_run_id(label, now=None, commit=None):
    stamp = (now or datetime.now(timezone.utc)).strftime('%Y%m%d-%H%M%S')
    slug = re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-') or 'run'
    parts = [stamp, slug]
    if commit:
        parts.append(commit[:7])
    return '-'.join(parts)


def resolve_run_directory(run_id, root=RESULTS, explicit=False):
    """Fresh directory per run; a finished round is never written again."""
    directory = Path(root) / run_id
    if explicit:
        if directory.exists():
            raise SystemExit(
                f'{directory} already exists; an acceptance round is immutable - pick another --run-id'
            )
        return directory
    index = 2
    unique = directory
    while unique.exists():
        unique = directory.with_name(f'{directory.name}-{index}')
        index += 1
    return unique


def write_new(path, text):
    """Write a conclusion once; never rewrite an existing record."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(f'{path} already exists; finished rounds are not rewritten')
    path.write_text(text)
    return path


def git_commit():
    try:
        return subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None


def git_dirty():
    try:
        return bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True,
                                            stderr=subprocess.DEVNULL).strip())
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None


# --- evidence ---------------------------------------------------------------


def missing_evidence(case, directory):
    """Everything the case promised but did not produce."""
    directory = Path(directory)
    problems = []
    for name in case.screenshots:
        screenshot = directory / f'{name}.png'
        if not screenshot.exists() or screenshot.stat().st_size == 0:
            problems.append(f'declared screenshot {name!r} is missing or empty ({screenshot.name})')
    if case.video:
        video = directory / 'run.mp4'
        if not video.exists() or video.stat().st_size == 0:
            problems.append('the required recording was not captured (run.mp4)')
    return problems


def evidence_summary(case, directory):
    directory = Path(directory)
    summary = {}
    for name in case.screenshots:
        screenshot = directory / f'{name}.png'
        summary[name] = screenshot.stat().st_size if screenshot.exists() else 0
    video = directory / 'run.mp4'
    summary['video'] = video.stat().st_size if video.exists() else 0
    return summary


def last_reason(log_path):
    """The line a case script printed to explain itself, not the whole log."""
    text = Path(log_path).read_text(errors='replace') if Path(log_path).exists() else ''
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith('FAILED:'):
            return line.removeprefix('FAILED:').strip()
    return lines[-1][-400:] if lines else 'no output'


# --- execution --------------------------------------------------------------


@dataclass
class Context:
    """What a case needs from the run: one leased device, one app, one Metro."""

    udid: str
    app: Path
    bundle_id: str = BUNDLE_ID
    language: str = 'en'
    metro_port: int = DEFAULT_PORT

    def driver_for(self, directory, appearance):
        driver = Driver(
            self.udid,
            directory,
            bundle_id=self.bundle_id,
            language=self.language,
            app=self.app,
        )
        driver.set_appearance(appearance)
        return driver


def run_case_script(case, directory, context, appearance=None):
    command = [
        sys.executable,
        str(case.script),
        '--udid', context.udid,
        '--app', str(context.app),
        '--output', str(directory),
        '--bundle-id', context.bundle_id,
        '--language', context.language,
        '--metro-port', str(context.metro_port),
    ]
    # 把本轮分配的外观告诉 case。
    #
    # 编排器本身按外观循环（`execute_run` 里 `for appearance in appearances`），
    # 所以 case **只应该跑这一个外观**。之前没传这个参数，于是像 `scenes`/`pages`
    # 这种「自己也会遍历两种外观」的 case 每次都被跑两遍——同一份工作做了两次，
    # 而且两个分片并行时会同时抢模拟器，表现为 `simctl launch timed out`。
    if appearance is not None:
        command.extend(['--appearance', appearance])
    environment = {
        **os.environ,
        'MEMOH_UI_UDID': context.udid,
        'MEMOH_UI_APP': str(context.app),
        'MEMOH_UI_BUNDLE_ID': context.bundle_id,
        'MEMOH_UI_LANGUAGE': context.language,
        'MEMOH_UI_METRO_PORT': str(context.metro_port),
        'MEMOH_UI_APPEARANCE': appearance or '',
        'PYTHONPATH': os.pathsep.join([str(HERE), os.environ.get('PYTHONPATH', '')]).strip(os.pathsep),
    }
    log_path = Path(directory) / 'check.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('w') as log:
        completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=environment,
                                   timeout=case.timeout)
    if completed.returncode != 0:
        raise CaseFailure(f'case exited {completed.returncode}: {last_reason(log_path)}')


def capture_failure(driver, directory, notes):
    """Best-effort failure evidence; a broken diagnostic must not hide the cause."""
    directory = Path(directory)
    try:
        driver.capture('failure')
    except Exception as error:
        notes['captureError'] = str(error)
    try:
        driver.app_log(directory / 'native.log', minutes=3)
    except Exception as error:
        notes['logError'] = str(error)


def execute_case(case, appearance, directory, context):
    """Everything around the case script: reset, record, diagnose on failure."""
    directory = Path(directory)
    driver = context.driver_for(directory, appearance)
    recording = None
    error = None
    try:
        if case.video:
            recording = driver.record_start(directory / 'run.mp4')
        run_case_script(case, directory, context, appearance)
    except BaseException as raised:  # includes TimeoutExpired from the script
        error = raised
        capture_failure(driver, directory, {})
    finally:
        try:
            driver.record_stop(recording, directory / 'run.mp4')
        except DriverError as stop_error:
            if error is None:
                raise
            print(f'note: {stop_error}', file=sys.stderr)
    if error is not None:
        raise error


def run_case(case, appearance, directory, context, execute=execute_case):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = {
        'case': case.name,
        'appearance': appearance,
        'scene': case.scene,
        'declaredEvidence': case.evidence(),
        'status': 'failed',
    }
    try:
        execute(case, appearance, directory, context)
    except subprocess.TimeoutExpired:
        result['reason'] = f'the case exceeded its {case.timeout}s budget'
    except CaseFailure as failure:
        result['reason'] = str(failure)
    except Exception as failure:  # a broken harness is a failed case, with a reason
        result['reason'] = f'{type(failure).__name__}: {failure}'
    else:
        problems = missing_evidence(case, directory)
        if problems:
            result['reason'] = '; '.join(problems)
        else:
            result['status'] = 'passed'
    result['seconds'] = round(time.monotonic() - started, 2)
    result['evidence'] = evidence_summary(case, directory)
    write_new(directory / 'result.json', json.dumps(result, indent=2))
    return result


def summarize(run_id, results, metadata=None):
    payload = {
        'runId': run_id,
        'finished': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'total': len(results),
        'passed': sum(1 for result in results if result['status'] == 'passed'),
        'failed': sum(1 for result in results if result['status'] != 'passed'),
        'status': 'passed' if results and all(r['status'] == 'passed' for r in results) else 'failed',
        'results': [
            {
                'case': result['case'],
                'appearance': result.get('appearance'),
                'status': result['status'],
                'seconds': result.get('seconds'),
                'reason': result.get('reason'),
                'evidence': result.get('evidence', {}),
            }
            for result in results
        ],
    }
    if metadata:
        payload['environment'] = metadata
    return payload


def environment_metadata(arguments, context=None, cases=(), appearances=(), shards=()):
    """Everything needed to reproduce a round - and no secret anywhere."""
    return {
        'node': _command_version(['node', '--version']),
        'xcode': _command_version(['xcodebuild', '-version']),
        'python': sys.version.split()[0],
        'app': str(arguments.app) if arguments.app else None,
        'udid': getattr(context, 'udid', None) or arguments.udid,
        'metroPort': arguments.port,
        'sharedMetro': arguments.shared_metro,
        'language': arguments.language,
        'appearance': arguments.appearance,
        'cases': [case.name for case in cases],
        'appearancesRun': list(appearances),
        'shards': [case.name for shard_cases in shards for case in shard_cases],
        'baseCommit': git_commit(),
        'worktreeDirty': git_dirty(),
        'bundleId': arguments.bundle_id,
    }


def _command_version(command):
    try:
        output = subprocess.run(command, capture_output=True, text=True, timeout=60)
        return output.stdout.strip().splitlines()[0] if output.stdout.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def execute_run(cases, directory, arguments, context):
    """Install once, then run every appearance of every selected case."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    appearances = resolve_appearances(arguments.appearance, cases)
    write_new(
        directory / 'environment.json',
        json.dumps(environment_metadata(arguments, context, cases, appearances), indent=2),
    )
    driver = Driver(context.udid, directory, bundle_id=context.bundle_id, language=context.language,
                    app=context.app)
    driver.set_content_size('large')
    driver.install(context.app)
    results = []
    live = directory / 'results.json'
    for appearance in appearances:
        for case in cases:
            case_directory = directory / f'{case.name}-{appearance}'
            print(f'--- {case.name} [{appearance}]', file=sys.stderr, flush=True)
            result = run_case(case, appearance, case_directory, context)
            results.append(result)
            live.write_text(json.dumps(results, indent=2))
            print(json.dumps(result), flush=True)
    return results


def lease_name(arguments, cases):
    if arguments.case:
        return cases[0].name.replace('-', ' ').title() if cases else 'UI'
    if arguments.batch:
        return f'UI {arguments.batch.title()}'
    return 'UI'


def worker_command(arguments, run_id, worker, cases):
    return [
        sys.executable,
        str(Path(__file__).resolve()),
        '--app', str(arguments.app),
        '--port', str(arguments.port),
        '--language', arguments.language,
        '--appearance', arguments.appearance,
        '--run-id', run_id,
        '--worker', worker,
        '--shared-metro',
        '--bundle-id', arguments.bundle_id,
        *[flag for case in cases for flag in ('--case', case.name)],
    ]


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--app', type=Path, help='Debug Simulator .app built by pnpm verify:build')
    parser.add_argument('--case', action='append', help='Run one case; repeatable')
    parser.add_argument('--batch', choices=sorted(BATCHES), help='Run one batch of cases')
    parser.add_argument('--list', action='store_true', help='List cases and exit')
    parser.add_argument('--dry-run', action='store_true', help='Print the plan without touching a device')
    parser.add_argument('--parallel', type=int, default=1, metavar='N',
                        help='Run the selected cases on N Simulators sharing this run\'s Metro')
    parser.add_argument('--udid', default=os.environ.get('MEMOH_VERIFY_UDID') or None,
                        help='Existing Simulator; omit to lease one (MEMOH_VERIFY_UDID is read too)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='Metro port for this run')
    parser.add_argument('--language', choices=['en', 'zh-Hans'], default='en')
    parser.add_argument('--appearance', choices=['light', 'dark', 'both'], default='both')
    parser.add_argument('--bundle-id', default=os.environ.get('MEMOH_UI_BUNDLE_ID', BUNDLE_ID))
    parser.add_argument('--run-id', help='Use an explicit run id; refuses an existing directory')
    parser.add_argument('--worker', help=argparse.SUPPRESS)
    parser.add_argument('--shared-metro', action='store_true', help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    if arguments.list:
        for case in CASES.values():
            print(f'{case.name}\t{case.batch}\t{case.evidence()}\t{case.timeout}s\t{case.description}')
        return 0
    cases = plan_cases(arguments.case, arguments.batch)
    if arguments.dry_run:
        print(json.dumps({
            'cases': [case.name for case in cases],
            'batches': {case.name: case.batch for case in cases},
            'evidence': {case.name: case.evidence() for case in cases},
            'appearances': resolve_appearances(arguments.appearance, cases),
            'parallel': arguments.parallel,
        }, indent=2))
        return 0
    if arguments.app is None:
        raise SystemExit('--app is required: pass the path built by pnpm verify:build')
    arguments.app = Path(arguments.app).expanduser().resolve()
    if arguments.parallel > 1 and (arguments.udid or arguments.shared_metro):
        raise SystemExit('--parallel leases one Simulator per worker; drop --udid and --shared-metro')

    if arguments.parallel > 1:
        run_id = arguments.run_id or new_run_id('parallel', commit=git_commit())
        directory = resolve_run_directory(run_id, explicit=bool(arguments.run_id))
        directory.mkdir(parents=True, exist_ok=True)
        shards = [shard_cases for shard_cases in shard(cases, arguments.parallel) if shard_cases]
        commands = {
            f'worker-{index + 1}': worker_command(arguments, directory.name, f'worker-{index + 1}', shard_cases)
            for index, shard_cases in enumerate(shards)
        }
        with metro_orchestrator.managed_metro(ROOT, arguments.port, directory):
            exit_code, worker_cases, worker_runs = metro_orchestrator.run_workers(commands, directory)
        metadata = environment_metadata(arguments, None, cases, resolve_appearances(arguments.appearance, cases), shards)
        metadata['workers'] = worker_runs
        write_new(directory / 'environment.json', json.dumps(metadata, indent=2))
        write_new(directory / 'results.json', json.dumps(worker_cases, indent=2))
        write_new(directory / 'summary.json', json.dumps(summarize(directory.name, worker_cases, metadata), indent=2))
        (directory / 'COMPLETE').write_text(datetime.now(timezone.utc).isoformat(timespec='seconds') + '\n')
        return exit_code

    if arguments.udid is None:
        # One run, one leased device: the lease owns boot/shutdown, we own the run.
        command = [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]
        name = lease_name(arguments, cases)
        return run_with_simulator(
            SimulatorPool(device_type=DEVICE_TYPES['iphone']), name, command,
        )

    if arguments.worker:
        if not arguments.run_id:
            raise SystemExit('--worker requires --run-id')
        run_directory = RESULTS / arguments.run_id / arguments.worker
        run_directory.mkdir(parents=True, exist_ok=True)
    else:
        run_id = arguments.run_id or new_run_id(lease_name(arguments, cases), commit=git_commit())
        run_directory = resolve_run_directory(run_id, explicit=bool(arguments.run_id))
        run_directory.mkdir(parents=True, exist_ok=True)

    context = Context(
        udid=arguments.udid,
        app=arguments.app,
        bundle_id=arguments.bundle_id,
        language=arguments.language,
        metro_port=arguments.port,
    )
    metro_context = (
        _null_context() if arguments.shared_metro
        else metro_orchestrator.managed_metro(ROOT, arguments.port, run_directory)
    )
    # 固定数据服务端按需启动：只有选中的 case 需要它时才起进程。
    fixture_context = (
        fixture_orchestrator.managed_fixture(log_directory=run_directory)
        if fixture_orchestrator.needs_fixture(cases)
        else _null_context()
    )
    try:
        with metro_context, fixture_context:
            results = execute_run(cases, run_directory, arguments, context)
    except DriverError as error:
        raise SystemExit(str(error))
    finally:
        try:
            driver = Driver(arguments.udid, run_directory, bundle_id=arguments.bundle_id, app=arguments.app)
            driver.terminate()
        except Exception as error:  # a tidy exit must not replace the real result
            print(f'note: could not terminate the app: {error}', file=sys.stderr)
    if arguments.worker:
        # The parent merges worker results; a worker only reports its own.
        write_new(run_directory / 'worker.json', json.dumps({'worker': arguments.worker, 'cases': results}, indent=2))
    else:
        metadata = environment_metadata(arguments, context, cases, resolve_appearances(arguments.appearance, cases))
        write_new(run_directory / 'summary.json', json.dumps(summarize(run_directory.name, results, metadata), indent=2))
        (run_directory / 'COMPLETE').write_text(
            datetime.now(timezone.utc).isoformat(timespec='seconds') + '\n'
        )
    for result in results:
        if result['status'] != 'passed':
            print(f'{result["case"]} [{result["appearance"]}]: {result.get("reason", "failed")}', file=sys.stderr)
    return 1 if any(result['status'] != 'passed' for result in results) else 0


def _null_context():
    from contextlib import nullcontext

    return nullcontext()


if __name__ == '__main__':
    sys.exit(main())
