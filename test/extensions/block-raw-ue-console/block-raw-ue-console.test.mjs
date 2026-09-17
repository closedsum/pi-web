import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "mcp__csmcp__run_console_command") return undefined;
  const cmd = event.input?.command || "";
  if (!/^\s*py\s/i.test(cmd)) return undefined;
  const code = cmd.replace(/^\s*py\s+/i, "");
  const stmts = code.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    if ((/\bunreal\./i.test(stmt) || /\bfrom\s+unreal\b/i.test(stmt) || /\bimport\s+unreal\b/i.test(stmt))
        && !/^from\s+CsMCP\./i.test(stmt)) {
      return { block: true, reason: "BLOCKED: Raw unreal.* in console. Use CsMCP catalog actions instead." };
    }
  }
  return undefined;
}

test("blocks raw unreal.* call", () => {
  assertBlocked(handleToolCall({ tool: "mcp__csmcp__run_console_command", input: { command: "py unreal.EditorAssetLibrary.list_assets('/Game')" } }));
});

test("blocks import unreal", () => {
  assertBlocked(handleToolCall({ tool: "mcp__csmcp__run_console_command", input: { command: "py import unreal; print(unreal.get_editor_subsystem())" } }));
});

test("allows CsMCP imports", () => {
  assertPassed(handleToolCall({ tool: "mcp__csmcp__run_console_command", input: { command: "py from CsMCP.maps.map_open import open_map; print(open_map('TestMap'))" } }));
});

test("ignores non-py commands", () => {
  assertPassed(handleToolCall({ tool: "mcp__csmcp__run_console_command", input: { command: "stat fps" } }));
});

test("ignores other tools", () => {
  assertPassed(handleToolCall({ tool: "Bash", input: { command: "py unreal.something()" } }));
});
