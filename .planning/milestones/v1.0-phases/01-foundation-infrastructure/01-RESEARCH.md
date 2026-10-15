# Phase 1: Foundation Infrastructure — Research

**Researched:** 2026-10-15
**Scope:** 4 utility modules for downstream hook porting (Phase 2–4)

## Existing Patterns

### Module Structure
- Modules live flat in `lib/` as `.ts` files with named exports
- No default exports — all use `export function`/`export const`/`export interface`
- Imports use Node.js built-ins directly: `import { homedir } from "os"`, `import { execFile } from "child_process"`
- Path alias `@/` maps to project root (tsconfig `"@/*": ["./*"]`)
- TypeScript target: ES2017, module: esnext, strict mode enabled

### Small Utility Module Pattern
Example: `lib/default-cwd.ts` (19 lines) — pure functions, no classes, no side effects at import time. Parameters have defaults for testability (`now = new Date()`, `home = homedir()`). This is the pattern Phase 1 modules should follow.

Example: `lib/atomic-file.ts` (33 lines) — uses Node.js `fs` sync APIs directly, handles errors by checking `(error as NodeJS.ErrnoException).code`.

### Existing Git Utilities
`lib/git-changes.ts` already wraps git via `child_process.execFile` with:
- Async wrapper: `const execFileAsync = promisify(execFile)`
- Timeout: `GIT_TIMEOUT_MS = 10_000` 
- Max buffer: `GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024`
- Env override: `{ ...process.env, LC_ALL: "C" }`
- Helper: `findRepositoryRoot(cwd)` calls `git rev-parse --show-toplevel`

**Key decision:** Phase 1 needs SYNC git queries (per INFRA-03 success criteria: "complete within 50ms"). `git-changes.ts` uses async. New `git-query.ts` should use `execFileSync` for simplicity and to meet the sync requirement. Different enough to be a separate module.

### Existing Process/PID Patterns
`lib/mcp-transport.test.mjs:77` and `lib/project-command-env.test.mjs:334` already use `process.kill(pid, 0)` for liveness checks in tests. This validates the approach for `process-liveness.ts`.

`lib/session-liveness.ts` exists but is a completely different abstraction — it's a session-level liveness registry with providers, not PID-level checking.

### Extension System (Downstream Consumer)
`lib/extensions/tool-blockers.ts` defines `BlockRule`:
```typescript
export interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>) => BlockResult | undefined;
}
```
- Currently 21 rules in `ALL_RULES` array
- `evaluateBlockRules()` iterates rules, returns first match
- Rules are pure functions: `(toolName, input) => BlockResult | undefined`
- **No context parameter yet** — Phase 2 will extend this with optional `ctx?: BlockRuleContext`
- Phase 1 modules will be imported BY Phase 2 rules (e.g., `fork-completion-gate` needs `resolveStateHome()`)

## Test Patterns

### Standard Pattern (loadSubject + jiti)
Tests are co-located `.test.mjs` files. Two import patterns observed:

**Pattern A — loadSubject() with jiti fallback** (per CLAUDE.md convention):
```javascript
async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./module.ts");
  } catch { return import("./module.ts"); }
}
```
Used in: `dispatch-status.test.mjs`, `task-board.test.mjs`

**Pattern B — Direct jiti import** (simpler, used in extension tests):
```javascript
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { fn1, fn2 } = await jiti.import("./module.ts");
```
Used in: `tool-blockers.test.mjs`, `session-liveness.test.mjs`

**Pattern C — Direct .ts import** (simplest, works with Node >=22.19 --experimental-strip-types):
```javascript
const { writePrivateFileAtomicSync } = await import("./atomic-file.ts");
```
Used in: `atomic-file.test.mjs`

Phase 1 should use **Pattern A** (loadSubject) per CLAUDE.md convention.

### Test Structure
- Import: `import assert from "node:assert/strict"` and `import test, { describe } from "node:test"`
- Temp dirs: `fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-<module>-"))` with `t.after()` cleanup
- Assertions: `assert.equal`, `assert.deepEqual`, `assert.throws`, `assert.ok`
- Cleanup: `t.after(() => fs.rmSync(root, { recursive: true, force: true }))`
- Run via: `node --experimental-strip-types --test lib/<module>.test.mjs`

### Extension Test Harness
`lib/extensions/_test-harness.mjs` provides `createMockPi()`, `assertBlocks()`, `assertAllows()` — used by Phase 2+, not Phase 1.

Tool-blocker tests use a simpler inline pattern: `blocked(rule, toolName, input)` / `allowed(rule, toolName, input)` helper functions.

## Module Design Notes

