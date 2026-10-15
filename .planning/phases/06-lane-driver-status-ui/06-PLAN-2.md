---
phase: 6
plan: 2
title: Badge Component + TaskPanel Integration
wave: 2
depends_on:
  - plan-1
files_modified:
  - hooks/useLaneDriverStatus.ts
  - components/task-panel/DriverStatusBadge.tsx
  - components/task-panel/TaskPanel.tsx
  - components/task-panel/DriverStatusBadge.test.mjs
  - hooks/useLaneDriverStatus.test.mjs
requirements:
  - UI-03
  - UI-04
  - TEST-01
autonomous: true
---

# Plan 2: Badge Component + TaskPanel Integration

## Goal

Create the React hook wrapping the polling engine, the presentational badge component with discriminated union rendering, and integrate the badge into the TaskPanel header.

## Tasks

<task id="2.1">
<title>Create useLaneDriverStatus hook</title>
<read_first>
- lib/lane-driver-poller.ts (createLanePoller, LaneDriverStatusDTO, PollResult)
- components/task-panel/TaskPanel.tsx (useEffect pattern at L326-332, cwd prop usage)
</read_first>
<action>
Create `hooks/useLaneDriverStatus.ts`:

1. Import `createLanePoller` and `LaneDriverStatusDTO` from `@/lib/lane-driver-poller`
2. Import `useState, useEffect, useRef, useCallback` from `react`

3. Define return type:
   ```ts
   interface LaneDriverState {
     status: LaneDriverStatusDTO | null;
     error: string | null;
     loading: boolean;
   }
   ```

4. Export `function useLaneDriverStatus(cwd: string | null): LaneDriverState`:
   - `const [state, setState] = useState<LaneDriverState>({status: null, error: null, loading: true})`
   - `const onResultRef = useRef(...)` — stable ref for the callback to avoid re-subscriptions
   - `useEffect` keyed on `[cwd]`:
     - If `!cwd` → set `{status: null, error: null, loading: false}`, return
     - Define `fetchFn(signal: AbortSignal)`:
       - `const res = await fetch(\`/api/lane-driver/status?cwd=\${encodeURIComponent(cwd)}\`, {signal, cache: "no-store"})`
       - If `!res.ok` throw `new Error(\`HTTP \${res.status}\`)`
       - `const data = await res.json()`
       - Validate shape: if `typeof data.status !== "string"` throw `new Error("invalid response")`
       - Return `data as LaneDriverStatusDTO`
     - Create poller: `const poller = createLanePoller({fetchFn, onResult: (r) => onResultRef.current(r)})`
     - `poller.start()`
     - Return cleanup: `() => poller.stop()`
   - `onResultRef.current` callback:
     - If `r.ok` → `setState({status: r.data, error: null, loading: false})`
     - Else → `setState(prev => ({status: prev.status, error: r.reason, loading: false}))` — keep last good status on transient errors

5. The hook does not own any timers or DOM listeners — `createLanePoller` handles all of that. The hook is pure React glue.
</action>
<acceptance_criteria>
- `hooks/useLaneDriverStatus.ts` exists
- File imports `createLanePoller` from `@/lib/lane-driver-poller`
- File exports `useLaneDriverStatus` function
- Hook takes `cwd: string | null` parameter
- Hook returns `{status, error, loading}` object
- useEffect is keyed on `[cwd]` — changing cwd restarts polling
- useEffect cleanup calls `poller.stop()`
- fetchFn validates response shape before returning
- fetchFn uses `encodeURIComponent(cwd)` in the URL
</acceptance_criteria>
</task>

<task id="2.2">
<title>Create DriverStatusBadge component</title>
<read_first>
- components/task-panel/TaskPanel.tsx (Tag component at L50-67, hexToRgba at L44, STATUS_COLORS at L14, BrailleSpinner at L100)
- lib/lock-schema.ts (DaemonStatus type at L30)
</read_first>
<action>
Create `components/task-panel/DriverStatusBadge.tsx`:

1. Add `"use client"` directive

2. Import `useLaneDriverStatus` from `@/hooks/useLaneDriverStatus`

3. Define status color map (matching established palette where possible):
   ```ts
   const STATUS_BADGE_COLORS: Record<string, string> = {
     running: "#22c55e",   // green — matches existing completed color
     stopped: "#6b7280",   // gray
     errored: "#ef4444",   // red — matches existing failed color
     stale: "#f59e0b",     // amber — matches existing pending color
     unknown: "#64748b",   // blue-gray
   };
   ```

4. Define `formatHeartbeatAge(ms: number | null): string | null`:
   - If `ms === null` return `null`
   - If `ms < 0` return `null`
   - If `ms < 60_000` return `${Math.round(ms / 1000)}s`
   - If `ms < 3_600_000` return `${Math.floor(ms / 60_000)}m`
   - Else return `${Math.floor(ms / 3_600_000)}h`

