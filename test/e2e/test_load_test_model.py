"""Unit tests for orchestrator-e2e load_test_model (run: npm run test:py)."""
import json
import os
import sys
import tempfile
import unittest
from importlib import import_module

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
orch = import_module("orchestrator-e2e")

FILE = {"provider": "p-file", "model": "m-file", "effort": "high"}


class LoadTestModelTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "test-model.json")
        self.write(FILE)

    def write(self, cfg):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(cfg, f)

    def test_file_values_without_overrides(self):
        self.assertEqual(orch.load_test_model(env={}, path=self.path), FILE)

    def test_each_override_applies_independently(self):
        got = orch.load_test_model(env={"PI_TEST_MODEL": "m-env", "PI_TEST_EFFORT": "low"}, path=self.path)
        self.assertEqual(got, {"provider": "p-file", "model": "m-env", "effort": "low"})

    def test_empty_override_is_ignored(self):
        self.assertEqual(orch.load_test_model(env={"PI_TEST_MODEL": ""}, path=self.path), FILE)

    def test_missing_file_exits_with_path(self):
        with self.assertRaises(SystemExit) as ctx:
            orch.load_test_model(env={}, path=os.path.join(self.dir.name, "nope.json"))
        self.assertIn("nope.json", str(ctx.exception))

    def test_missing_key_exits(self):
        self.write({"provider": "p", "model": "m"})
        with self.assertRaises(SystemExit) as ctx:
            orch.load_test_model(env={}, path=self.path)
        self.assertIn("effort", str(ctx.exception))

    def test_repo_file_loads(self):
        cfg = orch.load_test_model(env={})
        self.assertTrue(all(isinstance(cfg[k], str) and cfg[k] for k in ("provider", "model", "effort")))


if __name__ == "__main__":
    unittest.main()
