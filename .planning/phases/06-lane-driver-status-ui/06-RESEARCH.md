# Phase 06: Lane Driver Status UI — Research

**Researched:** 2026-10-15
**Method:** Parallel multi-model research (Claude (Explore) + MiniMax-M3 + claude-sonnet-5-5[1m] + claude-opus-5-5[1m] + gpt-6.1-sol + gpt-6-astra + qwen3.8-max)
**Requirements:** UI-01,UI-02,UI-03,UI-04,TEST-01

## Research Approach

| Track | Model | Status | Time |
|-------|-------|--------|------|
| local | Claude (Explore) | ok | — |
| minimax | MiniMax-M3 | ok | 29.3s |
| sonnet5 | claude-sonnet-5-5[1m] | ok | 77.0s |
| opus55 | claude-opus-5-5[1m] | ok | 84.1s |
| gpt | gpt-6.1-sol | ok | 99.9s |
| gpt6 | gpt-6-astra | ok | 126.4s |
| qwen38 | qwen3.8-max | ok | 299.1s |

---

## Local Codebase Analysis (Claude)

## 1. `lib/lock-schema.ts` — Types & Functions

**Types (L1–43):**
- `LockDataV1` — `{ schema?: undefined; pid: number; started_at?: string }`
- `LockDataV2` — `{ schema: 2; pid: number; proc_start: number; boot_id: string; instance_nonce: string; heartbeat_seq: number; heartbeat_at: string; state: "running" | "stopping" | "errored"; last_error: string | null }`
- `LockData = LockDataV1 | LockDataV2`
- `ParsedLock` — `{ data: LockData; schemaVersion: 1 | 2; identityVerified: boolean; raw: string }`
- `DaemonStatus = "running" | "stopped" | "errored" | "stale" | "unknown"` (L30–35)
- `DaemonStatusResult` — `{ status: DaemonStatus; reason: string; heartbeatAgeMs: number | null; schemaVersion: 1 | 2; identityVerified: boolean }` (L37–43)

**Functions:**
- `parseLockFile(filePath: string): ParsedLock | null` (L65) — reads file sync, parses JSON, validates v2 fields, returns null on any failure
- `deriveDaemonStatus(lock: ParsedLock | null, isAlive: (pid: number) => boolean): DaemonStatusResult` (L104) — handles: null→unknown, v1→running/stopped, v2→errored/stopped/stale/running. Stale threshold: `STALE_THRESHOLD_MS = 15_000` (L45)

## 2. `lib/extensions/lane-driver-manager.ts` — Key Exports

- `projectHash(cwd: string): string` (L18) — MD5 of lowercase cwd, first 12 hex chars
- `getDaemonStatus(stateHome: string, hash: string, aliveCheck?: (pid: number) => boolean): DaemonStatusResult` (L72–80) — constructs lock path as `path.join(stateHome, "lane-driver", \`${hash}.lock\`)`, calls `parseLockFile` + `deriveDaemonStatus`. Default alive check: `isProcessAlive`.
- Lock path pattern: `{stateHome}/lane-driver/{hash}.lock`

## 3. `lib/state-home.ts`

- `resolveStateHome(env?)` (L4) — returns `GSD_STATE_HOME` or `~/.gsd`

## 4. `lib/process-liveness.ts`

- `isProcessAlive(pid: number): boolean` (L1) — signal-zero check, ESRCH=false, EPERM=true

## 5. `components/task-panel/TaskPanel.tsx` — Integration Point

**Component signature (L300):**
```ts
export function TaskPanel({ cwd, sessionId, onCollapse, onTaskCounts })
```

**Header JSX (L358–429):** Flex row with `gap: 8`, height 36px, contains:
1. "Tasks" label (L372–383, flex: 1)
2. Task count summary spans (L384–389)
3. Collapse button (L391–403)
4. Refresh button (L404–428)

**Badge integration point:** Between "Tasks" label and task count summary (after L383, before L384).

**Existing patterns:**
- `Tag` component: pill style, `fontSize: 10, padding: "1px 5px", borderRadius: 4`
- `hexToRgba(hex, alpha)`: converts hex to rgba for semi-transparent backgrounds
- `BrailleSpinner`: animated spinner for active items
- Polling: `setInterval` at `pollMs` (configurable via layout prefs, default 5000ms)
- Color constants: in_progress: `#3b82f6`, pending: `#f59e0b`, completed: `#22c55e`

## 6. `components/task-panel/DispatchSection.tsx` — Polling Pattern

**No visibility gating** — uses plain `setInterval`. Phase 6 badge needs its own visibility-aware polling via `document.visibilitychange`.

## 7. `app/api/dispatch-status/route.ts` — API Pattern

1. Extract `cwd` from `searchParams`
2. Validate: must be absolute path
3. `getAllowedFileRoots()` → `isFilePathAllowed(cwd, roots)` → 403 if denied
4. Call lib function
5. Return JSON
6. Catch-all error handler returns 500

**For Phase 6:** Same pattern but return unknown status on errors — never 500.

## 8. `lib/file-access.ts` — Access Control

- `getAllowedFileRoots(): Promise<Set<string>>` — async, 5s TTL cache
- `isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean` — lexical check

## 9. Test Patterns

- `lock-schema.test.mjs`: Uses `jiti` directly, temp dirs, injectable `aliveCheck` stubs
- `lane-driver-manager.test.mjs`: `loadSubject()` with jiti fallback, `mockSpawner`/`mockAlive` stubs
- Common: `node:assert/strict`, `node:test`, temp dirs in beforeEach/afterEach, plain function stubs


---

## Minimax Research (MiniMax-M3)

# Code Review: Lane Driver Status UI

## Findings

### HIGH — Polling implementation violates single-flight contract when errors and visibility events interleave

**Files:** `components/task-panel/TaskPanel.tsx` (new polling block, ~lines 80-130), `app/api/lane-status/route.ts` (consumer side)

**Concrete failure scenario:** The `setTimeout`-based polling is described as "single-flight" (UI-04), but the existing `setTimeout` pattern in this codebase — visible in the DispatchSection reference and the TaskPanel `pollMs` interval — chains callbacks that schedule the next timer inside the previous fetch's resolution handler. If the document becomes hidden mid-fetch, the resolution handler still schedules the next `setTimeout`, so a poll fires against a stale, hidden-tab page; conversely, if `visibilitychange` fires while a fetch is in flight, the code starts a second parallel fetch instead of waiting for the in-flight one. UI-04 requires *one* in-flight request at a time.

**Fix:** Introduce an explicit `inFlight: boolean` guard. Pseudocode:
```ts
let inFlight = false;
const tick = async () => {
  if (inFlight || document.hidden) return;
  inFlight = true;
  try { await fetchStatus(); }
  finally { inFlight = false; scheduleNext(); }
};
```
On `visibilitychange` to visible, call `tick()` directly rather than resetting the timer. Schedule the next timer only inside the `finally` block, not in both `then` and the visibility handler.

---

### HIGH — `reason` field can leak absolute filesystem paths into rendered DOM

**Files:** `app/api/lane-status/route.ts` (exception handler), `components/task-panel/TaskPanel.tsx` (badge rendering)

**Concrete failure scenario:** The decision says "All exceptions caught — parse failures, I/O errors, missing files return `{status: "unknown", reason: "<description>"}`". The lock-file path resolution goes through `resolveStateHome()` and `projectHash()`, both of which embed `cwd`. If the daemon read fails because the lock file isn't found, a naive implementation will put the resolved path string into `reason`. The badge renders `reason` in the DOM (per "badge shows 'unknown' state with reason"). An absolute path is PII-adjacent in some deployments (multi-tenant CI runners, shared workstations) and an information disclosure in any case.

**Fix:** Restrict `reason` to a closed enum (`"lock-missing" | "parse-failed" | "io-error" | "not-initialized" | null`). Do not put any filesystem path or `cwd` into the DTO. Full diagnostics stay in server logs.

---

### HIGH — `cwd` query parameter is not validated before path resolution; mirrors existing `dispatch-status` hole

**Files:** `app/api/lane-status/route.ts` (handler entry)

**Concrete failure scenario:** The decisions say "cwd passed as query parameter with path validation — follows dispatch-status pattern exactly". The context summary lists `allowedFileRoots` as an existing helper, but it does not state that `dispatch-status` actually invokes it — only that it "validates cwd, check allowedFileRoots". If the new route copies the pattern literally and `dispatch-status` itself is incomplete (the summary is ambiguous), a request like `GET /api/lane-status?cwd=../../../etc` could escape the project tree and cause `resolveStateHome` to read an attacker-controlled `cwd`, producing a snapshot derived from a non-project location. This is an SSRF/local-file-read adjacent issue.

