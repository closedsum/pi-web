---
phase: 2
plan: "02-B"
title: "Port block-probe-in-fork Rule"
wave: 2
depends_on: ["02-A"]
files_modified: ["lib/extensions/tool-blockers.ts", "lib/extensions/tool-blockers.test.mjs"]
requirements: ["GATE-01", "TEST-02"]
autonomous: true
---

<objective>
Add `blockProbeInFork` as a context-aware BlockRule that blocks Bash/PowerShell commands containing `gsd_probe.py` or `gsd-probe` when the caller is a subagent (`ctx.isSubagent === true`). Add allow/block test cases verifying both subagent and orchestrator paths.
</objective>

<tasks>
## Task 1: Write test cases (RED)

<read_first>
- lib/extensions/tool-blockers.test.mjs (existing test patterns — `blocked()` / `allowed()` helpers)
- lib/extensions/tool-blockers.ts:281-303 (ALL_RULES array — confirm blockProbeInFork not yet present)
</read_first>

<action>
Add a new `describe("blockProbeInFork")` block at the end of `lib/extensions/tool-blockers.test.mjs`.

First, update the destructured import at the top of the file to include `blockProbeInFork`:
```javascript
const {
  ALL_RULES,
  evaluateBlockRules,
  blockBashPython,
  // ... existing imports ...
  denyJunctionSurgery,
  blockProbeInFork,   // <-- add
} = await jiti.import("./tool-blockers.ts");
```

Then update the `blocked` and `allowed` helpers to support optional context:
```javascript
function blocked(rule, toolName, input, ctx) {
  const r = rule.test(toolName, input ?? {}, ctx);
  assert.ok(r?.block, `Expected ${rule.name} to block ${toolName}`);
  return r;
}

function allowed(rule, toolName, input, ctx) {
  const r = rule.test(toolName, input ?? {}, ctx);
  assert.ok(!r?.block, `Expected ${rule.name} to allow ${toolName}`);
}
```

Add tests:
```javascript
describe("blockProbeInFork", () => {
  const subagentCtx = { cwd: "/project", isSubagent: true, stateHome: "/home/.gsd" };
  const orchestratorCtx = { cwd: "/project", isSubagent: false, stateHome: "/home/.gsd" };

  test("blocks Bash gsd_probe.py in subagent", () => {
    blocked(blockProbeInFork, "Bash", { command: "python gsd_probe.py dispatch --scope ." }, subagentCtx);
  });

  test("blocks PowerShell gsd_probe.py in subagent", () => {
    blocked(blockProbeInFork, "PowerShell", { command: 'python "$HOME/gsd_probe.py" dispatch' }, subagentCtx);
  });

  test("blocks gsd-probe variant in subagent", () => {
    blocked(blockProbeInFork, "Bash", { command: "gsd-probe --scope lib/" }, subagentCtx);
  });

  test("allows gsd_probe.py in orchestrator session", () => {
    allowed(blockProbeInFork, "Bash", { command: "python gsd_probe.py dispatch --scope ." }, orchestratorCtx);
  });

  test("allows unrelated commands in subagent", () => {
    allowed(blockProbeInFork, "Bash", { command: "npm test" }, subagentCtx);
  });

  test("allows when no context provided (fail open)", () => {
    allowed(blockProbeInFork, "Bash", { command: "python gsd_probe.py dispatch" });
  });

  test("allows non-shell tools", () => {
    allowed(blockProbeInFork, "Read", { file_path: "gsd_probe.py" }, subagentCtx);
  });
});
```
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.test.mjs` contains `describe("blockProbeInFork"`
- `lib/extensions/tool-blockers.test.mjs` contains `blockProbeInFork` in the destructured import
- `blocked` helper signature includes optional `ctx` parameter
- At least 7 test cases: 3 block (Bash subagent, PowerShell subagent, gsd-probe variant), 4 allow (orchestrator, unrelated cmd, no context, non-shell tool)
- Running tests fails because `blockProbeInFork` is not yet exported
</acceptance_criteria>

## Task 2: Implement blockProbeInFork rule (GREEN)

<read_first>
- lib/extensions/tool-blockers.ts (existing rule patterns — especially blockResearchFork for similar string matching)
</read_first>

<action>
Add `blockProbeInFork` rule in `lib/extensions/tool-blockers.ts`, before the `ALL_RULES` array:

```typescript
export const blockProbeInFork: BlockRule = {
  name: "block-probe-in-fork",
  test(toolName, input, ctx) {
    if (!ctx?.isSubagent) return;
    if (toolName !== "Bash" && toolName !== "PowerShell") return;
    const cmd = commandStr(input);
    if (!cmd) return;
    if (/gsd_probe\.py|gsd-probe/.test(cmd)) {
      return {
        block: true,
        reason: "block-probe-in-fork. Probes must run from the main session, not from forks.",
      };
    }
  },
};
```

Add `blockProbeInFork` to the `ALL_RULES` array:
```typescript
export const ALL_RULES: readonly BlockRule[] = [
  // ... existing 21 rules ...
  blockProbeInFork,
];
```

Key behaviors:
- Returns `undefined` (allow) when `ctx` is missing or `ctx.isSubagent` is false — fail open
- Only checks `Bash` and `PowerShell` tool names
- Uses regex to match both `gsd_probe.py` and `gsd-probe` in command string
- Uses existing `commandStr()` helper
</action>

<acceptance_criteria>
- `lib/extensions/tool-blockers.ts` contains `export const blockProbeInFork: BlockRule`
- Rule name is `"block-probe-in-fork"`
- Rule checks `ctx?.isSubagent` before blocking
- Rule matches `gsd_probe.py` and `gsd-probe` via regex
- `ALL_RULES` array includes `blockProbeInFork`
- `node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs` exits 0 (all tests including new ones pass)
</acceptance_criteria>
</tasks>

<verification>
```bash
grep "export const blockProbeInFork" lib/extensions/tool-blockers.ts
grep "blockProbeInFork" lib/extensions/tool-blockers.ts | wc -l  # Should be 3+ (definition, export, ALL_RULES)
node --experimental-strip-types --test lib/extensions/tool-blockers.test.mjs
npm run build
```
</verification>

<must_haves>
- blockProbeInFork blocks probe commands in subagent context
- blockProbeInFork allows probe commands in orchestrator context
- blockProbeInFork fails open when no context is provided
- Rule is registered in ALL_RULES
- All existing tests still pass
</must_haves>
