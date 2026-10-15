---
phase: 6
plan: 1
title: API Route + Polling Engine
wave: 1
depends_on: []
files_modified:
  - app/api/lane-driver/status/route.ts
  - lib/lane-driver-poller.ts
  - app/api/lane-driver/status/route.test.mjs
  - lib/lane-driver-poller.test.mjs
requirements:
  - UI-01
  - UI-02
  - UI-04
  - TEST-01
autonomous: true
---

# Plan 1: API Route + Polling Engine

## Goal

Create the server-side API route that reads daemon lock files and returns a status DTO, plus the framework-free polling engine with single-flight guarantees, visibility gating, and exponential backoff.

## Tasks

<task id="1.1">
<title>Create lane-driver status API route</title>
<read_first>
- app/api/dispatch-status/route.ts (reference API route pattern — cwd validation, file-access checks)
- lib/extensions/lane-driver-manager.ts (getDaemonStatus at L72, projectHash at L18)
- lib/lock-schema.ts (DaemonStatusResult type at L37, DaemonStatus type at L30)
- lib/state-home.ts (resolveStateHome at L4)
- lib/file-access.ts (getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath)
</read_first>
<action>
Create `app/api/lane-driver/status/route.ts`:

1. Export `const dynamic = "force-dynamic"` for Next.js dynamic rendering
2. Define a response DTO type `LaneDriverStatusDTO`:
   ```ts
   interface LaneDriverStatusDTO {
     status: "running" | "stopped" | "errored" | "stale" | "unknown";
     heartbeatAgeMs: number | null;
     reason: string;
     schemaVersion: 1 | 2;
     identityVerified: boolean;
   }
   ```
3. Export async `GET(request: NextRequest)` handler:
   - Extract `cwd` from `request.nextUrl.searchParams.get("cwd")`
   - Validate: if empty or not absolute path → return `NextResponse.json({status: "unknown", heartbeatAgeMs: null, reason: "invalid-cwd", schemaVersion: 1, identityVerified: false}, {status: 400})`
   - Call `getAllowedFileRoots()` then `isFilePathAllowed(cwd, roots)` → if denied return same shape with reason `"access-denied"` and status 403
   - Wrap all remaining logic in try/catch:
     - `const stateHome = resolveStateHome()`
     - `const hash = projectHash(cwd)`
     - `const result = getDaemonStatus(stateHome, hash)`
     - Return `NextResponse.json({status: result.status, heartbeatAgeMs: result.heartbeatAgeMs, reason: result.reason, schemaVersion: result.schemaVersion, identityVerified: result.identityVerified}, {headers: {"Cache-Control": "no-store, max-age=0"}})`
   - Catch block: return `NextResponse.json({status: "unknown", heartbeatAgeMs: null, reason: "internal-error", schemaVersion: 1, identityVerified: false}, {headers: {"Cache-Control": "no-store, max-age=0"}})` — always 200, never 500
4. Use closed-enum reason values only: `"no_lock_file"`, `"v1_signal_zero"`, `"v1_pid_dead"`, `"pid_dead"`, `"heartbeat_stale"`, `"v2_identity_verified"`, `"unknown_error"`, `"invalid-cwd"`, `"access-denied"`, `"internal-error"` — never embed filesystem paths in reason
</action>
<acceptance_criteria>
- `app/api/lane-driver/status/route.ts` exists
- File contains `export const dynamic = "force-dynamic"`
- File contains `Cache-Control` with value `no-store`
- File imports `getDaemonStatus` from `@/lib/extensions/lane-driver-manager`
- File imports `projectHash` from `@/lib/extensions/lane-driver-manager`
- File imports `resolveStateHome` from `@/lib/state-home`
- File imports `getAllowedFileRoots` and `isFilePathAllowed` from `@/lib/file-access`
- File contains `export async function GET`
- No filesystem paths appear in any string literal passed to `reason`
- The route never returns HTTP 500 — all error paths return 200 or 400/403 with valid DTO shape
</acceptance_criteria>
</task>

<task id="1.2">
<title>Create framework-free polling engine</title>
<read_first>
- components/task-panel/DispatchSection.tsx (existing polling pattern — setInterval, no visibility gating)
- components/task-panel/TaskPanel.tsx (POLL_INTERVAL_MS at L20, polling via setInterval at L328)
</read_first>
<action>
Create `lib/lane-driver-poller.ts`:

