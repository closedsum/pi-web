import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe, beforeEach, afterEach } from "node:test";

async function loadPathSecurity() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

async function loadFileAccess() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./file-access.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadPathSecurity();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

describe("collectAllowedRoots", () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    mod = await loadFileAccess();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-allowed-roots-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("includes session cwds and projectRoots", () => {
    const roots = mod.collectAllowedRoots({
      sessions: [
        { cwd: path.join(tmpDir, "proj-a"), projectRoot: path.join(tmpDir, "repo-root") },
        { cwd: path.join(tmpDir, "proj-b") },
      ],
    });
    assert.ok(roots.size >= 3, `expected >=3 roots, got ${roots.size}`);
  });

  test("includes recent-project paths", () => {
    const projectPath = path.join(tmpDir, "CropoutSample");
    const roots = mod.collectAllowedRoots({
      recentProjects: [projectPath],
    });
    assert.ok(mod.isFilePathAllowed(projectPath, roots), "recent project should be allowed");
  });

  test("includes piCwdDirs", () => {
    const cwdDir = path.join(tmpDir, "pi-cwd-20260921");
    const roots = mod.collectAllowedRoots({
      piCwdDirs: [cwdDir],
    });
    assert.ok(mod.isFilePathAllowed(cwdDir, roots), "pi-cwd dir should be allowed");
  });

  test("includes additional in-memory roots", () => {
    const extra = path.join(tmpDir, "extra");
    const roots = mod.collectAllowedRoots({
      additional: new Set([extra]),
    });
    assert.ok(mod.isFilePathAllowed(extra, roots), "additional root should be allowed");
  });

  test("denies paths not in any source", () => {
    const roots = mod.collectAllowedRoots({
      sessions: [{ cwd: path.join(tmpDir, "allowed") }],
    });
    assert.ok(!mod.isFilePathAllowed(path.join(tmpDir, "denied"), roots));
  });

  test("readRecentProjectPaths reads from real ~/.pi/recent-projects.json", async () => {
    const paths = mod.readRecentProjectPaths();
    assert.ok(Array.isArray(paths), "returns an array");
    if (paths.length > 0) {
      assert.ok(typeof paths[0] === "string", "entries are strings");
    }
  });

  test("recent-project subpaths are allowed", () => {
    const projectPath = path.join(tmpDir, "MyProject");
    fs.mkdirSync(path.join(projectPath, ".planning", "threads"), { recursive: true });
    fs.writeFileSync(path.join(projectPath, ".planning", "threads", "board.jsonl"), "");
    const roots = mod.collectAllowedRoots({ recentProjects: [projectPath] });
    const boardPath = path.join(projectPath, ".planning", "threads", "board.jsonl");
    assert.ok(mod.isFilePathAllowed(boardPath, roots), "board.jsonl under recent project should be allowed");
    const lanesPath = path.join(projectPath, ".planning", "impl-lanes");
    assert.ok(mod.isFilePathAllowed(lanesPath, roots), "impl-lanes under recent project should be allowed");
  });

  test("paths outside all sources are denied even when recent-projects exist", () => {
    const roots = mod.collectAllowedRoots({
      sessions: [{ cwd: path.join(tmpDir, "session-proj") }],
      recentProjects: [path.join(tmpDir, "recent-proj")],
    });
    const outsidePath = path.join(tmpDir, "evil-project", "secrets.json");
    assert.ok(!mod.isFilePathAllowed(outsidePath, roots), "path outside all sources denied");
  });

  test("combines all sources", () => {
    const sessionPath = path.join(tmpDir, "session");
    const recentPath = path.join(tmpDir, "recent");
    const cwdPath = path.join(tmpDir, "pi-cwd");
    const extraPath = path.join(tmpDir, "extra");
    const roots = mod.collectAllowedRoots({
      sessions: [{ cwd: sessionPath }],
      recentProjects: [recentPath],
      piCwdDirs: [cwdPath],
      additional: new Set([extraPath]),
    });
    assert.ok(mod.isFilePathAllowed(sessionPath, roots));
    assert.ok(mod.isFilePathAllowed(recentPath, roots));
    assert.ok(mod.isFilePathAllowed(cwdPath, roots));
    assert.ok(mod.isFilePathAllowed(extraPath, roots));
    assert.ok(!mod.isFilePathAllowed(path.join(tmpDir, "nope"), roots));
  });
});
