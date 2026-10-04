import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";
import { createMockPi, assertBlocks, assertAllows } from "./_test-harness.mjs";

const jiti = createJiti(import.meta.url);
const { createGsdExtension, GSD_EXTENSION_NAME } = await jiti.import("./index.ts");
const { blockSendFeedback } = await jiti.import("./tool-blockers.ts");

describe("createGsdExtension", () => {
  test("has the expected name", () => {
    const ext = createGsdExtension();
    assert.equal(ext.name, GSD_EXTENSION_NAME);
  });

  test("registers tool_call handler that blocks dangerous tools", async () => {
    const pi = createMockPi();
    await createGsdExtension().factory(pi);
    assertBlocks(pi, "SendFeedback", {}, /disabled/);
  });

  test("allows safe tool calls through", async () => {
    const pi = createMockPi();
    await createGsdExtension().factory(pi);
    assertAllows(pi, "Read", { file_path: "/tmp/test.txt" });
  });

  test("blocks python -c in Bash", async () => {
    const pi = createMockPi();
    await createGsdExtension().factory(pi);
    assertBlocks(pi, "Bash", { command: 'python -c "print(1)"' }, /python -c/);
  });

  test("blocks git push in agent sessions", async () => {
    const pi = createMockPi();
    await createGsdExtension().factory(pi);
    assertBlocks(pi, "Bash", { command: "git push origin main" }, /push/);
  });

  test("blocks research forks", async () => {
    const pi = createMockPi();
    await createGsdExtension().factory(pi);
    assertBlocks(pi, "Agent", { prompt: "Research which framework is best", subagent_type: "fork" }, /multi-model/);
  });

  test("respects enableBlockRules: false", async () => {
    const pi = createMockPi();
    await createGsdExtension({ enableBlockRules: false }).factory(pi);
    assertAllows(pi, "SendFeedback", {});
  });

  test("accepts a custom rule subset", async () => {
    const pi = createMockPi();
    await createGsdExtension({ blockRules: [blockSendFeedback] }).factory(pi);
    assertBlocks(pi, "SendFeedback", {}, /disabled/);
    assertAllows(pi, "Bash", { command: 'python -c "x"' });
  });
});

describe("timing instrumentation", () => {
  test("calls onTiming for every tool_call evaluation", async () => {
    const timings = [];
    const pi = createMockPi();
    await createGsdExtension({ onTiming: (t) => timings.push(t) }).factory(pi);

    pi.emit("tool_call", { toolName: "Read", input: { file_path: "/tmp/x" } });
    pi.emit("tool_call", { toolName: "SendFeedback", input: {} });

    assert.equal(timings.length, 2);
    assert.equal(timings[0].blocked, false);
    assert.equal(timings[0].event, "tool_call");
    assert.ok(timings[0].durationMs >= 0);
    assert.ok(timings[0].timestamp > 0);
    assert.equal(timings[1].blocked, true);
  });

  test("timing durationMs is a positive number", async () => {
    const timings = [];
    const pi = createMockPi();
    await createGsdExtension({ onTiming: (t) => timings.push(t) }).factory(pi);
    pi.emit("tool_call", { toolName: "Bash", input: { command: "echo hi" } });
    assert.equal(typeof timings[0].durationMs, "number");
    assert.ok(timings[0].durationMs >= 0);
  });
});

describe("fail-fast behavior", () => {
  test("block rules throw on invalid rule (not swallowed)", () => {
    const badRule = { name: "bad", test() { throw new Error("rule exploded"); } };
    const pi = createMockPi();
    createGsdExtension({ blockRules: [badRule] }).factory(pi);
    assert.throws(
      () => pi.emit("tool_call", { toolName: "Bash", input: { command: "echo" } }),
      /rule exploded/,
    );
  });
});
