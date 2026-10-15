# Phase 3: InlineExtension Hooks + Lane Driver - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Mode:** Auto-accepted defaults (autonomous mode)

<domain>
## Phase Boundary

Port block-manual-integrate, block-redispatch-without-fix as InlineExtension tool_call handlers, and ensure-lane-driver as a session-start daemon manager. These are more complex than BlockRules and need access to file I/O, process management, and git queries.

</domain>

<decisions>
## Implementation Decisions

### InlineExtension Pattern
- Use pi.on("tool_call") handlers inside the GSD extension factory (lib/extensions/index.ts)
- Each handler is a separate module file with pure functions, tested independently
- The extension wiring in index.ts imports and calls them

### block-manual-integrate
- Blocks git cherry-pick, git merge, and gsd_impl_lane.py integrate commands
- Only blocks when .autopilot.lock contains a live PID (uses isProcessAlive from Phase 1)
- Stale lock (dead PID) → allow the operation (fail open)
- Missing lock file → allow

### block-redispatch-without-fix
- Blocks gsd_impl_lane.py pipeline --params-file when prior pipeline shows failed/blocked/review_failed
- Requires a newer commit in the write scope on master before allowing redispatch
- Uses parseNamedArg (Phase 1) to extract --params-file value
- Uses gitLogLatestInScope (Phase 1) to check for newer commits

### ensure-lane-driver
- Session-start handler (not tool_call)
- Checks if gsd_lane_driver.py is alive, spawns if needed
- Eligibility: has .planning/config.json, not a worktree, not under temp dir
- Backoff: 3 restarts in 60s → stop trying
- Lock file and stop sentinel support

### Claude's Discretion
All implementation details not specified above. Follow established patterns from Phase 2.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/process-liveness.ts` — isProcessAlive(pid)
- `lib/git-query.ts` — gitRevParseShowToplevel, gitLogLatestInScope
- `lib/shell-command-parser.ts` — parseNamedArg
- `lib/state-home.ts` — resolveStateHome
- `lib/extensions/tool-blockers.ts` — BlockRule pattern, evaluateBlockRules with context
- `lib/extensions/types.ts` — BlockRuleContext, ToolCallEvent

### Established Patterns
- InlineExtension handlers in index.ts factory
- Session lifecycle hooks in session-lifecycle.ts
- Tool call event handling with timing

### Integration Points
- New handlers register in the GSD extension factory (index.ts)
- Lane driver spawns a detached Python process

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
