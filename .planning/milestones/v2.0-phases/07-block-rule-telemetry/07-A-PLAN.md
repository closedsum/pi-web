---
phase: 7
plan: 1
title: TelemetryCollector + Instrumented Evaluation
wave: 1
depends_on: []
files_modified:
  - lib/extensions/telemetry-collector.ts
  - lib/extensions/telemetry-collector.test.mjs
  - lib/extensions/tool-blockers.ts
  - lib/extensions/tool-blockers.test.mjs
requirements:
  - TEL-01
  - TEL-02
  - TEL-04
  - TEL-05
  - TEST-01
autonomous: true
---

# Plan A: TelemetryCollector + Instrumented Evaluation

## Goal

Create a per-session TelemetryCollector that wraps each block rule at registration with `performance.now()` timing and block/allow counters, respecting the short-circuit semantics (only executed rules are counted). Telemetry failures never affect authorization decisions.

## Tasks

<task id="1.1">
<title>Create TelemetryCollector module</title>
<read_first>
- lib/extensions/tool-blockers.ts (BlockRule type at L12-15, evaluateBlockRules at L358-369, ALL_RULES at L328-352)
- lib/extensions/types.ts (BlockRuleContext at L17-22, BlockResult at L11-15)
- lib/extensions/session-lifecycle.ts (SessionState pattern — per-session mutable state)
</read_first>
<action>
Create `lib/extensions/telemetry-collector.ts`:

1. Import `BlockRule`, `BlockResult`, `BlockRuleContext` from types

2. Define `RuleStats` interface:
   ```ts
   interface RuleStats {
     name: string;
     invocations: number;
     blocks: number;
     allows: number;
     totalMs: number;
     maxMs: number;
   }
   ```

3. Define `TelemetrySnapshot` interface:
   ```ts
   export interface TelemetrySnapshot {
     sessionId: string;
     capturedAt: string;
     rules: Record<string, RuleStats>;
     totalEvaluations: number;
     totalBlocks: number;
     totalAllows: number;
   }
   ```

4. Export `class TelemetryCollector`:
   - Constructor: `constructor(sessionId: string)`
   - Private field: `rules: Map<string, RuleStats>` initialized empty
   - Private fields: `totalEvaluations = 0`, `totalBlocks = 0`, `totalAllows = 0`

   - Method `record(name: string, durationMs: number, blocked: boolean)`:
     - Get or create entry in `rules` map for `name` (initialize with zeros)
     - Increment `invocations`, add to `totalMs`, update `maxMs`
     - If blocked: increment `blocks` and `totalBlocks`
     - Else: increment `allows` and `totalAllows`
     - Increment `totalEvaluations`

   - Method `snapshot(): TelemetrySnapshot`:
     - Return frozen copy: `Object.freeze({ sessionId, capturedAt: new Date().toISOString(), rules: Object.fromEntries(this.rules), totalEvaluations, totalBlocks, totalAllows })`
     - Deep-freeze the rules entries too

5. Export `function instrumentRules(rules: readonly BlockRule[], collector: TelemetryCollector): BlockRule[]`:
   - Return `rules.map(rule => ({ name: rule.name, test(toolName, input, ctx) { const start = performance.now(); const result = rule.test(toolName, input, ctx); const ms = performance.now() - start; collector.record(rule.name, ms, !!result?.block); return result; } }))`
   - The wrapper preserves short-circuit semantics: `evaluateBlockRules` stops iterating on first block, so subsequent wrapped rules are never called and never recorded (TEL-02)

6. Export `function evaluateBlockRulesInstrumented(toolName: string, input: Record<string, unknown>, rules: readonly BlockRule[], ctx: BlockRuleContext | undefined, collector: TelemetryCollector): BlockResult | undefined`:
   - Call `evaluateBlockRules(toolName, input, instrumentRules(rules, collector), ctx)`
   - Wrap in try/catch: if instrumentation throws, fall back to `evaluateBlockRules(toolName, input, rules, ctx)` without instrumentation (TEL-04)
   - Return the result — verdict is NEVER affected by telemetry

7. TEL-05 redaction: TelemetrySnapshot contains only rule names, counts, and timing — no tool arguments, command strings, or file paths are ever stored. The `record()` method only takes `name`, `durationMs`, `blocked` — no tool-call data.
</action>
<acceptance_criteria>
- `lib/extensions/telemetry-collector.ts` exists
- File exports `TelemetryCollector` class with `record()` and `snapshot()` methods
- File exports `instrumentRules()` function
- File exports `evaluateBlockRulesInstrumented()` function
- `record()` accepts only `name: string, durationMs: number, blocked: boolean` — no tool arguments
- `snapshot()` returns a frozen object
- `evaluateBlockRulesInstrumented()` falls back to uninstrumented evaluation on error (TEL-04)
- No raw tool arguments, command strings, or file paths in any stored data (TEL-05)
</acceptance_criteria>
</task>

<task id="1.2">
<title>Test TelemetryCollector</title>
<read_first>
- lib/extensions/telemetry-collector.ts (the module under test)
- lib/extensions/tool-blockers.test.mjs (test patterns — describe blocks, blocked/allowed helpers)
</read_first>
<action>
Create `lib/extensions/telemetry-collector.test.mjs`:

1. Use jiti to import telemetry-collector.ts

2. Test `TelemetryCollector.record()`:
   - Record 3 invocations for rule "a" (2 allows, 1 block) → stats show invocations:3, blocks:1, allows:2
   - Record for rule "b" (1 allow) → stats show invocations:1
   - `totalEvaluations` equals sum of all invocations
   - `maxMs` tracks the maximum, not the last
   - `totalBlocks` and `totalAllows` are correct

3. Test `TelemetryCollector.snapshot()`:
   - Returns frozen object (Object.isFrozen)
   - Contains `sessionId`, `capturedAt` (ISO string), `rules`, totals
   - Multiple snapshots are independent copies

4. Test `instrumentRules()`:
   - Wrap 3 rules, evaluate with a tool that triggers the second rule to block
   - Collector has stats for rule 1 (allow) and rule 2 (block)
   - Rule 3 has NO stats (never called due to short-circuit) — TEL-02
   - Returned results are identical to uninstrumented evaluation

5. Test `evaluateBlockRulesInstrumented()` fallback (TEL-04):
   - Create a collector whose `record()` throws an error
   - `evaluateBlockRulesInstrumented()` still returns the correct verdict
   - No exception propagates

6. Test TEL-05 (no raw data in snapshot):
   - After recording, snapshot contains only names, counts, timing
   - Assert snapshot JSON stringification contains no tool arguments
</action>
<acceptance_criteria>
- `lib/extensions/telemetry-collector.test.mjs` exists
- Running `node --experimental-strip-types --test lib/extensions/telemetry-collector.test.mjs` exits 0
- Tests cover: record stats, snapshot frozen, short-circuit counting, fallback on error, no raw data
- At least 8 test cases
</acceptance_criteria>
</task>

## Verification

```
node --experimental-strip-types --test lib/extensions/telemetry-collector.test.mjs
```

All tests pass. No regressions in existing tool-blockers tests.

## must_haves

- [ ] TelemetryCollector wraps each rule with timing and block/allow counters (TEL-01)
- [ ] Only executed rules are counted — short-circuited rules excluded (TEL-02)
- [ ] Telemetry failure never changes authorization decision (TEL-04)
- [ ] No raw tool arguments, command strings, or paths in telemetry (TEL-05)
- [ ] Co-located tests cover all scenarios (TEST-01)
