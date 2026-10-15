---
phase: 7
plan: 2
title: Atomic Snapshots + Extension Wiring
wave: 2
depends_on:
  - plan-1
files_modified:
  - lib/extensions/telemetry-writer.ts
  - lib/extensions/telemetry-writer.test.mjs
  - lib/extensions/index.ts
  - lib/extensions/types.ts
requirements:
  - TEL-03
  - TEL-04
  - TEST-01
  - TEST-03
autonomous: true
---

# Plan B: Atomic Snapshots + Extension Wiring

## Goal

Write telemetry snapshots atomically (temp + rename) with debouncing to avoid I/O storms, wire the TelemetryCollector into the GSD extension factory, and test concurrent session isolation.

## Tasks

<task id="2.1">
<title>Create atomic snapshot writer with debouncing</title>
<read_first>
- lib/extensions/telemetry-collector.ts (TelemetrySnapshot type, TelemetryCollector.snapshot())
- lib/state-home.ts (resolveStateHome for path resolution)
- lib/extensions/lane-driver-manager.ts (file write patterns, mkdirSync at L51)
</read_first>
<action>
Create `lib/extensions/telemetry-writer.ts`:

1. Import `writeFileSync, renameSync, mkdirSync` from `fs`, `join` from `path`, `tmpdir` from `os`
2. Import `TelemetrySnapshot` from `./telemetry-collector`
3. Import `resolveStateHome` from `../state-home`

4. Export `function telemetryDir(stateHome?: string): string`:
   - `return join(stateHome ?? resolveStateHome(), "telemetry")`

5. Export `function writeSnapshotAtomic(snapshot: TelemetrySnapshot, dir?: string): void`:
   - Resolve dir: `const target = dir ?? telemetryDir()`
   - `mkdirSync(target, { recursive: true })`
   - Compute file path: `join(target, \`${snapshot.sessionId}.json\`)`
   - Compute temp path: `join(target, \`.${snapshot.sessionId}.tmp\`)`
   - `writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2))`
   - `renameSync(tmpPath, filePath)`
   - Entire function body wrapped in try/catch → on error, silently return (TEL-04)
   - A write failure NEVER throws — it only logs to stderr if available

6. Export `class DebouncedWriter`:
   - Constructor: `constructor(collector: TelemetryCollector, intervalMs = 5_000, dir?: string)`
   - Private field: `timer: ReturnType<typeof setTimeout> | null`
   - Method `schedule()`:
     - If timer already pending, return (debounce)
     - `timer = setTimeout(() => { this.flush(); }, intervalMs)`
   - Method `flush()`:
     - Clear timer
     - `writeSnapshotAtomic(collector.snapshot(), dir)`
   - Method `stop()`:
     - Clear timer, call `flush()` one final time
   - All methods are safe to call after stop — no double-flush
</action>
<acceptance_criteria>
- `lib/extensions/telemetry-writer.ts` exists
- File exports `telemetryDir()`, `writeSnapshotAtomic()`, `DebouncedWriter` class
- `writeSnapshotAtomic()` uses temp file + rename pattern (never writes directly to target)
- `writeSnapshotAtomic()` never throws — all errors caught (TEL-04)
- `DebouncedWriter.schedule()` debounces — multiple calls before intervalMs produce one write
- `DebouncedWriter.stop()` flushes pending snapshot
</acceptance_criteria>
</task>

<task id="2.2">
<title>Test snapshot writer</title>
<read_first>
- lib/extensions/telemetry-writer.ts (the module under test)
- lib/extensions/telemetry-collector.ts (TelemetryCollector for creating snapshots)
- lib/lock-schema.test.mjs (temp dir test pattern)
</read_first>
<action>
Create `lib/extensions/telemetry-writer.test.mjs`:

1. Use jiti to import telemetry-writer.ts and telemetry-collector.ts
2. Create temp dirs in each test, clean up after

