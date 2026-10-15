---
phase: 3
plan: "03-B"
title: "Block Redispatch Without Fix Handler"
wave: 1
depends_on: []
files_modified: ["lib/extensions/block-redispatch.ts", "lib/extensions/block-redispatch.test.mjs"]
requirements: ["GATE-04", "TEST-01", "TEST-02"]
autonomous: true
---

<objective>
Create `lib/extensions/block-redispatch.ts` as an InlineExtension tool_call handler that blocks `gsd_impl_lane.py pipeline --params-file` when the prior pipeline record shows `failed`/`blocked`/`review_failed` and no newer commit exists in the write scope on master. Uses `parseNamedArg` (Phase 1) to extract `--params-file` and `gitLogLatestInScope` (Phase 1) to check for newer commits. Includes co-located tests covering block/allow paths and edge cases (missing files, first dispatch, successful prior).
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/extensions/block-manual-integrate.test.mjs (if exists — reference for InlineExtension test pattern with temp dirs)
- lib/extensions/tool-blockers.test.mjs (reference for blocked/allowed helper pattern)
- lib/shell-command-parser.ts (parseNamedArg signature)
- lib/git-query.ts (gitLogLatestInScope signature)
</read_first>

<action>
Create `lib/extensions/block-redispatch.test.mjs`:

```javascript
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
```
</action>

<acceptance_criteria>
- `lib/extensions/block-redispatch.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("checkRedispatchWithoutFix"`
- File contains at least 9 `test(` calls
- Tests cover block (failed, blocked, review_failed), allow (newer commit, first dispatch, succeeded, non-pipeline, missing params), and fail-open
- Running `node --experimental-strip-types --test lib/extensions/block-redispatch.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- lib/shell-command-parser.ts (parseNamedArg signature: `parseNamedArg(command: string, argName: string): string | null`)
- lib/git-query.ts (gitLogLatestInScope signature: `gitLogLatestInScope(repo: string, branch: string, globs: string[]): string | null`)
- lib/extensions/tool-blockers.ts (commandStr export)
</read_first>

<action>
Create `lib/extensions/block-redispatch.ts`:

```typescript
import { readFileSync } from "fs";
import path from "path";
import { parseNamedArg } from "../shell-command-parser";
import { gitLogLatestInScope } from "../git-query";
import { commandStr } from "./tool-blockers";
import type { BlockResult } from "./types";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PIPELINE_RE = /gsd_impl_lane\.py\s+pipeline\b/;
const FAILURE_STATUSES = new Set(["failed", "blocked", "review_failed"]);

type GitChecker = (repo: string, branch: string, globs: string[]) => string | null;

export function checkRedispatchWithoutFix(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  gitCheck: GitChecker = gitLogLatestInScope,
): BlockResult | undefined {
  if (!SHELL_TOOLS.has(toolName)) return undefined;

  const cmd = commandStr(input);
  if (!PIPELINE_RE.test(cmd)) return undefined;

  const paramsFile = parseNamedArg(cmd, "--params-file");
  if (!paramsFile) return undefined;

  let params: { slug?: string; write_scope?: string[] };
  try {
    params = JSON.parse(readFileSync(paramsFile, "utf-8"));
  } catch {
    return undefined;
  }

  const slug = params.slug;
  if (!slug) return undefined;

  const manifestPath = path.join(cwd, ".planning", "impl-lanes", `p-${slug}.json`);
  let manifest: { status?: string; updated_at?: string };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return undefined;
  }

  if (!manifest.status || !FAILURE_STATUSES.has(manifest.status)) {
    return undefined;
  }

  const writeScope = params.write_scope ?? [];
  if (writeScope.length > 0) {
    const latestCommit = gitCheck(cwd, "master", writeScope);
    if (latestCommit !== null) {
      return undefined;
    }
  }

  return {
    block: true,
    reason: `Pipeline "${slug}" previously ${manifest.status}; fix root cause and commit within WriteScope before redispatch.`,
  };
}
```

The `gitCheck` parameter defaults to `gitLogLatestInScope` but is injectable for testing. Tests pass a mock that returns `null` (no newer commit) or an ISO timestamp (fix exists).
</action>

<acceptance_criteria>
- `lib/extensions/block-redispatch.ts` exists
- File contains `export function checkRedispatchWithoutFix(`
- File imports `parseNamedArg` from `"../shell-command-parser"`
- File imports `gitLogLatestInScope` from `"../git-query"`
- File imports `commandStr` from `"./tool-blockers"`
- File contains `FAILURE_STATUSES` set with `"failed"`, `"blocked"`, `"review_failed"`
- `gitCheck` parameter is injectable for testing
- Running `node --experimental-strip-types --test lib/extensions/block-redispatch.test.mjs` passes all 9 tests
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/extensions/block-redispatch.test.mjs
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
```
Both must pass with 0 failures.
</verification>

<must_haves>
- checkRedispatchWithoutFix function exported from block-redispatch.ts
- Blocks gsd_impl_lane.py pipeline --params-file when prior failed/blocked/review_failed and no newer commit in write scope
- Allows when newer commit exists on master in write scope
- Fails open: missing params file, missing manifest, non-pipeline commands → allow
- Injectable git checker for testability
- 9+ test cases covering block/allow/edge paths
</must_haves>
