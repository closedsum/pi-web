# Phase 07: Block Rule Telemetry — Research

**Researched:** 2026-10-15
**Method:** Parallel multi-model research (Claude (Explore) + MiniMax-M3 + gpt-6.1-sol + claude-opus-5-5[1m] + claude-sonnet-5-5[1m] + gpt-6-astra + qwen3.8-max)
**Requirements:** TEL-01,TEL-02,TEL-03,TEL-04,TEL-05,TEST-01,TEST-03

## Research Approach

| Track | Model | Status | Time |
|-------|-------|--------|------|
| local | Claude (Explore) | ok | — |
| minimax | MiniMax-M3 | ok | 15.9s |
| gpt | gpt-6.1-sol | ok | 57.9s |
| opus55 | claude-opus-5-5[1m] | ok | 58.0s |
| sonnet5 | claude-sonnet-5-5[1m] | ok | 66.4s |
| gpt6 | gpt-6-astra | ok | 81.1s |
| qwen38 | qwen3.8-max | ok | 89.1s |

---

## Local Codebase Analysis (Claude)

## 1. tool-blockers.ts — Evaluation Pipeline

**BlockRule type (L12–15):** `{ name: string; test: (toolName, input, ctx?) => BlockResult | undefined }`
**BlockRuleContext (types.ts L17–22):** `{ cwd, isSubagent, sessionId?, stateHome }`
**BlockResult (types.ts L11–15):** `{ block: true; reason: string; terminate?: boolean }`

**ALL_RULES registry (L328–352):** Array of 23 named BlockRule objects.

**evaluateBlockRules (L358–369):**
```ts
export function evaluateBlockRules(toolName, input, rules = ALL_RULES, ctx?): BlockResult | undefined {
  for (const rule of rules) {
    const result = rule.test(toolName, input, ctx);
    if (result) return result;  // short-circuit on first block
  }
  return undefined;
}
```

## 2. Existing Timing Infrastructure

**Already in lib/extensions/index.ts (L75–91):**
- `evaluateBlockRules` is already timed (aggregate, not per-rule)
- `onTiming` callback exposed via `GsdExtensionOptions.onTiming?: (timing: ExtensionTiming) => void`
- `ExtensionTiming` type: `{ event, handlerName, durationMs, blocked, timestamp }`
- Currently NOT wired in rpc-manager.ts

**Key insight:** Timing infra exists but is coarse-grained. Phase 7 needs per-rule wrapping inside the evaluateBlockRules loop.

## 3. State Home + Atomic Writes

- `resolveStateHome()` returns `~/.gsd` or `GSD_STATE_HOME`
- No atomic write pattern in existing Node code — Python side uses os.replace
- For telemetry: writeFileSync to temp + renameSync to target

## 4. Session Lifecycle Pattern

- `lib/extensions/session-lifecycle.ts` has `sessionMetrics` tracking session duration, fork count, dispatch count
- `SessionState`: `{ startTime, sessionId, forkCount, dispatchCount }` per-session mutable state
- Pattern for Phase 7: per-session TelemetryCollector following same session-scoped state pattern

## 5. Integration Points

- `createGsdExtension()` in `lib/extensions/index.ts` L76 calls `evaluateBlockRules`
- `rpc-manager.ts` L2580 calls `createGsdExtension()` with no options
- Block rules configurable via `GsdExtensionOptions.blockRules`
- Instrumented rules can replace the array or wrap individual rule.test() calls

## Architecture for Phase 7

1. Wrap individual rules (not just aggregate) — around each rule.test() in the loop
2. Track per-rule: timing, block count, allow count, skip count
3. Snapshot path: `{stateHome}/telemetry/`
4. Atomic writes: writeFileSync to temp + renameSync
5. Wire via createGsdExtension option (e.g., enableTelemetry: boolean)
6. Never affect verdicts (TEL-04)


---

## Minimax Research (MiniMax-M3)

# Research Findings: Block Rule Telemetry (Phase 7)

## 1. High-Resolution Timing in Node.js

Use `process.hrtime.bigint()` for nanosecond-precision monotonic timing. Avoid `Date.now()` or `performance.now()` because:

- `Date.now()` is wall-clock and can jump backward (NTP, manual clock changes), producing negative durations.
- `performance.now()` exists in Node 16+, but its origin is process-start relative, and many existing helpers in this codebase likely use `process.hrtime.bigint()` — check `lib/` for the existing convention before introducing a second timing primitive.

```javascript
const start = process.hrtime.bigint();
// ... rule runs ...
const elapsedNs = process.hrtime.bigint() - start;
```

**Gotcha:** `process.hrtime.bigint()` returns `bigint`, not `number`. Arithmetic on bigints produces bigints; never mix with `Number`. If a snapshot schema wants a plain number, convert explicitly with `Number(elapsedNs)` — but mind `Number.MAX_SAFE_INTEGER` (~9e15 ns ≈ 104 days), which is fine for per-rule timing.

## 2. Atomic Snapshot Writes (Reusing `lib/lock-schema.ts` Pattern)

The Phase 5 atomic-write pattern is the right base: write to `{target}.tmp`, `fsync` the file descriptor, then `rename` to the final path. `rename` on POSIX is atomic; on Windows it fails if the target exists, so use `fs.rename` with a `try/catch` + `fs.rmSync` fallback, or rely on a pre-existing helper.

**Concrete pattern for snapshots:**
```javascript
function writeSnapshotAtomic(path, payload) {
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);  // 0o600 — never world-readable
  try {
    fs.writeSync(fd, JSON.stringify(payload));
    fs.fsyncSync(fd);                       // durable across power loss
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, path);                  // atomic on POSIX
}
```

**Risks:**
- **Concurrent writers across processes:** if two sessions race, both write `.tmp` with the same `pid` suffix — collision. Use `crypto.randomUUID()` or `fs.mkstempSync()` instead of `pid`.
- **Cleanup of orphan `.tmp` files** on startup if a previous process crashed mid-write.
- **Debounce contract:** "debounced" is unspecified in TEL-03. A reasonable default is 250 ms trailing debounce per session key, with a final flush on session end / process exit. Without an `exit` flush hook, the last batch of telemetry is lost — register a `process.on('exit')` handler.

## 3. Decorator Pattern for Rule Wrapping (TEL-01, TEL-02)

Decorating at **registration time** (when BlockRules are passed into the pipeline) is correct — it satisfies TEL-01 and lets the wrapper know rule identity up front. Decorating inside `evaluateBlockRules()` would couple telemetry to the evaluation function.

**Recommended shape:**
```javascript
function instrumentedRule(rule, collector) {
  return (ctx) => {
    const start = process.hrtime.bigint();
    try {
      const result = rule(ctx);
      const elapsedNs = process.hrtime.bigint() - start;
      collector.record({ ruleId: rule.id, elapsedNs, blocked: result.blocked });
      return result;
    } catch (err) {
      collector.record({ ruleId: rule.id, error: true });  // counts as invoked
      throw err;                                            // do NOT swallow
    }
  };
}
```

