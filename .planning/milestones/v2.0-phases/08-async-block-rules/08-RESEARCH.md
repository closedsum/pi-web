# Phase 08: Async Block Rules — Research

**Researched:** 2026-10-15
**Method:** Parallel multi-model research (Claude (Explore) + MiniMax-M3 + claude-opus-5-5[1m] + claude-sonnet-5-5[1m] + gpt-6-astra + gpt-6.1-sol + qwen3.8-max)
**Requirements:** ASYNC-01,ASYNC-02,ASYNC-03,ASYNC-04,TEST-01

## Research Approach

| Track | Model | Status | Time |
|-------|-------|--------|------|
| local | Claude (Explore) | ok | — |
| minimax | MiniMax-M3 | ok | 23.3s |
| opus55 | claude-opus-5-5[1m] | ok | 72.5s |
| sonnet5 | claude-sonnet-5-5[1m] | ok | 95.2s |
| gpt6 | gpt-6-astra | ok | 128.3s |
| gpt | gpt-6.1-sol | ok | 155.3s |
| qwen38 | qwen3.8-max | ok | 337.5s |

---

## Local Codebase Analysis (Claude)

## 1. git-query.ts — Sync Git Execution

- `gitRevParseShowToplevel(cwd)` (L8) — execFileSync("git", ..., {timeout: 5000}), no shell
- `gitLogLatestInScope(repo, branch, globs)` (L20) — execFileSync("git", ..., {timeout: 5000}), no shell
- Both already safe per CVE-2024-27980 (no shell: true). Phase 8 adds async equivalents.

## 2. tool-blockers.ts — No Rules Import git-query

The 23 BlockRules in ALL_RULES are pure string-matching — pattern-match on git commands but don't call git. Git-calling rules are in separate files called from inline gates in index.ts.

## 3. pi.on("tool_call") — FULLY SUPPORTS ASYNC

ExtensionHandler type: `(event, ctx) => Promise<R | void> | R | void`
runner.js emitToolCall is async and awaits each handler. Proven by permission-gate.ts using async handler.

## 4. block-redispatch.ts — The Only Git-Calling Rule

- Imports `gitLogLatestInScope` from git-query
- Call site (L52): `gitCheck(cwd, "master", writeScope)` — injectable via `gitCheck: GitChecker`
- Already designed for injection. Prefetched result can be passed instead.

## 5. block-manual-integrate.ts — No Git, Filesystem Only

Reads lock files + PID liveness. No git queries. No async needed.

## 6. Architecture for Phase 8

Only ONE function needs async: `gitLogLatestInScope` (used by checkRedispatchWithoutFix).
`gitRevParseShowToplevel` is session-start only, not per-tool-call.

**Gather-then-decide:**
1. Prefetch gitLogLatestInScope async via promisified execFile + AbortSignal
2. Freeze result into context
3. Pass frozen context to checkRedispatchWithoutFix via injectable gitCheck
4. Run all sync rules over frozen context
5. Sync evaluateBlockRules unchanged (ASYNC-02) — add thenable safety net
6. New evaluateBlockRulesAsync is a separate function


---

## Minimax Research (MiniMax-M3)

# Phase 8: Async Block Rules — Research Findings

## 1. `execFile` with `AbortSignal` — Subprocess Cleanup Gotchas

Node's `execFile` does **not** natively propagate `AbortSignal` to kill the child process. You must wire it up manually.

