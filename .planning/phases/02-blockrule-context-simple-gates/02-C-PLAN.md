---
phase: 2
plan: "02-C"
title: "Port fork-completion-gate Rule"
wave: 2
depends_on: ["02-A"]
files_modified: ["lib/extensions/tool-blockers.ts", "lib/extensions/tool-blockers.test.mjs"]
requirements: ["GATE-02", "TEST-02"]
autonomous: true
---

<objective>
Add `forkCompletionGate` as a context-aware BlockRule that blocks `TaskUpdate` with `status: "completed"` when the fork-result state file at `{ctx.stateHome}/fork-results/{taskId}.json` is missing, malformed, or lacks a valid commit SHA. Add allow/block test cases covering missing file, malformed JSON, missing SHA, invalid SHA, and valid completion scenarios.
</objective>

<tasks>
## Task 1: Write test cases (RED)

<read_first>
- lib/extensions/tool-blockers.test.mjs (existing test patterns, confirm forkCompletionGate not present)
- lib/state-home.ts (resolveStateHome — used by the rule for stateHome path)
</read_first>

<action>
Add `forkCompletionGate` to the destructured import at top of `lib/extensions/tool-blockers.test.mjs`:
```javascript
const {
  // ... existing imports ...
  blockProbeInFork,
  forkCompletionGate,  // <-- add
} = await jiti.import("./tool-blockers.ts");
```

Add a new `describe("forkCompletionGate")` block. These tests need a temp directory with mock fork-result files:

```javascript
import fs from "fs";
import path from "path";
import os from "os";

describe("forkCompletionGate", () => {
  let tmpDir;
  let forkResultsDir;

  // Create temp state home with fork-results directory
  test("setup", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-fork-gate-"));
    forkResultsDir = path.join(tmpDir, "fork-results");
    fs.mkdirSync(forkResultsDir, { recursive: true });
  });

  function ctxWith(stateHome) {
    return { cwd: "/project", isSubagent: false, stateHome, sessionId: "test-session" };
  }

  test("blocks TaskUpdate(completed) when fork-result file is missing", () => {
    const ctx = ctxWith(tmpDir);
    blocked(forkCompletionGate, "TaskUpdate", { task_id: "nonexistent-task", status: "completed" }, ctx);
  });

  test("blocks when fork-result JSON is malformed", () => {
    fs.writeFileSync(path.join(forkResultsDir, "bad-json-task.json"), "not json{{{");
    const ctx = ctxWith(tmpDir);
    blocked(forkCompletionGate, "TaskUpdate", { task_id: "bad-json-task", status: "completed" }, ctx);
  });

  test("blocks when fork-result lacks commit_sha field", () => {
    fs.writeFileSync(path.join(forkResultsDir, "no-sha-task.json"), JSON.stringify({ status: "complete" }));
    const ctx = ctxWith(tmpDir);
    blocked(forkCompletionGate, "TaskUpdate", { task_id: "no-sha-task", status: "completed" }, ctx);
  });

  test("blocks when commit_sha is not valid hex", () => {
    fs.writeFileSync(path.join(forkResultsDir, "bad-sha-task.json"), JSON.stringify({ status: "complete", commit_sha: "not-hex!" }));
    const ctx = ctxWith(tmpDir);
    blocked(forkCompletionGate, "TaskUpdate", { task_id: "bad-sha-task", status: "completed" }, ctx);
  });

  test("blocks when commit_sha is too short", () => {
    fs.writeFileSync(path.join(forkResultsDir, "short-sha-task.json"), JSON.stringify({ status: "complete", commit_sha: "abc" }));
    const ctx = ctxWith(tmpDir);
    blocked(forkCompletionGate, "TaskUpdate", { task_id: "short-sha-task", status: "completed" }, ctx);
  });

  test("allows when fork-result has valid commit SHA (7 chars)", () => {
    fs.writeFileSync(path.join(forkResultsDir, "valid-task.json"), JSON.stringify({ status: "complete", commit_sha: "a1b2c3d" }));
    const ctx = ctxWith(tmpDir);
    allowed(forkCompletionGate, "TaskUpdate", { task_id: "valid-task", status: "completed" }, ctx);
  });

  test("allows when fork-result has valid commit SHA (40 chars)", () => {
    fs.writeFileSync(path.join(forkResultsDir, "full-sha-task.json"), JSON.stringify({ status: "complete", commit_sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" }));
    const ctx = ctxWith(tmpDir);
    allowed(forkCompletionGate, "TaskUpdate", { task_id: "full-sha-task", status: "completed" }, ctx);
  });

  test("allows non-completed TaskUpdate statuses", () => {
    const ctx = ctxWith(tmpDir);
    allowed(forkCompletionGate, "TaskUpdate", { task_id: "any-task", status: "in_progress" }, ctx);
  });

  test("allows non-TaskUpdate tools", () => {
    const ctx = ctxWith(tmpDir);
    allowed(forkCompletionGate, "Bash", { command: "echo hello" }, ctx);
  });

  test("allows when no context provided (fail open)", () => {
    allowed(forkCompletionGate, "TaskUpdate", { task_id: "any-task", status: "completed" });
  });

  test("cleanup", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

Note: The `fs`, `path`, `os` imports should be added at the top of the test file if not already present.
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.test.mjs` contains `describe("forkCompletionGate"`
- `lib/extensions/tool-blockers.test.mjs` contains `forkCompletionGate` in the destructured import
- At least 11 test cases covering: missing file, malformed JSON, missing SHA, invalid SHA hex, too-short SHA, valid 7-char SHA, valid 40-char SHA, non-completed status, non-TaskUpdate tool, no context (fail open), cleanup
- Running tests fails because `forkCompletionGate` is not yet exported
</acceptance_criteria>

