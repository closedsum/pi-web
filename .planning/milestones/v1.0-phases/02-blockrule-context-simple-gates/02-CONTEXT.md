# Phase 2: BlockRule Context + Simple Gates - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Mode:** Auto-accepted defaults (autonomous mode)

<domain>
## Phase Boundary

Extend the BlockRule type with an optional context parameter (`BlockRuleContext`), then port `block-probe-in-fork` and `fork-completion-gate` as context-aware BlockRules. All 21 existing rules must pass unchanged (backward compatibility).

</domain>

<decisions>
## Implementation Decisions

### Type Extension Strategy
- Extend `BlockRule.test` with an optional third parameter `ctx?: BlockRuleContext`
- `BlockRuleContext` contains `{ cwd, isSubagent, sessionId, stateHome }` — minimal context for gate decisions
- Existing rules that don't use context continue to work with 2 args (TypeScript optional param)
- Context is populated by the extension system caller (evaluateBlockRules) from session state

### block-probe-in-fork Rule
- Blocks Bash/PowerShell calls containing `gsd_probe.py` when `ctx.isSubagent === true`
- Allows them when `ctx.isSubagent === false` (orchestrator session)
- Pure function: checks tool name + input string + context flag

### fork-completion-gate Rule
- Blocks `TaskUpdate(completed)` when fork-result state file is missing/malformed
- Reads `{ctx.stateHome}/fork-results/{taskId}.json` to verify valid commit SHA
- Uses `resolveStateHome()` from Phase 1's `lib/state-home.ts`

### Claude's Discretion
All implementation details not specified above are at Claude's discretion. Follow existing tool-blockers.ts patterns and _test-harness.mjs conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/extensions/tool-blockers.ts` — 16 existing BlockRule functions, `evaluateBlockRules()`
- `lib/extensions/_test-harness.mjs` — `createMockPi()`, `assertBlocks()`, `assertAllows()`
- `lib/state-home.ts` — `resolveStateHome()` (Phase 1 output)

### Established Patterns
- BlockRules are pure sync functions: `(toolName: string, input: Record<string, unknown>) => BlockResult | null`
- Test harness provides `assertBlocks(rule, toolName, input)` and `assertAllows(rule, toolName, input)`
- Rules return `{ blocked: true, reason: string }` or `null` (allow)

### Integration Points
- `evaluateBlockRules()` in tool-blockers.ts calls all rules — must pass context through
- Extension system in `lib/extensions/` manages rule registration

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria. Follow existing patterns in tool-blockers.ts.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
