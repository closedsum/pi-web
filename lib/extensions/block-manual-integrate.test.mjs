import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./block-manual-integrate.ts");
  } catch { return import("./block-manual-integrate.ts"); }
}

function makeBashInput(cmd) {
  return { command: cmd };
}

describe("checkManualIntegrate", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-bmi-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("blocks git cherry-pick when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git cherry-pick abc123"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("daemon"), "reason should mention daemon");
  });

  test("blocks git merge when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });

  test("blocks gsd_impl_lane.py integrate when lock has live PID", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("python gsd_impl_lane.py integrate --branch feat"), tmpDir);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });

  test("allows git merge-base (not a merge)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge-base HEAD origin/main"), tmpDir);
    assert.equal(result, undefined, "should allow merge-base");
  });

  test("allows git merge when no lock file exists", async () => {
    const { checkManualIntegrate } = await loadSubject();
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow when no lock");
  });

  test("allows git merge when lock has dead PID (fail open)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: 99999999 }));
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow when PID is dead");
  });

  test("allows non-Bash/PowerShell tools", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Read", { file_path: "foo.ts" }, tmpDir);
    assert.equal(result, undefined, "should allow non-shell tools");
  });

  test("allows Bash commands not matching integration patterns", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), JSON.stringify({ pid: process.pid }));
    const result = checkManualIntegrate("Bash", makeBashInput("git status"), tmpDir);
    assert.equal(result, undefined, "should allow non-integration commands");
  });

  test("allows when lock file has corrupt JSON (fail open)", async () => {
    const { checkManualIntegrate } = await loadSubject();
    fs.writeFileSync(path.join(tmpDir, ".autopilot.lock"), "not json{{{");
    const result = checkManualIntegrate("Bash", makeBashInput("git merge feature-branch"), tmpDir);
    assert.equal(result, undefined, "should allow on parse error");
  });
});
