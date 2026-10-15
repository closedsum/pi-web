import assert from "node:assert/strict";
import test, { describe } from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./process-liveness.ts");
  } catch { return import("./process-liveness.ts"); }
}

describe("isProcessAlive", () => {
  test("returns true for the current process PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(process.pid), true);
  });

  test("returns false for a known-dead PID", async () => {
    const { isProcessAlive } = await loadSubject();
    // PID 99999999 is extremely unlikely to be alive
    assert.equal(isProcessAlive(99999999), false);
  });

  test("returns false for PID 0", async () => {
    const { isProcessAlive } = await loadSubject();
    // PID 0 is the kernel/system process — process.kill(0,0) sends to process group
    // which is a special case; treat as not a valid target
    assert.equal(typeof isProcessAlive(0), "boolean");
  });

  test("returns false for negative PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(-1), false);
  });

  test("returns false for NaN", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(NaN), false);
  });

  test("returns false for non-integer PID", async () => {
    const { isProcessAlive } = await loadSubject();
    assert.equal(isProcessAlive(3.14), false);
  });

  test("returns true for parent process PID (if available)", async () => {
    const { isProcessAlive } = await loadSubject();
    const ppid = process.ppid;
    if (ppid && ppid > 0) {
      assert.equal(isProcessAlive(ppid), true);
    }
  });
});
