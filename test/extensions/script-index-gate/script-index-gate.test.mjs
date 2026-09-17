import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, assertPassed } from "../_config.mjs";

const SKIP_FILES = new Set(["__init__.py", "conftest.py", "__pycache__", "INDEX.md"]);

const INDEX_MAP = [
  { pattern: /^hooks\/.*\.cjs$/, index: "HOOKS.md" },
  { pattern: /^bin\/ue\/.*\.py$/, index: "UE-RULES.md" },
  { pattern: /^bin\/lib\/.*\.py$/, index: "bin/lib/INDEX.md" },
  { pattern: /^bin\/tests\/test_.*\.py$/, index: "bin/tests/INDEX.md" },
  { pattern: /^bin\/.*\.py$/, index: "UE-RULES.md" },
  { pattern: /^workflows\/.*\.md$/, index: "workflows/INDEX.md" },
];

function basename(filePath) {
  return filePath.split(/[/\\]/).pop();
}

function findMissing(changedFiles, indexContents) {
  const missing = [];
  for (const file of changedFiles) {
    const base = basename(file);
    if (SKIP_FILES.has(base) || base.startsWith("test_")) continue;
    const rule = INDEX_MAP.find((r) => r.pattern.test(file));
    if (!rule) continue;
    const content = indexContents[rule.index] || "";
    const stem = base.replace(/\.[^.]+$/, "");
    if (!content.includes(base) && !content.includes(stem)) {
      missing.push({ file, index: rule.index });
    }
  }
  return missing;
}

function findStale(deletedFiles, indexContents) {
  const stale = [];
  for (const file of deletedFiles) {
    const base = basename(file);
    if (SKIP_FILES.has(base)) continue;
    const rule = INDEX_MAP.find((r) => r.pattern.test(file));
    if (!rule) continue;
    const content = indexContents[rule.index] || "";
    if (content.includes(base)) {
      stale.push({ file, index: rule.index });
    }
  }
  return stale;
}

function handleToolResult(event, context = {}) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (!/\bgit\s+(?:commit|push)\b/.test(cmd)) return undefined;
  if (event.result?.exitCode !== 0 && event.result?.exit_code !== 0) return undefined;

  const missing = findMissing(context.changedFiles || [], context.indexContents || {});
  const stale = findStale(context.deletedFiles || [], context.indexContents || {});

  if (missing.length === 0 && stale.length === 0) return undefined;

  const parts = [];
  if (missing.length > 0) {
    parts.push(`[SCRIPT-INDEX] Missing index entries: ${missing.map((m) => `${m.file} → ${m.index}`).join(", ")}`);
  }
  if (stale.length > 0) {
    parts.push(`[SCRIPT-INDEX] Stale index entries: ${stale.map((s) => `${s.file} → ${s.index}`).join(", ")}`);
  }
  return { advisory: true, message: parts.join("\n") };
}

test("ignores non-git commands", () => {
  assert.equal(handleToolResult({ ...makeBashToolCallEvent("npm test"), result: { exitCode: 0 } }), undefined);
});

test("ignores failed git commits", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'fail'"), result: { exitCode: 1 } };
  assert.equal(handleToolResult(event), undefined);
});

test("reports missing index entry for hook", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["hooks/new-hook.cjs"], indexContents: { "HOOKS.md": "old-hook" } };
  const result = handleToolResult(event, ctx);
  assert.ok(result?.advisory);
  assert.match(result.message, /new-hook/);
});

test("no report when hook is indexed", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["hooks/my-hook.cjs"], indexContents: { "HOOKS.md": "my-hook.cjs" } };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("skips __init__.py", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["bin/lib/__init__.py"], indexContents: {} };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("skips conftest.py", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["bin/tests/conftest.py"], indexContents: {} };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("skips test_ prefixed files", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["bin/tests/test_foo.py"], indexContents: {} };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("detects stale entry for deleted file", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = {
    changedFiles: [],
    deletedFiles: ["hooks/old-hook.cjs"],
    indexContents: { "HOOKS.md": "old-hook.cjs listed here" },
  };
  const result = handleToolResult(event, ctx);
  assert.ok(result?.advisory);
  assert.match(result.message, /Stale/);
  assert.match(result.message, /old-hook/);
});

test("no stale report when deleted file not in index", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: [], deletedFiles: ["hooks/gone.cjs"], indexContents: { "HOOKS.md": "other" } };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("reports both missing and stale in one result", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = {
    changedFiles: ["hooks/new.cjs"],
    deletedFiles: ["hooks/old.cjs"],
    indexContents: { "HOOKS.md": "old.cjs" },
  };
  const result = handleToolResult(event, ctx);
  assert.ok(result?.advisory);
  assert.match(result.message, /Missing/);
  assert.match(result.message, /Stale/);
});

test("matches stem in index content", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["bin/lib/helper.py"], indexContents: { "bin/lib/INDEX.md": "helper module" } };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("files outside mapped dirs are ignored", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["src/main.ts"], indexContents: {} };
  assert.equal(handleToolResult(event, ctx), undefined);
});

test("works with git push", () => {
  const event = { ...makeBashToolCallEvent("git push"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["hooks/unlisted.cjs"], indexContents: { "HOOKS.md": "other" } };
  const result = handleToolResult(event, ctx);
  assert.ok(result?.advisory);
});

test("this hook never blocks (advisory only)", () => {
  const event = { ...makeBashToolCallEvent("git commit -m 'ok'"), result: { exitCode: 0 } };
  const ctx = { changedFiles: ["hooks/a.cjs", "hooks/b.cjs"], indexContents: {} };
  const result = handleToolResult(event, ctx);
  assert.ok(!result?.block);
  assert.ok(result?.advisory);
});
