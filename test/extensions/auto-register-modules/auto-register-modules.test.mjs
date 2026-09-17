import assert from "node:assert/strict";
import test from "node:test";

const SCRIPT_PATTERN = /^get-shit-done\/bin\/[^/]+\.py$/;
const MODULE_PATTERN = /^get-shit-done\/bin\/lib\/[^/]+\.py$/;
const IGNORED = new Set(["__init__.py", "conftest.py"]);

function classifyEntry(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop();
  if (IGNORED.has(basename) || basename.startsWith("test_")) return null;
  if (MODULE_PATTERN.test(normalized)) return "module";
  if (SCRIPT_PATTERN.test(normalized)) return "script";
  return null;
}

test("classifies lib modules", () => {
  assert.equal(classifyEntry("get-shit-done/bin/lib/gsd_config.py"), "module");
  assert.equal(classifyEntry("get-shit-done/bin/lib/fork_prompt.py"), "module");
});

test("classifies bin scripts", () => {
  assert.equal(classifyEntry("get-shit-done/bin/gsd-review.py"), "script");
  assert.equal(classifyEntry("get-shit-done/bin/build-cross-review-prompt.py"), "script");
});

test("ignores __init__.py and conftest.py", () => {
  assert.equal(classifyEntry("get-shit-done/bin/lib/__init__.py"), null);
  assert.equal(classifyEntry("get-shit-done/bin/lib/conftest.py"), null);
});

test("ignores test files", () => {
  assert.equal(classifyEntry("get-shit-done/bin/lib/test_config.py"), null);
  assert.equal(classifyEntry("get-shit-done/bin/test_review.py"), null);
});

test("ignores files outside the expected paths", () => {
  assert.equal(classifyEntry("src/main.py"), null);
  assert.equal(classifyEntry("get-shit-done/hooks/hook.cjs"), null);
});
