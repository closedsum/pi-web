import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TelemetryCollector,
  instrumentRules,
  evaluateBlockRulesInstrumented,
} = await jiti.import("./telemetry-collector.ts");
const { evaluateBlockRules } = await jiti.import("./tool-blockers.ts");

function makeRule(name, fn) {
  return { name, test: fn };
}

describe("TelemetryCollector", () => {
  test("records invocations, blocks, and allows per rule", () => {
    const c = new TelemetryCollector("sess-1");
    c.record("rule-a", 1.5, false);
    c.record("rule-a", 2.0, true);
    c.record("rule-a", 0.5, false);
    c.record("rule-b", 3.0, false);

    const snap = c.snapshot();
    assert.equal(snap.rules["rule-a"].invocations, 3);
    assert.equal(snap.rules["rule-a"].blocks, 1);
    assert.equal(snap.rules["rule-a"].allows, 2);
    assert.equal(snap.rules["rule-b"].invocations, 1);
    assert.equal(snap.rules["rule-b"].allows, 1);
  });

  test("tracks maxMs correctly", () => {
    const c = new TelemetryCollector("sess-2");
    c.record("r", 1.0, false);
    c.record("r", 5.0, false);
    c.record("r", 2.0, false);
    assert.equal(c.snapshot().rules["r"].maxMs, 5.0);
  });

  test("totalEvaluations equals sum of all invocations", () => {
    const c = new TelemetryCollector("sess-3");
    c.record("a", 1, false);
    c.record("a", 1, true);
    c.record("b", 1, false);
    const snap = c.snapshot();
    assert.equal(snap.totalEvaluations, 3);
    assert.equal(snap.totalBlocks, 1);
    assert.equal(snap.totalAllows, 2);
  });

  test("snapshot returns frozen object", () => {
    const c = new TelemetryCollector("sess-4");
    c.record("x", 1, false);
    const snap = c.snapshot();
    assert.ok(Object.isFrozen(snap));
    assert.equal(snap.sessionId, "sess-4");
    assert.ok(snap.capturedAt);
  });

  test("multiple snapshots are independent", () => {
    const c = new TelemetryCollector("sess-5");
    c.record("x", 1, false);
    const snap1 = c.snapshot();
    c.record("x", 2, true);
    const snap2 = c.snapshot();
    assert.equal(snap1.rules["x"].invocations, 1);
    assert.equal(snap2.rules["x"].invocations, 2);
  });
});

describe("instrumentRules", () => {
  test("short-circuited rules are not recorded (TEL-02)", () => {
    const c = new TelemetryCollector("sess-6");
    const rules = [
      makeRule("pass-through", () => undefined),
      makeRule("blocker", () => ({ block: true, reason: "blocked" })),
      makeRule("never-reached", () => undefined),
    ];
    const wrapped = instrumentRules(rules, c);
    evaluateBlockRules("Write", {}, wrapped);

    const snap = c.snapshot();
    assert.equal(snap.rules["pass-through"].invocations, 1);
    assert.equal(snap.rules["pass-through"].allows, 1);
    assert.equal(snap.rules["blocker"].invocations, 1);
    assert.equal(snap.rules["blocker"].blocks, 1);
    assert.equal(snap.rules["never-reached"], undefined);
  });

  test("instrumented results match uninstrumented", () => {
    const c = new TelemetryCollector("sess-7");
    const rules = [
      makeRule("allow", () => undefined),
      makeRule("block", () => ({ block: true, reason: "test" })),
    ];
    const wrapped = instrumentRules(rules, c);
    const instrumented = evaluateBlockRules("Bash", {}, wrapped);
    const direct = evaluateBlockRules("Bash", {}, rules);
    assert.deepEqual(instrumented, direct);
  });
});

describe("evaluateBlockRulesInstrumented", () => {
  test("falls back to uninstrumented on collector error (TEL-04)", () => {
    const badCollector = new TelemetryCollector("sess-8");
    badCollector.record = () => { throw new Error("telemetry boom"); };

    const rules = [
      makeRule("block-it", () => ({ block: true, reason: "must-block" })),
    ];
    const result = evaluateBlockRulesInstrumented("Write", {}, rules, undefined, badCollector);
    assert.equal(result?.block, true);
    assert.equal(result?.reason, "must-block");
  });

  test("works normally when collector is healthy", () => {
    const c = new TelemetryCollector("sess-9");
    const rules = [
      makeRule("allow-all", () => undefined),
    ];
    const result = evaluateBlockRulesInstrumented("Read", {}, rules, undefined, c);
    assert.equal(result, undefined);
    assert.equal(c.snapshot().rules["allow-all"].invocations, 1);
  });
});

describe("TEL-05 redaction", () => {
  test("snapshot contains only names, counts, timing — no tool data", () => {
    const c = new TelemetryCollector("sess-10");
    c.record("my-rule", 2.5, true);
    const json = JSON.stringify(c.snapshot());
    assert.ok(!json.includes("toolName"));
    assert.ok(!json.includes("input"));
    assert.ok(!json.includes("/Users/"));
    assert.ok(!json.includes("C:\\"));
  });
});
