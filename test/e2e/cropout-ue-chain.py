"""Sequential UE dispatch chain test for CropoutSampleProject.

Sends a series of UE operations to one GPT session with fixed delays
between steps. Tests that dispatches queue and execute in order.

Usage:
    python test/e2e/cropout-ue-chain.py                                     # model: test/test-model.json
    python test/e2e/cropout-ue-chain.py --provider openai-codex --model gpt-6-luna --effort medium
    python test/e2e/cropout-ue-chain.py --delay 5   # seconds between steps
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
orch = import_module("orchestrator-e2e")
from ue_dispatch_outcome import (count_violations, dispatch_refs, order_violations, outcome_violations,
                                 parse_editor_rows, pending_dispatches, resolve_outcomes,
                                 stop_owned_editors)

PI_WEB_URL = os.environ.get("PI_WEB_URL", "http://127.0.0.1:30141")
TEST_CWD = os.environ.get("PI_WEB_TEST_CWD", r"D:\Trees\CropoutSampleProject")
CONNECT_TIMEOUT_S = 60  # SSE subscribe budget per step (session cold start included)
sys.stdout.reconfigure(line_buffering=True)

STEPS = [
    {
        "id": "launch-editor",
        "prompt": "Launch the Unreal Editor for CropoutSampleProject",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "open-map",
        "prompt": "Open Cropout_Map",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "start-pie",
        "prompt": "Start PIE",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "camera-setup",
        "prompt": "Set the camera Z position to 1500 and rotate the camera pitch down 90 degrees",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "spawn-bot",
        "prompt": "Spawn a bot 200 units in front of the player with its feet on the ground",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "setup-bt",
        "prompt": "Setup the bot with a behavior tree. Give it a unique BT name like BT_Test_CropoutChain",
        "expect_tool": "ue_dispatch",
    },
    {
        "id": "close-editor",
        "prompt": "Close the Unreal Editor",
        "expect_tool": "ue_dispatch",
    },
]


def run_step(session_id, step, turn_timeout):
    """Send one prompt and wait for the turn. Returns (turn_violations, chain, dispatch_refs)."""
    import threading

    print(f"  [{step['id']}] Sending: {step['prompt'][:70]}...")

    collected_events = []
    subscribed, stop = threading.Event(), threading.Event()

    def sse_reader():
        collected_events.extend(orch.read_sse_events(
            session_id, timeout_s=turn_timeout, on_connected=subscribed.set, stop_event=stop))

    V, violation = orch.V, orch.violation

    def abort(abort_violation):
        # Stop this step's subscription so it cannot overlap the next step's, then judge
        # what the reader saw: it hands its events over only when it returns.
        stop.set()
        reader.join(timeout=10)
        return orch.judge_abort(orch.snapshot_events(collected_events), abort_violation), [], []

    reader = threading.Thread(target=sse_reader, daemon=True)
    reader.start()
    # "connected" arrives only after the server has started the session, which can take far
    # longer than the TCP/header handshake on a cold start.
    connect_deadline = time.monotonic() + min(CONNECT_TIMEOUT_S, turn_timeout)
    while not subscribed.wait(timeout=0.2):
        if not reader.is_alive():
            http = next((e for e in collected_events if e.get("type") == "sse_http_error"), None)
            reason = f" (HTTP {http['status']})" if http else ""
            return abort(violation(V.SSE_NOT_CONNECTED, f"event stream ended before subscribing{reason}"))
        if time.monotonic() >= connect_deadline:
            return abort(violation(V.SSE_NOT_CONNECTED, f"event stream did not subscribe within "
                                                        f"{min(CONNECT_TIMEOUT_S, turn_timeout)}s"))

    try:
        orch.send_prompt(session_id, step["prompt"])
    except Exception as e:
        return abort(violation(V.SEND_FAILED, e))

    # read_sse_events returns at the turn's completion event or at turn_timeout.
    reader.join(timeout=turn_timeout + 10)
    stop.set()
    events = orch.snapshot_events(collected_events)  # the reader may outlive its join
    chain = orch.extract_chain(events)
    refs = dispatch_refs(events)

    has_text = any(e["type"] == "text" for e in chain)
    tool_calls = [e for e in chain if e["type"] == "tool_call"]
    lane_dispatches = [e for e in tool_calls if e.get("name") == "DispatchLane"]
    ue_dispatches = [e for e in tool_calls if e.get("name") == "ue_dispatch"]

    checks = []
    if not has_text:
        checks.append(violation(V.NO_TEXT, "model returned no text"))

    if step["expect_tool"] == "ue_dispatch" and not ue_dispatches:
        checks.append(violation(V.NO_DISPATCH, "expected ue_dispatch but got none"))

    if lane_dispatches:
        checks.append(violation(V.WRONG_TOOL, f"{len(lane_dispatches)} DispatchLane call(s) for a UE operation"))

    # sse_stream_ended is the reader's note on how the body ended, not an event the server sent.
    if not [e for e in events if e.get("type") != "sse_stream_ended"]:
        checks.append(violation(V.NO_EVENTS, "SSE stream returned nothing (timeout?)"))
    violations = orch.judge_turn(events, checks, turn_timeout)

    tool_names = [e.get("name", "") for e in tool_calls]
    print(f"    Tools: {', '.join(tool_names) if tool_names else '(none)'}")
    if has_text:
        text_preview = next(e["preview"] for e in chain if e["type"] == "text")
        print(f"    Text: {text_preview[:80]}...")

    return violations, chain, refs


def main():
    parser = argparse.ArgumentParser(description="Cropout UE chain test")
    parser.add_argument("--provider", default=orch.TEST_MODEL["provider"])
    parser.add_argument("--model", default=orch.TEST_MODEL["model"])
    parser.add_argument("--effort", default=orch.TEST_MODEL["effort"])
    parser.add_argument("--delay", type=int, default=2, help="seconds between steps")
    parser.add_argument("--turn-timeout", type=int, default=90)
    parser.add_argument("--dispatch-timeout", type=int, default=900,
                        help="seconds to wait for all queued UE dispatches to finish")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"Cropout UE Chain: {args.provider}/{args.model} @ {args.effort}")
    print(f"CWD: {TEST_CWD}  Delay: {args.delay}s")
    print(f"{'='*60}\n")

    if not os.path.isdir(TEST_CWD):
        print(f"TEST_CWD not found: {TEST_CWD} (set PI_WEB_TEST_CWD)")
        sys.exit(2)

    orch.PI_WEB_URL = PI_WEB_URL
    orch.TEST_CWD = TEST_CWD  # create_session() reads orch.TEST_CWD, which defaults to the pi-web repo
    orch.TURN_TIMEOUT_S = args.turn_timeout

    procs_before = list_editor_processes()
    editors_before = None if procs_before is None else {p["pid"] for p in procs_before}
    results, session_id, passed_count, judged = [], None, 0, False
    try:
        print("Creating session...")
        session_id = orch.create_session(args.provider, args.model, args.effort)
        print(f"Session: {session_id}\n")

        step_refs = {}
        for i, step in enumerate(STEPS):
            if i > 0:
                print(f"  (waiting {args.delay}s...)")
                time.sleep(args.delay)

            violations, chain, refs = run_step(session_id, step, args.turn_timeout)
            step_refs[step["id"]] = refs
            print(f"  [{'TURN OK' if not violations else 'TURN FAIL'}] {step['id']} ({len(refs)} dispatch)")
            results.append({"step": step["id"], "violations": violations, "chain_length": len(chain),
                            "dispatch_logs": [r["log_path"] for r in refs if r["log_path"]], "pass": False})
            print()

        # The turns only prove the model dispatched; the UE outcome lands in each
        # dispatch log once the queued work actually runs.
        print(f"Waiting up to {args.dispatch_timeout}s for {pending_dispatches(step_refs)} "
              "queued dispatch(es) to finish...")
        outcomes = resolve_outcomes(step_refs, timeout_s=args.dispatch_timeout)
        out_of_order = order_violations([s["id"] for s in STEPS], outcomes)
        expect = {s["id"]: s["expect_tool"] for s in STEPS}
        for r in results:
            step_outcomes = outcomes[r["step"]]
            if expect[r["step"]] == "ue_dispatch":
                r["violations"] += count_violations(step_outcomes)
            r["violations"] += outcome_violations(step_outcomes) + out_of_order.get(r["step"], [])
            r["dispatch_logs"] = [o["log_path"] for o in step_outcomes if o["log_path"]]
            r["pass"] = not r["violations"]
            print(f"  [{'PASS' if r['pass'] else 'FAIL'}] {r['step']}")
            for v in r["violations"]:
                print(f"    ✗ {v}")
        print()
        passed_count = sum(1 for r in results if r.get("pass"))
        judged = True
    finally:
        total = len(STEPS)
        try:
            print(f"{'='*60}")
            print(f"Results: {passed_count}/{total} steps passed")
            failed = [s["id"] for s in STEPS if not any(r["step"] == s["id"] and r.get("pass") for r in results)]
            if failed:
                print(f"Failed: {', '.join(failed)}")
            print(f"{'='*60}")

            results_dir = os.path.join(os.path.dirname(__file__), "results",
                                       f"cropout-chain-{args.model}-{time.strftime('%Y%m%d-%H%M%S')}")
            os.makedirs(results_dir, exist_ok=True)
            with open(os.path.join(results_dir, "summary.json"), "w", encoding="utf-8") as f:
                # complete: every step ran AND every dispatch outcome was judged.
                json.dump({"session": session_id, "steps": results, "passed": passed_count, "total": total,
                           "complete": judged and len(results) == total}, f, indent=2)
            print(f"Results: {results_dir}")
        finally:
            cleanup_owned_editors(editors_before)

    if passed_count == total:
        import shutil
        shutil.rmtree(results_dir, ignore_errors=True)
        print("All passed — artifacts cleaned up.")

    sys.exit(0 if passed_count == total else 1)


def list_editor_processes():
    """[{pid, cmd}] for running UnrealEditor processes; [] off Windows; None if the listing failed."""
    import subprocess
    if sys.platform != "win32":
        return []
    query = ("Get-CimInstance Win32_Process -Filter \"Name='UnrealEditor.exe'\" | "
             "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    try:
        proc = subprocess.run(["powershell", "-NoProfile", "-Command", query],
                              capture_output=True, text=True, timeout=20)
        if proc.returncode != 0:
            raise OSError(f"powershell exit {proc.returncode}: {proc.stderr.strip()[:200]}")
        return parse_editor_rows(proc.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        print(f"  Editor listing warning: {e}")
        return None


def cleanup_owned_editors(before_pids):
    """Stop only editors this run started on TEST_CWD; never touch other projects' editors."""
    import subprocess

    def kill(pid):
        # /t: the editor's child processes (shader workers) go with it.
        return subprocess.run(["taskkill", "/f", "/t", "/pid", str(pid)],
                              capture_output=True, timeout=10).returncode

    for msg in stop_owned_editors(before_pids, list_editor_processes(), TEST_CWD, kill):
        print(f"  {msg}")


if __name__ == "__main__":
    main()
