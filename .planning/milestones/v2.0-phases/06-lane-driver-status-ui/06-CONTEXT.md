# Phase 6: Lane Driver Status UI - Context

**Gathered:** 2026-10-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose lane driver daemon state through a read-only API route and render a real-time status badge in the task panel, with single-flight polling and visibility gating.

Requirements: UI-01, UI-02, UI-03, UI-04, TEST-01

</domain>

<decisions>
## Implementation Decisions

### Badge Visual Design
- Badge positioned in task panel header row, after "Tasks" title, before the task counters
- State colors: green (#22c55e) for running, gray (#6b7280) for stopped, red (#ef4444) for errored, amber (#f59e0b) for stale, blue-gray (#64748b) for unknown — consistent with existing status color palette in TaskPanel
- Heartbeat age displayed as "5s" for <60s, "2m" for >=60s, hidden when null (v1 schema or no lock)
- Compact layout: small colored dot + status text + age in parentheses, same density as existing Tag components

### Polling Behavior
- Base polling interval: 5s using setTimeout (not setInterval) for single-flight guarantee
- Exponential backoff on errors: double interval each error, cap at 60s, reset to 5s on success
- On visibility change (document.visibilitychange): immediate fetch when becoming visible, resume 5s cycle; pause polling while tab hidden
- No toast/alert on errors — badge shows "unknown" state with reason, consistent with fail-graceful pattern

### API Contract
- DTO includes: status, heartbeatAge (ms or null), reason, schemaVersion, identityVerified, pid (for debugging), lastError
- cwd passed as query parameter with path validation — follows dispatch-status pattern exactly
- All exceptions caught — parse failures, I/O errors, missing files return {status: "unknown", reason: "<description>"}, never HTTP 500
- Route uses export const dynamic = "force-dynamic" and Cache-Control: no-store headers

### Claude's Discretion
- Internal naming conventions, file organization, hook naming at Claude's discretion
- Component decomposition (single file vs separate files) based on complexity

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/lock-schema.ts` — `parseLockFile()`, `deriveDaemonStatus()`, `DaemonStatusResult` type — the core data source for the API
- `lib/extensions/lane-driver-manager.ts` — `getDaemonStatus()`, `projectHash()` — ready-made status reader
- `lib/state-home.ts` — `resolveStateHome()` for lock file path resolution
- `lib/process-liveness.ts` — `isProcessAlive()` for PID liveness check
- `components/task-panel/TaskPanel.tsx` — existing Tag component, BrailleSpinner, minuteTick pattern, header layout with gap:8

### Established Patterns
- API routes: validate cwd, check allowedFileRoots, return JSON (see dispatch-status/route.ts)
- Components: inline styles with CSS variables (--bg-panel, --text, --text-muted, --border)
- Polling: TaskPanel uses setInterval at configurable pollMs; DispatchSection has its own polling
- Status colors: #22c55e green, #3b82f6 blue, #f59e0b amber, #ef4444 red — established palette

### Integration Points
- API route: `app/api/lane-driver/status/route.ts` — new route
- Component: `components/task-panel/DriverStatusBadge.tsx` — new component, imported into TaskPanel header
- The `getDaemonStatus()` in lane-driver-manager already reads the lock and returns the 5-state union — API wraps this

</code_context>

<specifics>
## Specific Ideas

- Reuse `getDaemonStatus()` from lane-driver-manager.ts directly in the API route — it already handles lock parsing + status derivation
- Badge should match the compact visual density of existing Tag components (10px font, pill-shaped)
- Use document.visibilitychange API for tab visibility gating (well-supported, no polyfill needed)
- Keep the badge unobtrusive — it's supplemental info, not primary UI

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
