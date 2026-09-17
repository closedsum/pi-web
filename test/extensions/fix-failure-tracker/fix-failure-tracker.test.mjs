import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent } from "../_config.mjs";

const FAILURE_PATTERNS = [
  /packaged_build_harness/i, /ue-build-queue/i, /UnrealBuildTool/i,
  /dotnet.*UBT/i, /pytest/i, /python.*test_/i, /run_pie_tests/i,
  /pie_test_harness/i, /msbuild/i, /compile/i, /BuildCookRun/i, /RunUAT/i,
];

const RESEARCH_PATTERNS = [
  /gsd:cross-research/i, /gsd:find-unknowns/i, /find.unknowns/i,
];

const IGNORE_PATTERNS = [
  /git\s+(status|log|diff|show|branch)/i, /Get-Content/i, /grep/i,
  /cat\s/i, /ls\s/i, /taskkill/i, /tasklist/i,
];

function isFailureCommand(cmd) {
  return FAILURE_PATTERNS.some((p) => p.test(cmd));
}

function isResearchCommand(cmd) {
  return RESEARCH_PATTERNS.some((p) => p.test(cmd));
}

function isIgnoredCommand(cmd) {
  return IGNORE_PATTERNS.some((p) => p.test(cmd));
}

function makeState(count = 0, researchDone = false) {
  return { count, researchDone, since: count > 0 ? "2026-09-01T00:00:00Z" : null, lastError: null };
}

function handleToolResult(event, state) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return state;

  const cmd = event.input?.command || "";
  const exitCode = event.result?.exit_code ?? event.result?.exitCode;

  if (isIgnoredCommand(cmd)) return state;

  if (isResearchCommand(cmd)) {
    return { count: 0, researchDone: true, since: null, lastError: null };
  }

  if (isFailureCommand(cmd)) {
    if (exitCode !== undefined && exitCode !== 0 && exitCode !== null) {
      const newCount = (state.count || 0) + 1;
      return {
        count: newCount,
        researchDone: false,
        since: state.since || new Date().toISOString(),
        lastError: `Failure #${newCount}: ${cmd.slice(0, 80)}`,
      };
    }
    if (exitCode === 0) {
      return { count: 0, since: null, lastError: null, researchDone: false };
    }
  }

  return state;
}

test("increments count on failure command with non-zero exit", () => {
  const state = makeState(0);
  const event = { ...makeBashToolCallEvent("pytest tests/"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 1);
  assert.ok(next.lastError);
});

test("increments from existing count", () => {
  const state = makeState(2);
  const event = { ...makeBashToolCallEvent("pytest tests/"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 3);
});

test("resets count on successful failure command", () => {
  const state = makeState(3);
  const event = { ...makeBashToolCallEvent("pytest tests/"), result: { exit_code: 0 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 0);
  assert.equal(next.since, null);
});

test("resets on research command", () => {
  const state = makeState(5);
  const event = { ...makeBashToolCallEvent("gsd:cross-research"), result: { exit_code: 0 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 0);
  assert.ok(next.researchDone);
});

test("resets on find-unknowns", () => {
  const state = makeState(3);
  const event = { ...makeBashToolCallEvent("gsd:find-unknowns"), result: {} };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 0);
  assert.ok(next.researchDone);
});

test("ignores git status", () => {
  const state = makeState(2);
  const event = { ...makeBashToolCallEvent("git status"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 2);
});

test("ignores grep", () => {
  const state = makeState(1);
  const event = { ...makeBashToolCallEvent("grep -r pattern"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 1);
});

test("ignores non-Bash/PowerShell tools", () => {
  const state = makeState(0);
  const event = { tool: "Edit", input: { command: "pytest" }, result: {} };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 0);
});

test("detects UBT failure", () => {
  const state = makeState(0);
  const event = { ...makeBashToolCallEvent("dotnet UBT build"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 1);
});

test("detects BuildCookRun failure", () => {
  const state = makeState(0);
  const event = { ...makeBashToolCallEvent("RunUAT BuildCookRun"), result: { exit_code: 2 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 1);
});

test("detects msbuild failure", () => {
  const state = makeState(0);
  const event = { ...makePowerShellToolCallEvent("msbuild solution.sln"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 1);
});

test("preserves since timestamp across increments", () => {
  const state = makeState(1);
  state.since = "2026-09-01T10:00:00Z";
  const event = { ...makeBashToolCallEvent("pytest tests/"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.since, "2026-09-01T10:00:00Z");
});

test("sets since on first failure", () => {
  const state = makeState(0);
  const event = { ...makeBashToolCallEvent("pytest tests/"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.ok(next.since);
});

test("no change for non-failure non-research command", () => {
  const state = makeState(2);
  const event = { ...makeBashToolCallEvent("npm test"), result: { exit_code: 1 } };
  const next = handleToolResult(event, state);
  assert.equal(next.count, 2);
});
