# Architecture Research: Hook Integration Patterns

## Current Extension Architecture

Pi-web has two extension patterns:

### Pattern A: BlockRule (sync, pure)
```typescript
interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>) => BlockResult | undefined;
}
```
- 21 rules in `tool-blockers.ts`
- No session context, no file I/O, no async
- Evaluated via `evaluateBlockRules()` — first match wins

### Pattern B: InlineExtension (async, stateful)
```typescript
// Factory receives pi object with full session access
factory: (pi) => {
  pi.on("tool_call", handler)  // async handlers OK
  pi.registerTool(...)          // custom tools
  // closure-scoped state, file I/O, subprocess
}
```
- Used by `gsd-lane-extension.ts`
- Has access to `cwd`, file system, `child_process`, session state
- Can maintain state across tool calls

## Hook Classification

| Hook | Pattern | Justification |
|------|---------|---------------|
| ensure-lane-driver | **B (InlineExtension)** | Spawns daemons, manages locks — not a tool-call filter |
| fork-completion-gate | **A+ (BlockRule with context)** | Synchronous file read, but needs state home path |
| block-probe-in-fork | **A+ (BlockRule with context)** | Pure logic, but needs subagent detection |
| audit-scope-guard | **B (InlineExtension)** | Full file-op proxy with scope tokens |
| block-manual-integrate | **B (InlineExtension)** | PID checks + git — async operations |
| block-redispatch-without-fix | **B (InlineExtension)** | Git log + command parsing — async operations |

## Proposed Architecture

### Option 1: Extended BlockRule Context (Recommended)

Add an optional context parameter to BlockRule:

```typescript
interface BlockRuleContext {
  cwd: string;
  isSubagent: boolean;
  sessionId: string;
  stateHome: string;
}

interface BlockRule {
  name: string;
  test: (toolName: string, input: Record<string, unknown>, ctx?: BlockRuleContext) => BlockResult | undefined;
}
```

This lets fork-completion-gate and block-probe-in-fork stay as BlockRules. The context is optional so existing rules don't break.

### Option 2: Separate Tool-Call Handler

Add infrastructure hooks as a separate `pi.on("tool_call")` handler alongside block rules. This is how gsd-lane-extension.ts works.

**Pros:** No BlockRule type changes, can be async.
**Cons:** Two interception points to maintain, ordering concerns.

### Recommendation: Hybrid

1. **Extend BlockRule context** (Option 1) for hooks that are fundamentally synchronous checks (fork-completion-gate, block-probe-in-fork)
2. **Use InlineExtension** (Option 2) for hooks that need async or are not tool-call filters (ensure-lane-driver, audit-scope-guard, block-manual-integrate, block-redispatch-without-fix)

## Shared Infrastructure Services

### State Home Resolver (`lib/state-home.ts`)
- Resolves `GSD_STATE_HOME` env var or default `~/.gsd`
- Used by: fork-completion-gate, ensure-lane-driver
- Pattern: Sync utility, resolved once at extension init

### Process Liveness (`lib/process-liveness.ts`)
- Cross-platform PID alive check
- Node.js: `process.kill(pid, 0)` catches `ESRCH`
- Optional proc_start matching (for PID reuse detection)
- Used by: ensure-lane-driver, block-manual-integrate

### Git Query (`lib/git-query.ts`)
- Thin wrapper around `child_process.execFileSync("git", ...)`
- `revParseShowToplevel(cwd)` — repo root
- `logLatestInScope(repo, branch, globs)` — latest commit touching paths
- Used by: block-manual-integrate, block-redispatch-without-fix

## Build Order

```
Phase 1: Foundation services
  ├── state-home.ts (utility)
  ├── process-liveness.ts (utility)
  └── git-query.ts (utility)
  
Phase 2: BlockRule context extension
  ├── Extend BlockRule type with optional context
  ├── Update evaluateBlockRules to pass context
  └── Port block-probe-in-fork, fork-completion-gate

Phase 3: InlineExtension hooks
  ├── ensure-lane-driver (session-start daemon)
  ├── block-manual-integrate (tool-call handler)
  └── block-redispatch-without-fix (tool-call handler)

Phase 4: Audit scope (deferred if audits not active in pi-web)
  └── audit-scope-extension.ts (full file-op proxy)
```