```js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

async function gitAsync(args, { signal, timeoutMs } = {}) {
  let timer;
  try {
    if (timeoutMs) {
      timer = setTimeout(() => signal?.abort(new Error("timeout")), timeoutMs);
    }
    const { stdout } = await execFileP("git", args, {
      signal,
      timeout: timeoutMs,           // belt
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: false,                  // explicit per CVE-2024-27980 class
      cwd: process.cwd(),
    });
    return stdout;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

**Gotcha:** `execFile`'s built-in `timeout` option sends `SIGTERM`, but on Windows it terminates the *parent* shell wrapper only. Combined with `shell: false` (which is correct here) the child receives the signal directly, but `AbortSignal` from `controller.signal` alone does **nothing** — you must call `controller.abort()` from your timeout handler. Without the manual abort, aborting the signal mid-fetch will leak the child process until it exits on its own.

**Fix:** Always pair `AbortSignal` with the `timeout` option, and in a `finally` block clear any custom timer to avoid double-kill.

## 2. Per-Rule Timeout Semantics — `Promise.race` vs Native Timeout

ASYNC-04 demands per-rule timeout. `Promise.race` is the natural choice but has two pitfalls:

```js
async function runWithTimeout(rule, ctx, { timeoutMs, policy = "fail-closed" }) {
  let timer;
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("rule-timeout")), timeoutMs);
  });
  try {
    return await Promise.race([rule(ctx), timeoutP]);
  } catch (err) {
    if (err.message === "rule-timeout") {
      return policy === "fail-closed"
        ? { action: "block", reason: `rule ${rule.name} timed out` }
        : { action: "allow", reason: `rule ${rule.name} timed out (fail-open)` };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

**Gotcha #1:** If the rule's own promise eventually resolves *after* the timeout fires, the late result is silently discarded — good — but if the rule holds external resources (timers, file handles), the dangling promise will still execute to completion. There's no way to "cancel" a synchronous CPU-bound rule mid-execution; `AbortSignal` is a no-op for sync code.

**Gotcha #2:** "Fail-open" on a **block** rule means the tool call proceeds when the rule can't decide. For a security-relevant blocker, this is the wrong default. Recommendation: per-rule `policy: "fail-closed" | "fail-open"` field, with **fail-closed as the default** and fail-open requiring an explicit opt-in in the rule definition.

## 3. Sync API Throws on Thenable — Detection Strategy

ASYNC-02 requires `evaluateBlockRules` to throw `TypeError` if a rule returns a thenable. Don't use `result instanceof Promise` — that misses `PromiseLike` from other realms and Bluebird-style thenables.

```js
function isThenable(v) {
  return v != null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
}

const result = rule(ctx);
if (isThenable(result)) {
  throw new TypeError(`Rule ${rule.name} returned a thenable; use evaluateBlockRulesAsync`);
}
```

Also check *before* invoking the rule, since some rules might be `async function` (always thenable) by accident. Optionally do a one-time lint pass over `ALL_RULES` at module load and assert none are async functions, which is a stronger guarantee.

## 4. `gather-then-decide` Pattern — Ordering Matters

ASYNC-01 says "prefetch git facts into frozen context, then run rules sync." Make the contract explicit:

- The preflight pass must **collect every fact that any rule could need**, not just rules that declare it. Two options:
  1. **Static analysis** of rules for `ctx.git.<field>` accesses — fragile, regex-based.
  2. **Prefetch the union of all known facts** (current branch, HEAD, status, diff, recent log) — wasteful but correct.
  3. **Prefetch on first access with a cache** — best of both, but adds cache invalidation logic.

Recommended: option 2 for the initial async pass (bounded, predictable), with a clear `PrefetchedContext` type that *only* exposes the prefetched fields. Any rule that needs a field not in the context throws a clear error pointing the developer to the preflight list.

## 5. `tool_call` Handler Async Support — Verify Before Coding

The context summary flags: *"Verify `pi.on("tool_call")` supports async return values before proceeding."* This is a **CRITICAL prerequisite** — if the extension host invokes the handler synchronously (fire-and-forget) and the tool call proceeds without awaiting, the async blocker is worthless.

**Research action:** Before implementation, locate the extension host's `tool_call` dispatch. Check:
- Does it `await` the handler return value?
- Does it inspect a `then` property on the return?
- Is there a `tool_call_sync` variant you should use instead?

If async is not supported, the phase must include a hook to the dispatch loop — which may not be in this repo's control.

## 6. Windows-Specific Process Tree Leaks

On Windows, even with `windowsHide: true` and `shell: false`, child processes can spawn grandchildren (e.g., git spawning `ssh.exe` or credential helpers) that survive parent termination. With per-rule timeouts that SIGTERM the immediate child:

```js
import { execFile } from "node:child_process";
// On Windows, use taskkill /T /F to kill the tree
signal?.addEventListener("abort", () => {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1000).unref();
  }
});
```

The unref'd SIGKILL fallback is important — without it a long-running grandchild can keep the event loop alive past process exit.

## 7. Test File Co-location — `import.meta.url` Pattern

TEST-01 requires `.test.mjs` co-located. For git-fact prefetch tests, mock `execFile` via dependency injection rather than mocking `child_process` globally — this keeps tests parallelizable and avoids leaking mocks across files:

```js
// git-query-async.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitQueryAsync } from "./git-query-async.ts"; // adjust for your loader

const fakeExec = async (cmd, args, opts) => {
  if (args.includes("rev-parse") && args.includes("--abbrev-ref")) {
    return { stdout: "main\n" };
  }
  if (opts.signal?.aborted) throw new Error("aborted");
  throw new Error("unexpected args");
};

test("abort signal cancels pending query", async () => {
  const gq = createGitQueryAsync({ execFile: fakeExec });
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => gq.currentBranch({ signal: ctrl.signal }));
});
```

Edge cases to cover per TEST-01:
- `AbortSignal` already aborted at call time
- Timeout fires mid-fetch (verify child is killed on Windows via the taskkill path)
- Prefetched context with missing field for a given rule
- Sync `evaluateBlockRules` rejecting both real Promise and custom thenable
- Per-rule timeout fail-closed vs fail-open, including rule that throws synchronously

## 8. Phase 7 Telemetry Baseline Compatibility

The context notes Phase 7 measures sync performance. The async path should *also* emit telemetry, but with a new metric namespace (`block.evaluator.async.*`) so historical comparisons stay valid. Specifically:

- Record `preflight_duration_ms` separately from `rule_duration_ms`
- Record `preflight.facts_requested` vs `preflight.facts_used` — surfaces over-fetching
- Tag each rule invocation with `evaluator: "async" | "sync"` for cohort analysis

## 9. Risks & Open Questions

- **CVE-2024-27980 class:** `shell: false` is the right call but is only enforced if you pass it *everywhere*. Audit any existing `git-query.ts` callers before this phase lands — if they pass `shell: true` for "convenience," the async path is more secure than the sync path, which is a code smell.
- **`maxBuffer` sizing:** `git log` over a large repo can exceed 1MB. 10MB is a reasonable default but document it; consider streaming via `execFile` callback form for log queries.
- **Concurrent preflight vs rule-short-circuit:** If the preflight discovers *during* the gather phase that an obvious block applies (e.g., on a protected branch), should the preflight itself emit a block? Recommendation: no — keep the seam clean, let rules decide. Otherwise the contract "prefetch only" drifts.
- **Determinism:** `gather-then-decide` over a frozen snapshot is the correct model for determinism. Make sure the `PrefetchedContext` is `Object.freeze`'d (deep) so a buggy rule cannot mutate it and cause non-deterministic results on retry.

---

## Opus55 Research (claude-opus-5-5[1m])

# Research: Phase 8, Async Block Rules

I couldn't check any of this against the source. The scratch repo at `gsd-review-scratch-40920` has no tracked files, and `lib/` is missing. So nothing here comes from reading `tool-blockers.ts`, `git-query.ts`, `telemetry-collector.ts` or `extensions/index.ts`. Every claim about those files is tagged **UNVERIFIED-CONTRACT**. The Node.js API facts come from Node's documented behaviour (v18.x through v22.x).

Your global CLAUDE.md requires design questions to go through `/gsd:cross-research`, which uses several models. This is a single-model reference pass only. Re-run the pattern decisions below (§3 and §4) through cross-research before you lock the plan.

---

## 1. Blocking prerequisite: does Pi's `tool_call` hook await promises? (UNVERIFIED-CONTRACT)

The context file flags this, and it gates the whole phase.

- **Risk:** the dispatcher may call handlers synchronously and read `result?.block`. If so, an async handler returns a `Promise`, `promise.block` is `undefined`, and **the tool runs unblocked**. That is a silent fail-open on the security path.
- **Check:** grep the Pi runtime for the emitter of `tool_call` and confirm it does `await handler(event, ctx)`. Commands:
  ```
  rg -n "tool_call" node_modules/@mariozechner/pi-coding-agent/dist -g "*.js"
  rg -n "await .*handler|for await|Promise.all" <emitter file>
  ```
- **Gate test:** register a handler that returns `Promise.resolve({ block: true, reason: "x" })` and confirm the tool doesn't run. Do this before writing any other code.
- **Fallback if it doesn't await:** keep the sync path wired in `index.ts` and ship the async path only as a library API. Don't wire it into the hook.

## 2. ASYNC-03: the async git primitive

Use this pattern:
```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

export async function gitQueryAsync(args: string[], opts: { cwd: string; signal: AbortSignal; timeoutMs: number }) {
  const { stdout } = await execFileP("git", args, {
    cwd: opts.cwd,
    signal: opts.signal,
    timeout: opts.timeoutMs,
    killSignal: "SIGTERM",
    maxBuffer: 1 << 20,
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
  });
  return stdout.trimEnd();
}
```

Gotchas:
- **`"git"` vs `"git.exe"`:** with `shell: false`, libuv on Windows searches PATH and appends `.exe`. Plain `"git"` works and stays portable. Spelling it `git.exe` breaks POSIX. The CVE-2024-27980 issue only applies to `.bat`/`.cmd` targets. Since Node 18.20.2, 20.12.2 and 21.7.3, those targets throw `EINVAL` without `shell: true`. If PATH resolves `git` to a `git.cmd` shim (some scoop or older GitHub Desktop installs), you get `EINVAL`. **Test for this and treat it as a git-unavailable fact, not a crash.**
- **Abort error shape:** an aborted call rejects with `err.name === "AbortError"` and `err.code === "ABORT_ERR"`. A timeout rejects with `err.killed === true` and `err.signal === "SIGTERM"`, with **no** `code === "ETIMEDOUT"`. A `maxBuffer` overrun gives `code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`. Classify all three explicitly.
- **Windows kill semantics:** `SIGTERM` maps to `TerminateProcess` on `git.exe` only. Grandchildren that git spawns (hooks, `git-remote-*`, credential helpers) are **not** killed. Keep the commands read-only (`rev-parse`, `status --porcelain=v1 -z`, `symbolic-ref`, `diff --cached --name-only -z`) so nothing spawns grandchildren. Set `GIT_OPTIONAL_LOCKS=0` so `status` never takes `index.lock`. Without it, a killed status could leave a stale lock.
- **Promisify needs a non-null error:** `promisify(execFile)` attaches `stdout` and `stderr` to the rejection. Don't log `err.stdout` without truncating it.
- **Reuse:** share the arg-building and output parsing with `lib/git-query.ts` (UNVERIFIED-CONTRACT). Only the transport (sync or async) should differ. This avoids two copies of the same git parsing.

## 3. ASYNC-01: gather-then-decide design

```ts
export interface GitFacts { readonly branch?: string; readonly isDirty?: boolean; readonly stagedFiles?: readonly string[]; readonly errors: Readonly<Record<string,string>> }

export async function evaluateBlockRulesAsync(input, rules = ALL_RULES, opts = {}) {
  const ac = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal; // AbortSignal.any: Node >=20.3
  try {
    const facts = Object.freeze(await prefetchGitFacts(input.cwd, signal, opts.timeoutMs ?? 1500));
    return evaluateBlockRules({ ...input, git: facts }, rules); // sync, unchanged
  } finally { ac.abort(); }
}
```

Key points:
- **Run the prefetch with `Promise.allSettled`, not `Promise.all`.** One failing fact shouldn't throw away the others. Record each failure in `errors`.
- **`Object.freeze` is shallow.** Freeze the arrays too (`Object.freeze([...files])`). Otherwise a rule can mutate `stagedFiles` and affect later rules.
- **Fetch only what's needed.** Have each rule declare `needs?: ("branch"|"dirty"|"staged")[]`. Prefetch the union, filtered to rules whose matcher applies to this tool. Most tool calls (Read, Grep) need no git at all, and spawning git on every call would make the async path *slower* than the Phase 7 sync baseline.
- **`AbortSignal.any` needs Node ≥ 20.3.** Check the `engines` field. On Node 18, combine the signals by hand.
- **The `finally { ac.abort() }`** cleans up any straggling child when the sync rules short-circuit.

## 4. ASYNC-04: timeout policy

- **Recommended: fail-closed when a fact is missing but a rule needs it.** If prefetch times out and a rule that needs `branch` would fire, return a block with `reason: "git fact unavailable (timeout)"`. Rules that don't need git still run normally.
- Make the policy explicit for each rule: `onFactError: "block" | "allow"`, defaulting to `"block"`. Put it in `BlockRule`, not in global config, so it gets reviewed alongside the rule.
- **"Per-rule timeout" has a catch:** rules are sync, so a timer can't interrupt them. The timeout can only cover the async fact fetch. If the requirement means a time limit on the rule bodies themselves, measure each sync rule's duration after it runs and log an overrun. Don't pretend you can pre-empt it. Write this into the plan so the verifier doesn't mark ASYNC-04 as failed.
- Use `timeout` on `execFile` as the hard cap and the `AbortSignal` for the overall evaluation deadline. Both kill the child.

## 5. ASYNC-02: the thenable guard

```ts
const r = rule.evaluate(ctx);
if (r != null && typeof (r as any).then === "function")
  throw new TypeError(`Block rule "${rule.id}" returned a thenable; use evaluateBlockRulesAsync`);
```
- Check `typeof then === "function"`, not `instanceof Promise`. Cross-realm promises and custom thenables would slip past `instanceof`.
- The rejected promise is still pending and will raise an `unhandledRejection` later. Attach a no-op handler before throwing: `Promise.resolve(r).catch(() => {})`.
- **Telemetry:** check that `evaluateBlockRulesInstrumented` (UNVERIFIED-CONTRACT) still sees the `TypeError` and doesn't catch it and treat it as allow.
- **Sync behaviour must not change.** Add a test that snapshots the current sync outputs over `ALL_RULES` fixtures before the change and asserts they're identical afterwards.

## 6. TEST-01: test matrix (`*.test.mjs`, co-located)

| Test | What it checks |
|---|---|
| A thenable returned to the sync evaluator | `TypeError`; no unhandled rejection (`process.on("unhandledRejection")` spy) |
| A plain object with a `then` field that isn't a function | No throw |
| Prefetch timeout (stub git that sleeps, e.g. `node -e "setTimeout(()=>{},5000)"` via injected spawner) | fail-closed block for rules that need the fact; other rules still run |
| External abort mid-fetch | rejects with `AbortError` or fails closed (pick one and document it); child pid is dead |
| `maxBuffer` exceeded | classified error; no crash |
| No git on PATH (`ENOENT`), or `git.cmd` shim (`EINVAL`) | the fact's error is recorded; policy applies |
| Directory isn't a repo | the fact is undefined, not a throw |
| Mutating the frozen context | throws in strict mode (`.mjs` is strict) |
| Short-circuit | async result equals the sync result for the same facts |
| Parity | for each fixture, `await async(x) === sync(x with same facts)` |

- **Make the spawner injectable** (`opts.execFile`) so tests don't depend on real git timing. Keep one real-git integration test that runs in a temp repo from `git init`.
- **Real-process tests on Windows:** after an abort, assert the child is gone by polling `process.kill(pid, 0)`, which throws `ESRCH` once the process has exited. Use a 2 s cap.

## 7. Other risks

1. **Latency regression:** spawning one git process costs about 15–40 ms on Windows. Compare against the Phase 7 telemetry baseline and treat "async p95 ≤ sync p95" as an acceptance check.
2. **Concurrent tool calls:** parallel tool calls each spawn git. A short-lived cache keyed on `cwd` (around 250 ms, sharing the in-flight promise) prevents spawn storms. Cache misses must not leak a rejection across callers.
3. **Node version floor:** `signal` on `execFile` needs ≥ 15.4 and `AbortSignal.any` needs ≥ 20.3. The CVE-2024-27980 fix needs the patched releases listed above. Pin the minimum in `engines`.
4. **TS to `.mjs` tests:** check how `.test.mjs` imports the `.ts` modules (a build step, or a `--experimental-strip-types` / tsx loader). The pattern needs confirming against the existing test runner config (UNVERIFIED-CONTRACT).

## Open items before planning
- [ ] Confirm that the Pi `tool_call` dispatcher awaits handlers (§1). **This blocks the phase.**
- [ ] Confirm the minimum Node version.
- [ ] Read `git-query.ts`, `tool-blockers.ts` and `telemetry-collector.ts` to check the claims marked UNVERIFIED-CONTRACT.
- [ ] Run cross-research on the fail-closed default and the meaning of "per-rule timeout" (§4).


---

## Sonnet5 Research (claude-sonnet-5-5[1m])

# Research: Phase 8, Async Block Rules

**Caveat:** I did not read the repo, and the review scratch directory has no source. Everything about `tool-blockers.ts`, `git-query.ts` and Pi's `tool_call` dispatch is inferred from your context summary. Items marked **VERIFY** are unconfirmed. Node behaviour comes from my knowledge of the Node docs, not from running anything here.

## 1. Highest-risk finding: do the sync rules read git themselves?

The gather-then-decide design only works if rules read facts from the context. If any rule in `ALL_RULES` calls the sync `git-query.ts` (`execFileSync`) inside its body, the async path still blocks the event loop and ASYNC-01 is not met.

Before planning, grep every rule for `git-query` imports and `execFileSync` calls (**VERIFY**).

Recommended shape:
```ts
interface BlockRule {
  id: string;
  needs?: readonly GitFactKey[];            // facts to prefetch
  onGatherFailure?: 'block' | 'allow';      // ASYNC-04, explicit per rule
  evaluate(input: ToolCallInput, ctx: Readonly<RuleContext>): BlockResult | undefined;
}
```
- The sync `evaluateBlockRules` builds `ctx` with lazy sync getters that call `git-query.ts`, so its behaviour stays identical.
- The async path builds `ctx` from prefetched values. Same rule code, different fact source.
- Prefetch only the union of `needs` for rules that apply to this call. Most `tool_call`s (Read, Edit) need no git at all, so skip the gather entirely and avoid regressing latency against the Phase 7 baseline.
- Don't cache facts across tool calls. Git state changes between calls, and stale facts in a block rule are a correctness bug. Memoise only within one evaluation, with an in-flight promise map so two rules needing `status` share one spawn.

## 2. Promisified `execFile` details (ASYNC-03)

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);   // resolves {stdout, stderr}; rejection carries .stdout/.stderr/.code/.killed/.signal

const { stdout } = await execFileP(gitPath, ['--no-optional-locks', '-C', cwd, 'status', '--porcelain=v2', '-z'], {
  signal,                 // Node >= 15.4
  timeout: ms,            // backstop
  maxBuffer: 1024 * 1024,
  windowsHide: true,
  encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  // no `shell`
});
```

Gotchas:
- **Failure classification.** The error shape differs by cause, so don't match on message text.
  - Abort: `err.name === 'AbortError'`, `err.code === 'ABORT_ERR'`. This also covers a pre-aborted signal, which rejects immediately.
  - Built-in `timeout`: `err.killed === true`, `err.signal === 'SIGTERM'`, and `code` is null.
  - `maxBuffer` exceeded: `err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`, and the child is killed.
  - Missing git: `err.code === 'ENOENT'`.
  - Non-zero exit: a numeric `code`. Git exit 128 means not a repo, "dubious ownership" or `index.lock`.
  - Classify with `signal.aborted` plus `signal.reason` first, then these codes.
- **Using both `signal` and `timeout`.** Use `AbortSignal.timeout(ms)` or an `AbortController` as the authoritative deadline, and set the execFile `timeout` slightly higher as a backstop. Otherwise it's ambiguous which one fired.
- **Combining signals.** `AbortSignal.any([callerSignal, AbortSignal.timeout(ms)])` needs Node 20.3+ or 18.17+ (**VERIFY** `engines`). Otherwise wire an `AbortController` manually, and `clearTimeout` and `unref()` the timer so tests and the host process can exit.
- **Windows kill semantics.** The kill is `TerminateProcess` on `git.exe` only. Grandchildren (fsmonitor, credential helpers, hooks) are not killed. Mitigate with `-c core.fsmonitor=false` (the `-c` flag is a git argument, not a shell feature). Document the orphan risk and don't build a process-tree killer in this phase.
- **CVE-2024-27980 class.** Since Node 18.20.2, 20.12.2 and 21.7.3, spawning `.bat` or `.cmd` without `shell: true` throws `EINVAL`. That is the reason to avoid `shell: true`. Always spawn `git.exe`, and a `git.cmd` shim would fail loudly. Never interpolate the model's tool input (the bash command string or a path) into args without a `--` separator and validation.
- **Executable resolution on Windows.** libuv's PATH search can consult the current directory. I'm not certain of the exact behaviour, so treat it as unconfirmed. A `git.exe` planted in an untrusted repo cwd could run. Safest option: resolve an absolute git path once (reuse whatever `git-query.ts` already does) and pass that. If `git-query.ts` already pins a path, reuse it.
- **Avoid lock contention.** Use `--no-optional-locks` and `GIT_OPTIONAL_LOCKS=0` so a gather never fights the user's own git for `index.lock`.
- **Machine-readable output.** Use `-z`, `--porcelain=v2` and `-c core.quotepath=false`, and set `LC_ALL=C`. Don't parse localized output.

## 3. "Per-rule timeout" can only apply to the gather phase (ASYNC-04)

Sync rules can't be interrupted by a timer. After the gather, a hung CPU-bound rule can't be timed out in-process. So the real semantics are:
- Each rule's fact gather gets its own deadline, with an optional overall deadline on top.
- A rule's `onGatherFailure` decides what happens if its facts are unavailable (timeout, abort, ENOENT, exit 128).
  - `'block'` (fail-closed) returns a `BlockResult` whose reason names the rule and cause (e.g. "git status timed out after 3000ms").
  - `'allow'` (fail-open) skips the rule.
- Make the policy a required, explicit field with a safe default of fail-closed. Note the trade-off: fail-closed on a slow Windows repo (antivirus scans, huge index) blocks real work, so pick timeouts accordingly (about 2–5 s) and consider fail-open for purely advisory rules.
- Represent facts as a tagged result, `{status:'ok', value} | {status:'error', kind:'timeout'|'abort'|'enoent'|'exit'|'maxbuffer'}`. Never encode "unknown" as `false` or `''`. That is the classic fail-open bug, where an empty status means "clean".
- Emit telemetry for each degraded gather. Record gather time separately from rule-evaluation time in the Phase 7 instrumented path, so the baseline comparison is meaningful. Note that async will not reduce per-call latency. Its benefit is a non-blocked event loop and parallel gathers, so set expectations accordingly.

## 4. Frozen context

- Deep-freeze the context: `Object.freeze` on the context and on each fact object and array. A shallow freeze leaves nested arrays mutable.
- `.mjs` tests run in strict mode, so assignment to a frozen property throws `TypeError`. Use that in a test: `assert.throws(() => { ctx.git.branch = 'x' }, TypeError)`.
- Compiled TS emitted as ESM is also strict. Confirm the rule files aren't CommonJS sloppy mode (**VERIFY**), because there a mutation would fail silently.

## 5. Sync path throws on a thenable (ASYNC-02)

```ts
const r = rule.evaluate(input, ctx);
if (r != null && typeof (r as any).then === 'function') {
  // attach a handler BEFORE throwing, or the abandoned rejected promise
  // becomes an unhandledRejection, which crashes Node >= 15 by default
  Promise.resolve(r).catch(() => {});
  throw new TypeError(`Block rule "${rule.id}" returned a thenable; use evaluateBlockRulesAsync`);
}
```
- Check for `.then` (a thenable), not `instanceof Promise`.
- Use `Promise.resolve(r).catch(...)` rather than `r.catch`, because arbitrary thenables may lack `.catch`.
- Test it with a rule that is an `async` function that rejects, and assert that no `unhandledRejection` fires (`process.once('unhandledRejection', ...)`).
- Add a test that sync behaviour is byte-identical, including first-block short-circuit order.
- The async path should still short-circuit in rule order, but gather in parallel (`Promise.all` over the needed facts). Decide deterministically which rule's block wins: the first in `ALL_RULES` order, not the first to settle.

## 6. `pi.on("tool_call")` async support (blocking prerequisite)

Your context already flags this as unverified. I can't confirm it, so **VERIFY** in Pi's extension runner source that:
1. The handler's return value is awaited (`await handler(event, ctx)`), not just invoked.
2. A resolved `{ block: true, reason }` actually blocks.
3. **A thrown or rejected handler is not swallowed as "allow".** If Pi catches and logs handler errors, an exception in the async path silently becomes fail-open. Wrap the whole async evaluation in a try/catch that returns an explicit block or allow per the policy, and don't rely on Pi's behaviour.
4. Whether Pi has its own handler timeout, and whether concurrent tool calls invoke handlers in parallel. If so, the evaluation must hold no shared mutable state.
5. Whether multiple extensions' handlers are chained serially. Gather latency then adds to every tool call.

Write a small spike test or script for this before planning tasks around it.

## 7. Testing (TEST-01)

Use `node --test` with co-located `*.test.mjs` files.

- **Import path (VERIFY).** The tests are `.mjs` but the libs are `.ts`. Check how existing tests import TS. Either there's a build step, or Node type-stripping is used (unflagged by default in Node 22.18+/23.6+, `--experimental-strip-types` before that). Type stripping rejects TS-only runtime syntax such as enums and parameter properties, and requires `.ts` extensions in import specifiers. Match the existing convention rather than introducing a new one.
- **Injectable exec.** Add an optional `{ execFile }` dependency parameter to the gather module. Mocking ESM built-ins is awkward, and injection makes the tests deterministic.

Edge cases to cover:
- Timeout fires, with a fake exec that honours `signal` and never resolves.
- A real child process (`process.execPath`, `-e setTimeout(()=>{},60000)`) is actually killed on abort.
- Pre-aborted caller signal.
- `maxBuffer` exceeded.
- `ENOENT`.
- Exit 128 (not a repo, tested in a `mkdtemp` directory).
- Options assertion: `shell` is undefined, `windowsHide === true`, and args are an array.
- Parallel gather with deduped in-flight calls (the fake exec is called once for two rules).
- Fail-closed versus fail-open per rule.
- Frozen context mutation throws.
- Sync path throws `TypeError` on a thenable, and there is no unhandled rejection.
- The async result equals the sync result on the same fixture (a parity test).
- Deterministic first-block ordering when a later rule's facts resolve faster.
- No leaked timers or handles. The test process must exit cleanly, which means `unref`/`clearTimeout`.
- Paths with spaces and unicode, a branch named `-x` (a leading-dash arg is only safe after `--`), and a Windows path.
- One real-git integration test in a temp repo, skipped if git is absent.

## 8. Plan breakdown suggestion (small, separately committed)

1. Spike: confirm Pi's async `tool_call` semantics (section 6) and the TS-import convention for tests.
2. Refactor rules to read facts from `ctx`, with the sync path using lazy sync getters. Behaviour-preserving, with a parity test. Add `needs` and `onGatherFailure`.
3. `git-async.ts` plus tests: the exec wrapper, error classification and deadlines.
4. `evaluateBlockRulesAsync` plus tests: gather, freeze, run rules in order, and the failure policy.
5. The thenable guard in sync `evaluateBlockRules`, plus its test.
6. An instrumented async variant, wiring into `extensions/index.ts`, and a baseline comparison.

## Open questions I could not resolve

- The Node version in `engines` and on the Pi runtime. This decides whether `AbortSignal.any` is available.
- Whether any current rule calls git or the filesystem synchronously inside its body.
- Pi's handler-error semantics (section 6).
- Whether libuv's Windows cwd search is a real concern for the git invocation. Pinning an absolute git path sidesteps it either way.


---

## Gpt6 Research (gpt-6-astra)

The supplied material is a design brief, not a code diff. These are planning risks, not confirmed defects. References use the supplied module and API names because source lines were not provided.

### 1. MEDIUM — Define which work a per-rule timeout can interrupt

**Location:** `lib/extensions/tool-blockers.ts` — planned `evaluateBlockRulesAsync()`, `BlockRule`; requirements ASYNC-01 and ASYNC-04.

The design combines synchronous rule execution with per-rule timeouts. A timer or `Promise.race()` cannot interrupt a synchronous rule that blocks the event loop; its timeout callback runs only after that rule returns. Aborting a git child also cannot interrupt JavaScript already executing. Implement per-rule budgets around each rule’s asynchronous fact gathering, record expiration in its gathered inputs, and apply the declared timeout policy during ordered synchronous evaluation. If ASYNC-04 requires hard deadlines for the synchronous callbacks themselves, execute those callbacks in workers that the parent can terminate. Explicitly settle that distinction before implementation; an ordinary promise timeout does not satisfy the latter contract.

For the subprocess portion, use the required direct invocation pattern:

```ts
const execFileAsync = promisify(execFile);

await execFileAsync("git.exe", args, {
  cwd,
  signal: controller.signal,
  timeout: budgetMs,
  maxBuffer: outputLimitBytes,
  windowsHide: true,
  shell: false,
  encoding: "utf8",
});
```

Add a co-located test demonstrating cancellation of a running child and, if callback deadlines are promised, termination of a deliberately blocking rule.

### 2. MEDIUM — Prefetched facts need an enforced path into existing rules

**Location:** `lib/extensions/tool-blockers.ts` — `BlockRule`, `evaluateBlockRulesAsync()`; `lib/git-query.ts` — existing synchronous wrapper.

The brief identifies the current `execFileSync` wrapper but does not specify how existing rules will consume prefetched facts. If a rule retains its synchronous git lookup, asynchronous evaluation performs duplicate queries, still blocks the event loop, and can make its decision from a later repository state instead of the gathered context. That would violate ASYNC-01 even if the context object itself is frozen.

Introduce an internal fact-reader interface consumed by the rules. Keep lazy synchronous lookups behind the synchronous facade; supply lookup-only access to gathered facts behind the asynchronous facade. An absent prefetched key must produce an explicit internal error, never fall back to synchronous git execution. Freeze detached fact records and their nested collections before evaluation. Test the asynchronous path with the synchronous git reader replaced by a function that throws, proving that no rule reaches it.

### 3. MEDIUM — Gather failures must preserve rule order and individual failure policies

**Location:** `lib/extensions/tool-blockers.ts` — `ALL_RULES`, `evaluateBlockRules()`, planned `evaluateBlockRulesAsync()`.

The existing evaluator stops at the first block. An eager gather can accidentally change that behavior: rule A would block immediately, but an unrelated git query needed only by later rule B times out and rejects the entire gathering operation. Alternatively, converting that failure into an empty result can allow B to pass despite a fail-closed policy. The brief requires explicit policies but leaves this failure representation unspecified.

Gather tagged outcomes instead of collapsing errors into missing facts:

```ts
type Fact<T> =
  | Readonly<{ kind: "ok"; value: T }>
  | Readonly<{ kind: "timeout"; error: Error }>
  | Readonly<{ kind: "error"; error: Error }>;
```

After gathering settles, traverse `ALL_RULES` in its existing order. Apply a failed fact’s policy only when reaching a rule that requires it, and preserve the error in the returned diagnostic or logging path. Keep ordinary query failures distinct from timeouts unless the policy explicitly covers both. Test an early blocking rule followed by a timed-out dependency, plus fail-open and fail-closed rules receiving the same failure.

### 4. MEDIUM — Sharing an asynchronous evaluator would change synchronous error behavior

**Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()`, planned `evaluateBlockRulesAsync()`; requirement ASYNC-02.

A shared core declared `async` would turn a thrown `TypeError` into a rejected promise. Existing callers using synchronous `try/catch` would no longer receive the required exception. Checking for thenables after treating a result as a blocking result would also allow an invalid promise to enter the decision path.

Keep the common decision runner synchronous. Have the asynchronous facade await gathering and then invoke that runner. Immediately after each executed rule returns, reject both object-shaped and function-shaped thenables:

```ts
function rejectThenable(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new TypeError("Block rules must return synchronously");
  }
}
```

Test synchronous throwing, native promises, custom thenables, and function-shaped thenables. Preserve short-circuiting: rules after the first block should remain unexecuted.

### 5. MEDIUM — UNVERIFIED-CONTRACT: Awaiting inside the handler does not establish dispatcher support

**Location:** `extensions/index.ts` — `pi.on("tool_call", handler)`.

The brief correctly identifies async handler support as an integration prerequisite, but the event dispatcher’s implementation is absent. If the dispatcher proceeds without awaiting the callback’s returned promise, a tool can execute before the blocking decision arrives. An `await` inside the callback alone cannot prevent that. This is an unresolved producer contract, not evidence that the current dispatcher behaves incorrectly.

Once the producer contract is established, register a handler that returns the complete evaluation promise and propagates its blocking result. If this event does not support awaited decisions, gather facts through a supported awaited pre-dispatch boundary and retain synchronous enforcement at `tool_call`. Add an integration test using a manually deferred evaluation: assert that tool execution remains pending until resolution and never starts when the resolved decision blocks. This tests the dispatch contract directly without relying on timing-sensitive sleeps.

---

## Gpt Research (gpt-6.1-sol)

The material contains an architecture summary, not a code diff. These findings identify implementation risks using the supplied module and declaration names; they do not establish defects in unseen source.

### 1. MEDIUM — A same-thread timeout cannot interrupt synchronous rules

**Location:** `lib/extensions/tool-blockers.ts` — proposed `evaluateBlockRulesAsync()` and existing `BlockRule`.

ASYNC-01 requires synchronous rule execution after gathering, while ASYNC-04 requires per-rule timeouts. Wrapping a synchronous rule in `Promise.race()` does not enforce that deadline: a rule performing a long computation prevents the timeout callback from running until the computation finishes. Aborting a git child process also cannot interrupt that rule. For literal execution deadlines, run each synchronous rule in a worker, enforce its deadline from the parent, terminate the worker on expiry, and apply the configured fail policy. If the intended deadline covers only git gathering, narrow ASYNC-04 explicitly and attach cancellation to those queries.

### 2. MEDIUM — Gathering failures need a representation distinct from valid empty results

**Location:** `lib/extensions/tool-blockers.ts` — proposed `evaluateBlockRulesAsync()`; `lib/git-query.ts` — existing synchronous git-query wrapper. **UNVERIFIED-CONTRACT:** the wrapper’s implementation and failure representation were not supplied.

The summary does not specify how failed facts reach rule evaluation. If a timed-out git query becomes an empty string, a rule could interpret unavailable repository state as a successful query with no relevant changes and allow the operation. Conversely, one rejected `Promise.all()` could bypass every rule’s configured fail-open policy. Define a discriminated fact result, associate each rule with its required facts, and apply policy before invoking that rule:

```ts
type GitFact<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{
      status: "error";
      kind: "timeout" | "aborted" | "execution";
      error: Error;
    }>;
```

Keep failures explicit, preserve rule order, and test timeout, cancellation, nonzero exit, and successful empty output separately.

### 3. MEDIUM — Prefetching needs an explicit connection to existing rule queries

**Location:** `lib/extensions/tool-blockers.ts` — `BlockRule`, `evaluateBlockRules()`, and proposed `evaluateBlockRulesAsync()`; `lib/git-query.ts` — synchronous query wrapper. **UNVERIFIED-CONTRACT:** rule bodies and their query call sites were not supplied.

Gathering facts asynchronously improves responsiveness only if the subsequent rules consume those facts. A migrated rule that still invokes the existing synchronous wrapper would repeat the query, block the event loop, and potentially observe repository state different from the gathered context. Introduce a context-aware fact accessor and route every git-dependent rule through it. In the async path, that accessor must read exclusively from the snapshot and throw on a missing fact; in the sync path, it should retain the existing query behavior. Freeze the snapshot’s nested records as well as its outer context. Test the async path with the synchronous query adapter configured to throw, proving that no fallback occurs.

### 4. MEDIUM — Thenable rejection must precede block-result handling

**Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()` and `BlockRule`.

ASYNC-02 requires rejection of **any thenable**, which is broader than native promises. An `instanceof Promise` check misses custom thenables and promises from another realm. If the existing evaluator treats any truthy return as a block, a promise could also be returned as a malformed `BlockResult`. Add the guard immediately after each rule invocation, before inspecting or returning its result:

```ts
function assertSynchronous(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    throw new TypeError("Block rules must return synchronously");
  }
}
```

Use this guard in the shared decision pass, including the async entry point, so that asynchronous gathering does not silently permit asynchronous rules. Test native promises, object thenables, callable thenables, and valid synchronous results.

### 5. MEDIUM — Awaiting inside the hook is insufficient unless dispatch also awaits it

**Location:** `extensions/index.ts` — `pi.on("tool_call")` handler. **UNVERIFIED-CONTRACT:** the event dispatcher’s implementation was not supplied.

An `async` callback returns a promise immediately. If the dispatcher ignores that promise, tool execution can begin before a blocking decision arrives, even when the callback correctly awaits `evaluateBlockRulesAsync()`. Replace the handler with an async callback that awaits evaluation and returns the existing hook response conversion. If dispatch currently invokes handlers synchronously, change the tool-call dispatch path to await each handler result before allowing execution. Add an integration test with a manually controlled pending evaluation: assert that the tool has not started, resolve evaluation to a blocking result, and assert that the tool never starts. This directly establishes the required ordering without relying on sleeps.

---

## Qwen38 Research (qwen3.8-max)

<!-- QwenCLI: model=qwen3.8-max model_requested=qwen3.8-max model_resolved=qwen3.8-max elapsed=336.5s -->

## Material Received

**The code packet on stdin was empty.** The working directory (`gsd-review-scratch-29640`) contains no files, and no source was inlined. What I have is the Context Summary (module paths + symbol names) and the five requirements.

Per the calibration's architecture-level provision, I'm reviewing against `lib/extensions/tool-blockers.ts` (`evaluateBlockRules`, `BlockRule`, `ALL_RULES`), `lib/extensions/telemetry-collector.ts` (`evaluateBlockRulesInstrumented`), `lib/git-query.ts`, and `lib/state-home.ts` by **module path and symbol**, not file:line. **Every finding that asserts something about existing code is tagged UNVERIFIED-CONTRACT and capped at MEDIUM.** Findings that assert Node.js/Git platform behavior are verifiable independently and are graded normally.

The single highest-value result below (**F1**) is a genuine requirements conflict, not a code claim — it stands on its own.

---

## Findings

| # | Sev | Subject |
|---|-----|---------|
| F1 | **HIGH** | ASYNC-01 and ASYNC-04 are mutually unsatisfiable as written — sync rules cannot be timed out |
| F2 | **HIGH** | Fact-fetch failure must never surface as `undefined` to a rule (silent fail-open) |
| F3 | **HIGH** | Concurrent git prefetch will contend on `.git/index.lock` without `--no-optional-locks` |
| F4 | **HIGH** | `git` credential prompt can hang the prefetch past its timeout budget on Windows |
| F5 | MEDIUM | `.cmd`/`.bat` git shims throw `EINVAL` on patched Node when `shell: false` (Scoop/Choco) |
| F6 | MEDIUM | Killing `git.exe` does not kill its process tree on Windows |
| F7 | MEDIUM | Unhandled rejection from fire-and-forget prefetch promises |
| F8 | MEDIUM | Default `maxBuffer` (1 MB) overflow on large repos misclassified as "clean" or "error" |
| F9 | MEDIUM | `.test.mjs` cannot import `.ts` under plain `node --test` — TEST-01 may not run at all |
| F10 | MEDIUM | `pi.on("tool_call")` async support is an unverified load-bearing assumption |
| F11 | MEDIUM | Gather-all breaks sync short-circuit parity; rule order must be identical |
| F12 | MEDIUM | `Object.freeze` is shallow; nested fact arrays remain mutable |
| F13 | MEDIUM | Inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` corrupt queries when host runs inside git |
| F14 | MEDIUM | Phase 7 telemetry parity: async path needs split prefetch/rule timing |
| F15 | LOW | Thenable rejection message must name the offending rule |

