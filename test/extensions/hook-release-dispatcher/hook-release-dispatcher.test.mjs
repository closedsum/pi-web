import assert from "node:assert/strict";
import test from "node:test";

const SCHEMA_VERSION = 1;

function validName(name) {
  return typeof name === "string" && /^[a-z0-9_-]+\.cjs$/.test(name);
}

function containedFile(root, filePath) {
  const resolved = filePath.replace(/\.\./g, "").replace(/^[/\\]+/, "");
  return `${root}/${resolved}`;
}

function readPointer(pointerContent) {
  if (!pointerContent) return { error: "missing pointer file" };
  try {
    const pointer = JSON.parse(pointerContent);
    if (pointer.schema !== SCHEMA_VERSION) {
      return { error: `unsupported schema version: ${pointer.schema}` };
    }
    if (!pointer.version || !pointer.path) {
      return { error: "pointer missing version or path" };
    }
    return { pointer };
  } catch (e) {
    return { error: `invalid JSON: ${e.message}` };
  }
}

function compareResults(liveResult, pinnedResult) {
  const diffs = [];
  if (liveResult.exitCode !== pinnedResult.exitCode) {
    diffs.push({ field: "exitCode", live: liveResult.exitCode, pinned: pinnedResult.exitCode });
  }
  if (liveResult.stdout !== pinnedResult.stdout) {
    diffs.push({ field: "stdout", live: "...", pinned: "..." });
  }
  if (liveResult.stderr !== pinnedResult.stderr) {
    diffs.push({ field: "stderr", live: "...", pinned: "..." });
  }
  return diffs;
}

function resultSummary(result) {
  return {
    exitCode: result.exitCode,
    stdoutLen: (result.stdout || "").length,
    stderrLen: (result.stderr || "").length,
  };
}

test("validName accepts proper hook names", () => {
  assert.ok(validName("commit-gate.cjs"));
  assert.ok(validName("fork-ledger.cjs"));
  assert.ok(validName("ensure_session_monitor.cjs"));
});

test("validName rejects unsafe names", () => {
  assert.ok(!validName("../etc/passwd.cjs"));
  assert.ok(!validName("hook.js"));
  assert.ok(!validName("UPPERCASE.cjs"));
  assert.ok(!validName(""));
  assert.ok(!validName(null));
});

test("containedFile prevents path traversal", () => {
  const result = containedFile("/releases/v1", "../../etc/passwd");
  assert.ok(!result.includes(".."));
  assert.ok(result.startsWith("/releases/v1/"));
});

test("readPointer parses valid pointer", () => {
  const content = JSON.stringify({ schema: 1, version: "1.2.3", path: "hooks/commit-gate.cjs" });
  const { pointer } = readPointer(content);
  assert.equal(pointer.version, "1.2.3");
  assert.equal(pointer.path, "hooks/commit-gate.cjs");
});

test("readPointer errors on wrong schema", () => {
  const content = JSON.stringify({ schema: 99, version: "1.0", path: "x" });
  const { error } = readPointer(content);
  assert.match(error, /schema version/);
});

test("readPointer errors on missing version", () => {
  const content = JSON.stringify({ schema: 1, path: "x" });
  const { error } = readPointer(content);
  assert.match(error, /missing version/);
});

test("readPointer errors on invalid JSON", () => {
  const { error } = readPointer("not json");
  assert.match(error, /invalid JSON/);
});

test("readPointer errors on null content", () => {
  const { error } = readPointer(null);
  assert.match(error, /missing pointer/);
});

test("compareResults detects exit code diff", () => {
  const diffs = compareResults({ exitCode: 0, stdout: "", stderr: "" }, { exitCode: 2, stdout: "", stderr: "" });
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "exitCode");
});

test("compareResults detects stdout diff", () => {
  const diffs = compareResults(
    { exitCode: 0, stdout: "live output", stderr: "" },
    { exitCode: 0, stdout: "pinned output", stderr: "" },
  );
  assert.ok(diffs.some((d) => d.field === "stdout"));
});

test("compareResults returns empty for identical results", () => {
  const result = { exitCode: 0, stdout: "same", stderr: "" };
  assert.deepEqual(compareResults(result, result), []);
});

test("resultSummary computes lengths", () => {
  const summary = resultSummary({ exitCode: 0, stdout: "hello", stderr: "warn" });
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.stdoutLen, 5);
  assert.equal(summary.stderrLen, 4);
});

test("resultSummary handles missing fields", () => {
  const summary = resultSummary({ exitCode: 1 });
  assert.equal(summary.stdoutLen, 0);
  assert.equal(summary.stderrLen, 0);
});
