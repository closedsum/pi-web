---
phase: 1
plan: "01-C"
title: "Git Query Wrapper"
wave: 1
depends_on: []
files_modified: ["lib/git-query.ts", "lib/git-query.test.mjs"]
requirements: ["INFRA-03", "TEST-01", "TEST-03"]
autonomous: true
---

<objective>
Create `lib/git-query.ts` with synchronous git query functions: `gitRevParseShowToplevel(cwd)` to resolve the repository root, and `gitLogLatestInScope(repo, branch, globs)` to find the latest commit timestamp matching file globs. Both use `execFileSync` with timeout protection, `LC_ALL=C` env, and return `null` on failure. Includes a co-located test file with performance assertions (< 50ms per call on this repo).
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/git-changes.ts (existing git wrapper — async pattern with execFile, timeout, LC_ALL=C env)
- lib/dispatch-status.test.mjs (loadSubject pattern, test structure)
</read_first>

<action>
Create `lib/git-query.test.mjs` with:

```javascript
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
      const result = gitRevParseShowToplevel(tmpDir);
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

  test("completes within 50ms on this repo", async () => {
    const { gitRevParseShowToplevel } = await loadSubject();
    const start = performance.now();
    gitRevParseShowToplevel(process.cwd());
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `took ${elapsed.toFixed(1)}ms, expected < 50ms`);
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

  test("completes within 50ms on this repo", async () => {
    const { gitLogLatestInScope } = await loadSubject();
    const root = process.cwd();
    const start = performance.now();
    gitLogLatestInScope(root, "HEAD", ["package.json"]);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `took ${elapsed.toFixed(1)}ms, expected < 50ms`);
  });
});
```
</action>

<acceptance_criteria>
- `lib/git-query.test.mjs` exists
- File contains `describe("gitRevParseShowToplevel"`
- File contains `describe("gitLogLatestInScope"`
- File contains at least 8 `test(` calls
- File contains `performance.now()` timing assertions
- Running `node --experimental-strip-types --test lib/git-query.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- lib/git-changes.ts (pattern: execFile with timeout, maxBuffer, LC_ALL=C env — Phase 1 uses execFileSync equivalent)
</read_first>

<action>
Create `lib/git-query.ts` with:

```typescript
import { execFileSync } from "child_process";

const GIT_TIMEOUT_MS = 5_000;
const GIT_ENV = { ...process.env, LC_ALL: "C" };

export function gitRevParseShowToplevel(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: GIT_ENV,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function gitLogLatestInScope(
  repo: string,
  branch: string,
  globs: string[],
): string | null {
  try {
    const args = ["log", "-1", "--format=%aI", branch, "--", ...globs];
    const result = execFileSync("git", args, {
      cwd: repo,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      env: GIT_ENV,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}
```

- `execFileSync` (not `execSync`) — no shell injection risk, matches `git-changes.ts` pattern
- 5000ms timeout — generous safety net (50ms target is for typical performance, not the limit)
- `LC_ALL=C` — locale-independent git output
- Return `null` on any failure (ENOENT if git missing, non-zero exit, timeout)
- `%aI` — ISO 8601 author date format
- Spread `globs` after `--` separator for pathspec safety
</action>

<acceptance_criteria>
- `lib/git-query.ts` contains `export function gitRevParseShowToplevel`
- `lib/git-query.ts` contains `export function gitLogLatestInScope`
- `lib/git-query.ts` contains `execFileSync`
- `lib/git-query.ts` contains `LC_ALL`
- `lib/git-query.ts` contains `timeout: GIT_TIMEOUT_MS` or `timeout: 5_000`
- `lib/git-query.ts` contains `--format=%aI`
- `node --experimental-strip-types --test lib/git-query.test.mjs` exits 0
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/git-query.test.mjs
grep -c "export function" lib/git-query.ts
grep -c "test(" lib/git-query.test.mjs
```
</verification>

<must_haves>
- `gitRevParseShowToplevel(cwd)` returns repo root string or null
- `gitLogLatestInScope(repo, branch, globs)` returns ISO timestamp string or null
- Both use `execFileSync` (not `execSync`) — no shell injection
- Both have timeout protection (5000ms)
- Both set `LC_ALL=C` environment variable
- Both complete within 50ms on the pi-web repo (per TEST-03)
- Co-located test file with non-git directory, nonexistent path, and performance edge cases
</must_haves>
