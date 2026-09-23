"""Unit tests for cropout-ue-chain run_step turn handling (run: npm run test:py)."""
import json
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
# lib/agent-event-stream.ts emits this, then closes the stream, when the session fails to start.
STARTUP_ERROR = {"type": "startup_error", "errorMessage": "Failed to start agent: broken config"}


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

    def test_chain_and_refs_see_one_snapshot(self):
        seen = {}
        real_extract = chain.orch.extract_chain

        def spy_extract(events):
            seen["chain"] = events
            return real_extract(events)

        def spy_refs(events):
            seen["refs"] = events
            return []

        with mock.patch.object(chain.orch, "extract_chain", side_effect=spy_extract), \
             mock.patch.object(chain, "dispatch_refs", side_effect=spy_refs):
            self.run_step(fake_reader([TEXT, DISPATCH, DONE]))
        self.assertIs(seen["chain"], seen["refs"])

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


class StartupErrorTest(unittest.TestCase):
    def test_startup_error_is_a_terminal_event(self):
        self.assertTrue(chain.orch.is_turn_complete(STARTUP_ERROR))

    def test_startup_error_before_connect_reports_the_server_message(self):
        # The server fails the session before it sends "connected".
        def failing_reader(_session_id, timeout_s, on_connected=None, stop_event=None):
            return [dict(STARTUP_ERROR)]

        with mock.patch.object(chain.orch, "read_sse_events", side_effect=failing_reader), \
             mock.patch.object(chain.orch, "send_prompt") as send:
            violations, _, _ = chain.run_step("s1", STEP, turn_timeout=90)
        send.assert_not_called()
        self.assertEqual(violations, ["STARTUP_ERROR: Failed to start agent: broken config"])

    def test_startup_error_after_connect_is_not_a_turn_timeout(self):
        with mock.patch.object(chain.orch, "read_sse_events", side_effect=fake_reader([STARTUP_ERROR])), \
             mock.patch.object(chain.orch, "send_prompt"):
            violations, _, _ = chain.run_step("s1", STEP, turn_timeout=1)
        self.assertIn("STARTUP_ERROR: Failed to start agent: broken config", violations)
        self.assertFalse([v for v in violations if v.startswith("TURN_TIMEOUT")], violations)

    def test_run_scenario_reports_startup_error(self):
        scenario = {"id": "startup", "input": "hi", "expect_text": True, "expect_text_first": False,
                    "expect_dispatch": False, "max_dispatches": 0}
        with mock.patch.object(chain.orch, "read_sse_events", return_value=[dict(STARTUP_ERROR)]), \
             mock.patch.object(chain.orch, "send_prompt"):
            result = chain.orch.run_scenario("s1", scenario)
        self.assertFalse(result["pass"])
        self.assertIn("STARTUP_ERROR: Failed to start agent: broken config", result["violations"])


def sse_chunk(event_type, **fields):
    """One chunked-transfer chunk holding one SSE event, as the Next.js route frames it."""
    body = f"data: {json.dumps({'type': event_type, **fields})}\n\n".encode()
    return f"{len(body):x}\r\n".encode() + body + b"\r\n"


class ReadSseConnectedTest(unittest.TestCase):
    def read(self, status, chunks):
        """Serve one SSE response on localhost; return (events, on_connected call count)."""
        import socket
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        self.addCleanup(srv.close)

        def serve():
            conn, _ = srv.accept()
            with conn:
                conn.recv(4096)
                conn.sendall(f"HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\n"
                             "Transfer-Encoding: chunked\r\n\r\n".encode())
                for c in chunks:
                    conn.sendall(c)
                conn.sendall(b"0\r\n\r\n")

        server = threading.Thread(target=serve, daemon=True)
        server.start()
        fired = []
        with mock.patch.object(chain.orch, "PI_WEB_URL", f"http://127.0.0.1:{srv.getsockname()[1]}"):
            events = chain.orch.read_sse_events("s1", timeout_s=5, on_connected=lambda: fired.append(1))
        server.join(timeout=5)
        return events, len(fired)

    def test_headers_alone_do_not_signal_connected(self):
        _, fired = self.read("200 OK", [sse_chunk("message_update"), sse_chunk("agent_end")])
        self.assertEqual(fired, 0)

    def test_connected_event_signals_once(self):
        events, fired = self.read("200 OK", [sse_chunk("connected"), sse_chunk("connected"),
                                             sse_chunk("agent_end")])
        self.assertEqual(fired, 1)
        self.assertEqual([e["type"] for e in events], ["connected", "connected", "agent_end"])

    def test_startup_error_ends_the_read(self):
        events, _ = self.read("200 OK", [sse_chunk("startup_error", errorMessage="boom"),
                                         sse_chunk("message_update")])
        self.assertEqual(events, [{"type": "startup_error", "errorMessage": "boom"}])

    def test_non_200_response_ends_the_read_with_its_status(self):
        events, fired = self.read("404 Not Found", [])
        self.assertEqual((events, fired), ([{"type": "sse_http_error", "status": 404}], 0))


class RunStepConnectTest(unittest.TestCase):
    def test_reader_that_ends_unconnected_fails_fast_with_its_reason(self):
        import time

        def http_error_reader(_session_id, timeout_s, on_connected=None, stop_event=None):
            return [{"type": "sse_http_error", "status": 404}]

        start = time.monotonic()
        with mock.patch.object(chain.orch, "read_sse_events", side_effect=http_error_reader), \
             mock.patch.object(chain.orch, "send_prompt") as send:
            violations, _, _ = chain.run_step("s1", STEP, turn_timeout=90)
        self.assertLess(time.monotonic() - start, 3)
        send.assert_not_called()
        self.assertEqual(violations, ["SSE_NOT_CONNECTED: event stream ended before subscribing (HTTP 404)"])


if __name__ == "__main__":
    unittest.main()
