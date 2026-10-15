import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { writeSnapshotAtomic, DebouncedWriter } = await jiti.import("./telemetry-writer.ts");
const { TelemetryCollector } = await jiti.import("./telemetry-collector.ts");

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-writer-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeSnapshotAtomic", () => {
  test("writes snapshot to {sessionId}.json", () => {
    const c = new TelemetryCollector("test-sess");
    c.record("rule-a", 1.5, false);
    const snap = c.snapshot();
    writeSnapshotAtomic(snap, tmpDir);

    const filePath = path.join(tmpDir, "test-sess.json");
    assert.ok(fs.existsSync(filePath));
    const written = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.equal(written.sessionId, "test-sess");
    assert.equal(written.rules["rule-a"].invocations, 1);
  });

  test("no .tmp file remains after write", () => {
    const c = new TelemetryCollector("clean-sess");
    c.record("x", 1, false);
    writeSnapshotAtomic(c.snapshot(), tmpDir);

    const files = fs.readdirSync(tmpDir);
    assert.ok(!files.some((f) => f.endsWith(".tmp")));
  });

  test("does not throw on invalid directory (TEL-04)", () => {
    const c = new TelemetryCollector("fail-sess");
    c.record("x", 1, false);
    assert.doesNotThrow(() => {
      writeSnapshotAtomic(c.snapshot(), "/nonexistent/path/that/cannot/exist");
    });
  });
});

describe("DebouncedWriter", () => {
  test("schedule debounces — one write after interval", async () => {
    const c = new TelemetryCollector("debounce-sess");
    c.record("a", 1, false);
    const writer = new DebouncedWriter(c, 50, tmpDir);

    writer.schedule();
    writer.schedule();
    writer.schedule();

    await new Promise((r) => setTimeout(r, 100));

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    writer.stop();
  });

  test("stop flushes pending snapshot", () => {
    const c = new TelemetryCollector("flush-sess");
    c.record("b", 2, true);
    const writer = new DebouncedWriter(c, 60_000, tmpDir);

    writer.schedule();
    writer.stop();

    const filePath = path.join(tmpDir, "flush-sess.json");
    assert.ok(fs.existsSync(filePath));
  });

  test("stop is safe to call twice", () => {
    const c = new TelemetryCollector("double-stop");
    const writer = new DebouncedWriter(c, 1000, tmpDir);
    writer.stop();
    assert.doesNotThrow(() => writer.stop());
  });
});

describe("concurrent session isolation (TEST-03)", () => {
  test("two sessions write independent files", () => {
    const c1 = new TelemetryCollector("sess-alpha");
    const c2 = new TelemetryCollector("sess-beta");
    c1.record("r1", 1, false);
    c2.record("r2", 2, true);

    writeSnapshotAtomic(c1.snapshot(), tmpDir);
    writeSnapshotAtomic(c2.snapshot(), tmpDir);

    const f1 = JSON.parse(fs.readFileSync(path.join(tmpDir, "sess-alpha.json"), "utf-8"));
    const f2 = JSON.parse(fs.readFileSync(path.join(tmpDir, "sess-beta.json"), "utf-8"));

    assert.equal(f1.sessionId, "sess-alpha");
    assert.equal(f2.sessionId, "sess-beta");
    assert.ok(f1.rules["r1"]);
    assert.ok(!f1.rules["r2"]);
    assert.ok(f2.rules["r2"]);
    assert.ok(!f2.rules["r1"]);
  });
});
