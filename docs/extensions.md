# Extensions Guide

How to add custom tools to the Pi agent via the `InlineExtension` pattern.

## Architecture

Pi's agent registers tools through `InlineExtension` factories in `rpc-manager.ts`:

```typescript
extensionFactories: [
  createProjectCommandBashExtension({ cwd, settings }),
  createSubagentExtension(runtime, getProfiles, isEnabled),
  createGsdLaneExtension({ cwd: sessionCwd }),
],
```

Each factory returns `{ name, hidden, factory(pi) }`. The `factory` function receives a `pi` context with `pi.registerTool(defineTool({...}))`.

## Creating a New Extension

### 1. Create the extension file

`lib/my-extension.ts`:
```typescript
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";

export const MY_EXTENSION_NAME = "pi-web-my-ext";

export function createMyExtension(options: { cwd: string }): InlineExtension {
  return {
    name: MY_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool(defineTool({
        name: "MyTool",
        label: "My Tool",
        description: "What the tool does",
        promptSnippet: "Short prompt hint",
        promptGuidelines: ["When to use this tool"],
        executionMode: "parallel",  // or "sequential"
        parameters: Type.Object({
          task: Type.String({ description: "..." }),
        }),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          // ... implementation ...
          return {
            content: [{ type: "text", text: "result" }],
            details: undefined,
          };
        },
      }));
    },
  };
}
```

### 2. Wire into rpc-manager.ts

```typescript
import { createMyExtension } from "./my-extension";
// ... in extensionFactories array:
createMyExtension({ cwd: sessionCwd }),
```

### 3. Write tests

`lib/my-extension.test.mjs`:
```javascript
const { createMyExtension } = await createJiti(import.meta.url).import("./my-extension.ts");

async function loadTools(options = {}) {
  const tools = new Map();
  const ext = createMyExtension({ cwd: "/tmp/test", ...options });
  await ext.factory({ registerTool(tool) { tools.set(tool.name, tool); }, sendMessage() {} });
  return tools;
}

test("registers MyTool", async () => {
  const tools = await loadTools();
  assert.ok(tools.has("MyTool"));
});
```

## Key Patterns

### Return type

`execute()` must return `{ content, details }`. Both fields required:
```typescript
return { content: [{ type: "text", text: "..." }], details: undefined };
```

For errors: add `isError: true`.

### Background processes

Spawn detached, capture PID, log to file, handle errors:
```typescript
const child = spawn(cmd, args, { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true });
if (!child.pid) return { content: [...], details: undefined, isError: true };
child.on("error", (err) => { /* log */ });
child.on("exit", () => { /* cleanup */ });
child.unref();
```

### Input sanitization

Sanitize user-supplied strings used in file paths:
```typescript
function sanitize(text: string): string {
  return text.replace(/\.\./g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 30);
}
```

## Modular Extension Framework (`lib/extensions/`)

Reusable, scope-isolated extension modules with a shared test harness. Each module is a pure function or factory — no shared mutable state between modules.

| File | Purpose |
|------|---------|
| `_test-harness.mjs` | `createMockPi()`, `assertBlocks()`, `assertAllows()` for dry-run testing |
| `tool-blockers.ts` | 16 `BlockRule` functions ported from Claude PreToolUse hooks |
| `index.ts` | `createGsdExtension()` — unified `InlineExtension` composing all modules |

### Tool Blockers

Each rule is `(toolName, input) => BlockResult | undefined`. Rules are individually testable and composable via `evaluateBlockRules(toolName, input, rules?)`.

```typescript
import { evaluateBlockRules, ALL_RULES } from "./tool-blockers";
const result = evaluateBlockRules("Bash", { command: "git push" });
// result?.block === true, result?.reason === "Git push is blocked..."
```

Custom subsets: `evaluateBlockRules(name, input, [blockForkPush, blockBashPython])`.

### Pi Event Mapping

| Claude Hook | Pi Event | Module |
|---|---|---|
| `PreToolUse` block-* | `tool_call` | `tool-blockers.ts` |
| `PreToolUse` orchestrator-allowlist | `tool_call` | `gsd-lane-extension.ts` |
| `PostToolUse` | `tool_result` | *(future)* |
| `UserPromptSubmit` | `input` | *(future)* |
| `SessionStart` | `session_start` | `gsd-lane-extension.ts` |

### Mid-Conversation System Messages (pi 1.0)

Pi extensions can inject transcript-aware messages and swap tools mid-conversation:

- `pi.sendMessage({...}, { triggerTurn: true })` — steering message visible to the model
- `inner.setActiveToolsByName([...])` — swap active tool set mid-conversation
- `before_agent_start` handler — override system prompt per-run with transcript access

## Existing Extensions

| Extension | File | Tool(s) | Purpose |
|-----------|------|---------|---------|
| Bash | SDK built-in | `Bash`, `PowerShell` | Shell commands |
| Subagent | `lib/subagent-extension.ts` | `Agent` | Delegate tasks to subagent sessions |
| GSD Lane | `lib/gsd-lane-extension.ts` | `DispatchLane`, `CheckLaneStatus`, `CheckDispatchStatus` | Dispatch to autonomous GSD lanes |
| GSD Unified | `lib/extensions/index.ts` | *(event handlers)* | Tool blockers, session lifecycle |
| Exact Prompt | `lib/exact-system-prompt.ts` | *(event handler)* | System prompt override for chat-only/subagent |
| MCP Policy | `lib/mcp-read-only-policy.ts` | *(event handler)* | MCP read-only filter |