**Fix:** Explicitly call the `allowedFileRoots` check at the top of the handler and return `{status: "unknown", reason: "invalid-cwd"}` (400) on rejection. Do not rely on copy-paste from the dispatch route without verifying the check is actually present there first.

---

### MEDIUM — `heartbeatAge` rounding/formatting logic split between API and component creates a contract drift risk

**Files:** `app/api/lane-status/route.ts` (DTO serializer), `components/task-panel/TaskPanel.tsx` (badge formatter)

**Concrete failure scenario:** Decisions say heartbeat age is "5s" for <60s, "2m" for >=60s, hidden when null. If the API serializes `heartbeatAge` as ms (a number) and the component does the bucketing, then later someone changes the API to ISO or seconds, the badge silently shows wrong values. Conversely, if the API does the bucketing and returns a pre-formatted string, the UI cannot use it for sort/aria attributes. UI-03 names `heartbeatAge` as a discriminant input — the type matters.

**Fix:** API returns a raw `heartbeatAge: number | null` (ms since last heartbeat, or null). The badge component owns formatting. Add a comment in the route stating the unit. Test the boundary at exactly 59999ms / 60000ms in the co-located `.test.mjs`.

---

### MEDIUM — Exponential backoff cap and reset point are underspecified; UI-04 leaves room for drift

**Files:** `components/task-panel/TaskPanel.tsx` (poll scheduler), `app/api/lane-status/route.ts` (error surface)

**Concrete failure scenario:** Decisions say "double interval each error, cap at 60s, reset to 5s on success". The ambiguity: does a 4xx response (e.g., `invalid-cwd` from the validation finding) count as an error for backoff purposes? It probably shouldn't — backoff is for transport/server faults. If the implementation treats every non-2xx as an error, a permanently-bad-cwd will keep doubling to 60s, hammering the server once per minute forever with no operator signal. Also, a 200 with `{status: "unknown"}` is a success for backoff purposes but a degraded state — the badge should not flicker.

**Fix:** Define backoff trigger as `fetch threw` or `res.status >= 500`. Non-2xx <500 responses are terminal client errors — stop polling and surface "unknown" with a fixed retry or user-initiated refresh. 200-with-unknown is a normal polling success; do not change interval. Add explicit cases in the co-located test.

---

### MEDIUM — Race between `visibilitychange` handler registration and initial mount

**Files:** `components/task-panel/TaskPanel.tsx` (effect setup, `useEffect`)

**Concrete failure scenario:** If the polling effect's `useEffect` registers the `visibilitychange` listener and schedules the first tick in the same effect, React 18 strict-mode double-invocation will register the listener twice and start two timers in dev. The first fetch's resolution then schedules a second timer, leaving two timers alive. Single-flight guarantee violated only in dev — but TEST-01 edge cases must cover this.

**Fix:** Use a `useRef` for the listener and idempotent register pattern, or guard the effect body with a mounted-flag in conjunction with a single `inFlight` flag (see HIGH finding 1). Co-located test should mount/unmount the badge component twice in rapid succession and assert only one timer is scheduled.

---

### MEDIUM — TEST-01 compliance requires fixtures for malformed lock files; existing helpers not enumerated

**Files:** `lib/lock-schema.ts` (consumer of test fixtures), new `app/api/lane-status/route.test.mjs`

**Concrete failure scenario:** UI-02 says "Parse failures return `unknown` status, distinct from `stopped`". The `parseLockFile()` helper presumably throws on malformed JSON. TEST-01 requires co-located `.test.mjs` with edge cases. If the test file only covers the happy path and a missing-file case, a regression where `parseLockFile` returns `null` for a corrupt file (silently treated as `stopped`) will pass tests. The "distinct from stopped" requirement is the whole point of UI-02.

**Fix:** Add explicit fixtures: (1) `{}` empty object, (2) `{"schemaVersion": "wrong"}`, (3) truncated JSON, (4) JSON with extra unknown fields, (5) valid JSON but `heartbeat` is NaN, (6) valid JSON with `pid: 0`. Each must produce `status: "unknown"`, never `stopped`. Co-locate these fixtures in `route.test.mjs`.

---

### MEDIUM — `pid` field in DTO is a footgun for the "read-only" contract

**Files:** `app/api/lane-status/route.ts` (DTO), `lib/process-liveness.ts` (consumer)

**Concrete failure scenario:** Decisions include `pid (for debugging)` in the DTO. If the client (the badge component) starts using `pid` for liveness checks on the client side, it duplicates server work and may diverge — the server is authoritative. Worse, if a future feature exposes this DTO to other consumers (it is currently read-only but the contract is the contract), `pid` becomes a stable identifier for whatever the daemon controls, which is a privilege escalation surface.

**Fix:** Strip `pid` from the wire DTO. If operators need it for debugging, expose it under a separate `?debug=1` query or a different route. The badge only needs `status`, `heartbeatAge`, `reason`, `schemaVersion`, `identityVerified`.

---

### LOW — Color literal duplication with existing palette; risk of one-off drift

**Files:** `components/task-panel/TaskPanel.tsx` (badge styles)

**Concrete failure scenario:** The context summary lists an established palette: `#22c55e green, #3b82f6 blue, #f59e0b amber, #ef4444 red`. The badge decision adds `#6b7280` (gray for stopped) and `#64748b` (blue-gray for unknown) — both of which are not in the established palette. If a future dark-mode pass remaps the established four colors via CSS variables, these two ad-hoc literals will silently fall through.

**Fix:** Add `--status-stopped` and `--status-unknown` to the existing CSS-variable scheme in the panel, or inline the literals but add a comment that they are deliberately outside the standard four and must be revisited on the next palette pass. Only two new colors; one finding suffices.

---

## Summary

- **3 HIGH** findings: single-flight contract race on visibility+error overlap; `reason` leaking filesystem paths; `cwd` validation potentially missing despite the "follows dispatch-status pattern" instruction.
- **5 MEDIUM** findings: heartbeatAge contract drift; underspecified backoff triggers; strict-mode double-mount race; TEST-01 fixture coverage for UI-02; `pid` in read-only DTO.
- **1 LOW** finding: two color literals outside the established palette.

The HIGH cluster is the load-bearing concern — all three touch the API contract boundary, and two of them are amplified by the "follow dispatch-status pattern" instruction when the actual state of that pattern is ambiguous in the supplied context. Recommend resolving the dispatch-status validation question before implementation planning closes.

---

## Sonnet5 Research (claude-sonnet-5-5[1m])

# Polling Behavior: Research Findings

I did not run any code or open the repo. These findings come from the phase context and from standard browser and React semantics. Where I'm unsure, I say so.

## 1. Recommended architecture: a framework-free poller plus a thin hook

Put the scheduling logic in a plain module with injected dependencies. Wrap it in a small React hook. This is what makes TEST-01 cheap: the `.test.mjs` can drive the poller with fake timers and a fake document, with no React or jsdom.

```
lib/ or components/task-panel/
  lane-driver-poller.ts        # createLanePoller({fetchFn, setT, clearT, doc, baseMs, maxMs, onResult})
  lane-driver-poller.test.mjs
  useLaneDriverStatus.ts       # useEffect wiring only
  LaneDriverBadge.tsx          # presentational, discriminated union
```

`nextDelay` is a pure function:

```ts
export const BASE_MS = 5_000, MAX_MS = 60_000;
export const nextDelay = (errors: number) =>
  errors <= 0 ? BASE_MS : Math.min(BASE_MS * 2 ** errors, MAX_MS);
// errors: 0→5s, 1→10s, 2→20s, 3→40s, 4+→60s (capped)
```

This matches "double each error, cap 60s, reset on success". Clamp the exponent, or just rely on `Math.min`. `2 ** 1000` is `Infinity`, and `Math.min` still handles it.

## 2. Single-flight guarantee

`setTimeout` chaining gives single-flight only if the next timer is scheduled after the fetch settles. Three further guards are needed:

1. **One timer handle.** Keep it in a ref or closure variable. Every scheduling path (`schedule()`, the visibility handler, cleanup) calls `clearTimeout(handle)` first.
2. **An in-flight guard or abort.** The visibility handler can fire while a fetch is pending, for example hide then show quickly. Either skip when `inFlight` is true, or abort the old request and start a new one. Do the abort, because skipping can leave the badge showing stale data after a long hang.
3. **A generation counter.** Increment it on every start, stop, or cwd change. After each `await`, check `if (gen !== myGen) return;`. This stops a late response from an aborted or unmounted run from writing state or scheduling a timer.