**TEL-02 enforcement:** Only rules that the wrapper actually calls get recorded. If `evaluateBlockRules()` short-circuits before reaching rule N, rule N's wrapper is never invoked, so `record()` is never called. The decorator pattern naturally satisfies this — no extra logic needed. **Verify** this by reading `evaluateBlockRules()` to confirm short-circuiting prevents the wrapper from running.

**Wrapping overhead:** Each rule now incurs ~2 bigint reads + an object allocation + a counter increment. Measure on a 100-rule suite — should be sub-microsecond per rule. If hot-path cost matters, batch increments into a per-session array flushed on snapshot.

## 4. Data Sanitization Boundary (TEL-05)

TEL-05 forbids raw tool arguments, command strings, and absolute paths in telemetry output. The cleanest enforcement is a **sanitize-at-write boundary**: rules and the collector never see raw values, or — more practically — only `ruleId`, counts, and `elapsedNs` are recorded. Rule context (`ctx`) is never passed to `collector.record()`.

**Risk:** A rule that captures its input into a closure-scope variable (e.g., for logging) can leak that into a thrown error's message, which the wrapper might record. The wrapper above records only `error: true` — it does not record the error object. If a future change records `error.message`, it could include the offending command string. **Guard explicitly:**

```javascript
// DO NOT do this — leaks args:
collector.record({ ruleId, error: err.message });

// DO this:
collector.record({ ruleId, error: true });
```

## 5. Failure Isolation (TEL-04)

Telemetry must never alter authorization decisions. Failure modes to guard:

| Failure | Impact on auth | Mitigation |
|---|---|---|
| Collector throws during `record()` | Rule exception propagates → auth fails closed (wrong) | Wrap `record()` body in `try { ... } catch { /* swallow */ }` |
| Snapshot write fails (disk full, perms) | None if async; if sync, blocks evaluation | Write snapshots **off the hot path** — debounced, on a timer or `setImmediate` |
| Decorator itself throws | Same as above | Wrap the entire decorator body; only re-throw the original rule's exception |
| `process.hrtime.bigint()` throws | Shouldn't, but defensive `try/finally` is cheap | n/a — low risk |

**Critical pattern:** The decorator must distinguish "rule threw" (re-throw) from "telemetry threw" (swallow). Use two try blocks:

```javascript
let result, threw = null;
const start = process.hrtime.bigint();
try {
  result = rule(ctx);
} catch (err) {
  threw = err;
}
const elapsedNs = process.hrtime.bigint() - start;
try { collector.record({ ruleId: rule.id, elapsedNs, blocked: !threw && result.blocked }); } catch {}
if (threw) throw threw;
return result;
```

## 6. Concurrency & Session Isolation (TEST-03)

Per-session collectors are inherently isolated if each session holds its own collector instance. **Snapshot isolation** in TEST-03 likely means: a concurrent reader sees a consistent snapshot, not a torn write. The atomic-rename pattern from §2 guarantees this — readers either see the old snapshot or the new one, never a partial.

**Concurrent-session test design:**
- Spawn N (e.g., 16) workers each invoking M rules with overlapping rule IDs.
- After all complete, assert each session's snapshot contains only its own session ID.
- Assert that totals across sessions sum to the total invoked count (i.e., no rule was double-counted into multiple sessions).
- Assert that the snapshot file was rewritten at least K times (or use a version counter to verify readers never observed a partial state).

**Reader concurrency:** If the API reads snapshots while writers write, atomic-rename is sufficient. If a reader holds a parsed JSON object while the writer replaces the file, the reader's object is unaffected — but the next read sees the new file. No locking required for the snapshot file itself.

## 7. Test Module Layout (TEST-01)

Co-located `.test.mjs` per new module. Suggested modules:

| Module | Test file |
|---|---|
| `lib/telemetry/collector.ts` | `lib/telemetry/collector.test.mjs` |
| `lib/telemetry/decorator.ts` | `lib/telemetry/decorator.test.mjs` |
| `lib/telemetry/snapshot.ts` | `lib/telemetry/snapshot.test.mjs` |

Edge cases each must cover:
- **Collector:** empty session, rule that throws, rule that returns non-block, rule that short-circuits the chain (TEL-02).
- **Decorator:** wrapper overhead is bounded; failed telemetry never affects return value; `error: true` recorded on rule throw.
- **Snapshot:** atomic write under simulated crash (kill mid-write, assert no torn file on next read); debounce coalesces N rapid writes into 1; orphan `.tmp` cleanup; perms are `0o600`.

## 8. Phase 8 Consumer Contract

Phase 8 will consume the baseline for async comparison. **Before locking the snapshot schema**, define what Phase 8 needs:

- Per-rule: `invocations`, `blocks`, `totalNs`, `maxNs` (at minimum).
- Per-session: `sessionId`, `startedAt`, `endedAt`, `ruleStats`.
- Optional: `p50Ns`, `p95Ns` if percentiles are needed — these require either reservoir sampling or full retention, which has memory cost. **Ask before adding.**

A versioned schema field (e.g., `schemaVersion: 1`) in the snapshot avoids Phase 8 migrations on Phase 7's format. Cheap to add now, expensive to retrofit.

## 9. Risks & Open Questions

1. **Debounce semantics unspecified in TEL-03.** Recommend 250 ms trailing debounce + flush on session end + flush on `process.exit`. Confirm before implementing.
2. **Snapshot file location** — TEL-03 says "API reads them" but does not pin the path. Reuse `resolveStateHome()` from `lib/state-home.ts`. Path: `{stateHome}/telemetry/{sessionId}.json`.
3. **Retention policy** — how long are snapshots kept? Without one, telemetry fills disk over time. Out of scope for Phase 7, but flag for Phase 8+.
4. **Sanitization audit** — TEL-05 lists three forbidden categories. Are there others (e.g., user IDs, hostnames, env var values in rule context)? Confirm before shipping.
5. **`fs.fsyncSync` on every snapshot** is correct for durability but can be 1-10 ms on slow disks. Combined with debounce, this is fine. If debounce is removed, revisit.
6. **Windows `fs.rename` over existing file** — verify the existing `lib/lock-schema.ts` helper handles this. If not, Phase 7 inherits the same bug.

## 10. Implementation Order (Suggested)

1. Define snapshot schema + `schemaVersion`.
2. Build `collector.ts` (in-memory counters, `record()`, `snapshot()`).
3. Build `decorator.ts` (wraps a rule, isolates failures).
4. Build `snapshot.ts` (atomic write, debounce, exit-flush).
5. Wire into `evaluateBlockRules()` registration path.
6. Tests, including the concurrent-session suite from §6.

This order keeps each step independently testable and avoids rewriting the decorator when the snapshot shape changes.

---

## Gpt Research (gpt-6.1-sol)

The material contains an architecture outline rather than a source diff. These are implementation risks to resolve during planning; locations reference the supplied module and symbols.

### 1. MEDIUM — Instrument individual rule invocations

