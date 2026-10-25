#!/usr/bin/python3
"""Bounded console transport; never executes client-provided commands.

Only the cor UID may connect. Prompts use stdin rather than process arguments.
The broker and CLI run as cor-agent, outside the application credential boundary.
"""
import asyncio
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import struct
import hashlib
import time
import uuid
from datetime import datetime, timezone

SOCKET = '/run/cor-agy/model.sock'
MAX_REQUEST = 196608
MAX_OUTPUT = 1048576
MODEL = 'gemini-3.8-flash-low'


class ModelQuotaError(Exception):
    pass


class ModelAuthError(Exception):
    pass


class ModelBusyError(Exception):
    pass


class ModelOutputError(Exception):
    pass


class ModelUnavailableError(Exception):
    pass


class ModelToolPolicyError(PermissionError):
    pass


def parse_cli_output(stdout, stderr, code):
    result = None
    malformed = False
    for line in stdout.splitlines():
        line = line.strip()
        if not line or not line.startswith(b'{'):
            continue  # CLI startup notices are not protocol events.
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError):
            malformed = True
            continue
        if not isinstance(event, dict):
            malformed = True
            continue
        step = event.get('step_update') or {}
        if not isinstance(step, dict):
            raise ModelOutputError()
        if step.get('step_type') == 'tool' and step.get('tool_name') != 'finish':
            raise ModelToolPolicyError('Model attempted an unauthorized built-in tool')
        if event.get('event') == 'result':
            result = event.get('result')
    diagnostic = stderr.decode(errors='replace') + json.dumps(result)
    if code or malformed or not isinstance(result, dict) or result.get('status') != 'SUCCESS':
        if re.search(r'quota|resource_exhausted|rate.limit', diagnostic, re.I):
            raise ModelQuotaError()
        if re.search(r'authentication required|not authenticated|not logged in|please sign in|login required|session expired|invalid_grant|unauthenticated|credentials.*expired', diagnostic, re.I):
            raise ModelAuthError()
        if re.search(r'timeout|timed out|deadline.exceeded', diagnostic, re.I):
            raise TimeoutError()
        if re.search(r'unavailable|connection.reset|ECONNRESET|fetch failed|network error|503|502', diagnostic, re.I):
            raise ModelUnavailableError()
        raise ModelOutputError()
    output = result.get('structured_output')
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            raise ModelOutputError() from None
    if not isinstance(output, dict):
        raise ModelOutputError()
    response = {'output': output, 'usage': result.get('usage')}
    conversation = result.get('conversation_id')
    if isinstance(conversation, str):
        try:
            response['_conversation_id'] = str(uuid.UUID(conversation))
        except ValueError:
            pass
    return response


