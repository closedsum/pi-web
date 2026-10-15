# Phase 2 Research: BlockRule Context Extension + Simple Gates

## BlockRule Type Analysis

### Current Signature (tool-blockers.ts:9-12)
```typescript
export interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>) => BlockResult | undefined;
}
```

### evaluateBlockRules Flow (tool-blockers.ts:309-319)
```typescript
export function evaluateBlockRules(
  toolName: string,
  input: Record<string, unknown>,
  rules: readonly BlockRule[] = ALL_RULES,
): BlockResult | undefined {
  for (const rule of rules) {
    const result = rule.test(toolName, input);
    if (result) return result;
  }
  return undefined;
}
```

### Call Site (index.ts:50-53)
```typescript
pi.on("tool_call", (ev: ToolCallEvent) => {
  const start = performance.now();
  const result = evaluateBlockRules(ev.toolName, ev.input ?? {}, blockRules);
  ...
```

**Key observations:**
- `evaluateBlockRules` receives only `toolName`, `input`, and `rules` — no context parameter
- The pi event handler in `index.ts` receives the `ToolCallEvent` but doesn't pass session context
- There are **21 rules** in `ALL_RULES` (count from the array at line 281-303)
- The `pi.emit("tool_call", payload, ctx)` in `_test-harness.mjs:38` already has a third `ctx` parameter, but the current tool_call handler ignores it

### BlockResult Type (types.ts:10-14)
```typescript
export interface BlockResult {
  block: true;
  reason: string;
  terminate?: boolean;
}
```

### Helper utilities (tool-blockers.ts:14-22)
- `inputStr(input, key)` — safe string extraction
- `commandStr(input)` — extracts `command` or `script`
- `matchesAny(text, patterns)` — regex list check

## Test Patterns

### tool-blockers.test.mjs Pattern
Tests use `jiti.import()` directly (not the `loadSubject()` pattern from lib modules):
```javascript
const jiti = createJiti(import.meta.url);
const { ALL_RULES, evaluateBlockRules, blockBashPython, ... } = await jiti.import("./tool-blockers.ts");
```

Local helpers `blocked(rule, toolName, input)` and `allowed(rule, toolName, input)` wrap `rule.test()` directly — they do NOT use the `assertBlocks`/`assertAllows` from `_test-harness.mjs`.

**Reason:** The test harness's `assertBlocks`/`assertAllows` operate on `pi.emit("tool_call", ...)` which goes through the full extension system. The `blocked`/`allowed` helpers test rules in isolation via `rule.test()`.

### _test-harness.mjs Pattern
```javascript
assertBlocks(pi, toolName, input, pattern)  // emits tool_call event, expects block
assertAllows(pi, toolName, input)           // emits tool_call event, expects allow
```

These already support a third `ctx` parameter in `pi.emit()` (line 38: `emit(event, payload, ctx)`) but it's not passed by `assertBlocks`/`assertAllows`. **This is an extension point for context-aware testing.**

## Source Hook Behavior

### block-probe-in-fork (from FEATURES.md)
- **Intercepts:** `Bash`, `PowerShell` when command contains `gsd_probe.py` or `gsd-probe`
- **Block condition:** Blocks if caller is a subagent (has `agent_id` or `agent_type`)
- **Message:** "probes must run from the main session via PowerShell run_in_background, not from forks"
- **Complexity:** Low — pure string match + context flag check

**Pi-web port:** Needs `ctx.isSubagent` boolean. The rule checks:
1. `toolName === "Bash" || toolName === "PowerShell"`
2. Command contains `gsd_probe.py` or `gsd-probe`
3. `ctx?.isSubagent === true`

### fork-completion-gate (from FEATURES.md)
- **Intercepts:** `TaskUpdate` when `status === "completed"`
- **Block condition:** Blocks completion if fork result state file:
  - Exists but has no `fork_result` field
  - Lacks `## GSD-FORK-RESULT` header
  - Status not in `{completed, complete, success, done}` (unless report-only)
  - Missing commit SHA field
  - Commit SHA not valid hex (7-40 chars)
- **Complexity:** Medium — file read + regex parsing

**Pi-web port:** Needs `ctx.stateHome` for file path resolution. The rule:
1. `toolName === "TaskUpdate"` and `input.status === "completed"`
2. Reads `{ctx.stateHome}/fork-results/{input.task_id}.json`
3. Validates fork result structure