**Location:** `lib/extensions/tool-blockers.ts` — `BlockRule` registration and `evaluateBlockRules()`.

The integration notes mention wrapping `evaluateBlockRules()`, but timing the complete evaluator cannot establish which rules ran or how long each took. When the first rule blocks, recording every registered rule would violate **TEL-02** by counting skipped rules. Decorate each rule at registration, increment its invocation count inside the wrapper, and measure that invocation only. Preserve registration order and the existing short-circuit behavior. Test a first-rule block and assert that subsequent rules have zero invocations.

### 2. MEDIUM — Protect the complete instrumentation boundary

**Location:** `lib/extensions/tool-blockers.ts` — rule decorators used by `evaluateBlockRules()`.

Under **TEL-04**, a telemetry exception must never replace a rule’s decision or exception. For example, recording statistics after a blocking result could throw and prevent that result from reaching the caller. Isolate timing, aggregation, scheduling, and persistence failures from rule execution. Preserve the original result or exception, and report telemetry failures through a bounded, sanitized diagnostic path. Inject failures before and after rule execution and assert identical authorization outcomes and exactly one rule invocation.

### 3. MEDIUM — Bind collectors and snapshot destinations to sessions

**Location:** `lib/extensions/tool-blockers.ts` — registration lifecycle; `lib/state-home.ts` — `resolveStateHome()` integration.

The outline specifies per-session telemetry but does not define collector ownership or destination naming. If shared rule wrappers capture one collector, or every session writes the same snapshot filename, overlapping sessions can combine counts or overwrite each other despite atomic writes. Create one collector per session, bind wrappers to that collector, and use an opaque session identifier for a separate snapshot destination. Ensure API reads select the same session. Test two interleaved sessions with different counts and assert isolation in both memory and persisted snapshots.

### 4. MEDIUM — Specify snapshot ordering and bounded debounce

**Location:** `lib/extensions/tool-blockers.ts` — snapshot scheduling from rule evaluation; `lib/lock-schema.ts` — referenced temporary-file-and-rename pattern.

Atomic replacement alone does not establish write ordering. If two flushes overlap, an older snapshot can finish last and replace newer counters. A trailing debounce that resets indefinitely can also prevent snapshots during sustained activity. Serialize writes per session, copy counters into an immutable snapshot before writing, use unique temporary filenames, and retain the latest pending generation while a write runs. Add a maximum flush interval and a session-close flush. Test delayed, out-of-order write completion and continuous activity with a controlled clock.

### 5. MEDIUM — Enforce privacy through an explicit output schema

**Location:** `lib/extensions/tool-blockers.ts` — rule result/context handling and telemetry serialization.

**TEL-05** cannot be guaranteed without defining permitted persisted fields. Serializing a rule result, exception, or invocation context could expose a command or absolute path during an ordinary blocked invocation. Build records explicitly from constant rule identifiers and numeric aggregates; exclude rule inputs, result messages, exception messages, and stacks. For example:

```json
{
  "ruleId": "stable-rule-id",
  "invocations": 12,
  "blocks": 3,
  "totalDurationMs": 4.8
}
```

Use inputs and errors containing sentinel commands and absolute paths, then assert those values never appear in snapshots, API responses, or telemetry diagnostics. Give each new telemetry module a co-located `.test.mjs` covering its relevant failure and isolation cases, as required by **TEST-01** and **TEST-03**.

---

## Opus55 Research (claude-opus-5-5[1m])

# Phase 7 Research: Block Rule Telemetry

**Note on evidence:** The scratch working directory (`gsd-review-scratch-77640`) does not contain the source. A repo-wide search for `evaluateBlockRules`, `BlockRule`, `renameSync` and `resolveStateHome` found nothing. Every statement below about `tool-blockers.ts`, `state-home.ts` and `lock-schema.ts` comes from the phase context only and is marked **UNVERIFIED**. The planner has to confirm those signatures before planning against them.

---

## 1. Where to instrument (TEL-01, TEL-02)

**Recommendation:** wrap each rule once, when it is registered, instead of timing the whole `evaluateBlockRules()` loop.

```ts
// lib/extensions/rule-telemetry.ts
export interface RuleStats { invocations: number; blocks: number; errors: number;
  totalNs: bigint; maxNs: bigint; buckets: number[] } // fixed histogram

export function instrumentRule(name: string, rule: BlockRule, c: TelemetryCollector): BlockRule {
  const wrapped = (ctx) => {
    const t0 = process.hrtime.bigint();
    let result;
    try { result = rule(ctx); }
    finally {
      try { c.record(name, process.hrtime.bigint() - t0, isBlock(result)); } catch {}
    }
    return result;
  };
  Object.defineProperty(wrapped, 'name', { value: name });
  return wrapped;
}
```

- **TEL-02 comes for free:** the evaluator stops at the first block, so wrappers on rules after that point never run and never count. Test this explicitly: if rule 3 blocks, rules 4 to 23 must show `invocations === 0`.
- **Rule identity:** don't rely on `fn.name`. Minifiers and arrow functions bound to `const` can produce `""` or duplicate names. Pass an explicit stable ID at registration. If the 23 rules are an array literal, change it to `[id, fn]` tuples or a `Record<string, BlockRule>`.
- **Clock:** use `process.hrtime.bigint()`, not `Date.now()`. Most rules finish in under a millisecond, so `Date.now()` would report 0. Convert to numbers (µs) at snapshot time, because `JSON.stringify` throws on BigInt. That is a real crash path if missed.
- **Pending decision:** this pattern only works if `BlockRule` is synchronous today. It is assumed to be, since Phase 8 is the async conversion. Make the wrapper ready for Phase 8 now: if the result is thenable, record in `.finally`. Otherwise Phase 8's baseline comparison will silently measure only how long it takes to create the promise.

## 2. Per-session isolation (TEST-03)

- Keep a `Map<sessionId, TelemetryCollector>`. Never use a module-level singleton counter: one Node process can serve several sessions, and a shared counter would mix them up.
- Wrapping "at registration" can conflict with "per session" if rules are registered once per process. Pick one of these:
  - (a) Register per session. Clean, but depends on how extensions load. **UNVERIFIED.**
  - (b) Wrap once, and have the wrapper look up the collector from `ctx.sessionId` (or from `AsyncLocalStorage` once Phase 8 makes things async).
  - **Recommend (b)** with an explicit `ctx.sessionId` argument. Unlike AsyncLocalStorage, it keeps working across the sync-to-async change.
- **Session ID in file paths:** sanitize to `[A-Za-z0-9_-]{1,64}` or hash it with SHA-256 and keep 16 hex characters. This blocks path traversal (`../`) and reserved Windows names (`CON`, `NUL`).
- **Memory:** evict a collector on session end. Also add an LRU cap (for example 64 sessions) so a crashed session can't leak.

## 3. Atomic, debounced snapshots (TEL-03)

