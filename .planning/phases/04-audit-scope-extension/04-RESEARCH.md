# Phase 4: Audit Scope Extension — Research

## Source Hook Analysis

The original `audit-scope-guard.cjs` (540 lines) is a **standalone CLI process**, not a hook in the usual sense. It runs as a child process that audit fixer agents call instead of using Write/Edit directly.

### How it works:

1. **Scope tokens** are base64url-encoded JSON: `{ files: string[], creates?: string[] }`
   - `files` — paths the audit session can read and write (must exist)
   - `creates` — paths the session can create (must NOT exist yet)
   - Token is passed as CLI arg: `audit-scope-guard.cjs <SCOPE_TOKEN> --stdin`

2. **Request protocol** — JSON on stdin:
   - `{ operation: "write", file: "/abs/path", content: "..." }`
   - `{ operation: "edit", file: "/abs/path", old_string: "...", new_string: "..." }`
   - `{ operation: "create", file: "/abs/path", content: "..." }`
   - `{ operation: "delete", file: "/abs/path" }`

3. **Authorization** (`authorize()`) checks:
   - Target path is absolute, no `..` traversal
   - Symlinks resolved via `realpathSync.native` on existing segments
   - Path normalized and compared against scope set
   - `create` operations checked against `creates` set (file must not exist)
   - `write`/`edit`/`delete` checked against `files` set (file must exist, must be regular file)

4. **Rejection codes:**
   - `OUT_OF_SCOPE` — file not in allowed set
   - `CREATE_ONLY_TARGET` — writing to a create-only path
   - `TARGET_MISSING` — edit/write on non-existent file
   - `TARGET_NOT_FILE` — target is directory/symlink
   - `CREATE_EXISTS` — create target already exists
   - `EDIT_AMBIGUOUS` — old_string matches multiple times (needs replace_all)
   - `EDIT_NO_MATCH` — old_string not found

5. **Atomic writes** (`atomicWrite()`):
   - Creates temp file with `wx` flag (exclusive create, mode 0o600)
   - Writes content + `fsync`
   - For existing files: `renameSync` (atomic replace)
   - For create-only: `linkSync` (fails if target appeared), then cleanup temp
   - Up to 20 retry attempts for temp file name collisions

6. **Canonicalization** — `--canonicalize --stdin` mode pre-computes canonical paths:
   - Resolves symlinks on existing path segments
   - Normalizes Windows/Unix paths with `pathFlavor()` detection
   - Produces a new token with resolved paths

### Key insight for porting:

The original is a **process-level proxy** — audit fixers call it instead of Write/Edit. In pi-web, we need to implement this as a **tool_call interceptor** that:
- Intercepts Write/Edit/Delete tool calls
- Checks the file_path from tool input against scope
- Blocks or allows (does NOT perform the write itself — the Pi SDK handles that)

This is fundamentally simpler than the original because we **intercept and gate** rather than **proxy and execute**. We don't need the atomic write logic — the Pi SDK's Write/Edit tools handle file operations. We only need the authorization layer.

## Module Design: `lib/extensions/audit-scope-extension.ts`

### Core function signature:

```typescript
export function checkAuditScope(
  toolName: string,
  input: Record<string, unknown>,
  scopeToken: string | undefined,
): BlockResult | undefined
```

- If `scopeToken` is undefined/empty → not an audit session → return undefined (allow)
- If `scopeToken` is set → decode, validate, authorize file path from input
- Write tool → `input.file_path` checked against `files` set
- Edit tool → `input.file_path` checked against `files` set
- Delete tool → `input.file_path` checked against `files` set (if such a tool exists)

### Scope token delivery:

The scope token needs to reach the extension. Options:
1. **Extension option**: Add `auditScopeToken?: string` to `GsdExtensionOptions`
2. **Environment variable**: `GSD_AUDIT_SCOPE_TOKEN` read at session start
3. **BlockRuleContext field**: Add `auditScopeToken?: string` to the context

Option 2 (env var) is simplest and matches how the original hook receives scope — as a CLI argument, which in the pi-web world translates to an env var set before spawning the audit agent. No type changes needed.

### Functions to implement:

