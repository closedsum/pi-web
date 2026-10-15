# Phase 08: Async Block Rules — Research

**Researched:** 2026-10-15
**Method:** Parallel multi-model research (MiniMax-M3 + claude-opus-5-5[1m] + claude-sonnet-5-5[1m] + gpt-6.1-sol + gpt-6-astra)
**Requirements:** ASYNC-01,ASYNC-02,ASYNC-03,ASYNC-04,TEST-01

## Research Approach

| Track | Model | Status | Time |
|-------|-------|--------|------|
| minimax | MiniMax-M3 | ok | 46.8s |
| opus55 | claude-opus-5-5[1m] | ok | 83.6s |
| sonnet5 | claude-sonnet-5-5[1m] | ok | 85.3s |
| gpt | gpt-6.1-sol | ok | 96.6s |
| gpt6 | gpt-6-astra | ok | 120.1s |
| qwen38 | qwen3.8-max | fail | 721.1s |

---

## Minimax Research (MiniMax-M3)

# Phase 8 (Async Block Rules) — Research Findings

The review material provided is a phase context summary, not raw source files. Per the architecture-level review convention, findings reference module paths, class names, and method signatures rather than file:line.

---

## 1. `pi.on("tool_call")` async handler support — UNVERIFIED-CONTRACT

The context summary states "Verify `pi.on("tool_call")` supports async return values before proceeding." This is the foundational assumption for ASYNC-01: if the extension host rejects / does not await a Promise return, the gather-then-decide pattern silently degrades to sync-only semantics (the prefetch completes but decisions are made against a stale or empty context).

**Concrete failure scenario:** `tool_call` handler is invoked synchronously by the pi runtime. The handler returns a `Promise<undefined>` from `evaluateBlockRulesAsync`. If the host treats the return value as the literal `thenable` and never awaits it, the rule pass is skipped or the host throws — blocking every tool call after registration.

**Action — verify before planning, then encode in the design:**
1. Read the extension-host docs / `pi.on` implementation and confirm: (a) whether async listeners are awaited, (b) the resolution order with respect to `preventDefault`/continuation signals, and (c) error propagation (does a rejected Promise block or permit the call?).
2. If unsupported: do not attempt a single-coroutine gather-then-decide. Either (a) block until prefetch resolves and then run sync, accepting higher per-call latency, or (b) require the host API to be patched first — explicitly out-of-scope risk to flag at kickoff.

**Severity:** CRITICAL (the entire ASYNC-01 premise hinges on it).

---

## 2. Sync `evaluateBlockRules` thenable-guard contract

ASYNC-02 requires the sync API to throw `TypeError` if "a rule returns a thenable." The current contract per context summary is "pure sync functions returning `BlockResult | undefined`."

**Two under-specified contracts to lock down:**

1. **Detection predicate.** Use `result != null && typeof result.then === 'function'` (duck-typed thenable check). Do not rely on `result instanceof Promise` — a rule could return a custom thenable. Spec both branches in JSDoc.

2. **Aggregation behavior when multiple rules return thenables.** The context implies short-circuit-on-first-block, but does a type violation in rule #3 (never reached due to short-circuit on rule #1) get reported? Recommendation: only inspect the rules actually evaluated (matches short-circuit semantics). Otherwise authors will see mysterious TypeErrors from rules they didn't write.

```ts
// Sketch — to be finalized in implementation
export function evaluateBlockRules(input: BlockInput, rules = ALL_RULES): BlockResult | undefined {
  for (const rule of rules) {
    const result = rule(input);
    if (result != null && typeof (result as any).then === 'function') {
      throw new TypeError(
        `Block rule '${rule.name ?? "<anonymous>"}' returned a thenable; ` +
        `use evaluateBlockRulesAsync for async rules.`
      );
    }
    if (result) return result; // short-circuit
  }
}
```

**Severity:** HIGH (defines a new contract the prior sync consumers depend on stability of).

---

## 3. `execFile` async migration — concrete gotcha list for ASYNC-03

The context correctly identifies the CVE-2024-27980 class (shell injection via `shell: true`). Below are the easy-to-miss concrete gotchas when migrating from `execFileSync` to `util.promisify(execFile)`:

1. **`maxBuffer` defaults differ.** `execFileSync` enforces maxBuffer; `promisify(execFile)` does *not* apply Node's default (1 MiB) the same way when `encoding: 'buffer'` is set. Set `{ maxBuffer: 10 * 1024 * 1024 }` explicitly to match `lib/git-query.ts` existing behavior, or document a smaller cap if git log output is bounded.