---

## F1 — HIGH — ASYNC-01 ⊥ ASYNC-04: you cannot abort a synchronous rule

**Location:** `lib/extensions/tool-blockers.ts` → `evaluateBlockRulesAsync` (new), requirement text ASYNC-01 + ASYNC-04.

ASYNC-01 says the async path **prefetches, then runs rules sync**. ASYNC-04 says **per-rule timeout with `AbortSignal` killing the child process**. Once control enters a synchronous rule body, the Node event loop is blocked: no timer can fire, no `AbortSignal` can be delivered, no child can be killed. A "per-rule timeout" enforced during sync rule execution is not implementable.

**Failure scenario:** implementer adds `setTimeout(() => controller.abort(), perRuleMs)` around the rule loop. The timer callback is queued but never runs, because the loop never yields. On a pathological rule (catastrophic regex over a 50k-line `git diff` blob, or a rule that calls the existing **sync** `lib/git-query.ts` fallback), `evaluateBlockRulesAsync` blocks the host for the full duration of the regex/`execFileSync`. The tool call neither blocks nor proceeds — the UI freezes. The timeout code is dead, and the test suite passes because tests use fast inputs.

**Fix — relocate the timeout to the only place it can be enforced, and make the mapping explicit:**

```ts
// Timeout lives on the FACT QUERY, not the rule.
type FactState<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'timeout'; ms: number }
  | { status: 'aborted' }
  | { status: 'error'; code: string; stderr: string };

// Rule declares what it needs + what to do when it can't have it.
interface BlockRule {
  id: string;
  requires?: readonly FactKey[];              // ['git.status', 'git.ignored']
  onUnavailable: 'fail-closed' | 'fail-open'; // ASYNC-04's "explicit policy"
  check(ctx: FrozenRuleContext): BlockResult | undefined;
}
```

