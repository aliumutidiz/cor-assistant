import base64
from pathlib import Path
import runpy
import unittest
import asyncio
import json
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, mock_open, patch

module = runpy.run_path(str(Path(__file__).with_name('agy-console.py')))
validate = module['validate_request']
Console = module['Console']


class ConsoleConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_check_timeout_replaces_stale_ready_and_reaps_process(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / 'connection.json'
            state_path.write_text(json.dumps({'state': 'ready'}))
            process = SimpleNamespace(
                communicate=AsyncMock(side_effect=asyncio.TimeoutError),
                returncode=None, pid=12345, wait=AsyncMock())
            kill = Mock()
            with patch.dict(Console.check.__globals__, {
                'Path': lambda _: state_path,
            }), patch('builtins.open', mock_open()), \
                    patch('fcntl.flock'), \
                    patch('os.killpg', kill), \
                    patch('asyncio.create_subprocess_exec', AsyncMock(return_value=process)):
                status = await Console().check()
            self.assertEqual(status['connection']['state'], 'provider_unreachable')
            self.assertIn('updatedAt', status['connection'])
            kill.assert_called_once()
            process.wait.assert_awaited_once()


class ConsoleBoundaryTests(unittest.TestCase):
    def test_shell_and_environment_overrides_are_rejected(self):
        for request in ({'control': 'exec'}, {'control': 'start', 'command': '/bin/bash'},
                        {'control': 'start', 'args': []}, {'control': 'start', 'env': {}}):
            with self.subTest(request=request), self.assertRaises(ValueError):
                validate(request)

    def test_input_cursor_and_resize_are_bounded(self):
        for request in ({'control': 'write', 'input': 'x' * 4097},
                        {'control': 'resize', 'cols': True}, {'control': 'resize', 'rows': 1000},
                        {'control': 'read', 'offset': -1}):
            with self.subTest(), self.assertRaises(ValueError):
                validate(request)

    def test_console_reads_require_matching_session_and_support_cursor_recovery(self):
        console = Console()
        console.session = 'a' * 43
        console.buffer.extend(b'visible output')
        console.base = 100
        with self.assertRaises(ValueError):
            console.control({'control': 'read', 'session': 'wrong', 'offset': 0})
        value = console.control({'control': 'read', 'session': console.session, 'offset': 0})
        self.assertTrue(value['reset'])
        self.assertEqual(base64.b64decode(value['data']), b'visible output')
