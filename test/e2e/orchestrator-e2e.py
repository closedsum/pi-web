"""Live e2e tests for orchestrator behavior across models.

Usage:
    python test/e2e/orchestrator-e2e.py                              # defaults: claude/opus, max effort
    python test/e2e/orchestrator-e2e.py --provider openai --model gpt-5.6-sol --effort high
    python test/e2e/orchestrator-e2e.py --scenario implementation-request   # run one scenario
    python test/e2e/orchestrator-e2e.py --list                       # list available scenarios

Requires pi-web dev server running at PI_WEB_URL (default http://127.0.0.1:30141).
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(line_buffering=True)
PI_WEB_URL = os.environ.get("PI_WEB_URL", "http://127.0.0.1:30141")
TEST_CWD = os.environ.get("PI_WEB_TEST_CWD", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
TURN_TIMEOUT_S = int(os.environ.get("PI_WEB_TURN_TIMEOUT", "120"))

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
        "expect_dispatch": True,
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

def read_sse_events(session_id, timeout_s=TURN_TIMEOUT_S):
    """Read SSE events via raw socket, stripping chunked transfer encoding."""
    import socket as _socket
    from urllib.parse import urlparse

    parsed = urlparse(PI_WEB_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 30141
    events = []
    deadline = time.monotonic() + timeout_s

    try:
        sock = _socket.create_connection((host, port), timeout=5)
        sock.settimeout(3.0)
        req_bytes = (
            f"GET /api/agent/{session_id}/events HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Accept: text/event-stream\r\n\r\n"
        ).encode()
        sock.sendall(req_bytes)
        if VERBOSE_SSE:
            print(f"    [SSE] connected to {host}:{port}", flush=True)

        all_bytes = b""
        header_done = False
        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(8192)
            except _socket.timeout:
                continue
            if not chunk:
                break
            all_bytes += chunk

            if not header_done:
                if b"\r\n\r\n" in all_bytes:
                    _, all_bytes = all_bytes.split(b"\r\n\r\n", 1)
                    header_done = True
                    if VERBOSE_SSE:
                        print(f"    [SSE] headers done, body starts", flush=True)
                continue

            text = all_bytes.decode("utf-8", errors="replace")
            lines = text.split("\n")
            # Keep last incomplete line in buffer
            if not text.endswith("\n"):
                all_bytes = lines[-1].encode("utf-8")
                lines = lines[:-1]
            else:
                all_bytes = b""
            for line in lines:
                stripped = line.strip()
                if stripped.startswith("data: "):
                    try:
                        event = json.loads(stripped[6:])
                        events.append(event)
                        if VERBOSE_SSE:
                            print(f"    [SSE] event: {event.get('type')}", flush=True)
                        if is_turn_complete(event):
                            sock.close()
                            return events
                    except json.JSONDecodeError:
                        pass

        sock.close()
    except OSError as e:
        if VERBOSE_SSE:
            print(f"    [SSE] error: {e}", flush=True)

    return events


def is_turn_complete(event):
    etype = event.get("type", "")
    if etype in ("prompt_done", "agent_settled", "agent_end", "idle", "turn_complete", "error"):
        return True
    return False


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
        violations.append("NO_TEXT_RESPONSE: model returned no text to the user")

    if scenario["expect_text_first"]:
        # Only flag if a DispatchLane call comes before any text response.
        # Read/search tool calls before text are normal info-gathering.
        first_dispatch_idx = next((i for i, e in enumerate(chain) if e["type"] == "tool_call" and e.get("name") == "DispatchLane"), None)
        first_text_idx = next((i for i, e in enumerate(chain) if e["type"] == "text"), None)
        if first_dispatch_idx is not None and (first_text_idx is None or first_dispatch_idx < first_text_idx):
            violations.append("DISPATCH_BEFORE_TEXT: DispatchLane called before any text response to the user")

    if scenario["expect_dispatch"] and len(dispatches) == 0:
        violations.append("MISSING_DISPATCH: expected DispatchLane call but none found")

    if not scenario["expect_dispatch"] and len(dispatches) > 0:
        violations.append(f"UNEXPECTED_DISPATCH: {len(dispatches)} dispatch(es) on a non-implementation request")

    if len(dispatches) > scenario["max_dispatches"]:
        violations.append(f"DISPATCH_LOOP: {len(dispatches)} dispatches, max allowed {scenario['max_dispatches']}")

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
        return {"id": scenario["id"], "pass": False, "violations": [f"SEND_FAILED: {e}"], "chain": []}

    reader_thread.join(timeout=TURN_TIMEOUT_S)
    events = collected_events

    # Dump raw events for debugging (uses results_dir if passed via _results_dir)
    if verbose and hasattr(run_scenario, "_results_dir"):
        dump_path = os.path.join(run_scenario._results_dir, f"raw-events-{scenario['id']}.json")
        with open(dump_path, "w") as f:
            json.dump(events[:50], f, indent=2)
        print(f"    Raw events ({len(events)}) dumped to {dump_path}")

    chain = extract_chain(events)
    passed, violations = evaluate_chain(chain, scenario)

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
    parser.add_argument("--provider", default="openai-codex", help="Model provider (default: openai-codex)")
    parser.add_argument("--model", default="gpt-5.6-sol", help="Model ID (default: gpt-5.6-sol)")
    parser.add_argument("--effort", default="high", help="Thinking level (default: high)")
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
