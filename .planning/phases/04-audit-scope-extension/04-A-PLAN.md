---
phase: 4
plan: "04-A"
title: "Audit Scope Extension"
wave: 1
depends_on: []
files_modified: ["lib/extensions/audit-scope-extension.ts", "lib/extensions/audit-scope-extension.test.mjs", "lib/extensions/index.ts"]
requirements: ["SVC-02"]
autonomous: true
---

<objective>
Create `lib/extensions/audit-scope-extension.ts` with `checkAuditScope()` that intercepts Write/Edit/Delete tool calls during audit sessions and enforces scope boundaries via scope tokens. Scope tokens are base64url-encoded JSON (`{ files: string[], creates?: string[] }`) delivered via `GSD_AUDIT_SCOPE_TOKEN` env var. Blocks out-of-scope file operations with `OUT_OF_SCOPE` reason. Detects path traversal (`..`) and symlink escapes. Wire into `index.ts` factory. Includes co-located tests covering block/allow paths, traversal, symlinks, and edge cases.
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/extensions/block-manual-integrate.test.mjs (reference for InlineExtension handler test pattern — loadSubject, temp dirs, asserting BlockResult shape)
- lib/extensions/tool-blockers.test.mjs (reference for blocked/allowed test helpers)
- .planning/phases/04-audit-scope-extension/04-RESEARCH.md (test cases listed under Test Strategy)
</read_first>

<action>
Create `lib/extensions/audit-scope-extension.test.mjs` with:

```javascript
import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import path from "path";
import os from "os";
import fs from "fs";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./audit-scope-extension.ts");
  } catch { return import("./audit-scope-extension.ts"); }
}

function encodeScope(scope) {
  const json = JSON.stringify(scope);
  return Buffer.from(json).toString("base64url");
}

describe("decodeScope", () => {
  test("decodes valid base64url token with files and creates", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: ["/a/b.ts"], creates: ["/a/c.ts"] });
    const scope = decodeScope(token);
    assert.ok(scope.files instanceof Set);
    assert.ok(scope.files.has(path.resolve("/a/b.ts")));
    assert.ok(scope.creates instanceof Set);
    assert.ok(scope.creates.has(path.resolve("/a/c.ts")));
  });

  test("returns empty creates set when creates is omitted", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: ["/a/b.ts"] });
    const scope = decodeScope(token);
    assert.equal(scope.creates.size, 0);
  });

  test("throws on invalid base64url", async () => {
    const { decodeScope } = await loadSubject();
    assert.throws(() => decodeScope("!!!not-valid!!!"), /invalid.*scope.*token/i);
  });

  test("throws when files array is missing", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ creates: ["/a.ts"] });
    assert.throws(() => decodeScope(token), /files/i);
  });

  test("throws when files is empty array", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: [] });
    assert.throws(() => decodeScope(token), /files/i);
  });
});

describe("checkAuditScope", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-audit-scope-"));
    // Create a real file for scope testing
    fs.writeFileSync(path.join(tmpDir, "allowed.ts"), "export const x = 1;\n");
    fs.mkdirSync(path.join(tmpDir, "subdir"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "subdir", "nested.ts"), "export const y = 2;\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns undefined when no scope token (not an audit session)", async () => {
    const { checkAuditScope } = await loadSubject();
    const result = checkAuditScope("Write", { file_path: "/any/path.ts" }, undefined);
    assert.equal(result, undefined);
  });

  test("returns undefined when scope token is empty string", async () => {
    const { checkAuditScope } = await loadSubject();
    const result = checkAuditScope("Write", { file_path: "/any/path.ts" }, "");
    assert.equal(result, undefined);
  });

  test("returns undefined for non-file tools (Bash, Read, Grep)", async () => {
    const { checkAuditScope } = await loadSubject();
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    assert.equal(checkAuditScope("Bash", { command: "ls" }, token), undefined);
    assert.equal(checkAuditScope("Read", { file_path: "/etc/passwd" }, token), undefined);
    assert.equal(checkAuditScope("Grep", { pattern: "foo" }, token), undefined);
  });

  test("allows Write to file in scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Write", { file_path: filePath, content: "new" }, token);
    assert.equal(result, undefined);
  });

  test("allows Edit to file in scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Edit", { file_path: filePath, old_string: "x", new_string: "y" }, token);
    assert.equal(result, undefined);
  });

  test("blocks Write to file outside scope with OUT_OF_SCOPE", async () => {
    const { checkAuditScope } = await loadSubject();
    const allowedFile = path.join(tmpDir, "allowed.ts");
    const outsideFile = path.join(tmpDir, "other.ts");
    fs.writeFileSync(outsideFile, "bad");
    const token = encodeScope({ files: [allowedFile] });
    const result = checkAuditScope("Write", { file_path: outsideFile, content: "new" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("OUT_OF_SCOPE"));
  });

  test("blocks Edit to file outside scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const allowedFile = path.join(tmpDir, "allowed.ts");
    const outsideFile = path.join(tmpDir, "subdir", "nested.ts");
    const token = encodeScope({ files: [allowedFile] });
    const result = checkAuditScope("Edit", { file_path: outsideFile }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("OUT_OF_SCOPE"));
  });

  test("blocks path traversal attempts", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const traversal = path.join(tmpDir, "..", "escape.ts");
    const result = checkAuditScope("Write", { file_path: traversal, content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("TRAVERSAL"));
  });

  test("blocks non-absolute paths", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Write", { file_path: "relative/path.ts", content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
  });

  test("blocks when file_path is missing from input", async () => {
    const { checkAuditScope } = await loadSubject();
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    const result = checkAuditScope("Write", { content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
  });

  test("handles symlink scope escape", async () => {
    const { checkAuditScope } = await loadSubject();
    const escapePath = path.join(os.tmpdir(), `pi-web-escape-target-${process.pid}.ts`);
    fs.writeFileSync(escapePath, "secret");
    const symlinkPath = path.join(tmpDir, "sneaky-link.ts");
    try {
      fs.symlinkSync(escapePath, symlinkPath);
    } catch {
      // Symlinks may require elevated permissions on Windows — skip test
      fs.rmSync(escapePath, { force: true });
      return;
    }
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    const result = checkAuditScope("Write", { file_path: symlinkPath, content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    fs.rmSync(escapePath, { force: true });
  });

  test("allows Write to creates-set path that does not exist yet", async () => {
    const { checkAuditScope } = await loadSubject();
    const newFile = path.join(tmpDir, "brand-new.ts");
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")], creates: [newFile] });
    const result = checkAuditScope("Write", { file_path: newFile, content: "new" }, token);
    assert.equal(result, undefined);
  });
});
```
</action>