```ts
export function createLanePoller({ fetchFn, onResult, doc = document,
  setT = setTimeout, clearT = clearTimeout, baseMs = 5000, maxMs = 60000 }) {
  let timer: any = null, errors = 0, gen = 0, ctrl: AbortController | null = null, running = false;

  const delay = () => Math.min(baseMs * 2 ** errors, maxMs);
  const clear = () => { if (timer != null) { clearT(timer); timer = null; } };

  async function tick() {
    clear();
    ctrl?.abort();                       // supersede any in-flight request
    const my = ++gen; ctrl = new AbortController();
    try {
      const r = await fetchFn(ctrl.signal);   // throws on network error / !ok / bad JSON
      if (my !== gen) return;
      errors = 0; onResult({ ok: true, data: r });
    } catch (e: any) {
      if (my !== gen || e?.name === 'AbortError') return;   // aborted ≠ error
      errors++; onResult({ ok: false, reason: String(e?.message ?? e) });
    }
    if (my === gen && running && doc.visibilityState === 'visible') timer = setT(tick, delay());
  }

  const onVis = () => {
    if (!running) return;
    if (doc.visibilityState === 'visible') tick();          // immediate fetch, then 5s cycle
    else { gen++; ctrl?.abort(); clear(); }                 // pause: kill timer + in-flight
  };

  return {
    start() { running = true; doc.addEventListener('visibilitychange', onVis);
              if (doc.visibilityState === 'visible') tick(); },
    stop()  { running = false; gen++; ctrl?.abort(); clear();
              doc.removeEventListener('visibilitychange', onVis); },
  };
}
```

## 3. Visibility gating details

- **Use `document.visibilityState === 'visible'`.** `document.hidden` is the legacy equivalent. The `visibilitychange` event fires on `document`, not `window`.
- **Initial state.** If the tab mounts hidden, for example a background tab restored by the browser, don't fetch. Wait for the first `visible`. The sketch above does this.
- **Hidden with a fetch in flight.** Abort it. Don't count the abort as an error, so the backoff counter isn't polluted.
- **Becoming visible:** fetch immediately, then resume the cycle. I recommend not resetting `errors` on becoming visible. If the server is still failing, the next delay should still be backed off. The success path resets it anyway. The spec doesn't say which, so this is my judgment call. The alternative is to reset on visible, which retries faster after a long hide.
- **Why pausing matters, beyond politeness.** Chromium throttles timers in hidden tabs to at most 1 per second, and "intensive throttling" can reduce wake-ups to about 1 per minute after a tab has been hidden for around 5 minutes. I'm fairly confident of this but have not re-verified it for current Chrome versions. Without gating, a hidden tab would still poll at irregular intervals.
- **Electron or a webview:** if the task panel ever runs in one, `visibilitychange` still works, but window occlusion may not map to `hidden` on every platform. I haven't verified this.

## 4. Error semantics: define what counts as an error

The API contract says the route never returns HTTP 500. Parse failures return `200 {status:"unknown", reason}`. That creates an ambiguity the context doesn't resolve:

| Event | Counts toward backoff? | Badge |
|---|---|---|
| `200` with `status:"unknown"` (server-side parse or I/O failure) | **No.** The server answered, and the poll cadence is fine. | `unknown` plus server reason |
| `fetch` rejects (network, server down) | **Yes** | client-synthesized `unknown`, reason like `"fetch failed: ..."` |
| Non-2xx (400 bad cwd, 404, proxy 502) | **Yes** | client-synthesized `unknown` |
| `200` with invalid JSON, or a DTO that fails shape validation | **Yes** | client-synthesized `unknown` |
| `AbortError` from our own abort | **No**, ignored | unchanged |

Recommendation: validate the DTO shape on the client with a small type guard before trusting it. Treat a missing or invalid `status` as an error, not a silent cast. Otherwise the discriminated union (UI-03) can be violated at runtime. Do not use toasts or alerts, per the decision.

**Flicker gotcha.** Setting the badge to `unknown` on the first transient failure makes it flash `running → unknown → running`. This follows the stated "badge shows unknown" decision, so I'd implement it as specified. A cheap option is to keep the last good snapshot and mark it stale only after 2 or more consecutive failures. That would be a design change, so raise it in planning rather than deciding silently.

## 5. Heartbeat age goes stale between polls

The DTO's `heartbeatAge` is computed server-side at request time. With backoff reaching 60s, the displayed "5s" can be 60s old. Two fixes, in order of preference:

- Have the DTO also carry an absolute `heartbeatAt` (ms epoch), or record `fetchedAt` client-side. Compute age as `Date.now() - heartbeatAt`. The daemon and UI share a machine, so clock skew is not a concern.
- The existing `minuteTick` pattern in TaskPanel could drive re-render. Age is shown at 5s or 1m granularity, so a 1s or 5s tick is overkill. Re-rendering on each poll plus the existing minute tick is enough.

If the DTO is kept as specified, `heartbeatAge` is only as fresh as the last successful poll. Document that in the DTO comment.

## 6. React specifics

- **Effect keyed on cwd.** `useEffect(() => { const p = createLanePoller(...); p.start(); return () => p.stop(); }, [cwd])`. Changing cwd tears down the old poller. The generation counter prevents the old response from landing.
- **StrictMode** (dev only) mounts, unmounts, and remounts effects. `stop()` must be fully idempotent and leave no timers or listeners. The sketch handles this.
- **Don't put state in the effect's dependency list.** Keep `errors`, the timer, and the abort controller inside the closure or refs. Otherwise each poll re-creates the poller.
- **Pass `onResult` through a ref** if it's an inline callback, to avoid re-subscribing.
- **Client fetch options:** `fetch(url, { cache: 'no-store', signal })`. This is redundant with the server headers, but harmless. Use `encodeURIComponent(cwd)` for the query parameter. Windows paths contain backslashes and colons.
- **Server-side cost:** every poll hits the filesystem (lock file read plus PID liveness). With one panel at 5s this is trivial. Several open tabs or panels multiply it, but they're all read-only, so it's not a correctness issue. There is no shared poller across components unless you lift the hook into a context. I'd avoid that now, since the badge is a single component.

## 7. Testing (TEST-01) edge cases

Use `node:test` with a fake clock. Prefer the injected `setT`/`clearT` shown above, and keep it simple. Don't depend on `mock.timers`. It exists in Node 20.4+ (`t.mock.timers.enable({ apis: ['setTimeout'] })`), but I'm unsure how stable it is across the repo's Node version, so check the version before relying on it. Injecting a manual fake scheduler (an array of `{fn, ms}` that the test fires by hand) is portable and fully deterministic.

Cases to cover:

1. `nextDelay`: 0→5000, 1→10000, 2→20000, 3→40000, 4→60000, 10→60000, a huge N stays capped, negative or NaN returns the base.
2. Success after N errors resets the next delay to 5000.
3. Never more than one pending timer. After any sequence, `pending.length <= 1`.
4. No overlapping fetches. With a slow fetch (a manually resolved promise), a visibility toggle does not produce two concurrent unaborted fetches.
5. Hidden → no timer scheduled, in-flight aborted, no error counted.
6. Hidden → visible triggers an immediate fetch, then a 5s timer after success.
7. Mounted while hidden → no fetch until visible.
8. A stale response (generation mismatch) is discarded: no `onResult` call, no timer.
9. `stop()` clears the timer and removes the listener. Calling it twice is safe.
10. Server `unknown` is not counted as an error. A rejected fetch, non-ok response, or bad shape is counted.
11. `AbortError` is not counted as an error.

For the API route, validate the cwd (traversal, a path outside allowedFileRoots, a missing param). Check that a thrown exception becomes `200 {status:"unknown"}` and that the `Cache-Control: no-store` header is present. Assert on `dynamic === "force-dynamic"`.

**Gotcha: `.test.mjs` importing `.ts`.** A `.mjs` test can't import `.ts` directly on older Node. Native type stripping needs Node 22.6+ with `--experimental-strip-types`, and it's on by default in newer releases (I believe 22.18+/23.6+). Also, `.ts` imports need explicit extensions. I can't see the repo's tooling. Check how existing tests such as `lock-schema` are run (tsx, a loader, or compiled output) and mirror that. If there's no existing mechanism, writing the poller as `.mjs` with JSDoc types avoids the problem.

## 8. Risks summary

