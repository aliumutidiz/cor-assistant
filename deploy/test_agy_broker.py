import json
from pathlib import Path
import runpy
import unittest
import asyncio
import struct
from types import SimpleNamespace
from unittest.mock import patch

parse_request = runpy.run_path(str(Path(__file__).with_name('agy-broker.py')))['parse_request']
broker = runpy.run_path(str(Path(__file__).with_name('agy-broker.py')))


class BrokerOutputTests(unittest.TestCase):
    def result(self, output):
        return json.dumps({'event': 'result', 'result': {'status': 'SUCCESS', 'structured_output': output}}).encode()

    def test_startup_notices_and_string_encoded_structured_results(self):
        output = {'message': 'Günaydın'}
        for value in (output, json.dumps(output)):
            self.assertEqual(broker['parse_cli_output'](b'CLI starting\n' + self.result(value), b'', 0)['output'], output)

    def test_resume_metadata_is_separate_from_model_output(self):
        conversation = '055a398f-db14-4c5f-abbb-1bf03f8120a7'
        result = {'event': 'result', 'result': {'status': 'SUCCESS', 'conversation_id': conversation, 'structured_output': {'message': 'Hello'}}}
        parsed = broker['parse_cli_output'](json.dumps(result).encode(), b'', 0)
        self.assertEqual(parsed['_conversation_id'], conversation)
        self.assertEqual(parsed['output'], {'message': 'Hello'})

    def test_malformed_protocol_cannot_hide_behind_a_later_result(self):
        with self.assertRaises(broker['ModelOutputError']):
            broker['parse_cli_output'](b'{bad json\n' + self.result({}), b'', 0)

    def test_unauthorized_tools_are_never_accepted(self):
        event = json.dumps({'step_update': {'step_type': 'tool', 'tool_name': 'command'}}).encode()
        with self.assertRaises(broker['ModelToolPolicyError']):
            broker['parse_cli_output'](event + b'\n' + self.result({}), b'', 0)

    def test_classifies_failures_without_exposing_diagnostics(self):
        for text, error in ((b'UNAUTHENTICATED secret', 'ModelAuthError'),
                            (b'resource_exhausted', 'ModelQuotaError'),
                            (b'fetch failed', 'ModelUnavailableError'),
                            (b'deadline exceeded', 'TimeoutError')):
            expected = TimeoutError if error == 'TimeoutError' else broker[error]
            with self.subTest(error=error), self.assertRaises(expected) as caught:
                broker['parse_cli_output'](b'', text, 1)
            self.assertNotIn('secret', str(caught.exception))


class BrokerInputTests(unittest.TestCase):
    def test_only_prompt_and_object_schema_are_accepted(self):
        payload = {'prompt': 'Merhaba', 'schema': {'type': 'object'}}
        self.assertEqual(parse_request(json.dumps(payload)), payload)

    def test_command_or_model_overrides_are_rejected(self):
        for extra in ('command', 'args', 'model', 'env', 'cwd', 'socket'):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                parse_request(json.dumps({'prompt': 'Merhaba', 'schema': {'type': 'object'}, extra: 'override'}))

    def test_only_application_hashed_conversation_scopes_are_accepted(self):
        payload = {'prompt': 'Hello', 'schema': {'type':'object'}, 'conversation_key': 'a' * 64}
        self.assertEqual(parse_request(json.dumps(payload)), payload)
        for value in ('--continue', '../other', 'b' * 65, {'id':'anything'}):
            with self.assertRaises(ValueError):
                parse_request(json.dumps({**payload, 'conversation_key': value}))

    def test_invalid_or_oversized_inputs_are_rejected(self):
        for payload in ({'prompt': '', 'schema': {}}, {'prompt': 'x', 'schema': []},
                        {'prompt': 'x' * 96001, 'schema': {'type': 'object'}},
                        {'prompt': 'x', 'schema': {'type': 'object', 'description': 'x' * 65537}}):
            with self.subTest(), self.assertRaises(ValueError):
                parse_request(json.dumps(payload))


class BrokerSequentialTurnTests(unittest.IsolatedAsyncioTestCase):
    async def test_releases_completed_generation_before_publishing(self):
        handle = broker['handle']
        state = handle.__globals__
        published_while_busy = []

        async def generate(_data):
            return {'output': {'message': 'Done'}}

        class Reader:
            async def readline(self):
                return json.dumps({'prompt': 'Actual request', 'schema': {'type': 'object'}}).encode()

            async def read(self, _count):
                await asyncio.Future()

        class Writer:
            def get_extra_info(self, _name):
                return SimpleNamespace(getsockopt=lambda *_args: struct.pack('3i', 1, 123, 123))

            def write(self, data):
                published_while_busy.append((json.loads(data), state['busy']))

            async def drain(self):
                await asyncio.sleep(0)

            def close(self):
                pass

            async def wait_closed(self):
                await asyncio.sleep(0)

        with patch.dict(state, {'busy': False, 'generate': generate,
                              'pwd': SimpleNamespace(getpwnam=lambda _name: SimpleNamespace(pw_uid=123)),
                              'socket': SimpleNamespace(SOL_SOCKET=1, SO_PEERCRED=17)}):
            await asyncio.wait_for(handle(Reader(), Writer()), 2)
            self.assertEqual(published_while_busy, [({'output': {'message': 'Done'}}, False)])
            self.assertFalse(state['busy'])
