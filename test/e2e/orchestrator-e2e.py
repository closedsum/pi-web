"""Live e2e tests for orchestrator behavior across models.

Usage:
    python test/e2e/orchestrator-e2e.py                              # defaults: test/test-model.json
    python test/e2e/orchestrator-e2e.py --provider openai-codex --model gpt-6-luna --effort medium
    python test/e2e/orchestrator-e2e.py --scenario implementation-request   # run one scenario
    python test/e2e/orchestrator-e2e.py --list                       # list available scenarios

Requires pi-web dev server running at PI_WEB_URL (default http://127.0.0.1:30141).
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(line_buffering=True)
PI_WEB_URL = os.environ.get("PI_WEB_URL", "http://127.0.0.1:30141")
TEST_CWD = os.environ.get("PI_WEB_TEST_CWD", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
TURN_TIMEOUT_S = int(os.environ.get("PI_WEB_TURN_TIMEOUT", "120"))


TEST_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test-model.json")


def load_test_model(env=None, path=TEST_MODEL_PATH):
    """Provider/model/effort from test/test-model.json; non-empty PI_TEST_* env vars override.

    Raises ValueError naming the problem when the file is unreadable or invalid.
    """
    env = os.environ if env is None else env
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"cannot load test model config {path}: {e}") from e
    _validate_test_model(cfg, path)
    resolved = {key: env.get(f"PI_TEST_{key.upper()}") or cfg[key] for key in ("provider", "model", "effort")}
    return _validate_test_model(resolved, "test model after PI_TEST_* overrides")


def _validate_test_model(cfg, source):
    """Object with non-empty, whitespace-free provider/model/effort strings (mirrors _config.mjs)."""
    if not isinstance(cfg, dict):
        raise ValueError(f"{source} must be a JSON object with provider, model, effort")
    bad = [k for k in ("provider", "model", "effort")
           if not isinstance(cfg.get(k), str) or not cfg[k] or any(c.isspace() for c in cfg[k])]
    if bad:
        raise ValueError(f"{source} missing or invalid: {', '.join(bad)}")
    return cfg


try:
    TEST_MODEL = load_test_model()
except ValueError as e:
    raise SystemExit(str(e)) from e

# ---------------------------------------------------------------------------
# Test scenarios — same 5 from the contract tests, plus expected verdicts
# ---------------------------------------------------------------------------

SCENARIOS = [
    {
        "id": "implementation-request",
        "input": "Fix the PIE polling to bind to the editor PID so it fails fast when the editor crashes",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "pure-question",
        "input": "What does the DispatchLane tool do and when should I use it?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "multi-step-task",
        "input": "Add a retry mechanism to the UE sidecar connection with exponential backoff",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "status-check",
        "input": "What's the status of the lane I dispatched earlier?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "mixed-request",
        "input": "Why does the session idle timeout default to 10 minutes? Change it to 5 minutes.",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    # --- Scenarios 6-10: real-world Opus-like work patterns ---
    {
        "id": "refactor-request",
        "input": "Refactor the session idle timeout logic in rpc-manager.ts — extract it into its own module so it can be unit tested independently",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "error-diagnosis",
        "input": "I'm getting 'EADDRINUSE port 30141' when starting the dev server. What's causing it and how do I fix it?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "code-explanation",
        "input": "Walk me through how the agent event stream works — from the SSE endpoint to the browser. What are the key files and data flow?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "multi-file-change",
        "input": "Add a new 'deepseek' model family to the model registry — needs entries in model-display.json, a color, and the prefix pattern in model-registry.ts",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "followup-correction",
        "input": "Actually, don't change the timeout to 5 minutes — keep it at 10 but add a config option in settings.json so users can override it",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    # --- Scenarios 11-20: edge cases and advanced work patterns ---
    {
        "id": "ambiguous-request",
        "input": "The model selector dropdown feels laggy when I click it. Is there a known issue?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "security-concern",
        "input": "Is our SSE endpoint vulnerable to unauthorized access? Someone without a session ID shouldn't be able to read events",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "write-tests",
        "input": "Write unit tests for the session idle timeout logic in rpc-manager.ts — cover the edge cases around PI_WEB_IDLE_TIMEOUT_MS parsing",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "performance-investigation",
        "input": "Sessions with large file trees take 5+ seconds to load the file explorer. Can you investigate what's slow and propose a fix?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "config-only-change",
        "input": "Update the default port from 30141 to 30142 in both the dev and start npm scripts in package.json",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "git-history-question",
        "input": "What changed in the last 5 commits on this branch? Give me a summary",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 1,
    },
    {
        "id": "dependency-upgrade",
        "input": "Upgrade the pi-agent-core and pi-coding-agent packages to the latest version and make sure nothing breaks",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "documentation-request",
        "input": "Add JSDoc comments to all the exported functions in lib/session-liveness.ts",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": True,
        "max_dispatches": 1,
    },
    {
        "id": "cross-project-context",
        "input": "The CsMCP plugin in D:\\Trees\\CsMCP needs a new endpoint that pi-web can call to get the current editor PID. How should we design the API?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    {
        "id": "vague-open-ended",
        "input": "What should we work on next?",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    # --- Scenario 21: UE dispatch ---
    {
        "id": "ue-dispatch-nonblocking",
        "input": "Open the Unreal Editor for the CropoutSampleProject",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
    },
    # --- Scenario 22: fast turn completion — tool returns quickly, doesn't block session ---
    {
        "id": "fast-turn-completion",
        "input": "Open the Unreal Editor for the CropoutSampleProject",
        "expect_text": True,
        "expect_text_first": True,
        "expect_dispatch": False,
        "max_dispatches": 0,
        "max_turn_time_s": 30,
    },
]


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def api_post(path, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{PI_WEB_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {error_body}") from e


VERBOSE_SSE = os.environ.get("PI_WEB_VERBOSE_SSE", "0") == "1"


_TOKEN = rb"[!#$%&'*+\-.^_`|~0-9A-Za-z]+"  # RFC 9110 5.6.2
_QUOTED = rb'"(?:[\t \x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t \x21-\x7e\x80-\xff])*"'  # RFC 9110 5.6.4
# RFC 9112 7.1: chunk-size [ chunk-ext ]; BWS only around each extension's ';' and '='.
_CHUNK_LINE = re.compile(rb"([0-9A-Fa-f]+)((?:[ \t]*;[ \t]*" + _TOKEN
                         + rb"(?:[ \t]*=[ \t]*(?:" + _TOKEN + rb"|" + _QUOTED + rb"))?)*)\Z")
# RFC 9110 5.5: a (trailer) field line: token ":" then only SP / HTAB / VCHAR / obs-text.
_FIELD_LINE = re.compile(_TOKEN + rb":[\t \x21-\x7e\x80-\xff]*\Z")

# The server controls every byte read; each buffer is bounded so a bad stream fails, not hangs.
MAX_SSE_HEADER_BYTES = 64 * 1024
MAX_CHUNK_LINE_BYTES = 4096
MAX_SSE_LINE_BYTES = 16 * 1024 * 1024


MAX_CHUNK_SIZE_DIGITS = 16  # hex digits in a chunk size, leading zeros aside (a 64-bit length)
# Event types read_sse_events itself produces; the server may not send them.
RESERVED_EVENT_TYPES = frozenset({"sse_protocol_error", "sse_stream_ended", "sse_http_error"})


def _protocol_error(message, fatal, **fields):
    """The one construction site of an sse_protocol_error event (phase="headers" before a body)."""
    return {"type": "sse_protocol_error", "error": message, "fatal": fatal, **fields}


class ChunkedDecoder:
    """Incremental HTTP/1.1 chunked-transfer decoder: feed() raw bytes, get body bytes back.

    done is set once the last (0-size) chunk and its trailer section have ended.
    Malformed framing (RFC 9112: a chunk-size line that isn't hex digits plus
    well-formed extensions, a line not ended by CRLF or over MAX_CHUNK_LINE_BYTES,
    a trailer that isn't a valid field line) sets error; feed() still returns the
    body decoded before it, then decodes nothing more. finish() reports a body cut
    off before done.
    """

    def __init__(self):
        self._buf = bytearray()
        self._left = None  # bytes left in the current chunk; None while expecting a size line
        self._trailers = False  # past the last chunk, reading its trailer section
        self.done = False
        self.error = None

    def _line(self):
        """Pop one CRLF-terminated line, or None until it's complete. A bare LF is an error."""
        line_end = self._buf.find(b"\n")
        # The limit is on the line itself; +1 leaves room for its CR.
        if (len(self._buf) if line_end < 0 else line_end) > MAX_CHUNK_LINE_BYTES + 1:
            self.error = f"chunked body: framing line longer than {MAX_CHUNK_LINE_BYTES} bytes"
            return None
        if line_end < 0:
            return None
        if line_end == 0 or self._buf[line_end - 1] != 0x0D:
            self.error = "chunked body: line not terminated by CRLF"
            return None
        line = bytes(self._buf[:line_end - 1])
        del self._buf[:line_end + 1]
        return line

    def feed(self, data):
        self._buf += data
        out = []
        while not self.done and not self.error:
            if self._trailers:
                line = self._line()
                if line is None:
                    break
                if not line:
                    self.done = True
                elif not _FIELD_LINE.match(line):
                    self.error = f"chunked body: bad trailer field {line[:40]!r}"
            elif self._left is None:
                line = self._line()
                if line is None:
                    break
                size_line = _CHUNK_LINE.match(line)
                if not size_line:
                    self.error = f"chunked body: bad chunk size line {line[:40]!r}"
                    break
                digits = size_line.group(1).lstrip(b"0") or b"0"
                if len(digits) > MAX_CHUNK_SIZE_DIGITS:
                    self.error = f"chunked body: chunk size too large ({len(digits)} hex digits)"
                    break
                self._left = int(digits, 16)
                self._trailers = self._left == 0
            elif self._left:
                if not self._buf:
                    break
                piece = bytes(self._buf[:self._left])
                del self._buf[:len(piece)]
                self._left -= len(piece)
                out.append(piece)
            else:  # chunk data complete; its CRLF follows
                if len(self._buf) < 2:
                    break
                if self._buf[:2] != b"\r\n":
                    self.error = "chunked body: missing CRLF after chunk data"
                    break
                del self._buf[:2]
                self._left = None
        return b"".join(out)

    def finish(self, cause="connection closed"):
        """At end of input: flag a body that stopped before its last chunk or trailer ended."""
        if not self.done and not self.error:
            where = "inside the trailer section" if self._trailers else "before the last chunk"
            self.error = f"chunked body: {cause} {where}"


class SseBodyParser:
    """Turn an SSE response body into events, one received block at a time.

    Contract (lib/agent-event-stream.ts): each event is one `data: <JSON object>`
    line ended by a blank line; `:\\n\\n` heartbeats and other fields are skipped.
    An event is dispatched only at its blank line, as the SSE spec requires, so a
    body cut after a data: line yields no event. Lines are split as bytes and
    decoded whole, so neither chunk framing nor a multi-byte character split
    across reads can corrupt one. Problems become
    {"type": "sse_protocol_error", "error": ..., "fatal": bool} events: an event
    that isn't a JSON object is non-fatal (the body goes on); malformed chunk
    framing, a line over MAX_SSE_LINE_BYTES, or a body that ends early or
    mid-event is fatal and ends the body (done).
    """

    def __init__(self, chunked):
        self._decoder = ChunkedDecoder() if chunked else None
        self._pending = bytearray()  # the current line, not yet ended by \n
        self._scanned = 0  # bytes of _pending already searched for \n
        self._data = None  # the open event's data: values; None between events
        self._data_bytes = 0  # their total size, bounded like one line
        self._failed = False  # a fatal error was reported: nothing more is read
        self._finished = False

    @property
    def done(self):
        if self._failed or self._decoder is None:
            return self._failed or self._finished  # an unchunked body ends only when the connection does
        return self._decoder.done

    def feed(self, data):
        if self._failed:
            return []
        self._pending += self._decoder.feed(data) if self._decoder else data
        events, start, search = [], 0, self._scanned
        while (line_end := self._pending.find(b"\n", search)) >= 0:
            if line_end - start > MAX_SSE_LINE_BYTES:
                return events + [self._fail(f"SSE line longer than {MAX_SSE_LINE_BYTES} bytes")]
            event = self._line(bytes(self._pending[start:line_end]))
            if event is not None:
                events.append(event)
            if self._failed:
                return events
            start = search = line_end + 1
        del self._pending[:start]
        self._scanned = len(self._pending)
        if len(self._pending) > MAX_SSE_LINE_BYTES:
            return events + [self._fail(f"SSE line longer than {MAX_SSE_LINE_BYTES} bytes")]
        return events + self._decoder_error()

    def finish(self, error=None, stopped=False):
        """Call once when the read ends; returns the events that ending produces.

        error: the connection error that ended the read, a fatal protocol error
        unless the chunked body had already ended. stopped: the reader gave up
        (deadline, stop request, or the turn's final event) with the body still
        open; that is not a stream failure. Otherwise the body ended (the server
        closed the connection, or the last chunk arrived): a chunked body cut
        short, or a body that ends mid-event, is fatal.
        """
        if self._finished:
            return []
        self._finished = True
        if self._failed or stopped:
            return []
        if error is not None and (self._decoder is None or not self._decoder.done):
            if self._decoder is None:
                return [self._fail(f"connection error while reading the body ({error})")]
            self._decoder.finish(f"connection error ({error})")
            return self._decoder_error()
        if self._decoder is not None:
            self._decoder.finish()
            cut = self._decoder_error()
            if cut:
                return cut
        if self._data or self._pending.lstrip().startswith(b"data:"):
            return [self._fail("body ended mid-event: no blank line after the last event")]
        if self._pending.strip() or self._data is not None:
            return [self._fail("body ended mid-block: no blank line after the last field")]
        return []

    def _fail(self, message):
        self._failed = True
        return _protocol_error(message, fatal=True)

    def _line(self, raw):
        """One SSE line: a blank line dispatches the open event; data: lines add to it."""
        line = raw.decode("utf-8", errors="replace").rstrip("\r")
        if not line:
            data, self._data, self._data_bytes = self._data, None, 0
            return self._event("\n".join(data)) if data else None
        if self._data is None:
            self._data = []
        if line.startswith("data:"):
            value = raw[5:]
            value = value[1:] if value.startswith(b" ") else value
            self._data_bytes += len(value)
            if self._data_bytes > MAX_SSE_LINE_BYTES:
                return self._fail(f"SSE event longer than {MAX_SSE_LINE_BYTES} bytes")
            self._data.append(value.decode("utf-8", errors="replace").rstrip("\r"))
        return None

    def _event(self, text):
        try:
            event = json.loads(text)
        except json.JSONDecodeError as e:
            return _protocol_error(f"bad JSON in data line: {e}", fatal=False)
        if not isinstance(event, dict):
            return _protocol_error(f"data line is not a JSON object: {text[:40]!r}", fatal=False)
        if isinstance(event.get("type"), str) and event["type"] in RESERVED_EVENT_TYPES:
            return _protocol_error(f"server event uses the reader's reserved type {event['type']!r}",
                                   fatal=False)
        return event

    def _decoder_error(self):
        if self._decoder is None or not self._decoder.error or self._failed:
            return []
        return [self._fail(self._decoder.error)]


def _header_values(head, field):
    """Every value of one header field, in order (field names match case-insensitively)."""
    values = []
    for line in bytes(head).split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        if name.strip().lower() == field:
            values.append(value.strip())
    return values


def _transfer_codings(head):
    """The response's transfer codings in order; repeated field lines combine (RFC 9110 5.3)."""
    return [coding.strip() for value in _header_values(head, b"transfer-encoding")
            for coding in value.lower().split(b",") if coding.strip()]


_STATUS_LINE = re.compile(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?\Z")  # RFC 9112 4


def _status_code(head):
    """The status code of a response head, or None when its status line is malformed."""
    match = _STATUS_LINE.match(bytes(head).split(b"\r\n", 1)[0])
    return int(match.group(1)) if match else None


def _shown(values):
    """Header values for a rejection message."""
    return b", ".join(values).decode(errors="replace") or "none"


def _head_rejection(head):
    """Why a 200 head can't carry an event stream this reader decodes, or None when it can."""
    media = _header_values(head, b"content-type")
    if len(media) != 1 or media[0].split(b";")[0].strip().lower() != b"text/event-stream":
        return f"Content-Type is not text/event-stream ({_shown(media)})"
    codings = _transfer_codings(head)
    if codings not in ([], [b"chunked"]):  # only chunk framing is decoded here
        return f"unsupported transfer coding ({_shown(codings)})"
    if _header_values(head, b"content-length"):  # the body is chunked or ends at close
        return "Content-Length framing is not read; the stream must be chunked or close-delimited"
    encodings = [e.strip().lower() for v in _header_values(head, b"content-encoding")
                 for e in v.split(b",") if e.strip()]
    if encodings not in ([], [b"identity"]):
        return f"unsupported Content-Encoding ({_shown(encodings)})"
    return None


def read_sse_events(session_id, timeout_s=TURN_TIMEOUT_S, on_connected=None, stop_event=None):
    """Read SSE events via raw socket, decoding chunked transfer encoding (SseBodyParser).

    on_connected, if given, is called once, on the server's first
    {"type": "connected"} event: a prompt sent after it will not be missed.
    Headers are not enough: the events route (app/api/agent/[id]/events)
    returns them at once, but createAgentEventStream (lib/agent-event-stream.ts)
    emits "connected" only after session.onEvent is attached.
    A non-200 response ends the read with [{"type": "sse_http_error", "status": N}].
    Malformed chunk framing, an event that isn't a JSON object, or a body cut off
    by the server or a connection error adds a {"type": "sse_protocol_error"}
    event (SseBodyParser; fatal unless the body goes on); so does a server event
    using one of the reader's RESERVED_EVENT_TYPES (non-fatal). Interim 1xx
    heads are skipped. Before the body, a failed connect, a connection error or
    close, a malformed status line (_status_code), a head _head_rejection
    refuses, or heads over MAX_SSE_HEADER_BYTES in total is a fatal
    sse_protocol_error with phase="headers"; the deadline passing first is a
    non-fatal one (the turn still timed out). A body that ends cleanly without
    the turn's completion event adds {"type": "sse_stream_ended"}, judged as
    STREAM_ENDED_EARLY, not a timeout.
    The read stops at the turn's completion event: anything after it in the same
    received block, framing errors included, belongs to no turn and is not judged.
    stop_event, if given, ends the read early (checked at least every 3s).
    """
    import socket as _socket
    from urllib.parse import urlparse

    parsed = urlparse(PI_WEB_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 30141
    events = []
    deadline = time.monotonic() + timeout_s
    sock = None
    head_bytes = bytearray()  # the response headers, until their blank line
    heads_skipped = 0  # bytes of interim (1xx) heads already consumed; they count toward the limit
    head_error = None  # why the headers could not be read
    parser = None  # set once the response headers are in
    closed = False  # the server closed the connection
    read_error = None  # the OSError that ended the read

    try:
        sock = _socket.create_connection((host, port), timeout=5)
        sock.settimeout(3.0)
        req_bytes = (
            f"GET /api/agent/{session_id}/events HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Accept: text/event-stream\r\n"
            f"Accept-Encoding: identity\r\n\r\n"  # a compressed body is rejected (_head_rejection)
        ).encode()
        sock.sendall(req_bytes)
        if VERBOSE_SSE:
            print(f"    [SSE] connected to {host}:{port}", flush=True)

        connected = False
        while time.monotonic() < deadline and not (stop_event and stop_event.is_set()):
            try:
                chunk = sock.recv(8192)
            except _socket.timeout:
                continue
            if not chunk:
                closed = True
                break

            if parser is None:
                search_from = max(0, len(head_bytes) - 3)
                head_bytes += chunk
                chunk = b""
                # Interim (1xx) responses may precede the final one; each has its own head.
                while parser is None and head_error is None:
                    head_end = head_bytes.find(b"\r\n\r\n", search_from)
                    if heads_skipped + (len(head_bytes) if head_end < 0 else head_end) > MAX_SSE_HEADER_BYTES:
                        head_error = f"headers longer than {MAX_SSE_HEADER_BYTES} bytes"
                    if head_error or head_end < 0:
                        break
                    head = bytes(head_bytes[:head_end])
                    del head_bytes[:head_end + 4]  # what follows: the next head, or body bytes
                    heads_skipped += head_end + 4
                    search_from = 0
                    status = _status_code(head)
                    if status is None:
                        status_line = head.split(b"\r\n", 1)[0]
                        head_error = f"malformed status line {status_line[:60]!r}"
                    elif 100 <= status < 200 and status != 101:
                        continue
                    elif status != 200:
                        return [{"type": "sse_http_error", "status": status}]
                    else:
                        head_error = _head_rejection(head)  # route.ts sets text/event-stream
                        if head_error is None:
                            parser = SseBodyParser(chunked=_transfer_codings(head) == [b"chunked"])
                            chunk = bytes(head_bytes)  # body bytes read with the headers
                            if VERBOSE_SSE:
                                print(f"    [SSE] headers done, body starts", flush=True)
                if parser is None:
                    if head_error:
                        break
                    continue

            for event in parser.feed(chunk):
                events.append(event)
                if on_connected and not connected and event.get("type") == "connected":
                    connected = True
                    on_connected()
                if VERBOSE_SSE:
                    print(f"    [SSE] event: {event.get('type')}", flush=True)
                if is_turn_complete(event):
                    return events
            if parser.done:
                break
    except OSError as e:
        read_error = f"{type(e).__name__}: {e}"
        if VERBOSE_SSE:
            print(f"    [SSE] error: {e}", flush=True)
    finally:
        # Every exit is reported: a failure before the headers, a body cut short, a
        # connection error, or a body that ended without the turn's completion event.
        if parser is not None:
            stopped = not closed and read_error is None and not parser.done
            events.extend(parser.finish(error=read_error, stopped=stopped))
            if not stopped and not any(is_turn_complete(e) for e in events) \
                    and not stream_failed_fatally(events):
                events.append({"type": "sse_stream_ended"})
        elif head_error:
            events.append(_protocol_error(f"event stream response rejected: {head_error}",
                                          fatal=True, phase="headers"))
        elif read_error is not None or closed:
            events.append(_protocol_error(
                f"event stream failed before its response headers ended: {read_error or 'connection closed'} "
                f"({heads_skipped + len(head_bytes)} header bytes received)", fatal=True, phase="headers"))
        elif time.monotonic() >= deadline and not (stop_event and stop_event.is_set()):
            # Not fatal: the turn still timed out, and TURN_TIMEOUT must say so.
            events.append(_protocol_error(
                f"response headers did not arrive within {timeout_s}s "
                f"({heads_skipped + len(head_bytes)} header bytes received)", fatal=False, phase="headers"))
        if sock is not None:
            sock.close()

    return events


def is_turn_complete(event):
    etype = event.get("type", "")
    # startup_error: the session failed to start and the server closes the stream after it.
    if etype in ("prompt_done", "agent_settled", "agent_end", "idle", "turn_complete", "error",
                 "startup_error"):
        return True
    return False


def snapshot_events(collected_events):
    """A copy of a reader thread's live event list, taken once a turn is over.

    The reader can outlive its join and keep appending; every check of the
    turn must read this one copy so they all judge the same events.
    """
    return list(collected_events)


class V:
    """Violation codes. Every violation is built by violation(V.CODE, detail)."""
    STARTUP_ERROR = "STARTUP_ERROR"
    SSE_PROTOCOL_ERROR = "SSE_PROTOCOL_ERROR"
    SSE_NOT_CONNECTED = "SSE_NOT_CONNECTED"
    SEND_FAILED = "SEND_FAILED"
    TURN_TIMEOUT = "TURN_TIMEOUT"
    STREAM_ENDED_EARLY = "STREAM_ENDED_EARLY"
    NO_EVENTS = "NO_EVENTS"
    DISPATCH_BEFORE_TEXT = "DISPATCH_BEFORE_TEXT"
    UNEXPECTED_DISPATCH = "UNEXPECTED_DISPATCH"
    DISPATCH_LOOP = "DISPATCH_LOOP"
    WRONG_TOOL = "WRONG_TOOL"
    NO_TEXT_RESPONSE = "NO_TEXT_RESPONSE"
    MISSING_DISPATCH = "MISSING_DISPATCH"
    DISPATCH_WITHOUT_TEXT = "DISPATCH_WITHOUT_TEXT"
    NO_TEXT = "NO_TEXT"
    NO_DISPATCH = "NO_DISPATCH"
    TURN_TOO_SLOW = "TURN_TOO_SLOW"


# stream: the session or its event stream failed. behaviour: something the model did.
# derivative: only reports something missing (or slow), which a failed stream explains.
VIOLATION_KINDS = {
    V.STARTUP_ERROR: "stream", V.SSE_PROTOCOL_ERROR: "stream", V.SSE_NOT_CONNECTED: "stream",
    V.SEND_FAILED: "stream", V.TURN_TIMEOUT: "stream", V.STREAM_ENDED_EARLY: "stream",
    V.NO_EVENTS: "stream",
    V.DISPATCH_BEFORE_TEXT: "behaviour", V.UNEXPECTED_DISPATCH: "behaviour",
    V.DISPATCH_LOOP: "behaviour", V.WRONG_TOOL: "behaviour",
    V.NO_TEXT_RESPONSE: "derivative", V.MISSING_DISPATCH: "derivative",
    V.DISPATCH_WITHOUT_TEXT: "derivative", V.NO_TEXT: "derivative",
    V.NO_DISPATCH: "derivative", V.TURN_TOO_SLOW: "derivative",
}
DERIVATIVE_VIOLATIONS = {code for code, kind in VIOLATION_KINDS.items() if kind == "derivative"}


def violation(code, detail):
    """"CODE: detail" for a registered code (KeyError for an unregistered one)."""
    if code not in VIOLATION_KINDS:
        raise KeyError(f"unregistered violation code {code!r}")
    return f"{code}: {detail}"


def violation_code(text):
    return text.split(":", 1)[0]


def without_derivative(violations):
    return [v for v in violations if violation_code(v) not in DERIVATIVE_VIOLATIONS]


def startup_error_violation(events):
    """STARTUP_ERROR violation for the server's startup_error event, or None.

    lib/agent-event-stream.ts sends {"type": "startup_error", "errorMessage": ...}
    when the session fails to start, before any "connected" event.
    """
    event = next((e for e in events if e.get("type") == "startup_error"), None)
    if event is None:
        return None
    return violation(V.STARTUP_ERROR, event.get("errorMessage") or "session failed to start")


def _is_fatal_protocol_error(event):
    """Whether event is a fatal sse_protocol_error; one without a boolean "fatal" is refused."""
    if event.get("type") != "sse_protocol_error":
        return False
    fatal = event.get("fatal")
    if not isinstance(fatal, bool):
        raise ValueError(f"sse_protocol_error without a boolean 'fatal': {event!r}")
    return fatal


def protocol_error_violation(events):
    """SSE_PROTOCOL_ERROR violation naming the fatal protocol error (else the first), or None."""
    errors = [e for e in events if e.get("type") == "sse_protocol_error"]
    if not errors:
        return None
    event = next((e for e in errors if _is_fatal_protocol_error(e)), errors[0])
    more = f" (+{len(errors) - 1} more)" if len(errors) > 1 else ""
    return violation(V.SSE_PROTOCOL_ERROR, f"{event.get('error') or 'undecodable event stream'}{more}")


def stream_failure_violations(events):
    """STARTUP_ERROR / SSE_PROTOCOL_ERROR violations for the turn's stream, else []."""
    return [v for v in (startup_error_violation(events), protocol_error_violation(events)) if v]


def stream_failed_fatally(events):
    """True when the session failed to start or the event stream broke (not just a bad data: line)."""
    return any(e.get("type") == "startup_error" or _is_fatal_protocol_error(e) for e in events)


def judge_turn(events, violations, turn_timeout_s):
    """The final violations of one turn: the stream-failure policy both harnesses share.

    events: the turn's snapshot. violations: every other check of the turn
    (chain checks, TURN_TOO_SLOW, ...). Stream failures come first. A turn with
    no completion event gets STREAM_ENDED_EARLY (the server closed the stream)
    or TURN_TIMEOUT (the read ran out of time), unless a fatal failure already
    explains it. A fatal failure or an incomplete turn drops the derivative
    violations: the missing events say nothing about the model. A recovered
    bad data: line in a completed turn drops nothing. A malformed stream event
    fails this turn, not the whole run.
    """
    try:
        judged = stream_failure_violations(events)
        fatal = stream_failed_fatally(events)
    except ValueError as e:  # an unjudgeable stream explains missing events too
        return [violation(V.SSE_PROTOCOL_ERROR, f"malformed stream event: {e}")] + without_derivative(violations)
    complete = any(is_turn_complete(e) for e in events)
    if not complete and not fatal:
        if any(e.get("type") == "sse_stream_ended" for e in events):
            judged.append(violation(V.STREAM_ENDED_EARLY, "event stream ended without a completion event"))
        else:
            judged.append(violation(V.TURN_TIMEOUT, f"turn did not complete within {turn_timeout_s}s"))
    if fatal or not complete:
        violations = without_derivative(violations)
    return judged + list(violations)


def judge_abort(events, abort_violation):
    """The violations of a turn abandoned early (never subscribed, or the send failed).

    A fatal stream failure, or any failure before the response headers ended,
    explains a stream that never subscribed, so it replaces SSE_NOT_CONNECTED;
    any other stream failure is reported with it.
    """
    try:
        failures = stream_failure_violations(events)
        fatal = stream_failed_fatally(events)
    except ValueError as e:
        return [violation(V.SSE_PROTOCOL_ERROR, f"malformed stream event: {e}"), abort_violation]
    pre_header = any(e.get("type") == "sse_protocol_error" and e.get("phase") == "headers" for e in events)
    if failures and (fatal or pre_header) and violation_code(abort_violation) == V.SSE_NOT_CONNECTED:
        return failures
    return failures + [abort_violation]


# ---------------------------------------------------------------------------
# Event chain analysis
# ---------------------------------------------------------------------------

def extract_chain(events):
    """Extract the orchestrator event chain from raw SSE events."""
    chain = []
    text_accumulator = ""

    for event in events:
        etype = event.get("type", "")

        if etype == "message_update":
            ae = event.get("assistantMessageEvent", {})
            atype = ae.get("type", "")
            if atype == "text_delta":
                text_accumulator += ae.get("delta", "")
            elif atype == "text_end":
                full_text = ae.get("content", text_accumulator)
                if full_text.strip():
                    chain.append({"type": "text", "preview": full_text[:120]})
                text_accumulator = ""
            elif atype == "tool_call_start":
                chain.append({
                    "type": "tool_call",
                    "name": ae.get("name", ""),
                    "args_preview": "",
                })
            elif atype == "tool_call_end":
                pass

        elif etype == "message_end":
            msg = event.get("message", {})
            if msg.get("role") == "assistant":
                for block in msg.get("content", []):
                    btype = block.get("type", "")
                    if btype == "text" and block.get("text", "").strip():
                        if not chain or chain[-1]["type"] != "text":
                            chain.append({"type": "text", "preview": block["text"][:120]})
                    elif btype == "tool_use":
                        if not any(c["type"] == "tool_call" and c.get("name") == block.get("name") for c in chain):
                            chain.append({
                                "type": "tool_call",
                                "name": block.get("name", ""),
                                "args_preview": json.dumps(block.get("input", {}))[:120],
                            })

        elif etype == "tool_result":
            chain.append({"type": "tool_result", "tool": event.get("tool_name", "")})

        elif etype == "tool_execution_start":
            chain.append({
                "type": "tool_call",
                "name": event.get("toolName", ""),
                "args_preview": json.dumps(event.get("args", {}))[:120],
            })

        elif etype == "tool_execution_end":
            pass

    return chain


def evaluate_chain(chain, scenario):
    """Evaluate chain against scenario expectations. Returns (pass, violations)."""
    violations = []

    has_text = any(e["type"] == "text" for e in chain)
    dispatches = [e for e in chain if e["type"] == "tool_call" and e.get("name") == "DispatchLane"]
    first_event = chain[0] if chain else None

    if scenario["expect_text"] and not has_text:
        violations.append(violation(V.NO_TEXT_RESPONSE, "model returned no text to the user"))

    if scenario["expect_text_first"]:
        # Only flag if a DispatchLane call comes before any text response.
        # Read/search tool calls before text are normal info-gathering.
        first_dispatch_idx = next((i for i, e in enumerate(chain) if e["type"] == "tool_call" and e.get("name") == "DispatchLane"), None)
        first_text_idx = next((i for i, e in enumerate(chain) if e["type"] == "text"), None)
        if first_dispatch_idx is not None and first_text_idx is None:
            # No text at all: an absence. Text that only message_end carries is
            # lost with a stream cut after the dispatch, so this can be derivative.
            violations.append(violation(V.DISPATCH_WITHOUT_TEXT,
                                        "DispatchLane called and no text response to the user"))
        elif first_dispatch_idx is not None and first_dispatch_idx < first_text_idx:
            violations.append(violation(V.DISPATCH_BEFORE_TEXT,
                                        "DispatchLane called before any text response to the user"))

    if scenario["expect_dispatch"] and len(dispatches) == 0:
        violations.append(violation(V.MISSING_DISPATCH, "expected DispatchLane call but none found"))

    if not scenario["expect_dispatch"] and len(dispatches) > 0:
        violations.append(violation(V.UNEXPECTED_DISPATCH,
                                    f"{len(dispatches)} dispatch(es) on a non-implementation request"))

    if len(dispatches) > scenario["max_dispatches"]:
        violations.append(violation(V.DISPATCH_LOOP,
                                    f"{len(dispatches)} dispatches, max allowed {scenario['max_dispatches']}"))

    return len(violations) == 0, violations


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

def create_session(provider, model_id, effort):
    """Create a pi-web session with the specified model."""
    body = {
        "cwd": TEST_CWD,
        "type": "ensure_session",
        "provider": provider,
        "modelId": model_id,
        "thinkingLevel": effort,
    }
    result = api_post("/api/agent/new", body)
    session_id = result.get("sessionId")
    if not session_id:
        raise RuntimeError(f"Failed to create session: {json.dumps(result)}")
    return session_id


def send_prompt(session_id, message):
    """Send a user message to the session."""
    body = {"type": "prompt", "message": message}
    return api_post(f"/api/agent/{session_id}", body)


def run_scenario(session_id, scenario, verbose=False):
    """Run one scenario and return results."""
    import threading

    print(f"  [{scenario['id']}] Sending: {scenario['input'][:60]}...")

    collected_events = []
    sse_ready = threading.Event()

    def sse_reader():
        sse_ready.set()
        collected_events.extend(read_sse_events(session_id))

    reader_thread = threading.Thread(target=sse_reader, daemon=True)
    reader_thread.start()
    sse_ready.wait(timeout=5)
    time.sleep(1)

    try:
        send_prompt(session_id, scenario["input"])
    except Exception as e:
        return {"id": scenario["id"], "pass": False, "violations": [violation(V.SEND_FAILED, e)], "chain": []}

    t_start = time.monotonic()
    reader_thread.join(timeout=TURN_TIMEOUT_S)
    turn_time = time.monotonic() - t_start
    events = snapshot_events(collected_events)

    if verbose and hasattr(run_scenario, "_results_dir"):
        dump_path = os.path.join(run_scenario._results_dir, f"raw-events-{scenario['id']}.json")
        with open(dump_path, "w") as f:
            json.dump(events[:50], f, indent=2)
        print(f"    Raw events ({len(events)}) dumped to {dump_path}")

    chain = extract_chain(events)
    _, violations = evaluate_chain(chain, scenario)
    max_turn = scenario.get("max_turn_time_s")
    if max_turn and turn_time > max_turn:
        violations.append(violation(V.TURN_TOO_SLOW, f"took {turn_time:.1f}s, max {max_turn}s — tool may be blocking the session"))
    violations = judge_turn(events, violations, TURN_TIMEOUT_S)
    passed = not violations
    if max_turn and verbose:
        print(f"    Turn time: {turn_time:.1f}s (max {max_turn}s)")

    if verbose or not passed:
        print(f"    Chain ({len(chain)} events):")
        for i, e in enumerate(chain[:10]):
            label = e["type"]
            if e["type"] == "tool_call":
                label += f" → {e.get('name', '?')}"
            if e["type"] == "text":
                label += f": {e.get('preview', '')[:60]}"
            print(f"      {i+1}. {label}")
        if len(chain) > 10:
            print(f"      ... +{len(chain) - 10} more")

    return {"id": scenario["id"], "pass": passed, "violations": violations, "chain": chain}


def get_results_dir(provider, model_id, effort):
    """Return a timestamped results directory for this run."""
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
    ts = time.strftime("%Y%m%d-%H%M%S", time.localtime())
    return os.path.join(base, f"{provider}-{model_id}-{effort}-{ts}")


def cleanup_results(results_dir):
    """Remove a results directory if it exists."""
    import shutil
    if os.path.isdir(results_dir):
        shutil.rmtree(results_dir, ignore_errors=True)


def run_all(provider, model_id, effort, scenario_filter=None, verbose=False):
    """Run all scenarios against the specified model."""
    print(f"\n{'='*60}")
    print(f"Orchestrator E2E: {provider}/{model_id} @ {effort}")
    print(f"Server: {PI_WEB_URL}  CWD: {TEST_CWD}")
    print(f"{'='*60}\n")

    scenarios = SCENARIOS
    if scenario_filter:
        scenarios = [s for s in SCENARIOS if s["id"] == scenario_filter]
        if not scenarios:
            print(f"Unknown scenario: {scenario_filter}")
            return 1

    results_dir = get_results_dir(provider, model_id, effort)
    cleanup_results(results_dir)
    os.makedirs(results_dir, exist_ok=True)
    run_scenario._results_dir = results_dir
    print(f"Results dir: {results_dir}\n")

    results = []
    for scenario in scenarios:
        print(f"Creating session for {scenario['id']}...")
        try:
            session_id = create_session(provider, model_id, effort)
        except Exception as e:
            print(f"FATAL: Could not create session: {e}")
            return 1
        print(f"Session: {session_id}")
        result = run_scenario(session_id, scenario, verbose=verbose)
        status = "PASS" if result["pass"] else "FAIL"
        print(f"  [{status}] {scenario['id']}")
        for v in result["violations"]:
            print(f"    ✗ {v}")
        print()
        results.append(result)

    passed = sum(1 for r in results if r["pass"])
    total = len(results)
    print(f"{'='*60}")
    print(f"Results: {passed}/{total} passed")
    if passed < total:
        print(f"Failed: {', '.join(r['id'] for r in results if not r['pass'])}")
    print(f"{'='*60}\n")

    out_file = os.path.join(results_dir, "summary.json")
    with open(out_file, "w") as f:
        json.dump({
            "provider": provider,
            "model": model_id,
            "effort": effort,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "results": results,
            "summary": {"passed": passed, "total": total},
        }, f, indent=2)
    print(f"Results written to {out_file}")

    if passed == total:
        cleanup_results(results_dir)
        print("All passed — artifacts cleaned up.")

    return 0 if passed == total else 1


def main():
    parser = argparse.ArgumentParser(description="Orchestrator e2e tests against live pi-web")
    parser.add_argument("--provider", default=TEST_MODEL["provider"], help="Model provider (default: test/test-model.json)")
    parser.add_argument("--model", default=TEST_MODEL["model"], help="Model ID (default: test/test-model.json)")
    parser.add_argument("--effort", default=TEST_MODEL["effort"], help="Thinking level (default: test/test-model.json)")
    parser.add_argument("--scenario", default=None, help="Run a single scenario by id")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show full event chains")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    args = parser.parse_args()

    if args.list:
        for s in SCENARIOS:
            dispatch = "dispatch" if s["expect_dispatch"] else "text-only"
            print(f"  {s['id']:30s} [{dispatch}] {s['input'][:50]}")
        return 0

    return run_all(args.provider, args.model, args.effort, args.scenario, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