1. `decodeScope(token: string): AuditScope` — base64url → JSON → validated scope
2. `normalizeTarget(filePath: string): string` — normalize + traversal check
3. `authorizeFile(filePath: string, scope: AuditScope): AuthResult` — check against scope sets
4. `checkAuditScope(toolName, input, scopeToken): BlockResult | undefined` — main entry point

### Type definitions:

```typescript
interface AuditScope {
  files: Set<string>;
  creates: Set<string>;
}

interface AuthResult {
  allowed: boolean;
  code?: string;
  reason?: string;
}
```

## Scope Token Resolution

In the pi-web extension system:

1. At session start, check for `GSD_AUDIT_SCOPE_TOKEN` env var
2. If present, decode and cache the scope
3. On every Write/Edit tool_call, run authorization
4. If no token → not an audit session → all writes allowed (fail open)

This mirrors how `isSubagent` works — it's a session-level property set once and consulted on each tool call.

### Where scope tokens come from:

The orchestrator creates scope tokens before spawning audit fixer agents. The token is set as an environment variable `GSD_AUDIT_SCOPE_TOKEN` in the agent's environment. The `--canonicalize` mode ensures paths are absolute and symlink-resolved.

## Path Security

### Traversal detection:

```typescript
function hasTraversal(filePath: string): boolean {
  return filePath.split(/[\\/]+/).includes("..");
}
```

Check BEFORE normalization — `path.normalize("a/../b")` collapses to `b`, hiding the traversal.

### Symlink resolution:

Walk from root toward the target. For each existing segment, use `realpathSync.native`. For missing segments (creates), resolve up to the last existing ancestor.

```typescript
function resolveRealPath(filePath: string): string {
  // Walk up until we find an existing directory
  // Resolve that, append the missing tail
}
```

### Windows path handling:

The original uses `pathFlavor()` to detect Windows vs Unix paths. In pi-web (always Node.js), `path.resolve` and `path.normalize` handle this natively. Keep the `pathFlavor` approach for robustness since scope tokens may contain either style.

### Normalization order:

1. Check non-empty, absolute path
2. Check no `..` traversal (before normalize)
3. Normalize path
4. Resolve symlinks (realpathSync on existing prefix)
5. Compare against scope set

## Test Strategy

### Test file: `lib/extensions/audit-scope-extension.test.mjs`

Using loadSubject + jiti pattern, co-located with module.

### Test cases:

**Scope decoding:**
- Valid base64url token with files and creates → parsed correctly
- Invalid base64url → throws/returns error
- Missing files array → throws/returns error
- Empty files array → throws/returns error

**Authorization (allow):**
- Write to file in scope.files → allow
- Edit file in scope.files → allow
- Create file in scope.creates → allow (if not exists)

**Authorization (block):**
- Write to file NOT in scope → OUT_OF_SCOPE
- Write to create-only file → CREATE_ONLY_TARGET
- Path traversal (`..`) → blocked
- Non-absolute path → blocked

**Integration with tool_call:**
- Write tool with file_path in scope → undefined (allow)
- Edit tool with file_path outside scope → { block: true, reason: "OUT_OF_SCOPE: ..." }
- No scope token set → undefined (allow — not an audit session)
- Non-file tool (Bash, Read) → undefined (allow — not intercepted)

**Edge cases:**
- Symlink in path escaping scope → blocked after resolution
- Windows backslash paths in scope
- Empty/whitespace file_path in input

### Temp directory strategy:

Create real temp files for scope validation tests (same as lane-driver-manager.test.mjs pattern). Clean up in test teardown.

## Dependencies

- `path`, `fs` (Node.js built-ins) — for path normalization and symlink resolution
- `lib/extensions/types.ts` — BlockResult type
- No npm dependencies needed

### Integration with index.ts:

Add a third `pi.on("tool_call")` handler in the existing block that runs checkAuditScope for Write/Edit tool calls. The scope token is read from env at session_start time and cached alongside blockRuleCtx.

```typescript
// In session_start handler:
const auditScopeToken = process.env.GSD_AUDIT_SCOPE_TOKEN;

// In tool_call handler:
if (auditScopeToken) {
  const result = checkAuditScope(ev.toolName, ev.input ?? {}, auditScopeToken);
  if (result) return result;
}
```
