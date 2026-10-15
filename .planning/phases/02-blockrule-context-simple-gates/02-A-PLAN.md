---
phase: 2
plan: "02-A"
title: "BlockRule Context Extension + Backward Compatibility"
wave: 1
depends_on: []
files_modified: ["lib/extensions/types.ts", "lib/extensions/tool-blockers.ts", "lib/extensions/index.ts", "lib/extensions/tool-blockers.test.mjs"]
requirements: ["CTX-01", "CTX-02", "CTX-03", "TEST-02"]
autonomous: true
---

<objective>
Add `BlockRuleContext` interface to the type system, extend the `BlockRule.test` signature with an optional third `ctx` parameter, update `evaluateBlockRules` to forward context, wire context from session state in `index.ts`, and verify all 21 existing rules pass unchanged.
</objective>

<tasks>
## Task 1: Add BlockRuleContext type (types.ts)

<read_first>
- lib/extensions/types.ts (current type definitions — understand where to insert)
</read_first>

<action>
Add after the `BlockResult` interface (line 14) in `lib/extensions/types.ts`:

```typescript
export interface BlockRuleContext {
  cwd: string;
  isSubagent: boolean;
  sessionId?: string;
  stateHome: string;
}
```

This is a plain interface — no default values, no factory function. Consumers construct it from session state.
</action>

<acceptance_criteria>
- `lib/extensions/types.ts` contains `export interface BlockRuleContext`
- Interface has exactly 4 fields: `cwd: string`, `isSubagent: boolean`, `sessionId?: string`, `stateHome: string`
</acceptance_criteria>

## Task 2: Extend BlockRule.test signature (tool-blockers.ts)

<read_first>
- lib/extensions/tool-blockers.ts:1-25 (BlockRule interface + helpers)
- lib/extensions/tool-blockers.ts:305-319 (evaluateBlockRules function)
</read_first>

<action>
1. Add import at top of `lib/extensions/tool-blockers.ts`:
```typescript
import type { BlockResult, BlockRuleContext } from "./types";
```
(Change existing `import type { BlockResult }` to include `BlockRuleContext`.)

2. Update the `BlockRule` interface (line 9-12):
```typescript
export interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>, ctx?: BlockRuleContext) => BlockResult | undefined;
}
```

3. Update `evaluateBlockRules` (line 309-319):
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
  return undefined;
}
```

The key change: `ctx` is the 4th parameter (after `rules`), and is forwarded to each `rule.test()` call. Existing callers pass 3 args `(toolName, input, rules)` — the 4th defaults to `undefined`.
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.ts` contains `import type { BlockResult, BlockRuleContext } from "./types"`
- `BlockRule.test` signature contains `ctx?: BlockRuleContext`
- `evaluateBlockRules` has 4th parameter `ctx?: BlockRuleContext`
- `evaluateBlockRules` body calls `rule.test(toolName, input, ctx)`
</acceptance_criteria>

## Task 3: Wire context from session state in index.ts

<read_first>
- lib/extensions/index.ts (full file — understand session_start handler, tool_call handler, factory closure)
- lib/state-home.ts (resolveStateHome signature)
</read_first>

<action>
1. Add import at top of `lib/extensions/index.ts`:
```typescript
import { resolveStateHome } from "../state-home";
import type { BlockRuleContext } from "./types";
```

2. Inside `createGsdExtension`, after the `const` declarations (~line 39), add a mutable context variable:
```typescript
let blockRuleCtx: BlockRuleContext | undefined;
```

3. Inside the `factory: (pi) => {` function, before the `if (enableBlockRules)` block, add session start context capture. Since `enableSessionRules` may register a `session_start` handler, we register our own early handler to capture context:
```typescript
pi.on("session_start", (ev: SessionStartEvent) => {
  blockRuleCtx = {
    cwd: ev.cwd ?? process.cwd(),
    isSubagent: false,
    sessionId: ev.sessionId,
    stateHome: resolveStateHome(),
  };
});
```

Note: `isSubagent` defaults to `false`. The caller can set it via `GsdExtensionOptions` or it can be detected from session metadata in a future enhancement.

4. Add `isSubagent` option to `GsdExtensionOptions`:
```typescript
export interface GsdExtensionOptions {
  // ... existing fields ...
  isSubagent?: boolean;
}
```

5. Update the `session_start` handler to use the option:
```typescript
pi.on("session_start", (ev: SessionStartEvent) => {
  blockRuleCtx = {
    cwd: ev.cwd ?? process.cwd(),
    isSubagent: options.isSubagent ?? false,
    sessionId: ev.sessionId,
    stateHome: resolveStateHome(),
  };
});
```

6. Update the `evaluateBlockRules` call in the `tool_call` handler to pass context:
```typescript
const result = evaluateBlockRules(ev.toolName, ev.input ?? {}, blockRules, blockRuleCtx);
```
</action>

<acceptance_criteria>
- `lib/extensions/index.ts` contains `import { resolveStateHome } from "../state-home"`
- `lib/extensions/index.ts` contains `import type { BlockRuleContext } from "./types"`
- `lib/extensions/index.ts` contains `let blockRuleCtx: BlockRuleContext | undefined`
- `GsdExtensionOptions` contains `isSubagent?: boolean`
- `evaluateBlockRules` call includes `blockRuleCtx` as 4th argument
- `session_start` handler builds `blockRuleCtx` with `cwd`, `isSubagent`, `sessionId`, `stateHome`
</acceptance_criteria>

## Task 4: Verify backward compatibility — all 21 existing rules pass

<read_first>
- lib/extensions/tool-blockers.test.mjs (existing tests — understand how many tests, what they cover)
</read_first>

<action>
Run the full existing test suite to verify backward compatibility:

```bash
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
```

All existing tests must pass with 0 failures. The `blocked(rule, toolName, input)` and `allowed(rule, toolName, input)` helpers call `rule.test(toolName, input)` with 2 args — the optional 3rd `ctx` parameter is `undefined`, and existing rules ignore it.

If any test fails, investigate and fix — it means the type change broke something. The change should be purely additive (optional parameter).

Also run the full project test suite:
```bash
npm test
```

And verify the build:
```bash
npm run build
```
</action>

<acceptance_criteria>
- `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` exits 0 with all tests passing
- `npm run build` exits 0
- No existing tests were modified
</acceptance_criteria>
</tasks>

<verification>
```bash
# Type check: BlockRuleContext exists
grep "export interface BlockRuleContext" lib/extensions/types.ts

# Signature check: BlockRule.test has ctx
grep "ctx?: BlockRuleContext" lib/extensions/tool-blockers.ts

# evaluateBlockRules forwards ctx
grep "rule.test(toolName, input, ctx)" lib/extensions/tool-blockers.ts

# index.ts wires context
grep "blockRuleCtx" lib/extensions/index.ts
grep "evaluateBlockRules.*blockRuleCtx" lib/extensions/index.ts

# Backward compatibility
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
npm run build
```
</verification>

<must_haves>
- BlockRuleContext interface with cwd, isSubagent, sessionId, stateHome
- BlockRule.test accepts optional ctx parameter
- evaluateBlockRules forwards ctx to rule.test
- Context built from session_start event in index.ts
- All 21 existing rules pass unchanged
- Build succeeds
</must_haves>
