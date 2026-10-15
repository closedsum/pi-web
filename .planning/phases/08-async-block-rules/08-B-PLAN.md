---
phase: 8
plan: 2
title: evaluateBlockRulesAsync + Extension Wiring
wave: 2
depends_on:
  - plan-1
files_modified:
  - lib/extensions/async-block-rules.ts
  - lib/extensions/async-block-rules.test.mjs
  - lib/extensions/index.ts
requirements:
  - ASYNC-01
  - ASYNC-04
  - TEST-01
autonomous: true
---

# Plan B: evaluateBlockRulesAsync + Extension Wiring

## Goal

Create `evaluateBlockRulesAsync` that prefetches git facts asynchronously, freezes the context, then runs existing sync rules over it. Wire into the extension factory as an async tool_call handler.

## Tasks

<task id="2.1">
<title>Create evaluateBlockRulesAsync</title>
<read_first>
- lib/git-query.ts (prefetchGitFacts, AsyncGitContext)
- lib/extensions/tool-blockers.ts (evaluateBlockRules, BlockRule, ALL_RULES)
- lib/extensions/telemetry-collector.ts (evaluateBlockRulesInstrumented, TelemetryCollector)
- lib/extensions/block-redispatch.ts (checkRedispatchWithoutFix — injectable gitCheck parameter)
- lib/extensions/types.ts (BlockRuleContext, BlockResult)
</read_first>
<action>
Create `lib/extensions/async-block-rules.ts`:

1. Import types and functions:
   ```ts
   import { prefetchGitFacts, type AsyncGitContext } from "../git-query";
   import { evaluateBlockRules, type BlockRule } from "./tool-blockers";
   import { evaluateBlockRulesInstrumented, type TelemetryCollector } from "./telemetry-collector";
   import type { BlockResult, BlockRuleContext } from "./types";
   ```

2. Export `interface AsyncRulePolicy`:
   ```ts
   export interface AsyncRulePolicy {
     timeoutMs: number;
     failMode: "closed" | "open";
   }
   ```

3. Export `const DEFAULT_POLICY: AsyncRulePolicy = { timeoutMs: 5000, failMode: "closed" }`

4. Export `async function evaluateBlockRulesAsync(toolName: string, input: Record<string, unknown>, rules: readonly BlockRule[], ctx: BlockRuleContext | undefined, options?: { policy?: AsyncRulePolicy; collector?: TelemetryCollector; signal?: AbortSignal }): Promise<BlockResult | undefined>`:

   **Gather phase:**
   - If no `ctx` or no `ctx.cwd`: fall back to sync `evaluateBlockRules` (no git context to prefetch)
   - Create a child AbortController linked to the caller's signal:
     ```ts
     const ac = new AbortController();
     if (options?.signal) {
       options.signal.addEventListener("abort", () => ac.abort(), { once: true });
     }
     ```
   - Set timeout: `const timer = setTimeout(() => ac.abort(), policy.timeoutMs)`
   - Try: `const gitCtx = await prefetchGitFacts(ctx.cwd, "master", [], { signal: ac.signal, timeoutMs: policy.timeoutMs })`
   - Finally: `clearTimeout(timer)`
   - On abort/error: if `failMode === "closed"` → `gitCtx = { latestInScope: null, toplevel: null }` (rules proceed without git facts — conservative). If `failMode === "open"` → return undefined (allow the tool call — caller decides this is safe)

   **Decide phase:**
   - Augment `ctx` with the prefetched git facts: `const asyncCtx = { ...ctx, gitFacts: gitCtx }`
   - If collector: `return evaluateBlockRulesInstrumented(toolName, input, rules, asyncCtx, collector)`
   - Else: `return evaluateBlockRules(toolName, input, rules, asyncCtx)`

5. The sync rules themselves don't change — they already have injectable git query parameters. The `checkRedispatchWithoutFix` function accepts `gitCheck` and can be called with a pre-resolved value.

6. Extend `BlockRuleContext` in types.ts to optionally include git facts:
   ```ts
   export interface BlockRuleContext {
     cwd: string;
     isSubagent: boolean;
     sessionId?: string;
     stateHome: string;
     gitFacts?: { latestInScope: string | null; toplevel: string | null };
   }
   ```
