import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createSessionState,
  sessionTracker,
  processCleanup,
  sessionMetrics,
  ALL_SESSION_RULES,
  fireSessionStart,
  fireSessionEnd,
  trackToolCall,
} = await jiti.import("./session-lifecycle.ts");

describe("createSessionState", () => {
  test("initializes with zero values", () => {
    const state = createSessionState();
    assert.equal(state.startTime, 0);
    assert.equal(state.sessionId, undefined);
    assert.equal(state.forkCount, 0);
    assert.equal(state.dispatchCount, 0);
  });

  test("creates independent instances", () => {
    const a = createSessionState();
    const b = createSessionState();
    a.forkCount = 5;
    assert.equal(b.forkCount, 0);
  });
});

describe("sessionTracker", () => {
  test("records start time and session ID", () => {
    const state = createSessionState();
    sessionTracker.onStart({ sessionId: "sess-1", cwd: "/tmp" }, state);
    assert.ok(state.startTime > 0);
    assert.equal(state.sessionId, "sess-1");
  });

  test("resets counts on start", () => {
    const state = createSessionState();
    state.forkCount = 3;
    state.dispatchCount = 2;
    sessionTracker.onStart({ sessionId: "sess-2" }, state);
    assert.equal(state.forkCount, 0);
    assert.equal(state.dispatchCount, 0);
  });
});

describe("trackToolCall", () => {
  test("increments forkCount for Agent tool", () => {
    const state = createSessionState();
    trackToolCall("Agent", state);
    trackToolCall("Agent", state);
    assert.equal(state.forkCount, 2);
  });

  test("increments dispatchCount for DispatchLane", () => {
    const state = createSessionState();
    trackToolCall("DispatchLane", state);
    assert.equal(state.dispatchCount, 1);
  });

  test("increments dispatchCount for ue_dispatch", () => {
    const state = createSessionState();
    trackToolCall("ue_dispatch", state);
    assert.equal(state.dispatchCount, 1);
  });

  test("ignores non-tracked tools", () => {
    const state = createSessionState();
    trackToolCall("Read", state);
    trackToolCall("Bash", state);
    assert.equal(state.forkCount, 0);
    assert.equal(state.dispatchCount, 0);
  });
});

describe("processCleanup", () => {
  test("returns cleanup message when forks/dispatches exist", () => {
    const state = createSessionState();
    state.forkCount = 2;
    state.dispatchCount = 1;
    const msg = processCleanup.onEnd({}, state);
    assert.ok(msg);
    assert.match(msg, /2 forks/);
    assert.match(msg, /1 dispatches/);
  });

  test("returns undefined when no forks/dispatches", () => {
    const state = createSessionState();
    assert.equal(processCleanup.onEnd({}, state), undefined);
  });
});

describe("sessionMetrics", () => {
  test("reports duration and activity", () => {
    const state = createSessionState();
    state.startTime = Date.now() - 120_000;
    state.forkCount = 3;
    state.dispatchCount = 1;
    const msg = sessionMetrics.onEnd({}, state);
    assert.ok(msg);
    assert.match(msg, /duration: 2\.0m/);
    assert.match(msg, /forks: 3/);
    assert.match(msg, /dispatches: 1/);
  });

  test("returns undefined when no start time recorded", () => {
    const state = createSessionState();
    assert.equal(sessionMetrics.onEnd({}, state), undefined);
  });
});

describe("fireSessionStart / fireSessionEnd", () => {
  test("fireSessionStart calls all rules", () => {
    const state = createSessionState();
    fireSessionStart({ sessionId: "s1", cwd: "/tmp" }, state);
    assert.ok(state.startTime > 0);
    assert.equal(state.sessionId, "s1");
  });

  test("fireSessionEnd collects messages from all rules", () => {
    const state = createSessionState();
    state.startTime = Date.now() - 60_000;
    state.forkCount = 1;
    state.dispatchCount = 1;
    const msgs = fireSessionEnd({}, state);
    assert.equal(msgs.length, 2);
    assert.ok(msgs.some((m) => m.includes("verify owned processes")));
    assert.ok(msgs.some((m) => m.includes("duration")));
  });

  test("fireSessionEnd returns empty when nothing to report", () => {
    const state = createSessionState();
    const msgs = fireSessionEnd({}, state);
    assert.equal(msgs.length, 0);
  });

  test("accepts custom rule subset", () => {
    const state = createSessionState();
    fireSessionStart({}, state, [sessionTracker]);
    assert.ok(state.startTime > 0);
  });
});

describe("rule purity", () => {
  test("all rules have unique names", () => {
    const names = ALL_SESSION_RULES.map((r) => r.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("rules do not share state across separate SessionState objects", () => {
    const a = createSessionState();
    const b = createSessionState();
    fireSessionStart({ sessionId: "a" }, a);
    fireSessionStart({ sessionId: "b" }, b);
    trackToolCall("Agent", a);
    assert.equal(a.forkCount, 1);
    assert.equal(b.forkCount, 0);
  });
});
