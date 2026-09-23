import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const { createGsdLaneExtension, DEFAULT_BUDGETS } = await createJiti(import.meta.url).import("./gsd-lane-extension.ts");

// ---------------------------------------------------------------------------
// Test harness: capture registered tool config without running real lanes
// ---------------------------------------------------------------------------

async function getDispatchLaneTool(options = {}) {
  const tools = new Map();
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    on() {},
    getActiveTools() { return ["read", "write", "edit", "bash", "powershell"]; },
    setActiveTools() {},
  });
  return tools.get("DispatchLane");
}

// ---------------------------------------------------------------------------
// Orchestrator event chain fixtures
//
// Each scenario defines:
//   input:    the user message
//   golden:   the expected event chain (what Opus 4.6 max produces)
//   failure:  the broken chain GPT-5.6 Sol produced before the fix
//
// Event types:
//   "text"       — model responds with text to the user
//   "tool_call"  — model invokes a tool (name + args)
//   "tool_result" — tool returns a result
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: "implementation-request",
    description: "User asks to fix a bug — orchestrator should analyze then dispatch",
    input: "Fix the PIE polling to bind to the editor PID so it fails fast when the editor crashes",
    golden: [
      { type: "text", contains: ["PIE", "PID"] },
      { type: "tool_call", name: "DispatchLane", argsContain: ["PIE", "PID"] },
      { type: "tool_result" },
    ],
    failure: [
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
    ],
  },
  {
    id: "pure-question",
    description: "User asks a question — orchestrator should answer directly, no dispatch",
    input: "What does the DispatchLane tool do?",
    golden: [
      { type: "text", contains: ["lane", "autonomous"] },
    ],
    failure: [
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
    ],
  },
  {
    id: "multi-step-task",
    description: "User asks for a feature — orchestrator should analyze, dispatch once",
    input: "Add a retry mechanism to the UE sidecar connection with exponential backoff",
    golden: [
      { type: "text", contains: ["retry", "backoff"] },
      { type: "tool_call", name: "DispatchLane", argsContain: ["retry"] },
      { type: "tool_result" },
    ],
    failure: [
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
    ],
  },
  {
    id: "status-check",
    description: "User asks about progress — orchestrator should respond directly",
    input: "What's the status of the lane I dispatched earlier?",
    golden: [
      { type: "text", contains: ["lane", "status"] },
    ],
    failure: [
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
    ],
  },
  {
    id: "mixed-request",
    description: "User asks a question AND requests a change — orchestrator should answer then dispatch",
    input: "Why does the session idle timeout default to 10 minutes? Change it to 5 minutes.",
    golden: [
      { type: "text", contains: ["idle", "timeout"] },
      { type: "tool_call", name: "DispatchLane", argsContain: ["timeout", "5"] },
      { type: "tool_result" },
    ],
    failure: [
      { type: "tool_call", name: "DispatchLane" },
      { type: "tool_result" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Contract tests: verify the tool config enforces orchestrator behavior
// ---------------------------------------------------------------------------

test("prompt guidelines enforce text-before-dispatch", async () => {
  const tool = await getDispatchLaneTool();
  const guidelines = tool.promptGuidelines.join(" ");
  assert.ok(
    guidelines.includes("text response BEFORE") || guidelines.includes("respond") && guidelines.includes("before"),
    "guidelines must instruct model to respond with text before dispatching",
  );
});

test("prompt guidelines forbid direct implementation", async () => {
  const tool = await getDispatchLaneTool();
  const guidelines = tool.promptGuidelines.join(" ");
  assert.ok(
    guidelines.includes("NEVER") && (guidelines.includes("edit") || guidelines.includes("implement")),
    "guidelines must forbid direct file editing and implementation",
  );
});

test("prompt guidelines prohibit dispatch loops", async () => {
  const tool = await getDispatchLaneTool();
  const guidelines = tool.promptGuidelines.join(" ");
  assert.ok(
    /exactly once|never chain/i.test(guidelines),
    "guidelines must prohibit chaining multiple dispatches",
  );
});

test("prompt guidelines distinguish questions from implementation", async () => {
  const tool = await getDispatchLaneTool();
  const guidelines = tool.promptGuidelines.join(" ");
  assert.ok(
    guidelines.includes("pure questions") || guidelines.includes("Answer") && guidelines.includes("directly"),
    "guidelines must tell model to answer questions directly without dispatching",
  );
});

test("executionMode is parallel (non-blocking)", async () => {
  const tool = await getDispatchLaneTool();
  assert.equal(tool.executionMode, "parallel", "DispatchLane must be non-blocking");
});

// ---------------------------------------------------------------------------
// Scenario validation: golden chains match orchestrator contract
// ---------------------------------------------------------------------------

function validateGoldenChain(scenario) {
  const { golden } = scenario;
  const hasText = golden.some((e) => e.type === "text");
  const toolCalls = golden.filter((e) => e.type === "tool_call");
  const firstEvent = golden[0];
  return { hasText, toolCalls, firstEvent };
}

test("scenario: implementation-request — golden chain has text before dispatch", () => {
  const s = SCENARIOS.find((s) => s.id === "implementation-request");
  const { hasText, toolCalls, firstEvent } = validateGoldenChain(s);
  assert.ok(hasText, "golden chain must include text response");
  assert.equal(firstEvent.type, "text", "first event must be text (analysis)");
  assert.equal(toolCalls.length, 1, "exactly one dispatch call");
  assert.equal(toolCalls[0].name, "DispatchLane");
});

test("scenario: pure-question — golden chain has no dispatch", () => {
  const s = SCENARIOS.find((s) => s.id === "pure-question");
  const { hasText, toolCalls } = validateGoldenChain(s);
  assert.ok(hasText, "must respond with text");
  assert.equal(toolCalls.length, 0, "no dispatch for a pure question");
});

test("scenario: multi-step-task — golden chain dispatches once, not multiple", () => {
  const s = SCENARIOS.find((s) => s.id === "multi-step-task");
  const { hasText, toolCalls, firstEvent } = validateGoldenChain(s);
  assert.ok(hasText, "must include text analysis");
  assert.equal(firstEvent.type, "text", "text comes before dispatch");
  assert.equal(toolCalls.length, 1, "exactly one dispatch, not a loop");
});

test("scenario: status-check — golden chain is text only", () => {
  const s = SCENARIOS.find((s) => s.id === "status-check");
  const { hasText, toolCalls } = validateGoldenChain(s);
  assert.ok(hasText, "must respond with text");
  assert.equal(toolCalls.length, 0, "no dispatch for a status check");
});

test("scenario: mixed-request — golden chain has text then one dispatch", () => {
  const s = SCENARIOS.find((s) => s.id === "mixed-request");
  const { hasText, toolCalls, firstEvent } = validateGoldenChain(s);
  assert.ok(hasText, "must include text explanation");
  assert.equal(firstEvent.type, "text", "explanation before dispatch");
  assert.equal(toolCalls.length, 1, "one dispatch for the change request");
});

// ---------------------------------------------------------------------------
// Failure mode detection: verify broken chains violate the contract
// ---------------------------------------------------------------------------

function detectFailureModes(chain) {
  const modes = [];
  const hasText = chain.some((e) => e.type === "text");
  if (!hasText) modes.push("NO_TEXT_RESPONSE");
  if (chain[0]?.type === "tool_call") modes.push("TOOL_CALL_WITHOUT_TEXT_FIRST");
  const consecutiveToolCalls = chain.filter((e) => e.type === "tool_call").length;
  if (consecutiveToolCalls > 1) modes.push("DISPATCH_LOOP");
  return modes;
}

for (const scenario of SCENARIOS) {
  test(`failure detection: ${scenario.id} — broken chain triggers violations`, () => {
    const modes = detectFailureModes(scenario.failure);
    assert.ok(modes.length > 0, `failure chain for "${scenario.id}" must have at least one violation`);

    if (scenario.id === "pure-question" || scenario.id === "status-check") {
      assert.ok(
        modes.includes("TOOL_CALL_WITHOUT_TEXT_FIRST"),
        "dispatching on a question is a violation",
      );
    }
    if (scenario.failure.filter((e) => e.type === "tool_call").length > 1) {
      assert.ok(modes.includes("DISPATCH_LOOP"), "multiple dispatches is a loop violation");
    }
  });
}

// ---------------------------------------------------------------------------
// Dispatch guard: code-level loop prevention in the tool_call handler
// ---------------------------------------------------------------------------

test("dispatch guard blocks 3rd dispatch within the cooldown window", async () => {
  // Explicit budgets override defaults.json, keeping the test deterministic.
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture({
    budgets: { maxDispatches: 2, dispatchCooldownMs: 60_000 },
  });
  const handler = toolCallHandlers[0];
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await handler(makeToolCallEvent("DispatchLane")));

  assert.equal(results[0], undefined, "1st dispatch must pass the guard");
  assert.equal(results[1], undefined, "2nd dispatch must pass the guard");
  for (const r of results.slice(2)) {
    assert.equal(r?.block, true, "3rd+ dispatch must be blocked");
    assert.equal(r?.terminate, true, "blocked dispatch must terminate the turn");
    assert.match(r.reason, /already dispatched/);
  }
});

test("dispatch guard with the default cap of 1 re-allows dispatch after the cooldown", async (t) => {
  // maxDispatches is left to the default merge; a missing gsdBinDir keeps
  // defaults.json out of it so the shipped DEFAULT_BUDGETS value applies.
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture({
    gsdBinDir: "/nonexistent-gsd-bin",
    budgets: { dispatchCooldownMs: 45_000 },
  });
  const handler = toolCallHandlers[0];
  // Mocked Date keeps the cooldown boundary deterministic (no wall-clock sleeps).
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  assert.equal(DEFAULT_BUDGETS.maxDispatches, 1, "shipped default allows one dispatch per request");
  assert.equal(await handler(makeToolCallEvent("DispatchLane")), undefined, "1st dispatch passes");
  t.mock.timers.tick(45_000);
  assert.equal((await handler(makeToolCallEvent("DispatchLane")))?.block, true, "2nd dispatch at exactly the cooldown blocks");
  t.mock.timers.tick(1);
  assert.equal(await handler(makeToolCallEvent("DispatchLane")), undefined, "dispatch passes once the cooldown has elapsed");
});

// ---------------------------------------------------------------------------
// tool_call allow-list: hard mid-turn gate via pi.on("tool_call")
// ---------------------------------------------------------------------------

async function buildExtensionWithToolCallCapture(options = {}) {
  const tools = new Map();
  const toolCallHandlers = [];
  const turnStartHandlers = [];
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    on(event, handler) {
      if (event === "tool_call") toolCallHandlers.push(handler);
      if (event === "turn_start") turnStartHandlers.push(handler);
    },
    getActiveTools() { return ["read", "write", "edit", "bash", "powershell"]; },
    setActiveTools() {},
  });
  return { tools, toolCallHandlers, turnStartHandlers };
}