2. **`AbortSignal` requires `killSignal` config.** `execFile(p, args, { signal, timeout })` on Node ≥ 20 will abort, but by default it sends **SIGTERM without forcibly killing** the child if the child ignores SIGTERM. git.exe on Windows ignores SIGTERM (Windows has no SIGTERM concept). Combine `signal` with `killSignal: 'SIGKILL'` — but note SIGKILL is not delivered on Windows. The reliable kill is to use `windowsHide: true` and `forceKillAfterDelay: true` (Node ≥ 17.3 — verify on the project's engine). If `windowsHide` alone doesn't propagate, fall back to spawning git with an internal timeout (`GIT_TERMINAL_PADDING` does not help) — the realistic answer is that on Windows you cannot kill a git process mid-cat; you can only stop consuming its stdout.

3. **Timeout vs Signal precedence.** When both `timeout` and `signal` are set and the *signal* fires first, `execFile` rejects with an `AbortError`. When *timeout* fires first, the error is a `TimeoutError` with `.code === 'ERR_EXEC'`. Make the rule module normalize these to a single `AbortError` with `cause` set, so downstream code has one error shape to match on.

4. **`windowsHide: true` is mandatory** on Windows to avoid spawning a flashing cmd window for every prefetch. The context already specifies this; flagging as a checklist item because it's easy to omit on the async path.

5. **Argument array vs single string.** CVE-2024-27980 specifically targets argument splitting when a shell is involved. `execFile` with an *array* of args bypasses any shell, but pass `args` as an array literal — never assemble via `concat` with user-controlled strings in the middle. The git-query.ts reviewer should confirm `git` invocation pattern (e.g., `git -C ${repoPath} rev-parse HEAD` — confirm args are passed array-style).

**Recommended async wrapper skeleton** (pseudo, not source):
```ts
const { execFile } = await import('node:child_process'); // dynamic if any sync code path needs to avoid top-level await
const execFileP = promisify(execFile);

async function gitFact(args: string[], opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }) {
  try {
    const { stdout } = await execFileP('git', args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      signal: opts.signal,
      killSignal: 'SIGKILL',
    });
    return stdout.toString();
  } catch (err: any) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') throw err; // caller decides fail-open/closed
    throw err;
  }
}
```

**Severity:** MEDIUM (correctness, not data loss — but mis-killed processes may leak under load).

---

## 4. Per-rule timeout policy (ASYNC-04) — fail-open/fail-closed needs a per-rule field

A single global default will almost certainly be wrong. Recommendations:

1. **Default = fail-closed.** Authors must opt *into* fail-open explicitly — security defaults should not assume availability over correctness.

2. **Encode the policy on the rule itself**, not on the async orchestrator. Proposed shape (re-stating, do not adopt unless planning agrees):

   ```ts
   interface AsyncBlockRule extends BlockRule {
     kind: 'async';
     timeoutMs: number;       // required, no default
     onTimeout: 'fail-closed' | 'fail-open';
   }
   ```

3. **Orchestrator must `AbortSignal.timeout(rule.timeoutMs)` per rule**, then *re-throw* the `AbortError` into the rule's own decision. Do not let one slow rule's timeout propagate and cancel sibling prefetches — use a fresh `AbortController` per rule (or per `Promise.all` group).

4. **Distinguish timeout from error.** A git process that exited non-zero is different from one that exceeded `timeoutMs`. Policy should apply identically to both today, but logging/telemetry should distinguish `RULE_TIMEOUT` vs `RULE_GIT_ERROR` — Phase 7's telemetry collector (`evaluateBlockRulesInstrumented`) is the natural place to add counters.

5. **Uncaught exceptions inside an async rule.** If a rule throws synchronously *before* returning a thenable, the orchestrator's `Promise.all` will reject. Decide now: do you want one failing rule to crash the whole block evaluation (fail-closed) or be reported as `undefined` (fail-open)? Recommend fail-closed with structured logging — users want loud failures during rollout, not silent skipping.

**Severity:** HIGH (this is the entire security boundary of the async path; a default that's wrong in either direction is exploitable or noisy).

---

## 5. Gather-then-decide ordering and cancellation

The "gather-then-decide" pattern has one subtle race:

1. All prefetches are launched in parallel (`Promise.all` over `{signal: combinedController.signal}`).
2. The decision phase runs after *all* prefetches settle.
3. If the `tool_call` event is cancelled mid-prefetch (e.g., user aborts the prompt), the per-call `AbortSignal` fires. The combined controller should forward cancellation, but **only abort the git subprocesses**, not throw out of the orchestrator — the host may still want to allow the call when the user cancels.

**Risk:** If the orchestrator rejects when its signal aborts, and the `tool_call` host treats rejection as "block," then user-aborts become silent block-events. Recommendation:
- Prefetch phase: bind to AbortSignal; on abort, return a frozen context with `null` for cancelled fields, not throw.
- Decision phase: never throws on its own signal — only throws on the rule-level timeouts above.

**Also:** `Promise.all` rejects on the first failure. If two git calls race and one fails non-cancellation, the other may have already populated the context but never surfaces. Use `Promise.allSettled` and capture per-fact `{ ok, value | reason }` so each fact is independently fail-open/closed.

**Severity:** MEDIUM (affects UX, not security).

---

## 6. Frozen context shape and immutability

"Pre-fetches into frozen context" is mentioned but the shape is undefined. Two risks:

1. If the context is a plain `Object.freeze(...)`'d record, downstream rules cannot receive it across module instances after Node's V8 hidden-class transitions. This is fine for pure-functional rules but watch for accidental getter access.

2. If the context stores `Buffer` instances (binary git output), `postMessage`/`structuredClone` will eventually be needed if the orchestrator moves off the main thread. Today (main thread), raw buffers are fine — note this constraint so a future worker-thread refactor isn't blocked.

**Recommendation:** Define `type AsyncBlockContext = Readonly<{ cwd: string; headSha: string | null; dirtyFiles: readonly string[]; … }>` with all fields `readonly` at the type level *and* `Object.freeze` at runtime. Add a test that mutating any field throws in strict mode (or silently no-ops in sloppy mode — use `'use strict'`).

**Severity:** LOW.

---

## 7. Co-located test placement (TEST-01) — test isolation risks

Tests at `.test.mjs` co-located with the modules they cover is straightforward, but the async path has two specific test-design traps:

1. **Fake timers + `AbortSignal.timeout`.** Node's `setTimeout` mocking via `sinon.useFakeTimers()` does not affect `AbortSignal.timeout` which uses an internal `setTimeout`. Use the native `timers.setTimeout` mock pattern with `MockTimers` from `node:test`'s mock module, or just exercise real timers with small millisecond values.

2. **`execFile` stubbing.** Real `git` is not available in CI sandboxes. Stub `lib/git-query.ts` (or the new async equivalent) at the module boundary, **not** at `execFile` — stubbing `execFile` itself leaks across tests because of the `util.promisify` cache. Use `node:test`'s `mock.module` or a DI seam from day one.

**Recommendation:** Add the async git query behind a narrow interface (`interface GitFacts { getHeadSha(): …, listDirtyFiles(): … }`) so tests can inject a stub without touching `child_process`. This also makes TEST-01 fail-safe — if the wrapper has no seam, every test becomes an integration test.

**Severity:** MEDIUM (test suite will be flaky without this).

---

## 8. Telemetry baseline comparison (Phase 7 handoff)

Phase 7 measures sync performance. The async path should be instrumented through the same `evaluateBlockRulesInstrumented` so the comparison is apples-to-apples.

**Concrete items to add to the telemetry contract:**
- `prefetch_duration_ms` histogram per fact type
- `rule_decision_duration_ms` histogram per rule (the decision phase is now bounded by max(prefetch), not sum)
- `rule_timeout_count` counter, tagged `fail_open`/`fail_closed`
- `prefetch_cancelled_count` counter (signal aborted)

**Severity:** LOW (observability, not correctness).

---

## 9. Open questions to surface at kickoff

These are explicit unknowns the planning track should resolve before code is written:

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | Does `pi.on("tool_call")` await async listeners? | Blocks ASYNC-01 entirely. |
| 2 | Is `resolveStateHome()` blocking / expensive enough to also be prefetched? | Otherwise the first prefetch still pays that cost. |
| 3 | Will `thenable` rules be allowed to coexist with sync rules in a single orchestrator, or must all rules share a `kind`? | Affects the API surface for rule authors. |
| 4 | Is Windows a supported runtime? (governs whether `windowsHide: true` + `killSignal` is sufficient.) | Affects timeout enforcement correctness. |
| 5 | What Node version is the engine pinned to? (`AbortSignal.timeout` requires ≥ 17.3; `killSignal` on `execFile` requires ≥ 14.17.) | Affects which APIs are available without polyfills. |

**Severity:** varies — findings #1 is CRITICAL until answered; #4 and #5 are MEDIUM; the others are LOW.

---

## Summary of recommendations

1. **Gate the entire phase on confirming the async `pi.on("tool_call")` support** (finding #1) — do not proceed past planning otherwise.
2. **Define rule-level timeout + policy fields now** (finding #4) so rule authors don't get a global-default surprise later.
3. **Use `Promise.allSettled` with per-fact abort signals** (finding #5) — `Promise.all` will silently drop data on the first rejected prefetch.
4. **Add a DI seam for the async git wrapper before writing tests** (finding #7) — otherwise TEST-01 forces brittle git-in-CI tests.
5. **Lock down the thenable-guard predicate and short-circuit interaction** (finding #2) — `result != null && typeof result.then === 'function'`, only inspect evaluated rules.

Findings where confidence is low (due to absent source): findings #1, #4 (timeout semantics on Windows), and #7 (Node version pin) are tagged as needing verifier confirmation during implementation.

---

## Opus55 Research (claude-opus-5-5[1m])

# Phase 8 Research: Async Block Rules

**Caveat:** The scratch repo has no tracked files. I could not read `tool-blockers.ts`, `git-query.ts`, `telemetry-collector.ts` or `extensions/index.ts`. Anything below about those files comes from the phase context and is marked **UNVERIFIED**. The Node.js API behaviour is well established for Node ≥ 16, but check it against the Node version the project actually runs on.

## 1. Gate check: does `pi.on("tool_call")` await async handlers? (UNVERIFIED, blocking)

- **Risk:** If Pi's event emitter calls handlers and ignores what they return, an async handler's Promise is dropped. The block result is then lost, so every block silently allows the tool call. That is fail-open in the worst possible way.
- **Action before any code:** search Pi's extension runner for how `tool_call` handlers are called, e.g. `grep -rn "tool_call" node_modules/@*/pi*/dist`. Look for `await handler(...)` or for `Promise.all`/`for … await` over the handler list.
- **Fallback if it does not await:** keep the sync path in `index.ts`. Ship `evaluateBlockRulesAsync` as a library function only, and record that wiring it in is deferred.
- **Required test:** a fake runner that calls the handler, checks the result is a Promise, and checks it resolves to `{ block: true, reason }`.

## 2. Gather-then-decide architecture

```ts
// lib/extensions/block-context.ts
export interface GitFacts {
  readonly branch: string | null;        // null = query failed/timed out
  readonly isDirty: boolean | null;
  readonly topLevel: string | null;
  readonly errors: readonly string[];    // per-fact failure reasons
}
export interface BlockContext { readonly toolCall: ToolCall; readonly git: GitFacts; }

export async function evaluateBlockRulesAsync(
  call: ToolCall, opts: { signal?: AbortSignal; timeoutMs?: number; rules?: readonly BlockRule[] } = {}
): Promise<BlockResult | undefined> {
  const git = Object.freeze(await prefetchGitFacts(call.cwd, opts));   // async I/O only here
  const ctx = Object.freeze({ toolCall: call, git });
  return evaluateBlockRules(ctx, opts.rules ?? ALL_RULES);             // pure sync decision
}
```

Key points:

- **Only prefetch facts that some rule actually reads.** Have each rule declare `needs: readonly GitFactKey[]`, and prefetch the union of those keys. Otherwise every tool call pays for `git status`, which is the most expensive query (it is O(worktree)).
- **Run the queries in parallel** with `Promise.allSettled`, not `Promise.all`. With `Promise.all`, one rejection discards the facts that did succeed.
- **`Object.freeze` is shallow.** Freeze `git` and `errors` explicitly, or test that changing `ctx.git.branch` throws in strict mode (ESM is always strict).
- **Contract change (UNVERIFIED):** today the rules probably call `git-query.ts` sync functions directly. Under the new pattern they must read facts from `ctx`. Migrating them changes their signatures, and that touches the sync API, which ASYNC-02 forbids.
  - Recommended: give `BlockContext.git` an optional lazy getter. In sync mode it calls the existing `execFileSync` wrapper. In async mode it returns the prefetched value.
  - This keeps `evaluateBlockRules(call)` unchanged for existing callers.

## 3. ASYNC-02: thenable guard in the sync path

```ts
function isThenable(v: unknown): v is PromiseLike<unknown> {
  return v !== null && (typeof v === "object" || typeof v === "function")
      && typeof (v as any).then === "function";
}
// inside the evaluateBlockRules loop:
const r = rule.check(ctx);
if (isThenable(r)) {
  // swallow the stray rejection so it doesn't become an unhandledRejection crash
  Promise.resolve(r).catch(() => {});
  throw new TypeError(`Block rule "${rule.name}" returned a thenable; use evaluateBlockRulesAsync`);
}
```

- **Gotcha:** if you throw without attaching `.catch`, a rejected promise from the rule causes an `unhandledRejection`. Node ≥ 15 then crashes the process by default. That is why the `.catch(() => {})` above is needed.
- Check with duck typing, not `instanceof Promise`, so cross-realm promises and custom thenables are also caught.
- **Type-level guard:** declare `check: (ctx) => BlockResult | undefined`. Note this does not reject `async` functions assigned through `any`, so you still need the runtime check.
- **Unknown:** does this "throw" count as a behaviour change under "sync unchanged"? Throwing where the code previously returned a Promise (which was truthy and so treated as a block?) is a semantic change. Confirm what the current code does with a truthy non-`BlockResult` value and document the delta.

## 4. ASYNC-03: hardened async `execFile`

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

export async function gitAsync(args: readonly string[], cwd: string, signal: AbortSignal, timeoutMs = 2000) {
  const { stdout } = await execFileP("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd, signal, timeout: timeoutMs, maxBuffer: 1 << 20,
    windowsHide: true, shell: false, encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
  });
  return stdout.trimEnd();
}
```

Gotchas:

| Issue | Detail |
|---|---|
| **`git` vs `git.exe`** | Without `shell`, `execFile("git")` on Windows resolves through PATH plus PATHEXT inside libuv, so `.exe` is found. A `.cmd` or `.bat` shim is **not** run: since the CVE-2024-27980 fix (Node 18.20.2 / 20.12.2 / 21.7.3) it throws `EINVAL`. That is the intended fail-closed behaviour. Test the scoop/chocolatey shim case on this machine. |
| **Binary hijack** | `execFile("git")` with `cwd` set to an untrusted repo can pick up `git.exe` from cwd on Windows, because of the legacy search order. Resolve the absolute path once at startup (e.g. `where.exe git`, cached) and pass that path. |
| **Repo-config code execution** | Running `git status` inside a hostile repo can execute `core.fsmonitor` or hooks from `.git/config`. The `-c core.fsmonitor=false` above blocks the fsmonitor route. Also consider `safe.directory` behaviour. |
| **Lock contention** | Without `--no-optional-locks`, `git status` takes `index.lock` and can collide with the user's own git commands. |
| **`timeout` semantics** | `timeout` sends `killSignal` (SIGTERM). On Windows that is `TerminateProcess` on `git.exe` only. Grandchildren (e.g. `git-remote-https`, fsmonitor daemons) can survive. That is acceptable for read-only queries, but don't add network-touching commands. |
| **Abort error shape** | An abort rejects with `err.name === "AbortError"` (`code: "ABORT_ERR"`). A timeout rejects with `err.killed === true` and `signal === "SIGTERM"`. A non-zero exit gives `err.code` as a number. Map all three explicitly to fact=`null` plus a reason string. |
| **maxBuffer** | If exceeded, the child is killed and the promise rejects with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. `git status --porcelain` in a huge repo can hit 1 MB. For a dirty check, use `git status --porcelain -uno` and only test whether the output is non-empty, or use `git diff --quiet` and read the exit code. |
| **Listener leaks** | Reusing one long-lived `AbortSignal` across many `execFile` calls adds a listener per call and triggers `MaxListenersExceededWarning`. Create one `AbortController` per evaluation and combine signals with `AbortSignal.any([parent, AbortSignal.timeout(ms)])` (Node ≥ 20.3). On older Node, write a manual combiner. |

## 5. ASYNC-04: per-rule timeout and fail policy

- **Sync rules cannot be pre-empted.** A per-rule timeout only works on the async part, i.e. the fact prefetch for that rule's `needs`. A sync `check()` that spins can't be interrupted on the main thread. Say this in the docs and the requirement text, or the AC will be untestable.
- Recommended shape:
  ```ts
  interface BlockRule { name: string; needs?: readonly GitFactKey[]; timeoutMs?: number;
                        onUnavailable: "block" | "allow"; check(ctx): BlockResult | undefined; }
  ```
  If any fact listed in `needs` is `null` (timeout, abort or error), the evaluator applies `onUnavailable` and does not call `check`. A `"block"` decision returns a reason such as `"git facts unavailable (timeout 2000ms): rule X fails closed"`.
- **Default should be `"block"` (fail-closed) for safety rules.** Make the field required, with no default, so every rule states its policy. That satisfies "explicit".
- **Global deadline:** set an overall budget, e.g. 3 s. Telemetry from Phase 7 should inform the number; take p99 of the sync baseline × 2.
- **Aborting a cancelled tool call:** if Pi provides a signal, pass it down. Also make sure no promise outlives the evaluation, since a late-resolving `execFile` is harmless only if no one writes to shared state.
- **Short-circuit ordering:** sync evaluation stops at the first block. Prefetching everything up front loses some of that short-circuit benefit. Optional optimisation: run rules that need no facts first, before awaiting the prefetch.

## 6. Telemetry integration (Phase 7)

- Add an `evaluateBlockRulesAsyncInstrumented` that records prefetch time separately from decide time, plus timeout and fail-policy counts.
- **Gotcha:** if the instrumented wrapper simply wraps the async function in `performance.now()` around an un-awaited call, it measures roughly 0 ms. Await inside the timer.

## 7. TEST-01: test plan (`node --test`, co-located `.test.mjs`)

Make the git runner injectable, `prefetchGitFacts(cwd, { run = gitAsync })`, so that most tests don't spawn processes.

| Test | Asserts |
|---|---|
| Sync rule returns `Promise.resolve()` | `evaluateBlockRules` throws `TypeError`; no `unhandledRejection` (listen on `process`) |
| Sync rule returns `Promise.reject()` | Same as above; the process does not crash |
| Custom thenable `{then(){}}` | Throws `TypeError` |
| Async path with all facts present | Same result as the sync path for every rule in `ALL_RULES` (parity table) |
| Runner never resolves | Resolves within timeout + ε; `onUnavailable:"block"` blocks, `"allow"` allows |
| Parent signal aborted beforehand | Rejects or fails fast, no spawn (`execFile` with an already-aborted signal errors immediately) |
| Exit code 128 (not a repo) | Fact is `null` with a reason string, no throw |
| maxBuffer exceeded | Fact is `null`, policy applied |
| Context mutation attempt | Throws in strict mode (deep freeze) |
| Rules that need no git facts | Runner is never called |
| One real integration test | Spawns real git in `mkdtemp` + `git init`; `windowsHide` can't be asserted, so just check that it runs |
| `.cmd` shim (Windows only, `skip` elsewhere) | Fails closed with `EINVAL`, not via a shell |

Use `t.mock.timers` cautiously. It does not affect `execFile`'s internal timeout, so keep fake runners promise-based.

## 8. Open risks summary

1. **Whether `pi.on` awaits async handlers is unknown.** It blocks all wiring; verify it first.
2. **Rules currently read git synchronously (unverified).** Migrating them without changing the sync API needs the lazy-getter context in section 2.
3. **Sync `check()` can't be timed out.** The ASYNC-04 wording must limit the timeout to the prefetch.
4. **Running git inside untrusted repos can execute code.** Use an absolute git path, `core.fsmonitor=false` and `--no-optional-locks`.
5. **Node version.** `AbortSignal.any` needs Node 20.3+, and the `.cmd` `EINVAL` behaviour needs the 2024-04 patch releases. Check with `node -v` before planning.

**Process note:** your CLAUDE.md requires design and pattern questions to go through multi-model `/gsd:cross-research`. This was one model's research, and the decisions in sections 2 and 5 should be cross-checked that way before planning commits to them.


---

## Sonnet5 Research (claude-sonnet-5-5[1m])

# Phase 8 research: async block rules (ASYNC-01..04, TEST-01)

I did not inspect the repo. The working directory is an empty scratch checkout, so nothing here is verified against `tool-blockers.ts`, `git-query.ts`, or the Pi runtime. Items marked **VERIFY** are assumptions to check before planning.

## 1. Biggest design risk: "per-rule timeout" on sync rules

Once facts are gathered, rules run synchronously. No timer can preempt a sync function, because the event loop is blocked. So a per-rule timeout can't be applied to rule execution. The only things that can time out are the git fact fetches.

**Recommendation:** implement ASYNC-04 as a per-fact timeout plus an overall gather deadline. Each rule declares a failure policy for missing facts.

```ts
type Fact<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "aborted" | "error" | "overflow"; error?: Error };

interface BlockRule {
  name: string;
  needs?: readonly GitFactKey[];          // e.g. ["branch","dirtyFiles"]
  onFactFailure?: "fail-closed" | "fail-open";  // default: explicit, see below
  check(ctx: Readonly<RuleContext>): BlockResult | undefined;
}
```

- **fail-closed:** return a synthetic `BlockResult` such as `"rule X: git fact 'branch' unavailable (timeout 2000ms)"`.
- **fail-open:** skip that rule and log telemetry.
- **Default:** fail-closed for rules that guard destructive actions (protected branch, force-push). Fail-open for advisory rules. Require the policy to be set explicitly on every rule, and add a test that enumerates `ALL_RULES` to enforce it.
- Facts should be a discriminated union (`Fact<T>`) in the frozen context. A rule can then tell "no changes" from "couldn't ask git".
- Do not try a `Promise.race` timeout around sync rule execution. It adds nothing and misleads readers.

## 2. Inventory which rules use git (do this first)

Rules are "pure sync", but `git-query.ts` uses `execFileSync`. Any rule that calls it directly would block the event loop inside the "sync" phase and defeat the whole point.

- Grep `ALL_RULES` for imports from `git-query`.
- Refactor those rules to read `ctx.git.<fact>` instead of calling git.
- The sync `evaluateBlockRules` path must keep working. Either:
  - its context builder keeps populating facts via the sync `git-query` calls (unchanged behavior), or
  - rules keep a fallback call that the async path never hits.
- Prefer a `needs` declaration, so only the facts that the registered rules need are fetched. Fetching everything on every `tool_call` costs 1–N process spawns per tool call. Windows spawn is about 20–60 ms each.
- Also skip the gather entirely when no rule applies to the tool name. A `read` tool call shouldn't spawn git.
- Dedupe in-flight queries within one evaluation (`Map<key, Promise>`). Don't keep a cross-call cache, because it goes stale.

## 3. Async git runner: exact pattern (ASYNC-03)

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

async function runGit(args: string[], { cwd, signal, timeoutMs = 2000, maxBuffer = 1 << 20 } = {}) {
  signal?.throwIfAborted();                 // avoid spawn+kill if already aborted
  try {
    const { stdout } = await execFileP("git", ["--no-pager", ...args], {
      cwd, signal, timeout: timeoutMs, maxBuffer,
      windowsHide: true, shell: false, encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return stdout;
  } catch (e: any) {
    // classify below
  }
}
```

**Error classification** (these are the actual Node shapes):

| Cause | Shape |
|---|---|
| AbortSignal fired | `e.name === "AbortError"`, `e.code === "ABORT_ERR"` |
| `timeout` elapsed | `e.killed === true`, `e.signal === "SIGTERM"`, `e.code === null` |
| `maxBuffer` exceeded | `e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`. The child is killed and stdout is truncated, so never treat the partial output as valid. |
| git exits non-zero | `typeof e.code === "number"`, with `e.stderr` |
| git not found | `e.code === "ENOENT"` |

**Gotchas**
- **CVE-2024-27980 class:** Node ≥ 18.20.2 / 20.12.2 / 21.7.3 refuses to spawn `.bat` or `.cmd` files without `shell: true`, and throws `EINVAL`. `execFile("git")` resolves `git.exe` through PATH. A `git.cmd` shim would break, which is the failure mode to expect. Never "fix" it with `shell: true`. A test can assert `shell` is `false`/unset by injecting the exec function.
- **Combining abort sources:** use `AbortSignal.any([callerSignal, AbortSignal.timeout(totalMs)])`. It needs Node ≥ 20.3. **VERIFY** `engines` and the Pi runtime's Node version. `AbortSignal.timeout` timers are unref'd, so they don't hold the process open.
- **Windows kill semantics:** `timeout` and `abort` terminate only the direct child. Grandchildren (credential helpers, `git-remote-*`, fsmonitor daemons) can survive. The read-only queries here (`rev-parse`, `status`, `diff --name-only`) shouldn't spawn these. Using `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0` reduces the risk. Don't build taskkill tree-kill unless a test shows leaks.
- **Use `Promise.allSettled`, not `Promise.all`,** for the parallel gather. Otherwise the losing rejections become unhandled-rejection warnings (a crash under `--unhandled-rejections=strict`). Use one shared `AbortController`. For a fail-closed fact failure, abort the sibling queries early.
- **Parsing:** use `-z` with NUL-separated output for paths. Add `-c core.quotepath=off` if you parse non-`-z` output.
- **Untrusted repos:** git reads repo-local config such as `core.fsmonitor` and `core.sshCommand`. This is the same exposure as the existing sync wrapper, so it's out of scope. Note it, and mirror whatever `git-query.ts` does for env and `-c` flags.

## 4. Sync API guard (ASYNC-02)

```ts
function isThenable(v: unknown): v is PromiseLike<unknown> {
  return v != null && (typeof v === "object" || typeof v === "function")
    && typeof (v as any).then === "function";
}
// in evaluateBlockRules loop:
const r = rule.check(ctx);
if (isThenable(r)) {
  Promise.resolve(r).catch(() => {});   // prevent unhandled rejection from the discarded promise
  throw new TypeError(`Block rule "${rule.name}" returned a thenable; use evaluateBlockRulesAsync`);
}
```

- Share one helper between the sync and async paths. The async path also runs sync rules only (ASYNC-01), so it should throw the same `TypeError` for thenables.
- The `.catch` noop matters. Without it, an `async` rule that rejects yields an unhandled rejection in addition to the `TypeError`.
- Detecting `AsyncFunction` by constructor name is unreliable (transpiled or wrapped functions). Check return values instead.
- Short-circuit: both paths evaluate rules in `ALL_RULES` order and stop at the first block. The async path pays for the gather up front, which `needs` mitigates.
- Deep-freeze the context before running rules (`Object.freeze` on the context, the facts, and arrays). Add a test that a rule mutating the context throws in strict mode (ESM is strict).

## 5. `pi.on("tool_call")` async support (**VERIFY, blocking**)

I can't confirm from here that the Pi runner awaits async `tool_call` handlers and honors a `{ block: true, reason }` returned from a Promise. Read the Pi extension runner source before planning. Specifically check:

1. Whether handlers are awaited and the return value is read after resolution.
2. What happens when a handler throws or rejects: does it block the call, allow it, or crash the session? Wrap the handler body in try/catch and apply the explicit fail-open/fail-closed policy yourself rather than relying on the runner.
3. Whether parallel tool calls in one assistant turn run handlers concurrently. If so, the per-evaluation context and in-flight map must not be module-global mutable state.
4. Whether the handler receives an abort signal for session cancel or tool abort. If it does, thread it into the gather.

If (1) is false, this phase can't ship the handler wiring. Scope it as a library change only and file the gap.

## 6. Telemetry (Phase 7 integration)

- Add `evaluateBlockRulesAsyncInstrumented`, or an options hook. Record gather time and rule-eval time separately with `performance.now()`.
- Per-fact outcomes (ok / timeout / aborted / error / overflow) are useful telemetry fields.
- **Expectation:** async won't necessarily lower latency against the Phase 7 sync baseline. Parallel spawns can win on wall-clock, but the main benefit is not blocking the event loop. Frame the success metric as "event-loop max block time" or "p95 total with N facts in parallel". Don't claim "faster than sync" without data.

## 7. Testing (TEST-01, `node:test`, co-located `.test.mjs`)

**VERIFY** how `.test.mjs` imports the `.ts` modules (strip-types, tsx, or a compiled output). Follow the existing co-located tests.

Make the runner injectable (`runGit` or `execFile` as a parameter or a context field). Most edge cases can then use fakes and need no real git.

Edge cases to cover:
- **Sync guard:** rule returns a Promise → `TypeError`, with no unhandled rejection. Also cover a rule returning a custom `{ then(){} }`, an `async` rule, an object with a non-function `then` (allowed), and `undefined`.
- **Order and short-circuit:** later rules aren't invoked after the first block, in both sync and async paths.
- **Frozen context:** a mutation attempt throws.
- **Timeout:** an injected runner that never resolves, with a short real timeout (50–100 ms). `mock.timers` doesn't mock `AbortSignal.timeout`, so use real short timers or inject the signal. Assert it settles within bounds.
- **Abort:** a pre-aborted signal means no spawn (the fake runner is never called). An abort mid-flight rejects with `AbortError`.
- **Policy:** a fail-closed rule yields a block with a reason. A fail-open rule is skipped. Test both on the same fact failure.
- **Partial failure:** one fact fails and the others succeed. Rules that don't need the failed fact still run normally.
- **maxBuffer overflow:** treated as a failure, not as partial data.
- **No-git environment:** `ENOENT` classification, and a non-repo cwd (git exit 128).
- **Real-process smoke test** (one test, skippable if git is missing): spawn `process.execPath -e "setTimeout(()=>{},60000)"` through the real runner with a 100 ms timeout. Assert rejection, `killed === true`, and that the pid is gone afterwards.
- **Option assertions:** the captured `execFile` options contain `windowsHide: true`, `signal`, `timeout`, `maxBuffer`, and no `shell: true`.
- **Concurrency:** two simultaneous evaluations don't share state or cached facts.
- **Windows path:** a cwd with spaces. Run at least once on Windows, since that's the target platform.

## 8. Risks and gaps to file

1. The `pi.on("tool_call")` async contract is unverified (section 5). It is blocking for wiring.
2. Rules that call sync `git-query` internally need refactoring (section 2). The scope is unknown until the grep.
3. The per-rule timeout semantics in the requirement text are not implementable as literally written (section 1). Get the plan to restate ASYNC-04 as per-fact/gather timeout with a per-rule failure policy.
4. The Node version floor (`AbortSignal.any`, `throwIfAborted`) is unchecked.
5. Windows grandchild-process survival after timeout is an accepted residual risk, covered by the smoke test only for the direct child.


---

## Gpt Research (gpt-6.1-sol)

Architecture review based solely on the supplied material. These are planning findings; no implementation was provided.

### 1. MEDIUM — Define which work a per-rule timeout can interrupt

**Locations:** `lib/extensions/tool-blockers.ts` — `BlockRule`, `evaluateBlockRulesAsync(...)`; `lib/git-query.ts` — planned async queries.

ASYNC-04 needs a clearer execution boundary. A timer or `Promise.race` cannot interrupt synchronous JavaScript running on the same event loop. If a rule blocks for five seconds, a configured 100 ms timer runs only after that rule returns. An `AbortSignal` can cancel a child query but cannot preempt the rule itself. Implement one deadline and `AbortController` for each rule’s asynchronous fact collection, and carry timeout outcomes into the synchronous decision stage. Explicitly define that as the timeout boundary. If ASYNC-04 requires a hard execution limit on synchronous rules too, execute those rules in a worker that the evaluator can terminate.

The subprocess pattern should include every required option:

```ts
const execFileAsync = promisify(execFile);

const { stdout } = await execFileAsync("git.exe", args, {
  cwd,
  encoding: "utf8",
  signal: controller.signal,
  timeout: remainingMs,
  maxBuffer: MAX_GIT_OUTPUT_BYTES,
  windowsHide: true,
  shell: false,
});
```

Use the remaining deadline across a rule’s queries; restarting the full timeout for every query does not enforce a per-rule budget.

### 2. MEDIUM — Preserve short-circuit behavior when prefetching fails

**Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRulesAsync(...)`, `ALL_RULES`.

The supplied contract says evaluation stops at the first blocking rule. Eager collection introduces a failure case that needs an explicit design: rule A can block immediately, while a query needed only by later rule B times out. If gathering rejects globally, evaluation never returns A’s block. Conversely, converting query failures into empty values can let B interpret unavailable evidence as permission to proceed. Gather settled outcomes per dependency, then traverse `ALL_RULES` in its existing order. Apply a rule’s failure policy only when evaluation reaches that rule, and default missing policies explicitly rather than relying on truthiness.

Use a distinct outcome type so unavailable evidence cannot masquerade as successful empty output:

```ts
type Fact<T> =
  | { status: "ok"; value: T }
  | { status: "error"; error: Error };
```

For a reached rule with unavailable required facts, return a block under fail-closed policy; under fail-open policy, record the failure and continue.

### 3. MEDIUM — Specify how existing rules consume the frozen facts

**Locations:** `lib/extensions/tool-blockers.ts` — `BlockRule`, `evaluateBlockRulesAsync(...)`; `lib/git-query.ts` — existing synchronous wrapper. **UNVERIFIED-CONTRACT:** rule signatures and query call sites were not supplied.

The overview identifies the collection stage but does not establish the dependency boundary between existing rules and prefetched facts. If a missing prefetched value triggers a synchronous query fallback, the async path still blocks the event loop and can evaluate against repository state that changed after collection. Make required facts explicit for each rule, populate them before decision execution, and make missing facts in async evaluation produce the configured failure outcome. Fact lookup must never launch another query during that stage. Preserve the public synchronous entry point through a separate context construction path.

For snapshot integrity, freeze nested arrays and objects as well as the outer context; `Object.freeze(context)` alone does not prevent a rule from mutating a nested fact used by a later rule.

### 4. MEDIUM — Carry the awaited result through the hook and telemetry boundary

**Locations:** `extensions/index.ts` — `pi.on("tool_call")`; `lib/extensions/telemetry-collector.ts` — `evaluateBlockRulesInstrumented()`. **UNVERIFIED-CONTRACT:** neither the event dispatcher nor the instrumentation implementation was supplied.

The context correctly identifies async hook support as a prerequisite. If the dispatcher proceeds without awaiting the handler’s returned promise, the tool can execute before a blocking decision arrives. Instrumentation also needs an asynchronous boundary: timing only promise creation would report collection as nearly instantaneous and could miss later rejection. Once dispatcher support is established, return an async handler that awaits the complete evaluation, and add an async instrumentation entry point whose timing and error handling surround that await:

```ts
const started = performance.now();
try {
  return await evaluateBlockRulesAsync(/* existing inputs */);
} finally {
  recordDuration(performance.now() - started);
}
```

Add an integration test that holds collection pending and proves the tool has not executed, then resolves a blocking result and proves execution remains prevented. If the dispatcher cannot await handlers, retain synchronous enforcement until an awaited dispatch boundary is implemented.

---

## Gpt6 Research (gpt-6-astra)

These are architecture findings based solely on the supplied material. References use module and API names because no source code or line numbers were provided.

1. **MEDIUM — Synchronous rule execution cannot enforce an asynchronous timeout.**  
   **Location:** `lib/extensions/tool-blockers.ts` — `BlockRule`, `evaluateBlockRules()`, and the planned `evaluateBlockRulesAsync()` integration. ASYNC-04 requires per-rule deadlines, while ASYNC-01 retains synchronous rule execution. If a rule blocks the event loop, a timer or `Promise.race()` cannot interrupt it; an `AbortSignal` cannot interrupt JavaScript execution either. Define whether the deadline covers fact acquisition or actual rule execution. For fact-acquisition deadlines, abort the associated `execFile` operation and apply the rule’s failure policy. For literal rule-execution deadlines, execute rules in workers selected by rule identifier and terminate the worker from the parent on timeout. Add a co-located test using a deliberately blocking rule; a delayed promise alone does not test this failure.

2. **MEDIUM — Eager collection needs failure handling that preserves rule order.**  
   **Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()` and the planned `evaluateBlockRulesAsync()` integration. The supplied contract says evaluation short-circuits on the first block. If rule A would block immediately but a git query needed only by later rule B fails, a fail-fast collection step can reject before A runs. Applying B’s fail-open policy globally can likewise bypass A’s block. Store collection failures as explicit fact outcomes, then inspect each rule’s dependencies in the existing rule order. Apply that rule’s declared failure policy only when evaluation reaches it. Establish an explicit dependency mapping so a shared query failure can receive different policies for different rules.

   A suitable proposed representation is:

   ```ts
   type FactOutcome<T> =
     | { kind: "value"; value: T }
     | { kind: "failure"; error: unknown };
   ```

   Freeze these outcomes with the evaluation context. Test that an earlier blocking rule still wins when a later rule’s dependency rejects, and that a failed query never becomes a successful empty result.

3. **MEDIUM — Throwing on a thenable also requires handling its eventual rejection.**  
   **Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()`. ASYNC-02 requires a synchronous `TypeError` when a rule returns a thenable. An accidentally declared `async` rule can return an already-rejected promise. Throwing the required `TypeError` leaves that rejection unhandled, potentially producing an additional process-level failure even when the caller catches the contract error. Detect thenables immediately after invoking each rule, before interpreting or returning its result; attach rejection reporting before throwing. Check callable thenables as well as ordinary objects.

   ```ts
   const result = rule(context);
   const isThenable =
     result !== null &&
     (typeof result === "object" || typeof result === "function") &&
     typeof result.then === "function";

   if (isThenable) {
     // reportRuleError must be a non-throwing diagnostic sink.
     void Promise.resolve(result).catch(reportRuleError);
     throw new TypeError("Block rules must return synchronously");
   }
   ```

   Keep this guard in the shared synchronous evaluation path so both entry points enforce it. Add tests for a rejected promise, a callable thenable, and a thenable that resolves to a blocking result; all must produce the synchronous contract error.

The supplied material does not establish whether `pi.on("tool_call")` awaits callback promises or how it handles callback rejection. That integration contract remains **UNVERIFIED-CONTRACT**.

---

## Cross-Model Notes

Review the sections above for agreements and disagreements across models.
The cross-AI research review (step 5.4) will verify accuracy and flag concerns.

---

*Research completed via parallel multi-model research*
