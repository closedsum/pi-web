"""The test:py runner keeps full tracebacks for every error and failure (#49)."""
import io
import os
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

import run_unittests

FAILING_SUITE = textwrap.dedent('''
    import unittest

    class Sample(unittest.TestCase):
        def test_fails(self):
            self.assertEqual(1, 2, "deliberate failure marker")

        def test_errors(self):
            raise RuntimeError("deliberate error marker")

        def test_passes(self):
            pass
''')

PASSING_SUITE = textwrap.dedent('''
    import unittest

    class Sample(unittest.TestCase):
        def test_passes(self):
            pass
''')


def _suite_dir(root, source, module):
    # Distinct module names: both suites are discovered in this one process.
    suite = Path(root, "suite")
    suite.mkdir()
    (suite / f"{module}.py").write_text(source, encoding="utf-8")
    return suite


class RunUnittestsTest(unittest.TestCase):
    def test_failures_and_errors_are_logged_with_full_tracebacks(self):
        with tempfile.TemporaryDirectory() as root:
            logs = Path(root, "logs")
            stream = io.StringIO()
            code = run_unittests.run(
                _suite_dir(root, FAILING_SUITE, "test_runner_sample_failing"), logs, stream)

            self.assertEqual(code, 1)
            [log] = list(logs.glob("*.log"))
            text = log.read_text(encoding="utf-8")
            self.assertIn("deliberate failure marker", text)
            self.assertIn("RuntimeError: deliberate error marker", text)
            self.assertEqual(text.count("Traceback (most recent call last)"), 2)
            self.assertIn(str(log), stream.getvalue())

    def test_a_clean_run_writes_no_log(self):
        with tempfile.TemporaryDirectory() as root:
            logs = Path(root, "logs")
            stream = io.StringIO()
            code = run_unittests.run(
                _suite_dir(root, PASSING_SUITE, "test_runner_sample_passing"), logs, stream)

            self.assertEqual(code, 0)
            self.assertFalse(logs.exists() and any(logs.iterdir()))

    def test_no_tests_ran_exits_5_like_unittest(self):
        with tempfile.TemporaryDirectory() as root:
            empty = Path(root, "empty")
            empty.mkdir()
            stream = io.StringIO()
            self.assertEqual(run_unittests.run(empty, Path(root, "logs"), stream), 5)
            self.assertIn("NO TESTS RAN", stream.getvalue())

    def test_two_failing_runs_with_the_same_stamp_keep_both_reports(self):
        with tempfile.TemporaryDirectory() as root:
            suite, logs = _suite_dir(root, FAILING_SUITE, "test_runner_sample_twice"), Path(root, "logs")
            with mock.patch.object(run_unittests, "_stamp", return_value="20260923T000000Z"):
                run_unittests.run(suite, logs, io.StringIO())
                run_unittests.run(suite, logs, io.StringIO())
            self.assertEqual(len(list(logs.glob("*.log"))), 2)

    def test_old_reports_are_pruned_to_the_newest(self):
        with tempfile.TemporaryDirectory() as root:
            logs = Path(root, "logs")
            logs.mkdir()
            for index in range(run_unittests.MAX_REPORTS + 5):
                old = logs / f"old-{index:02d}.log"
                old.write_text("old", encoding="utf-8")
                os.utime(old, (1_000_000 + index, 1_000_000 + index))
            stream = io.StringIO()
            run_unittests.run(_suite_dir(root, FAILING_SUITE, "test_runner_sample_prune"), logs, stream)
            reports = list(logs.glob("*.log"))
            self.assertEqual(len(reports), run_unittests.MAX_REPORTS)
            newest = stream.getvalue().split("Full failure report: ")[1].strip()
            self.assertIn(Path(newest), reports)
            self.assertNotIn(logs / "old-00.log", reports)

    @unittest.skipUnless(os.name == "posix", "POSIX permission bits; Windows ACLs are per-user profile")
    def test_reports_are_private_to_the_user(self):
        with tempfile.TemporaryDirectory() as root:
            logs = Path(root, "logs")
            run_unittests.run(_suite_dir(root, FAILING_SUITE, "test_runner_sample_private"), logs,
                              io.StringIO())
            [log] = list(logs.glob("*.log"))
            self.assertEqual(stat.S_IMODE(log.stat().st_mode) & 0o077, 0)
            self.assertEqual(stat.S_IMODE(logs.stat().st_mode) & 0o077, 0)


if __name__ == "__main__":
    unittest.main()