| Risk | Severity | Mitigation |
|---|---|---|
| Overlapping requests from visibility toggles | Medium | Single timer handle, abort in-flight, generation guard |
| Late response overwriting newer state | Medium | Generation counter |
| Server `unknown` vs. transport failure conflated | Medium | Explicit classification (table in §4) |
| Heartbeat age looks stale under backoff | Low–Med | Return `heartbeatAt`, or compute age client-side |
| StrictMode double-mount leaks a timer | Medium | Idempotent `stop()` |
| Unvalidated JSON breaks the union | Medium | Client type guard |
| Badge flicker on a single failure | Low | Spec-compliant as is; optional N-failure hysteresis (needs a decision) |
| `.mjs` test can't import `.ts` | Medium | Match the existing test-runner setup |

## Open questions for planning

- Should a server-side `unknown` reset or advance backoff? I recommend neither: treat it as a successful poll.
- Should `errors` reset on becoming visible? I recommend no.
- Should the DTO add `heartbeatAt` or `fetchedAt`? I recommend yes, for UI-03's age display.


---

## Opus55 Research (claude-opus-5-5[1m])

# Research: Lane Driver Status UI, API Contract (UI-01, UI-02)

**Source availability:** The review scratch directory (`gsd-review-scratch-71276`) has no checked-out files. That means I could not open `dispatch-status/route.ts`, `lib/lock-schema.ts`, `lane-driver-manager.ts`, `state-home.ts`, `process-liveness.ts` or `TaskPanel.tsx`. Every statement below about those modules comes from the phase context, not from their source, and is tagged **UNVERIFIED-CONTRACT**. The Next.js and React advice is standard framework behaviour. The planner must confirm the tagged items before locking the plan.

## 1. Route skeleton (UI-01)

```ts
// app/api/lane-driver-status/route.ts
import { NextResponse, type NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const revalidate = 0;          // belt-and-braces for older Next
export const runtime = "nodejs";      // fs + process.kill(pid,0) need Node, never edge

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  const v = validateCwd(cwd);          // reuse dispatch-status validator — do NOT re-implement
  if (!v.ok) return NextResponse.json(v.body, { status: v.status, headers: NO_STORE });
  try {
    return NextResponse.json(await buildSnapshot(v.path), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(unknownDto(`internal: ${errMsg(e)}`), { headers: NO_STORE });
  }
}
```

Gotchas:
- **Pin the Node runtime.** `runtime = "nodejs"` is required. On the edge runtime, `fs` and `process.kill` break and fail as a 500 at build or run time.
- **Put `no-store` on every response,** including the 400/403 validation paths. If it is missing there, a browser or proxy can cache a rejection.
- **Read `cwd` from the request, not module scope.** Using `req.nextUrl` already makes the route dynamic. Keep `force-dynamic` anyway, as the requirement says, so a later refactor can't silently make it static.
- **The "never 500" rule needs a clear boundary.** Path-validation failures should keep the dispatch-status status codes (400/403). Those are caller errors, not daemon state. Only *daemon-read* failures become `200 {status:"unknown"}`. Write this distinction into the plan so the "never 500" requirement isn't read as "never non-200".

## 2. Path validation: reuse, don't copy (UNVERIFIED-CONTRACT)

- **Extract the shared validator.** The context says to follow dispatch-status "exactly". If `dispatch-status/route.ts` has its cwd/`allowedFileRoots` check inline, move it into `lib/validate-cwd.ts` first, as its own commit with tests. Then both routes import it. Copying it creates two security checks that will drift apart.
- **Properties the validator must have** (check them in the existing one):
  - It rejects a missing or empty cwd.
  - It runs `path.resolve` and then `fs.realpath` before checking roots, so `..` and symlink/junction escapes are caught. Junctions matter on Windows.
  - It compares case-insensitively on win32.
  - Its prefix check requires a separator, so `C:\root` must not match `C:\rootevil`.
  - If the existing validator lacks any of these, file a gap rather than inheriting the hole.

## 3. DTO: discriminated union, shared by server and client (UI-02, UI-03)

```ts
// lib/lane-driver-status-dto.ts  (pure, no fs — importable by the client component)
export type LaneDriverStatus = "running" | "stopped" | "errored" | "stale" | "unknown";
interface Base {
  schemaVersion: number | null;
  heartbeatAgeMs: number | null;   // null for v1 locks / no lock
  identityVerified: boolean;
  pid: number | null;
  lastError: string | null;
  reason: string;                  // always populated, human-readable
}
export type LaneDriverStatusDto =
  | (Base & { status: "running" })
  | (Base & { status: "stopped" })
  | (Base & { status: "errored" })
  | (Base & { status: "stale" })
  | (Base & { status: "unknown" });
export function unknownDto(reason: string): LaneDriverStatusDto { /* all-null base */ }
export function isLaneDriverStatusDto(x: unknown): x is LaneDriverStatusDto { /* runtime guard */ }
```

Key decisions:
- **"No lock file" is `stopped`, not `unknown`.** A missing file is a normal state. UI-02 limits `unknown` to failures: parse errors, schema mismatches, EACCES/EBUSY reads, an unrecognised status from `deriveDaemonStatus`. The context text lists "missing files" under `unknown`, which conflicts with UI-02's "distinct from stopped". Resolve this explicitly, and I'd go with `stopped`. Note that ENOENT can also happen *while the daemon is rewriting the lock*. If the lock is written by temp-file plus rename, treat that as a transient `stopped`; don't retry inside the route.
- **Compute heartbeat age on the server, then clamp it.** Use `Math.max(0, Date.now() - heartbeatTs)`. Return `null` when the timestamp is absent or not finite. Clock skew must never produce a negative age.
- **Map statuses through an exhaustive `switch`.** Map `DaemonStatusResult` to the DTO with a `never` check, so a new status added in `lock-schema.ts` breaks the compile instead of rendering wrongly. Unrecognised runtime values become `unknown` with reason `unrecognised status "<x>"`.
- **Validate on the client too.** The client should run `isLaneDriverStatusDto` on `res.json()`. A malformed body becomes local `unknown`, which covers proxies and HTML error pages.
- **Limit what `pid` and `lastError` leak.** `pid` is fine on a local tool. Truncate `lastError` to around 500 characters and remove absolute paths outside the validated cwd if the error text can contain them.

## 4. Data-source reuse (UNVERIFIED-CONTRACT)

- **Wrap `getDaemonStatus`, don't recompose it.** Prefer `getDaemonStatus(cwd)` from `lane-driver-manager.ts`, since it already composes `resolveStateHome`, `projectHash`, `parseLockFile`, `isProcessAlive` and `deriveDaemonStatus`. Rebuilding that chain in the route creates a second lock-path resolver that will drift.
- **Check its error behaviour.** Find out whether `getDaemonStatus` throws or returns an error variant on parse failure. If it already swallows parse errors into `stopped`, UI-02 can't be met without changing it. That is the most likely hidden blocker.
- **Check that it is side-effect free.** `getDaemonStatus` must not clean up stale locks or spawn anything. A GET polled every 5 seconds must stay read-only (UI-01). If it does have side effects, call the pure `parseLockFile` + `deriveDaemonStatus` pair directly.
- **Liveness on Windows.** `process.kill(pid, 0)` works on Windows but doesn't detect PID reuse. That is what `identityVerified` is for, so pass it through unchanged rather than re-deriving it.

## 5. Client polling (UI-04)

```ts
function useLaneDriverStatus(cwd: string) {
  const [dto, setDto] = useState<LaneDriverStatusDto | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let delay = 5000, disposed = false, inFlight = false;
    const schedule = () => { if (!disposed && !document.hidden) timer = setTimeout(tick, delay); };
    const tick = async () => {
      if (inFlight) return; inFlight = true; ctrl = new AbortController();
      try {
        const r = await fetch(`/api/lane-driver-status?cwd=${encodeURIComponent(cwd)}`,
                              { cache: "no-store", signal: ctrl.signal });
        const j = r.ok ? await r.json() : null;
        if (disposed) return;
        if (j && isLaneDriverStatusDto(j)) { setDto(j); delay = 5000; }
        else { setDto(unknownDto(`HTTP ${r.status}`)); delay = Math.min(delay * 2, 60000); }
      } catch (e) {
        if (disposed || (e as Error).name === "AbortError") return;
        setDto(unknownDto(`fetch failed: ${(e as Error).message}`)); delay = Math.min(delay * 2, 60000);
      } finally { inFlight = false; schedule(); }
    };
    const onVis = () => { clearTimeout(timer); if (!document.hidden) { tick(); } };
    document.addEventListener("visibilitychange", onVis);
    tick();
    return () => { disposed = true; clearTimeout(timer); ctrl?.abort();
                   document.removeEventListener("visibilitychange", onVis); };
  }, [cwd]);
  return dto;
}
```