Then enforce a **second, non-preemptive** budget for the sync phase by measuring, not interrupting:

```ts
const t0 = process.hrtime.bigint();
for (const rule of ALL_RULES) {
  const r = runRule(rule, frozen);            // sync
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  if (elapsedMs > SYNC_PHASE_BUDGET_MS) {
    telemetry.recordSyncOverrun(rule.id, elapsedMs);
    // cannot unwind — apply the rule's declared policy for the REMAINDER
    return failRemainingClosed(ALL_RULES, ruleIndex);
  }
  if (r) return r;
}
```

Document in the module header that the sync-phase budget is **detect-and-degrade, not preempt**. If true preemption is required, ASYNC-01 must change (rules become async) — that is a requirements decision, not an implementation detail, and should be surfaced to the planning track before code is written.

---

## F2 — HIGH — `undefined` fact is indistinguishable from "clean repo"

**Location:** prefetch layer feeding `FrozenRuleContext` (new module).

`Promise.allSettled` gives `{status:'rejected'}` for failures. The natural-looking code is:

```ts
const facts = { status: s.value ?? null, ignored: i.value ?? null };  // ✗
// or worse
const facts = { status: s.value, ignored: i.value };                  // ✗ undefined on reject
```

A rule written as `if (!ctx.facts.ignored.includes(path)) return block()` treats a **timed-out query** as "path is not ignored" — or, inverted, treats it as "path is ignored, allow". Either way an infrastructure failure is laundered into a policy decision. This is a determinism failure in an authoritative path (the blocker decides whether a tool runs) and a fail-open security hole.