```ts
const tmp = `${final}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
await fs.writeFile(tmp, JSON.stringify(snap), { flag: 'wx' });
await renameWithRetry(tmp, final);   // retry EPERM/EBUSY/EACCES ×5, 10–50ms backoff
```

- **Windows risk (this machine is win32):** `rename` over an existing file fails with `EPERM`/`EBUSY` while another process has the target open. Antivirus scanners, the indexer and a concurrent API reader all do this. Retry with backoff, and on final failure delete the temp file and drop the snapshot. Don't throw (see TEL-04). Check whether the Phase 5 `lock-schema.ts` helper already retries before reusing it. **UNVERIFIED.**
- **Unique temp names:** two writers sharing one `.tmp` name will corrupt each other, so include pid and a random suffix.
- **Debounce:** trailing-edge timer, about 1 s, plus a max-wait of about 5 s so a busy session still flushes. Call `.unref()` on the timer so it never keeps a hook process alive.
- **Flush on exit:** debounced data is lost if the process exits first. Add a synchronous final flush (`writeFileSync` + `renameSync`) on `beforeExit` / session end. Hook processes may be short-lived, and if each one runs a single tool call, a debounce alone would never write anything. **Confirm the process lifetime before choosing the debounce design.**
- **Layout:** `{stateHome}/telemetry/block-rules/{sessionHash}.json`, one file per session. This keeps sessions isolated and avoids any cross-session write contention.
- **Schema:** `{ schemaVersion: 1, sessionHash, startedAt, updatedAt, rules: { [ruleId]: { invocations, blocks, errors, totalUs, maxUs, p50Us, p95Us } } }`. Version it from day one, because Phase 8 will compare against it.
- **API reader:** parse with try/catch. Treat a missing file as an empty snapshot, and treat `schemaVersion` mismatches or parse errors as "unavailable", not as a crash. Atomic rename means the reader should never see a half-written file, but defend against it anyway.

## 4. Fail-open for telemetry, never for authorization (TEL-04)

- Every telemetry call (`record`, `scheduleFlush`, the write itself) goes inside its own `try {} catch {}`. The rule's result or exception passes through the wrapper unchanged.
- **Pitfall:** if a rule throws, the wrapper must re-throw exactly what the evaluator would have seen without telemetry (the `finally` pattern above does this). Count the throw as `errors++`, not as a block.
- **Pitfall:** async write failures surface as unhandled promise rejections. Attach `.catch(() => {})` to every write promise. Node ≥15 terminates the process on an unhandled rejection by default, which would turn a telemetry failure into a missing authorization result.
- **Test:** inject a collector whose `record` throws and a writer that rejects. Assert that the decisions from `evaluateBlockRules` are deep-equal to a run without instrumentation, across all 23 rules.

## 5. Redaction (TEL-05)

- Record by design, not by filtering: the collector only accepts `(ruleId: string, ns: bigint, blocked: boolean, errored: boolean)`. It never sees `ctx`, block reasons or error messages, so leaking them is impossible.
- Don't store `err.message`. It often contains command strings or paths. Store only `err.name` or a counter.
- Hash the session ID (see section 2) so file contents and filenames contain no user paths.
- **Test:** run rules on a ctx full of sentinel strings (`"SECRET_CMD_rm -rf"`, `"C:\\Users\\x"`, `"/home/x"`). Assert the serialized snapshot has none of the sentinels and matches neither `/[A-Za-z]:\\/` nor `/\/(home|Users)\//`.

## 6. Test plan (TEST-01, TEST-03)

Use co-located `rule-telemetry.test.mjs` and `telemetry-snapshot.test.mjs` with the `node:test` runner. **UNVERIFIED** that this is the project runner; check `package.json`.

| Case | Assertion |
|---|---|
| Short-circuit | Rules after the blocking rule show 0 invocations |
| Rule throws | Error propagates unchanged; `errors` = 1, `blocks` = 0 |
| Collector throws | Decision is the same as without instrumentation |
| BigInt serialization | Snapshot round-trips through JSON |
| Concurrent sessions | Two collectors running interleaved calls via `Promise.all` keep separate counts and files |
| Concurrent writers, same file | 20 parallel flushes leave valid JSON and no leftover `.tmp` files |
| Debounce | Fake timers (`mock.timers.enable()`): N records produce 1 write; max-wait forces a write |
| Rename EPERM | Stubbed fs fails twice then succeeds, giving a retry and a final file; persistent failure means no throw and the temp file is removed |
| Path traversal | sessionId `../../x` stays inside the telemetry dir |
| Redaction | Sentinel scan (section 5) |

Use a temp `stateHome` per test (`fs.mkdtemp`) so tests stay isolated from each other.

## 7. Risks summary

1. **High:** process lifetime is unknown. A debounce without an exit flush can mean zero snapshots ever get written.
2. **High:** the BigInt `JSON.stringify` TypeError. If it isn't caught, it can break the evaluator.
3. **Medium:** Windows rename `EPERM` under concurrent readers.
4. **Medium:** per-process registration vs. per-session collection (resolve with the ctx lookup in section 2).
5. **Low:** wrapper overhead (`hrtime` costs about 50–100 ns per call). Measure an empty-rule baseline and subtract it, so Phase 8 comparisons aren't skewed.

## Open items for the planner

- Confirm the `BlockRule` signature and whether `ctx` carries a session ID.
- Confirm `lock-schema.ts` exposes a reusable atomic write with retry.
- Confirm the test runner and `.test.mjs` import paths against the compiled `.ts` output.
- Per the global CLAUDE.md, design choices like the debounce strategy and the registration model should go through `/gsd:cross-research`. This report is single-model.


---

## Sonnet5 Research (claude-sonnet-5-5[1m])

# Phase 7 Research: Block Rule Telemetry

**Caveat:** I did not read `tool-blockers.ts`, `state-home.ts` or `lock-schema.ts`. Everything below comes from the phase context and general Node/Windows behavior. Check each point marked **[verify]** against the real code before planning. I also made no edits, because plan mode is active.

## 1. Architecture

### Where to hook (TEL-01, TEL-02)
The context says the collector "decorates rules at registration". Decorating at registration is better than editing `evaluateBlockRules()` because the loop stays unchanged and short-circuit behavior is preserved. A wrapped rule is only timed when the loop actually calls it, and that is exactly what TEL-02 needs.

```ts
// lib/extensions/telemetry/block-rule-collector.ts
export function wrapRule(collector: Collector, name: string, rule: BlockRule): BlockRule {
  return (...args) => {
    const t0 = performance.now();          // monotonic; never Date.now()
    let result;
    try {
      result = rule(...args);              // rule exceptions MUST propagate unchanged
    } finally {
      safeRecord(collector, name, performance.now() - t0, /*blocked*/ undefined);
    }
    if (result) safeRecordBlock(collector, name);
    return result;
  };
}
```

