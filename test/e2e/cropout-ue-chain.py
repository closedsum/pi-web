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
from ue_dispatch_outcome import dispatch_refs, order_violations, outcome_violations, resolve_outcomes

PI_WEB_URL = os.environ.get("PI_WEB_URL", "http://127.0.0.1:30141")
TEST_CWD = os.environ.get("PI_WEB_TEST_CWD", r"D:\Trees\CropoutSampleProject")
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
    sse_ready = threading.Event()

    def sse_reader():
        sse_ready.set()
        collected_events.extend(orch.read_sse_events(session_id, timeout_s=turn_timeout))

    reader = threading.Thread(target=sse_reader, daemon=True)
    reader.start()
    sse_ready.wait(timeout=5)
    time.sleep(0.5)

    try:
        orch.send_prompt(session_id, step["prompt"])
    except Exception as e:
        return [f"SEND_FAILED: {e}"], [], []

    reader.join(timeout=turn_timeout)
    chain = orch.extract_chain(collected_events)
    refs = dispatch_refs(collected_events)
    for ref in refs:
        if ref["log_path"] is None:
            ref["finished_at"] = time.time()  # finished inline during the turn

    violations = []
    has_text = any(e["type"] == "text" for e in chain)
    tool_calls = [e for e in chain if e["type"] == "tool_call"]
    dispatches = [e for e in tool_calls if e.get("name") == "DispatchLane"]
    ue_dispatches = [e for e in tool_calls if e.get("name") == "ue_dispatch"]
    status_checks = [e for e in tool_calls if e.get("name") in ("CheckDispatchStatus", "CheckLaneStatus")]

    if not has_text:
        violations.append("NO_TEXT: model returned no text")

    if step["expect_tool"] == "ue_dispatch" and len(ue_dispatches) == 0 and len(dispatches) == 0:
        violations.append(f"NO_DISPATCH: expected ue_dispatch or DispatchLane but got none")

    if len(dispatches) > 1:
        violations.append(f"DISPATCH_LOOP: {len(dispatches)} DispatchLane calls")

    if not collected_events:
        violations.append("NO_EVENTS: SSE stream returned nothing (timeout?)")

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

    orch.PI_WEB_URL = PI_WEB_URL
    orch.TEST_CWD = TEST_CWD  # create_session() reads orch.TEST_CWD, which defaults to the pi-web repo
    orch.TURN_TIMEOUT_S = args.turn_timeout

    print("Creating session...")
    session_id = orch.create_session(args.provider, args.model, args.effort)
    print(f"Session: {session_id}\n")

    results = []
    step_refs = {}
    for i, step in enumerate(STEPS):
        if i > 0:
            print(f"  (waiting {args.delay}s...)")
            time.sleep(args.delay)

        violations, chain, refs = run_step(session_id, step, args.turn_timeout)
        step_refs[step["id"]] = refs
        print(f"  [{'TURN OK' if not violations else 'TURN FAIL'}] {step['id']} ({len(refs)} dispatch)")
        results.append({"step": step["id"], "violations": violations, "chain_length": len(chain)})
        print()

    # The turns only prove the model dispatched; the UE outcome lands in each
    # dispatch log once the queued work actually runs.
    pending = sum(1 for refs in step_refs.values() for r in refs if r["log_path"])
    print(f"Waiting up to {args.dispatch_timeout}s for {pending} queued dispatch(es) to finish...")
    outcomes = resolve_outcomes(step_refs, timeout_s=args.dispatch_timeout)
    out_of_order = order_violations([s["id"] for s in STEPS], outcomes)
    for r in results:
        r["violations"] += outcome_violations(outcomes[r["step"]]) + out_of_order.get(r["step"], [])
        r["dispatch_logs"] = [o["log_path"] for o in outcomes[r["step"]] if o["log_path"]]
        r["pass"] = not r["violations"]
        print(f"  [{'PASS' if r['pass'] else 'FAIL'}] {r['step']}")
        for v in r["violations"]:
            print(f"    ✗ {v}")
    print()

    passed_count = sum(1 for r in results if r["pass"])
    total = len(results)
    print(f"{'='*60}")
    print(f"Results: {passed_count}/{total} steps passed")
    if passed_count < total:
        failed = [r["step"] for r in results if not r["pass"]]
        print(f"Failed: {', '.join(failed)}")
    print(f"{'='*60}")

    results_dir = os.path.join(os.path.dirname(__file__), "results",
                               f"cropout-chain-{args.model}-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(results_dir, exist_ok=True)
    with open(os.path.join(results_dir, "summary.json"), "w") as f:
        json.dump({"session": session_id, "steps": results,
                   "passed": passed_count, "total": total}, f, indent=2)
    print(f"Results: {results_dir}")

    cleanup_stale_processes()

    if passed_count == total:
        import shutil
        shutil.rmtree(results_dir, ignore_errors=True)
        print("All passed — artifacts cleaned up.")

    sys.exit(0 if passed_count == total else 1)


def cleanup_stale_processes():
    """Kill any orphaned UE editor processes left by the test."""
    import subprocess
    if sys.platform != "win32":
        return
    try:
        result = subprocess.run(
            ["tasklist", "/fi", "imagename eq UnrealEditor.exe", "/fo", "csv", "/nh"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.strip().split("\n"):
            if "UnrealEditor" in line:
                parts = line.strip('"').split('","')
                if len(parts) >= 2:
                    pid = parts[1].strip('"')
                    print(f"  Cleaning up stale UE editor PID {pid}")
                    subprocess.run(["taskkill", "/f", "/pid", pid],
                                   capture_output=True, timeout=5)
    except Exception as e:
        print(f"  Cleanup warning: {e}")


if __name__ == "__main__":
    main()