Gotchas:
- **Abort and clear on cleanup.** React StrictMode mounts effects twice in dev, and `cwd` can change. Without the abort/clear in cleanup you get two polling loops.
- **Hold back the visibility fetch while one is in flight.** If a request is running when the tab becomes visible, the `inFlight` check skips the extra tick, and `finally` reschedules. Clear the pending timeout before any immediate fetch.
- **Don't reset the backoff on visibility.** Becoming visible should keep the current backoff delay, or a failing server gets hit every time the user switches tabs. The context only says "resume 5s cycle"; confirm that intent.
- **Use the right "pending" state.** `null` before the first response means "loading". Render it as `unknown` with reason "loading" or as a neutral dot, not as `stopped`.
- **Make the hook testable.** For TEST-01 under `node --test`, move the scheduler into a pure factory, e.g. `createPoller({fetchFn, setTimeoutFn, isHidden, onResult})` in a `.mjs`-testable module. The hook becomes a thin wrapper. A React hook can't be unit-tested in plain `.test.mjs` without jsdom.

## 6. Badge formatting

`formatAge(ms)`:
- `null` → hidden.
- Under 60,000 ms → `${Math.floor(ms/1000)}s`.
- Otherwise → `${Math.floor(ms/60000)}m`.
- Values over an hour (e.g. 90m) aren't specified. Decide whether to add an `h` unit.

Keep colours in one `STATUS_COLOR: Record<LaneDriverStatus,string>` map typed exhaustively. Re-use TaskPanel's existing palette constants if they exist (UNVERIFIED) instead of hard-coding hex values a second time.

## 7. Test matrix (TEST-01)

| Module | Must-have cases |
|---|---|
| `validate-cwd` | missing, relative, `..` escape, prefix-sibling (`rootevil`), case variance on win32, symlink/junction escape |
| route / `buildSnapshot` | no lock → stopped; corrupt JSON → unknown (≠ stopped); v1 schema → heartbeatAgeMs null; future heartbeat → age 0; EACCES → unknown; thrown getDaemonStatus → 200 unknown; every response has `no-store`; `dynamic === "force-dynamic"` exported |
| DTO guard | each of the 5 statuses accepted; extra status rejected; missing `reason` rejected |
| poller | single-flight (slow fetch, no overlap); backoff 5→10→20→40→60→60; reset on success; hidden pauses; visible triggers immediate fetch; dispose aborts and stops scheduling |
| `formatAge` | null, 0, 59999, 60000, negative input |

**Risk:** importing a `route.ts` from `.test.mjs` needs a TypeScript loader such as `tsx`, or the logic has to live in a plain `.mjs`/compiled lib. Check how the existing co-located tests import TypeScript (UNVERIFIED) before choosing where the files go.

## Open items for the planner
1. Is "missing lock" `stopped` or `unknown`? The context and UI-02 disagree.
2. What does `getDaemonStatus` do on a parse error, and does it have side effects?
3. Can the dispatch-status validator be extracted, and does it resolve symlinks and handle win32 case?
4. How are TypeScript modules loaded in `.test.mjs`?


---

## Gpt Research (gpt-6.1-sol)

The supplied material is an architecture summary, so these findings concern the planned behavior, not confirmed implementation defects. Locations use the supplied component and intended polling effect; no source line numbers were provided.

### 1. MEDIUM — Visibility-triggered fetching needs the same single-flight guard

**Location:** `components/task-panel/TaskPanel.tsx` — planned status polling effect; **Polling Behavior**, immediate fetch on becoming visible.

Recursive `setTimeout` prevents overlap within its own polling chain, but the visibility handler creates another fetch entry point. A request can start, the tab can become hidden, and then become visible before that request finishes; an unconditional immediate fetch starts a second request, violating UI-04. Both completions can then schedule separate polling chains. Route every trigger through one guarded polling function. On hide, clear the scheduled timer; on show, request a refresh through that function. If a request is already running, queue one refresh after it settles. Schedule subsequent polling only while the effect remains active and the document is visible.

### 2. MEDIUM — Define how HTTP-successful observation failures affect backoff

**Location:** `components/task-panel/TaskPanel.tsx` — planned polling response handler; **API Contract**, exception-to-`unknown` responses. **UNVERIFIED-CONTRACT:** the route implementation was not supplied.

The stated API contract represents read and parse failures as JSON with `status: "unknown"` rather than HTTP 500, while the polling contract resets its interval on “success.” Without an explicit application-level success definition, a persistent malformed lock file can produce successful HTTP responses every five seconds and repeatedly reset backoff. Implement the failure counter around the decoded observation, including fetch failures, JSON failures, and the specified `unknown` failure responses:

```ts
const observationFailed =
  !response.ok || snapshot.status === "unknown";
```

Continue rendering the returned reason while backing off. Valid observations of an `errored`, `stale`, or `stopped` daemon should retain the normal polling interval.

### 3. MEDIUM — A pending request can suspend polling indefinitely

**Location:** `components/task-panel/TaskPanel.tsx` — planned asynchronous status polling effect; **Polling Behavior**, schedule the next request using `setTimeout`.

Single-flight polling schedules its next attempt after the current attempt settles. A stalled API read or response body can leave that attempt pending indefinitely: no rejection occurs, backoff never starts, and the badge stops refreshing. Catching exceptions in the route does not bound operations that remain pending. Add a request deadline, such as ten seconds, using an `AbortController`; keep it active through response-body parsing, clear its timer in `finally`, and handle timeout through the existing error/backoff branch. Add a co-located test with a fetch that remains pending until aborted, asserting that the timeout releases the flight and schedules exactly one retry.

---

## Gpt6 Research (gpt-6-astra)

The supplied material is a design brief, not a source diff. These are planning findings; locations identify the declared component integration point.

1. **MEDIUM — The compact badge omits the required failure reason.**  
   **Location:** `components/task-panel/TaskPanel.tsx` — `TaskPanel` header, planned status badge. The specified layout includes only a dot, status text, and heartbeat age, while the polling decision requires errors to show “unknown” **with a reason**. After a parse or I/O failure, the proposed rendering would show indistinguishable `unknown` badges despite different causes. Preserve the compact layout by adding a keyboard-accessible details control that exposes `reason`, and `lastError` when present. Test that an unknown snapshot’s reason is available through that control.

2. **MEDIUM — Dynamic status changes need an explicit accessibility contract.**  
   **Location:** `components/task-panel/TaskPanel.tsx` — planned status badge rendering. The design specifies visual changes but no announcement behavior. If implemented as ordinary spans, a transition from `running` to `errored` while focus remains elsewhere will not reliably notify screen-reader users. Add a separate polite live region whose content changes only when the status or reason changes. Keep the ticking heartbeat age outside it so polling does not produce repeated announcements.

   ```tsx
   <span role="status" aria-live="polite" aria-atomic="true">
     {statusAnnouncement /* status and reason; exclude heartbeat age */}
   </span>
   ```

   Test that changing only `heartbeatAge` leaves the announcement unchanged.

3. **MEDIUM — Visibility refresh needs coordination with an outstanding request.**  
   **Location:** `components/task-panel/TaskPanel.tsx` — planned badge polling integration. The design attributes single-flight behavior to `setTimeout`, but also introduces an independent immediate fetch on visibility restoration. If a request is pending when the user hides and restores the tab, that immediate fetch can overlap it, violating **UI-04**. Responses arriving out of order can then replace a newer badge state with an older one. Route both timer and visibility events through one refresh function with an `inFlight` guard. Clear pending timers when hidden; when becoming visible during an existing request, reuse that request and schedule the next poll after settlement. Add a deferred-request test covering hide/show during a fetch and assert that maximum concurrent requests remains one.

---

## Qwen38 Research (qwen3.8-max)

<!-- QwenCLI: model=qwen3.8-max model_requested=qwen3.8-max model_resolved=qwen3.8-max elapsed=298.4s -->

## Scope & Evidence Note

**No code packet was present in the input.** The material I received is the phase context summary (decisions + reusable-asset list), not source files. I did not read `lib/lock-schema.ts`, `lib/extensions/lane-driver-manager.ts`, `components/task-panel/TaskPanel.tsx`, or `app/api/.../dispatch-status/route.ts`, and I cannot run tools in this session.