- **Rule exceptions.** Whatever the unwrapped rule did (throw or fail-closed), the wrapper must do the same. Use `try/finally` for timing only, and don't `catch` around `rule()`.
- **Telemetry exceptions.** Every collector call goes through a `safeRecord` that has its own `try { … } catch {}` (TEL-04). The `catch` must not wrap the `rule()` call, otherwise a rule's own throw would be swallowed.
- **Block detection.** Don't assume a truthy return means "blocked". **[verify]** the `BlockRule` return type. It may be `{block: true, reason}`, `undefined`, or a string. The `reason` text may contain commands or paths, so never store it (see TEL-05 below).
- **Async readiness.** Phase 8 converts rules to async. Write the wrapper so it can later `await` the result without changing the collector API. Keep `record(name, durationMs, blocked)` synchronous and independent of the rule's sync/async shape.
- **Rule name source.** Use a stable explicit id passed at registration, not `fn.name`. Minification, arrow functions and anonymous rules make `fn.name` unreliable. Registration order is also fragile, so prefer an id.

### Per-session collector (TEL-01, TEST-03)
- Key by `sessionId` in a `Map<string, Collector>`, or give each session its own collector instance. Avoid module-level mutable counters shared across sessions. Concurrent-session tests (TEST-03) will fail on them.
- **[verify]** How sessions are identified (hook payload `session_id` vs pi extension context) and whether `evaluateBlockRules` can take a collector argument or needs a session-scoped rule list built at registration.
- Add a `dispose()` or TTL eviction. Otherwise the Map grows unbounded in long-lived processes.
- Per-rule stats: `{ invoked, blocked, totalMs, maxMs, minMs }`. Percentiles would need a histogram. For a baseline against Phase 8, I'd add a fixed-bucket histogram (for example buckets at 0.05/0.1/0.5/1/5/25 ms, then +Inf). It is cheap and mergeable, and a mean alone can hide tail latency. Keep a cap on the memory it uses.
- Also record `pipelineMs` and `evaluations` for the whole `evaluateBlockRules()` call (one outer timer), so Phase 8 can compare end-to-end.

### Counting semantics (TEL-02)
- `invoked` increments only when the wrapper is entered. Short-circuited rules never enter, so they stay at 0 or absent.
- Test this with a pipeline of [pass, block, pass] and assert that the third rule's `invoked` is 0.
- Rules that exist but were never invoked: either omit them from the snapshot or list them with `invoked: 0`. Pick one and document it. Omitting them is simpler and matches "only invoked rules are counted".

## 2. Snapshots (TEL-03)

### Atomic write
Reuse the Phase 5 temp+rename helper from `lock-schema.ts` if it is exported. **[verify]** If it is not generic, extract it into a shared util rather than duplicating it.

```ts
const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
await fs.writeFile(tmp, json, { mode: 0o600 });
await fs.rename(tmp, target);   // same directory => same volume
```

Windows gotchas, since this runs on Win11:
- `fs.rename` over an existing file can fail with `EPERM`/`EBUSY`/`EACCES` if a reader has the target open without `FILE_SHARE_DELETE`. Node's default read opens use share-delete, but antivirus or indexers can hold files briefly. Add a bounded retry (for example 3–5 tries with 10–50 ms backoff). If it still fails, drop the write silently and try again next flush (TEL-04). Check whether the Phase 5 helper already does this.
- The temp file must be in the same directory as the target, never in `os.tmpdir()`. Renaming across volumes fails with `EXDEV`.
- Use unique temp names per process and write. Two sessions or processes sharing a name will corrupt each other.
- `fsync` before the rename gives durability across a crash, but it is not needed for telemetry. Skip it to keep flushes cheap, and note the decision.
- Clean up orphaned `*.tmp` files on startup, or use a recognizable suffix so a sweeper can remove them.

### Debounce
- **Trailing debounce with a max-wait.** For example, 1–2 s after the last record, but always flush within 5–10 s of the first dirty mark. A pure trailing debounce never fires during a continuous stream of tool calls.
- Call `timer.unref()` so a pending flush doesn't keep the process alive.
- Flush on session end and on `process.on('exit')` / `beforeExit`. In `'exit'` handlers only synchronous work runs, so you need a `writeFileSync` + `renameSync` fallback path for the final flush.
- Serialize flushes per collector. If a write is in flight when the timer fires, mark dirty and run again afterward. Don't run two overlapping writes to the same session file.
- Expose an injectable clock/scheduler, or a `flushNow()` method, so tests don't need real timers. `node:test` supports `mock.timers`.
- Writes must be non-blocking for the authorization path. Never `await` a flush inside the rule evaluation path. Fire and forget with `.catch(() => {})`.

### Paths and isolation
- One file per session: `{stateHome}/telemetry/block-rules/<sessionId>.json`. Per-session files give snapshot isolation (TEST-03) and avoid read-modify-write races between sessions. A single shared file would need locking.
- **Sanitize `sessionId` before using it in a filename.** Allow `[A-Za-z0-9_-]` only, and cap the length, otherwise `..\` or reserved Windows names (`CON`, `NUL`) can break out of or break the directory. Hash it if it fails validation.
- Use `resolveStateHome()` from `state-home.ts`. **[verify]** whether it is sync, and what it does when the directory is missing. `mkdir({recursive:true})` before the first write.
- Include `schemaVersion` in the snapshot, matching the `lock-schema.ts` convention, so Phase 8 and the API can evolve it.
- Retention: decide whether stale session files get pruned (for example older than 7 days). Without that the directory grows forever. This could be deferred, but file it as a known gap.

### Reader / API
- The API reads files with `readFile` + `JSON.parse`. Since writes are atomic, readers see either the old or the new file, never a partial one.
- Reader must tolerate: missing file, empty or corrupt JSON (return `null` or an empty snapshot, don't throw), and unknown `schemaVersion`.
- Validate snapshots on read (a small schema check) because the files are on disk and could be hand-edited or truncated by a crash.
- Reading must not mutate collector state. Return plain data, not live references. `structuredClone` any in-memory snapshot you hand out.

## 3. Privacy (TEL-05)
This is the most likely requirement to be violated by accident.

- **Whitelist, not blacklist.** The snapshot schema holds only: rule id (a static string from the registry), counts, durations, a timestamp, a schema version, and the session id (or a hash of it). It never holds anything derived from the tool call.
- Never record `block.reason`, tool name arguments, matched strings, cwd, or error messages. Exception `.message` strings can contain paths (`ENOENT: … 'C:\Users\…'`), so for telemetry failures record only a counter such as `telemetryErrors`, not the message.
- The state-home path is itself an absolute path. Don't embed it in the snapshot. Use a relative or logical name.
- Rule ids must come from a closed set. Don't derive them from user data.
- Consider hashing the session id in the file content (the filename already has it). **[verify]** whether session ids are considered sensitive.
- **Test:** run the pipeline with inputs containing a sentinel command string (`rm -rf SECRET_SENTINEL`), an absolute path (`C:\Users\x\secret.txt`, `/home/x/secret`) and a long argument. Then read the snapshot file as raw text and assert it contains none of those sentinels and no drive-letter or leading-slash patterns (`/[A-Za-z]:\\/`, `/\/(home|Users)\//`). Use a regex on the raw file text, not just on parsed fields, so a stray field can't hide.