### 1. state-home.ts (INFRA-01)
**Purpose:** Resolve `GSD_STATE_HOME` env var or fall back to `~/.gsd`

**Design:**
```typescript
import { homedir } from "os";
import path from "path";

export function resolveStateHome(env = process.env): string {
  const explicit = env.GSD_STATE_HOME;
  if (explicit) return path.resolve(explicit);
  return path.join(homedir(), ".gsd");
}
```

**Notes:**
- Accept `env` parameter for testability (like `default-cwd.ts` accepts `home` param)
- Use `path.resolve()` on explicit values to normalize relative paths
- No directory creation — caller responsibility (matches existing codebase style)
- No caching needed — env vars don't change mid-process

### 2. process-liveness.ts (INFRA-02)
**Purpose:** Check if a PID is alive via signal-zero

**Design:**
```typescript
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true; // exists but no permission
    return false;
  }
}
```

**Edge cases for tests:**
- Current PID (`process.pid`) → must return true
- Known-dead PID (e.g., 99999999) → must return false
- EPERM scenario: process exists but owned by another user → true (alive but inaccessible)
- Invalid PID (0, -1, NaN) → handle gracefully
- Windows: `process.kill(pid, 0)` works on Windows for signal-zero check

### 3. git-query.ts (INFRA-03)
**Purpose:** Sync git queries with timeout protection

**Design:**
```typescript
import { execFileSync } from "child_process";

export function gitRevParseShowToplevel(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, timeout: 5000, encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    }).trim() || null;
  } catch { return null; }
}

export function gitLogLatestInScope(
  repo: string, branch: string, globs: string[]
): string | null {
  try {
    const args = ["log", "-1", "--format=%aI", branch, "--"];
    args.push(...globs);
    const result = execFileSync("git", args, {
      cwd: repo, timeout: 5000, encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
    return result || null;
  } catch { return null; }
}
```

**Key decisions:**
- Use `execFileSync` (not `execSync`) — no shell injection risk, matches `git-changes.ts` pattern
- Use 5000ms timeout (generous; success criteria says "within 50ms" for typical repos)
- Set `LC_ALL=C` to avoid locale-dependent output (matches existing `git-changes.ts`)
- Return `null` on failure rather than throwing
- `%aI` format for ISO 8601 timestamp

**Performance note:** 50ms target is for typical repo operations, not the timeout. The timeout is a safety net for hung git processes.

### 4. shell-command-parser.ts (INFRA-04)
**Purpose:** Extract named arguments from shell command strings

**Design:**
```typescript
export function parseNamedArg(command: string, argName: string): string | null {
  // Match --argName followed by value (space-separated or =separated)
  // Handle quoted values
  const escaped = argName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)${escaped}(?:\\s+|=)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\S+)`
  );
  const match = command.match(pattern);
  if (!match) return null;
  let value = match[1];
  // Strip surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}
```

**Test cases:**
- `parseNamedArg("cmd --params-file /path/to/file", "--params-file")` → `/path/to/file`
- `parseNamedArg("cmd --params-file=/path/to/file", "--params-file")` → `/path/to/file`
- `parseNamedArg('cmd --params-file "/path with spaces/file"', "--params-file")` → `/path with spaces/file`
- `parseNamedArg("cmd --other-flag value", "--params-file")` → `null`
- `parseNamedArg("", "--params-file")` → `null`
- Partial match: `--params-file-extra` should NOT match `--params-file`

## Pitfalls & Edge Cases

1. **Windows path separators:** `path.join(homedir(), ".gsd")` produces backslashes on Windows. Downstream consumers must handle both separators.

2. **process.kill on Windows:** Signal-zero works but ESRCH/EPERM codes may differ. Test on Windows.

3. **Git not installed:** `execFileSync("git", ...)` throws `ENOENT` if git isn't on PATH. Functions should return null gracefully.

4. **Shell command parser scope:** Only needs to handle known invocation patterns (per Out of Scope: "full shell parser is overkill"). Regex on `--name value` and `--name=value` is sufficient.

5. **Node.js version:** >=22.19.0 guarantees `--experimental-strip-types` works. All Node.js APIs used (child_process, process.kill, os.homedir) are stable.

6. **Test isolation:** Tests that set env vars must restore them in `t.after()`. Tests that spawn processes must clean them up.

## Dependencies

All 4 modules use only Node.js built-ins — no npm dependencies needed:
- `os` (homedir)
- `path` (join, resolve)
- `child_process` (execFileSync)
- `process` (kill, env, pid)

Dev dependency `jiti` is already in package.json for test imports.

---
*Research completed: 2026-10-15*

## RESEARCH COMPLETE
