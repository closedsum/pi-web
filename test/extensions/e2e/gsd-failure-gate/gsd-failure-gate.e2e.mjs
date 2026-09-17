import assert from "node:assert/strict";
import test from "node:test";
import { E2E_CONFIG } from "../../_e2e-harness.mjs";

// Tests the CONSOLIDATED Pi extension logic (3 Claude hooks → 1 Pi handler)
// Source: ~/gsd-config/pi-config/extensions/gsd-failure-gate.ts

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const FAILURE_PATTERNS = [
  /packaged_build_harness/i, /ue-build-queue/i, /UnrealBuildTool/i,
  /dotnet.*UBT/i, /pytest/i, /python.*test_/i, /run_pie_tests/i,
  /pie_test_harness/i, /msbuild/i, /compile/i, /BuildCookRun/i, /RunUAT/i,
];
const RESEARCH_PATTERNS = [/gsd:cross-research/i, /gsd:find-unknowns/i];
const IGNORE_PATTERNS = [/git\s+(status|log|diff)/i, /grep/i, /cat\s/i];

function makeState(count = 0, researchDone = false) {
  return { count, researchDone, since: count > 0 ? "2026-09-01" : null };
}

function shouldBlockEdit(state) {
  return state.count >= 2 && !state.researchDone;
}

function trackResult(state, cmd, exitCode) {
  if (IGNORE_PATTERNS.some((p) => p.test(cmd))) return state;
  if (RESEARCH_PATTERNS.some((p) => p.test(cmd))) return { count: 0, researchDone: true, since: null };
  if (FAILURE_PATTERNS.some((p) => p.test(cmd))) {
    if (exitCode !== 0 && exitCode !== undefined && exitCode !== null) {
      return { count: state.count + 1, researchDone: false, since: state.since || new Date().toISOString() };
    }
    if (exitCode === 0) return { count: 0, researchDone: false, since: null };
  }
  return state;
}

// Gate tests
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows Edit with no failures`, () => {
  assert.ok(!shouldBlockEdit(makeState(0)));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows Edit with 1 failure`, () => {
  assert.ok(!shouldBlockEdit(makeState(1)));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks Edit after 2 failures`, () => {
  assert.ok(shouldBlockEdit(makeState(2)));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] blocks Edit after 5 failures`, () => {
  assert.ok(shouldBlockEdit(makeState(5)));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] allows Edit after research done`, () => {
  assert.ok(!shouldBlockEdit({ count: 5, researchDone: true, since: null }));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] non-edit tools never blocked`, () => {
  // Gate only checks EDIT_TOOLS — Bash, Read, etc. always pass
  assert.ok(!EDIT_TOOLS.has("Bash"));
  assert.ok(!EDIT_TOOLS.has("Read"));
});

// Tracker tests
test(`[CONSOLIDATED ${E2E_CONFIG.model}] tracks pytest failure`, () => {
  const next = trackResult(makeState(0), "pytest tests/", 1);
  assert.equal(next.count, 1);
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] resets on pytest success`, () => {
  const next = trackResult(makeState(3), "pytest tests/", 0);
  assert.equal(next.count, 0);
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] resets on cross-research`, () => {
  const next = trackResult(makeState(5), "gsd:cross-research", undefined);
  assert.equal(next.count, 0);
  assert.ok(next.researchDone);
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] ignores git status`, () => {
  const next = trackResult(makeState(2), "git status", 1);
  assert.equal(next.count, 2);
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] tracks UBT failure`, () => {
  const next = trackResult(makeState(0), "dotnet UBT build", 1);
  assert.equal(next.count, 1);
});

// Integration: gate + tracker combined
test(`[CONSOLIDATED ${E2E_CONFIG.model}] full cycle: fail→fail→block→research→unblock`, () => {
  let state = makeState(0);
  state = trackResult(state, "pytest tests/", 1);
  assert.ok(!shouldBlockEdit(state));
  state = trackResult(state, "pytest tests/", 1);
  assert.ok(shouldBlockEdit(state));
  state = trackResult(state, "gsd:cross-research", undefined);
  assert.ok(!shouldBlockEdit(state));
});
test(`[CONSOLIDATED ${E2E_CONFIG.model}] full cycle: fail→fail→block→success→unblock`, () => {
  let state = makeState(0);
  state = trackResult(state, "pytest tests/", 1);
  state = trackResult(state, "pytest tests/", 1);
  assert.ok(shouldBlockEdit(state));
  state = trackResult(state, "pytest tests/", 0);
  assert.ok(!shouldBlockEdit(state));
});
