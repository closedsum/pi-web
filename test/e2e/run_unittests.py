"""Run the e2e helper unit tests, keeping full tracebacks for any error or failure.

`npm run test:py` runs this. The console report is unittest's usual one. On any
error, failure or unexpected success the full report is also written to a new
private file <tempdir>/pi-web-test-py/<UTC stamp>-<pid>-<random>.log and the path
is printed, so a failure that scrolled away or was cut by an output filter is
still diagnosable (#49). Only the newest MAX_REPORTS reports are kept. Exit
codes follow `python -m unittest`: 0 pass, 1 fail, 5 no tests ran.
"""
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_LOG_DIR = Path(tempfile.gettempdir()) / "pi-web-test-py"
MAX_REPORTS = 20
NO_TESTS_EXIT = 5  # what `python -m unittest` returns since Python 3.12


def _stamp():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _report(result):
    sections = [f"ERROR: {test.id()}\n{trace}" for test, trace in result.errors]
    sections += [f"FAIL: {test.id()}\n{trace}" for test, trace in result.failures]
    sections += [f"UNEXPECTED SUCCESS: {test.id()}\n" for test in result.unexpectedSuccesses]
    return "\n\n".join(sections)  # a blank line between reports keeps them grep-separable


def _write_report(log_dir, text, stream):
    """Write text to a new private report (mkstemp: unique name, mode 0600) and prune old ones."""
    log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f"{_stamp()}-{os.getpid()}-", suffix=".log", dir=log_dir)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    log = Path(name)
    reports = sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in (p for p in reports[MAX_REPORTS:] if p != log):
        try:
            old.unlink(missing_ok=True)  # a concurrent run may have pruned it already
        except OSError as error:
            print(f"warning: could not prune old failure report {old}: {error}", file=stream)
    return log


def run(start_dir, log_dir, stream):
    """Discover and run test_*.py under start_dir; return the process exit code."""
    start = str(Path(start_dir).resolve())
    suite = unittest.TestLoader().discover(start, pattern="test_*.py", top_level_dir=start)
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    if result.testsRun == 0:
        print("NO TESTS RAN", file=stream)
        return NO_TESTS_EXIT
    if result.wasSuccessful():
        return 0
    log = _write_report(Path(log_dir), _report(result), stream)
    print(f"Full failure report: {log}", file=stream)
    return 1


if __name__ == "__main__":
    sys.exit(run(HERE, DEFAULT_LOG_DIR, sys.stderr))