## 4. Failure isolation (TEL-04)
- Every telemetry entry point (`record`, `flush`, `snapshot`, `dispose`) is wrapped. The wrapper never rethrows and never returns a different result than the underlying rule.
- Include async paths: an unhandled rejection from a flush would crash newer Node (v15+ default). Always attach `.catch`.
- Test by injecting faults:
  - collector whose `record` throws → decision unchanged
  - `writeFile` or `rename` rejecting (`EACCES`, `ENOSPC`) → decision unchanged, no unhandled rejection
  - state home unwritable or nonexistent
  - `performance.now` throwing (use a mock)
  - a rule that throws → the exception still propagates exactly as before (telemetry must not mask it)
  - a rule that blocks, with telemetry failing → still blocks
- Run these with `process.on('unhandledRejection')` as a failing guard in the test.
- Add a kill switch, such as an env var `PI_BLOCK_TELEMETRY=0` that skips decorating entirely. It makes it easy to rule telemetry out if authorization behavior ever looks wrong.

## 5. Overhead and measurement validity
The phase exists to produce a baseline for Phase 8, so the data must be trustworthy.

- `performance.now()` costs well under a microsecond, but sub-0.1 ms pure-function rules may produce near-zero values. Use floats, not rounded ints. Keep `totalMs` as a float and round only at presentation.
- On Windows, `performance.now()` is high resolution. Don't use `Date.now()` (about 1 ms granularity, can go backward on clock changes).
- JIT warm-up inflates the first calls. Record `maxMs` and note this, or report a count of calls so readers can discount the first one.
- The synchronous version of the pipeline will be timed. Phase 8 will compare against it, so record the pipeline version or a mode field (`"sync"`) in the snapshot so the baseline stays distinguishable.
- If hooks are short-lived processes (one process per tool call), an in-memory collector would lose everything. **[verify]** this first.
  - If it is one process per call, the debounce design is wrong. You'd need read-merge-write on a per-session file with a lock, which is much more complex and contradicts per-session isolation.
  - If it is a long-lived pi extension process, the in-memory collector plus debounce design above works.
  - This is the largest risk to the plan. Resolve it in the first task.

## 6. Tests (TEST-01, TEST-03)
Co-located `.test.mjs` next to each new module, using `node:test` + `node:assert/strict`. **[verify]** the project test runner and whether `.mjs` tests import compiled JS or `.ts` (via tsx/ts-node/strip-types). The import path from `.test.mjs` to a `.ts` module may need a build step.

Suggested modules and edge cases:

| Module | Edge cases |
|---|---|
| collector | zero invocations; one rule invoked many times; block vs pass counts; duration accumulation; float precision; `dispose`; eviction; telemetry throw does not propagate |
| wrapper | return value identity (same object reference); rule throw propagates; short-circuit leaves later rules at 0; async-ready |
| snapshot writer | atomic write (never a partial file; kill/throw between tmp-write and rename leaves the old file intact); debounce coalescing (N records → 1 write); max-wait; trailing flush on dispose; overlapping flush serialization; rename failure retry; tmp-file cleanup |
| reader | missing, empty, corrupt, truncated, unknown schemaVersion, valid |
| privacy | sentinel test described above |
| concurrency (TEST-03) | N sessions interleaved with `Promise.all` and different rule outcomes → each snapshot's counts are exactly its own; no cross-contamination; separate files; shared module state isn't leaking; reader during a write storm always parses successfully |

- Use a temp dir per test (`fs.mkdtemp` under `os.tmpdir()`), and point the state-home at it by env var or injection. **Never write into the real state home.** Clean up in `after`.
- On Windows, test cleanup with `rm({recursive:true, force:true, maxRetries:3})` to avoid `EBUSY` flakes.
- Reader-while-writing test: loop 200 writes and parse concurrently. Assert every read yields valid JSON or ENOENT, never a parse error.
- Debounce tests should use `mock.timers.enable({apis:['setTimeout']})` and `tick()`, not sleeps.
- For the atomic-write test, inject a `rename` that throws and assert that the previous target content is unchanged and the tmp file is cleaned up.

## 7. Risks and open questions

1. **Process model [verify]:** long-lived vs per-call hook processes (section 5). This decides the whole design.
2. **Registration seam [verify]:** whether `tool-blockers.ts` has a single registration point for the 23 rules. If rules are a static array consumed directly by `evaluateBlockRules()`, a collector needs to be passed in or the array wrapped per session.
3. **`BlockRule` return shape [verify]:** it determines how "blocked" is detected and which fields are safe to read.
4. **Phase 8 compatibility:** keep wrapper and collector APIs shape-agnostic. Don't bake sync-only assumptions into the snapshot format.
5. **Rename retry on Windows:** needed unless the Phase 5 helper already covers it.
6. **Unbounded growth:** the session Map in memory and snapshot files on disk. Add eviction and a retention policy, or record them as explicit follow-ups.
7. **Gap filing:** per the repo's rules, any gap found during implementation (for example no retention policy) must be filed as a task or `/gsd:add-todo`. I filed none, because plan mode blocks edits and I verified no code.

## 8. Suggested task breakdown (small, independently committable)
1. Spike: confirm the process model, `BlockRule` shape, registration seam, and whether the `lock-schema.ts` write helper is reusable.
2. Collector and stats types, plus tests (pure, no I/O).
3. Rule wrapper, plus tests (identity, throw propagation, short-circuit).
4. Snapshot writer (atomic + debounce + max-wait + retry), plus tests with fault injection.
5. Snapshot reader and validation, plus the API read path.
6. Wire into registration, add the kill switch, and run the privacy sentinel test.
7. Concurrent-session isolation test (TEST-03) and a final fault-injection pass (TEL-04).


---

## Gpt6 Research (gpt-6-astra)

No source diff was supplied, so these are planning risks, not confirmed defects. Locations reference the supplied architecture declarations. Implementation-dependent concerns are **MEDIUM / UNVERIFIED-CONTRACT**.

1. **Make collector ownership explicitly session-scoped.**

   **Location:** `lib/extensions/tool-blockers.ts` — `BlockRule` registration and `evaluateBlockRules()`.

   If registered wrappers capture a shared collector—or retain the first session’s collector—interleaved sessions A and B will combine counts and timings, violating TEL-01 and TEST-03. Create one collector and one decorated rule collection per session, while retaining the existing pure rule implementations. Assign rule identifiers from a fixed registry rather than function names or invocation inputs. Test two sessions using the same underlying rules with different invocation counts, and assert that each snapshot contains only its own observations. The supplied material does not establish the current registration lifetime.