**Note:** This rule does synchronous file I/O (`fs.readFileSync`). Since BlockRules are sync and run on every tool call, this is acceptable for the completion gate (infrequent trigger). Performance warning threshold is 50ms (index.ts:64-66).

## Integration Points

### Where Context Gets Injected

The injection chain needs these changes:

1. **types.ts** — Add `BlockRuleContext` interface:
   ```typescript
   export interface BlockRuleContext {
     cwd: string;
     isSubagent: boolean;
     sessionId?: string;
     stateHome: string;
   }
   ```

2. **tool-blockers.ts** — Extend `BlockRule.test` signature:
   ```typescript
   test: (toolName: string, input: Record<string, unknown>, ctx?: BlockRuleContext) => BlockResult | undefined;
   ```
   And `evaluateBlockRules`:
   ```typescript
   export function evaluateBlockRules(
     toolName: string,
     input: Record<string, unknown>,
     rules: readonly BlockRule[] = ALL_RULES,
     ctx?: BlockRuleContext,
   ): BlockResult | undefined {
     for (const rule of rules) {
       const result = rule.test(toolName, input, ctx);
       if (result) return result;
     }
   }
   ```

3. **index.ts** — Pass context from session state to `evaluateBlockRules`:
   ```typescript
   pi.on("tool_call", (ev: ToolCallEvent) => {
     const result = evaluateBlockRules(ev.toolName, ev.input ?? {}, blockRules, sessionCtx);
   });
   ```
   Where `sessionCtx` is built from session start event or extension options.

4. **_test-harness.mjs** — Extend `assertBlocks`/`assertAllows` to pass context:
   ```javascript
   export function assertBlocks(pi, toolName, input, pattern, ctx) {
     const result = pi.emit("tool_call", { toolName, input: input ?? {} }, ctx);
     ...
   }
   ```

### Session Context Source

`SessionStartEvent` (types.ts:60-63) already has `sessionId` and `cwd`. The extension's `factory(pi)` function in index.ts can capture these at session start. `stateHome` comes from `resolveStateHome()` (Phase 1). `isSubagent` needs a detection mechanism — check if the session was spawned as a subagent (e.g., via `GsdExtensionOptions` or from session start event metadata).

## Backward Compatibility Strategy

### TypeScript Optional Parameter
Adding `ctx?: BlockRuleContext` as a third parameter is fully backward compatible:
- Existing rules with `test(toolName, input)` continue to compile — extra params are ignored in TypeScript
- `evaluateBlockRules(toolName, input, rules)` continues to work — `ctx` defaults to `undefined`
- The call site in `index.ts` can optionally pass context — if unavailable, rules get `undefined`

### Test Compatibility
- Existing tests call `rule.test(toolName, input)` with 2 args — still works (third arg is `undefined`)
- Existing tests call `evaluateBlockRules(toolName, input, rules)` — still works (fourth arg is `undefined`)
- New context-aware rules must handle `ctx === undefined` gracefully (allow if no context available)

### Runtime Safety
Context-aware rules should:
```typescript
test(toolName, input, ctx) {
  if (!ctx) return; // No context available — allow (fail open)
  if (!ctx.isSubagent) return; // Not a subagent — allow
  // ... actual check
}
```

This ensures that if the extension system doesn't provide context (e.g., older integration), the new rules don't block anything.

## Rule Count Verification

Current `ALL_RULES` array (tool-blockers.ts:281-303) has exactly **21 rules**:
blockBashPython, blockBroadUeKill, blockDirectConsoleHttp, blockDirectEditorLaunch, blockForkPush, blockLaneBranchDelete, blockLaunchPortOverride, blockLivecoding, blockMonitorKillSignal, blockPipelineStateTamper, blockPsUtf8Bom, blockRawUeConsole, blockResearchFork, blockSendFeedback, blockSettingsHookWrite, blockSlowForeground, blockStandaloneUeBypass, blockUePythonProbe, blockUeRotatorPositional, blockWildcardProcessKill, denyJunctionSurgery.

After Phase 2, `ALL_RULES` should have **23 rules** (add blockProbeInFork, forkCompletionGate).
