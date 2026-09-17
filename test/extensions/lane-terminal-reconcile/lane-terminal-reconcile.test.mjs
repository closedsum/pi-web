import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent } from "../_config.mjs";

const TERMINAL_STATUSES = new Set([
  "finished", "failed", "timed_out", "cancelled",
  "integrated", "integration_unsafe", "blocked", "preflight_failed",
]);

const LANE_COMMAND_RE = /gsd_impl_lane\.py\s+(?:list|status|run|wait)\b/i;

function matchesLaneCommand(cmd) {
  return LANE_COMMAND_RE.test(cmd);
}

function normalizeLanes(stdout) {
  if (!stdout) return [];
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.lanes)) return parsed.lanes;
    if (parsed && typeof parsed === "object" && parsed.slug) return [parsed];
    return [];
  } catch { return []; }
}

function pickFreshTerminalLanes(lanes, alreadySeen) {
  return lanes.filter((lane) =>
    TERMINAL_STATUSES.has(lane.status) && !alreadySeen.has(lane.slug),
  );
}

function countRunning(lanes) {
  return lanes.filter((lane) => !TERMINAL_STATUSES.has(lane.status)).length;
}

function seatCap(envCap, configCap) {
  if (envCap) {
    const n = parseInt(envCap, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return configCap || 10;
}

function buildReport(freshTerminal, running, cap) {
  const parts = [];
  if (freshTerminal.length > 0) {
    parts.push(`Reconciled ${freshTerminal.length} terminal lane(s): ${freshTerminal.map((l) => l.slug).join(", ")}`);
  }
  parts.push(`seats ${running}/${cap}`);
  if (running < cap) {
    parts.push(`${cap - running} slot(s) available`);
  }
  return parts.join(" · ");
}

test("matchesLaneCommand detects list", () => {
  assert.ok(matchesLaneCommand("python gsd_impl_lane.py list --repo ."));
});

test("matchesLaneCommand detects wait", () => {
  assert.ok(matchesLaneCommand("python gsd_impl_lane.py wait --slug x"));
});

test("matchesLaneCommand ignores pipeline", () => {
  assert.ok(!matchesLaneCommand("python gsd_impl_lane.py pipeline"));
});

test("TERMINAL_STATUSES includes all expected statuses", () => {
  assert.ok(TERMINAL_STATUSES.has("finished"));
  assert.ok(TERMINAL_STATUSES.has("failed"));
  assert.ok(TERMINAL_STATUSES.has("timed_out"));
  assert.ok(TERMINAL_STATUSES.has("integration_unsafe"));
  assert.ok(TERMINAL_STATUSES.has("preflight_failed"));
  assert.ok(!TERMINAL_STATUSES.has("running"));
});

test("pickFreshTerminalLanes filters to unseen terminal", () => {
  const lanes = [
    { slug: "a", status: "finished" },
    { slug: "b", status: "running" },
    { slug: "c", status: "failed" },
    { slug: "d", status: "finished" },
  ];
  const seen = new Set(["a"]);
  const fresh = pickFreshTerminalLanes(lanes, seen);
  assert.equal(fresh.length, 2);
  assert.deepEqual(fresh.map((l) => l.slug), ["c", "d"]);
});

test("pickFreshTerminalLanes returns empty when all seen", () => {
  const lanes = [{ slug: "a", status: "finished" }];
  const seen = new Set(["a"]);
  assert.deepEqual(pickFreshTerminalLanes(lanes, seen), []);
});

test("pickFreshTerminalLanes returns empty for running lanes", () => {
  const lanes = [{ slug: "a", status: "running" }, { slug: "b", status: "queued" }];
  assert.deepEqual(pickFreshTerminalLanes(lanes, new Set()), []);
});

test("countRunning counts non-terminal lanes", () => {
  const lanes = [
    { slug: "a", status: "running" },
    { slug: "b", status: "finished" },
    { slug: "c", status: "running" },
  ];
  assert.equal(countRunning(lanes), 2);
});

test("countRunning returns 0 when all terminal", () => {
  const lanes = [{ slug: "a", status: "finished" }, { slug: "b", status: "failed" }];
  assert.equal(countRunning(lanes), 0);
});

test("seatCap uses env var when valid", () => {
  assert.equal(seatCap("5", 10), 5);
});

test("seatCap falls back to config", () => {
  assert.equal(seatCap(undefined, 8), 8);
});

test("seatCap defaults to 10", () => {
  assert.equal(seatCap(undefined, undefined), 10);
});

test("seatCap ignores invalid env var", () => {
  assert.equal(seatCap("abc", 7), 7);
  assert.equal(seatCap("0", 7), 7);
  assert.equal(seatCap("-1", 7), 7);
});

test("buildReport includes reconciliation count", () => {
  const report = buildReport([{ slug: "a" }, { slug: "b" }], 3, 10);
  assert.match(report, /Reconciled 2/);
  assert.match(report, /a, b/);
});

test("buildReport shows seat utilization", () => {
  const report = buildReport([], 5, 10);
  assert.match(report, /seats 5\/10/);
  assert.match(report, /5 slot\(s\) available/);
});

test("buildReport omits available slots when at cap", () => {
  const report = buildReport([], 10, 10);
  assert.match(report, /seats 10\/10/);
  assert.ok(!report.includes("available"));
});

test("normalizeLanes handles lanes array wrapper", () => {
  const result = normalizeLanes('{"lanes":[{"slug":"x","status":"running"}]}');
  assert.equal(result.length, 1);
});