## Task 2: Implement forkCompletionGate rule (GREEN)

<read_first>
- lib/extensions/tool-blockers.ts (existing rule patterns, helpers like inputStr)
- lib/state-home.ts (resolveStateHome — may import for default stateHome)
</read_first>

<action>
Add at the top of `lib/extensions/tool-blockers.ts`, after existing imports:
```typescript
import { readFileSync } from "fs";
import path from "path";
```

Add `forkCompletionGate` rule before the `ALL_RULES` array:

```typescript
const VALID_SHA_RE = /^[0-9a-f]{7,40}$/i;

export const forkCompletionGate: BlockRule = {
  name: "fork-completion-gate",
  test(toolName, input, ctx) {
    if (!ctx) return;
    if (toolName !== "TaskUpdate") return;
    if (inputStr(input, "status") !== "completed") return;

    const taskId = inputStr(input, "task_id");
    if (!taskId) {
      return { block: true, reason: "fork-completion-gate. TaskUpdate(completed) missing task_id." };
    }

    const resultPath = path.join(ctx.stateHome, "fork-results", `${taskId}.json`);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(resultPath, "utf-8"));
    } catch {
      return { block: true, reason: `fork-completion-gate. Fork result file missing or unreadable: ${resultPath}` };
    }

    const sha = typeof data.commit_sha === "string" ? data.commit_sha : "";
    if (!VALID_SHA_RE.test(sha)) {
      return { block: true, reason: `fork-completion-gate. Invalid or missing commit SHA in ${resultPath}` };
    }
  },
};
```

Add `forkCompletionGate` to the `ALL_RULES` array:
```typescript
export const ALL_RULES: readonly BlockRule[] = [
  // ... existing 21 rules + blockProbeInFork ...
  forkCompletionGate,
];
```

Key behaviors:
- Returns `undefined` (allow) when `ctx` is missing — fail open
- Only fires on `TaskUpdate` with `status: "completed"`
- Reads fork-result JSON file synchronously (acceptable: infrequent trigger)
- Validates `commit_sha` is 7-40 hex chars
- Blocks with clear reason including the file path for debugging
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.ts` contains `export const forkCompletionGate: BlockRule`
- Rule name is `"fork-completion-gate"`
- Rule checks `ctx` exists before proceeding (fail open)
- Rule reads `{ctx.stateHome}/fork-results/{taskId}.json`
- Rule validates `commit_sha` with regex `^[0-9a-f]{7,40}$`
- `ALL_RULES` array includes `forkCompletionGate`
- `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` exits 0
- `npm run build` exits 0
</acceptance_criteria>
</tasks>

<verification>
```bash
grep "export const forkCompletionGate" lib/extensions/tool-blockers.ts
grep "forkCompletionGate" lib/extensions/tool-blockers.ts | wc -l  # Should be 3+ (definition, export, ALL_RULES)
grep "VALID_SHA_RE" lib/extensions/tool-blockers.ts
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
npm run build
```
</verification>

<must_haves>
- forkCompletionGate blocks TaskUpdate(completed) when fork-result is missing
- forkCompletionGate blocks when commit_sha is absent or invalid
- forkCompletionGate allows when valid commit SHA (7-40 hex chars) is present
- forkCompletionGate fails open when no context provided
- Rule is registered in ALL_RULES (total count: 23)
- All existing tests still pass
</must_haves>
