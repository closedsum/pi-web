import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { blockSlowForeground } = await jiti.import("@/lib/extensions/tool-blockers.ts");

function check(toolName, input) {
  return blockSlowForeground.test(toolName, input);
}

test("blocks foreground git commit", () => {
  const result = check("Bash", { command: "git commit -m 'test'" });
  assert.ok(result?.block);
  assert.match(result.reason, /run_in_background/);
});

test("allows git commit with run_in_background", () => {
  const result = check("Bash", { command: "git commit -m 'test'", run_in_background: true });
  assert.equal(result, undefined);
});

test("blocks foreground pytest", () => {
  const result = check("PowerShell", { command: "pytest test/" });
  assert.ok(result?.block);
  assert.match(result.reason, /pytest/);
});

test("blocks foreground gsd-review.py", () => {
  const result = check("Bash", { command: "python gsd-review.py --diff HEAD~1" });
  assert.ok(result?.block);
});

test("blocks foreground regression_gate.py", () => {
  const result = check("Bash", { command: "python regression_gate.py" });
  assert.ok(result?.block);
});

test("allows non-slow commands", () => {
  assert.equal(check("Bash", { command: "git status" }), undefined);
  assert.equal(check("Bash", { command: "npm test" }), undefined);
  assert.equal(check("PowerShell", { command: "ls" }), undefined);
});

test("ignores non-shell tools", () => {
  assert.equal(check("Read", { command: "git commit" }), undefined);
  assert.equal(check("Agent", { command: "pytest" }), undefined);
});
