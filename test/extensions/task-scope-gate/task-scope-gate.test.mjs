import assert from "node:assert/strict";
import test from "node:test";
import { assertBlocked, assertPassed } from "../_config.mjs";

const PARTITION_THRESHOLD = 10;

function handleToolCall(event, repoState = {}) {
  if (event.tool !== "TaskCreate" && event.tool !== "TaskUpdate") return undefined;
  const metadata = event.input?.metadata || {};
  const writeScope = Array.isArray(metadata.writeScope) ? metadata.writeScope : null;
  if (!writeScope?.length) {
    if (event.tool === "TaskUpdate" && !event.input?.description && !event.input?.subject) return undefined;
    return { inject: "[TASK-SCOPE-GATE] no metadata.writeScope declared — task excluded from dispatch waves." };
  }
  for (const entry of writeScope) {
    const fileCount = repoState.scopeFileCounts?.[entry] || 0;
    if (fileCount > PARTITION_THRESHOLD) {
      return { block: true, reason: `[TASK-SCOPE-GATE] BLOCKED: writeScope "${entry}" covers ${fileCount} files (threshold ${PARTITION_THRESHOLD}). Split the task.` };
    }
  }
  if (!metadata.verify) {
    return { inject: "[TASK-SCOPE-GATE] metadata.verify is missing; lane dispatch will refuse this task." };
  }
  return undefined;
}

test("blocks over-broad writeScope", () => {
  const event = { tool: "TaskCreate", input: { metadata: { writeScope: ["lib/"] } } };
  assertBlocked(handleToolCall(event, { scopeFileCounts: { "lib/": 50 } }), /TASK-SCOPE-GATE/);
});

test("allows narrow writeScope", () => {
  const event = { tool: "TaskCreate", input: { metadata: { writeScope: ["lib/model-registry.ts"], verify: "npm test" } } };
  assertPassed(handleToolCall(event, { scopeFileCounts: { "lib/model-registry.ts": 1 } }));
});

test("warns on missing writeScope", () => {
  const event = { tool: "TaskCreate", input: { subject: "fix bug" } };
  const result = handleToolCall(event);
  assert.ok(result?.inject);
  assert.match(result.inject, /writeScope/);
});

test("warns on missing verify", () => {
  const event = { tool: "TaskCreate", input: { metadata: { writeScope: ["src/main.ts"] } } };
  const result = handleToolCall(event, { scopeFileCounts: { "src/main.ts": 1 } });
  assert.ok(result?.inject);
  assert.match(result.inject, /verify/);
});

test("skips TaskUpdate with only status change", () => {
  const event = { tool: "TaskUpdate", input: { taskId: "1", status: "completed" } };
  assertPassed(handleToolCall(event));
});
