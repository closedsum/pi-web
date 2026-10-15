# Research Summary: Orchestration Hook Porting

## Key Findings

**Stack:** Pi-web needs 5 new modules — state-home resolver, process-liveness checker, git-query wrapper, lane-driver manager, and audit-scope extension. All use standard Node.js APIs already available in the gsd-lane-extension pattern.

**Table Stakes:** All 6 hooks are must-have for full orchestration parity. However, audit-scope-guard (540 lines) can be deferred if audit fixers don't yet run in pi-web.

**Watch Out For:** Sync git/process operations blocking the event loop. Missing session context in BlockRules. Concurrent session state races. Windows-specific PID checks.

## Classification

The 6 hooks split into two categories:

**Tool-call gates (4 hooks)** — intercept specific tool calls and block conditionally:
- fork-completion-gate, block-probe-in-fork, block-manual-integrate, block-redispatch-without-fix

**Session services (2 hooks)** — not tool-call filters at all:
- ensure-lane-driver (daemon lifecycle), audit-scope-guard (file-op proxy)

## Architecture Decision

**Hybrid approach:** Extend BlockRule context for simple sync checks (probe-in-fork, fork-completion-gate). Use InlineExtension handlers for async/stateful hooks (manual-integrate, redispatch-without-fix, lane-driver, audit-scope).

## Build Order

1. Foundation utilities (state-home, process-liveness, git-query)
2. BlockRule context extension + 2 simple rules
3. InlineExtension hooks (3 tool-call handlers + lane-driver)
4. Audit scope extension (deferred)

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Event loop blocking | High | Timeout on all sync exec, benchmark first |
| Missing context bypass | High | Explicit context extension, fail-open with warning |
| PID reuse false positives | Medium | proc_start matching, TTL on checks |
| Concurrent state races | Medium | proper-lockfile, atomic reads, no caching |
| Command parser drift | Low | Regex on known invocation patterns |