5. Export `function DriverStatusBadge({ cwd }: { cwd: string | null })`:
   - Call `useLaneDriverStatus(cwd)`
   - If `loading` and no `status` → return null (don't flash badge before first poll)
   - If no `status` → return null (no cwd or initial load)
   - Determine `color` from `STATUS_BADGE_COLORS[status.status]` (default to unknown color)
   - Determine `ageText` from `formatHeartbeatAge(status.heartbeatAgeMs)`
   - Render a compact badge matching Tag component density:
     ```tsx
     <span style={{
       display: "inline-flex",
       alignItems: "center",
       gap: 4,
       padding: "1px 6px",
       borderRadius: 4,
       fontSize: 10,
       fontWeight: 500,
       fontFamily: "var(--font-mono)",
       background: hexToRgba(color, 0.15),
       color,
       lineHeight: 1.5,
       whiteSpace: "nowrap",
       flexShrink: 0,
     }}>
       <span style={{
         width: 5,
         height: 5,
         borderRadius: "50%",
         background: color,
         flexShrink: 0,
       }} />
       {status.status}
       {ageText && <span style={{ opacity: 0.7 }}>({ageText})</span>}
     </span>
     ```
   - Use inline `hexToRgba` helper (same implementation as TaskPanel's existing one) to avoid cross-file dependency on a private function

6. Component is purely presentational — all polling logic is in the hook, which delegates to the poller engine.
</action>
<acceptance_criteria>
- `components/task-panel/DriverStatusBadge.tsx` exists
- File has `"use client"` directive
- File imports `useLaneDriverStatus` from `@/hooks/useLaneDriverStatus`
- File exports `DriverStatusBadge` component
- Component renders a colored dot + status text for each of the 5 states
- Component renders heartbeat age in parentheses when non-null
- Component returns null when no status data (loading or no cwd)
- `formatHeartbeatAge` handles null, <60s (seconds), >=60s (minutes), >=1h (hours)
- Color map has entries for all 5 status values: running, stopped, errored, stale, unknown
</acceptance_criteria>
</task>

<task id="2.3">
<title>Integrate badge into TaskPanel header</title>
<read_first>
- components/task-panel/TaskPanel.tsx (header JSX at L358-429, "Tasks" label ending at L383, counts at L384)
- components/task-panel/DriverStatusBadge.tsx (the new component)
</read_first>
<action>
Edit `components/task-panel/TaskPanel.tsx`:

1. Add import at top: `import { DriverStatusBadge } from "./DriverStatusBadge"`

2. Insert `<DriverStatusBadge cwd={cwd} />` in the header flex row, after the "Tasks" label span (after L383) and before the task counts span (L384). Place it as a sibling with the existing `gap: 8` flex layout.

The badge will appear as: `Tasks [*running (5s)] 3 done 2 active`

No other changes to TaskPanel — the badge manages its own polling lifecycle independently.
</action>
<acceptance_criteria>
- `components/task-panel/TaskPanel.tsx` imports `DriverStatusBadge` from `./DriverStatusBadge`
- `components/task-panel/TaskPanel.tsx` renders `<DriverStatusBadge cwd={cwd} />` inside the header div
- Badge appears between "Tasks" label and task count summary
- No changes to TaskPanel's existing polling or state logic
</acceptance_criteria>
</task>

<task id="2.4">
<title>Test badge component and hook</title>
<read_first>
- components/task-panel/DriverStatusBadge.tsx (the component under test)
- hooks/useLaneDriverStatus.ts (the hook under test)
- lib/lane-driver-poller.test.mjs (test pattern — fake timers, fake document)
</read_first>
<action>
Create `components/task-panel/DriverStatusBadge.test.mjs`:

1. Test `formatHeartbeatAge` (exported or tested via component output):
   - `null` → `null`
   - `0` → `"0s"`
   - `5000` → `"5s"`
   - `59999` → `"60s"` (rounds up)
   - `60000` → `"1m"`
   - `3599999` → `"59m"`
   - `3600000` → `"1h"`
   - Negative → `null`

2. Test status-to-color mapping:
   - Each of the 5 status values maps to a defined color
   - No status value results in undefined color

Create `hooks/useLaneDriverStatus.test.mjs`:

1. Test hook behavior with mock fetch:
   - `cwd=null` → returns `{status: null, error: null, loading: false}`
   - Valid cwd → poller starts, first success → `loading: false`, `status` populated
   - cwd changes → old poller stopped, new one started
   - Unmount → poller stopped (no dangling timers)
   - Fetch error → `error` set, previous `status` preserved
   - Invalid JSON from server → treated as error

Note: Hook tests may need a lightweight test runner that supports React hooks (or test the underlying createLanePoller integration directly). If React testing is not feasible with current test infrastructure, focus on the pure-function tests (formatHeartbeatAge, color mapping) and integration verification via `npm run build`.
</action>
<acceptance_criteria>
- `components/task-panel/DriverStatusBadge.test.mjs` exists
- `hooks/useLaneDriverStatus.test.mjs` exists
- Running test files exits with code 0
- Tests cover formatHeartbeatAge boundary cases
- Tests cover all 5 status color mappings
- `npm run build` succeeds with no type errors
</acceptance_criteria>
</task>

## Verification

```
npm test
npm run build
```

All tests pass. Build succeeds. The badge renders in the task panel header for all 5 daemon states.

## must_haves

- [ ] DriverStatusBadge renders discriminated union across all 5 states with heartbeat age display (UI-03)
- [ ] Client polling uses single-flight setTimeout, pauses while hidden, backoff on errors (UI-04 — via useLaneDriverStatus → createLanePoller)
- [ ] Co-located tests cover badge rendering, hook lifecycle, and heartbeat formatting (TEST-01)