def connection_status(state):
    path = Path('/var/lib/cor-agent/run/connection.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps({'state': state, 'model': MODEL, 'updatedAt': datetime.now(timezone.utc).isoformat()}))
    temporary.replace(path)


def validate_policy():
    path = Path('/var/lib/cor-agent/.gemini/antigravity-cli/settings.json')
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError('Policy symlink rejected')
    with path.open() as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1048576:
            raise ValueError('Invalid policy file')
        settings = json.load(source)
        if settings.get('useG1Credits', False) is not False:
            raise ValueError('Paid credit fallback must be disabled')
        policy = settings.get('permissions', {})
    required = {f'{name}(*)' for name in ('read_file', 'write_file', 'read_url', 'execute_url', 'command', 'unsandboxed', 'mcp')}
    if not required.issubset(set(policy.get('deny', []))) or policy.get('allow') or policy.get('ask'):
        raise ValueError('Deny-all policy required')


def parse_request(raw):
    if len(raw) > MAX_REQUEST:
        raise ValueError('Request too large')
    data = json.loads(raw)
    if not isinstance(data, dict) or not {'prompt', 'schema'}.issubset(data) or set(data) - {'prompt', 'schema', 'conversation_key'}:
        raise ValueError('Invalid request')
    if 'conversation_key' in data and (not isinstance(data['conversation_key'], str) or not re.fullmatch('[a-f0-9]{64}', data['conversation_key'])):
        raise ValueError('Invalid conversation scope')
    if not isinstance(data['prompt'], str) or not 1 <= len(data['prompt']) <= 96000:
        raise ValueError('Invalid prompt')
    if not isinstance(data['schema'], dict) or data['schema'].get('type') != 'object':
        raise ValueError('Object schema required')
    if len(json.dumps(data['schema'])) > 65536:
        raise ValueError('Schema too large')
    return data


async def bounded_read(stream):
    result = bytearray()
    while True:
        part = await stream.read(8192)
        if not part:
            return bytes(result)
        result.extend(part)
        if len(result) > MAX_OUTPUT:
            raise ValueError('Output too large')


async def generate(data):
    validate_policy()
    lock = open('/var/lib/cor-agent/run/session.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise ModelBusyError()
    try:
        return await execute(data)
    finally:
        lock.close()


async def execute(data):
    # Never use global --continue: it can resume an unrelated owner console.
    # Scope and schema are application-selected, not model-provided CLI arguments.
    state_path = Path('/var/lib/cor-agent/run/conversations.json')
    sessions = {}
    scope = data.get('conversation_key')
    session_key = None
    if scope:
        session_key = hashlib.sha256((scope + json.dumps(data['schema'], sort_keys=True)).encode()).hexdigest()
        if state_path.exists():
            if state_path.is_symlink() or state_path.stat().st_size > 65536:
                raise ValueError('Invalid conversation state')
            sessions = json.loads(state_path.read_text())
        sessions = {k:v for k,v in sessions.items() if isinstance(v,dict) and time.time()-v.get('updated',0)<30*86400}
    previous = sessions.get(session_key, {}).get('id')
    if previous:
        previous = str(uuid.UUID(previous))
    resume = ['--conversation', previous] if previous else []
    process = await asyncio.create_subprocess_exec(
        '/usr/bin/dbus-run-session', '--', '/opt/cor-agent/bin/agy',
        *resume,
        '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--json-schema', json.dumps(data['schema'], separators=(',', ':')),
        '--model', MODEL, '--effort', 'low', '--sandbox',
        '--disable-slash-commands', '--print-timeout', '90s',
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, start_new_session=True,
        env={k: os.environ[k] for k in ('HOME', 'USER', 'LOGNAME', 'PATH', 'XDG_RUNTIME_DIR') if k in os.environ},
    )
    readers = []
    try:
        process.stdin.write((json.dumps({'event': 'user', 'message': {'content': data['prompt']}}) + '\n').encode())
        await process.stdin.drain()
        process.stdin.close()
        readers = [asyncio.create_task(bounded_read(process.stdout)), asyncio.create_task(bounded_read(process.stderr))]
        stdout, stderr = await asyncio.gather(*readers)
        code = await process.wait()
        try:
            response = parse_cli_output(stdout, stderr, code)
        except ModelQuotaError:
            connection_status('quota')
            raise
        except ModelAuthError:
            connection_status('auth_required')
            raise
        except Exception:
            connection_status('error')
            raise
        connection_status('ready')
        conversation = response.pop('_conversation_id', None)
        if session_key and conversation:
            sessions[session_key] = {'id': conversation, 'updated': time.time()}
            sessions = dict(sorted(sessions.items(), key=lambda item:item[1]['updated'], reverse=True)[:64])
            temporary = state_path.with_suffix('.tmp')
            with temporary.open('w') as output:
                os.chmod(temporary, 0o600)
                json.dump(sessions, output)
            temporary.replace(state_path)
        return response
    finally:
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
        for task in readers:
            task.cancel()
        await asyncio.gather(*readers, return_exceptions=True)


busy = False


async def handle(reader, writer):
    global busy
    reserved = False
    tasks = []
    try:
        peer = writer.get_extra_info('socket')
        _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != pwd.getpwnam('cor').pw_uid:
            raise PermissionError('Application identity required')
        if busy:
            writer.write(b'{"error":"busy"}\n')
            await writer.drain()
            return
        busy = reserved = True
        data = parse_request(await asyncio.wait_for(reader.readline(), 5))
        operation = asyncio.create_task(generate(data))
        disconnected = asyncio.create_task(reader.read(1))
        tasks = [operation, disconnected]
        done, _ = await asyncio.wait(tasks, timeout=95, return_when=asyncio.FIRST_COMPLETED)
        if operation not in done:
            raise TimeoutError('Disconnected or timed out')
        response = await operation
        # The model/CLI and its file lock have finished. Cancel the disconnect
        # watcher before publishing the response so an immediate next turn does
        # not receive a spurious busy error. Clear this handler's reservation;
        # its finally block must not release a newer handler's reservation.
        disconnected.cancel()
        await asyncio.gather(disconnected, return_exceptions=True)
        tasks = []
        busy = reserved = False
        writer.write(json.dumps(response, separators=(',', ':')).encode() + b'\n')
        await writer.drain()
    except Exception as error:
        # Never include prompts, provider diagnostics, credentials or model text in errors/logs.
        print(json.dumps({'event': 'generation_failed', 'type': type(error).__name__}), flush=True)
        try:
            writer.write(json.dumps({'error': type(error).__name__}).encode() + b'\n')
            await writer.drain()
        except (ConnectionError, RuntimeError):
            pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if reserved:
            busy = False
        writer.close()
        try:
            await writer.wait_closed()
        except ConnectionError:
            pass


async def main():
    validate_policy()
    Path(SOCKET).unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, path=SOCKET, limit=MAX_REQUEST + 1)
    os.chmod(SOCKET, 0o660)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
