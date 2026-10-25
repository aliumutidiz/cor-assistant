#!/usr/bin/python3
"""Owner-mediated AGY-only PTY. No shell, executable selection or command RPC."""
import asyncio
import base64
import fcntl
import json
import os
from pathlib import Path
import pty
import pwd
import secrets
import signal
import socket
import struct
import termios
import time
import subprocess
from datetime import datetime, timezone

PATH = '/run/cor-agy-console/console.sock'


def validate_request(data):
    if not isinstance(data, dict) or data.get('control') not in ('status', 'check', 'start', 'read', 'write', 'resize', 'stop'):
        raise ValueError('Unknown console control')
    allowed = {'control', 'session', 'offset', 'input', 'cols', 'rows'}
    if set(data) - allowed:
        raise ValueError('Unexpected console parameter')
    if 'session' in data and (not isinstance(data['session'], str) or len(data['session']) > 100):
        raise ValueError('Invalid session')
    if 'offset' in data and (type(data['offset']) is not int or not 0 <= data['offset'] <= 10000000):
        raise ValueError('Invalid cursor')
    if 'input' in data and (not isinstance(data['input'], str) or len(data['input'].encode()) > 4096):
        raise ValueError('Input too large')
    for key, low, high in [('cols', 20, 200), ('rows', 8, 60)]:
        if key in data and (type(data[key]) is not int or not low <= data[key] <= high):
            raise ValueError('Invalid terminal dimensions')
    return data


class Console:
    def __init__(self):
        self.session = None
        self.pid = None
        self.fd = None
        self.lock = None
        self.buffer = bytearray()
        self.base = 0
        self.total = 0
        self.started = 0
        self.touched = 0

    def start(self):
        if self.pid:
            return self.status()
        lock = open('/var/lib/cor-agent/run/session.lock', 'a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError('Model is busy; wait before opening console')
        self.lock = lock
        self.buffer.clear()
        self.base = self.total = 0
        self.session = secrets.token_urlsafe(32)
        self.started = self.touched = time.monotonic()
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.chdir('/var/lib/cor-agent/work')
                env = {k: os.environ[k] for k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'XDG_RUNTIME_DIR') if k in os.environ}
                env.update(TERM='xterm-256color', COLORTERM='truecolor')
                os.execve('/usr/bin/dbus-run-session', ['/usr/bin/dbus-run-session', '--', '/opt/cor-agent/bin/agy', '--sandbox'], env)
            finally:
                os._exit(127)
        self.pid, self.fd = pid, fd
        os.set_blocking(fd, False)
        self.resize(100, 28)
        asyncio.get_running_loop().add_reader(fd, self.capture)
        return self.status()

    def capture(self):
        try:
            data = os.read(self.fd, 16384)
        except BlockingIOError:
            return
        except OSError:
            self.stop()
            return
        if not data:
            self.stop()
            return
        self.total += len(data)
        self.buffer.extend(data)
        if len(self.buffer) > 131072:
            excess = len(self.buffer) - 131072
            del self.buffer[:excess]
            self.base += excess
        if self.total > 8000000:
            self.stop()

    def resize(self, cols, rows):
        if self.fd is not None:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def stop(self):
        pid, fd = self.pid, self.fd
        self.pid = self.fd = None
        if fd is not None:
            asyncio.get_running_loop().remove_reader(fd)
            os.close(fd)
        if pid:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
        if self.lock:
            self.lock.close()
            self.lock = None

    def status(self):
        try:
            connection = json.loads(Path('/var/lib/cor-agent/run/connection.json').read_text())
        except (OSError, ValueError):
            connection = {'state': 'unknown'}
        return {'active': bool(self.pid), 'session': self.session if self.pid else None, 'offset': self.base, 'connection': connection}

    async def check(self):
        lock = open('/var/lib/cor-agent/run/session.lock', 'a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            process = await asyncio.create_subprocess_exec('/usr/bin/dbus-run-session', '--', '/opt/cor-agent/bin/agy', 'models',
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
                env={k: os.environ[k] for k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'XDG_RUNTIME_DIR') if k in os.environ})
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), 20)
                diagnostic = stderr.decode(errors='replace').lower()
                state = 'ready' if process.returncode == 0 and b'gemini-' in stdout else ('auth_required' if any(t in diagnostic for t in ('auth', 'login', 'log in', 'logged in', 'logged out', 'sign in', 'credential')) else 'error')
                path = Path('/var/lib/cor-agent/run/connection.json')
                try:
                    if state == 'ready' and json.loads(path.read_text()).get('state') == 'quota':
                        state = 'quota'  # Model listing cannot establish that generation quota recovered.
                except (OSError, ValueError):
                    pass
                temporary = path.with_suffix('.tmp')
                temporary.write_text(json.dumps({'state': state, 'updatedAt': datetime.now(timezone.utc).isoformat()}))
                temporary.replace(path)
            finally:
                if process.returncode is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await process.wait()
        finally:
            lock.close()
        return self.status()

    def control(self, request):
        command = request['control']
        if command == 'status':
            return self.status()
        if command == 'start':
            return self.start()
        if not self.session or request.get('session') != self.session:
            raise ValueError('Console session mismatch')
        self.touched = time.monotonic()
        if command == 'read':
            offset = request.get('offset', self.base)
            reset = offset < self.base
            offset = max(self.base, min(offset, self.base + len(self.buffer)))
            part = self.buffer[offset - self.base:offset - self.base + 32768]
            return {'active': bool(self.pid), 'data': base64.b64encode(part).decode(), 'offset': offset + len(part), 'reset': reset}
        if command == 'stop':
            self.stop()
        elif not self.pid:
            raise ValueError('Console exited')
        elif command == 'write':
            os.write(self.fd, request.get('input', '').encode())
        elif command == 'resize':
            self.resize(request.get('cols', 100), request.get('rows', 28))
        return self.status()


console = Console()


async def handle(reader, writer):
    try:
        _, uid, _ = struct.unpack('3i', writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != pwd.getpwnam('cor').pw_uid:
            raise PermissionError()
        request = validate_request(json.loads(await asyncio.wait_for(reader.readline(), 5)))
        result = await console.check() if request['control'] == 'check' else console.control(request)
    except Exception as error:
        result = {'error': type(error).__name__}
    try:
        writer.write(json.dumps(result).encode() + b'\n')
        await writer.drain()
    except ConnectionError:
        pass
    finally:
        writer.close()


async def watchdog():
    while True:
        await asyncio.sleep(2)
        if console.pid and (time.monotonic() - console.started > 600 or time.monotonic() - console.touched > 90):
            console.stop()


async def main():
    Path(PATH).unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, path=PATH, limit=16384)
    os.chmod(PATH, 0o660)
    timer = asyncio.create_task(watchdog())
    try:
        async with server:
            await server.serve_forever()
    finally:
        timer.cancel()
        console.stop()


if __name__ == '__main__':
    asyncio.run(main())