1. Export constants: `BASE_POLL_MS = 5_000` and `MAX_POLL_MS = 60_000`

2. Export pure function `nextDelay(errors: number): number`:
   - `return errors <= 0 ? BASE_POLL_MS : Math.min(BASE_POLL_MS * 2 ** errors, MAX_POLL_MS)`

3. Define `LaneDriverStatusDTO` type matching the API DTO (import from a shared location or inline)

4. Define `PollResult = { ok: true; data: LaneDriverStatusDTO } | { ok: false; reason: string }`

5. Define `PollerDeps` interface for dependency injection:
   ```ts
   interface PollerDeps {
     fetchFn: (signal: AbortSignal) => Promise<LaneDriverStatusDTO>;
     onResult: (result: PollResult) => void;
     doc?: { visibilityState: string; addEventListener: Function; removeEventListener: Function };
     setT?: typeof setTimeout;
     clearT?: typeof clearTimeout;
     baseMs?: number;
     maxMs?: number;
   }
   ```

6. Export `createLanePoller(deps: PollerDeps)` returning `{ start(): void; stop(): void }`:
   - Internal state: `timer`, `errors = 0`, `gen = 0`, `ctrl: AbortController | null`, `running = false`
   - `tick()` async function:
     - Clear existing timer
     - Abort any in-flight request (`ctrl?.abort()`)
     - Increment `gen`, create new `AbortController`
     - Capture `const myGen = gen`
     - Try: `const data = await fetchFn(ctrl.signal)`, if `myGen !== gen` return early, reset errors to 0, call `onResult({ok: true, data})`
     - Catch: if `myGen !== gen` or `AbortError` → return, else increment errors, call `onResult({ok: false, reason: String(e?.message ?? e)})`
     - After try/catch: if `myGen === gen && running && doc.visibilityState === "visible"` → schedule next: `timer = setT(tick, nextDelay(errors))`
   - `onVis` handler:
     - If not running → return
     - If `doc.visibilityState === "visible"` → call `tick()` (immediate fetch)
     - Else → `gen++`, `ctrl?.abort()`, clear timer (pause)
   - `start()`: set running=true, add visibilitychange listener on doc, if visible → tick()
   - `stop()`: set running=false, gen++, ctrl?.abort(), clear timer, remove listener

7. Error classification: `fetchFn` is responsible for throwing on non-2xx responses and invalid JSON. A 200 response with `status: "unknown"` is a successful poll (errors not incremented). AbortError is never counted.
</action>
<acceptance_criteria>
- `lib/lane-driver-poller.ts` exists
- File exports `BASE_POLL_MS` with value `5_000`
- File exports `MAX_POLL_MS` with value `60_000`
- File exports `nextDelay` function
- File exports `createLanePoller` function
- `createLanePoller` returns object with `start` and `stop` methods
- No React imports — this is a framework-free module
- All timer/document dependencies are injectable via the `deps` parameter
- File uses `AbortController` for fetch cancellation
- Generation counter pattern prevents stale responses from writing state
</acceptance_criteria>
</task>

<task id="1.3">
<title>Test polling engine</title>
<read_first>
- lib/lane-driver-poller.ts (the module under test)
- lib/lock-schema.test.mjs (test pattern: node:test, node:assert/strict, temp dirs)
- lib/extensions/lane-driver-manager.test.mjs (test pattern: loadSubject with jiti fallback)
</read_first>
<action>
Create `lib/lane-driver-poller.test.mjs`:

1. Use `loadSubject()` pattern with jiti fallback to import `lane-driver-poller.ts`
2. Import `test, { describe }` from `node:test` and `assert` from `node:assert/strict`

3. Create fake timer infrastructure:
   - `createFakeTimers()` returning `{ pending: [], setT(fn, ms), clearT(id), flush(), advance(ms) }`
   - Each `setT` call pushes `{id, fn, ms}` to pending array
   - `clearT` removes by id
   - `advance(ms)` fires all pending where ms <= threshold

4. Create fake document:
   - `createFakeDoc()` returning `{ visibilityState: "visible", listeners: Map, addEventListener(evt, fn), removeEventListener(evt, fn), setVisible(v) }` where `setVisible` updates state and fires listeners

