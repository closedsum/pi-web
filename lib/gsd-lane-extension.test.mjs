import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { createGsdLaneExtension, GSD_LANE_EXTENSION_NAME, parseConfigString, parseResolvedModel, renderLaneSpec } =
  await createJiti(import.meta.url).import("./gsd-lane-extension.ts");

// Mirrors gsd-config lane_pre_chain.py plan validation (_PLAN_REQUIRED_SECTIONS, _PLAN_MIN_WORDS).
function lanePlanMissing(spec) {
  const lower = spec.toLowerCase();
  const collapsed = lower.replace(/[ _-]/g, "");
  return ["goal", "writescope", "test"].filter((s) => !lower.includes(s) && !collapsed.includes(s));
}

test("renderLaneSpec emits the sections lane plan validation requires", () => {
  const spec = renderLaneSpec({ title: "Fix idle timeout", task: "Change the idle timeout default to 5 minutes.", writeScope: ["lib/**", "components/Foo.tsx"] });
  assert.deepEqual(lanePlanMissing(spec), []);
  assert.ok(spec.split(/\s+/).length >= 15);
  for (const heading of ["# Spec: Fix idle timeout", "## Goal", "## Fix", "## Test Requirements", "## WriteScope", "## Pipeline Quality Gates"]) {
    assert.ok(spec.includes(heading), `missing ${heading}`);
  }
  assert.match(spec, /## WriteScope\n- `lib\/\*\*`\n- `components\/Foo\.tsx`/);
  assert.ok(spec.includes("Change the idle timeout default to 5 minutes."));
});

test("renderLaneSpec without a write scope still passes validation and says how to scope", () => {
  const spec = renderLaneSpec({ title: "t", task: "Do the thing." });
  assert.deepEqual(lanePlanMissing(spec), []);
  assert.match(spec, /## WriteScope\n- Determine from investigation/);
});

// Real CLI output shapes captured 2026-09-22.
const CONFIG_GET_STDOUT = '"D:\\\\Trees\\\\worktrees"\r\n';
const RESOLVED = {
  Provider: "codex",
  Model: "gpt-6-sol",
  Effort: "high",
  ModelReason: "Resolved from impl_lanes config: provider 'codex' default model 'gpt-6-sol' at feature-tier effort 'high' for implementation.",
};
const RESOLVE_MODEL_STDOUT = `${JSON.stringify(RESOLVED, null, 2)}\n${JSON.stringify(RESOLVED, null, 2)}\n`;

test("parseConfigString decodes the JSON string gsd-config.py get prints", () => {
  assert.equal(parseConfigString(CONFIG_GET_STDOUT), "D:\\Trees\\worktrees");
});

test("parseConfigString accepts a bare value and rejects empty or non-string output", () => {
  assert.equal(parseConfigString("D:\\Trees\\worktrees\n"), "D:\\Trees\\worktrees");
  assert.equal(parseConfigString("  \n"), null);
  assert.equal(parseConfigString("null\n"), null);
  assert.equal(parseConfigString("{\"a\": 1}"), null);
});

test("parseResolvedModel reads the first object of resolve-model's duplicated output", () => {
  assert.deepEqual(parseResolvedModel(RESOLVE_MODEL_STDOUT), {
    provider: "codex", model: "gpt-6-sol", effort: "high", reason: RESOLVED.ModelReason,
  });
});

test("parseResolvedModel accepts lowercase keys and rejects incomplete output", () => {
  assert.deepEqual(parseResolvedModel('{"provider":"claude","model":"m","effort":"max"}'),
    { provider: "claude", model: "m", effort: "max", reason: undefined });
  assert.equal(parseResolvedModel('{"Provider":"codex","Model":"gpt-6-sol"}'), null);
  assert.equal(parseResolvedModel("not json"), null);
  assert.equal(parseResolvedModel(""), null);
});

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

  test("budget overrides via options", async () => {
    const pi = await loadExtension({ budgets: { maxReads: 3, maxDispatches: 2 } });
    for (let i = 0; i < 3; i++) {
      const r = pi.emit("tool_call", { toolName: "read" });
      assert.equal(r, undefined, `read ${i + 1} should pass with maxReads=3`);
    }
    const blocked = pi.emit("tool_call", { toolName: "read" });
    assert.ok(blocked.block, "4th read should be blocked with maxReads=3");

    const d1 = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.equal(d1, undefined, "first DispatchLane allowed with maxDispatches=2");
    const d2 = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.equal(d2, undefined, "second DispatchLane allowed with maxDispatches=2");
    const d3 = pi.emit("tool_call", { toolName: "DispatchLane" });
    assert.ok(d3.block, "third DispatchLane should be blocked with maxDispatches=2");
  });
});
