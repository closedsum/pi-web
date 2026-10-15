import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { blockSettingsHookWrite } = await jiti.import("@/lib/extensions/tool-blockers.ts");

function check(toolName, input) {
  return blockSettingsHookWrite.test(toolName, input);
}

test("blocks writing hook registrations to .claude/settings.json", () => {
  const result = check("Write", {
    file_path: "C:\\Users\\user\\.claude\\settings.json",
    content: '{ "hooks": { "PreToolUse": [] } }',
  });
  assert.ok(result?.block);
  assert.match(result.reason, /deploy\.py/);
});

test("blocks editing PreToolUse in settings.json", () => {
  const result = check("Edit", {
    file_path: "/home/user/.claude/settings.json",
    new_string: '"PreToolUse": [{ "matcher": "Bash" }]',
  });
  assert.ok(result?.block);
});

test("blocks PostToolUse references", () => {
  const result = check("Write", {
    file_path: "C:\\Users\\user\\.claude\\settings.json",
    content: '"PostToolUse": []',
  });
  assert.ok(result?.block);
});

test("allows non-hook settings changes", () => {
  const result = check("Write", {
    file_path: "C:\\Users\\user\\.claude\\settings.json",
    content: '{ "theme": "dark", "model": "opus" }',
  });
  assert.equal(result, undefined);
});

test("allows writes to non-settings files", () => {
  const result = check("Write", {
    file_path: "D:\\Trees\\project\\config.json",
    content: '"hooks": []',
  });
  assert.equal(result, undefined);
});

test("allows writes to project .claude settings without hooks", () => {
  const result = check("Write", {
    file_path: "D:\\Trees\\project\\.claude\\settings.json",
    content: '{ "allowedTools": ["Bash"] }',
  });
  assert.equal(result, undefined);
});

test("ignores non-write tools", () => {
  assert.equal(check("Bash", { file_path: ".claude/settings.json", content: '"hooks":[]' }), undefined);
  assert.equal(check("Read", { file_path: ".claude/settings.json" }), undefined);
});
