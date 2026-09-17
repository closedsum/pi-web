import assert from "node:assert/strict";
import test from "node:test";
import { makePowerShellToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

function handleToolCall(event) {
  if (event.tool !== "PowerShell") return undefined;
  const cmd = event.input?.command || "";
  if (/Out-File.*-Encoding\s+utf8\b/i.test(cmd) || /Set-Content.*-Encoding\s+utf8\b/i.test(cmd)) {
    return { block: true, reason: "Never use -Encoding utf8 (produces BOM); use [System.IO.File]::WriteAllText with UTF8Encoding($false)" };
  }
  return undefined;
}

test("blocks Out-File with -Encoding utf8", () => {
  const event = makePowerShellToolCallEvent('$result | Out-File -Encoding utf8 "output.txt"');
  assertBlocked(handleToolCall(event), /BOM/);
});

test("blocks Set-Content with -Encoding utf8", () => {
  const event = makePowerShellToolCallEvent('Set-Content -Path "file.txt" -Value $data -Encoding utf8');
  assertBlocked(handleToolCall(event), /BOM/);
});

test("allows Out-File without encoding flag", () => {
  const event = makePowerShellToolCallEvent('$result | Out-File "output.txt"');
  assertPassed(handleToolCall(event));
});

test("allows WriteAllText (the correct approach)", () => {
  const event = makePowerShellToolCallEvent('[System.IO.File]::WriteAllText("file.txt", $data, [System.Text.UTF8Encoding]::new($false))');
  assertPassed(handleToolCall(event));
});
