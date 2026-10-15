---
phase: 1
plan: "01-A"
title: "State Home Resolver"
wave: 1
depends_on: []
files_modified: ["lib/state-home.ts", "lib/state-home.test.mjs"]
requirements: ["INFRA-01", "TEST-01"]
autonomous: true
---

<objective>
Create `lib/state-home.ts` with `resolveStateHome()` that returns a directory path from the `GSD_STATE_HOME` environment variable, or falls back to `~/.gsd`. Includes a co-located test file covering env var set, unset, relative path, and empty string edge cases.
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/dispatch-status.test.mjs (reference for loadSubject() + jiti pattern and test structure)
- lib/default-cwd.ts (reference for parameter-injection pattern for testability)
</read_first>

<action>
Create `lib/state-home.test.mjs` with:

```javascript
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./state-home.ts");
  } catch { return import("./state-home.ts"); }
}

describe("resolveStateHome", () => {
  test("returns GSD_STATE_HOME when set", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "/custom/gsd" });
    assert.equal(result, path.resolve("/custom/gsd"));
  });

  test("falls back to ~/.gsd when GSD_STATE_HOME not set", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({});
    assert.equal(result, path.join(os.homedir(), ".gsd"));
  });

  test("falls back when GSD_STATE_HOME is empty string", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "" });
    assert.equal(result, path.join(os.homedir(), ".gsd"));
  });

  test("resolves relative paths", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "relative/path" });
    assert.equal(result, path.resolve("relative/path"));
  });

  test("uses process.env by default", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome();
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });
});
```
</action>

<acceptance_criteria>
- `lib/state-home.test.mjs` exists
- File contains `async function loadSubject()`
- File contains `describe("resolveStateHome"`
- File contains at least 5 `test(` calls
- Running `node --experimental-strip-types --test lib/state-home.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- lib/default-cwd.ts (pattern: pure function with injectable defaults)
- lib/atomic-file.ts (pattern: small utility module, named exports only)
</read_first>

<action>
Create `lib/state-home.ts` with:

```typescript
import { homedir } from "os";
import path from "path";

export function resolveStateHome(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.GSD_STATE_HOME;
  if (explicit) return path.resolve(explicit);
  return path.join(homedir(), ".gsd");
}
```

- Accept `env` parameter defaulting to `process.env` for testability
- Use `path.resolve()` on explicit values to normalize relative paths
- Falsy check on `explicit` handles both `undefined` and `""` empty string
- No directory creation — caller responsibility
</action>

<acceptance_criteria>
- `lib/state-home.ts` contains `export function resolveStateHome`
- `lib/state-home.ts` contains `import { homedir } from "os"`
- `lib/state-home.ts` contains `path.resolve(explicit)`
- `lib/state-home.ts` contains `path.join(homedir(), ".gsd")`
- `node --experimental-strip-types --test lib/state-home.test.mjs` exits 0
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/state-home.test.mjs
grep -c "export function resolveStateHome" lib/state-home.ts
grep -c "test(" lib/state-home.test.mjs
```
</verification>

<must_haves>
- `resolveStateHome()` returns a valid directory path string
- `GSD_STATE_HOME` env var takes precedence when set
- Falls back to `~/.gsd` when env var is missing or empty
- `env` parameter is injectable for testing
- Co-located test file with edge cases for empty/missing/relative env var values
</must_haves>