function makeToolCallEvent(toolName) {
  return { type: "tool_call", toolCallId: `test-${toolName}`, toolName, input: {} };
}

test("tool_call handler blocks bash in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  assert.ok(toolCallHandlers.length > 0, "must register a tool_call handler");
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("bash"));
  assert.ok(result?.block === true, "bash must be blocked");
  assert.ok(result?.reason?.includes("orchestrator"), "reason must mention orchestrator mode");
});

test("tool_call handler blocks powershell in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("powershell"));
  assert.ok(result?.block === true, "powershell must be blocked");
});

test("tool_call handler blocks write in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("write"));
  assert.ok(result?.block === true, "write must be blocked");
});

test("tool_call handler blocks edit in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("edit"));
  assert.ok(result?.block === true, "edit must be blocked");
});

test("tool_call handler allows read in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("read"));
  assert.ok(!result || result.block !== true, "read must NOT be blocked");
});

test("tool_call handler allows grep in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("grep"));
  assert.ok(!result || result.block !== true, "grep must NOT be blocked");
});

test("tool_call handler allows DispatchLane in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("DispatchLane"));
  assert.ok(!result || result.block !== true, "DispatchLane must NOT be blocked");
});

test("tool_call handler allows ue_dispatch in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("ue_dispatch"));
  assert.ok(!result || result.block !== true, "ue_dispatch must NOT be blocked — it is a dispatch tool");
});

