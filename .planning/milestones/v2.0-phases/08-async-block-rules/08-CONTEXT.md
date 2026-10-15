# Phase 8: Async Block Rules - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Mode:** Infrastructure phase — skipping discuss

<domain>
## Phase Boundary

Add an async evaluation path using the gather-then-decide pattern — prefetch git facts asynchronously, then run existing sync rules over the frozen context. Keeps sync API unchanged.

Requirements: ASYNC-01, ASYNC-02, ASYNC-03, ASYNC-04, TEST-01

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from requirements:
- `evaluateBlockRulesAsync` prefetches git facts via promisified `execFile` with `AbortSignal`, `timeout`, `maxBuffer`, `windowsHide`, and no `shell`
- Sync `evaluateBlockRules` unchanged; throws `TypeError` if any rule returns a thenable
- Async git queries use `git.exe` directly (not `shell: true`) per CVE-2024-27980 class guidance
- Per-rule timeout with explicit fail-closed/fail-open policy, `AbortSignal` killing child process

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/extensions/tool-blockers.ts` — `evaluateBlockRules()`, `BlockRule`, `ALL_RULES`
- `lib/extensions/telemetry-collector.ts` — `evaluateBlockRulesInstrumented()` (Phase 7)
- `lib/git-query.ts` — existing sync git query wrapper with timeout
- `lib/state-home.ts` — resolveStateHome()

### Established Patterns
- Block rules are pure sync functions returning BlockResult | undefined
- evaluateBlockRules short-circuits on first block
- git-query.ts uses execFileSync with timeout protection

### Integration Points
- Phase 7 telemetry baseline measures sync performance — async should improve on this
- `pi.on("tool_call")` handler in extensions/index.ts — needs to await async handler
- Verify `pi.on("tool_call")` supports async return values before proceeding

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
