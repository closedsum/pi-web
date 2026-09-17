import assert from "node:assert/strict";
import test from "node:test";

const COOLDOWN_S = 30;
const STALE_HEARTBEAT_S = 120;
const STALE_HEARTBEAT_KILL_S = 300;
const CRASH_LOOP_WINDOW_S = 1800;
const CRASH_LOOP_MIN = 3;
const CRASH_LOOP_BACKOFF_S = 900;
const SPOOL_WARN = 50;
const ERROR_STREAK_WARN = 3;

function shouldRespawn(status, now = Date.now()) {
  if (!status) return { respawn: true, reason: "status missing" };
  if (!status.alive) return { respawn: true, reason: "daemon not alive" };
  if (status.pidReused) return { respawn: true, reason: "PID reused by another process" };
  const heartbeatAge = (now - (status.heartbeat || 0)) / 1000;
  if (heartbeatAge > STALE_HEARTBEAT_KILL_S) {
    return { respawn: true, reason: "heartbeat stale > 300s", kill: status.pid };
  }
  return { respawn: false };
}

function healthWarnings(status, now = Date.now()) {
  const warnings = [];
  if (!status) return warnings;
  const heartbeatAge = (now - (status.heartbeat || 0)) / 1000;
  if (heartbeatAge > STALE_HEARTBEAT_S && heartbeatAge <= STALE_HEARTBEAT_KILL_S) {
    warnings.push(`heartbeat stale (${Math.round(heartbeatAge)}s)`);
  }
  if (status.state === "degraded") warnings.push("daemon in degraded state");
  if (status.config_missing) warnings.push("config missing");
  if ((status.spool_depth || 0) > SPOOL_WARN) {
    warnings.push(`high spool depth: ${status.spool_depth}`);
  }
  if ((status.error_streak || 0) >= ERROR_STREAK_WARN) {
    warnings.push(`error streak: ${status.error_streak}`);
  }
  return warnings;
}

function isCrashLoop(recentCrashes) {
  return recentCrashes >= CRASH_LOOP_MIN;
}

function canSpawn(lastSpawnAge, crashLoopDetected) {
  if (crashLoopDetected && lastSpawnAge < CRASH_LOOP_BACKOFF_S) return false;
  if (lastSpawnAge < COOLDOWN_S) return false;
  return true;
}

test("respawn when status is null", () => {
  const result = shouldRespawn(null);
  assert.ok(result.respawn);
  assert.equal(result.reason, "status missing");
});

test("respawn when daemon is not alive", () => {
  const result = shouldRespawn({ alive: false, pid: 1234 });
  assert.ok(result.respawn);
  assert.match(result.reason, /not alive/);
});

test("respawn when PID is reused", () => {
  const result = shouldRespawn({ alive: true, pid: 1234, pidReused: true });
  assert.ok(result.respawn);
  assert.match(result.reason, /PID reused/);
});

test("respawn and kill when heartbeat stale > 300s", () => {
  const now = Date.now();
  const result = shouldRespawn({ alive: true, pid: 5678, heartbeat: now - 301_000 }, now);
  assert.ok(result.respawn);
  assert.equal(result.kill, 5678);
});

test("no respawn when daemon is healthy", () => {
  const now = Date.now();
  const result = shouldRespawn({ alive: true, pid: 1234, heartbeat: now - 10_000 }, now);
  assert.ok(!result.respawn);
});

test("warning for stale heartbeat 120-300s", () => {
  const now = Date.now();
  const warnings = healthWarnings({ alive: true, heartbeat: now - 150_000 }, now);
  assert.ok(warnings.some((w) => w.includes("heartbeat stale")));
});

test("no heartbeat warning when fresh", () => {
  const now = Date.now();
  const warnings = healthWarnings({ alive: true, heartbeat: now - 30_000 }, now);
  assert.ok(!warnings.some((w) => w.includes("heartbeat")));
});

test("warning for degraded state", () => {
  const warnings = healthWarnings({ alive: true, state: "degraded", heartbeat: Date.now() });
  assert.ok(warnings.some((w) => w.includes("degraded")));
});

test("warning for missing config", () => {
  const warnings = healthWarnings({ alive: true, config_missing: true, heartbeat: Date.now() });
  assert.ok(warnings.some((w) => w.includes("config missing")));
});

test("warning for high spool depth", () => {
  const warnings = healthWarnings({ alive: true, spool_depth: 75, heartbeat: Date.now() });
  assert.ok(warnings.some((w) => w.includes("spool depth")));
});

test("warning for error streak", () => {
  const warnings = healthWarnings({ alive: true, error_streak: 5, heartbeat: Date.now() });
  assert.ok(warnings.some((w) => w.includes("error streak")));
});

test("no warnings for healthy daemon", () => {
  const warnings = healthWarnings({
    alive: true, heartbeat: Date.now(), state: "running",
    spool_depth: 10, error_streak: 0,
  });
  assert.equal(warnings.length, 0);
});

test("crash loop detected at 3+ crashes", () => {
  assert.ok(isCrashLoop(3));
  assert.ok(isCrashLoop(5));
  assert.ok(!isCrashLoop(2));
  assert.ok(!isCrashLoop(0));
});

test("spawn blocked during crash loop backoff", () => {
  assert.ok(!canSpawn(60, true));
  assert.ok(!canSpawn(CRASH_LOOP_BACKOFF_S - 1, true));
});

test("spawn allowed after crash loop backoff", () => {
  assert.ok(canSpawn(CRASH_LOOP_BACKOFF_S + 1, true));
});

test("spawn blocked during normal cooldown", () => {
  assert.ok(!canSpawn(10, false));
  assert.ok(!canSpawn(COOLDOWN_S - 1, false));
});

test("spawn allowed after normal cooldown", () => {
  assert.ok(canSpawn(COOLDOWN_S + 1, false));
});

test("empty warnings for null status", () => {
  assert.deepEqual(healthWarnings(null), []);
});