2. **Keep instrumentation failures outside the rule’s authorization behavior.**

   **Location:** `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()` and decorated `BlockRule` functions.

   A telemetry exception after a rule returns can replace a valid authorization result; a broad catch around both rule execution and instrumentation can instead swallow an original rule exception. Either breaks TEL-04. Use separate guarded telemetry operations, preserve the original return value and exception, and leave short-circuit control flow in `evaluateBlockRules()`. Increment invocation counts only inside wrappers that actually execute. Determine “blocked” using the existing rule-result contract; its representation is absent here, so truthiness or a guessed property would be unsafe. Test telemetry failures before and after rule execution, an original rule exception, and a first-rule block that leaves all later counters unchanged.

3. **Treat atomic replacement and publication ordering as separate requirements.**

   **Locations:** `lib/lock-schema.ts` — described temporary-file/rename pattern; `lib/state-home.ts` — `resolveStateHome()`; `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()` as the update source.

   Atomic replacement alone cannot prevent an older asynchronous write from finishing after a newer write and replacing it with stale counters. A purely trailing debounce can also postpone publication indefinitely during sustained activity. Implement a single publication queue per session, copy counters into an immutable snapshot before serialization, and publish through a unique temporary file beside the destination. Use separate destinations for concurrent sessions and bounded publication latency. Handle rejected writes explicitly without affecting authorization. Test deliberately reversed write completion, continuous updates, and concurrent readers. The actual writer and API reader implementations were not supplied, so their existing guarantees remain unverified.

4. **Define an allowlisted output schema before adding diagnostics.**

   **Locations:** `lib/extensions/tool-blockers.ts` — `BlockRule` observations; `lib/state-home.ts` — `resolveStateHome()` and snapshot-path construction.

   Serializing a rule result, caught exception, or input-derived identifier can expose command strings or absolute paths even when raw arguments are omitted explicitly. That violates TEL-05. Construct snapshot records field by field; never spread rule results, contexts, or errors into them. Use opaque session identifiers and fixed rule identifiers, and represent telemetry failures with fixed codes or numeric counters rather than exception messages. Filesystem paths may be used internally but must not enter the telemetry payload.

   An illustrative record schema is:

   ```json
   {
     "schemaVersion": 1,
     "sessionId": "opaque-id",
     "generation": 12,
     "rules": {
       "fixed-rule-id": {
         "invocations": 8,
         "blocks": 2,
         "throws": 0,
         "durationTotalMs": 0.42,
         "durationMaxMs": 0.11
       }
     }
   }
   ```

   Test serialized snapshots and API responses with sentinel commands, arguments, paths, and exception messages; assert that none appear.

5. **Specify timing boundaries so Phase 8 receives a meaningful baseline.**

   **Location:** `lib/extensions/tool-blockers.ts` — individual `BlockRule` calls within `evaluateBlockRules()`.

   Measuring the whole pipeline and attributing that duration to individual rules includes preceding rules and telemetry work. Millisecond integer timing can also collapse fast rule executions to zero, making the planned async comparison misleading. Use a monotonic, high-resolution clock around each actual rule invocation, capture the end timestamp before aggregation or persistence, and define whether thrown invocations contribute to duration totals. Keep that definition unchanged for the Phase 8 comparison. Preserve synchronous behavior in this phase; an `async` decorator changes the return contract. Add co-located `.test.mjs` tests with an injected clock for exact timing assertions, plus a representative enabled-versus-disabled overhead measurement. Record runtime and workload alongside the baseline so later comparisons use equivalent conditions.

---

## Qwen38 Research (qwen3.8-max)

<!-- QwenCLI: model=qwen3.8-max model_requested=qwen3.8-max model_resolved=qwen3.8-max elapsed=88.4s -->

I have no tools in this session, so I'll work strictly from what's inline. The packet below contains only architectural context — no source files, no diff, no line numbers — so per the calibration rules I'll treat this as an architecture-level review, cite declarations/module paths instead of file:line, and cap anything I can't verify against producer source.

## Findings

### 1. UNVERIFIED-CONTRACT — Snapshot path/extension collision with the existing lock file (MEDIUM)

The context says state files are written to `{stateHome}` paths and that `lib/lock-schema.ts` supplies the atomic write pattern (temp + rename). TEL-03 requires telemetry snapshots written atomically to a path resolved via `resolveStateHome()` in `lib/state-home.ts`.

Failure scenario: if the telemetry snapshot is written to `{stateHome}/lock.json` (or the temp file is `{stateHome}/<name>.tmp`), it collides with the Phase 5 lock artifact. A rename-over from telemetry would clobber lock state; worse, a shared fixed `.tmp` suffix means two concurrent writers (telemetry debounce + lock write) can race on the same temp name and one rename lands a partially-written or foreign file at the target. TEST-03 ("concurrent sessions, snapshot isolation") would only catch this if the test actually exercises a concurrent lock write alongside telemetry — which the context does not state.

Fix: give telemetry a distinct namespace and a process-unique temp name, e.g. target `{stateHome}/telemetry/block-rules.snapshot.json` with temp `{stateHome}/telemetry/.block-rules.<pid>.<random>.tmp`, written to the *same directory* as the target (required for `rename` atomicity across the same filesystem) and unlinked on failure. Confirm the lock schema's exact filename in `lib/lock-schema.ts` before choosing, and assert non-collision in a test.

### 2. TEL-05 redaction has no enforcement point in the described design (MEDIUM)

TEL-05 forbids raw tool arguments, command strings, and absolute paths in telemetry output. The described shape — "per-session collector decorates rules at registration with timing and block counts" — is a whitelist by construction (numbers only), which is good. But the risk is the block *reason*: `evaluateBlockRules()` short-circuits on first block, and block rules in `lib/extensions/tool-blockers.ts` plausibly produce human-readable reasons that embed the offending command, path, or argument fragment. If the collector records a reason string, or records the rule name derived from a dynamic path/argument, TEL-05 is violated.

Concrete failure: a rule blocks `rm -rf /abs/path` and the collector stores `blockedReason` verbatim in the snapshot; the snapshot is later attached to a bug report. Absolute path and command string both leak.

Fix: restrict the snapshot record to a closed enum — `{ sessionIdHash, ruleId (from a static registry, not derived from input), invoked: bool, blocked: bool, durationMs: number, timestamp }`. Add an explicit serializer-level assertion test that walks the emitted JSON and fails on any string value matching `/[A-Za-z]:\\|\//` or containing whitespace (command strings contain spaces). That test is the only thing that makes TEL-05 verifiable rather than aspirational.

Also note the session identifier itself: a raw session id may be a path or contain one. Hash or truncate it.

### 3. "Decorates rules at registration" vs. rules being pure functions evaluated by a pipeline (MEDIUM — design mismatch)

The context states block rules are pure functions evaluated sequentially inside `evaluateBlockRules()`. TEL-01 proposes decorating them *at registration*. Two problems:

- If the 23 rules are a static module-level array (likely, given "23 BlockRule functions"), there may be no registration seam at all — decoration would have to wrap the array at import time, which changes module init order and makes the wrapper invisible to the existing call sites.
- TEL-02 ("only invoked rules counted; short-circuited rules excluded") is satisfied automatically by *any* decorator that only fires when the rule is called, because short-circuit means the remaining wrappers never run. So a decorator is not needed for TEL-02 — instrumenting the loop in `evaluateBlockRules()` gets both TEL-01 and TEL-02 with less indirection, and keeps the rule list a plain array.

