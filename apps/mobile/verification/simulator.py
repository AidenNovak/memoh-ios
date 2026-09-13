#!/usr/bin/env python3
"""Lease a reusable `Memoh <name> Verify` Simulator for one verification run.

    pnpm verify:simulator --name 'app-launch' -- zsh -euc '
      pnpm verify:native
      pnpm verify:ui --app "$(pnpm --silent verify:build)" --case app-launch
    '

The lease exports the UDID as ``MEMOH_VERIFY_UDID``; every other verification
script reads that variable instead of choosing a device itself. Device selection
is serialized with a file lock and each device carries its own lock, so several
verifications can run in parallel without fighting over one Simulator. A device
is only ever chosen from the pool this script manages - ``Memoh * Verify`` on the
pinned runtime - so personal devices and other projects are never booted or
erased. By default the device is left booted for the next run (nothing is
erased); ``--shutdown-after`` shuts it down when the command finishes.

``simctl create`` lives in this file only. If any other script needs a device it
must go through the lease.
"""
import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

# Pin both device types and the runtime: a lease must never silently pick up a
# beta runtime or a device type whose geometry no baseline was written against.
DEVICE_TYPES = {
    'iphone': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
    'ipad': 'com.apple.CoreSimulator.SimDeviceType.iPad-Air-11-inch-M2',
}
RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
MANAGED_PREFIX = 'Memoh '
MANAGED_SUFFIX = ' Verify'
MANAGED_NAME = re.compile(r'^Memoh .+ Verify$')
ENVIRONMENT_VARIABLE = 'MEMOH_VERIFY_UDID'
LOCK_DIRECTORY = Path.home() / 'Library/Caches/ai.memoh.ios/verify-simulators'
BOOT_TIMEOUT = 300
MAX_NAME_LENGTH = 40


def slugify(verify_name):
    """`App Launch`, `app-launch` and `app_launch` all become `app-launch`.

    Lock files and markers are named after the slug, so two callers spelling the
    same verification differently still share one device.
    """
    return re.sub(r'[^A-Za-z0-9]+', '-', verify_name.strip()).strip('-').lower()


def managed_name(verify_name):
    """Return the managed device name for a verification name, or raise.

    The readable part is the slug, so the name is predictable from the command
    line and `--list` reads back the same device a lease took.
    """
    if not isinstance(verify_name, str):
        raise ValueError('verification name must be a string')
    stripped = verify_name.strip()
    if not stripped or any(ord(character) < 32 for character in stripped):
        raise ValueError('verification name must be non-empty and single-line')
    slug = slugify(stripped)
    if not slug:
        raise ValueError('verification name must contain a letter or a digit')
    if len(slug) > MAX_NAME_LENGTH:
        raise ValueError(f'verification name is longer than {MAX_NAME_LENGTH} characters')
    return f'{MANAGED_PREFIX}{slug.replace("-", " ")}{MANAGED_SUFFIX}'


def resolve_managed_name(value):
    """Accept either a verification name (`app-launch`) or a device name."""
    if MANAGED_NAME.fullmatch(value.strip()):
        return value.strip()
    return managed_name(value)


