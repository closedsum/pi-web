import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { createGsdLaneExtension, GSD_LANE_EXTENSION_NAME } = await createJiti(import.meta.url).import("./gsd-lane-extension.ts");

function createMockPi() {
  const tools = new Map();
  const handlers = {};
  return {
    tools,
    handlers,
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    appendEntry() {},
    on(event, handler) { handlers[event] = handler; },
    getActiveTools() { return ["read", "write", "edit", "bash", "powershell"]; },
    setActiveTools() {},
    emit(event, ...args) { return handlers[event]?.(...args); },
  };
}

async function loadTools(options = {}) {
  const pi = createMockPi();
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory(pi);
  return pi.tools;
}

async function loadExtension(options = {}) {
  const pi = createMockPi();
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory(pi);
  return pi;
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

test("extension registers a CheckLaneStatus tool", async () => {
  const tools = await loadTools();
  assert.ok(tools.has("CheckLaneStatus"), "CheckLaneStatus tool should be registered");
});

test("CheckLaneStatus tool has optional slug parameter", async () => {
  const tools = await loadTools();
  const tool = tools.get("CheckLaneStatus");
  assert.ok(tool.parameters, "tool should have parameters");
  const props = tool.parameters.properties;
  assert.ok(props.slug, "slug parameter available");
});

test("CheckLaneStatus returns 'no lanes' for empty directory", async () => {
  const { fileURLToPath } = await import("node:url");
  const { dirname } = await import("node:path");
  const tools = await loadTools({ cwd: dirname(fileURLToPath(import.meta.url)) });
  const tool = tools.get("CheckLaneStatus");
  const result = await tool.execute("test-call", {});
  assert.ok(result.content[0].text.includes("No dispatched lanes"), result.content[0].text);
});

describe("CheckDispatchStatus with fixtures", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-status-ext-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeLaneManifest(slug, overrides = {}) {
    const dir = path.join(tmpDir, ".planning", "impl-lanes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `p-${slug}.json`), JSON.stringify({
      type: "pipeline", slug, title: `Task ${slug}`,
      status: "running", phase: "impl",
      start: "2026-09-21T15:00:00+00:00", pid: 12345, ...overrides,
    }));
  }

  function writeUeDispatch(data) {
    const dir = path.join(tmpDir, ".planning", "threads");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "dispatch-progress.json"), JSON.stringify(data));
  }

  test("registers CheckDispatchStatus tool", async () => {
    const tools = await loadTools({ cwd: tmpDir });
    assert.ok(tools.has("CheckDispatchStatus"));
  });

  test("returns lanes and UE dispatches together", async () => {
    writeLaneManifest("fix-abc", { status: "running", phase: "impl" });
    writeUeDispatch({ id: "ue-dispatch", status: "failed", subject: "patrol setup",
      started_at: 1726920000, finished_at: 1726920060,
      steps: [{ text: "patrol villager", done: false }] });

    const tools = await loadTools({ cwd: tmpDir });
    const result = await tools.get("CheckDispatchStatus").execute("t1", {});
    const items = JSON.parse(result.content[0].text);
    assert.equal(items.length, 2, "both lane and UE dispatch returned");
    const sources = items.map(i => i.source);
    assert.ok(sources.includes("lane"));
    assert.ok(sources.includes("ue_dispatch"));
  });

  test("filters by source=lane", async () => {
    writeLaneManifest("lane-only", { status: "done" });
    writeUeDispatch({ id: "ue-dispatch", status: "failed", subject: "test",
      started_at: 1726920000 });

    const tools = await loadTools({ cwd: tmpDir });
    const result = await tools.get("CheckDispatchStatus").execute("t2", { source: "lane" });
    const items = JSON.parse(result.content[0].text);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, "lane");
  });

  test("filters by source=ue_dispatch", async () => {
    writeLaneManifest("ignored-lane", { status: "done" });
    writeUeDispatch({ id: "ue-dispatch", status: "failed", subject: "crashed",
      started_at: 1726920000, finished_at: 1726920030,
      steps: [{ text: "setup patrol [FAILED]", done: false }] });

    const tools = await loadTools({ cwd: tmpDir });
    const result = await tools.get("CheckDispatchStatus").execute("t3", { source: "ue_dispatch" });
    const items = JSON.parse(result.content[0].text);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, "ue_dispatch");
    assert.equal(items[0].status, "failed");
    assert.ok(items[0].steps, "includes steps");
  });

  test("surfaces error field from failed lane", async () => {
    writeLaneManifest("fail-lane", {
      status: "failed", _error: "editor process exited during PIE poll",
    });

    const tools = await loadTools({ cwd: tmpDir });
    const result = await tools.get("CheckDispatchStatus").execute("t4", {});
    const items = JSON.parse(result.content[0].text);
    assert.equal(items[0].error, "editor process exited during PIE poll");
  });

  test("returns empty message when no dispatches exist", async () => {
    const tools = await loadTools({ cwd: tmpDir });
    const result = await tools.get("CheckDispatchStatus").execute("t5", {});
    assert.ok(result.content[0].text.includes("No dispatched work found"));
  });
});

describe("orchestrator tool_call gate", () => {
  test("blocks non-allowed tools in orchestrator mode", async () => {
    const pi = await loadExtension();
    const result = pi.emit("tool_call", { toolName: "bash" });
    assert.ok(result.block, "bash should be blocked");
    assert.ok(result.reason.includes("unavailable in orchestrator mode"));
  });

  test("allows ORCH_ALLOW tools", async () => {
    const pi = await loadExtension();
    const result = pi.emit("tool_call", { toolName: "read" });
    assert.equal(result, undefined, "read should pass through");
  });

  test("read budget terminates after MAX_READS", async () => {
    const pi = await loadExtension();
    for (let i = 0; i < 8; i++) {
      const r = pi.emit("tool_call", { toolName: "read" });
      assert.equal(r, undefined, `read ${i + 1} should pass`);
    }
    const blocked = pi.emit("tool_call", { toolName: "read" });
    assert.ok(blocked.block, "9th read should be blocked");
    assert.ok(blocked.terminate, "should terminate the turn");
    assert.ok(blocked.reason.includes("Read budget exhausted"));
  });

  test("dispatch blocks second DispatchLane within cooldown", async () => {
    const pi = await loadExtension();
    const r1 = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.equal(r1, undefined, "first DispatchLane allowed");
    const r2 = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.ok(r2.block, "second DispatchLane should be blocked");
    assert.ok(r2.terminate, "should terminate the turn");
    assert.ok(r2.reason.includes("already dispatched"));
  });

  test("dispatch persists across turn_start within cooldown", async () => {
    const pi = await loadExtension();
    pi.emit("tool_call", { toolName: "DispatchLane" });
    pi.emit("turn_start");
    const r = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.ok(r.block, "second DispatchLane after turn_start should still be blocked");
    assert.ok(r.terminate, "should terminate");
  });
});
