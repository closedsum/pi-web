import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { blockPipelineStateTamper } = await jiti.import("@/lib/extensions/tool-blockers.ts");

function check(toolName, input) {
  return blockPipelineStateTamper.test(toolName, input);
}

test("blocks Write to lane-events.jsonl", () => {
  const result = check("Write", { file_path: "D:\\Trees\\project\\.planning\\lane-events.jsonl", content: "data" });
  assert.ok(result?.block);
  assert.match(result.reason, /pipeline state/);
});

test("blocks Edit to lane manifest.json", () => {
  const result = check("Edit", { file_path: "/home/user/project/.planning/impl-lanes/fix-auth/manifest.json", new_string: "{}" });
  assert.ok(result?.block);
});

test("blocks Write to lane events.jsonl", () => {
  const result = check("Write", { file_path: "D:\\Trees\\project\\.planning\\impl-lanes\\p-fix\\events.jsonl", content: "[]" });
  assert.ok(result?.block);
});

test("blocks Write to .pipeline.out", () => {
  const result = check("Write", { file_path: "C:\\tmp\\output.pipeline.out", content: "data" });
  assert.ok(result?.block);
});

test("allows Write to normal files", () => {
  assert.equal(check("Write", { file_path: "D:\\Trees\\project\\lib\\module.ts", content: "code" }), undefined);
});

test("allows Write to .planning non-pipeline files", () => {
  assert.equal(check("Write", { file_path: "D:\\Trees\\project\\.planning\\PLAN.md", content: "plan" }), undefined);
});

test("ignores non-write tools", () => {
  assert.equal(check("Bash", { file_path: ".planning/lane-events.jsonl" }), undefined);
  assert.equal(check("Read", { file_path: ".planning/impl-lanes/x/manifest.json" }), undefined);
});