def run_simctl(*command, check=True, timeout=120):
    return subprocess.run(
        ['xcrun', 'simctl', *command],
        check=check,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def device_inventory(simctl=run_simctl):
    return json.loads(simctl('list', 'devices', '--json').stdout)


def reusable_devices(inventory, device_type=None, runtime=RUNTIME):
    """Managed devices a lease may consider: this project, right runtime, usable."""
    devices = inventory.get('devices', {}).get(runtime, [])
    return [
        device
        for device in devices
        if device.get('isAvailable')
        and MANAGED_NAME.fullmatch(device.get('name', ''))
        and (device_type is None or device.get('deviceTypeIdentifier') == device_type)
    ]


def find_device(inventory, name, runtime=RUNTIME):
    for device in inventory.get('devices', {}).get(runtime, []):
        if device.get('name') == name:
            return device
    return None


class SimulatorPool:
    def __init__(
        self,
        simctl=run_simctl,
        lock_directory=None,
        device_type=DEVICE_TYPES['iphone'],
        runtime=RUNTIME,
    ):
        self.simctl = simctl
        self.device_type = device_type
        self.runtime = runtime
        self.lock_directory = Path(lock_directory or LOCK_DIRECTORY)

    # -- locks ---------------------------------------------------------------

    def acquire_lock(self, name, blocking):
        lock_file = (self.lock_directory / name).open('a+')
        flags = fcntl.LOCK_EX
        if not blocking:
            flags |= fcntl.LOCK_NB
        try:
            fcntl.flock(lock_file, flags)
        except BlockingIOError:
            lock_file.close()
            return None
        return lock_file

    def is_locked(self, lock_name):
        """True when another process currently holds the device lock."""
        lock = self.acquire_lock(lock_name, blocking=False)
        if lock is None:
            return True
        lock.close()
        return False

    def marker(self, udid):
        return self.lock_directory / f'{udid}.managed'

    def device_lock_name(self, udid):
        return f'{udid}.lock'

    # -- lease ---------------------------------------------------------------

    @contextmanager
    def lease(self, verify_name, shutdown_after=False):
        name = managed_name(verify_name)
        self.lock_directory.mkdir(parents=True, exist_ok=True)
        pool_lock = self.acquire_lock('.pool.lock', blocking=True)
        device = None
        device_lock = None
        marker = None
        try:
            inventory = device_inventory(self.simctl)
            installed = inventory.get('devices', {})
            if self.runtime not in installed:
                raise RuntimeError(
                    f'{self.runtime} is not installed on this machine; install a matching iOS '
                    f'Simulator runtime or change RUNTIME in simulator.py. Installed: {", ".join(sorted(installed))}'
                )
            # A booted device without our marker belongs to someone else; warm
            # devices (marker present) sort last so a clean one wins when free.
            candidates = sorted(
                reusable_devices(inventory, self.device_type, self.runtime),
                key=lambda candidate: candidate.get('state') != 'Shutdown',
            )
            for candidate in candidates:
                candidate_marker = self.marker(candidate['udid'])
                if candidate.get('state') != 'Shutdown' and not candidate_marker.exists():
                    continue
                candidate_lock = self.acquire_lock(self.device_lock_name(candidate['udid']), blocking=False)
                if candidate_lock is not None:
                    device = candidate
                    device_lock = candidate_lock
                    break
            if device is None:
                created = self.simctl('create', name, self.device_type, self.runtime)
                udid = created.stdout.strip()
                if not udid:
                    raise RuntimeError('simctl create produced no device identifier')
                device_lock = self.acquire_lock(self.device_lock_name(udid), blocking=True)
                device = {'udid': udid, 'name': name, 'state': 'Shutdown'}
            marker = self.marker(device['udid'])
            marker.touch()
        finally:
            pool_lock.close()

        udid = device['udid']
        operation_failed = False
        try:
            if device.get('state') != 'Shutdown':
                self.simctl('shutdown', udid)
            self.simctl('rename', udid, name)
            self.simctl('boot', udid)
            self.simctl('bootstatus', udid, '-b', timeout=BOOT_TIMEOUT)
            yield udid
        except BaseException:
            operation_failed = True
            raise
        finally:
            cleanup_error = None
            try:
                if shutdown_after:
                    self.shutdown(udid)
                    marker.unlink(missing_ok=True)
            except Exception as error:
                cleanup_error = error
            finally:
                if not shutdown_after:
                    # Keep the warm device marked: a booted device without the
                    # marker is "someone else's" to every later lease.
                    marker.touch()
                device_lock.close()
            if cleanup_error is not None:
                if operation_failed:
                    print(f'Failed to release Simulator {udid}: {cleanup_error}', file=sys.stderr)
                else:
                    raise cleanup_error

    def shutdown(self, udid):
        """Shut a device down, tolerating the already-shutdown exit code."""
        shutdown = self.simctl('shutdown', udid, check=False)
        if shutdown.returncode == 0:
            return
        current = find_device_by_udid(device_inventory(self.simctl), udid)
        if current is not None and current.get('state') == 'Shutdown':
            return
        shutdown.check_returncode()

    # -- housekeeping --------------------------------------------------------

    def managed(self):
        return reusable_devices(device_inventory(self.simctl), None, self.runtime)

    def release(self, verify_name):
        """Reclaim one forgotten lease: shut the device down, drop its marker."""
        name = resolve_managed_name(verify_name)
        device = find_device(device_inventory(self.simctl), name, self.runtime)
        if device is None:
            print(f'no managed Simulator named {name!r}')
            return 0
        udid = device['udid']
        if self.is_locked(self.device_lock_name(udid)):
            print(f'{name} ({udid}) is in use; release it after that run ends')
            return 1
        self.shutdown(udid)
        self.marker(udid).unlink(missing_ok=True)
        print(f'released {name} ({udid})')
        return 0

    def purge(self):
        """Delete every unlocked managed device; used to clean up CI machines."""
        removed = 0
        for device in self.managed():
            udid = device['udid']
            if self.is_locked(self.device_lock_name(udid)):
                print(f'skipping {device["name"]} ({udid}): in use')
                continue
            self.simctl('delete', udid)
            self.marker(udid).unlink(missing_ok=True)
            print(f'deleted {device["name"]} ({udid})')
            removed += 1
        if not removed:
            print('nothing to purge')
        return 0

    def report(self):
        entries = []
        for device in self.managed():
            udid = device['udid']
            entries.append(
                {
                    'udid': udid,
                    'name': device['name'],
                    'state': device.get('state'),
                    'deviceType': device.get('deviceTypeIdentifier'),
                    'locked': self.is_locked(self.device_lock_name(udid)),
                    'idleMarker': self.marker(udid).exists(),
                    'dataPath': str(device_data_path(udid)),
                }
            )
        return entries


def find_device_by_udid(inventory, udid):
    for devices in inventory.get('devices', {}).values():
        for device in devices:
            if device.get('udid') == udid:
                return device
    return None


def device_data_path(udid):
    return Path.home() / 'Library/Developer/CoreSimulator/Devices' / udid


def run_with_simulator(pool, verify_name, command, environment=None, shutdown_after=False):
    child_environment = os.environ.copy()
    child_environment.update(environment or {})
    with pool.lease(verify_name, shutdown_after=shutdown_after) as udid:
        child_environment[ENVIRONMENT_VARIABLE] = udid
        print(f'leased {managed_name(verify_name)} ({udid})', file=sys.stderr)
        return subprocess.run(command, env=child_environment).returncode


def parse_arguments(argv):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--name', help='Verification name, for example "app-launch"')
    parser.add_argument('--device', choices=DEVICE_TYPES, default='iphone')
    parser.add_argument(
        '--shutdown-after',
        action='store_true',
        help='Shut the Simulator down when the command ends (default: leave it booted for reuse)',
    )
    parser.add_argument('--list', action='store_true', help='List managed Simulators and their locks')
    parser.add_argument('--release', metavar='NAME', help='Shut down and unlock a forgotten lease')
    parser.add_argument('--purge', action='store_true', help='Delete every unlocked managed Simulator')
    parser.add_argument('--json', action='store_true', help='With --list, print JSON')
    parser.add_argument('command', nargs=argparse.REMAINDER, help='Command to run inside the lease')
    return parser.parse_args(argv)


def main(argv=None):
    arguments = parse_arguments(argv)
    pool = SimulatorPool(device_type=DEVICE_TYPES[arguments.device])
    if arguments.list:
        entries = pool.report()
        if arguments.json:
            print(json.dumps(entries, indent=2))
            return 0
        if not entries:
            print('no managed Simulator; the next lease will create one')
            return 0
        for entry in entries:
            lock = 'in use' if entry['locked'] else 'free'
            marker = 'idle' if entry['idleMarker'] else 'unmarked'
            print(f'{entry["state"]:<9} {lock:<7} {marker:<9} {entry["udid"]}  {entry["name"]}')
        return 0
    if arguments.release is not None:
        try:
            resolve_managed_name(arguments.release)
        except ValueError as error:
            raise SystemExit(str(error))
        return pool.release(arguments.release)
    if arguments.purge:
        return pool.purge()
    if not arguments.name:
        raise SystemExit('--name is required unless --list, --release or --purge is used')
    command = arguments.command
    if command and command[0] == '--':
        command = command[1:]
    if not command:
        raise SystemExit('a command is required after --')
    try:
        managed_name(arguments.name)
    except ValueError as error:
        raise SystemExit(str(error))
    return run_with_simulator(pool, arguments.name, command, shutdown_after=arguments.shutdown_after)


if __name__ == '__main__':
    sys.exit(main())
