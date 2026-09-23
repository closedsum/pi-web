"""Resolve the real outcome of ue_dispatch calls made during an e2e run.

The ue_dispatch tool is fire-and-forget: its tool result only says the
dispatcher launched. The actual UE outcome is the final JSON document the
dispatcher writes to its log file. These helpers find each dispatch in the
SSE event stream, wait for its log to finish, and turn failures and
out-of-order execution into test violations.
"""
import json
import os
import time

FINAL_TIMEOUT_ERROR = "TIMEOUT: dispatch log never produced a final result"


def parse_final_result(text):
    """Return the dispatcher's final JSON result from log/tool text, or None if pending.

    Logs hold single-line {"status": "waiting", ...} heartbeats and plain
    lock messages, followed by one pretty-printed result object.
    """
    lines = (text or "").splitlines()
    for start in range(len(lines) - 1, -1, -1):
        if lines[start].strip() != "{":
            continue
        try:
            doc = json.loads("\n".join(lines[start:]))
        except json.JSONDecodeError:
            continue
        if isinstance(doc, dict) and "success" in doc:
            return doc
    return None


def _result_text(result):
    content = (result or {}).get("content") or []
    return "\n".join(block.get("text", "") for block in content if isinstance(block, dict))


def dispatch_refs(events):
    """One ref per ue_dispatch tool execution: a log to wait on, an inline result, or an error."""
    refs = []
    for event in events:
        if event.get("type") != "tool_execution_end" or event.get("toolName") != "ue_dispatch":
            continue
        result = event.get("result") or {}
        text = _result_text(result)
        details = result.get("details") or {}
        ref = {"log_path": None, "result": None, "error": None}
        if event.get("isError"):
            ref["error"] = text or "ue_dispatch returned an error"
        elif details.get("logPath") and not details.get("finished"):
            ref["log_path"] = details["logPath"]
        else:
            ref["result"] = parse_final_result(text)
            if ref["result"] is None:
                if details.get("logPath"):
                    ref["log_path"] = details["logPath"]
                else:
                    ref["error"] = "NO_RESULT: ue_dispatch finished without a parseable result"
        refs.append(ref)
    return refs


def _read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def resolve_outcomes(steps, timeout_s=900, poll_s=2.0):
    """Wait for every pending dispatch log to finish.

    steps: {step_id: [ref, ...]} from dispatch_refs (refs may carry finished_at).
    Returns {step_id: [{log_path, result, error, finished_at}, ...]}.
    """
    outcomes = {step: [dict(ref, finished_at=ref.get("finished_at")) for ref in refs]
                for step, refs in steps.items()}
    pending = [o for refs in outcomes.values() for o in refs
               if o["log_path"] and o["result"] is None and o["error"] is None]
    deadline = time.monotonic() + timeout_s
    while pending:
        for o in list(pending):
            result = parse_final_result(_read(o["log_path"]))
            if result is not None:
                o["result"] = result
                o["finished_at"] = os.path.getmtime(o["log_path"])
                pending.remove(o)
        if not pending or time.monotonic() >= deadline:
            break
        time.sleep(poll_s)
    for o in pending:
        o["error"] = FINAL_TIMEOUT_ERROR
    return outcomes


def _action_error(action):
    nested = action.get("result") or {}
    if action.get("error"):
        return action["error"]
    parts = [nested.get("error"), nested.get("message")]
    return ": ".join(p for p in parts if p) or "failed"


def outcome_violations(outcomes):
    """UE_FAILED violations for one step's dispatch outcomes."""
    violations = []
    for o in outcomes:
        if o.get("error"):
            violations.append(f"UE_FAILED: {o['error']}")
            continue
        result = o.get("result") or {}
        if result.get("success") is True:
            continue
        failed = [a for a in result.get("actions") or [] if not a.get("success")]
        if failed:
            violations.extend(f"UE_FAILED: {a.get('intent', '?')}: {_action_error(a)}" for a in failed)
        elif result.get("result"):
            violations.append(f"UE_FAILED: {_action_error(result)}")
        else:
            violations.append("UE_FAILED: success=false")
    return violations


def order_violations(step_ids, outcomes):
    """FIFO check: a step's dispatches must not finish before an earlier step's did."""
    violations = {}
    latest, latest_step = None, None
    for step in step_ids:
        times = [o["finished_at"] for o in outcomes.get(step, []) if o.get("finished_at") is not None]
        if not times:
            continue
        finished = max(times)
        if latest is not None and finished < latest:
            violations[step] = [f"OUT_OF_ORDER: finished before earlier step '{latest_step}'"]
        if latest is None or finished >= latest:
            latest, latest_step = finished, step
    return violations