**Failure scenario:** repo on a network drive / large monorepo; `git status --porcelain` exceeds its 800 ms timeout; `ctx.facts.status` is `undefined`; `rule.check` does `ctx.facts.status.split('\n')` → `TypeError` thrown out of `evaluateBlockRulesAsync` → depending on the host's error handling (F10), the tool call proceeds **unblocked**. The dangerous command runs and the logs show a stack trace, not a block reason.

**Fix:** the discriminated union from F1 is mandatory, and rules must be *unable* to read a raw value:

```ts
function factOr<T>(f: FactState<T>, rule: BlockRule): T {
  if (f.status === 'ok') return f.value;
  throw new FactUnavailableError(rule.id, f.status);   // caught by the loop → applies rule.onUnavailable
}
```

Add an ESLint/`tsc`-enforceable invariant: no `FactState.value` access outside `factOr`. Add a test per requirement in TEST-01 asserting that a rejected prefetch produces a **block with `reasonCode: 'infra-timeout'`**, never a pass and never a thrown TypeError escaping the evaluator.

---

## F3 — HIGH — parallel git spawns contend on `.git/index.lock`

**Location:** prefetch layer; `ALL_RULES` facts likely include `git status`, `git diff`, `git check-ignore`.

ASYNC-03 implies parallel `execFile` calls. `git status` and `git diff` **opportunistically refresh and write `.git/index`**. Two concurrent invocations race for `.git/index.lock`.

