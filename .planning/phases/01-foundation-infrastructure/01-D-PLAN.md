---
phase: 1
plan: "01-D"
title: "Shell Command Parser"
wave: 1
depends_on: []
files_modified: ["lib/shell-command-parser.ts", "lib/shell-command-parser.test.mjs"]
requirements: ["INFRA-04", "TEST-01"]
autonomous: true
---

<objective>
Create `lib/shell-command-parser.ts` with `parseNamedArg(command, argName)` that extracts the value of a named argument from a shell command string. Handles space-separated (`--flag value`) and equals-separated (`--flag=value`) forms, plus quoted values. Includes a co-located test file covering representative dispatch commands, quoted paths, missing args, and partial-match edge cases.
</objective>

<tasks>
## Task 1: Write test file (RED)

<read_first>
- lib/dispatch-status.test.mjs (loadSubject pattern, test structure)
- .planning/phases/01-foundation-infrastructure/01-RESEARCH.md (test cases listed under shell-command-parser design notes)
</read_first>

<action>
Create `lib/shell-command-parser.test.mjs` with:

```javascript
import assert from "node:assert/strict";
import test, { describe } from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./shell-command-parser.ts");
  } catch { return import("./shell-command-parser.ts"); }
}

describe("parseNamedArg", () => {
  test("extracts space-separated value", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("python gsd_impl_lane.py pipeline --params-file /path/to/file.json", "--params-file"),
      "/path/to/file.json"
    );
  });

  test("extracts equals-separated value", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file=/path/to/file.json", "--params-file"),
      "/path/to/file.json"
    );
  });

  test("extracts double-quoted value with spaces", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg('cmd --params-file "/path with spaces/file.json"', "--params-file"),
      "/path with spaces/file.json"
    );
  });

  test("extracts single-quoted value with spaces", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file '/path with spaces/file.json'", "--params-file"),
      "/path with spaces/file.json"
    );
  });

  test("returns null when arg not present", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --other-flag value", "--params-file"),
      null
    );
  });

  test("returns null for empty command", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(parseNamedArg("", "--params-file"), null);
  });

  test("does not match partial arg names", async () => {
    const { parseNamedArg } = await loadSubject();
    // --params-file-extra should NOT match --params-file
    assert.equal(
      parseNamedArg("cmd --params-file-extra /wrong", "--params-file"),
      null
    );
  });

  test("extracts arg at start of command", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("--params-file /path/file.json other args", "--params-file"),
      "/path/file.json"
    );
  });

  test("handles Windows backslash paths", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file C:\\Users\\user\\file.json", "--params-file"),
      "C:\\Users\\user\\file.json"
    );
  });

  test("extracts from realistic dispatch command", async () => {
    const { parseNamedArg } = await loadSubject();
    const cmd = 'python "C:\\Users\\bedit\\gsd-config\\get-shit-done\\bin\\gsd_impl_lane.py" pipeline --params-file "D:\\Trees\\pi-web\\.planning\\impl-lanes\\p-01-A.json" --detach';
    assert.equal(
      parseNamedArg(cmd, "--params-file"),
      "D:\\Trees\\pi-web\\.planning\\impl-lanes\\p-01-A.json"
    );
  });
});
```
</action>

<acceptance_criteria>
- `lib/shell-command-parser.test.mjs` exists
- File contains `describe("parseNamedArg"`
- File contains at least 10 `test(` calls
- File tests space-separated, equals-separated, quoted, partial-match, and Windows path cases
- Running `node --experimental-strip-types --test lib/shell-command-parser.test.mjs` fails (module not yet created)
</acceptance_criteria>

## Task 2: Implement module (GREEN)

<read_first>
- .planning/phases/01-foundation-infrastructure/01-RESEARCH.md (regex pattern for parseNamedArg)
</read_first>

<action>
Create `lib/shell-command-parser.ts` with:

```typescript
export function parseNamedArg(command: string, argName: string): string | null {
  if (!command || !argName) return null;

  const escaped = argName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)${escaped}(?:(?:\\s+|=)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\S+))(?:\\s|$)`
  );
  const match = command.match(pattern);
  if (!match) return null;
  let value = match[1];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
```

- Regex-based extraction (per out-of-scope: "full shell parser is overkill")
- Escape special regex characters in argName for safety
- Support both `--flag value` (space) and `--flag=value` (equals) forms
- Strip surrounding single or double quotes from values
- Lookahead `(?:\\s|$)` after value prevents `--params-file-extra` matching `--params-file`
- Returns null when arg not found, command is empty, or argName is empty
</action>

<acceptance_criteria>
- `lib/shell-command-parser.ts` contains `export function parseNamedArg`
- `lib/shell-command-parser.ts` contains `new RegExp`
- `lib/shell-command-parser.ts` contains `.match(pattern)`
- `lib/shell-command-parser.ts` contains `.slice(1, -1)` (quote stripping)
- `node --experimental-strip-types --test lib/shell-command-parser.test.mjs` exits 0
</acceptance_criteria>
</tasks>

<verification>
```bash
node --experimental-strip-types --test lib/shell-command-parser.test.mjs
grep -c "export function parseNamedArg" lib/shell-command-parser.ts
grep -c "test(" lib/shell-command-parser.test.mjs
```
</verification>

<must_haves>
- `parseNamedArg(command, argName)` returns extracted value string or null
- Handles `--flag value` (space-separated) form
- Handles `--flag=value` (equals-separated) form
- Handles double-quoted and single-quoted values (strips quotes)
- Does NOT match partial arg names (`--params-file-extra` ≠ `--params-file`)
- Returns null for missing args, empty command
- Co-located test file with realistic dispatch command examples and edge cases
</must_haves>