</action>
<acceptance_criteria>
- `lib/extensions/async-block-rules.ts` exists
- File exports `evaluateBlockRulesAsync` async function
- File exports `AsyncRulePolicy` interface with `timeoutMs` and `failMode`
- File exports `DEFAULT_POLICY` constant
- Function prefetches git facts via `prefetchGitFacts` with AbortSignal
- Function falls back to sync evaluation when no cwd
- AbortSignal kills child processes on timeout (via prefetchGitFacts)
- fail-closed: null git facts on timeout, rules proceed conservatively
- fail-open: return undefined (allow) on timeout
</acceptance_criteria>
</task>

<task id="2.2">
<title>Test evaluateBlockRulesAsync</title>
<read_first>
- lib/extensions/async-block-rules.ts (the module under test)
- lib/extensions/telemetry-collector.test.mjs (test patterns)
</read_first>
<action>
Create `lib/extensions/async-block-rules.test.mjs`:

1. Test async prefetch success:
   - With real cwd (project dir): `evaluateBlockRulesAsync` returns same result as sync `evaluateBlockRules` for a non-git rule
   - Git facts are prefetched (verify by checking ctx.gitFacts in a custom test rule)

2. Test timeout with abort:
   - Create policy with `timeoutMs: 1` (instant timeout)
   - `failMode: "closed"`: returns result with null git facts (rules still run)
   - `failMode: "open"`: returns undefined (allowed)

3. Test mixed sync/async path:
   - Rules that don't use git facts return the same result whether called via sync or async

4. Test thenable rejection in sync path:
   - Calling sync `evaluateBlockRules` with a rule that returns a Promise → TypeError

5. Test AbortSignal propagation:
   - Pass an already-aborted signal → returns without hanging

6. Test with telemetry collector:
   - Pass a collector → stats recorded for executed rules
</action>
<acceptance_criteria>
- `lib/extensions/async-block-rules.test.mjs` exists
- Running tests exits 0
- At least 6 test cases covering: success, timeout closed, timeout open, abort, thenable, collector
</acceptance_criteria>
</task>

<task id="2.3">
<title>Wire async evaluation into extension factory</title>
<read_first>
- lib/extensions/index.ts (createGsdExtension, the tool_call handler at L76-94, telemetry wiring from Phase 7)
- lib/extensions/async-block-rules.ts (evaluateBlockRulesAsync)
</read_first>
<action>
Edit `lib/extensions/index.ts`:

1. Add import: `import { evaluateBlockRulesAsync } from "./async-block-rules"`

2. Add `enableAsyncRules?: boolean` to `GsdExtensionOptions` (default `false` — opt-in for v2.0, becomes default later)

3. In `createGsdExtension()`, add after existing option destructuring:
   ```ts
   const enableAsyncRules = options.enableAsyncRules ?? false;
   ```

4. In the `pi.on("tool_call")` handler for block rules (the first one, around L76), make it conditionally async:
   ```ts
   if (enableBlockRules) {
     pi.on("tool_call", async (ev: ToolCallEvent) => {
       const start = performance.now();
       const result = enableAsyncRules
         ? await evaluateBlockRulesAsync(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx, { collector: telemetryCollector })
         : telemetryCollector
           ? evaluateBlockRulesInstrumented(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx, telemetryCollector)
           : evaluateBlockRules(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx);
       const durationMs = performance.now() - start;
       telemetryWriter?.schedule();
       // ... rest of handler unchanged
   ```

5. The handler is now `async` — this is safe because `pi.on("tool_call")` awaits handlers (verified in local research: runner.js L957-972 `emitToolCall` is async and awaits each handler).
</action>
<acceptance_criteria>
- `lib/extensions/index.ts` imports `evaluateBlockRulesAsync`
- `GsdExtensionOptions` has `enableAsyncRules?: boolean`
- The tool_call handler is now `async`
- When `enableAsyncRules` is true, uses `evaluateBlockRulesAsync`
- When false, uses existing sync path (no behavior change)
- `npm run build` succeeds
</acceptance_criteria>
</task>

## Verification

```
node --experimental-strip-types --test lib/extensions/async-block-rules.test.mjs
npm run build
```

## must_haves

- [ ] evaluateBlockRulesAsync prefetches git facts async, runs sync rules over frozen context (ASYNC-01)
- [ ] Per-rule timeout with fail-closed/fail-open policy, AbortSignal kills child (ASYNC-04)
- [ ] Co-located tests cover async prefetch, timeout, abort, mixed paths (TEST-01)