So this is an **architecture-level review of the documented design decisions**, per the review calibration's architecture clause: I cite module paths, DTO fields, and the stated decision text instead of file:line. Anything that depends on the behavior of an existing module I have not read is tagged **UNVERIFIED-CONTRACT** and capped at MEDIUM. Two findings cite a *requirement* (UI-02/UI-03/UI-04) contradicted by the *decision text supplied inline* — those are verifiable from the packet alone and are rated HIGH.

Verification commands the implementer should run before trusting any UNVERIFIED item are collected at the end.

---

## Findings

| # | Sev | Area | Summary |
|---|-----|------|---------|
| 1 | HIGH | Polling | "Immediate fetch on visible" breaks the single-flight guarantee UI-04 requires |
| 2 | HIGH | API contract | "missing files → `unknown`" makes `stopped` unreachable, contradicting UI-02/UI-03 |
| 3 | MED | DTO | Relative `heartbeatAge` freezes between polls and cannot drive `stale` |
| 4 | MED | Enum | `errored` has no defined producer |
| 5 | MED | Enum | `identityVerified` / `lastError` have no defined effect on `status` |
| 6 | MED | win32 | `cwd` query-param encoding and root-prefix comparison on Windows |
| 7 | MED | Polling | Hidden tab must *cancel* the pending timer; backoff-reset rules undefined |
| 8 | MED | Polling | Backoff trigger ambiguous: `unknown` payload vs transport failure |
| 9 | MED | Redundancy | Two status readers + a third poll loop inside TaskPanel |
| 10 | MED | Next.js | `force-dynamic` does not imply `nodejs` runtime or a client-side no-cache |
| 11 | MED | React | First-paint/hydration determinism of the age label |
| 12 | MED | TEST-01 | `.test.mjs` cannot import `.ts` without a type-stripping runner; hook must be clock-injectable |
| 13 | LOW | Formatting | `formatAge` has no hour/day tier |
| 14 | LOW | Security | `pid` + `lastError` disclosure on a LAN-bound dev server |

---

### 1. HIGH — `visibilitychange` immediate fetch violates UI-04 single-flight

**Cited contract:** UI-04 — "Client uses single-flight `setTimeout` polling". Decision text: *"On visibility change (document.visibilitychange): immediate fetch when becoming visible, resume 5s cycle."*

**Failure scenario (deterministic):** the poll chain issues a fetch that takes ~2s (cold filesystem, AV scanning the state dir on Windows). The user switches back to the tab at t=1s. The visibility handler fires a second fetch while the first is still in flight. Now:

- Two requests overlap → single-flight is broken, which is the exact property UI-04 exists to guarantee.
- The t=0 response can land *after* the t=1s response and overwrite fresher state (`setStatus` has no ordering guard).
- The original chain's `setTimeout` is still pending, so after the visibility fetch schedules its own timer you have **two live timer chains** permanently. Request rate doubles; every subsequent visibility toggle can double it again.

**Fix:** route *all* fetches through one guarded function and make the visibility handler cancel-then-reschedule rather than fire-and-forget.

```ts
const inFlight = useRef(false);
const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

function cancel() {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
}

async function tick(opts: { immediate: boolean }) {
  cancel();
  if (inFlight.current) return;          // single-flight: drop, don't queue
  if (document.visibilityState === "hidden") return;
  inFlight.current = true;
  try {
    const snap = await fetchSnapshot(cwd, signal);
    setSnapshot(snap); delay.current = BASE_MS;
  } catch (e) {
    setSnapshot(unknownFrom(e)); delay.current = Math.min(delay.current * 2, MAX_MS);
  } finally {
    inFlight.current = false;
    if (document.visibilityState === "visible") schedule();
  }
}

function schedule() { cancel(); timer.current = setTimeout(() => tick({ immediate: false }), delay.current); }
```

If the in-flight response is considered too old on tab return, abort it (`AbortController`) instead of racing it — but do not run both.

---

### 2. HIGH — "missing files return `unknown`" makes `stopped` unreachable

**Cited contract:** UI-02 — "Parse failures return `unknown` status, **distinct from `stopped`**"; UI-03 — union includes `stopped`. Decision text: *"parse failures, I/O errors, **missing files** return `{status: "unknown", reason: "<description>"}`."*

**Failure scenario:** on a fresh checkout, or any project that has never started the lane driver, the lock file does not exist. Under the decision as written the route returns `unknown`, so the badge renders blue-gray "unknown" forever and the gray `stopped` state — the single most common real-world state — is never displayed. Worse, the user cannot distinguish "daemon is not running" (benign, actionable: start it) from "lock file exists but is corrupt" (needs investigation). That is precisely the distinction UI-02 mandates.

**Fix:** classify by errno in the route (or in `getDaemonStatus()`, whichever owns the read — see Finding 9):

```ts
try {
  raw = await fs.readFile(lockPath, "utf8");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "ENOENT")
    return NextResponse.json({ status: "stopped", heartbeatAge: null, reason: "no-lock-file", schemaVersion: null, identityVerified: false, pid: null, lastError: null }, { headers: NO_STORE });
  return unknown(`lock-read-failed:${(e as NodeJS.ErrnoException).code}`);   // EACCES, EISDIR, EBUSY…
}
// JSON/schema parse failure → unknown("lock-parse-failed")
```

Also decide the `ENOTDIR`/`EISDIR` case explicitly — a stale path component on Windows surfaces as one of those, and it is a genuine `unknown`, not `stopped`.

---

### 3. MEDIUM — Relative `heartbeatAge` in the DTO freezes the displayed age and cannot drive `stale`

**Declaration cited:** DTO field `heartbeatAge (ms or null)`; decision *"Heartbeat age displayed as '5s' for <60s, '2m' for >=60s."*

**Failure scenario:** the value is computed at request time on the server, then rendered by the client. Between polls the label never changes, so the UI shows a fixed "5s" for five seconds, then jumps to "10s", "15s" — the age visibly ticks in 5s steps and can never show "0s"/"1s", which reads as broken to a user watching a heartbeat. Second, worse case: any client-side staleness logic ("if age > 60s show `stale`") is impossible, because age only advances at poll boundaries; and if a poll fails silently the last known age is reused indefinitely with no indication it is a cached value.

**Fix:** return the absolute timestamp *and* keep the derived age for convenience, and recompute the label on a 1s client tick (TaskPanel already has a `minuteTick` pattern to mirror — reuse its shape rather than inventing a second one):

```ts
// DTO
{ status, heartbeatAt: number | null, heartbeatAge: number | null, /* … */ }

// component — never during render of a server component
const [, force] = useReducer((n: number) => n + 1, 0);
useEffect(() => { const id = setInterval(force, 1000); return () => clearInterval(id); }, []);
const label = snapshot.heartbeatAt == null ? null : formatAge(Date.now() - snapshot.heartbeatAt);
```

Status must still come from the server (Finding 5) — the client tick changes only the *label*, never the *state*.

---

### 4. MEDIUM (UNVERIFIED-CONTRACT) — `errored` has no producer

**Declaration cited:** UI-03 union `running | stopped | errored | stale | unknown`; decision *"All exceptions caught — parse failures, I/O errors, missing files return `{status: "unknown", …}`."*

**Failure scenario:** every documented failure path is mapped to `unknown`. Nothing in the stated design emits `errored`. The red badge is dead code, the `#ef4444` decision is untestable, and TEST-01 cannot produce a case that reaches it. When someone later discovers the daemon writes a failure marker into the lock file, they will bolt a client-side override on top, creating two competing sources of truth for `status`.

**Fix:** define `errored` as *daemon-reported* failure and emit it server-side from `deriveDaemonStatus()` — e.g. the lock record parses cleanly but carries a non-null `lastError`/non-zero exit marker. Then assert reachability in the route test:

```js
// app/api/lane-driver-status/route.test.mjs
assert.equal((await route({ cwd: fixtures.erroredLock })).status, "errored");
```

If `deriveDaemonStatus()` already returns `errored` for some input, cite that input in the plan; if it does not, either drop the member from the union or add the producer — do not ship an unreachable state.

---

### 5. MEDIUM (UNVERIFIED-CONTRACT) — `identityVerified` / `lastError` have no defined effect on `status`

**Declaration cited:** DTO includes `identityVerified`, `pid`, `lastError`; decision lists badge rendering only in terms of `status` + age.

**Failure scenario:** the lock file exists and its heartbeat is fresh, but it belongs to a *different* project (hash mismatch) or an unverified writer. The route returns `identityVerified: false` with `status: "running"`. The badge renders green. The user believes their lane driver is alive when the snapshot actually describes another daemon. This is an incorrect-behavior-under-normal-conditions bug on a multi-project machine, and it is invisible in the UI.

