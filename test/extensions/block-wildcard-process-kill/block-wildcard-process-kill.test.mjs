import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { blockWildcardProcessKill } = await jiti.import("@/lib/extensions/tool-blockers.ts");

function check(toolName, input) {
  return blockWildcardProcessKill.test(toolName, input);
}

test("blocks taskkill /im with wildcard", () => {
  const result = check("Bash", { command: 'taskkill /im "node*"' });
  assert.ok(result?.block);
  assert.match(result.reason, /PID-targeted/);
});

test("blocks taskkill /IM with question mark wildcard", () => {
  const result = check("PowerShell", { command: "taskkill /IM python?.exe" });
  assert.ok(result?.block);
});

test("allows taskkill /pid", () => {
  assert.equal(check("Bash", { command: "taskkill /pid 1234" }), undefined);
});

test("allows taskkill /im with exact name", () => {
  assert.equal(check("Bash", { command: "taskkill /im node.exe" }), undefined);
});

test("blocks Stop-Process -Name with wildcard", () => {
  const result = check("PowerShell", { command: "Stop-Process -Name 'python*'" });
  assert.ok(result?.block);
  assert.match(result.reason, /Stop-Process -Id/);
});

test("allows Stop-Process -Id", () => {
  assert.equal(check("PowerShell", { command: "Stop-Process -Id 5678" }), undefined);
});

test("ignores non-shell tools", () => {
  assert.equal(check("Read", { command: "taskkill /im *" }), undefined);
});