test("tool_call handler terminates after MAX_BLOCKS_PER_TURN consecutive blocks", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  let lastResult;
  for (let i = 0; i < 5; i++) {
    lastResult = await handler(makeToolCallEvent("bash"));
  }
  assert.ok(lastResult?.terminate === true, "must set terminate after repeated blocks");
});

test("tool_call handler blocks unknown/future tools by default (allow-list)", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  const result = await handler(makeToolCallEvent("apply_patch"));
  assert.ok(result?.block === true, "unknown tools must be blocked by default (allow-list)");
});

test("tool_call handler blocks notebook_edit", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("notebook_edit"));
  assert.ok(result?.block === true, "notebook_edit must be blocked");
});

test("tool_call handler allows find in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("find"));
  assert.ok(!result || result.block !== true, "find must NOT be blocked");
});

test("tool_call handler allows ls in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("ls"));
  assert.ok(!result || result.block !== true, "ls must NOT be blocked");
});

test("tool_call handler allows glob in orchestrator mode", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("glob"));
  assert.ok(!result || result.block !== true, "glob must NOT be blocked");
});

test("block counter resets between turns via turn_start", async () => {
  const tools = new Map();
  const handlers = { tool_call: [], turn_start: [] };
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project" });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    on(event, handler) { (handlers[event] ??= []).push(handler); },
    getActiveTools() { return []; },
    setActiveTools() {},
  });
  assert.ok(handlers.turn_start.length > 0, "must register a turn_start handler to reset counter");
  const toolCallHandler = handlers.tool_call[0];
  const turnStartHandler = handlers.turn_start[0];

  // Block twice (under threshold)
  await toolCallHandler(makeToolCallEvent("bash"));
  await toolCallHandler(makeToolCallEvent("bash"));

  // Simulate new turn
  await turnStartHandler({});

  // Counter should be reset — next block should NOT terminate
  const result = await toolCallHandler(makeToolCallEvent("bash"));
  assert.ok(result?.block === true, "still blocked after reset");
  assert.ok(result?.terminate !== true, "must NOT terminate — counter was reset by turn_start");
});

