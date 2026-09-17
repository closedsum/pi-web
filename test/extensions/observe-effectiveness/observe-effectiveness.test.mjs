import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent } from "../_config.mjs";

const HOOK_PREDICATES = [
  { rule_id: "feedback_plugin_dist_before_test", tools: /^(Bash|PowerShell)$/, match: /plugin\.dist\.py\s+dist/i, negative: null },
  { rule_id: "feedback_resolve_engine_root", tools: /^(Bash|PowerShell)$/, match: /(?:C:\\Program Files\\Epic|D:\\UE_5)/i, negative: /engine_root\.py|resolve.*engine/i },
  { rule_id: "feedback_use_ue_launch_scripts", tools: /^(Bash|PowerShell)$/, match: /ue-launch-csmcp\.py|ue-start-pie\.py/i, negative: null },
  { rule_id: "project_rotator_order", tools: /^(Bash|PowerShell|Write|Edit)$/, match: /Rotator\(\d/i, negative: /Rotator\(roll=|pitch=|yaw=/i },
  { rule_id: "feedback_reviewer_list", tools: /^(Bash|PowerShell)$/, match: /gsd-review\.py\s+list/i, negative: null },
  { rule_id: "feedback_cleanup_processes", tools: /^(Bash|PowerShell)$/, match: /taskkill\s+\/IM\s+\S+\.exe/i, negative: null },
  { rule_id: "project_nullrhi_rendered_evidence", tools: /^(Bash|PowerShell)$/, match: /-nullrhi/i, negative: null },
];

function extractText(toolName, toolInput) {
  const fields = [toolInput.command, toolInput.content, toolInput.file_path,
    toolInput.new_string, toolInput.description].filter(Boolean);
  return fields.join(" ");
}

function matchHookPredicates(toolName, toolInput) {
  const text = extractText(toolName, toolInput);
  const matched = [];
  for (const rule of HOOK_PREDICATES) {
    if (!rule.tools.test(toolName)) continue;
    if (!rule.match.test(text)) continue;
    if (rule.negative && rule.negative.test(text)) continue;
    matched.push(rule.rule_id);
  }
  return matched;
}

function handleToolCall(event) {
  const matches = matchHookPredicates(event.tool, event.input || {});
  if (matches.length === 0) return undefined;
  return { observe: true, rule_ids: matches };
}

test("never blocks (observe-only contract)", () => {
  const event = makeBashToolCallEvent("taskkill /IM UnrealEditor.exe /F");
  const result = handleToolCall(event);
  assert.ok(!result?.block);
});

test("detects plugin dist usage", () => {
  const result = handleToolCall(makeBashToolCallEvent("python plugin.dist.py dist CsMCP"));
  assert.ok(result?.observe);
  assert.ok(result.rule_ids.includes("feedback_plugin_dist_before_test"));
});

test("detects hardcoded UE paths", () => {
  const result = handleToolCall(makeBashToolCallEvent('cd "C:\\Program Files\\Epic Games\\UE_5.8"'));
  assert.ok(result?.rule_ids.includes("feedback_resolve_engine_root"));
});

test("exempts engine_root.py from UE path rule", () => {
  const result = handleToolCall(makeBashToolCallEvent("python engine_root.py C:\\Program Files\\Epic"));
  assert.equal(result, undefined);
});

test("detects UE launch scripts", () => {
  const result = handleToolCall(makeBashToolCallEvent("python ue-launch-csmcp.py Cropout.uproject"));
  assert.ok(result?.rule_ids.includes("feedback_use_ue_launch_scripts"));
});

test("detects positional Rotator", () => {
  const result = handleToolCall(makeBashToolCallEvent("unreal.Rotator(0, 90, 0)"));
  assert.ok(result?.rule_ids.includes("project_rotator_order"));
});

test("exempts keyword Rotator", () => {
  const result = handleToolCall(makeBashToolCallEvent("unreal.Rotator(roll=0, pitch=90, yaw=0)"));
  assert.ok(!result?.rule_ids?.includes("project_rotator_order"));
});

test("detects reviewer list command", () => {
  const result = handleToolCall(makeBashToolCallEvent("python gsd-review.py list"));
  assert.ok(result?.rule_ids.includes("feedback_reviewer_list"));
});

test("detects process cleanup", () => {
  const result = handleToolCall(makeBashToolCallEvent("taskkill /IM UnrealEditor.exe /F"));
  assert.ok(result?.rule_ids.includes("feedback_cleanup_processes"));
});

test("detects -nullrhi usage", () => {
  const result = handleToolCall(makeBashToolCallEvent("UnrealEditor-Cmd -nullrhi -run=test"));
  assert.ok(result?.rule_ids.includes("project_nullrhi_rendered_evidence"));
});

test("returns undefined for unmatched commands", () => {
  assert.equal(handleToolCall(makeBashToolCallEvent("npm test")), undefined);
});

test("returns undefined for non-matching tools", () => {
  assert.equal(handleToolCall({ tool: "Read", input: { file_path: "Rotator(0" } }), undefined);
});

test("Rotator detection works with Write tool", () => {
  const event = { tool: "Write", input: { content: "r = unreal.Rotator(0, 90, 0)" } };
  const result = handleToolCall(event);
  assert.ok(result?.rule_ids.includes("project_rotator_order"));
});

test("multiple rules can match same command", () => {
  const event = makeBashToolCallEvent('taskkill /IM UnrealEditor.exe /F && cd "C:\\Program Files\\Epic"');
  const result = handleToolCall(event);
  assert.ok(result.rule_ids.length >= 2);
});
