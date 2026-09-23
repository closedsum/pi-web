"""Unit tests for ue_dispatch_outcome (run: npm run test:py)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ue_dispatch_outcome import (  # noqa: E402
    dispatch_refs,
    order_violations,
    outcome_violations,
    parse_final_result,
    resolve_outcomes,
)

FINAL_OK = {"success": True, "provider": "codex", "actions": [{"step": 1, "intent": "open map", "success": True}]}
FINAL_FAIL = {
    "success": False,
    "actions": [{"step": 1, "intent": "start PIE", "success": False,
                 "error": "CsMCP catalog unavailable"}],
}
FAST_PATH_FAIL = {"success": False, "model": "fast_path",
                  "result": {"success": False, "error": "no_editor", "message": "No editor running"}}
WAITING = '{"status": "waiting", "held_by": {"pid": 1, "intent": "launch", "age_s": 1.0, "wait_s": 0.0}}'


def end_event(tool, *, details=None, text="", is_error=False):
    return {"type": "tool_execution_end", "toolName": tool, "isError": is_error,
            "result": {"content": [{"type": "text", "text": text}], "details": details}}


class ParseFinalResultTest(unittest.TestCase):
    def test_pretty_json_after_waiting_lines(self):
        text = "\n".join([WAITING, "Dispatch lock held by live PID 1 — continuing to poll",
                          json.dumps(FINAL_OK, indent=2)])
        self.assertEqual(parse_final_result(text), FINAL_OK)

    def test_only_waiting_lines_is_pending(self):
        self.assertIsNone(parse_final_result(WAITING + "\n" + WAITING))

    def test_empty_and_truncated_are_pending(self):
        self.assertIsNone(parse_final_result(""))
        self.assertIsNone(parse_final_result('{\n  "success": true,\n'))

    def test_bare_json_document(self):
        self.assertEqual(parse_final_result(json.dumps(FAST_PATH_FAIL, indent=2)), FAST_PATH_FAIL)


class DispatchRefsTest(unittest.TestCase):
    def test_background_dispatch_yields_log_path(self):
        refs = dispatch_refs([end_event("ue_dispatch", details={"pid": 5, "logPath": "C:/t/a.log", "finished": False})])
        self.assertEqual(refs, [{"log_path": "C:/t/a.log", "result": None, "error": None}])

    def test_finished_dispatch_parses_inline_result(self):
        refs = dispatch_refs([end_event("ue_dispatch", details={"code": 0, "finished": True},
                                        text=json.dumps(FINAL_FAIL, indent=2))])
        self.assertEqual(refs, [{"log_path": None, "result": FINAL_FAIL, "error": None}])

    def test_error_result_is_failure(self):
        refs = dispatch_refs([end_event("ue_dispatch", text="ue_ops_dispatch.py exited 2: bad args", is_error=True)])
        self.assertEqual(refs, [{"log_path": None, "result": None, "error": "ue_ops_dispatch.py exited 2: bad args"}])

    def test_ignores_other_tools_and_events(self):
        events = [end_event("read", text="x"), {"type": "message_update"},
                  end_event("CheckDispatchStatus", details={"logPath": "C:/t/b.log"})]
        self.assertEqual(dispatch_refs(events), [])


class ResolveOutcomesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write_log(self, name, text):
        path = os.path.join(self.dir.name, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_reads_finished_logs(self):
        ok = self.write_log("ok.log", json.dumps(FINAL_OK, indent=2))
        steps = {"a": [{"log_path": ok, "result": None, "error": None}]}
        out = resolve_outcomes(steps, timeout_s=1, poll_s=0.01)
        self.assertEqual(out["a"][0]["result"], FINAL_OK)
        self.assertIsNotNone(out["a"][0]["finished_at"])

    def test_pending_log_times_out(self):
        pending = self.write_log("p.log", WAITING)
        out = resolve_outcomes({"a": [{"log_path": pending, "result": None, "error": None}]},
                               timeout_s=0.05, poll_s=0.01)
        self.assertIsNone(out["a"][0]["result"])
        self.assertEqual(out["a"][0]["error"], "TIMEOUT: dispatch log never produced a final result")


class ViolationsTest(unittest.TestCase):
    def test_success_has_no_violations(self):
        self.assertEqual(outcome_violations([{"result": FINAL_OK, "error": None}]), [])

    def test_failed_action_reports_error(self):
        self.assertEqual(outcome_violations([{"result": FINAL_FAIL, "error": None}]),
                         ["UE_FAILED: start PIE: CsMCP catalog unavailable"])

    def test_fast_path_failure_reports_nested_error(self):
        self.assertEqual(outcome_violations([{"result": FAST_PATH_FAIL, "error": None}]),
                         ["UE_FAILED: no_editor: No editor running"])

    def test_error_and_missing_dispatch(self):
        self.assertEqual(outcome_violations([{"result": None, "error": "boom"}]), ["UE_FAILED: boom"])
        self.assertEqual(outcome_violations([]), [])

    def test_fifo_order_ok_and_violated(self):
        ok = {"a": [{"finished_at": 1.0}], "b": [{"finished_at": 2.0}], "c": []}
        self.assertEqual(order_violations(["a", "b", "c"], ok), {})
        bad = {"a": [{"finished_at": 1.0}], "b": [{"finished_at": 5.0}], "c": [{"finished_at": 3.0}]}
        self.assertEqual(order_violations(["a", "b", "c"], bad),
                         {"c": ["OUT_OF_ORDER: finished before earlier step 'b'"]})


if __name__ == "__main__":
    unittest.main()
