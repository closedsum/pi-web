"""Unit tests for cropout-ue-chain run_step turn handling (run: npm run test:py)."""
import json
import os
import sys
import threading
import time as _real_time
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
# read_sse_events appends this when the response body can't be decoded.
PROTOCOL_ERROR = {"type": "sse_protocol_error", "error": "chunked body: bad chunk size b'zz'", "fatal": True}
SCENARIO = {"id": "startup", "input": "hi", "expect_text": True, "expect_text_first": False,
            "expect_dispatch": True, "max_dispatches": 1}
LANE = {"type": "tool_execution_start", "toolName": "DispatchLane"}


def connecting_reader(events):
    """A read_sse_events stand-in that subscribes, then returns a copy of events."""
    def read(_session_id, timeout_s, on_connected=None, stop_event=None):
        on_connected()
        return [dict(e) for e in events]
    return read


def unconnected_reader(events):
    """A read_sse_events stand-in that ends without ever subscribing."""
    def read(_session_id, timeout_s, on_connected=None, stop_event=None):
        return [dict(e) for e in events]
    return read


def run_step(reader, turn_timeout=1, send=None):
    """cropout run_step with a stand-in reader (or a list of events it returns after subscribing).

    Returns (violations, send_prompt mock).
    """
    if not callable(reader):
        reader = connecting_reader(reader)
    with mock.patch.object(chain.orch, "read_sse_events", side_effect=reader), \
         mock.patch.object(chain.orch, "send_prompt", side_effect=send) as send_mock:
        violations, _, _ = chain.run_step("s1", STEP, turn_timeout=turn_timeout)
    return violations, send_mock


def run_scenario(events, **scenario):
    """orchestrator run_scenario over events, with SCENARIO overridden by scenario."""
    with mock.patch.object(chain.orch, "read_sse_events", return_value=[dict(e) for e in events]), \
         mock.patch.object(chain.orch, "send_prompt"):
        return chain.orch.run_scenario("s1", {**SCENARIO, **scenario})


class RunStepTest(unittest.TestCase):
    def test_completed_turn_has_no_timeout(self):
        violations, _ = run_step([TEXT, DISPATCH, DONE])
        self.assertEqual(violations, [])

    def test_turn_without_completion_event_is_a_timeout(self):
        violations, _ = run_step([TEXT, DISPATCH])
        self.assertIn("TURN_TIMEOUT: turn did not complete within 1s", violations)

    def run_step_with_late_event(self, events, late_event):
        """run_step where the reader, outliving its join, appends late_event after the snapshot."""
        seen = {}
        real_snapshot, real_extract = chain.orch.snapshot_events, chain.orch.extract_chain

        def spy_snapshot(live):
            snap = real_snapshot(live)
            seen["live"], seen["snap"] = live, snap
            live.append(dict(late_event))
            return snap

        def spy_extract(snapshot):
            seen["chain"] = snapshot
            return real_extract(snapshot)

        def spy_refs(snapshot):
            seen["refs"] = snapshot
            return []

        with mock.patch.object(chain.orch, "snapshot_events", side_effect=spy_snapshot), \
             mock.patch.object(chain.orch, "extract_chain", side_effect=spy_extract), \
             mock.patch.object(chain, "dispatch_refs", side_effect=spy_refs):
            violations, _ = run_step(events)
        return violations, seen

    def test_turn_analysis_reads_one_copy_not_the_live_list(self):
        violations, seen = self.run_step_with_late_event([TEXT, DISPATCH], DONE)
        self.assertIsNot(seen["snap"], seen["live"])
        self.assertIs(seen["chain"], seen["snap"])
        self.assertIs(seen["refs"], seen["snap"])
        # The late completion event reached only the live list, so the TURN_TIMEOUT scan used the copy.
        self.assertIn(DONE, seen["live"])
        self.assertIn("TURN_TIMEOUT: turn did not complete within 1s", violations)

    def test_empty_snapshot_is_no_events_even_if_the_reader_appends_later(self):
        violations, _ = self.run_step_with_late_event([], TEXT)
        self.assertIn("NO_EVENTS: SSE stream returned nothing (timeout?)", violations)

    def test_send_failure_stops_the_reader(self):
        exited = threading.Event()
        stopped = []

        def blocking_reader(_session_id, timeout_s, on_connected=None, stop_event=None):
            on_connected()
            stopped.append(stop_event is not None and stop_event.wait(5))
            exited.set()
            return []

        violations, _ = run_step(blocking_reader, send=RuntimeError("503"))
        self.assertEqual(violations, ["SEND_FAILED: 503"])
        self.assertTrue(exited.is_set(), "reader thread still running after run_step returned")
        self.assertEqual(stopped, [True])


class StartupErrorTest(unittest.TestCase):
    def test_startup_error_is_a_terminal_event(self):
        self.assertTrue(chain.orch.is_turn_complete(STARTUP_ERROR))

    def test_startup_error_before_connect_reports_the_server_message(self):
        # The server fails the session before it sends "connected".
        violations, send = run_step(unconnected_reader([STARTUP_ERROR]), turn_timeout=90)
        send.assert_not_called()
        self.assertEqual(violations, ["STARTUP_ERROR: Failed to start agent: broken config"])

    def test_startup_error_after_connect_is_not_a_turn_timeout(self):
        violations, _ = run_step([STARTUP_ERROR])
        self.assertIn("STARTUP_ERROR: Failed to start agent: broken config", violations)
        self.assertFalse([v for v in violations if v.startswith("TURN_TIMEOUT")], violations)

    def test_run_scenario_reports_startup_error(self):
        result = run_scenario([STARTUP_ERROR], expect_dispatch=False, max_dispatches=0)
        self.assertFalse(result["pass"])
        self.assertIn("STARTUP_ERROR: Failed to start agent: broken config", result["violations"])