**Fix:** fold identity into the server-side derivation so the client never has to combine flags:

```ts
if (parsed.identityVerified === false)
  return { status: "unknown", reason: "identity-unverified", /* … */ };
```

Rule to write into the plan: **`status` is derived exclusively server-side; the component is a pure function of `status` + `heartbeatAt`.** Any client-side `if (identityVerified === false) …` override is a defect.

---

### 6. MEDIUM (UNVERIFIED-CONTRACT) — `cwd` query-param handling on win32

The host OS is `win32`, and this user's home directory contains paths with spaces (`Creative Cloud Files …`, `3D Objects`). Two independent traps:

**(a) Encoding.** `URLSearchParams` / Next's query parser decode `+` as a space. Building the URL by concatenation breaks on both spaces and `+`:

```ts
// WRONG — space becomes a truncated cwd; '+' becomes a space
fetch(`/api/lane-driver-status?cwd=${cwd}`);
// RIGHT
fetch(`/api/lane-driver-status?${new URLSearchParams({ cwd }).toString()}`);
```

**(b) Root-prefix comparison.** A raw `startsWith(allowedRoot)` check fails on Windows when the drive letter case differs (`c:\…` vs `C:\…`), when separators are mixed (`C:/Users/…` from a JS-produced path vs `C:\Users\…` from config), or when the incoming path has a trailing separator. Fail-closed means a legitimate panel silently shows `unknown`.

```ts
import path from "node:path";
const norm = (p: string) => path.resolve(p).toLowerCase();   // win32 only; keep case-sensitive on posix
const requested = norm(cwdParam);
const allowed = allowedFileRoots.some((r) =>
  requested === norm(r) || requested.startsWith(norm(r) + path.sep));
if (!allowed) return NextResponse.json({ status: "unknown", reason: "cwd-not-allowed", … }, { headers: NO_STORE });
```

Note the `+ path.sep` — without it, `C:\Users\bob-evil` passes a `C:\Users\bob` root check. If `dispatch-status/route.ts` already does this, reuse it verbatim (Finding 9); if it does a bare `startsWith`, this bug already exists there and should be fixed in one shared helper, not duplicated.

---

### 7. MEDIUM — Hidden tab must cancel the pending timer; backoff-reset rules are undefined

**Decision cited:** *"pause polling while tab hidden"*; *"double interval each error, cap at 60s, reset to 5s on success."*

**Failure scenario:** polling is "paused" by checking `visibilityState` inside the tick, but the `setTimeout` is left armed. Chrome throttles — it does not suspend — background timers (aligned to ~1/min), so requests continue all night on a hidden tab. That violates the stated pause behavior and burns the filesystem/AV path repeatedly. Second: if the tab is hidden *while in 60s backoff* and the daemon recovers, the reset-to-5s only happens on a success — but no fetch occurs while hidden, so on return the immediate fetch runs at whatever delay was pending. The decisions never say whether the visibility fetch uses `delay.current` or `BASE_MS`.

**Fix:** make visibility a first-class state transition that cancels and re-arms, and specify the reset rule in the plan:

```ts
useEffect(() => {
  const onVis = () => {
    if (document.visibilityState === "visible") { delay.current = BASE_MS; tick({ immediate: true }); }
    else cancel();                                  // do not leave a timer armed
  };
  document.addEventListener("visibilitychange", onVis);
  return () => { document.removeEventListener("visibilitychange", onVis); cancel(); };
}, [cwd]);
```

Write down: **becoming visible resets backoff to `BASE_MS` before the immediate fetch**, so a recovered daemon is picked up at 5s cadence rather than 60s.

---

### 8. MEDIUM — Backoff trigger is ambiguous between `unknown` payloads and transport failures

**Decision cited:** the route *"never HTTP 500"* — all failures return 200 with `status: "unknown"`. The client backs off *"on errors"*.

**Failure scenario:** since the route never returns a non-2xx, `res.ok` is always true and a naive `catch`-based backoff never fires. Two bad resolutions are equally likely: (i) backoff never happens, so a dev server that is down is hammered every 5s (fetch throws → this path *does* hit `catch`, fine); or (ii) someone implements "back off when `status === 'unknown'`", which means a genuinely corrupt lock file pushes the badge to a 60s refresh — the user fixes the lock file and waits up to a minute for the green badge, with no feedback about why.

**Fix, stated explicitly in the plan:**

| Condition | Status shown | Backoff? |
|---|---|---|
| fetch rejects / non-2xx / malformed JSON body | `unknown` (`reason: "fetch-failed"`) | yes, ×2 capped 60s |
| HTTP 200 with `status: "unknown"` (parse/IO/identity) | `unknown` (server `reason`) | **no** — keep 5s |

Validate the body shape before trusting it (`typeof body.status === "string"`), otherwise a proxy error page parsed as JSON throws inside the `try` and is misattributed.

---

### 9. MEDIUM (UNVERIFIED-CONTRACT) — Redundancy: two status readers and a third poll loop

**Assets cited:** `lib/lock-schema.ts` (`parseLockFile()`, `deriveDaemonStatus()`), `lib/extensions/lane-driver-manager.ts` (`getDaemonStatus()`, `projectHash()`), `lib/state-home.ts` (`resolveStateHome()`), `lib/process-liveness.ts` (`isProcessAlive()`); plus *"TaskPanel uses setInterval at configurable pollMs; DispatchSection has its own polling."*

**Failure scenario:** the new route re-implements `resolveStateHome()` + `projectHash()` + `readFile` + `parseLockFile()` inline because that is faster than tracing `getDaemonStatus()`. Six months later the lock schema gains a field; `lib/lock-schema.ts` is updated; the route keeps its own copy of the derivation and silently reports `unknown`/`running` for a state the extension layer classifies differently. Same for the UI: TaskPanel already runs an interval, DispatchSection runs another, and the badge adds a third — three timers, two of which hit daemon-state endpoints, in one panel that already re-renders on `minuteTick`.

**Fix:**
1. The route body should be *only* cwd validation + `getDaemonStatus()` + DTO mapping + `NO_STORE`. If `getDaemonStatus()` cannot express `stopped` vs `unknown` (Finding 2) or `errored` (Finding 4), extend it there — one derivation, all consumers.
2. Before adding a timer, confirm whether TaskPanel's existing `pollMs` loop can carry the badge snapshot. If it cannot (different endpoint, different cadence), say why in the plan; otherwise reuse the loop and drop the second one.
3. Extract the cwd-validation + allowed-roots check into a shared helper used by both `dispatch-status` and the new route (see Finding 6b).

Verification: `grep -rn "getDaemonStatus\|deriveDaemonStatus\|parseLockFile" --include=*.ts --include=*.tsx .` — if the new route does not appear in the `getDaemonStatus` consumer list, it has duplicated the derivation.

---

### 10. MEDIUM (UNVERIFIED-CONTRACT) — `force-dynamic` covers neither the runtime nor the client cache

**Decision cited:** *"Route uses `export const dynamic = "force-dynamic"` and `Cache-Control: no-store` headers."*

Three separate mechanisms are being conflated:

- `dynamic = "force-dynamic"` opts out of **Next's prerender/route cache**. It says nothing about the runtime.
- Reading the filesystem requires the **Node runtime**. If the project sets a global edge default (`runtime = "edge"` in a layout/route, or an edge-oriented `next.config`), `node:fs` fails at build or throws at request time — and per the decision the exception is swallowed into `{status:"unknown"}`, so the badge is permanently blue-gray with no build error to point at the cause. Declare it explicitly: `export const runtime = "nodejs";`
- `no-store` must be attached to the actual `Response`, not merely intended:

```ts
const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" } as const;
return NextResponse.json(dto, { headers: NO_STORE });
```

Also set it on the early-return paths (cwd rejected, ENOENT) — the most commonly omitted spot, and a cached 200 `stopped` body would then be served for a project that has since started its daemon.

`revalidate = 0` is redundant given `force-dynamic`; do not add both.

---

### 11. MEDIUM — First-paint and hydration determinism of the age label

**Decision cited:** badge lives in the TaskPanel header row; age rendered as `"5s"`/`"2m"`.

**Failure scenario:** if the badge is rendered with an age derived from `Date.now()` during render and TaskPanel is ever server-rendered (App Router RSC, or a static shell), the server computes one age and the client another → React hydration mismatch warning and a visible flash. A second, subtler variant: on the very first client render there is no snapshot yet; initializing state to a fabricated `{status:"unknown", heartbeatAge:0}` renders "unknown (0s)" for one frame, which is a *different* claim than "not yet loaded".