5. Test cases for `nextDelay`:
   - `nextDelay(0)` === 5000
   - `nextDelay(1)` === 10000
   - `nextDelay(2)` === 20000
   - `nextDelay(3)` === 40000
   - `nextDelay(4)` === 60000
   - `nextDelay(10)` === 60000 (capped)
   - `nextDelay(-1)` === 5000 (negative treated as 0)

6. Test cases for `createLanePoller`:
   - **Success resets errors**: start with 2 errors, then success → next delay is 5000
   - **Single timer**: at any point `pending.length <= 1`
   - **No overlapping fetches**: with slow fetch (manual promise), visibility toggle does not start second fetch
   - **Hidden pauses**: going hidden clears timer, aborts in-flight, does not count as error
   - **Visible resumes**: hidden→visible triggers immediate tick, then 5s timer after success
   - **Mounted while hidden**: no fetch until visible
   - **Stale response discarded**: generation mismatch → no onResult call, no timer
   - **stop() idempotent**: calling stop() twice is safe, removes listener
   - **AbortError not counted**: aborting in-flight does not increment errors
   - **Server unknown is not error**: fetchFn resolving with `{status:"unknown",...}` → errors stays 0
</action>
<acceptance_criteria>
- `lib/lane-driver-poller.test.mjs` exists
- Running `node --experimental-strip-types --test lib/lane-driver-poller.test.mjs` exits with code 0
- Test file has at least 10 test cases
- Test file uses injectable fake timers and fake document (no real DOM)
- Test file validates single-flight guarantee (no overlapping fetches)
- Test file validates visibility gating (pause/resume)
- Test file validates exponential backoff (nextDelay values)
</acceptance_criteria>
</task>

<task id="1.4">
<title>Test API route</title>
<read_first>
- app/api/lane-driver/status/route.ts (the module under test)
- lib/lock-schema.test.mjs (test pattern reference)
</read_first>
<action>
Create `app/api/lane-driver/status/route.test.mjs`:

1. Use `loadSubject()` pattern with jiti fallback to import the route module
2. Create mock `NextRequest` objects with `nextUrl.searchParams`
3. Mock the file-access and lane-driver-manager imports via dependency injection or module-level overrides

4. Test cases:
   - **Missing cwd**: GET with no cwd param → status 400, body has `status: "unknown"`, `reason: "invalid-cwd"`
   - **Relative cwd**: GET with `cwd=relative/path` → status 400
   - **Access denied**: cwd outside allowed roots → status 403, body has `reason: "access-denied"`
   - **Running daemon**: mock getDaemonStatus returns running → status 200, body has `status: "running"`, `heartbeatAgeMs` is a number
   - **Stopped daemon**: mock returns stopped → status 200, `status: "stopped"`
   - **Unknown (no lock)**: mock returns unknown → status 200, `status: "unknown"`, `reason: "no_lock_file"`
   - **Internal error**: getDaemonStatus throws → status 200, `status: "unknown"`, `reason: "internal-error"`
   - **Cache headers**: every 200 response has `Cache-Control: no-store`
   - **No filesystem paths in reason**: assert reason field matches closed enum pattern
   - **force-dynamic export**: module exports `dynamic === "force-dynamic"`
</action>
<acceptance_criteria>
- `app/api/lane-driver/status/route.test.mjs` exists
- Running `node --experimental-strip-types --test app/api/lane-driver/status/route.test.mjs` exits with code 0
- Test file covers all 5 daemon status states
- Test file verifies Cache-Control header
- Test file verifies no 500 responses
- Test file verifies force-dynamic export
</acceptance_criteria>
</task>

## Verification

```
npm test
```

All test files exit 0. No regressions in existing tests.

## must_haves

- [ ] API route at `/api/lane-driver/status` returns valid DTO for all 5 daemon states (UI-01)
- [ ] Parse failures and I/O errors return `{status: "unknown"}` with closed-enum reason, never HTTP 500 (UI-02)
- [ ] Polling engine uses single-flight setTimeout with visibility gating and exponential backoff (UI-04)
- [ ] Co-located tests cover all status states, polling lifecycle, and API error paths (TEST-01)