**Failure scenario:** prefetch fires `git status --porcelain` and `git diff --name-only` simultaneously in a repo whose index is stale (common after a branch switch or a fresh clone). One wins the lock; the other exits 128 with `fatal: Unable to create 'C:/.../.git/index.lock': File exists.` Intermittent, machine-speed-dependent, and **will not reproduce in CI** on a small warm repo. Surfaces in the field as random `fail-closed` blocks.

**Fix:** every read-only query gets `--no-optional-locks` (Git ≥ 2.19) and the env belt-and-braces:

```ts
const GIT_READONLY_ARGS = ['--no-optional-locks'] as const;
execFile(GIT_EXE, [...GIT_READONLY_ARGS, 'status', '--porcelain=v1', '-z'], {
  cwd, signal, timeout, maxBuffer, windowsHide: true, shell: false,
  env: { ...sanitizedEnv, GIT_OPTIONAL_LOCKS: '0' },
});
```

Prefer `-z` (NUL-separated) over porcelain text parsing — it sidesteps CRLF normalization, quoting of non-ASCII paths (`core.quotepath`), and embedded newlines in filenames. If any query is genuinely write-capable, serialize those behind a mutex; do not rely on lock-retry.

---

## F4 — HIGH — credential prompts hang past the timeout on Windows

**Location:** `execFile` env construction (ASYNC-03).

Any query that touches a remote (`git fetch`, `git ls-remote`, `git log origin/...`) or a LFS/filter driver can invoke Git Credential Manager, which pops a **GUI dialog**. `timeout` kills `git.exe`; the GCM helper process survives (F6) holding the console, and the user sees a modal at tool-call time. Worse, some helpers block on a TTY read that `timeout` does terminate — but only after the full budget, per query.

**Failure scenario:** rule needs `git config --get remote.origin.url` plus a remote-tracking check. Corporate machine, expired PAT. GCM dialog appears mid-tool-call; `evaluateBlockRulesAsync` burns its whole budget; every subsequent tool call repeats it. User perceives the assistant as hung.

**Fix — non-interactive env is mandatory, not optional:**

```ts
const GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',   // git fails instead of prompting on the TTY
  GIT_ASKPASS: '',            // no askpass helper
  GCM_INTERACTIVE: 'never',   // Git Credential Manager
  GCM_PROVIDER: '',           // avoid provider auto-detection probes
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',                // stable, parseable English messages
} as const;
```

Also **scope the phase to local-only queries.** If any fact requires network I/O, it does not belong in a tool-call blocker's hot path; raise it as a scope question to the planning track rather than shipping it with a 2 s timeout.

---

## F5 — MEDIUM — `EINVAL` from `.cmd` git shims (CVE-2024-27980 mitigation side-effect)

**Location:** git executable resolution, new prefetch module.

The context cites "CVE-2024-27980 class guidance" as the reason for `shell: false`. That CVE's Node mitigation (v18.20.2 / 20.12.2 / 21.7.3+) made spawning **any** `.bat`/`.cmd` without `shell: true` throw `EINVAL`. Git for Windows ships a real `git.exe`, but **Scoop and Chocolatey install `git.cmd` / `git.ps1` shims**, and MSYS2/Cygwin setups can put a `git` shell script first on PATH.

