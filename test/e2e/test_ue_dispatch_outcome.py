"""Unit tests for ue_dispatch_outcome (run: npm run test:py)."""
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ue_dispatch_outcome  # noqa: E402
from ue_dispatch_outcome import (  # noqa: E402
    count_violations,
    dispatch_refs,
    order_violations,
    outcome_violations,
    parse_editor_rows,
    parse_final_result,
    resolve_outcomes,
    select_owned_editors,
    stop_owned_editors,
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

    def test_compact_single_line_result(self):
        text = WAITING + "\n" + json.dumps(FINAL_OK)
        self.assertEqual(parse_final_result(text), FINAL_OK)

    def test_half_written_log_does_not_return_nested_object(self):
        full = json.dumps(FINAL_OK, indent=2)
        cut = full[: full.index('"step": 1') + len('"step": 1, "intent": "open map", "success": true')]
        truncated = cut.rsplit("\n", 1)[0] + '\n      "success": true\n    }\n'
        self.assertIsNone(parse_final_result(truncated))

    def test_trailing_lines_after_result_are_ignored(self):
        text = "\n".join([WAITING, json.dumps(FINAL_OK, indent=2), "Dispatch lock released"])
        self.assertEqual(parse_final_result(text), FINAL_OK)


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

    def test_finished_with_unparsed_text_falls_back_to_log(self):
        refs = dispatch_refs([end_event("ue_dispatch", details={"code": 0, "finished": True, "logPath": "C:/t/c.log"},
                                        text=WAITING)])
        self.assertEqual(refs, [{"log_path": "C:/t/c.log", "result": None, "error": None}])

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

    def test_pending_log_times_out_with_log_tail(self):
        pending = self.write_log("p.log", WAITING)
        out = resolve_outcomes({"a": [{"log_path": pending, "result": None, "error": None}]},
                               timeout_s=0.05, poll_s=0.01)
        self.assertIsNone(out["a"][0]["result"])
        self.assertTrue(out["a"][0]["error"].startswith("TIMEOUT: dispatch log never produced a final result"))
        self.assertIn('"status": "waiting"', out["a"][0]["error"])

    def test_polling_picks_up_a_later_write(self):
        path = self.write_log("late.log", WAITING)
        timer = threading.Timer(0.05, lambda: self.write_log("late.log", json.dumps(FINAL_OK, indent=2)))
        timer.start()
        self.addCleanup(timer.cancel)
        out = resolve_outcomes({"a": [{"log_path": path, "result": None, "error": None}]}, timeout_s=2, poll_s=0.01)
        self.assertEqual(out["a"][0]["result"], FINAL_OK)

    def test_missing_log_times_out_as_missing(self):
        path = os.path.join(self.dir.name, "never.log")
        out = resolve_outcomes({"a": [{"log_path": path, "result": None, "error": None}]}, timeout_s=0.05, poll_s=0.01)
        self.assertIn("log file never appeared", out["a"][0]["error"])

    def test_unreadable_log_is_a_read_error(self):
        out = resolve_outcomes({"a": [{"log_path": self.dir.name, "result": None, "error": None}]},
                               timeout_s=0.05, poll_s=0.01)
        self.assertTrue(out["a"][0]["error"].startswith("READ_ERROR:"))

    def test_transient_read_error_keeps_polling(self):
        reads = [PermissionError("locked"), (json.dumps(FINAL_OK, indent=2), 7.0)]

        def fake_read(_path):
            item = reads.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with mock.patch.object(ue_dispatch_outcome, "_read", side_effect=fake_read):
            out = resolve_outcomes({"a": [{"log_path": "x.log", "result": None, "error": None}]},
                                   timeout_s=2, poll_s=0.01)
        self.assertEqual(out["a"][0]["result"], FINAL_OK)
        self.assertIsNone(out["a"][0]["error"])

    def test_inline_results_carry_no_finish_time(self):
        out = resolve_outcomes({"a": [{"log_path": None, "result": FINAL_OK, "error": None}]}, timeout_s=0.01)
        self.assertIsNone(out["a"][0]["finished_at"])


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

    def test_fifo_multi_dispatch_early_completion_is_caught(self):
        outcomes = {"a": [{"finished_at": 10.0}], "b": [{"finished_at": 5.0}, {"finished_at": 12.0}, {"finished_at": None}]}
        self.assertEqual(order_violations(["a", "b"], outcomes),
                         {"b": ["OUT_OF_ORDER: finished before earlier step 'a'"]})

    def test_count_violations_require_exactly_one_outcome(self):
        self.assertEqual(count_violations([]), ["NO_OUTCOME: no ue_dispatch result to judge"])
        self.assertEqual(count_violations([{}]), [])
        self.assertEqual(count_violations([{}, {}]), ["MULTIPLE_DISPATCH: 2 ue_dispatch calls"])

    def test_select_owned_editors_only_new_and_for_this_project(self):
        procs = [
            {"pid": 1, "cmd": r'"C:\UE\UnrealEditor.exe" "D:\Trees\CropoutSampleProject\Cropout.uproject"'},
            {"pid": 2, "cmd": r'"C:\UE\UnrealEditor.exe" "D:\Trees\CropoutSampleProject\Cropout.uproject"'},
            {"pid": 3, "cmd": r'"C:\UE\UnrealEditor.exe" "D:\Trees\OtherGame\Other.uproject"'},
            {"pid": 4, "cmd": None},
        ]
        self.assertEqual(select_owned_editors({1}, procs, "d:/trees/cropoutsampleproject"), [2])

    def test_select_owned_editors_requires_path_boundary(self):
        procs = [
            {"pid": 1, "cmd": r'"C:\UE\UnrealEditor.exe" "D:\Trees\GameBackup\Game.uproject"'},
            {"pid": 2, "cmd": r'"C:\UE\UnrealEditor.exe" "D:\Trees\Game\Game.uproject"'},
            {"pid": 3, "cmd": r'C:\UE\UnrealEditor.exe -project=D:\Trees\Game'},
            {"pid": 4, "cmd": r'C:\UE\UnrealEditor.exe X:\D:\Trees\Game\Game.uproject'},
        ]
        self.assertEqual(select_owned_editors(set(), procs, r"D:\Trees\Game"), [2, 3])

    def test_select_owned_editors_needs_a_snapshot(self):
        procs = [{"pid": 2, "cmd": r'"D:\Trees\Game\Game.uproject"'}]
        self.assertEqual(select_owned_editors(None, procs, r"D:\Trees\Game"), [])
        self.assertEqual(select_owned_editors(set(), None, r"D:\Trees\Game"), [])

    def test_fifo_order_ok_and_violated(self):
        ok = {"a": [{"finished_at": 1.0}], "b": [{"finished_at": 2.0}], "c": []}
        self.assertEqual(order_violations(["a", "b", "c"], ok), {})
        bad = {"a": [{"finished_at": 1.0}], "b": [{"finished_at": 5.0}], "c": [{"finished_at": 3.0}]}
        self.assertEqual(order_violations(["a", "b", "c"], bad),
                         {"c": ["OUT_OF_ORDER: finished before earlier step 'b'"]})


class EditorRowsTest(unittest.TestCase):
    def test_empty_single_and_list(self):
        self.assertEqual(parse_editor_rows(""), [])
        self.assertEqual(parse_editor_rows('{"ProcessId": 5, "CommandLine": "a"}'), [{"pid": 5, "cmd": "a"}])
        self.assertEqual(parse_editor_rows('[{"ProcessId": 5, "CommandLine": "a"}, {"ProcessId": 6}]'),
                         [{"pid": 5, "cmd": "a"}, {"pid": 6, "cmd": None}])

    def test_malformed_output_raises(self):
        for bad in ("not json", "[1]", '{"CommandLine": "a"}'):
            with self.assertRaises(ValueError):
                parse_editor_rows(bad)


class StopOwnedEditorsTest(unittest.TestCase):
    GAME = r"D:\Trees\Game"
    MINE = {"pid": 2, "cmd": r'"D:\Trees\Game\Game.uproject"'}
    OTHER = {"pid": 3, "cmd": r'"D:\Trees\Other\Other.uproject"'}

    def test_unknown_snapshot_skips_cleanup(self):
        kill = mock.Mock()
        msgs = stop_owned_editors(None, [self.MINE], self.GAME, kill)
        kill.assert_not_called()
        self.assertTrue(any("skipped" in m for m in msgs))
        kill = mock.Mock()
        msgs = stop_owned_editors(set(), None, self.GAME, kill)
        kill.assert_not_called()
        self.assertTrue(any("skipped" in m for m in msgs))

    def test_reports_when_nothing_matched(self):
        kill = mock.Mock()
        msgs = stop_owned_editors({2}, [self.MINE, self.OTHER], self.GAME, kill)
        kill.assert_not_called()
        self.assertEqual(msgs, [f"No test-owned UE editor to stop (2 live, none new on {self.GAME})"])

    def test_kill_failures_do_not_stop_remaining_editors(self):
        mine2 = dict(self.MINE, pid=4)
        kill = mock.Mock(side_effect=[OSError("timeout"), 1])
        msgs = stop_owned_editors(set(), [self.MINE, mine2], self.GAME, kill)
        self.assertEqual([c.args[0] for c in kill.call_args_list], [2, 4])
        self.assertTrue(any("PID 2" in m and "timeout" in m for m in msgs))
        self.assertTrue(any("PID 4" in m and "exit 1" in m for m in msgs))


if __name__ == "__main__":
    unittest.main()
