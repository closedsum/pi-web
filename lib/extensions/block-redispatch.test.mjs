import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import fs from "fs";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./block-redispatch.ts");
  } catch { return import("./block-redispatch.ts"); }
}

function makeBashInput(cmd) {
  return { command: cmd };
}

describe("checkRedispatchWithoutFix", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-brd-"));
    fs.mkdirSync(path.join(tmpDir, ".planning", "impl-lanes"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("blocks redispatch when prior pipeline failed and no newer commit", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "test-lane",
      write_scope: ["lib/*.ts"],
    }));
    const manifestPath = path.join(tmpDir, ".planning", "impl-lanes", "p-test-lane.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      status: "failed",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const gitChecker = () => null;
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir, gitChecker);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("failed"), "reason should mention failure status");
  });

  test("allows redispatch when prior failed but newer commit exists", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "test-lane",
      write_scope: ["lib/*.ts"],
    }));
    const manifestPath = path.join(tmpDir, ".planning", "impl-lanes", "p-test-lane.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      status: "failed",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const gitChecker = () => "2026-10-02T00:00:00Z";
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir, gitChecker);
    assert.equal(result, undefined, "should allow when fix commit exists");
  });

  test("allows when no prior manifest exists (first dispatch)", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "new-lane",
      write_scope: ["src/*.ts"],
    }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir);
    assert.equal(result, undefined, "should allow first dispatch");
  });

  test("allows when prior pipeline succeeded", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "ok-lane",
      write_scope: ["lib/*.ts"],
    }));
    const manifestPath = path.join(tmpDir, ".planning", "impl-lanes", "p-ok-lane.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ status: "complete" }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir);
    assert.equal(result, undefined, "should allow when prior succeeded");
  });

  test("allows when command doesn't contain pipeline dispatch", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const result = checkRedispatchWithoutFix("Bash", makeBashInput("git status"), tmpDir);
    assert.equal(result, undefined, "should allow non-pipeline commands");
  });

  test("allows non-Bash/PowerShell tools", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const result = checkRedispatchWithoutFix("Read", { file_path: "foo.ts" }, tmpDir);
    assert.equal(result, undefined, "should allow non-shell tools");
  });

  test("allows when params file missing (fail open)", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const cmd = "python gsd_impl_lane.py pipeline --params-file /nonexistent/params.json";
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir);
    assert.equal(result, undefined, "should allow when params file missing");
  });

  test("blocks when status is blocked", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "blocked-lane",
      write_scope: ["src/*.ts"],
    }));
    const manifestPath = path.join(tmpDir, ".planning", "impl-lanes", "p-blocked-lane.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      status: "blocked",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const gitChecker = () => null;
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir, gitChecker);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });

  test("blocks when status is review_failed", async () => {
    const { checkRedispatchWithoutFix } = await loadSubject();
    const paramsPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify({
      slug: "rf-lane",
      write_scope: ["lib/*.ts"],
    }));
    const manifestPath = path.join(tmpDir, ".planning", "impl-lanes", "p-rf-lane.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      status: "review_failed",
      updated_at: "2026-10-01T00:00:00Z",
    }));
    const cmd = `python gsd_impl_lane.py pipeline --params-file ${paramsPath}`;
    const gitChecker = () => null;
    const result = checkRedispatchWithoutFix("Bash", makeBashInput(cmd), tmpDir, gitChecker);
    assert.ok(result, "should block");
    assert.equal(result.block, true);
  });
});