**Failure scenario:** user (this machine is `win32`) installed Git via Scoop. `execFile('git', [...])` resolves `C:\Users\bedit\scoop\shims\git.cmd` → patched Node throws `EINVAL` synchronously → **every** git-backed rule fails → all rules hit their `onUnavailable` policy. If any safety rule is `fail-closed`, the assistant is bricked for that user with an opaque `EINVAL`. If `fail-open`, protection silently disappears.

**Fix:** resolve to a real `.exe` once, cache it, and fail loudly at module load with an actionable message:

```ts
// Resolve candidates in order; require a .exe suffix on win32.
const CANDIDATES = [
  process.env.GIT_PATH,
  'C:/Program Files/Git/cmd/git.exe',
  'C:/Program Files/Git/bin/git.exe',
  'C:/Program Files (x86)/Git/cmd/git.exe',
];
// Fall back to `where.exe git` and filter to entries ending in .exe.
```

Do **not** "fix" this with `shell: true` — that reintroduces the exact injection class the constraint exists to prevent. Add a TEST-01 case that spawns a `.cmd` shim and asserts the resolver rejects it with a clear diagnostic rather than propagating `EINVAL`.

---

## F6 — MEDIUM — `timeout`/`abort` kills `git.exe`, not its children (Windows)

**Location:** ASYNC-03 "AbortSignal killing child process".

POSIX `SIGTERM` to git often reaches the process group; on Windows there is no group signal. `git.exe` spawns `git-remote-https.exe`, `ssh.exe`, filter/LFS helpers. Killing the parent orphans them, and **an orphan holding stdout keeps the pipe open**, so `execFile`'s promise may not settle promptly even though the child is dead.

**Failure scenario:** a timed-out query leaves `ssh.exe` running with a console window (mitigated by `windowsHide`, but the process persists). Over a long session, dozens of orphans accumulate. Additionally, the awaited promise lingers, so `evaluateBlockRulesAsync` overshoots its total budget despite every individual timeout firing "correctly."

**Fix:** on `win32`, escalate to a tree kill on timeout/abort:

```ts
if (process.platform === 'win32' && child.pid) {
  spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
}
```

`util.promisify(execFile)` hides the `ChildProcess`, so use the callback form (or `spawn`) for queries where you need `child.pid`. Also guarantee settlement: race the execFile promise against a hard `setTimeout` that resolves to `{status:'timeout'}` so a stuck pipe can never stall the evaluator.

---

## F7 — MEDIUM — unhandled rejection from concurrent prefetch

**Location:** prefetch fan-out.

```ts
const p1 = runGit(a); const p2 = runGit(b);   // p2 rejects before any await
const r1 = await p1;                           // ✗ unhandledRejection on p2
```

Node's default `--unhandled-rejections=throw` (Node 15+) **crashes the host process**. Inside an extension host this can take down the whole session.

**Fix:** make the query helper total — it never rejects:

```ts
async function fetchFact<T>(spec: QuerySpec<T>): Promise<FactState<T>> {
  try { /* execFile */ return { status: 'ok', value, ms }; }
  catch (e) { return classify(e); }   // 'timeout' | 'aborted' | 'error'
}
const states = await Promise.all(specs.map(fetchFact));   // allSettled is then redundant
```

Register a defensive `process.on('unhandledRejection')` **only** if the extension host doesn't already; otherwise log-and-swallow there and break the host's own diagnostics.

---

## F8 — MEDIUM — default `maxBuffer` is 1 MB; overflow looks like a git failure

**Location:** ASYNC-03 mentions `maxBuffer` but no value is specified.

`git status --porcelain` or `git diff --name-only` in a large monorepo easily exceeds 1 MB. Node kills the child and rejects with `err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`.

**Failure scenario:** classifier keys on "non-zero exit / killed" → tags it `timeout` or `error` → rule applies `onUnavailable` → `fail-closed` blocks every tool call in that repo. Or, worse, the truncated stdout is parsed as valid and yields a **wrong but plausible** answer (partial file list → "path not tracked" → allow).

**Fix:** set `maxBuffer` explicitly (8–16 MB), and **never parse stdout when the error indicates truncation**:

```ts
if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { status: 'error', code: 'maxbuffer', stderr: '' };
```

Also cap output at the source where possible (`git status --porcelain -z -- <pathspec>`, `git diff --name-only -- <path>`) so the query is O(relevant paths), not O(repo). Add a TEST-01 case with a synthetic >maxBuffer output.

---

## F9 — MEDIUM (UNVERIFIED-CONTRACT) — `.test.mjs` importing `.ts` needs a loader

**Location:** TEST-01; `package.json` test script (not in packet).

TEST-01 mandates co-located **`.test.mjs`** files, but the modules under test are **`.ts`** (`lib/extensions/tool-blockers.ts`). Plain `node --test lib/**/*.test.mjs` cannot resolve `import { evaluateBlockRules } from './tool-blockers.ts'` unless one of these holds:

- tests import **compiled output** (`dist/...js`) → requires a build step before test, and tests then validate stale artifacts if the build is skipped;
- a TS loader is registered (`--import tsx`, `--loader ts-node/esm`);
- Node ≥ 23.6 type-stripping is active (also reportedly default-on in 22.18+ — **verify, do not assume**).

**Failure scenario:** the phase's "done" criterion is TEST-01. Tests are written, `node --test` exits 0 because the glob matched **zero** files (a very common silent pass), and the phase is reported complete with no coverage. Alternatively tests pass against `dist/` built from a previous commit, masking a regression.

**Fix — verify before writing a single test:**

```bash
node --version && node -p "require('./package.json').scripts"
# smoke-test the import path you intend to use:
node -e "import('./lib/extensions/tool-blockers.ts').then(m=>console.log(Object.keys(m))).catch(e=>console.error('LOADER MISSING:',e.code))"
```

Then make the glob fail loudly: `node --test --test-reporter=spec "lib/**/*.test.mjs"` plus an assertion in CI that the collected test count is > 0. Recent commits in this repo reference a `conftest_loader` rule in `TESTING.md` — check whether an analogous documented loader convention already exists for the TS side and follow it rather than inventing one.

---

## F10 — MEDIUM (UNVERIFIED-CONTRACT) — `pi.on("tool_call")` async support

**Location:** `extensions/index.ts` handler; flagged in the Context Summary itself as "verify before proceeding."

This is the load-bearing assumption of the entire phase. If the host does **not** await the handler's returned promise, the tool executes immediately and the block decision lands afterwards — the blocker becomes decorative.

**Failure scenario:** handler is `async`, does `await evaluateBlockRulesAsync(...)`, then returns `{ block: true }`. Host treats the returned Promise as an opaque truthy value or ignores it. Tool runs. No error anywhere. Telemetry records "blocked" while the action already happened — actively misleading diagnostics.

**Fix — verify empirically, not by reading types alone:**

```js
// temporary probe in extensions/index.ts
pi.on("tool_call", async (e) => {
  await new Promise(r => setTimeout(r, 3000));
  console.error('[PROBE] handler resumed after 3s');
  return { block: true, reason: 'probe' };
});
```

Observe: does the tool call wait 3 s and get blocked, or execute immediately? Also inspect the emitter's declared handler signature (`void | Promise<void>` vs `BlockResult | Promise<BlockResult>`) and whether it does `await handler(...)` or collects results synchronously.

**If the host does not await:** do not ship the async path as the decision-maker. Options, in order of preference: (a) keep `evaluateBlockRules` sync in the handler and use async prefetch only as a **background cache warmer** for the next call; (b) return a synchronous "pending/deny-by-default" result and resolve out-of-band if the API allows; (c) request an API change. Record the outcome in the phase notes either way — it constrains ASYNC-01 more than any other fact.

---

## F11 — MEDIUM — gather-then-decide breaks short-circuit parity

**Location:** `evaluateBlockRulesAsync` vs `evaluateBlockRules` (`tool-blockers.ts`).

The sync path "short-circuits on first block" (per Context Summary). The async path prefetches **all** facts before deciding. Two divergences:

1. **Work amplification:** every tool call spawns N git processes even when a cheap regex rule blocks in microseconds. On Windows, process spawn is ~10–30 ms each; N=5 → 50–150 ms of added latency, which may make the async path **slower** than the sync baseline Phase 7 measured. That inverts the phase's stated success criterion ("async should improve on this").
2. **Different reported rule:** if the async path evaluates facts/rules in a different order (e.g., object-key order of the facts map, or `Promise.all` completion order leaking into the decision), the *blocking reason* shown to the user can differ between paths for identical input. That is a determinism failure in an authoritative path.

**Fix:**
- Iterate `ALL_RULES` in the **same array order** in both paths. Assert this in a test: identical inputs → identical `BlockResult.ruleId`.
- **Lazy prefetch:** run cheap sync rules first; only fetch facts for the first rule that declares `requires`. Or prefetch in parallel with the cheap rules and `await` only at the first rule that needs facts.
- Record prefetch wall-clock **and** process count in telemetry so the Phase 7 comparison is apples-to-apples (see F14).

