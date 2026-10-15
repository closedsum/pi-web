import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./lane-driver-manager.ts");
  } catch { return import("./lane-driver-manager.ts"); }
}

describe("ensureLaneDriver", () => {
  let tmpDir;
  let stateDir;
  let spawnCalls;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ldm-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ldm-state-"));
    spawnCalls = [];
    fs.mkdirSync(path.join(tmpDir, ".planning"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".planning", "config.json"), "{}");
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function mockSpawner(pid) {
    return (...args) => {
      spawnCalls.push(args);
      return { pid, unref() {} };
    };
  }

  function mockAlive(alivePids) {
    return (pid) => alivePids.includes(pid);
  }

  test("spawns daemon for eligible project with no lock", async () => {
    const { ensureLaneDriver } = await loadSubject();
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 1, "should spawn once");
    assert.ok(spawnCalls[0][1].includes("run"), "should pass 'run' arg");
  });

  test("skips spawn when daemon already alive", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({ pid: 42 }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(100),
      aliveCheck: mockAlive([42]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn when alive");
  });

  test("respawns when daemon dead (lock with dead PID)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({ pid: 99999999 }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 1, "should respawn when dead");
  });

  test("skips when not a GSD project (no .planning/config.json)", async () => {
    const { ensureLaneDriver } = await loadSubject();
    fs.rmSync(path.join(tmpDir, ".planning", "config.json"));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn without config.json");
  });

  test("skips when project is under temp dir", async () => {
    const { ensureLaneDriver } = await loadSubject();
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: path.dirname(tmpDir),
    });
    assert.equal(spawnCalls.length, 0, "should not spawn in temp dir");
  });

  test("skips when stop sentinel exists", async () => {
    const { ensureLaneDriver } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".planning", "driver.stop"), "");
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn with stop sentinel");
  });

  test("skips when backoff triggered (3 restarts in 60s)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    const now = Date.now();
    const backoffLog = [now - 30000, now - 20000, now - 10000];
    fs.writeFileSync(path.join(lockDir, `${hash}.backoff`), JSON.stringify(backoffLog));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn during backoff");
  });

  test("allows when lock file has corrupt JSON (treats as dead)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), "not json{{{");
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(12345),
      aliveCheck: mockAlive([]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 1, "should spawn when lock is corrupt");
  });

  test("treats v2 running lock with alive PID as alive", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({
      schema: 2, pid: 42, proc_start: 1700000000.0,
      boot_id: "abc", instance_nonce: "n1", heartbeat_seq: 5,
      heartbeat_at: new Date().toISOString(), state: "running", last_error: null,
    }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(100),
      aliveCheck: mockAlive([42]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn when v2 running");
  });

  test("respawns when v2 lock has stale heartbeat", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    const staleTime = new Date(Date.now() - 30000).toISOString();
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({
      schema: 2, pid: 42, proc_start: 1700000000.0,
      boot_id: "abc", instance_nonce: "n1", heartbeat_seq: 5,
      heartbeat_at: staleTime, state: "running", last_error: null,
    }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(100),
      aliveCheck: mockAlive([42]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 1, "should respawn when heartbeat stale");
  });

  test("treats v1 lock with alive PID as alive (backward compat)", async () => {
    const { ensureLaneDriver, projectHash } = await loadSubject();
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    const hash = projectHash(tmpDir);
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({ pid: 42, started_at: "2026-10-15" }));
    ensureLaneDriver(tmpDir, stateDir, {
      spawner: mockSpawner(100),
      aliveCheck: mockAlive([42]),
      tempDir: "/nonexistent-temp-sentinel",
    });
    assert.equal(spawnCalls.length, 0, "should not spawn when v1 alive");
  });
});

describe("getDaemonStatus", () => {
  let stateDir;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-gds-"));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  test("returns unknown when no lock file", async () => {
    const { getDaemonStatus, projectHash } = await loadSubject();
    const hash = projectHash("/some/project");
    const result = getDaemonStatus(stateDir, hash, () => false);
    assert.equal(result.status, "unknown");
    assert.equal(result.reason, "no_lock_file");
  });

  test("returns full status with schema version for v2 lock", async () => {
    const { getDaemonStatus, projectHash } = await loadSubject();
    const hash = projectHash("/some/project");
    const lockDir = path.join(stateDir, "lane-driver");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, `${hash}.lock`), JSON.stringify({
      schema: 2, pid: 42, proc_start: 1700000000.0,
      boot_id: "abc", instance_nonce: "n1", heartbeat_seq: 10,
      heartbeat_at: new Date().toISOString(), state: "running", last_error: null,
    }));
    const result = getDaemonStatus(stateDir, hash, () => true);
    assert.equal(result.status, "running");
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.identityVerified, true);
    assert.equal(typeof result.heartbeatAgeMs, "number");
  });
});
