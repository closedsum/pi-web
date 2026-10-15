# Stack Research: Orchestration Hook Infrastructure

## Current Pi-Web Infrastructure

| Component | Location | Capability |
|-----------|----------|-----------|
| BlockRule system | `lib/extensions/tool-blockers.ts` | 21 sync rules, `(toolName, input) => BlockResult` |
| GSD lane extension | `lib/gsd-lane-extension.ts` | Async InlineExtension, has `pi` object, spawns processes |
| Dispatch status reader | `lib/dispatch-status.ts` | Reads lane manifest JSON from `.planning/impl-lanes/` |
| RPC manager | `lib/rpc-manager.ts` | Loads extensions, manages session lifecycle |

## Infrastructure Gaps Per Hook

### ensure-lane-driver
**Needs:** Process spawn (Python daemon), PID liveness checks (`process.kill(pid, 0)`), lock file management, project eligibility checks, restart history tracking.
**Gap:** No daemon lifecycle management exists. Pi-web server itself is long-lived but doesn't manage external daemons per session.
**Proposed:** New module `lib/lane-driver-manager.ts` — session-start hook in InlineExtension that checks/spawns the lane driver daemon. Uses `child_process.spawn` (already available in gsd-lane-extension pattern).

### fork-completion-gate
**Needs:** Read fork result state files from `{stateHome}/fork-results/{taskId}.json`.
**Gap:** No state home path resolution. No file-read capability in BlockRules.
**Proposed:** Resolve `GSD_STATE_HOME` at extension init, inject path via closure. Use `fs.readFileSync` (acceptable for small JSON files).

### block-probe-in-fork
**Needs:** Subagent detection (is caller a subagent vs main session?).
**Gap:** BlockRules receive no session context — can't distinguish main vs subagent.
**Proposed:** Extend block rule context OR use InlineExtension `tool_call` handler. Pi-web's RPC manager already tracks subagent sessions.

### audit-scope-guard
**Needs:** Full file I/O proxy with atomic writes, scope token parsing, symlink resolution.
**Gap:** This is a 540-line file-operation proxy, not a tool-call filter. Entirely different pattern.
**Proposed:** New InlineExtension `lib/audit-scope-extension.ts` that intercepts Write/Edit/Delete from audit sessions and enforces scope boundaries via scope tokens.

### block-manual-integrate
**Needs:** Git `rev-parse --show-toplevel`, `.autopilot.lock` file read, Windows PID liveness via tasklist + proc_start matching.
**Gap:** No git operations from block rules. No PID liveness checking. Windows-specific process checks.
**Proposed:** Shared `lib/process-liveness.ts` module with cross-platform PID check. Pre-resolve repo root at session start. Lock file read via `fs.readFileSync`.

### block-redispatch-without-fix
**Needs:** Command parsing (extract `--params-file`), pipeline manifest JSON reads, `git log` with scope globs, timestamp comparison.
**Gap:** No command parser. No git log capability. `execFileSync` for git could block event loop.
**Proposed:** Port `shell-command-parser.cjs` or use regex extraction. Use `child_process.execFileSync` for git (acceptable for single-line queries). Manifest reads via existing `dispatch-status.ts`.

## New Modules Needed

| Module | Purpose | Pattern |
|--------|---------|---------|
| `lib/lane-driver-manager.ts` | Daemon spawn/lifecycle | InlineExtension (session-start) |
| `lib/process-liveness.ts` | Cross-platform PID checks | Utility (sync) |
| `lib/state-home.ts` | Resolve GSD state home path | Utility (sync) |
| `lib/audit-scope-extension.ts` | File-op proxy for audits | InlineExtension (tool_call) |
| `lib/shell-command-parser.ts` | Extract args from shell commands | Utility (sync) |

## Node.js APIs Required

- `child_process.spawn` — daemon launch (detached)
- `child_process.execFileSync` — git log queries (sync, blocking but fast)
- `process.kill(pid, 0)` — PID liveness
- `fs.readFileSync` — lock files, state files, manifests
- `fs.existsSync` — lock file presence
- `fs.realpathSync.native` — symlink resolution (audit scope)
