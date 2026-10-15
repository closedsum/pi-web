import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseLockFile, deriveDaemonStatus } = await jiti.import(
  "./lock-schema.ts",
);

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-schema-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeLock(name, data) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe("parseLockFile", () => {
  test("parses v2 lock with all fields", () => {
    const lockPath = writeLock("v2.lock", {
      schema: 2,
      pid: 1234,
      proc_start: 1700000000.0,
      boot_id: "abc-123",
      instance_nonce: "nonce-456",
      heartbeat_seq: 10,
      heartbeat_at: "2026-10-15T12:00:00Z",
      state: "running",
      last_error: null,
    });
    const result = parseLockFile(lockPath);
    assert.notEqual(result, null);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.identityVerified, true);
    assert.equal(result.data.pid, 1234);
    assert.equal(result.data.proc_start, 1700000000.0);
    assert.equal(result.data.state, "running");
  });

  test("parses v1 lock as unverified", () => {
    const lockPath = writeLock("v1.lock", {
      pid: 5678,
      started_at: "2026-10-15T12:00:00Z",
    });
    const result = parseLockFile(lockPath);
    assert.notEqual(result, null);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.identityVerified, false);
    assert.equal(result.data.pid, 5678);
  });

  test("returns null for missing file", () => {
    const result = parseLockFile(path.join(tmpDir, "nonexistent.lock"));
    assert.equal(result, null);
  });

  test("returns null for malformed JSON", () => {
    const lockPath = path.join(tmpDir, "bad.lock");
    fs.writeFileSync(lockPath, "not json{{{");
    const result = parseLockFile(lockPath);
    assert.equal(result, null);
  });

  test("returns null for v2 lock missing required field", () => {
    const lockPath = writeLock("incomplete-v2.lock", {
      schema: 2,
      pid: 1234,
      // missing proc_start, boot_id, etc.
    });
    const result = parseLockFile(lockPath);
    assert.equal(result, null);
  });

  test("returns null for empty file", () => {
    const lockPath = path.join(tmpDir, "empty.lock");
    fs.writeFileSync(lockPath, "");
    const result = parseLockFile(lockPath);
    assert.equal(result, null);
  });
});

describe("deriveDaemonStatus", () => {
  const alwaysAlive = () => true;
  const alwaysDead = () => false;

  test("null lock returns unknown", () => {
    const result = deriveDaemonStatus(null, alwaysAlive);
    assert.equal(result.status, "unknown");
    assert.equal(result.reason, "no_lock_file");
  });

  test("v1 lock with alive PID returns running unverified", () => {
    const lock = {
      data: { pid: 1234, started_at: "2026-10-15T12:00:00Z" },
      schemaVersion: 1,
      identityVerified: false,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysAlive);
    assert.equal(result.status, "running");
    assert.equal(result.identityVerified, false);
    assert.match(result.reason, /v1_signal_zero/);
  });

  test("v1 lock with dead PID returns stopped unverified", () => {
    const lock = {
      data: { pid: 1234, started_at: "2026-10-15T12:00:00Z" },
      schemaVersion: 1,
      identityVerified: false,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysDead);
    assert.equal(result.status, "stopped");
    assert.equal(result.identityVerified, false);
  });

  test("v2 lock with errored state returns errored", () => {
    const lock = {
      data: {
        schema: 2,
        pid: 1234,
        proc_start: 1700000000.0,
        boot_id: "abc",
        instance_nonce: "n1",
        heartbeat_seq: 5,
        heartbeat_at: new Date().toISOString(),
        state: "errored",
        last_error: "disk_full",
      },
      schemaVersion: 2,
      identityVerified: true,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysAlive);
    assert.equal(result.status, "errored");
    assert.equal(result.reason, "disk_full");
  });

  test("v2 lock with fresh heartbeat and alive PID returns running", () => {
    const lock = {
      data: {
        schema: 2,
        pid: 1234,
        proc_start: 1700000000.0,
        boot_id: "abc",
        instance_nonce: "n1",
        heartbeat_seq: 10,
        heartbeat_at: new Date().toISOString(),
        state: "running",
        last_error: null,
      },
      schemaVersion: 2,
      identityVerified: true,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysAlive);
    assert.equal(result.status, "running");
    assert.equal(result.identityVerified, true);
    assert.equal(result.schemaVersion, 2);
    assert.equal(typeof result.heartbeatAgeMs, "number");
    assert.ok(result.heartbeatAgeMs < 5000);
  });

  test("v2 lock with stale heartbeat returns stale", () => {
    const staleTime = new Date(Date.now() - 30000).toISOString();
    const lock = {
      data: {
        schema: 2,
        pid: 1234,
        proc_start: 1700000000.0,
        boot_id: "abc",
        instance_nonce: "n1",
        heartbeat_seq: 10,
        heartbeat_at: staleTime,
        state: "running",
        last_error: null,
      },
      schemaVersion: 2,
      identityVerified: true,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysAlive);
    assert.equal(result.status, "stale");
    assert.match(result.reason, /heartbeat_stale/);
  });

  test("v2 lock with dead PID returns stopped", () => {
    const lock = {
      data: {
        schema: 2,
        pid: 1234,
        proc_start: 1700000000.0,
        boot_id: "abc",
        instance_nonce: "n1",
        heartbeat_seq: 10,
        heartbeat_at: new Date().toISOString(),
        state: "running",
        last_error: null,
      },
      schemaVersion: 2,
      identityVerified: true,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysDead);
    assert.equal(result.status, "stopped");
    assert.match(result.reason, /pid_dead/);
  });

  test("heartbeatAgeMs is null for v1 locks", () => {
    const lock = {
      data: { pid: 1234, started_at: "2026-10-15T12:00:00Z" },
      schemaVersion: 1,
      identityVerified: false,
      raw: "{}",
    };
    const result = deriveDaemonStatus(lock, alwaysAlive);
    assert.equal(result.heartbeatAgeMs, null);
  });
});
