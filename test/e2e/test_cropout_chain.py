"""Unit tests for cropout-ue-chain run_step turn handling (run: npm run test:py)."""
import os
import sys
import threading
import unittest
from importlib import import_module
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
chain = import_module("cropout-ue-chain")

STEP = {"id": "open-map", "prompt": "Open Cropout_Map", "expect_tool": "ue_dispatch"}
TEXT = {"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "Dispatched."}]}}
DISPATCH = {"type": "tool_execution_start", "toolName": "ue_dispatch"}
DONE = {"type": "agent_end"}


def fake_reader(events):
    def read(_session_id, timeout_s, on_connected=None, stop_event=None):
        on_connected()
        return list(events)
    return read


class RunStepTest(unittest.TestCase):
    def run_step(self, reader, send=None):
        with mock.patch.object(chain.orch, "read_sse_events", side_effect=reader), \
             mock.patch.object(chain.orch, "send_prompt", side_effect=send):
            return chain.run_step("s1", STEP, turn_timeout=1)

    def test_completed_turn_has_no_timeout(self):
        violations, _, _ = self.run_step(fake_reader([TEXT, DISPATCH, DONE]))
        self.assertEqual(violations, [])

    def test_turn_without_completion_event_is_a_timeout(self):
        violations, _, _ = self.run_step(fake_reader([TEXT, DISPATCH]))
        self.assertIn("TURN_TIMEOUT: turn did not complete within 1s", violations)

    def test_send_failure_stops_the_reader(self):
        exited = threading.Event()
        stopped = []

        def blocking_reader(_session_id, timeout_s, on_connected=None, stop_event=None):
            on_connected()
            stopped.append(stop_event is not None and stop_event.wait(5))
            exited.set()
            return []

        violations, _, _ = self.run_step(blocking_reader, send=RuntimeError("503"))
        self.assertEqual(violations, ["SEND_FAILED: 503"])
        self.assertTrue(exited.is_set(), "reader thread still running after run_step returned")
        self.assertEqual(stopped, [True])


if __name__ == "__main__":
    unittest.main()