**Fix:** render an explicit pre-first-response state, and never call `Date.now()` outside an effect/interval callback:

```tsx
const [snap, setSnap] = useState<Snapshot | null>(null);   // null = "loading", not "unknown"
if (snap === null) return <Badge dot="#64748b" text="…" age={null} />;
```

Keep `formatAge` pure (`(ms: number) => string`) so it is unit-testable without a clock (Finding 12).

---

### 12. MEDIUM (UNVERIFIED-CONTRACT) — TEST-01 feasibility: `.mjs` tests against `.ts` modules, and a DOM-free hook

TEST-01 requires co-located `.test.mjs` for each new module. Two blockers to resolve *before* planning the test files:

**(a) Can `.mjs` import `.ts` here?** A plain `.mjs` file under `node --test` cannot `import "./route.ts"` unless the runtime strips types. Node ≥22.6 needs `--experimental-strip-types`; Node ≥23.6 does it by default; otherwise the project must already route tests through `tsx`/`vitest`/a loader. Detect rather than assume:

```bash
node --version
cat package.json          # look at "scripts": { "test": ... }
ls vitest.config.* jest.config.* 2>/dev/null
grep -rn "experimental-strip-types\|tsx\|--loader" package.json
```

If the existing tests are `.mjs` next to `.ts` sources and they pass, copy that exact invocation. Note that type-stripping does **not** support `enum`, namespaces, or `import x = require()` — if `lib/lock-schema.ts` uses any of those, importing it from `.mjs` fails at runtime.

**(b) A React hook is not testable in `.mjs` without a DOM.** Do not reach for `@testing-library/react` unless it is already a dependency. The reliable pattern is to extract the decision logic into a framework-free module and test *that*:

```
lib/lane-driver-status/poller.ts        // pure: nextState(), nextDelay(), shouldFetchOnVisible()
lib/lane-driver-status/poller.test.mjs  // fast, no DOM, no fake timers
components/task-panel/LaneDriverBadge.tsx // thin: wires the pure core to useState/useEffect
```

For the poller core, inject the clock and timer functions so tests are deterministic and need no fake-timer library:

```ts
export type Clock = { now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
export function nextDelay(prev: number, ok: boolean, { base = 5000, max = 60000 } = {}) {
  return ok ? base : Math.min(prev * 2, max);
}
```

```js
// poller.test.mjs — edge cases worth asserting
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextDelay, formatAge } from "./poller.ts";

test("backoff doubles and caps", () => {
  assert.equal(nextDelay(5000, false), 10000);
  assert.equal(nextDelay(32000, false), 60000);
  assert.equal(nextDelay(60000, false), 60000);   // cap holds, no overflow
  assert.equal(nextDelay(60000, true), 5000);     // success resets
});
test("age formatting", () => {
  assert.equal(formatAge(0), "0s");
  assert.equal(formatAge(59_999), "59s");
  assert.equal(formatAge(60_000), "1m");
  assert.equal(formatAge(-1), null);              // clock skew / future heartbeat
});
```

Route tests should drive the handler directly with a fixture directory rather than spinning up a server — that requires the route's read path to accept an injectable root, or the test to set the same env var `resolveStateHome()` consults (check which: `grep -n "process.env" lib/state-home.ts`). Required edge cases: ENOENT → `stopped`; malformed JSON → `unknown` + reason; valid v1 lock without heartbeat → `heartbeatAge: null`; `cwd` outside roots → rejected; `cwd` with spaces and mixed separators → accepted; `Cache-Control` present on *every* return path.

---

### 13. LOW — `formatAge` has no hour/day tier

**Decision cited:** *"'5s' for <60s, '2m' for >=60s."* A daemon dead since yesterday renders as `1440m`, and the header row has fixed compact density — a 5-character age string will overflow the layout the decision says should match `Tag` density. Add tiers and a clamp:

```ts
export function formatAge(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
```

### 14. LOW — `pid` and `lastError` disclosure

**Decision cited:** DTO includes *"pid (for debugging), lastError."* A dev server bound to `0.0.0.0` exposes absolute home-directory paths and process IDs to anything on the LAN, and `lastError` sourced from a caught exception may carry a full stack. Keep `pid` (it is required for debugging), but truncate `lastError` to a bounded, single-line prefix and never include `err.stack`:

```ts
lastError: err?.message ? String(err.message).slice(0, 200) : null,
```

Also confirm the dev server bind address before shipping this route.

---

## Reference Implementation Sketch

**Route** (`app/api/lane-driver-status/route.ts`) — validation + delegation + DTO, nothing else:

```ts
import { NextResponse } from "next/server";
import path from "node:path";
import { getDaemonStatus } from "@/lib/extensions/lane-driver-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" };

const toDTO = (r: DaemonStatusResult) => ({
  status: r.status,                       // running|stopped|errored|stale|unknown — server decides
  heartbeatAt: r.heartbeatAt ?? null,     // absolute, see Finding 3
  heartbeatAge: r.heartbeatAt == null ? null : Date.now() - r.heartbeatAt,
  reason: r.reason ?? null,
  schemaVersion: r.schemaVersion ?? null,
  identityVerified: r.identityVerified === true,
  pid: r.pid ?? null,
  lastError: r.lastError ? String(r.lastError).slice(0, 200) : null,
});

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") ?? "";
  if (!isWithinAllowedRoots(cwd))                                  // shared helper, Finding 6b
    return NextResponse.json(toDTO(unknown("cwd-not-allowed")), { headers: NO_STORE });
  try {
    return NextResponse.json(toDTO(await getDaemonStatus({ cwd })), { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(toDTO(unknown(reasonOf(e))), { headers: NO_STORE });  // never 500
  }
}
```

**Component** — exhaustive over the union so a new state is a compile error, not a silent gray badge:

```tsx
const STYLE: Record<Status, { dot: string; label: string }> = {
  running: { dot: "#22c55e", label: "Running" },
  stopped: { dot: "#6b7280", label: "Stopped" },
  errored: { dot: "#ef4444", label: "Errored" },
  stale:   { dot: "#f59e0b", label: "Stale" },
  unknown: { dot: "#64748b", label: "Unknown" },
};
```

Use the CSS variables already in TaskPanel (`--text-muted`, `--border`) for the text/border and keep the literal hexes only for the dot, matching the existing palette convention.

---

## Open Questions to Resolve Before Planning

These are genuine unknowns, not guesses I am willing to make:

1. **Who owns the `stopped` vs `unknown` vs `errored` derivation** — `deriveDaemonStatus()` in `lib/lock-schema.ts` or `getDaemonStatus()` in the extension? The plan must name one. `grep -n "export function deriveDaemonStatus\|export async function getDaemonStatus" lib/lock-schema.ts lib/extensions/lane-driver-manager.ts`
2. **What is the `stale` threshold and where does it live?** It must be server-side and in one place; the client must not recompute it. `grep -rn "stale\|STALE" lib/`
3. **Does TaskPanel's existing `pollMs` loop already fetch daemon state?** If yes, Finding 9(2) collapses the two loops. `grep -n "pollMs\|setInterval" components/task-panel/TaskPanel.tsx`
4. **The test runner invocation** (Finding 12a). This determines whether TEST-01 is even satisfiable as written.
5. **Does `dispatch-status/route.ts` share the cwd-validation helper, or is it inline?** Determines whether Finding 6b is a new helper or a refactor of an existing one — and whether the drive-letter bug already ships.

## Verification Checklist for the Implementer

```bash
# contract reachability — every union member must be produced by some input
node --test app/api/lane-driver-status/route.test.mjs
# no cached 200 on any branch
curl -si "http://localhost:3000/api/lane-driver-status?cwd=$(pwd)" | grep -i cache-control
# win32 path with spaces (this machine has them)
node -e "const u=new URL('http://x/api?'+new URLSearchParams({cwd:'C:\\Users\\bedit\\Creative Cloud Files'}));console.log(u.searchParams.get('cwd'))"
# single-flight: watch request count while toggling tab visibility
# typecheck + lint per package.json scripts (do not assume `npm test` is the gate)
```

Manual check for Finding 1: throttle the network to Slow 3G, toggle tab visibility repeatedly during an in-flight request, and confirm the Network panel never shows two overlapping requests and that the request rate does not grow across toggles.


---

## Cross-Model Notes

Review the sections above for agreements and disagreements across models.
The cross-AI research review (step 5.4) will verify accuracy and flag concerns.

---

*Research completed via parallel multi-model research*
