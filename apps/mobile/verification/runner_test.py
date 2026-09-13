"""Unit tests for the UI runner: planning, evidence rules and result records.

They never boot a Simulator or start Metro: the device-facing callables are
injected, which is exactly the seam the runner is built around.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest import mock

MODULE_PATH = Path(__file__).with_name('ui') / 'run.py'
STUB_CASE = textwrap.dedent(
    """
    import argparse, os, sys
    from pathlib import Path

    parser = argparse.ArgumentParser()
    for flag in ['--udid', '--app', '--output', '--bundle-id', '--language', '--metro-port']:
        parser.add_argument(flag)
    arguments = parser.parse_args()
    output = Path(arguments.output)
    if os.environ.get('MEMOH_STUB_SLEEP'):
        import time; time.sleep(float(os.environ['MEMOH_STUB_SLEEP']))
    if os.environ.get('MEMOH_STUB_FAIL'):
        print('FAILED: the stub scene never became ready', file=sys.stderr)
        raise SystemExit(1)
    if not os.environ.get('MEMOH_STUB_NO_EVIDENCE'):
        output.mkdir(parents=True, exist_ok=True)
        (output / 'launch.png').write_bytes(b'png')
        (output / 'launch.txt').write_text('Memoh')
    print('port=' + str(arguments.metro_port) + ' language=' + str(arguments.language))
    """
)


def load_runner():
    spec = importlib.util.spec_from_file_location('memoh_verify_run', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeDriver:
    """The device seam: records what the runner asked for, writes no real media."""

    instances = []
    drop_video = False

    def __init__(self, udid, output, bundle_id=None, language=None, app=None):
        self.udid = udid
        self.output = Path(output)
        self.app = app
        self.appearances = []
        FakeDriver.instances.append(self)

    def set_appearance(self, appearance):
        self.appearances.append(appearance)

    def set_content_size(self, size='large'):
        self.content_size = size

    def install(self, app=None):
        self.installed = Path(app or self.app)

    def terminate(self):
        self.terminated = True

    def record_start(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b'video')
        return 'recorder'

    def record_stop(self, process, path):
        if FakeDriver.drop_video:
            Path(path).unlink(missing_ok=True)

    def capture(self, name):
        (self.output / f'{name}.png').write_bytes(b'png')
        (self.output / f'{name}.txt').write_text('screen')
        return {'text': 'screen'}

    def app_log(self, path, minutes=3):
        Path(path).write_text('device log')
        return Path(path)


@contextlib.contextmanager
def fake_runner(case=None):
    """Load the runner with the device seam replaced and a stub case installed."""
    runner = load_runner()
    runner.Driver = FakeDriver
    FakeDriver.instances = []
    FakeDriver.drop_video = False
    if case is not None:
        runner.CASES = {**runner.CASES, case.name: case}
        runner.BATCHES = {**runner.BATCHES, case.batch: [case.name]}
    yield runner


@contextlib.contextmanager
def quiet():
    """Swallow the runner's per-case JSON lines while a test inspects them."""
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        yield


def stub_case(runner, directory, name='stub', screenshots=('launch',), video=True, timeout=30):
    script = Path(directory) / f'{name}.py'
    script.write_text(STUB_CASE)
    return runner.Case(
        name=name,
        batch=name,
        description='stub',
        script=script,
        screenshots=screenshots,
        video=video,
        timeout=timeout,
    )


class RegistryTests(unittest.TestCase):
    def test_every_case_is_reachable_and_has_its_script(self):
        runner = load_runner()

        self.assertTrue(runner.CASES, 'the registry may not be empty')
        for case in runner.CASES.values():
            with self.subTest(case=case.name):
                self.assertTrue(case.script.is_file(), f'{case.script} is missing')
                self.assertTrue(case.screenshots or case.video, 'a case with no evidence is not a check')

    def test_batches_only_name_cases_that_exist(self):
        runner = load_runner()

        for batch, names in runner.BATCHES.items():
            with self.subTest(batch=batch):
                self.assertTrue(names, f'{batch} is empty')
                for name in names:
                    self.assertIn(name, runner.CASES)

    def test_every_case_is_in_exactly_one_batch(self):
        runner = load_runner()
        seen = [name for names in runner.BATCHES.values() for name in names]

        self.assertEqual(sorted(seen), sorted(runner.CASES))
        self.assertEqual(len(seen), len(set(seen)))


