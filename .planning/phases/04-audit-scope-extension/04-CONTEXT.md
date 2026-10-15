# Phase 4: Audit Scope Extension - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning
**Mode:** Auto-accepted defaults (autonomous mode)

<domain>
## Phase Boundary

Port audit-scope-guard as a file-operation proxy InlineExtension that intercepts Write/Edit/Delete from audit sessions and enforces scope boundaries via scope tokens.

</domain>

<decisions>
## Implementation Decisions

### Scope Enforcement
- Intercept Write, Edit, Delete tool calls in audit sessions
- Check file paths against scope tokens (defined per-session)
- Block operations targeting files outside the defined scope
- Path traversal attempts (..) and symlink scope escapes are detected and blocked

### Scope Token Format
- Scope tokens define allowed file path prefixes
- Stored in session state (BlockRuleContext or similar)
- Support glob patterns for flexible scoping

### Atomic Writes
- Legitimate writes within scope use atomic temp-file-then-rename semantics
- Prevents partial writes on failure

### Claude's Discretion
All implementation details not specified above. Follow InlineExtension patterns from Phase 3.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/state-home.ts` — resolveStateHome() for scope token storage
- `lib/extensions/index.ts` — InlineExtension wiring pattern (Phase 3)
- `lib/extensions/types.ts` — BlockRuleContext, ToolCallEvent
- `lib/extensions/block-manual-integrate.ts` — tool_call handler pattern

### Established Patterns
- InlineExtension tool_call handlers in separate module files
- Dependency injection for testability
- Co-located .test.mjs with loadSubject pattern

### Integration Points
- Wire into index.ts factory as tool_call handler
- Scope tokens loaded from session state or config

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