test("scope isolation: block counter is per-extension-instance", async () => {
  const ext1 = await buildExtensionWithToolCallCapture();
  const ext2 = await buildExtensionWithToolCallCapture();
  // Exhaust ext1's budget
  for (let i = 0; i < 5; i++) await ext1.toolCallHandlers[0](makeToolCallEvent("bash"));
  // ext2 should be independent — first call should NOT terminate
  const result = await ext2.toolCallHandlers[0](makeToolCallEvent("bash"));
  assert.ok(result?.block === true, "ext2 should still block");
  assert.ok(result?.terminate !== true, "ext2 counter must be independent — no terminate on first block");
});

test("block reason includes the blocked tool name", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("powershell"));
  assert.ok(result?.reason?.includes("powershell"), "reason must name the blocked tool");
});

test("block reason suggests DispatchLane", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const result = await toolCallHandlers[0](makeToolCallEvent("edit"));
  assert.ok(result?.reason?.includes("DispatchLane"), "reason must suggest DispatchLane as alternative");
});

test("terminate message includes budget exhaustion notice", async () => {
  const { toolCallHandlers } = await buildExtensionWithToolCallCapture();
  const handler = toolCallHandlers[0];
  let result;
  for (let i = 0; i < 5; i++) result = await handler(makeToolCallEvent("write"));
  assert.ok(result?.reason?.includes("budget exhausted"), "terminate reason must mention budget exhaustion");
});

// ---------------------------------------------------------------------------
// Mode persistence tests
// ---------------------------------------------------------------------------

async function buildExtensionWithModePersistence(options = {}) {
  const tools = new Map();
  const toolCallHandlers = [];
  const turnStartHandlers = [];
  const sessionStartHandlers = [];
  const appendedEntries = [];
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    on(event, handler) {
      if (event === "tool_call") toolCallHandlers.push(handler);
      if (event === "turn_start") turnStartHandlers.push(handler);
      if (event === "session_start") sessionStartHandlers.push(handler);
    },
    getActiveTools() { return ["read", "write", "edit", "bash", "powershell"]; },
    setActiveTools() {},
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data });
    },
  });
  return { tools, toolCallHandlers, turnStartHandlers, sessionStartHandlers, appendedEntries };
}

function makeSessionStartCtx(entries = []) {
  return {
    sessionManager: {
      getEntries() { return entries; },
    },
  };
}

function makeCustomEntry(customType, data) {
  return { type: "custom", customType, data, id: `entry-${Date.now()}` };
}

