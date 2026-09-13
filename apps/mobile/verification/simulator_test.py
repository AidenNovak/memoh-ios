"""Unit tests for the Simulator lease; they never touch a real device."""
import contextlib
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name('simulator.py')
IPHONE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
IPAD = 'com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M2'
RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
OLD_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-25-0'


def load_simulator_module():
    """Load the module directly: the tests must run without pnpm or a package."""
    spec = importlib.util.spec_from_file_location('memoh_verify_simulator', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def device(udid, name, state='Shutdown', device_type=IPHONE, available=True):
    return {
        'udid': udid,
        'name': name,
        'state': state,
        'isAvailable': available,
        'deviceTypeIdentifier': device_type,
    }


def inventory(*devices, runtime=RUNTIME):
    return {'devices': {runtime: list(devices)}}


class FakeSimctl:
    """A `simctl` that keeps its devices in memory and records every call."""

    def __init__(self, devices, runtime=RUNTIME, fail_on=None):
        self.inventory = {'devices': {runtime: copy.deepcopy(list(devices))}}
        self.calls = []
        self.fail_on = fail_on

    def __call__(self, *command, check=True, timeout=120):
        self.calls.append((command, timeout))
        if command[0] == self.fail_on:
            raise subprocess.CalledProcessError(1, command)
        if command == ('list', 'devices', '--json'):
            return subprocess.CompletedProcess(command, 0, json.dumps(self.inventory), '')
        if command[0] == 'create':
            created = device('CREATED', command[1], device_type=command[2])
            self.inventory['devices'].setdefault(command[3], []).append(created)
            return subprocess.CompletedProcess(command, 0, 'CREATED\n', '')
        target = self.device(command[1])
        if command[0] == 'shutdown':
            if target['state'] == 'Shutdown':
                return subprocess.CompletedProcess(command, 149, '', 'Unable to shutdown device in state Shutdown')
            target['state'] = 'Shutdown'
        elif command[0] == 'rename':
            target['name'] = command[2]
        elif command[0] == 'boot':
            target['state'] = 'Booted'
        elif command[0] == 'bootstatus':
            if target['state'] == 'Shutdown':
                return subprocess.CompletedProcess(command, 1, '', 'device is shutdown')
        elif command[0] == 'delete':
            for devices in self.inventory['devices'].values():
                devices[:] = [entry for entry in devices if entry['udid'] != command[1]]
        return subprocess.CompletedProcess(command, 0, '', '')

    def device(self, udid):
        for devices in self.inventory['devices'].values():
            for entry in devices:
                if entry['udid'] == udid:
                    return entry
        raise AssertionError(f'no such device {udid}')

    def state_of(self, udid):
        return self.device(udid)['state']

    def name_of(self, udid):
        return self.device(udid)['name']

    def commands(self):
        return [command[0] for command, _ in self.calls]

    def boot_timeouts(self):
        return [timeout for command, timeout in self.calls if command[0] == 'bootstatus']


@contextlib.contextmanager
def pooled(devices, **kwargs):
    simulator = load_simulator_module()
    with tempfile.TemporaryDirectory() as locks:
        simctl = FakeSimctl(devices)
        pool = simulator.SimulatorPool(simctl=simctl, lock_directory=locks, **kwargs)
        yield simulator, simctl, pool, Path(locks)


def run_main(simulator, argv, pool):
    """Call the CLI with the pool injected; the real pool would boot a device."""
    original = simulator.SimulatorPool
    simulator.SimulatorPool = lambda **kwargs: pool
    try:
        return simulator.main(argv)
    finally:
        simulator.SimulatorPool = original


class ManagedNameTests(unittest.TestCase):
    def test_spellings_of_one_verification_share_one_device(self):
        simulator = load_simulator_module()

        self.assertEqual(simulator.managed_name('app-launch'), 'Memoh app launch Verify')
        self.assertEqual(simulator.managed_name('App Launch'), 'Memoh app launch Verify')
        self.assertEqual(simulator.managed_name('  UI  app-launch '), 'Memoh ui app launch Verify')
        self.assertEqual(simulator.slugify('App Launch'), simulator.slugify('app-launch'))

    def test_a_device_name_is_accepted_where_a_verification_name_is_expected(self):
        simulator = load_simulator_module()

        self.assertEqual(simulator.resolve_managed_name('Memoh app launch Verify'), 'Memoh app launch Verify')
        self.assertEqual(simulator.resolve_managed_name('app-launch'), 'Memoh app launch Verify')

    def test_unusable_names_are_rejected(self):
        simulator = load_simulator_module()

        for name in ['', '   ', 'a\nb', '---', 'x' * (simulator.MAX_NAME_LENGTH + 2)]:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    simulator.managed_name(name)


class ReusableDeviceTests(unittest.TestCase):
    def test_only_managed_devices_on_the_pinned_runtime_are_candidates(self):
        simulator = load_simulator_module()
        devices = inventory(
            device('MINE', 'Memoh app launch Verify'),
            device('PERSONAL', 'Truth Truth E2E iPhone'),
            device('OTHER-PROJECT', 'Lody Chat Verify'),
            device('IPAD', 'Memoh tablet Verify', device_type=IPAD),
            device('UNAVAILABLE', 'Memoh gone Verify', available=False),
        )
        devices['devices'][OLD_RUNTIME] = [device('OLD', 'Memoh old runtime Verify')]

        candidates = simulator.reusable_devices(devices, IPHONE)

        self.assertEqual([candidate['udid'] for candidate in candidates], ['MINE'])

    def test_the_device_type_selects_the_pool(self):
        simulator = load_simulator_module()
        devices = inventory(
            device('PHONE', 'Memoh app launch Verify'),
            device('TABLET', 'Memoh tablet Verify', device_type=IPAD),
        )

        self.assertEqual([c['udid'] for c in simulator.reusable_devices(devices, IPAD)], ['TABLET'])


class LeaseTests(unittest.TestCase):
    def test_a_shutdown_device_is_reused_renamed_and_left_warm(self):
        with pooled([device('A', 'Memoh old name Verify')]) as (simulator, simctl, pool, locks):
            with pool.lease('app-launch') as udid:
                self.assertEqual(udid, 'A')
                self.assertEqual(simctl.name_of('A'), 'Memoh app launch Verify')
                self.assertEqual(simctl.state_of('A'), 'Booted')
                self.assertEqual(simctl.boot_timeouts(), [simulator.BOOT_TIMEOUT])
            self.assertEqual(simctl.state_of('A'), 'Booted', 'the default lease keeps the device ready')
            self.assertTrue((locks / 'A.managed').exists())
            self.assertNotIn('erase', simctl.commands())
            self.assertFalse(pool.is_locked('A.lock'), 'the device lock is released')

    def test_shutdown_after_releases_both_the_device_and_its_marker(self):
        with pooled([device('A', 'Memoh old name Verify')]) as (simulator, simctl, pool, locks):
            with pool.lease('app-launch', shutdown_after=True) as udid:
                self.assertEqual(simctl.state_of(udid), 'Booted')
            self.assertEqual(simctl.state_of('A'), 'Shutdown')
            self.assertFalse((locks / 'A.managed').exists())

    def test_an_empty_pool_creates_a_device_and_hands_over_its_udid(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            with pool.lease('app-launch') as udid:
                self.assertEqual(udid, 'CREATED')
                self.assertEqual(simctl.name_of('CREATED'), 'Memoh app launch Verify')
                self.assertTrue((locks / 'CREATED.managed').exists())

    def test_the_lease_exports_the_udid_to_the_command(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            with contextlib.redirect_stderr(io.StringIO()):
                code = simulator.run_with_simulator(
                    pool,
                    'app-launch',
                    [sys.executable, '-c', 'import os; assert os.environ["MEMOH_VERIFY_UDID"] == "CREATED"'],
                    environment={'MEMOH_VERIFY_UDID': 'SHOULD-BE-REPLACED'},
                )
            self.assertEqual(code, 0)
            self.assertEqual(simctl.name_of('CREATED'), 'Memoh app launch Verify')

    def test_a_booted_device_without_our_marker_is_left_alone(self):
        with pooled([device('SOMEONE-ELSES', 'Memoh other run Verify', state='Booted')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            with pool.lease('app-launch') as udid:
                self.assertEqual(udid, 'CREATED')
            self.assertEqual(simctl.state_of('SOMEONE-ELSES'), 'Booted')
            self.assertEqual(simctl.name_of('SOMEONE-ELSES'), 'Memoh other run Verify')

    def test_a_warm_marked_device_is_reused(self):
        with pooled([device('WARM', 'Memoh other run Verify', state='Booted')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            (locks / 'WARM.managed').touch()
            with pool.lease('app-launch') as udid:
                self.assertEqual(udid, 'WARM')
            self.assertEqual(simctl.name_of('WARM'), 'Memoh app launch Verify')

    def test_a_locked_device_is_skipped_so_two_runs_never_share_one(self):
        with pooled([device('A', 'Memoh one Verify'), device('B', 'Memoh two Verify')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            held = pool.acquire_lock('A.lock', blocking=True)
            try:
                with pool.lease('app-launch') as udid:
                    self.assertEqual(udid, 'B')
            finally:
                held.close()

    def test_the_pool_lock_is_released_as_soon_as_a_device_is_chosen(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            with pool.lease('app-launch'):
                contender = pool.acquire_lock('.pool.lock', blocking=False)
                self.assertIsNotNone(contender, 'parallel leases must not wait on the selection lock')
                contender.close()

    def test_a_failing_run_still_frees_the_device_lock(self):
        with pooled([device('A', 'Memoh app launch Verify')]) as (simulator, simctl, pool, locks):
            with self.assertRaises(RuntimeError):
                with pool.lease('app-launch'):
                    raise RuntimeError('the command failed')
            self.assertFalse(pool.is_locked('A.lock'))

    def test_a_device_that_fails_to_boot_is_reported_and_unlocked(self):
        with pooled([device('A', 'Memoh app launch Verify')], ) as (simulator, simctl, pool, locks):
            simctl.fail_on = 'boot'
            with self.assertRaises(subprocess.CalledProcessError):
                with pool.lease('app-launch'):
                    self.fail('the lease must not yield a device that failed to boot')
            self.assertFalse(pool.is_locked('A.lock'))

    def test_a_missing_runtime_says_so_instead_of_failing_in_simctl(self):
        with pooled([device('A', 'Memoh app launch Verify')]) as (simulator, simctl, pool, locks):
            simctl.inventory['devices'] = {OLD_RUNTIME: simctl.inventory['devices'][RUNTIME]}

            with self.assertRaises(RuntimeError) as caught:
                with pool.lease('app-launch'):
                    self.fail('no device can be leased without the pinned runtime')

            self.assertIn('is not installed', str(caught.exception))
            self.assertIn(OLD_RUNTIME.split('.')[-1], str(caught.exception))


class HousekeepingTests(unittest.TestCase):
    def test_release_shuts_down_a_forgotten_device(self):
        with pooled([device('A', 'Memoh app launch Verify', state='Booted')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            (locks / 'A.managed').touch()
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                code = pool.release('app-launch')

            self.assertEqual(code, 0)
            self.assertEqual(simctl.state_of('A'), 'Shutdown')
            self.assertFalse((locks / 'A.managed').exists())
            self.assertIn('released', buffer.getvalue())

    def test_release_refuses_a_device_that_is_in_use(self):
        with pooled([device('A', 'Memoh app launch Verify')]) as (simulator, simctl, pool, locks):
            held = pool.acquire_lock('A.lock', blocking=True)
            try:
                buffer = io.StringIO()
                with contextlib.redirect_stdout(buffer):
                    code = pool.release('app-launch')
            finally:
                held.close()

            self.assertEqual(code, 1)
            self.assertIn('in use', buffer.getvalue())
            self.assertFalse(any(command[0] == 'shutdown' for command in simctl.commands()))

    def test_release_reports_an_unknown_device_without_failing(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                self.assertEqual(pool.release('app-launch'), 0)
            self.assertIn('no managed Simulator', buffer.getvalue())

    def test_purge_deletes_only_unlocked_managed_devices(self):
        with pooled([device('A', 'Memoh one Verify'), device('B', 'Memoh two Verify')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            held = pool.acquire_lock('A.lock', blocking=True)
            try:
                buffer = io.StringIO()
                with contextlib.redirect_stdout(buffer):
                    self.assertEqual(pool.purge(), 0)
            finally:
                held.close()

            self.assertEqual(simctl.commands().count('delete'), 1)
            self.assertIn('skipping', buffer.getvalue())

    def test_report_shows_state_lock_and_marker(self):
        with pooled([device('A', 'Memoh one Verify', state='Booted')]) as (simulator, simctl, pool, locks):
            (locks / 'A.managed').touch()
            (report,) = pool.report()

            self.assertEqual(report['name'], 'Memoh one Verify')
            self.assertEqual(report['state'], 'Booted')
            self.assertFalse(report['locked'])
            self.assertTrue(report['idleMarker'])


class CommandLineTests(unittest.TestCase):
    def test_list_reports_the_pool(self):
        with pooled([device('A', 'Memoh one Verify', state='Booted')]) as (simulator, simctl, pool, locks):
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                code = run_main(simulator, ['--list'], pool)
            printed = buffer.getvalue()

            self.assertEqual(code, 0)
            self.assertIn('Booted', printed)
            self.assertIn('Memoh one Verify', printed)
            self.assertIn('free', printed)

    def test_list_json_is_machine_readable(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                run_main(simulator, ['--list', '--json'], pool)
            self.assertEqual(json.loads(buffer.getvalue()), [])

    def test_a_command_runs_inside_the_lease_and_its_code_is_returned(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            with contextlib.redirect_stderr(io.StringIO()) as lease_log:
                code = run_main(
                    simulator,
                    ['--name', 'app-launch', '--', sys.executable, '-c', 'import sys; sys.exit(3)'],
                    pool,
                )

            self.assertEqual(code, 3)
            self.assertEqual(simctl.name_of('CREATED'), 'Memoh app launch Verify')
            self.assertIn('Memoh app launch Verify', lease_log.getvalue())

    def test_a_name_and_a_command_are_both_required(self):
        with pooled([]) as (simulator, simctl, pool, locks):
            for argv in [[], ['--name', 'app-launch'], ['--', 'echo', 'hi'], ['--name', '   ', '--', 'true']]:
                with self.subTest(argv=argv):
                    buffer = io.StringIO()
                    with contextlib.redirect_stderr(buffer):
                        with self.assertRaises(SystemExit):
                            run_main(simulator, argv, pool)

    def test_release_accepts_either_spelling(self):
        with pooled([device('A', 'Memoh app launch Verify', state='Booted')]) as (
            simulator,
            simctl,
            pool,
            locks,
        ):
            for name in ['app-launch', 'Memoh app launch Verify']:
                with self.subTest(name=name):
                    buffer = io.StringIO()
                    with contextlib.redirect_stdout(buffer):
                        self.assertEqual(run_main(simulator, ['--release', name], pool), 0)


class EnvironmentTests(unittest.TestCase):
    def test_the_environment_variable_name_is_the_contract(self):
        simulator = load_simulator_module()

        self.assertEqual(simulator.ENVIRONMENT_VARIABLE, 'MEMOH_VERIFY_UDID')
        self.assertEqual(simulator.RUNTIME, RUNTIME)
        self.assertTrue(simulator.MANAGED_NAME.fullmatch('Memoh anything Verify'))
        self.assertIsNone(simulator.MANAGED_NAME.fullmatch('Memoh Verify'))

    def test_the_pool_lock_is_a_real_flock(self):
        """Two locks on one path conflict, which is what makes a lease atomic."""
        with tempfile.TemporaryDirectory() as locks:
            held = open(os.path.join(locks, 'A.lock'), 'a+')
            fcntl.flock(held, fcntl.LOCK_EX)
            try:
                contender = open(os.path.join(locks, 'A.lock'), 'a+')
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
                contender.close()
            finally:
                held.close()


if __name__ == '__main__':
    unittest.main()