3. Test `writeSnapshotAtomic`:
   - Write a snapshot → file exists at `{dir}/{sessionId}.json`
   - Parse the file → matches snapshot data
   - No `.tmp` file remains after write
   - Write to a read-only dir → does not throw (TEL-04)

4. Test `DebouncedWriter`:
   - Create collector, record some data, create writer with short interval (50ms)
   - Call `schedule()` 5 times rapidly → only one file written after debounce
   - Call `stop()` → file written immediately with final data
   - Call `stop()` twice → no error

5. Test concurrent session isolation (TEST-03):
   - Create two collectors with different sessionIds
   - Write snapshots for both to same dir
   - Read back → each file contains only its own session's data
   - Files are named by sessionId → no collision

6. Test TEL-04 (write failure isolation):
   - Create collector, record data producing a valid verdict
   - Make writeSnapshotAtomic fail (pass invalid dir)
   - Verify no exception propagates
</action>
<acceptance_criteria>
- `lib/extensions/telemetry-writer.test.mjs` exists
- Running `node --experimental-strip-types --test lib/extensions/telemetry-writer.test.mjs` exits 0
- Tests cover: atomic write, debounce, concurrent sessions, write failure isolation
- At least 6 test cases
</acceptance_criteria>
</task>

<task id="2.3">
<title>Wire TelemetryCollector into createGsdExtension</title>
<read_first>
- lib/extensions/index.ts (createGsdExtension at top, onTiming callback at L75-91, blockRules parameter)
- lib/extensions/types.ts (GsdExtensionOptions, ExtensionTiming)
- lib/extensions/telemetry-collector.ts (TelemetryCollector, evaluateBlockRulesInstrumented)
- lib/extensions/telemetry-writer.ts (DebouncedWriter)
</read_first>
<action>
Edit `lib/extensions/index.ts`:

1. Add imports at top:
   ```ts
   import { TelemetryCollector, evaluateBlockRulesInstrumented } from "./telemetry-collector";
   import { DebouncedWriter } from "./telemetry-writer";
   ```

2. In `createGsdExtension()`, after the block rules and context are resolved:
   - Create collector: `const collector = new TelemetryCollector(sessionId ?? "unknown")`
   - Create writer: `const writer = new DebouncedWriter(collector)`

3. In the `pi.on("tool_call")` handler (around L76), replace the direct `evaluateBlockRules` call with:
   ```ts
   const result = evaluateBlockRulesInstrumented(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx, collector);
   ```
   - This preserves the existing short-circuit and timing behavior
   - After the evaluation: `writer.schedule()` (debounced write)

4. Add cleanup: in the session end/dispose handler, call `writer.stop()` to flush final snapshot

5. Add `enableTelemetry?: boolean` to `GsdExtensionOptions` in types.ts
   - Default to `true`
   - If `false`, skip collector/writer creation and use original `evaluateBlockRules` call

6. The existing `onTiming` callback continues to work unchanged — it still receives the aggregate timing. The new per-rule telemetry is additive.
</action>
<acceptance_criteria>
- `lib/extensions/index.ts` imports `TelemetryCollector` and `evaluateBlockRulesInstrumented`
- `lib/extensions/index.ts` imports `DebouncedWriter`
- The `pi.on("tool_call")` handler uses `evaluateBlockRulesInstrumented` instead of direct `evaluateBlockRules`
- `writer.schedule()` is called after each evaluation
- `writer.stop()` is called on session cleanup
- `GsdExtensionOptions` has `enableTelemetry?: boolean` in types.ts
- Existing `onTiming` callback behavior unchanged
- `npm run build` succeeds
</acceptance_criteria>
</task>

## Verification

```
npm test
npm run build
```

All tests pass. Build succeeds. Telemetry snapshots written to `{stateHome}/telemetry/` during sessions.

## must_haves

- [ ] Snapshots written atomically (temp + rename) and debounced (TEL-03)
- [ ] Write failures never change authorization decisions (TEL-04)
- [ ] Concurrent sessions produce independent snapshot files (TEST-03)
- [ ] Co-located tests cover atomic writes, debouncing, session isolation (TEST-01)