class PlanningTests(unittest.TestCase):
    def test_the_default_selection_is_every_case(self):
        runner = load_runner()

        self.assertEqual([case.name for case in runner.plan_cases()], list(runner.CASES))

    def test_a_batch_selects_its_cases_and_a_case_overrides_it(self):
        runner = load_runner()

        self.assertEqual(
            [case.name for case in runner.plan_cases(batch='launch')], runner.BATCHES['launch']
        )
        self.assertEqual([case.name for case in runner.plan_cases(['app-launch'])], ['app-launch'])

    def test_an_unknown_case_or_batch_is_a_usage_error(self):
        runner = load_runner()

        for kwargs in [{'case_names': ['nope']}, {'batch': 'nope'}]:
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(SystemExit):
                    runner.plan_cases(**kwargs)

    def test_repeated_cases_are_deduplicated(self):
        runner = load_runner()

        self.assertEqual(
            [case.name for case in runner.plan_cases(['app-launch', 'app-launch'])], ['app-launch']
        )

    def test_shards_are_balanced_and_keep_every_case(self):
        runner = load_runner()
        cases = runner.plan_cases()

        shards = runner.shard(cases, min(3, len(cases)))

        self.assertEqual(sorted(case.name for shard in shards for case in shard), [c.name for c in cases])
        sizes = [len(shard) for shard in shards]
        self.assertLessEqual(max(sizes) - min(sizes), 1)

    def test_appearances_follow_the_case_and_the_selection(self):
        runner = load_runner()
        cases = runner.plan_cases()

        self.assertEqual(runner.resolve_appearances('both', cases), ['light', 'dark'])
        self.assertEqual(runner.resolve_appearances('dark', cases), ['dark'])

    def test_a_case_is_only_looked_at_in_the_appearances_it_declares(self):
        runner = load_runner()
        dark_only = runner.Case(
            name='dark-only', batch='dark', description='', script=MODULE_PATH, appearances=('dark',)
        )

        self.assertEqual(runner.resolve_appearances('both', [dark_only]), ['dark'])
        self.assertEqual(runner.resolve_appearances('light', [dark_only]), [])