test("registers session_start handler for mode rehydration", async () => {
  const { sessionStartHandlers } = await buildExtensionWithModePersistence();
  assert.ok(sessionStartHandlers.length > 0, "must register a session_start handler");
});

test("orchestrator mode is active by default (blocks edit)", async () => {
  const { toolCallHandlers } = await buildExtensionWithModePersistence();
  const result = await toolCallHandlers[0](makeToolCallEvent("edit"));
  assert.ok(result?.block === true, "edit must be blocked in default orchestrator mode");
});

test("mode rehydrates to inline from session entries — edit is allowed", async () => {
  const { toolCallHandlers, sessionStartHandlers } = await buildExtensionWithModePersistence();
  const entries = [makeCustomEntry("gsd-orchestrator-mode", { mode: "inline" })];
  await sessionStartHandlers[0]({ type: "session_start", reason: "resume" }, makeSessionStartCtx(entries));
  const result = await toolCallHandlers[0](makeToolCallEvent("edit"));
  assert.equal(result, undefined, "edit must be allowed after rehydrating to inline mode");
});

test("mode rehydrates to orchestrator from session entries — edit is blocked", async () => {
  const { toolCallHandlers, sessionStartHandlers } = await buildExtensionWithModePersistence();
  const entries = [
    makeCustomEntry("gsd-orchestrator-mode", { mode: "inline" }),
    makeCustomEntry("gsd-orchestrator-mode", { mode: "orchestrator" }),
  ];
  await sessionStartHandlers[0]({ type: "session_start", reason: "resume" }, makeSessionStartCtx(entries));
  const result = await toolCallHandlers[0](makeToolCallEvent("edit"));
  assert.ok(result?.block === true, "edit must be blocked after rehydrating to orchestrator mode");
});

test("uses last entry when multiple mode entries exist", async () => {
  const { toolCallHandlers, sessionStartHandlers } = await buildExtensionWithModePersistence();
  const entries = [
    makeCustomEntry("gsd-orchestrator-mode", { mode: "orchestrator" }),
    makeCustomEntry("gsd-orchestrator-mode", { mode: "inline" }),
    makeCustomEntry("gsd-orchestrator-mode", { mode: "orchestrator" }),
    makeCustomEntry("gsd-orchestrator-mode", { mode: "inline" }),
  ];
  await sessionStartHandlers[0]({ type: "session_start", reason: "resume" }, makeSessionStartCtx(entries));
  const result = await toolCallHandlers[0](makeToolCallEvent("bash"));
  assert.equal(result, undefined, "last entry is inline — bash must be allowed");
});

test("ignores unrelated custom entries during rehydration", async () => {
  const { toolCallHandlers, sessionStartHandlers } = await buildExtensionWithModePersistence();
  const entries = [
    makeCustomEntry("some-other-extension", { mode: "inline" }),
    makeCustomEntry("gsd-orchestrator-mode", { mode: "orchestrator" }),
  ];
  await sessionStartHandlers[0]({ type: "session_start", reason: "resume" }, makeSessionStartCtx(entries));
  const result = await toolCallHandlers[0](makeToolCallEvent("edit"));
  assert.ok(result?.block === true, "must only read gsd-orchestrator-mode entries");
});

// ---------------------------------------------------------------------------
// Failure classification tests
// ---------------------------------------------------------------------------

const { classifyDispatchFailure } = await createJiti(import.meta.url).import("./gsd-lane-extension.ts");

test("classifyDispatchFailure: spawn error is infra", () => {
  assert.equal(classifyDispatchFailure("Lane spawn failed: process did not start"), "infra");
});

test("classifyDispatchFailure: binary not found is infra", () => {
  assert.equal(classifyDispatchFailure("ENOENT python3 not found"), "infra");
});

test("classifyDispatchFailure: queue build failed is infra", () => {
  assert.equal(classifyDispatchFailure("Lane queue build failed for slug: ModuleNotFoundError"), "infra");
});

test("classifyDispatchFailure: worktree already exists is ownership", () => {
  assert.equal(classifyDispatchFailure("fatal: 'D:/Trees/worktrees/pi-fix' is already a worktree"), "ownership");
});

test("classifyDispatchFailure: branch already checked out is ownership", () => {
  assert.equal(classifyDispatchFailure("fatal: 'lane/fix-bug' is already checked out at"), "ownership");
});