class StreamFailureTest(unittest.TestCase):
    """A stream that failed (startup_error, sse_protocol_error) is reported as that failure alone:
    no TURN_TIMEOUT / SSE_NOT_CONNECTED, and no NO_TEXT-style violations derived from missing events."""

    def test_protocol_error_before_connect_is_reported_not_sse_not_connected(self):
        violations, send = run_step(unconnected_reader([PROTOCOL_ERROR]), turn_timeout=90)
        send.assert_not_called()
        self.assertEqual(violations, [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_protocol_error_after_connect_is_reported_not_turn_timeout(self):
        violations, _ = run_step([TEXT, DISPATCH, PROTOCOL_ERROR])
        self.assertEqual(violations, [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_startup_error_after_connect_has_no_derivative_violations(self):
        violations, _ = run_step([STARTUP_ERROR])
        self.assertEqual(violations, ["STARTUP_ERROR: Failed to start agent: broken config"])

    def test_protocol_error_after_connect_has_no_derivative_violations(self):
        violations, _ = run_step([PROTOCOL_ERROR])
        self.assertEqual(violations, [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_run_scenario_startup_error_has_no_derivative_violations(self):
        result = run_scenario([STARTUP_ERROR])
        self.assertFalse(result["pass"])
        self.assertEqual(result["violations"], ["STARTUP_ERROR: Failed to start agent: broken config"])

    def test_run_scenario_reports_protocol_error_alone(self):
        result = run_scenario([PROTOCOL_ERROR])
        self.assertFalse(result["pass"])
        self.assertEqual(result["violations"], [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_behaviour_violations_survive_a_stream_failure(self):
        # A dispatch the model did make is still judged; only absence-based checks are dropped.
        violations, _ = run_step([LANE, PROTOCOL_ERROR])
        self.assertEqual(violations, [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}",
                                      "WRONG_TOOL: 1 DispatchLane call(s) for a UE operation"])


def chunk(data):
    """data framed as one HTTP/1.1 chunked-transfer chunk."""
    return f"{len(data):x}\r\n".encode() + data + b"\r\n"


def sse_chunk(event_type, **fields):
    """One chunked-transfer chunk holding one SSE event, as the Next.js route frames it."""
    return chunk(f"data: {json.dumps({'type': event_type, **fields})}\n\n".encode())


TWO_EVENTS = b'data: {"type": "connected"}\n\ndata: {"type": "agent_end"}\n\n'
END_EVENT = b'data: {"type": "agent_end"}\n\n'
END_SIZE = f"{len(END_EVENT):x}".encode()


def expect_protocol_error_after(test, stream, expected_types=()):
    """Feeding stream as one block yields expected_types' events, then one error that ends the body."""
    parser = chain.orch.SseBodyParser(chunked=True)
    events = parser.feed(stream)  # one block: the good events must survive the bad framing
    test.assertEqual([e["type"] for e in events], list(expected_types) + ["sse_protocol_error"], stream)
    test.assertTrue(parser.done)
    test.assertEqual(parser.feed(sse_chunk("agent_end")), [])


class SseBodyParserTest(unittest.TestCase):
    def test_data_line_split_across_chunks_is_reassembled(self):
        cut = TWO_EVENTS.index(b"agent")  # inside the second data line
        stream = chunk(TWO_EVENTS[:cut]) + chunk(TWO_EVENTS[cut:]) + b"0\r\n\r\n"
        parser = chain.orch.SseBodyParser(chunked=True)
        events = []
        for i in range(0, len(stream), 7):  # recv boundaries that split framing and data alike
            events += parser.feed(stream[i:i + 7])
        self.assertEqual([e["type"] for e in events], ["connected", "agent_end"])
        self.assertTrue(parser.done)

    def test_multibyte_character_split_across_feeds_is_intact(self):
        body = 'data: {"type": "text", "text": "héllo"}\n\n'.encode()
        cut = body.index("é".encode()) + 1  # between the two bytes of é
        parser = chain.orch.SseBodyParser(chunked=False)
        self.assertEqual(parser.feed(body[:cut]) + parser.feed(body[cut:]),
                         [{"type": "text", "text": "héllo"}])

    def test_malformed_chunk_size_keeps_earlier_events_then_ends(self):
        expect_protocol_error_after(self, sse_chunk("connected") + b"zz\r\n", ["connected"])

    def test_missing_crlf_after_chunk_data_keeps_earlier_events_then_ends(self):
        expect_protocol_error_after(self, sse_chunk("connected") + b"2\r\nabXY", ["connected"])

    def test_bad_json_is_reported_not_dropped(self):
        events = chain.orch.SseBodyParser(chunked=False).feed(b"data: {oops\n\n")
        self.assertEqual([e["type"] for e in events], ["sse_protocol_error"])

    def test_non_object_json_is_a_protocol_error(self):
        events = chain.orch.SseBodyParser(chunked=False).feed(b"data: null\n\ndata: [1]\n\n")
        self.assertEqual(len(events), 2, events)
        for event in events:
            self.assertIsInstance(event, dict)
            self.assertEqual(event.get("type"), "sse_protocol_error")
            self.assertIn("not a JSON object", event["error"])

    def test_negative_chunk_size_is_a_protocol_error(self):
        expect_protocol_error_after(self, sse_chunk("connected") + b"-1\r\n", ["connected"])
        # Before the fix, data after a negative size made feed() loop forever.
        expect_protocol_error_after(self, sse_chunk("connected") + b"-1\r\nXYZ\r\n0\r\n\r\n",
                                         ["connected"])

    def test_non_hex_chunk_sizes_are_protocol_errors(self):
        # int(x, 16) accepts all three; none is valid HTTP chunk-size syntax.
        for size in (b"0x5", b"+5", b"1_0"):
            with self.subTest(size=size):
                expect_protocol_error_after(self, sse_chunk("connected") + size + b"\r\n", ["connected"])

    def test_chunk_extension_is_ignored(self):
        body = b'data: {"type": "agent_end"}\n\n'
        stream = f"{len(body):x};ext=1\r\n".encode() + body + b"\r\n0\r\n\r\n"
        parser = chain.orch.SseBodyParser(chunked=True)
        self.assertEqual(parser.feed(stream), [{"type": "agent_end"}])
        self.assertTrue(parser.done)

    def test_lf_only_chunk_framing_is_a_protocol_error(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        events = parser.feed(b'1c\ndata: {"type": "agent_end"}\n\n\n')
        self.assertEqual([e["type"] for e in events], ["sse_protocol_error"])
        self.assertTrue(parser.done)

    def test_last_chunk_waits_for_the_end_of_its_trailer_section(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        self.assertEqual(parser.feed(sse_chunk("connected") + b"0\r\n"), [{"type": "connected"}])
        self.assertFalse(parser.done)
        self.assertEqual(parser.feed(b"X-Trailer: v\r\n\r\n"), [])
        self.assertTrue(parser.done)
        self.assertEqual(parser.finish(), [])

    def test_malformed_trailer_is_a_protocol_error(self):
        expect_protocol_error_after(self, sse_chunk("connected") + b"0\r\nBROKEN\r\n\r\n", ["connected"])

    def test_body_ending_mid_chunk_is_a_protocol_error(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        self.assertEqual(parser.feed(sse_chunk("connected") + b"10\r\npartial"), [{"type": "connected"}])
        self.assertEqual([e["type"] for e in parser.finish()], ["sse_protocol_error"])

    def test_body_ending_after_the_last_chunk_is_clean(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        parser.feed(sse_chunk("connected") + b"0\r\n\r\n")
        self.assertEqual(parser.finish(), [])

    def test_unchunked_body_ending_is_clean(self):
        parser = chain.orch.SseBodyParser(chunked=False)
        parser.feed(b'data: {"type": "agent_end"}\n\n')
        self.assertEqual(parser.finish(), [])


class ReadSseConnectedTest(unittest.TestCase):
    def read(self, status, chunks, terminate=True, with_headers=False, chunked=True):
        """Serve one SSE response on localhost; return (events, on_connected call count).

        terminate=False closes the connection without the last (0-size) chunk.
        with_headers=True sends the headers and the whole body in one sendall.
        chunked=False sends chunks as raw body bytes, with no Transfer-Encoding, and
        ends the body by closing the connection.
        """
        import socket
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        self.addCleanup(srv.close)

        def serve():
            conn, _ = srv.accept()
            with conn:
                conn.recv(4096)
                framing = "Transfer-Encoding: chunked\r\n" if chunked else ""
                head = (f"HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\n"
                        f"{framing}\r\n").encode()
                tail = [b"0\r\n\r\n"] if terminate and chunked else []
                try:
                    if with_headers:
                        conn.sendall(head + b"".join(list(chunks) + tail))
                    else:
                        conn.sendall(head)
                        for c in list(chunks) + tail:
                            conn.sendall(c)
                except ConnectionError:
                    pass  # the reader closes as soon as it has a terminal event or bad framing

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

    def test_event_split_across_chunks_is_not_corrupted(self):
        cut = TWO_EVENTS.index(b"agent")
        events, fired = self.read("200 OK", [chunk(TWO_EVENTS[:cut]), chunk(TWO_EVENTS[cut:])])
        self.assertEqual([e["type"] for e in events], ["connected", "agent_end"])
        self.assertEqual(fired, 1)

    def test_malformed_chunk_ends_the_read_with_a_protocol_error(self):
        events, _ = self.read("200 OK", [sse_chunk("connected"), b"zz\r\n"])
        self.assertEqual([e["type"] for e in events], ["connected", "sse_protocol_error"])

    def test_startup_error_ends_the_read(self):
        events, _ = self.read("200 OK", [sse_chunk("startup_error", errorMessage="boom"),
                                         sse_chunk("message_update")])
        self.assertEqual(events, [{"type": "startup_error", "errorMessage": "boom"}])

    def test_body_sent_with_the_headers_is_parsed(self):
        events, fired = self.read("200 OK", [sse_chunk("connected"), sse_chunk("agent_end")],
                                  with_headers=True)
        self.assertEqual([e["type"] for e in events], ["connected", "agent_end"])
        self.assertEqual(fired, 1)

    def test_non_object_json_is_reported_and_the_read_continues(self):
        events, _ = self.read("200 OK", [chunk(b"data: null\n\n"), sse_chunk("agent_end")])
        self.assertEqual([e["type"] for e in events], ["sse_protocol_error", "agent_end"])

    def test_negative_chunk_size_ends_the_read_with_a_protocol_error(self):
        events, _ = self.read("200 OK", [sse_chunk("connected"), b"-1\r\nX\r\n"])
        self.assertEqual([e["type"] for e in events], ["connected", "sse_protocol_error"])

    def test_connection_closed_mid_chunk_is_a_protocol_error(self):
        events, _ = self.read("200 OK", [sse_chunk("connected"), b"10\r\npartial"], terminate=False)
        self.assertEqual([e["type"] for e in events], ["connected", "sse_protocol_error"])

    def test_unchunked_body_is_read_until_the_connection_closes(self):
        events, fired = self.read("200 OK", [TWO_EVENTS[:20], TWO_EVENTS[20:]], chunked=False)
        self.assertEqual([e["type"] for e in events], ["connected", "agent_end"])
        self.assertEqual(fired, 1)

    def test_unchunked_body_closed_without_a_completion_event_says_so(self):
        events, _ = self.read("200 OK", [b'data: {"type": "connected"}\n\n'], chunked=False)
        self.assertEqual([e["type"] for e in events], ["connected", "sse_stream_ended"])

    def test_non_200_response_ends_the_read_with_its_status(self):
        events, fired = self.read("404 Not Found", [])
        self.assertEqual((events, fired), ([{"type": "sse_http_error", "status": 404}], 0))


class FakeClock:
    """read_sse_events' time module in tests: monotonic() moves only when FakeSocket times out,
    so a deadline can never pass while blocks are still being replayed, however loaded the machine."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def __getattr__(self, name):
        return getattr(_real_time, name)


class FakeSocket:
    """Socket stand-in for read_sse_events: recv() replays blocks; an exception block is raised.

    Once the blocks run out, recv() returns EOF, or with stall=True keeps timing out
    like a server that holds the connection open, each timeout advancing clock by 1s.
    """

    def __init__(self, blocks, stall=False, clock=None):
        self._blocks = list(blocks)
        self._stall = stall
        self._clock = clock

    def settimeout(self, _seconds):
        pass

    def sendall(self, _data):
        pass

    def recv(self, _size):
        if not self._blocks:
            if self._stall:
                if self._clock is not None:
                    self._clock.now += 1.0
                else:
                    threading.Event().wait(0.005)
                raise TimeoutError("timed out")  # what socket.timeout is since Python 3.10
            return b""
        block = self._blocks.pop(0)
        if isinstance(block, BaseException):
            raise block
        return block

    def close(self):
        pass


SSE_TYPE = b"Content-Type: text/event-stream\r\n"
CHUNKED_HEAD = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"Transfer-Encoding: chunked\r\n\r\n"
UNCHUNKED_HEAD = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"\r\n"
# A recovered bad data: line: the body keeps going, so the parser reports it as non-fatal.
BAD_DATA_LINE = {"type": "sse_protocol_error", "error": "bad JSON in data line: x", "fatal": False}


def read_blocks(blocks, timeout_s=5, stall=False, stop_event=None):
    """read_sse_events over a FakeSocket replaying blocks, on a FakeClock (deterministic deadlines)."""
    clock = FakeClock()
    with mock.patch("socket.create_connection", return_value=FakeSocket(blocks, stall=stall, clock=clock)), \
         mock.patch.object(chain.orch, "time", clock):
        return chain.orch.read_sse_events("s1", timeout_s=timeout_s, stop_event=stop_event)


class ReadEndTest(unittest.TestCase):
    """R2/R9/R11: every way the read ends finishes the parser, and says how it ended."""

    def test_connection_error_mid_body_is_a_fatal_protocol_error(self):
        events = read_blocks([CHUNKED_HEAD + sse_chunk("connected") + b"10\r\npart",
                              ConnectionResetError("reset by peer")])
        self.assertEqual([e["type"] for e in events], ["connected", "sse_protocol_error"])
        self.assertTrue(events[-1]["fatal"])
        self.assertIn("ConnectionResetError", events[-1]["error"])

    def test_stopping_at_the_deadline_is_not_a_protocol_error(self):
        # The server is still sending; giving up on it is a timeout, judged as TURN_TIMEOUT.
        events = read_blocks([CHUNKED_HEAD + sse_chunk("connected") + b"10\r\npart"],
                             timeout_s=0.1, stall=True)
        self.assertEqual([e["type"] for e in events], ["connected"])

    def test_cut_inside_the_trailer_section_says_so(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        parser.feed(sse_chunk("connected") + b"0\r\n")
        [error] = parser.finish()
        self.assertIn("trailer section", error["error"])

    def test_cut_before_the_last_chunk_says_so(self):
        parser = chain.orch.SseBodyParser(chunked=True)
        parser.feed(sse_chunk("connected") + b"10\r\npart")
        [error] = parser.finish()
        self.assertIn("before the last chunk", error["error"])
        self.assertTrue(error["fatal"])

    def test_unchunked_body_ending_mid_line_is_a_fatal_protocol_error(self):
        # An SSE event ends at its blank line; a body cut before it holds no complete event.
        for tail in (b'data: {"type": "agent_end"}', b'data: {"type": "agent_'):
            with self.subTest(tail=tail):
                parser = chain.orch.SseBodyParser(chunked=False)
                self.assertEqual(parser.feed(tail), [])
                self.assertFalse(parser.done)
                [error] = parser.finish()
                self.assertEqual(error["type"], "sse_protocol_error")
                self.assertTrue(error["fatal"])
                self.assertTrue(parser.done)

    def test_event_is_dispatched_only_at_its_blank_line(self):
        parser = chain.orch.SseBodyParser(chunked=False)
        self.assertEqual(parser.feed(b'data: {"type": "agent_end"}\n'), [])
        self.assertEqual(parser.feed(b"\n"), [{"type": "agent_end"}])

    def test_body_ending_after_a_data_line_without_its_blank_line_is_fatal(self):
        for chunked in (False, True):
            with self.subTest(chunked=chunked):
                line = b'data: {"type": "agent_end"}\n'
                parser = chain.orch.SseBodyParser(chunked=chunked)
                self.assertEqual(parser.feed(chunk(line) + b"0\r\n\r\n" if chunked else line), [])
                [error] = parser.finish()
                self.assertTrue(error["fatal"])
                self.assertIn("mid-event", error["error"])

    def test_read_cut_after_a_completion_line_is_not_a_completed_turn(self):
        events = read_blocks([CHUNKED_HEAD + chunk(b'data: {"type": "agent_end"}\n')])
        self.assertEqual([e["type"] for e in events], ["sse_protocol_error"])
        self.assertEqual([chain.orch.violation_code(v) for v in chain.orch.judge_turn(events, [], 1)],
                         ["SSE_PROTOCOL_ERROR"])

    def test_connection_error_before_the_headers_is_a_fatal_protocol_error(self):
        events = read_blocks([b"HTTP/1.1 200 OK\r\nTransfer-", ConnectionResetError("reset by peer")])
        [error] = events
        self.assertEqual(error["type"], "sse_protocol_error")
        self.assertTrue(error["fatal"])
        self.assertIn("ConnectionResetError", error["error"])
        self.assertIn("headers", error["error"])

    def test_close_before_the_headers_is_a_fatal_protocol_error(self):
        for blocks in ([b"HTTP/1.1 200 OK\r\n"], []):
            with self.subTest(blocks=blocks):
                [error] = read_blocks(blocks)
                self.assertTrue(error["fatal"])
                self.assertIn("headers", error["error"])

    def test_failed_connect_is_a_fatal_protocol_error(self):
        with mock.patch("socket.create_connection", side_effect=ConnectionRefusedError("refused")):
            [error] = chain.orch.read_sse_events("s1", timeout_s=5)
        self.assertTrue(error["fatal"])
        self.assertIn("ConnectionRefusedError", error["error"])

    def test_stream_that_ends_without_a_completion_event_says_so(self):
        # The server closed the stream early: its own failure code, not a timeout.
        for head, body in ((CHUNKED_HEAD, sse_chunk("connected") + b"0\r\n\r\n"),
                           (UNCHUNKED_HEAD, b'data: {"type": "connected"}\n\n')):
            with self.subTest(head=head):
                events = read_blocks([head + body])
                self.assertEqual([e["type"] for e in events], ["connected", "sse_stream_ended"])
                self.assertEqual(chain.orch.judge_turn(events, [], 300),
                                 ["STREAM_ENDED_EARLY: event stream ended without a completion event"])

    def test_oversized_header_block_is_a_protocol_error(self):
        # Whether or not the blank line that ends the headers arrives in the same read.
        for blocks in ([b"HTTP/1.1 200 OK\r\nX-Pad: " + b"a" * 100, b"\r\n\r\n"],
                       [b"HTTP/1.1 200 OK\r\nX-Pad: " + b"a" * 100 + b"\r\n\r\n"]):
            with self.subTest(blocks=len(blocks)), mock.patch.object(chain.orch, "MAX_SSE_HEADER_BYTES", 64):
                [error] = read_blocks(blocks)
                self.assertTrue(error["fatal"])
                self.assertIn("headers", error["error"])

    def test_oversized_sse_line_is_a_protocol_error(self):
        with mock.patch.object(chain.orch, "MAX_SSE_LINE_BYTES", 64):
            parser = chain.orch.SseBodyParser(chunked=False)
            events = parser.feed(b"data: " + b"x" * 40) + parser.feed(b"x" * 40)
        [error] = events
        self.assertTrue(error["fatal"])
        self.assertTrue(parser.done)
        self.assertEqual(parser.feed(b'\n\ndata: {"type": "agent_end"}\n\n'), [])

    def test_oversized_sse_line_ended_in_the_same_feed_is_a_protocol_error(self):
        with mock.patch.object(chain.orch, "MAX_SSE_LINE_BYTES", 64):
            parser = chain.orch.SseBodyParser(chunked=False)
            [error] = parser.feed(b'data: {"type": "agent_end", "pad": "' + b"x" * 100 + b'"}\n\n')
        self.assertTrue(error["fatal"])

    def test_deadline_before_the_headers_is_reported_without_hiding_the_timeout(self):
        [error] = read_blocks([b"HTTP/1.1 200 OK\r\n"], timeout_s=0.1, stall=True)
        self.assertFalse(error["fatal"])
        self.assertIn("headers", error["error"])
        self.assertEqual([chain.orch.violation_code(v) for v in chain.orch.judge_turn([error], [], 1)],
                         ["SSE_PROTOCOL_ERROR", "TURN_TIMEOUT"])

    def test_stop_request_before_the_headers_reports_nothing(self):
        # The caller stopped the read (e.g. the connect deadline) and reports that itself.
        stop = threading.Event()
        stop.set()
        self.assertEqual(read_blocks([b"HTTP/1.1"], stall=True, stop_event=stop), [])

    def test_response_that_is_not_an_event_stream_is_rejected(self):
        for head in (b"HTTP/1.1 200 OK\r\n\r\n", b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"):
            for together in (True, False):  # the body in the same read as the headers, or later
                with self.subTest(head=head, together=together):
                    blocks = [head + END_EVENT] if together else [head, END_EVENT]
                    [error] = read_blocks(blocks)
                    self.assertTrue(error["fatal"])
                    self.assertIn("event stream", error["error"])

    def test_event_stream_media_type_matching_ignores_case_and_parameters(self):
        head = b"HTTP/1.1 200 OK\r\ncontent-type: Text/Event-Stream; charset=utf-8\r\n\r\n"
        events = read_blocks([head + b'data: {"type": "agent_end"}\n\n'])
        self.assertEqual(events, [{"type": "agent_end"}])

    def test_unsupported_transfer_coding_is_rejected(self):
        for coding in (b"gzip, chunked", b"gzip", b"notchunked"):
            with self.subTest(coding=coding):
                head = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"Transfer-Encoding: " + coding + b"\r\n\r\n"
                [error] = read_blocks([head + sse_chunk("agent_end")])
                self.assertTrue(error["fatal"])
                self.assertIn(f"transfer coding ({coding.decode()})", error["error"])

    def test_server_event_with_a_reserved_type_is_a_protocol_error(self):
        # The reader's own event types can't come from the server: they would be judged as the reader's.
        for reserved in ("sse_protocol_error", "sse_stream_ended", "sse_http_error"):
            with self.subTest(reserved=reserved):
                line = f'data: {{"type": "{reserved}", "error": "x"}}\n\n'.encode()
                [error] = chain.orch.SseBodyParser(chunked=False).feed(line)
                self.assertEqual(error["type"], "sse_protocol_error")
                self.assertFalse(error["fatal"])
                self.assertIn("reserved", error["error"])
        events = read_blocks([UNCHUNKED_HEAD + b'data: {"type": "sse_protocol_error", "error": "x"}\n\n'])
        self.assertEqual([e["type"] for e in events], ["sse_protocol_error", "sse_stream_ended"])

    def test_non_string_event_type_does_not_raise(self):
        for kind in ([1], {}, 7, None):
            with self.subTest(kind=kind):
                line = f'data: {json.dumps({"type": kind})}\n\n'.encode()
                self.assertEqual(chain.orch.SseBodyParser(chunked=False).feed(line), [{"type": kind}])

    def test_interim_responses_count_toward_the_header_limit(self):
        hint = b"HTTP/1.1 103 Early Hints\r\n\r\n"
        with mock.patch.object(chain.orch, "MAX_SSE_HEADER_BYTES", 64):
            [error] = read_blocks([hint, hint, hint], stall=True)
        self.assertTrue(error["fatal"])
        self.assertIn("headers longer", error["error"])

    def test_header_byte_count_includes_skipped_interim_heads(self):
        hint = b"HTTP/1.1 103 Early Hints\r\n\r\n"
        [error] = read_blocks([hint, hint, b"HTTP/1.1 200"], timeout_s=0.1, stall=True)
        self.assertIn(f"({2 * len(hint) + 12} header bytes received)", error["error"])

    def test_event_built_from_many_short_lines_is_bounded(self):
        with mock.patch.object(chain.orch, "MAX_SSE_LINE_BYTES", 64):
            parser = chain.orch.SseBodyParser(chunked=False)
            events = parser.feed(b"data: aaaaaaaaaa\n" * 20)
        [error] = events
        self.assertTrue(error["fatal"])
        self.assertIn("event longer", error["error"])

    def test_pre_header_errors_are_marked_as_such(self):
        [timed_out] = read_blocks([b"HTTP/1.1 200 OK\r\n"], timeout_s=0.1, stall=True)
        [closed] = read_blocks([b"HTTP/1.1 200 OK\r\n"])
        [rejected] = read_blocks([b"HTTP/1.1 200 OK\r\n\r\n"])
        self.assertEqual([e.get("phase") for e in (timed_out, closed, rejected)], ["headers"] * 3)

    def test_malformed_status_line_is_a_protocol_error(self):
        for status_line in (b"HTTP/1.1 OK", b"HTTP/1.1 2000 OK", b"HTTP/9 200 OK", b"garbage"):
            with self.subTest(status_line=status_line):
                [error] = read_blocks([status_line + b"\r\n" + SSE_TYPE + b"\r\n"])
                self.assertTrue(error["fatal"])
                self.assertIn("status line", error["error"])

    def test_interim_responses_before_the_final_one_are_skipped(self):
        early_hints = b"HTTP/1.1 103 Early Hints\r\nLink: </x>; rel=preload\r\n\r\n"
        for blocks in ([early_hints + CHUNKED_HEAD + sse_chunk("agent_end")],
                       [early_hints, CHUNKED_HEAD, sse_chunk("agent_end")]):
            with self.subTest(blocks=len(blocks)):
                self.assertEqual(read_blocks(blocks), [{"type": "agent_end"}])

    def test_content_length_framing_is_rejected(self):
        for te in (b"", b"Transfer-Encoding: chunked\r\n"):
            with self.subTest(te=te):
                head = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + te + b"Content-Length: 29\r\n\r\n"
                [error] = read_blocks([head + b'data: {"type": "agent_end"}\n\n'])
                self.assertTrue(error["fatal"])
                self.assertIn("Content-Length", error["error"])

    def test_content_encoding_other_than_identity_is_rejected(self):
        head = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"Content-Encoding: gzip\r\n\r\n"
        [error] = read_blocks([head + b"\x1f\x8b"])
        self.assertTrue(error["fatal"])
        self.assertIn("Content-Encoding (gzip)", error["error"])
        identity = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"Content-Encoding: identity\r\n\r\n"
        self.assertEqual(read_blocks([identity + END_EVENT]), [{"type": "agent_end"}])

    def test_repeated_content_type_is_rejected(self):
        head = b"HTTP/1.1 200 OK\r\n" + SSE_TYPE + b"Content-Type: text/html\r\n\r\n"
        [error] = read_blocks([head + END_EVENT])
        self.assertTrue(error["fatal"])
        self.assertIn("Content-Type", error["error"])

    def test_body_ending_after_a_comment_says_mid_block_not_mid_event(self):
        parser = chain.orch.SseBodyParser(chunked=False)
        parser.feed(b":\n")
        [error] = parser.finish()
        self.assertTrue(error["fatal"])
        self.assertIn("mid-block", error["error"])

    def test_oversized_chunk_line_is_a_protocol_error(self):
        with mock.patch.object(chain.orch, "MAX_CHUNK_LINE_BYTES", 64):
            parser = chain.orch.SseBodyParser(chunked=True)
            [error] = parser.feed(b"1;" + b"x" * 100)
        self.assertTrue(error["fatal"])

    def test_data_errors_are_non_fatal_and_framing_errors_fatal(self):
        [bad_json] = chain.orch.SseBodyParser(chunked=False).feed(b"data: {oops\n\n")
        self.assertFalse(bad_json["fatal"])
        parser = chain.orch.SseBodyParser(chunked=True)
        framing = parser.feed(b"zz\r\n")
        self.assertTrue(framing[-1]["fatal"])


class ChunkSyntaxTest(unittest.TestCase):
    """R5/R8: chunk-size and trailer lines follow RFC 9112's grammar."""

    def assert_rejected(self, stream):
        expect_protocol_error_after(self, stream)

    def assert_accepted(self, size_line):
        parser = chain.orch.SseBodyParser(chunked=True)
        self.assertEqual(parser.feed(size_line + b"\r\n" + END_EVENT + b"\r\n0\r\n\r\n"),
                         [{"type": "agent_end"}], size_line)

    def test_whitespace_around_a_bare_chunk_size_is_rejected(self):
        for line in (b" " + END_SIZE, END_SIZE + b" "):
            with self.subTest(line=line):
                self.assert_rejected(line + b"\r\n" + END_EVENT + b"\r\n0\r\n\r\n")

    def test_whitespace_before_a_chunk_extension_is_allowed(self):
        for ext in (b" ;ext=1", b"\t;ext"):
            with self.subTest(ext=ext):
                self.assert_accepted(END_SIZE + ext)

    def test_trailer_field_name_must_be_a_token(self):
        for trailer in (b": v", b"X Trailer: v", b"X@Trailer: v"):
            with self.subTest(trailer=trailer):
                self.assert_rejected(b"0\r\n" + trailer + b"\r\n\r\n")

    def test_trailer_value_control_characters_are_rejected(self):
        for trailer in (b"X-T: a\x00b", b"X-T: a\rb", b"X-T: a\x7fb", b"X-T: a\x1bb"):
            with self.subTest(trailer=trailer):
                self.assert_rejected(b"0\r\n" + trailer + b"\r\n\r\n")

    def test_valid_trailer_values_are_accepted(self):
        for trailer in (b"X-T: v", b"X-T:", b"X-T: a b\tc", "X-T: café".encode()):
            with self.subTest(trailer=trailer):
                parser = chain.orch.SseBodyParser(chunked=True)
                self.assertEqual(parser.feed(b"0\r\n" + trailer + b"\r\n\r\n"), [])
                self.assertTrue(parser.done)

    def test_invalid_chunk_extensions_are_rejected(self):
        for ext in (b";@", b";ext=", b";=v", b';ext="open', b";ext=a b", b";", b";ext;"):
            with self.subTest(ext=ext):
                self.assert_rejected(END_SIZE + ext + b"\r\n" + END_EVENT + b"\r\n0\r\n\r\n")

    def test_valid_chunk_extensions_are_accepted(self):
        for ext in (b";a", b";a=1", b'; a = "q \\" v"', b";a=1;b", b" ; a ; b=c"):
            with self.subTest(ext=ext):
                self.assert_accepted(END_SIZE + ext)

    def test_overlong_chunk_size_is_rejected(self):
        self.assert_rejected(b"1" + b"0" * 16 + b"\r\n")

    def test_leading_zeros_do_not_make_a_chunk_size_too_large(self):
        self.assert_accepted(b"0" * 20 + END_SIZE)

    def test_chunk_line_limit_counts_the_line_not_its_crlf(self):
        with mock.patch.object(chain.orch, "MAX_CHUNK_LINE_BYTES", 8):
            self.assert_accepted(END_SIZE + b";abcde")  # exactly 8 bytes before the CRLF
            self.assert_rejected(END_SIZE + b";abcdef\r\n" + END_EVENT + b"\r\n0\r\n\r\n")


class TransferCodingTest(unittest.TestCase):
    """Repeated Transfer-Encoding lines combine into one ordered coding list (RFC 9110 5.3)."""

    def head(self, *fields):
        return b"\r\n".join([b"HTTP/1.1 200 OK", *fields])

    def test_codings_combine_across_field_lines_in_order(self):
        cases = {
            (b"Transfer-Encoding: chunked",): [b"chunked"],
            (b"transfer-encoding:  Chunked ",): [b"chunked"],
            (b"Transfer-Encoding: gzip, chunked",): [b"gzip", b"chunked"],
            (b"Transfer-Encoding: gzip", b"Transfer-Encoding: chunked"): [b"gzip", b"chunked"],
            (b"Transfer-Encoding: chunked", b"Transfer-Encoding: gzip"): [b"chunked", b"gzip"],
            (b"X-Foo: chunked",): [],
            (): [],
        }
        for fields, expected in cases.items():
            with self.subTest(fields=fields):
                self.assertEqual(chain.orch._transfer_codings(self.head(*fields)), expected)


class StreamPolicyTest(unittest.TestCase):
    """R3/R4/R6: one policy decides which violations a failed stream explains."""

    def test_recovered_bad_data_line_keeps_absence_violations(self):
        violations, _ = run_step([BAD_DATA_LINE, DONE])
        self.assertEqual(violations, ["SSE_PROTOCOL_ERROR: bad JSON in data line: x",
                                      "NO_TEXT: model returned no text",
                                      "NO_DISPATCH: expected ue_dispatch but got none"])

    def test_run_scenario_recovered_bad_data_line_keeps_absence_violations(self):
        result = run_scenario([BAD_DATA_LINE, DONE])
        self.assertEqual([v.split(":")[0] for v in result["violations"]],
                         ["SSE_PROTOCOL_ERROR", "NO_TEXT_RESPONSE", "MISSING_DISPATCH"])

    def test_incomplete_turn_drops_absence_violations(self):
        violations, _ = run_step([{"type": "connected"}])
        self.assertEqual(violations, ["TURN_TIMEOUT: turn did not complete within 1s"])

    def test_run_scenario_reports_an_incomplete_turn(self):
        result = run_scenario([{"type": "connected"}])
        self.assertFalse(result["pass"])
        self.assertEqual([v.split(":")[0] for v in result["violations"]], ["TURN_TIMEOUT"])

    def test_non_fatal_error_in_an_incomplete_turn_keeps_the_timeout(self):
        violations, _ = run_step([BAD_DATA_LINE])
        self.assertEqual(violations, ["SSE_PROTOCOL_ERROR: bad JSON in data line: x",
                                      "TURN_TIMEOUT: turn did not complete within 1s"])

    def test_turn_too_slow_is_dropped_by_a_fatal_stream_failure(self):
        result = run_scenario([STARTUP_ERROR], max_turn_time_s=1e-9)
        self.assertEqual(result["violations"], ["STARTUP_ERROR: Failed to start agent: broken config"])

    def test_turn_too_slow_is_kept_for_a_healthy_stream(self):
        result = run_scenario([TEXT, LANE, DONE], max_turn_time_s=1e-9)
        self.assertEqual([v.split(":")[0] for v in result["violations"]], ["TURN_TOO_SLOW"])

    def test_dispatch_without_text_is_explained_by_a_fatal_stream_failure(self):
        result = run_scenario([LANE, PROTOCOL_ERROR], expect_text_first=True)
        self.assertEqual(result["violations"], [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_dispatch_without_text_is_reported_for_a_completed_turn(self):
        result = run_scenario([LANE, DONE], expect_text_first=True, expect_text=False)
        self.assertEqual([v.split(":")[0] for v in result["violations"]], ["DISPATCH_WITHOUT_TEXT"])

    def test_dispatch_before_text_is_reported_for_a_completed_turn(self):
        result = run_scenario([LANE, TEXT, DONE], expect_text_first=True)
        self.assertEqual([v.split(":")[0] for v in result["violations"]], ["DISPATCH_BEFORE_TEXT"])

    def test_dispatch_before_text_survives_a_fatal_stream_failure(self):
        # Something the model did, not something missing: a broken stream doesn't explain it.
        result = run_scenario([LANE, TEXT, PROTOCOL_ERROR], expect_text_first=True)
        self.assertEqual([v.split(":")[0] for v in result["violations"]],
                         ["SSE_PROTOCOL_ERROR", "DISPATCH_BEFORE_TEXT"])

    def test_several_protocol_errors_name_the_fatal_one_and_count_the_rest(self):
        judged = chain.orch.judge_turn([dict(BAD_DATA_LINE), dict(PROTOCOL_ERROR)], [], 1)
        self.assertEqual(judged, [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']} (+1 more)"])

    def test_protocol_error_without_a_fatal_flag_is_refused(self):
        # An unmarked error must not be silently treated as fatal (or as recovered).
        with self.assertRaises(ValueError):
            chain.orch.stream_failed_fatally([{"type": "sse_protocol_error", "error": "x"}])

    def test_malformed_stream_event_fails_its_turn_not_the_whole_run(self):
        unmarked = [{"type": "sse_protocol_error", "error": "x"}]
        # An unjudgeable stream explains missing events too: derivative checks are dropped.
        for judged, kept in ((chain.orch.judge_turn(unmarked, ["WRONG_TOOL: w", "NO_TEXT: t"], 1),
                              ["WRONG_TOOL: w"]),
                             (chain.orch.judge_abort(unmarked, "SSE_NOT_CONNECTED: n"), ["SSE_NOT_CONNECTED: n"])):
            with self.subTest(judged=judged):
                self.assertEqual(chain.orch.violation_code(judged[0]), "SSE_PROTOCOL_ERROR")
                self.assertIn("boolean 'fatal'", judged[0])
                self.assertEqual(judged[1:], kept)

    def test_clean_stream_end_with_no_events_is_still_no_events(self):
        violations, _ = run_step([{"type": "sse_stream_ended"}])
        self.assertEqual(violations, ["STREAM_ENDED_EARLY: event stream ended without a completion event",
                                      "NO_EVENTS: SSE stream returned nothing (timeout?)"])

    def test_both_harnesses_judge_turns_with_the_shared_policy(self):
        calls = []
        real = chain.orch.judge_turn

        def spy(*args, **kwargs):
            calls.append(args)
            return real(*args, **kwargs)

        with mock.patch.object(chain.orch, "judge_turn", side_effect=spy):
            run_step([TEXT, DISPATCH, DONE])
            run_scenario([TEXT, DONE])
        self.assertEqual(len(calls), 2)


class PreConnectTest(unittest.TestCase):
    """R1/R10: a step that never subscribes reports every stream failure the reader saw."""

    def run_step(self, reader):
        violations, send = run_step(reader)
        send.assert_not_called()
        return violations

    @staticmethod
    def reader_until_stopped(events):
        """A live reader still running at the connect deadline; its events land when stopped."""
        def read(_session_id, timeout_s, on_connected=None, stop_event=None):
            stop_event.wait(5)
            return [dict(e) for e in events]
        return read

    def test_non_fatal_error_before_the_connect_deadline_is_reported(self):
        self.assertEqual(self.run_step(self.reader_until_stopped([BAD_DATA_LINE])),
                         ["SSE_PROTOCOL_ERROR: bad JSON in data line: x",
                          "SSE_NOT_CONNECTED: event stream did not subscribe within 1s"])

    def test_fatal_error_before_the_connect_deadline_replaces_not_connected(self):
        self.assertEqual(self.run_step(self.reader_until_stopped([PROTOCOL_ERROR])),
                         [f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])

    def test_headers_that_never_arrived_explain_the_missing_subscription(self):
        timed_out = {"type": "sse_protocol_error", "fatal": False, "phase": "headers",
                     "error": "response headers did not arrive within 1s (17 header bytes received)"}
        self.assertEqual(self.run_step(unconnected_reader([timed_out])),
                         [f"SSE_PROTOCOL_ERROR: {timed_out['error']}"])

    def test_rejected_response_replaces_not_connected(self):
        with mock.patch("socket.create_connection",
                        return_value=FakeSocket([b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"])), \
             mock.patch.object(chain.orch, "send_prompt") as send:
            violations, _, _ = chain.run_step("s1", STEP, turn_timeout=1)
        send.assert_not_called()
        self.assertEqual([chain.orch.violation_code(v) for v in violations], ["SSE_PROTOCOL_ERROR"])
        self.assertIn("text/html", violations[0])

    def test_every_pre_connect_failure_is_reported(self):
        self.assertEqual(self.run_step(unconnected_reader([STARTUP_ERROR, PROTOCOL_ERROR])),
                         ["STARTUP_ERROR: Failed to start agent: broken config",
                          f"SSE_PROTOCOL_ERROR: {PROTOCOL_ERROR['error']}"])


class ViolationRegistryTest(unittest.TestCase):
    """R7: every violation is built from a registered code, so the derivative set can't drift."""

    HARNESSES = ("orchestrator-e2e.py", "cropout-ue-chain.py")
    CODE_LITERAL = __import__("re").compile(r"^[A-Z]+(?:_[A-Z]+)+: ")

    def harness_trees(self):
        import ast
        here = os.path.dirname(os.path.abspath(__file__))
        for name in self.HARNESSES:
            with open(os.path.join(here, name), encoding="utf-8") as f:
                yield name, ast.parse(f.read())

    def test_violation_strings_are_only_built_by_violation(self):
        import ast
        literals = []
        for name, tree in self.harness_trees():
            for node in ast.walk(tree):
                text = None
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    text = node.value
                elif isinstance(node, ast.JoinedStr) and node.values and isinstance(node.values[0], ast.Constant):
                    text = node.values[0].value
                if text and self.CODE_LITERAL.match(text):
                    literals.append(f"{name}:{node.lineno}: {text[:40]}")
        self.assertEqual(literals, [], "build violations with violation(V.CODE, detail)")

    def test_every_violation_call_uses_a_registered_code(self):
        import ast
        codes = []
        for name, tree in self.harness_trees():
            for node in ast.walk(tree):
                func = getattr(node, "func", None)
                called = getattr(func, "attr", None) or getattr(func, "id", None)
                if isinstance(node, ast.Call) and called == "violation":
                    arg = node.args[0]
                    self.assertTrue(isinstance(arg, ast.Attribute) and
                                    getattr(arg.value, "id", getattr(arg.value, "attr", None)) == "V",
                                    f"{name}:{node.lineno}: violation() needs a V.CODE constant")
                    codes.append(arg.attr)
        self.assertTrue(codes)
        for code in codes:
            self.assertIn(getattr(chain.orch.V, code), chain.orch.VIOLATION_KINDS, code)

    def test_derivative_set_is_the_registry_derivative_kind(self):
        kinds = chain.orch.VIOLATION_KINDS
        self.assertTrue(set(kinds.values()) <= {"stream", "behaviour", "derivative"})
        self.assertEqual(chain.orch.DERIVATIVE_VIOLATIONS,
                         {code for code, kind in kinds.items() if kind == "derivative"})
        for code in ("NO_TEXT_RESPONSE", "MISSING_DISPATCH", "DISPATCH_WITHOUT_TEXT", "NO_TEXT",
                     "NO_DISPATCH", "TURN_TOO_SLOW"):
            self.assertEqual(kinds[code], "derivative", code)

    def test_unregistered_code_is_refused(self):
        with self.assertRaises(KeyError):
            chain.orch.violation("NOT_A_CODE", "x")


class RunStepConnectTest(unittest.TestCase):
    def test_reader_that_ends_unconnected_fails_fast_with_its_reason(self):
        import time

        start = time.monotonic()
        violations, send = run_step(unconnected_reader([{"type": "sse_http_error", "status": 404}]),
                                    turn_timeout=90)
        self.assertLess(time.monotonic() - start, 3)
        send.assert_not_called()
        self.assertEqual(violations, ["SSE_NOT_CONNECTED: event stream ended before subscribing (HTTP 404)"])


if __name__ == "__main__":
    unittest.main()
