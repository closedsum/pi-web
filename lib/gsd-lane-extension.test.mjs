import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createGsdLaneExtension, GSD_LANE_EXTENSION_NAME } = await createJiti(import.meta.url).import("./gsd-lane-extension.ts");

async function loadTools(options = {}) {
  const tools = new Map();
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
  });
  return tools;
}

test("extension registers a DispatchLane tool", async () => {
  const tools = await loadTools();
  assert.ok(tools.has("DispatchLane"), "DispatchLane tool should be registered");
});

test("extension has the correct name", () => {
  const ext = createGsdLaneExtension({ cwd: "/tmp/test" });
  assert.equal(ext.name, GSD_LANE_EXTENSION_NAME);
  assert.equal(ext.hidden, true);
});

test("DispatchLane tool has required parameter schema", async () => {
  const tools = await loadTools();
  const tool = tools.get("DispatchLane");
  assert.ok(tool.parameters, "tool should have parameters");
  const props = tool.parameters.properties;
  assert.ok(props.task, "task parameter required");
  assert.ok(props.slug, "slug parameter available");
  assert.ok(props.write_scope, "write_scope parameter available");
  assert.ok(props.title, "title parameter available");
  assert.ok(props.skip_review, "skip_review parameter available");
});

test("DispatchLane tool has parallel execution mode", async () => {
  const tools = await loadTools();
  const tool = tools.get("DispatchLane");
  assert.equal(tool.executionMode, "parallel");
});

test("extension uses provided gsdBinDir", () => {
  const ext = createGsdLaneExtension({ cwd: "/tmp/test", gsdBinDir: "/custom/bin" });
  assert.ok(ext, "extension should accept custom gsdBinDir");
});