class RunIdentityTests(unittest.TestCase):
    def test_a_new_run_id_is_timestamped_and_slugged(self):
        import datetime

        run_id = load_runner().new_run_id(
            'UI Launch', now=datetime.datetime(2026, 9, 13, 10, 0, 0, tzinfo=datetime.timezone.utc), commit='abcdef1234'
        )

        self.assertEqual(run_id, '20260913-100000-ui-launch-abcdef1')

    def test_each_run_gets_its_own_directory(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as root:
            first = runner.resolve_run_directory('20260913-100000-ui', root=root)
            first.mkdir(parents=True)
            second = runner.resolve_run_directory('20260913-100000-ui', root=root)

            self.assertNotEqual(first, second)
            self.assertTrue(second.name.endswith('-2'))

    def test_an_explicit_run_id_refuses_to_reuse_a_finished_round(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / 'round-1').mkdir()

            with self.assertRaises(SystemExit) as caught:
                runner.resolve_run_directory('round-1', root=root, explicit=True)

            self.assertIn('immutable', str(caught.exception))

    def test_a_written_conclusion_is_not_rewritten(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as root:
            record = Path(root) / 'summary.json'
            runner.write_new(record, '{"status": "passed"}')

            with self.assertRaises(FileExistsError):
                runner.write_new(record, '{"status": "failed"}')

            self.assertEqual(record.read_text(), '{"status": "passed"}')


class EvidenceTests(unittest.TestCase):
    def case(self, screenshots=('launch',), video=True):
        return load_runner().Case(
            name='stub', batch='stub', description='', script=MODULE_PATH, screenshots=screenshots, video=video
        )

    def test_a_case_that_produced_its_evidence_is_satisfied(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'launch.png').write_bytes(b'png')
            (Path(directory) / 'run.mp4').write_bytes(b'video')

            self.assertEqual(load_runner().missing_evidence(self.case(), directory), [])

    def test_a_missing_screenshot_is_named_in_the_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'run.mp4').write_bytes(b'video')

            problems = load_runner().missing_evidence(self.case(), directory)

            self.assertEqual(len(problems), 1)
            self.assertIn("'launch'", problems[0])

    def test_an_empty_screenshot_is_not_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'launch.png').write_bytes(b'')
            (Path(directory) / 'run.mp4').write_bytes(b'video')

            self.assertIn('empty', load_runner().missing_evidence(self.case(), directory)[0])

    def test_a_zero_byte_recording_is_not_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'launch.png').write_bytes(b'png')
            (Path(directory) / 'run.mp4').write_bytes(b'')

            problems = load_runner().missing_evidence(self.case(), directory)

            self.assertEqual(len(problems), 1)
            self.assertIn('recording', problems[0])

    def test_a_visual_only_case_owes_no_recording(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'launch.png').write_bytes(b'png')

            self.assertEqual(load_runner().missing_evidence(self.case(video=False), directory), [])

    def test_the_failure_reason_prefers_the_cases_own_explanation(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'check.log'
            log.write_text('noise\nmore noise\nFAILED: the composer never appeared\n')

            self.assertEqual(load_runner().last_reason(log), 'the composer never appeared')

    def test_a_log_without_a_marker_still_yields_something_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'check.log'
            log.write_text('traceback line\nboom\n')

            self.assertEqual(load_runner().last_reason(log), 'boom')


class RunCaseTests(unittest.TestCase):
    def test_a_passing_case_records_its_evidence(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            directory = Path(root) / 'out'
            context = runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app'))

            with quiet():
                result = runner.run_case(case, 'light', directory, context)

            self.assertEqual(result['status'], 'passed')
            self.assertIsNone(result.get('reason'))
            self.assertEqual(result['appearance'], 'light')
            self.assertEqual(result['evidence']['launch'] > 0, True)
            self.assertTrue((directory / 'result.json').is_file())

    def test_a_case_that_fails_explains_itself(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            os.environ['MEMOH_STUB_FAIL'] = '1'
            try:
                with quiet():
                    result = runner.run_case(case, 'light', Path(root) / 'out',
                                             runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app')))
            finally:
                del os.environ['MEMOH_STUB_FAIL']

            self.assertEqual(result['status'], 'failed')
            self.assertIn('never became ready', result['reason'])
            self.assertIn('case exited 1', result['reason'])

    def test_a_case_that_produces_no_evidence_fails_even_when_it_exits_zero(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            os.environ['MEMOH_STUB_NO_EVIDENCE'] = '1'
            try:
                with quiet():
                    result = runner.run_case(case, 'light', Path(root) / 'out',
                                             runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app')))
            finally:
                del os.environ['MEMOH_STUB_NO_EVIDENCE']

            self.assertEqual(result['status'], 'failed')
            self.assertIn("declared screenshot 'launch'", result['reason'])

    def test_a_case_that_overruns_its_budget_fails_with_the_budget(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root, timeout=1)
            os.environ['MEMOH_STUB_SLEEP'] = '20'
            try:
                with quiet():
                    result = runner.run_case(case, 'light', Path(root) / 'out',
                                             runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app')))
            finally:
                del os.environ['MEMOH_STUB_SLEEP']

            self.assertEqual(result['status'], 'failed')
            self.assertIn('1s budget', result['reason'])

    def test_a_broken_harness_is_a_failed_case_not_a_crash(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)

            def exploding(case, appearance, directory, context):
                raise RuntimeError('simctl refused the device')

            with quiet():
                result = runner.run_case(case, 'light', Path(root) / 'out',
                                         runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app')),
                                         execute=exploding)

            self.assertEqual(result['status'], 'failed')
            self.assertIn('RuntimeError', result['reason'])
            self.assertIn('refused the device', result['reason'])

    def test_a_case_conclusion_is_written_once(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            directory = Path(root) / 'out'
            context = runner.Context(udid='FAKE', app=Path('/tmp/Memoh.app'))
            with quiet():
                runner.run_case(case, 'light', directory, context)
                with self.assertRaises(FileExistsError):
                    runner.run_case(case, 'light', directory, context)


class ExecuteRunTests(unittest.TestCase):
    def test_a_run_installs_once_and_covers_every_appearance(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            directory = Path(root) / 'run'
            arguments = runner.parse_arguments(['--app', str(MODULE_PATH), '--case', 'stub'])
            arguments.app = MODULE_PATH
            context = runner.Context(udid='FAKE', app=MODULE_PATH)

            with quiet():
                results = runner.execute_run([case], directory, arguments, context)

            self.assertEqual([result['appearance'] for result in results], ['light', 'dark'])
            self.assertTrue(all(result['status'] == 'passed' for result in results))
            self.assertEqual(
                len([entry for entry in FakeDriver.instances if getattr(entry, 'installed', None)]), 1
            )
            self.assertTrue((directory / 'environment.json').is_file())
            self.assertEqual(len(json.loads((directory / 'results.json').read_text())), 2)
            recorded = sorted(
                {appearance for entry in FakeDriver.instances for appearance in entry.appearances}
            )
            self.assertEqual(recorded, ['dark', 'light'])

    def test_the_case_receives_the_device_language_and_metro_port(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            arguments = runner.parse_arguments(['--app', str(MODULE_PATH), '--language', 'en', '--port', '8099'])
            context = runner.Context(udid='FAKE', app=MODULE_PATH, metro_port=8099)

            with quiet():
                runner.execute_run([case], Path(root) / 'run', arguments, context)

            log = (Path(root) / 'run' / 'stub-light' / 'check.log').read_text()
            self.assertIn('port=8099', log)
            self.assertIn('language=en', log)

    def test_a_missing_recording_fails_the_case(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            FakeDriver.drop_video = True
            case = stub_case(runner, root)
            arguments = runner.parse_arguments(['--app', str(MODULE_PATH)])
            context = runner.Context(udid='FAKE', app=MODULE_PATH)

            with quiet():
                results = runner.execute_run([case], Path(root) / 'run', arguments, context)

            self.assertTrue(all(result['status'] == 'failed' for result in results))
            self.assertIn('recording', results[0]['reason'])


class DriverTests(unittest.TestCase):
    """The device primitive layer: its failures must read like sentences."""

    def load_driver(self):
        spec = importlib.util.spec_from_file_location('memoh_verify_driver', MODULE_PATH.parent / 'driver.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_a_simctl_failure_becomes_a_readable_driver_error(self):
        driver_module = self.load_driver()

        def failing_run(command, **kwargs):
            raise subprocess.CalledProcessError(
                1,
                command,
                stderr='An error was encountered processing the command:\n'
                'The request was denied by service delegate.\n',
            )

        driver = driver_module.Driver('FAKE-UDID', Path(tempfile.mkdtemp()))
        with mock.patch.object(driver_module.subprocess, 'run', failing_run):
            with self.assertRaises(driver_module.DriverError) as caught:
                driver.simctl('launch', 'FAKE-UDID', 'ai.memoh.ios')

        self.assertIn('simctl launch failed', str(caught.exception))
        self.assertIn('denied by service delegate', str(caught.exception))

    def test_a_hung_simctl_is_reported_with_its_timeout(self):
        driver_module = self.load_driver()

        def hanging_run(command, **kwargs):
            raise subprocess.TimeoutExpired(command, kwargs.get('timeout'))

        driver = driver_module.Driver('FAKE-UDID', Path(tempfile.mkdtemp()))
        with mock.patch.object(driver_module.subprocess, 'run', hanging_run):
            with self.assertRaises(driver_module.DriverError) as caught:
                driver.simctl('bootstatus', 'FAKE-UDID', '-b')

        self.assertIn('timed out', str(caught.exception))

    def test_a_recorder_that_never_reports_a_frame_is_an_error(self):
        driver_module = self.load_driver()
        driver = driver_module.Driver('FAKE-UDID', Path(tempfile.mkdtemp()))
        read_end, write_end = os.pipe()
        os.close(write_end)  # the recorder died, so its stderr is at EOF

        class DyingRecorder:
            stderr = os.fdopen(read_end, 'rb')
            killed = False

            def kill(self):
                self.killed = True

            def wait(self):
                return 1

        recorder = DyingRecorder()
        try:
            with mock.patch.object(driver_module.subprocess, 'Popen', lambda *a, **k: recorder):
                with self.assertRaises(driver_module.DriverError) as caught:
                    driver.record_start(Path(tempfile.mkdtemp()) / 'run.mp4')

            self.assertIn('before its first frame', str(caught.exception))
            self.assertTrue(recorder.killed)
        finally:
            recorder.stderr.close()


class SummaryTests(unittest.TestCase):
    def test_the_summary_counts_and_decides(self):
        runner = load_runner()
        results = [
            {'case': 'a', 'appearance': 'light', 'status': 'passed', 'seconds': 1.0, 'evidence': {}},
            {'case': 'b', 'appearance': 'light', 'status': 'failed', 'seconds': 2.0,
             'reason': 'boom', 'evidence': {}},
        ]

        summary = runner.summarize('round-1', results)

        self.assertEqual((summary['total'], summary['passed'], summary['failed']), (2, 1, 1))
        self.assertEqual(summary['status'], 'failed')
        self.assertEqual(summary['results'][1]['reason'], 'boom')

    def test_a_run_with_no_results_is_not_a_pass(self):
        runner = load_runner()

        self.assertEqual(runner.summarize('round-1', [])['status'], 'failed')


class CommandLineTests(unittest.TestCase):
    def test_list_names_every_case_with_its_evidence(self):
        runner = load_runner()
        buffer = io.StringIO()

        with contextlib.redirect_stdout(buffer):
            code = runner.main(['--list'])

        self.assertEqual(code, 0)
        self.assertIn('app-launch', buffer.getvalue())
        self.assertIn('screenshot launch', buffer.getvalue())

    def test_a_dry_run_prints_the_plan_without_a_device(self):
        runner = load_runner()
        buffer = io.StringIO()

        with contextlib.redirect_stdout(buffer):
            code = runner.main(['--dry-run', '--case', 'app-launch', '--appearance', 'light'])

        plan = json.loads(buffer.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(plan['cases'], ['app-launch'])
        self.assertEqual(plan['appearances'], ['light'])

    def test_a_run_without_an_app_is_a_usage_error(self):
        runner = load_runner()

        with self.assertRaises(SystemExit) as caught:
            runner.main(['--case', 'app-launch'])

        self.assertIn('--app', str(caught.exception))

    def test_parallel_owns_its_devices(self):
        runner = load_runner()

        with self.assertRaises(SystemExit) as caught:
            runner.main(['--app', str(MODULE_PATH), '--parallel', '2', '--udid', 'SOME-DEVICE'])

        self.assertIn('--parallel', str(caught.exception))

    def test_the_environment_record_holds_no_secret(self):
        runner = load_runner()
        arguments = runner.parse_arguments(['--app', str(MODULE_PATH)])

        metadata = runner.environment_metadata(arguments, None, runner.plan_cases(), ['light'])

        self.assertEqual(metadata['app'], str(MODULE_PATH))
        self.assertIn('baseCommit', metadata)
        for value in metadata.values():
            self.assertNotIn('password', str(value).lower())

    def test_the_case_log_is_kept_and_summarised(self):
        with fake_runner() as runner, tempfile.TemporaryDirectory() as root:
            case = stub_case(runner, root)
            context = runner.Context(udid='FAKE', app=MODULE_PATH)
            os.environ['MEMOH_STUB_FAIL'] = '1'
            try:
                with self.assertRaises(runner.CaseFailure) as caught:
                    runner.run_case_script(case, Path(root) / 'out', context)
            finally:
                del os.environ['MEMOH_STUB_FAIL']

            self.assertIn('never became ready', str(caught.exception))
            self.assertIn('never became ready', (Path(root) / 'out' / 'check.log').read_text())


if __name__ == '__main__':
    unittest.main()
