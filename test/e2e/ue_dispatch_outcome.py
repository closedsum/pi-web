"""Resolve the real outcome of ue_dispatch calls made during an e2e run.

The ue_dispatch tool is fire-and-forget: its tool result only says the
dispatcher launched. The actual UE outcome is the final JSON document the
dispatcher writes to its log file. These helpers find each dispatch in the
SSE event stream, wait for its log to finish, and turn failures and
out-of-order execution into test violations.
"""
import json
import os
import re
import time

FINAL_TIMEOUT_ERROR = "TIMEOUT: dispatch log never produced a final result"
MAX_CONSECUTIVE_READ_ERRORS = 5


def _as_result(candidate):
    """The result object starting at candidate; text after it (trailing log lines) is ignored."""
    try:
        doc, _ = json.JSONDecoder().raw_decode(candidate)
    except json.JSONDecodeError:
        return None
    return doc if isinstance(doc, dict) and "success" in doc else None


def parse_final_result(text):
    """Return the dispatcher's final JSON result from log/tool text, or None if pending.

    Logs hold single-line {"status": "waiting", ...} heartbeats and plain
    lock messages, followed by one result object: pretty-printed with its
    opening brace at column 0, or compact on a single line. Indented braces
    belong to nested objects and never start a result (a half-written log
    must not yield a nested action).
    """
    lines = (text or "").splitlines()
    for start in range(len(lines) - 1, -1, -1):
        line = lines[start]
        if line.rstrip() == "{":
            result = _as_result("\n".join(lines[start:]))
        elif line.startswith("{") and line.rstrip().endswith("}"):
            result = _as_result(line)
        else:
            continue
        if result is not None:
            return result
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


def _waiting(ref):
    return bool(ref["log_path"]) and ref["result"] is None and ref["error"] is None


def pending_dispatches(steps):
    """How many dispatches in {step_id: [ref, ...]} still wait on their log."""
    return sum(1 for refs in steps.values() for ref in refs if _waiting(ref))


def _read(path):
    """(text, mtime) of the log; (None, None) while it does not exist yet. Other I/O errors raise."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read(), os.fstat(f.fileno()).st_mtime
    except FileNotFoundError:
        return None, None


def _tail(text, lines=3):
    return " | ".join((text or "").strip().splitlines()[-lines:])[:300]


def resolve_outcomes(steps, timeout_s=900, poll_s=2.0):
    """Wait for every pending dispatch log to finish.

    steps: {step_id: [ref, ...]} from dispatch_refs.
    Returns {step_id: [{log_path, result, error, finished_at}, ...]}. finished_at
    is the log's final mtime, set only for dispatches whose log completed
    (inline results never queued, so they take no part in order checks).
    """
    outcomes = {step: [dict(ref, finished_at=None) for ref in refs] for step, refs in steps.items()}
    pending = {(step, i): o for step, refs in outcomes.items() for i, o in enumerate(refs) if _waiting(o)}
    last_text, read_errors = {}, {}
    deadline = time.monotonic() + timeout_s
    while pending:
        for key, o in list(pending.items()):
            try:
                text, mtime = _read(o["log_path"])
            except OSError as e:
                # The dispatcher may hold the log open mid-write; only a persistent error is final.
                errors = read_errors.setdefault(key, [])
                errors.append(e)
                if len(errors) >= MAX_CONSECUTIVE_READ_ERRORS:
                    o["error"] = f"READ_ERROR: {o['log_path']}: {e}"
                    del pending[key]
                continue
            read_errors.pop(key, None)
            last_text[key] = text
            result = parse_final_result(text) if text is not None else None
            if result is not None:
                o["result"], o["finished_at"] = result, mtime
                del pending[key]
        if not pending or time.monotonic() >= deadline:
            break
        time.sleep(poll_s)
    for key, o in pending.items():
        text = last_text.get(key)
        if read_errors.get(key):
            o["error"] = f"READ_ERROR: {o['log_path']}: {read_errors[key][-1]}"
        elif text is None:
            o["error"] = f"{FINAL_TIMEOUT_ERROR} (log file never appeared: {o['log_path']})"
        else:
            o["error"] = f"{FINAL_TIMEOUT_ERROR}; log tail: {_tail(text)}"
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


def count_violations(outcomes):
    """A UE step must produce exactly one ue_dispatch outcome."""
    if not outcomes:
        return ["NO_OUTCOME: no ue_dispatch result to judge"]
    if len(outcomes) > 1:
        return [f"MULTIPLE_DISPATCH: {len(outcomes)} ue_dispatch calls"]
    return []


def order_violations(step_ids, outcomes):
    """FIFO check: none of a step's dispatches may finish before an earlier step's last one."""
    violations = {}
    latest, latest_step = None, None
    for step in step_ids:
        times = [o["finished_at"] for o in outcomes.get(step, []) if o.get("finished_at") is not None]
        if not times:
            continue
        if latest is not None and min(times) < latest:
            violations[step] = [f"OUT_OF_ORDER: finished before earlier step '{latest_step}'"]
        if latest is None or max(times) >= latest:
            latest, latest_step = max(times), step
    return violations


def _norm_path(value):
    return (value or "").replace("\\", "/").rstrip("/").casefold()


def parse_editor_rows(out):
    """[{pid, cmd}] from Get-CimInstance ... | ConvertTo-Json output. Raises ValueError if malformed."""
    rows = json.loads(out) if out.strip() else []  # JSONDecodeError is a ValueError
    rows = rows if isinstance(rows, list) else [rows]
    if not all(isinstance(r, dict) and "ProcessId" in r for r in rows):
        raise ValueError(f"unexpected editor listing: {out[:200]}")
    return [{"pid": r["ProcessId"], "cmd": r.get("CommandLine")} for r in rows]


def select_owned_editors(before_pids, procs, project_dir):
    """PIDs of editor processes this run started: new since the snapshot and opened on project_dir.

    before_pids or procs of None means the listing failed; ownership is then
    unknown and nothing is selected. project_dir must match as a whole path
    (D:/Trees/Game never matches D:/Trees/GameBackup).
    """
    project = _norm_path(project_dir)
    if before_pids is None or procs is None or not project:
        return []
    owned = re.compile(r"(?:^|(?<=[\s\"'=]))" + re.escape(project) + r"(?=[/\s\"']|$)")
    return [p["pid"] for p in procs
            if p["pid"] not in before_pids and owned.search(_norm_path(p.get("cmd")))]


def stop_owned_editors(before_pids, procs, project_dir, kill):
    """Kill editors this run started via kill(pid) -> exit code. Returns report lines.

    A failed kill is reported and does not stop the remaining ones.
    """
    if before_pids is None or procs is None:
        return ["Editor cleanup skipped: editor listing failed, so test-owned editors are unknown"]
    pids = select_owned_editors(before_pids, procs, project_dir)
    if not pids:
        return [f"No test-owned UE editor to stop ({len(procs)} live, none new on {project_dir})"]
    msgs = []
    for pid in pids:
        try:
            code = kill(pid)
        except Exception as e:  # noqa: BLE001 - cleanup must reach every editor
            msgs.append(f"Failed to stop test-owned UE editor PID {pid}: {e}")
            continue
        if code:
            msgs.append(f"Failed to stop test-owned UE editor PID {pid}: taskkill exit {code}")
        else:
            msgs.append(f"Stopped test-owned UE editor PID {pid} ({project_dir})")
    return msgs
