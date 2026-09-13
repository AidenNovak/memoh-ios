"""One owned Metro for a verification run, optionally serving several workers.

A verification run never attaches to another task's server: if the port is taken
the run stops and asks for another one. Every worker gets the same bundle, which
is what makes parallel UI checks comparable - they differ in device, not in code.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import Request, urlopen

MOBILE_PACKAGE = '@memoh-ios/mobile'
READY_TIMEOUT = 90


def port_in_use(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            return True
    except OSError:
        return False


def metro_environment(base=None):
    environment = dict(base or os.environ)
    environment.update(
        {
            # A Debug bundle only: production builds never see this flag, which is
            # what keeps the offline baseline out of shipped code paths.
            'EXPO_PUBLIC_UI_VERIFY': '1',
            'CI': '1',
            'EXPO_NO_DOTENV': '1',
            'REACT_NATIVE_PACKAGER_HOSTNAME': '127.0.0.1',
        }
    )
    return environment


def stop_process(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGINT)
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def diagnose(port, output, phase, metro=None):
    """Probe the server, never dumping manifests, bundles or the environment."""
    probes = []
    for method, path in [('GET', '/status'), ('HEAD', '/'), ('GET', '/')]:
        started = time.monotonic()
        probe = {'method': method, 'path': path}
        try:
            request = Request(
                f'http://127.0.0.1:{port}{path}',
                method=method,
                headers={'expo-platform': 'ios', 'accept': 'application/expo+json,application/json'},
            )
            with urlopen(request, timeout=10) as response:
                probe['status'] = response.status
                probe['bytes'] = len(response.read())
        except Exception as error:  # a failed probe is the diagnostic
            probe['error'] = str(error)
        probe['seconds'] = round(time.monotonic() - started, 3)
        probes.append(probe)
    payload = {'phase': phase, 'port': port, 'metroExitCode': metro.poll() if metro else None, 'probes': probes}
    (Path(output) / f'metro-{phase}.json').write_text(json.dumps(payload, indent=2))
    return payload


@contextmanager
def managed_metro(root, port, output):
    if port_in_use(port):
        raise SystemExit(f'port {port} is already serving something; pass another --port')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'metro.log').open('w') as log:
        metro = subprocess.Popen(
            ['pnpm', '--filter', MOBILE_PACKAGE, 'exec', 'expo', 'start', '--dev-client', '--host', 'lan',
             '--port', str(port)],
            cwd=root,
            env=metro_environment(),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + READY_TIMEOUT
            while True:
                if metro.poll() is not None:
                    raise RuntimeError(f'Metro exited early; see {output / "metro.log"}')
                try:
                    with urlopen(f'http://127.0.0.1:{port}/status', timeout=2) as response:
                        if b'packager-status:running' in response.read():
                            break
                except OSError:
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError(f'Metro did not report ready within {READY_TIMEOUT}s')
                time.sleep(0.5)
            # Fetch the bundle once so every worker starts from a warm server.
            request = Request(
                f'http://127.0.0.1:{port}/?disableOnboarding=1',
                headers={'expo-platform': 'ios', 'accept': 'application/expo+json'},
            )
            with urlopen(request, timeout=60) as response:
                manifest = json.load(response)
            launch_asset = manifest.get('launchAsset', {}).get('url')
            if launch_asset:
                with urlopen(launch_asset, timeout=180) as response:
                    response.read()
            diagnose(port, output, 'startup', metro)
            yield metro
        finally:
            stop_process(metro)


def run_workers(commands, output):
    """Start every worker before waiting; one failure never cancels a sibling."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    workers = []
    started = time.monotonic()
    results = []
    try:
        for name, command in commands.items():
            directory = output / name
            directory.mkdir(parents=True, exist_ok=True)
            log = (directory / 'worker.log').open('w')
            try:
                process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            except BaseException:
                log.close()
                raise
            workers.append((name, process, log))
        pending = list(workers)
        while pending:
            for worker in pending[:]:
                name, process, _ = worker
                code = process.poll()
                if code is not None:
                    entry = {'worker': name, 'exitCode': code, 'seconds': round(time.monotonic() - started, 2)}
                    results.append(entry)
                    (output / 'workers.json').write_text(json.dumps(results, indent=2))
                    print(json.dumps(entry), flush=True)
                    pending.remove(worker)
            if pending:
                time.sleep(0.5)
    finally:
        for _, process, log in workers:
            try:
                stop_process(process)
            finally:
                log.close()
    cases = []
    for name, _, _ in workers:
        path = output / name / 'results.json'
        if path.exists():
            cases.extend({**case, 'worker': name} for case in json.loads(path.read_text()))
        else:
            cases.append({'worker': name, 'status': 'failed', 'reason': 'worker produced no results.json'})
    if not cases:
        exit_code = 1
    else:
        exit_code = int(
            any(entry['exitCode'] != 0 for entry in results)
            or any(case.get('status') != 'passed' for case in cases)
        )
    return exit_code, cases, results


if __name__ == '__main__':
    sys.exit('metro.py is a helper for run.py; run pnpm verify:ui instead')
