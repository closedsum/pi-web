import assert from "node:assert/strict";
import test, { describe } from "node:test";
import path from "path";
import os from "os";
import fs from "fs";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./git-query.ts");
  } catch { return import("./git-query.ts"); }
}

describe("gitRevParseShowToplevel", () => {
  test("returns the repo root for this project", async () => {
    const { gitRevParseShowToplevel } = await loadSubject();
    const root = gitRevParseShowToplevel(process.cwd());
    assert.ok(root !== null, "should find repo root");
    assert.ok(fs.existsSync(path.join(root, "package.json")), "root should contain package.json");
  });

  test("returns null for a non-git directory", async () => {
    const { gitRevParseShowToplevel } = await loadSubject();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-query-"));
    try {
      const origCeiling = process.env.GIT_CEILING_DIRECTORIES;
      process.env.GIT_CEILING_DIRECTORIES = path.dirname(tmpDir);
      const result = gitRevParseShowToplevel(tmpDir);
      if (origCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = origCeiling;
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null for a nonexistent directory", async () => {
    const { gitRevParseShowToplevel } = await loadSubject();
    const result = gitRevParseShowToplevel("/nonexistent/path/that/does/not/exist");
    assert.equal(result, null);
  });

  test("completes within 100ms on this repo (after warmup)", async () => {
    const { gitRevParseShowToplevel } = await loadSubject();
    gitRevParseShowToplevel(process.cwd());
    const start = performance.now();
    gitRevParseShowToplevel(process.cwd());
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `took ${elapsed.toFixed(1)}ms, expected < 100ms`);
  });
});

describe("gitLogLatestInScope", () => {
  test("returns an ISO timestamp for files that exist in git history", async () => {
    const { gitLogLatestInScope } = await loadSubject();
    const root = process.cwd();
    const result = gitLogLatestInScope(root, "HEAD", ["package.json"]);
    assert.ok(result !== null, "should find a commit touching package.json");
    // ISO 8601 format: 2026-10-15T12:00:00+00:00
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(result), `expected ISO date, got: ${result}`);
  });

  test("returns null for globs that match no files", async () => {
    const { gitLogLatestInScope } = await loadSubject();
    const root = process.cwd();
    const result = gitLogLatestInScope(root, "HEAD", ["nonexistent-file-*.xyz"]);
    assert.equal(result, null);
  });

  test("returns null for non-git directory", async () => {
    const { gitLogLatestInScope } = await loadSubject();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-query-"));
    try {
      const result = gitLogLatestInScope(tmpDir, "HEAD", ["*"]);
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("completes within 100ms on this repo (after warmup)", async () => {
    const { gitLogLatestInScope } = await loadSubject();
    const root = process.cwd();
    gitLogLatestInScope(root, "HEAD", ["package.json"]);
    const start = performance.now();
    gitLogLatestInScope(root, "HEAD", ["package.json"]);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 100, `took ${elapsed.toFixed(1)}ms, expected < 100ms`);
  });
});
