---
phase: 8
plan: 1
title: Async Git Query + Thenable Safety Net
wave: 1
depends_on: []
files_modified:
  - lib/git-query.ts
  - lib/git-query.test.mjs
  - lib/extensions/tool-blockers.ts
  - lib/extensions/tool-blockers.test.mjs
requirements:
  - ASYNC-02
  - ASYNC-03
  - ASYNC-04
  - TEST-01
autonomous: true
---

# Plan A: Async Git Query + Thenable Safety Net

## Goal

Add async git query functions using promisified `execFile` with `AbortSignal`, `timeout`, `maxBuffer`, `windowsHide`, and no `shell`. Add a thenable safety net to the sync `evaluateBlockRules` that throws `TypeError` if any rule returns a Promise.

## Tasks

<task id="1.1">
<title>Add async git query functions</title>
<read_first>
- lib/git-query.ts (existing sync functions: gitRevParseShowToplevel at L8, gitLogLatestInScope at L20, gitEnv helper)
</read_first>
<action>
Edit `lib/git-query.ts` to add async equivalents:

1. Add import: `import { execFile } from "child_process"` and `import { promisify } from "util"`
2. Create: `const execFileAsync = promisify(execFile)`

3. Export `async function gitLogLatestInScopeAsync(repo: string, branch: string, globs: string[], options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string | null>`:
   - Default timeoutMs to 5000
   - Build args: `["-C", repo, "log", "-1", "--format=%aI", branch, "--", ...globs]`
   - Call `execFileAsync("git", args, { timeout: options?.timeoutMs ?? 5000, encoding: "utf8", env: gitEnv(), maxBuffer: 1024 * 1024, windowsHide: true, signal: options?.signal })`
   - NO `shell` option (ASYNC-03: git.exe directly per CVE-2024-27980)
   - On success: return `stdout.trim() || null`
   - On AbortError: return null (caller's AbortSignal fired)
   - On timeout/error: return null (fail-closed default — no git fact means the rule that needs it will not have evidence to block)

4. Export `async function gitRevParseShowToplevelAsync(cwd: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string | null>`:
   - Same pattern as above but with `["rev-parse", "--show-toplevel"]` args and `-C cwd`

5. Export `interface AsyncGitContext`:
   ```ts
   export interface AsyncGitContext {
     latestInScope: string | null;
     toplevel: string | null;
   }
   ```

6. Export `async function prefetchGitFacts(cwd: string, branch: string, globs: string[], options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<AsyncGitContext>`:
   - Run both queries in parallel: `Promise.all([gitLogLatestInScopeAsync(...), gitRevParseShowToplevelAsync(...)])`
   - Return frozen context: `Object.freeze({ latestInScope, toplevel })`
   - Each query has its own timeout via the options
   - The shared AbortSignal cancels both if the caller aborts
</action>
<acceptance_criteria>
- `lib/git-query.ts` exports `gitLogLatestInScopeAsync` function
- `lib/git-query.ts` exports `gitRevParseShowToplevelAsync` function
- `lib/git-query.ts` exports `prefetchGitFacts` function
- `lib/git-query.ts` exports `AsyncGitContext` type
- No `shell: true` in any execFile call (ASYNC-03)
- All async functions accept `signal?: AbortSignal` parameter
- All async functions accept `timeoutMs` parameter
- `windowsHide: true` in all execFile options
- `maxBuffer` set in all execFile options
</acceptance_criteria>
</task>

<task id="1.2">
<title>Add thenable safety net to sync evaluateBlockRules</title>
<read_first>
- lib/extensions/tool-blockers.ts (evaluateBlockRules at L358-369)
</read_first>
<action>
Edit `lib/extensions/tool-blockers.ts`, in `evaluateBlockRules` function:

After `const result = rule.test(toolName, input, ctx);` (L365), add:
```ts
if (result && typeof (result as any).then === "function") {
  throw new TypeError(`BlockRule "${rule.name}" returned a thenable — use evaluateBlockRulesAsync for async rules`);
}
```

This goes BEFORE the `if (result) return result;` check. It catches any rule that accidentally returns a Promise, which would be truthy and cause a false block in the sync path.
</action>
<acceptance_criteria>
- `lib/extensions/tool-blockers.ts` contains `typeof (result as any).then === "function"`
- `lib/extensions/tool-blockers.ts` contains `throw new TypeError`
- The check is inside the `evaluateBlockRules` function, after `rule.test()` call
- The error message mentions `evaluateBlockRulesAsync`
</acceptance_criteria>
</task>

<task id="1.3">
<title>Test async git queries and thenable safety net</title>
<read_first>
- lib/git-query.ts (the async functions under test)
- lib/git-query.test.mjs (existing test file — check if it exists, extend it)
- lib/extensions/tool-blockers.test.mjs (add thenable safety net test)
</read_first>
<action>
Create or extend `lib/git-query.test.mjs`:

1. Test `gitLogLatestInScopeAsync`:
   - In a real git repo (the project itself): returns a date string
   - With AbortSignal already aborted: returns null without throwing
   - With very short timeout (1ms): returns null (timeout, not crash)

2. Test `gitRevParseShowToplevelAsync`:
   - In project dir: returns a path containing the project name
   - With aborted signal: returns null

3. Test `prefetchGitFacts`:
   - Returns frozen object with both fields
   - AbortSignal cancels both queries

4. Extend `lib/extensions/tool-blockers.test.mjs`:
   - Test thenable safety net: create a rule that returns `Promise.resolve({block: true, reason: "async"})`, call `evaluateBlockRules` → throws TypeError with message containing "thenable"
   - Normal sync rules still work unchanged
</action>
<acceptance_criteria>
- `lib/git-query.test.mjs` exists with async git query tests
- Running `node --experimental-strip-types --test lib/git-query.test.mjs` exits 0
- Tests cover: success case, abort signal, timeout
- `lib/extensions/tool-blockers.test.mjs` has a "thenable safety net" test
- Running tool-blockers tests exits 0 with no regressions
</acceptance_criteria>
</task>

## Verification

```
node --experimental-strip-types --test lib/git-query.test.mjs lib/extensions/tool-blockers.test.mjs
```

## must_haves

- [ ] Sync evaluateBlockRules throws TypeError on thenable return (ASYNC-02)
- [ ] Async git queries use execFile directly, no shell, with AbortSignal + timeout + windowsHide + maxBuffer (ASYNC-03)
- [ ] Per-query timeout with AbortSignal killing child process (ASYNC-04)
- [ ] Co-located tests cover async queries, abort, timeout, thenable rejection (TEST-01)