test("classifyDispatchFailure: unknown error is unknown", () => {
  assert.equal(classifyDispatchFailure("something unexpected happened"), "unknown");
});

test("DispatchLane failure records entry via appendEntry", async () => {
  const { tools, appendedEntries } = await buildExtensionWithModePersistence();
  const tool = tools.get("DispatchLane");
  const result = await tool.execute("test-call", { task: "test task" });
  if (result.isError) {
    const failEntry = appendedEntries.find((e) => e.customType === "gsd-dispatch-failure");
    assert.ok(failEntry, "must record failure via appendEntry");
    assert.ok(failEntry.data.class, "must include failure class");
    assert.ok(failEntry.data.error, "must include error message");
  }
});

test("infra failure auto-flips mode to inline for current turn", async () => {
  const { tools, toolCallHandlers, turnEndHandlers, appendedEntries } = await buildExtensionWithModePersistenceAndTurnEnd();
  const tool = tools.get("DispatchLane");
  await tool.execute("test-call", { task: "test task" });

  const failEntry = appendedEntries.find((e) => e.customType === "gsd-dispatch-failure");
  if (failEntry?.data?.class === "infra") {
    const editResult = await toolCallHandlers[0](makeToolCallEvent("edit"));
    assert.equal(editResult, undefined, "edit must be allowed after infra failure auto-flip");
  }
});

test("inline auto-flip reverts to orchestrator on turn_end", async () => {
  const { tools, toolCallHandlers, turnEndHandlers, appendedEntries } = await buildExtensionWithModePersistenceAndTurnEnd();
  const tool = tools.get("DispatchLane");
  await tool.execute("test-call", { task: "test task" });

  const failEntry = appendedEntries.find((e) => e.customType === "gsd-dispatch-failure");
  if (failEntry?.data?.class === "infra") {
    for (const h of turnEndHandlers) await h({ type: "turn_end" });
    const editResult = await toolCallHandlers[0](makeToolCallEvent("edit"));
    assert.ok(editResult?.block === true, "edit must be blocked again after turn_end revert");
  }
});

async function buildExtensionWithModePersistenceAndTurnEnd(options = {}) {
  const tools = new Map();
  const toolCallHandlers = [];
  const turnStartHandlers = [];
  const turnEndHandlers = [];
  const sessionStartHandlers = [];
  const appendedEntries = [];
  const extension = createGsdLaneExtension({ cwd: "/tmp/test-project", ...options });
  await extension.factory({
    registerTool(tool) { tools.set(tool.name, tool); },
    sendMessage() {},
    on(event, handler) {
      if (event === "tool_call") toolCallHandlers.push(handler);
      if (event === "turn_start") turnStartHandlers.push(handler);
      if (event === "turn_end") turnEndHandlers.push(handler);
      if (event === "session_start") sessionStartHandlers.push(handler);
    },
    getActiveTools() { return ["read", "write", "edit", "bash", "powershell"]; },
    setActiveTools() {},
    appendEntry(customType, data) {
      appendedEntries.push({ customType, data });
    },
  });
  return { tools, toolCallHandlers, turnStartHandlers, turnEndHandlers, sessionStartHandlers, appendedEntries };
}

// ---------------------------------------------------------------------------
// Subagent isolation verification (U6)
// ---------------------------------------------------------------------------

test("gsd-lane extensionFactories are only in main session branch (not subagent)", async () => {
  const rpcSource = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const callIdx = rpcSource.indexOf("createGsdLaneExtension({");
  assert.ok(callIdx > 0, "createGsdLaneExtension({ cwd }) call must exist in rpc-manager.ts");
  const before = rpcSource.slice(Math.max(0, callIdx - 800), callIdx);
  assert.ok(
    before.includes("extensionFactories"),
    "createGsdLaneExtension call must be inside extensionFactories (main session path)",
  );
  assert.ok(
    !before.includes("subagentResources.loadExtensions"),
    "createGsdLaneExtension call must not be in the subagentResources branch",
  );
});

// ---------------------------------------------------------------------------
// Export scenarios for external consumers (live API tests, CI dashboards)
// ---------------------------------------------------------------------------

export { SCENARIOS, detectFailureModes, validateGoldenChain };
