import assert from "node:assert/strict";
import test from "node:test";
import { makeBashToolCallEvent, makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const DEPLOY_PATH_RE = /[\\\/]\.gsd(?![a-zA-Z0-9_-])|[\\\/]\.claude[\\\/]/i;
const JUNCTION_OPS = [
  { re: /\bNew-Item\b[^;|&]*-ItemType[^;|&]*\bJunction\b/i, name: "New-Item Junction" },
  { re: /\bmklink\s+\/[jJ]\b/i, name: "mklink /J" },
  { re: /\bNew-Item\b[^;|&]*-ItemType[^;|&]*\bSymbolicLink\b/i, name: "New-Item SymbolicLink" },
];

function handleToolCall(event) {
  if (event.tool !== "Bash" && event.tool !== "PowerShell" && event.tool !== "Write" && event.tool !== "Edit") return undefined;
  if (event.tool === "Write" || event.tool === "Edit") {
    const fp = event.input?.file_path || "";
    if (/settings\.json$/i.test(fp) && DEPLOY_PATH_RE.test(fp)) {
      return { block: true, reason: "[DENY-JUNCTION-SURGERY] BLOCKED: direct write to settings.json in deploy-owned path. Use deploy.py." };
    }
    return undefined;
  }
  const cmd = event.input?.command || "";
  if (/\bdeploy\.py\b/i.test(cmd)) return undefined;
  for (const op of JUNCTION_OPS) {
    if (op.re.test(cmd) && DEPLOY_PATH_RE.test(cmd)) {
      return { block: true, reason: `[DENY-JUNCTION-SURGERY] BLOCKED: ${op.name} targeting deploy-owned path.` };
    }
  }
  if (/\bsettings\.json\b/i.test(cmd) && DEPLOY_PATH_RE.test(cmd) && /\bSet-Content\b|\bOut-File\b|\bWriteAllText\b/i.test(cmd)) {
    return { block: true, reason: "[DENY-JUNCTION-SURGERY] BLOCKED: direct write to settings.json in deploy-owned path." };
  }
  return undefined;
}

test("blocks junction creation on .gsd path", () => {
  const event = makePowerShellToolCallEvent('New-Item -ItemType Junction -Path "C:\\Users\\user\\.gsd" -Target "D:\\somewhere"');
  assertBlocked(handleToolCall(event), /DENY-JUNCTION-SURGERY/);
});

test("blocks mklink /J on .claude path", () => {
  const event = makeBashToolCallEvent('cmd /c mklink /J "C:\\Users\\user\\.claude\\docs" "D:\\target"');
  assertBlocked(handleToolCall(event), /DENY-JUNCTION-SURGERY/);
});

test("allows junction on non-deploy path", () => {
  const event = makePowerShellToolCallEvent('New-Item -ItemType Junction -Path "D:\\Trees\\link" -Target "D:\\target"');
  assertPassed(handleToolCall(event));
});

test("allows commands through deploy.py", () => {
  const event = makePowerShellToolCallEvent('python deploy.py --status');
  assertPassed(handleToolCall(event));
});

test("blocks Write to .claude/settings.json", () => {
  const event = { tool: "Write", input: { file_path: "C:\\Users\\user\\.claude\\settings.json" } };
  assertBlocked(handleToolCall(event), /settings\.json/);
});

test("allows Write to project settings.json", () => {
  const event = { tool: "Write", input: { file_path: "D:\\project\\config\\settings.json" } };
  assertPassed(handleToolCall(event));
});