<acceptance_criteria>
- `lib/extensions/audit-scope-extension.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("decodeScope"`
- File contains `describe("checkAuditScope"`
- File contains at least 14 `test(` calls
- File contains `encodeScope` helper function
- Running `node --experimental-strip-types --test lib/extensions/audit-scope-extension.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- lib/extensions/block-manual-integrate.ts (InlineExtension handler pattern — function signature, BlockResult return, tool name checking)
- lib/extensions/types.ts (BlockResult interface — { block: true, reason: string })
- .planning/phases/04-audit-scope-extension/04-RESEARCH.md (module design, scope token format, path security)
</read_first>

<action>
Create `lib/extensions/audit-scope-extension.ts` with:

```typescript
import path from "path";
import { realpathSync } from "fs";
import type { BlockResult } from "./types";

const FILE_TOOLS = new Set(["Write", "Edit", "Delete"]);

export interface AuditScope {
  files: Set<string>;
  creates: Set<string>;
}

export function decodeScope(token: string): AuditScope {
  let parsed: { files?: string[]; creates?: string[] };
  try {
    const json = Buffer.from(token, "base64url").toString("utf-8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid scope token: failed to decode base64url JSON");
  }

  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("Invalid scope token: files array is required and must be non-empty");
  }

  return {
    files: new Set(parsed.files.map((f) => path.resolve(f))),
    creates: new Set((parsed.creates ?? []).map((f) => path.resolve(f))),
  };
}

function hasTraversal(filePath: string): boolean {
  return filePath.split(/[\\/]+/).includes("..");
}

function resolveRealTarget(filePath: string): string {
  try {
    return realpathSync.native(filePath);
  } catch {
    // File may not exist yet (create operation) — resolve parent
    const dir = path.dirname(filePath);
    try {
      const realDir = realpathSync.native(dir);
      return path.join(realDir, path.basename(filePath));
    } catch {
      // Parent doesn't exist either — return normalized path
      return path.resolve(filePath);
    }
  }
}

