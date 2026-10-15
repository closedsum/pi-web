import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { blockLaneBranchDelete } = await jiti.import("@/lib/extensions/tool-blockers.ts");

function check(toolName, input) {
  return blockLaneBranchDelete.test(toolName, input);
}

test("blocks git branch -D on impl-lane branch", () => {
  const result = check("Bash", { command: "git branch -D impl-lane/fix-auth" });
  assert.ok(result?.block);
  assert.match(result.reason, /pipeline/);
});

test("blocks git branch -d on impl-lane branch", () => {
  const result = check("PowerShell", { command: "git branch -d impl-lane/fix-detached" });
  assert.ok(result?.block);
});

test("blocks git branch --delete on impl-lane branch", () => {
  const result = check("Bash", { command: "git branch --delete impl-lane/decomp-v2" });
  assert.ok(result?.block);
});

test("allows deleting non-lane branches", () => {
  assert.equal(check("Bash", { command: "git branch -D feature/my-branch" }), undefined);
});

test("allows git branch without delete flag", () => {
  assert.equal(check("Bash", { command: "git branch impl-lane/new-lane" }), undefined);
});

test("allows git branch listing", () => {
  assert.equal(check("Bash", { command: "git branch -a" }), undefined);
});

test("ignores non-shell tools", () => {
  assert.equal(check("Read", { command: "git branch -D impl-lane/x" }), undefined);
});
