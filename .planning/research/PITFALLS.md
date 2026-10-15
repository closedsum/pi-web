# Pitfalls Research: CLI-to-Server Hook Porting

## Pitfall 1: Blocking the Event Loop with Sync Git/Process Operations

**Risk:** `execFileSync("git", ...)` and `tasklist` commands block the Node.js event loop. In CLI hooks this is fine (one hook per process). In a long-lived server, it blocks ALL sessions.

**Warning signs:** Other sessions experience latency spikes during tool-call evaluation. Server becomes unresponsive for 100-500ms during git queries.

**Prevention:**
- Use `execFileSync` only for fast, bounded operations (git log with `-1`, git rev-parse)
- Set `timeout` option on all exec calls (e.g., 5000ms)
- For longer operations, use async `execFile` in InlineExtension handlers (not BlockRules)
- Monitor: log wall-clock time for any sync exec call

**Testing:** Benchmark sync git operations on the target repo. Verify they complete in <50ms.

## Pitfall 2: Stale PID State in Long-Lived Server

**Risk:** PID liveness checks (`process.kill(pid, 0)`) may return stale results if the daemon dies and the PID is reused by an unrelated process.

**Warning signs:** Lock files reference PIDs that belong to different processes. False "daemon alive" results prevent new daemon launch.

**Prevention:**
- Always pair PID checks with proc_start timestamp matching (like `block-manual-integrate.cjs` does)
- Add TTL to PID cache — re-check after N seconds
- Use `proper-lockfile` (already a dependency) for lock file management
- Clean up stale lock files on server start

**Testing:** Test with mock PID that returns ESRCH. Test with PID reuse scenario (same PID, different proc_start).

## Pitfall 3: Missing Session Context in BlockRules

**Risk:** The 6 source hooks use `payload.cwd`, `payload.agent_id`, `payload.agent_type`, and environment variables. Pi-web's BlockRule signature `(toolName, input)` has none of these.

**Warning signs:** Rules that need context silently pass (can't check what they can't see). Security bypass.

**Prevention:**
- Extend BlockRule context explicitly (don't hack it via globals)
- Make context optional to preserve backward compatibility
- Verify every rule that needs context receives it in tests
- Never assume context exists — fail open only for rules that don't need it

**Testing:** Unit test each rule with and without context. Verify rules that need context return undefined (pass) when context is missing, with a logged warning.

## Pitfall 4: Concurrent Session State Conflicts

**Risk:** Multiple pi-web sessions may race on shared state files (lock files, fork-results, pipeline manifests). CLI hooks run one-at-a-time per session; pi-web serves multiple sessions concurrently.

**Warning signs:** Lock file corruption. Two sessions both think they own the daemon. TOCTOU between file existence check and file read.

**Prevention:**
- Use `proper-lockfile` for all lock file operations (handles races, stale detection)
- Read state files atomically (readFileSync — no partial reads)
- Don't cache file state across tool calls — re-read each time
- The lane driver daemon itself handles its own concurrency; pi-web just checks if it's running

**Testing:** Concurrent test: two sessions both try to spawn lane driver simultaneously. Verify only one succeeds.

## Pitfall 5: Windows-Specific Process Checks

**Risk:** `block-manual-integrate.cjs` uses `tasklist /FI "PID eq"` and `powershell Get-Process -Id ... .StartTime` — both Windows-only. Pi-web may run on other platforms.

**Warning signs:** Tests pass on Windows CI but fail on Linux/Mac dev machines.

**Prevention:**
- Abstract process checks behind `process-liveness.ts` with platform-specific implementations
- Primary check: `process.kill(pid, 0)` (cross-platform)
- proc_start matching: use `ps -p PID -o lstart=` on Unix, `Get-Process` on Windows
- Or skip proc_start matching in pi-web (simpler, acceptable risk)

**Testing:** Mock `process.platform` in tests. Verify both paths work.

## Pitfall 6: Command Parser Drift

**Risk:** `block-redispatch-without-fix.cjs` uses `shell-command-parser.cjs` to extract `--params-file` from shell commands. If the parser doesn't match what the shell actually executes, bypasses are possible.

**Warning signs:** Regex extraction misses quoted paths, escaped characters, or multi-line commands.

**Prevention:**
- Use the same command matching pattern as existing block rules (regex on `commandStr(input)`)
- Don't try to be a full shell parser — match the specific invocation pattern
- Test with the exact command format that `gsd_impl_lane.py pipeline` produces

**Testing:** Test with real command strings from lane pipeline dispatch. Include edge cases: quoted paths, Windows paths with backslashes, paths with spaces.