Failure scenario for the decorator approach: a rule added later by direct array push bypasses registration and is silently uninstrumented, producing telemetry that under-reports invocations — which is exactly the baseline Phase 8 will compare against, so the error propagates into the async performance conclusion.

Fix: prefer wrapping the evaluation loop in `evaluateBlockRules()` (single instrumentation site, no registration seam required, no way to miss a rule). Only adopt per-rule decorators if there is a genuine dynamic registration path; if so, cite it and add a test that a late-registered rule is still instrumented. SIMPLICITY and ROOT CAUSE both point at the loop.

### 4. TEL-04 needs a stated catch boundary and a test that telemetry throws (MEDIUM)

"Telemetry failures never change authorization decisions" is a claim about control flow, not intent. The failure mode that actually breaks this: the collector is consulted *before* the decision is returned, and its throw (disk full, EPERM on rename, JSON.stringify cycle, quota) propagates out of `evaluateBlockRules()`.

Second, subtler failure: the snapshot write is debounced, and the debounce timer callback throws *after* the decision returned. In Node that becomes an unhandled exception in a timer, which can take down the host process — which does change authorization outcomes for every subsequent request. Debounced writes must be wrapped in their own try/catch inside the timer body, not only at the call site.

Fix: (a) wrap the entire telemetry interaction in one try/catch at the single instrumentation site, returning the already-computed decision on any throw; (b) try/catch inside the debounce/timer callback; (c) add a test that injects a throwing writer (monkeypatch `fs.rename` or pass a fake) and asserts `evaluateBlockRules()` still returns the correct block/allow verdict. Without (c), TEL-04 is untested.

### 5. Debounce interacts badly with process lifetime — baseline data loss risk (MEDIUM)

A debounced writer means the trailing edge may never fire: CLI-style hosts exit promptly after the last tool call. Failure scenario: a short session blocks three rules, the debounce window (say 250ms) has not elapsed, the process exits, and the snapshot on disk still reflects the previous session. Phase 8 then compares against a baseline that silently omits short sessions — biasing the "measured baseline" this phase exists to produce.

Fix: write-through (synchronously) on the terminal event of a session, or register a flush on process exit/`beforeExit` and on explicit shutdown, and document the debounce as an intra-session optimization only. Note that a synchronous flush at exit conflicts with the "atomic + non-blocking" goal — resolve by keeping the debounce for hot-path writes and doing one final atomic write at shutdown. Add a test for "session ends inside the debounce window" asserting the final snapshot contains that session's counts.

### 6. Snapshot isolation under concurrent sessions needs a defined merge policy (MEDIUM, TEST-03)

TEST-03 asks for "concurrent sessions, snapshot isolation," but the context does not say whether the snapshot is per-session (one file per session) or aggregate (one file, many sessions). This determines everything:

- Per-session files: isolation is trivial, no contention, but consumers must scan a directory and the file count grows unbounded — needs a retention/cleanup rule that the context does not mention.
- Aggregate file: two concurrent sessions doing read-modify-write with atomic rename will lose updates (last writer wins, the other session's counts vanish). Atomic rename guarantees no *torn* file; it does not guarantee no *lost* write. This is the classic mistake and it is invisible in single-session tests.

Fix: decide explicitly and document it. If aggregate, serialize writers through the existing lock from `lib/lock-schema.ts` (read-under-lock → merge → atomic rename), and make the TEST-03 concurrency test assert the *sum* of counts across N parallel sessions equals the total invocations, not merely that each snapshot parses. If per-session, add the retention bound and a test that a stale session file is not merged into the aggregate read path.

### 7. REDUNDANCY — atomic write pattern should be extracted, not re-implemented (LOW/MEDIUM)

`lib/lock-schema.ts` already contains temp+rename. Copy-pasting that into a new telemetry module gives two independent implementations of the same fs dance, which will drift (e.g. one adds `fsync`, the other doesn't). Fix: export a single `writeFileAtomic(path, contents)` from a shared module and have both lock-schema and telemetry consume it. If extraction is out of scope for this phase, at minimum have telemetry import the existing helper rather than duplicating it.

### 8. Clock choice for timing (LOW)

`Date.now()` is wall-clock and can jump backwards (NTP step), yielding negative durations that will corrupt the Phase 8 comparison. Use `process.hrtime.bigint()` or `performance.now()` (monotonic) for `durationMs`, and keep a separate wall-clock timestamp for the record. Also fix the unit in the field name (`durationMs` vs `durationNs`) so consumers cannot misread it.

### 9. TEST-01 / TEST-03 — `.test.mjs` against a TypeScript source tree (UNVERIFIED, MEDIUM)

TEST-01 requires a co-located `.test.mjs` per new module, but the existing code is `.ts` (`tool-blockers.ts`, `state-home.ts`, `lock-schema.ts`). A `.mjs` test cannot import a `.ts` module without a build step, a loader (`--experimental-strip-types` on Node ≥22.6 / `--import tsx`), or a compiled output directory. I cannot verify which the project uses from the packet — the producer of the test convention is not in the review material.

Action: confirm the test runner and Node version before writing tests. If the repo has no TS loader configured, either the tests must target the built JS (and be run after a build, which changes CI ordering) or `.test.mjs` is the wrong extension and the convention should be `.test.ts`. Getting this wrong means the tests never execute — a green suite that proves nothing.

## Gaps I could not assess

- The actual signature and return shape of `evaluateBlockRules()` — whether it returns `{ blocked, reason, ruleId }` or a boolean determines how much TEL-05 surface exists. Not in the packet.
- The existing snapshot/state file naming convention and whether a schema version field is used. Telemetry snapshots should carry `schemaVersion` from day one; adding it after Phase 8 depends on the format is a breaking change.
- Whether the host process is long-lived or per-invocation (drives finding 5's severity).
- Node version (drives finding 9 and `fs.renameSync` vs `fs.cpSync`/`rename` semantics on Windows — note `rename` over an existing file on Windows can fail with `EPERM`/`EBUSY` if the target is open by a concurrent reader, which is directly relevant to finding 6 and to the win32 host this repo appears to run on; `fs.renameSync` is not guaranteed atomic-overwrite on Windows the way POSIX `rename` is).

That last point deserves emphasis: **on Windows, concurrent readers holding the snapshot open can make the atomic-rename write fail.** Any telemetry writer must tolerate `EPERM`/`EBUSY` on rename and treat it as a telemetry failure under TEL-04 (swallow, do not change the decision), and TEST-03's concurrency test should run on Windows, not only POSIX.


---

## Cross-Model Notes

Review the sections above for agreements and disagreements across models.
The cross-AI research review (step 5.4) will verify accuracy and flag concerns.

---

*Research completed via parallel multi-model research*