---

## F12 — MEDIUM — shallow freeze leaves facts mutable

**Location:** ASYNC-01 "frozen context".

`Object.freeze({ facts })` does not freeze `facts`, nor the arrays inside it. A rule doing `ctx.facts.status.value.push(...)` or `sort()`-in-place mutates shared state read by later rules.

**Failure scenario:** rule A calls `paths.sort()` on the frozen-context array (in-place, returns the same reference) to binary-search. Rule B then iterates the same array expecting `git status` emission order. Output differs by rule ordering — a subtle, non-reproducible decision change.

**Fix:**

```ts
function deepFreeze<T>(o: T): T {
  for (const v of Object.values(o ?? {})) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
```

Prefer **defensive copies** for anything a rule might want to sort (`[...arr].sort()`), and note that freeze violations throw `TypeError` only in strict mode — ESM is always strict, so this holds *if* the compiled output stays ESM. If `tsconfig` targets CommonJS without `"use strict"`, mutations fail **silently**. Verify the module format; add a TEST-01 case asserting a mutation attempt throws.

---

## F13 — MEDIUM — inherited `GIT_*` env corrupts queries

**Location:** `execFile` env (ASYNC-03).

If the extension host is itself launched from a git hook, a CI step, or another git process, the environment may carry `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_PREFIX`. Child `git` invocations then query the **wrong repository** — silently, with exit 0 and valid-looking output.

**Failure scenario:** CI runs the host inside a `git rebase` (sets `GIT_DIR`). Prefetch queries the rebase's temporary dir; `git check-ignore` reports the target path as untracked-but-not-ignored; a safety rule that blocks writes to untracked-but-tracked paths decides incorrectly. No error, no stderr, wrong answer.

**Fix:** build the child env by **deleting** all `GIT_*` keys, then adding back only the intentional ones from F4:

```ts
function gitEnv(base = process.env) {
  const env = { ...base };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return { ...env, ...GIT_NONINTERACTIVE_ENV };
}
```

Always pass `cwd` explicitly; never rely on `process.cwd()` inheritance alone. Add `-c core.quotepath=false` and `-c color.ui=never` as `-c` overrides so a user's global config can't change the output format.

---

## F14 — MEDIUM (UNVERIFIED-CONTRACT) — telemetry parity with Phase 7

**Location:** `lib/extensions/telemetry-collector.ts` → `evaluateBlockRulesInstrumented`.

Phase 7 established an instrumented sync wrapper as the baseline. If `evaluateBlockRulesAsync` isn't instrumented identically, the phase cannot demonstrate its own success criterion, and metric shapes diverge between paths (dashboards/queries silently drop async rows).

**Fix:** mirror the wrapper (`evaluateBlockRulesAsyncInstrumented`) and split the measurement — a single total is useless for diagnosing F11:

```ts
{ ruleId, path: 'async', prefetchMs, prefetchCount, ruleMs, syncOverrun: boolean,
  factStates: { 'git.status': 'ok', 'git.ignored': 'timeout' },   // F2's union, as strings
  decision: 'block' | 'allow' | 'fail-closed' | 'fail-open', reasonCode }
```

Emitting `factStates` is what makes fail-closed-due-to-timeout distinguishable from fail-closed-due-to-policy in production — without it, F3/F4/F5-class incidents are undiagnosable.

---

## F15 — LOW — thenable detection message

**Location:** ASYNC-02, sync `evaluateBlockRules`.

`typeof result?.then === 'function'` is correct, but note the important subtlety: an `async` rule returning "no block" still yields a **resolved Promise**, so detection must happen on the return value, never on the block decision. The thrown `TypeError` should name the rule:

```ts
if (result != null && typeof (result as any).then === 'function') {
  throw new TypeError(
    `Block rule "${rule.id}" returned a thenable; evaluateBlockRules is synchronous. ` +
    `Use evaluateBlockRulesAsync, or make the rule sync.`);
}
```

Throw **before** any telemetry/state mutation so a rejected call leaves no partial record.

---

## Platform facts worth pinning in the plan

```js
// promisify(execFile) resolves to an OBJECT, not a string — the #1 mistake here
const execFileAsync = promisify(execFile);
const { stdout, stderr } = await execFileAsync(exe, args, opts);   // ✓
const stdout = await execFileAsync(exe, args, opts);               // ✗ always truthy object

// Error classification table (verify each in a real test — don't trust this table blindly)
// timeout exceeded      → err.killed === true, err.signal === 'SIGTERM', err.code = exit|null
// signal aborted        → err.name === 'AbortError', err.code === 'ABORT_ERR'
// maxBuffer exceeded    → err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
// exec not found        → err.code === 'ENOENT'
// .cmd/.bat, patched Node → err.code === 'EINVAL'
// non-zero exit         → err.code === <number>, err.stdout may still be populated → do NOT trust it
// empty repo / not git  → exit 128, stderr 'fatal: not a git repository'
```

Node version floors implied by these requirements — **confirm `engines` before relying on them**:

| API | Minimum |
|---|---|
| `options.signal` on `execFile` | 15.4.0 |
| `AbortSignal.timeout(ms)` | 17.3.0 (16.14.0) |
| `AbortSignal.any([...])` | 20.3.0 / 18.17.0 |
| `.cmd` spawn → `EINVAL` | 18.20.2 / 20.12.2 / 21.7.3 |
| `--experimental-strip-types` | 22.6.0 (default-on ≥23.6; 22.18+ **verify**) |

Use `AbortSignal.any([AbortSignal.timeout(perQueryMs), hostShutdownSignal])` so host teardown aborts in-flight git. Check `signal.aborted` **before** spawning and classify as `'aborted'`, distinct from `'timeout'` — they warrant different policies (shutdown should not emit a user-facing block).

One lifecycle gotcha not in any requirement: pending `execFile` children **hold the event loop open**. If the host shuts down mid-prefetch, exit can hang. Wire a shutdown `AbortController` and add a hard cap on total prefetch concurrency (4 is plenty; unbounded fan-out on a large repo is a fork-bomb-adjacent pattern).

---

## TEST-01 edge-case matrix

| Case | Asserts |
|---|---|
| Query timeout | `status:'timeout'`, rule applies declared policy, `reasonCode` distinguishes infra from policy |
| Pre-aborted signal | `status:'aborted'`, **no** user-facing block |
| `maxBuffer` overflow | `status:'error'/'maxbuffer'`, truncated stdout **never** parsed |
| `ENOENT` (git missing) | clear diagnostic, not a raw stack |
| `.cmd` shim present (win32) | resolver rejects with actionable message (F5) |
| Exit 128, not a repo | treated as a known state, not `error` |
| CRLF + trailing newline in stdout | parsed identically to LF (or use `-z`) |
| Non-ASCII / space-containing paths | `core.quotepath=false` + `-z` round-trip |
| Concurrent prefetch, stale index | no `index.lock` failure (F3) — run against a real repo with `touch`ed index |
| Sync rule returns a thenable | `TypeError` naming the rule; no partial telemetry |
| **Async** rule in async path | either supported deliberately or rejected — pick one, test it |
| Frozen-context mutation | throws `TypeError` (confirms strict mode, F12) |
| Rule order parity | same input → same `ruleId` in both paths (F11) |
| Host shutdown mid-prefetch | no unhandled rejection, no hang (F6/F7) |

Inject `runGit` as a dependency for the logic tests (fast, deterministic, no Windows variance) **and** keep a small set of real-`git` integration tests that exercise the actual `execFile` option surface — the injected-mock-only suite will pass while F3/F4/F5/F8 all remain broken.

---

## Must-verify before implementation

1. **F10** — does `pi.on("tool_call")` await the handler? Empirical probe, not type reading. Everything else is downstream of this.
2. **F1** — confirm with the planning track that ASYNC-04's "per-rule timeout" means *per-fact-query timeout + non-preemptive sync budget*. As written the two requirements contradict.
3. **F9** — the actual `test` script and TS import mechanism; confirm a `.test.mjs` can import `tool-blockers.ts` today.
4. `node --version`, `git --version` (≥2.19 for `--no-optional-locks`), and whether git resolves to a real `.exe` on the target machines: `where.exe git`.
5. **Scope:** confirm all prefetched facts are local-only. Any network-touching query should be escalated out of this phase (F4).
6. `tsconfig` module format (ESM vs CJS) — determines whether `Object.freeze` violations throw or fail silently (F12), and whether `.test.mjs` interop works at all.


---

## Cross-Model Notes

Review the sections above for agreements and disagreements across models.
The cross-AI research review (step 5.4) will verify accuracy and flag concerns.

---

*Research completed via parallel multi-model research*