export function checkAuditScope(
  toolName: string,
  input: Record<string, unknown>,
  scopeToken: string | undefined,
): BlockResult | undefined {
  if (!scopeToken) return undefined;
  if (!FILE_TOOLS.has(toolName)) return undefined;

  const filePath = input.file_path as string | undefined;
  if (!filePath || typeof filePath !== "string") {
    return { block: true, reason: "AUDIT_SCOPE: file_path is missing or not a string" };
  }

  if (!path.isAbsolute(filePath)) {
    return { block: true, reason: `AUDIT_SCOPE: non-absolute path rejected: ${filePath}` };
  }

  if (hasTraversal(filePath)) {
    return { block: true, reason: `AUDIT_SCOPE: TRAVERSAL detected in path: ${filePath}` };
  }

  let scope: AuditScope;
  try {
    scope = decodeScope(scopeToken);
  } catch (err) {
    return { block: true, reason: `AUDIT_SCOPE: ${(err as Error).message}` };
  }

  const resolved = resolveRealTarget(filePath);
  const normalized = path.resolve(filePath);

  // Check if resolved path differs from normalized (symlink escape)
  if (resolved !== normalized) {
    // Symlink detected — check resolved target against scope
    if (!scope.files.has(resolved) && !scope.creates.has(resolved)) {
      return { block: true, reason: `AUDIT_SCOPE: symlink escape blocked — resolved to ${resolved} which is OUT_OF_SCOPE` };
    }
    return undefined;
  }

  if (scope.files.has(normalized)) return undefined;
  if (scope.creates.has(normalized)) return undefined;

  return { block: true, reason: `OUT_OF_SCOPE: ${normalized} is not in the audit scope` };
}
```
</action>

<acceptance_criteria>
- `lib/extensions/audit-scope-extension.ts` exists
- File contains `export function checkAuditScope(`
- File contains `export function decodeScope(`
- File contains `export interface AuditScope`
- File contains `const FILE_TOOLS = new Set(["Write", "Edit", "Delete"])`
- File contains `hasTraversal` function
- File contains `resolveRealTarget` function
- File imports `BlockResult` from `"./types"`
- Running `node --experimental-strip-types --test lib/extensions/audit-scope-extension.test.mjs` passes all tests
</acceptance_criteria>

## Task 3: Wire into index.ts

<read_first>
- lib/extensions/index.ts (current state — see how block-manual-integrate and block-redispatch are wired into tool_call handler, how session_start caches scope)
</read_first>

<action>
Modify `lib/extensions/index.ts`:

1. Add import at top:
```typescript
import { checkAuditScope } from "./audit-scope-extension";
```

2. Add `auditScopeToken` variable alongside `blockRuleCtx` (around line 48):
```typescript
let auditScopeToken: string | undefined;
```

3. In the session_start handler (around line 54), add after `blockRuleCtx` assignment:
```typescript
auditScopeToken = process.env.GSD_AUDIT_SCOPE_TOKEN || undefined;
```

4. In the tool_call handler block that runs checkManualIntegrate and checkRedispatchWithoutFix (the second `pi.on("tool_call")` block added by Phase 3), add audit scope check:
```typescript
if (auditScopeToken) {
  const scopeResult = checkAuditScope(ev.toolName, ev.input ?? {}, auditScopeToken);
  if (scopeResult) {
    if (onTiming) {
      onTiming({ event: "tool_call", handlerName: "audit-scope", durationMs: performance.now() - start, blocked: true, timestamp: Date.now() });
    }
    return scopeResult;
  }
}
```

5. Verify build compiles: `npm run build`
6. Verify all existing tests still pass
</action>

<acceptance_criteria>
- `lib/extensions/index.ts` contains `import { checkAuditScope } from "./audit-scope-extension"`
- `lib/extensions/index.ts` contains `auditScopeToken`
- `lib/extensions/index.ts` contains `GSD_AUDIT_SCOPE_TOKEN`
- `lib/extensions/index.ts` contains `checkAuditScope(ev.toolName`
- `npm run build` exits 0
- `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` passes (no regressions)
- `node --experimental-strip-types --test lib/extensions/audit-scope-extension.test.mjs` passes
</acceptance_criteria>

</tasks>

<verification>
```bash
# All Phase 4 tests pass
node --experimental-strip-types --test lib/extensions/audit-scope-extension.test.mjs

# All Phase 1-3 tests pass (no regressions)
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs lib/extensions/block-manual-integrate.test.mjs lib/extensions/block-redispatch.test.mjs lib/extensions/lane-driver-manager.test.mjs lib/state-home.test.mjs lib/process-liveness.test.mjs lib/git-query.test.mjs lib/shell-command-parser.test.mjs

# Build succeeds
npm run build
```
</verification>

<must_haves>
- checkAuditScope blocks Write/Edit to files outside scope with OUT_OF_SCOPE reason
- Path traversal (..) is detected and blocked before normalization
- Symlink scope escapes are detected via realpathSync comparison
- No scope token → all writes allowed (fail open — not an audit session)
- Non-file tools (Bash, Read, Grep) are never intercepted
- Wired into index.ts factory via session_start (token cache) + tool_call (check)
- Co-located tests with block/allow paths and edge cases
</must_haves>
