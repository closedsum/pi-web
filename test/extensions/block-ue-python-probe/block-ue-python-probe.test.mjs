import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (/ue_csmcp_http.*console/.test(cmd) && /dir\s*\(\s*unreal\./.test(cmd)) {
    return { inject: "[UE-API-MAP] Check ~/.claude/ue-5.8/INDEX.md first before probing live UE Python bindings." };
  }
  return undefined;
}

test("advises when probing UE Python via console", () => {
  const event = makePowerShellToolCallEvent('python ue_csmcp_http.py console "dir(unreal.EditorAssetLibrary)"');
  const result = handleToolCall(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /UE-API-MAP/);
});

test("does not fire for non-probe console commands", () => {
  const event = makePowerShellToolCallEvent('python ue_csmcp_http.py console "unreal.EditorAssetLibrary.list_assets()"');
  assert.equal(handleToolCall(event), undefined);
});

test("does not fire for non-console commands", () => {
  const event = makePowerShellToolCallEvent('python ue_csmcp_http.py catalog pie');
  assert.equal(handleToolCall(event), undefined);
});
