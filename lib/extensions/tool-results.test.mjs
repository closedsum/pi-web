import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ALL_RESULT_RULES,
  evaluateResultRules,
  createResultState,
  buildVerifyReminder,
  reviewReminder,
  commitTracker,
} = await jiti.import("./tool-results.ts");

describe("buildVerifyReminder", () => {
  test("sets lastCommitTime and returns context on git commit", () => {
    const state = createResultState();
    const result = buildVerifyReminder.test(
      { toolName: "Bash", input: { command: 'git commit -m "fix"' }, exitCode: 0 },
      state,
    );
    assert.ok(result?.context);
    assert.match(result.context, /BUILD-VERIFY/);
    assert.ok(state.lastCommitTime > 0);
    assert.equal(state.commitCount, 1);
  });

  test("clears build-pending on npm test", () => {
    const state = createResultState();
    state.lastCommitTime = Date.now() - 1000;
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: "npm test" }, exitCode: 0 },
      state,
    );
    assert.ok(state.lastBuildTime >= state.lastCommitTime);
  });

  test("clears build-pending on ue_action build", () => {
    const state = createResultState();
    state.lastCommitTime = Date.now() - 1000;
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: "python ue_action.py build" }, exitCode: 0 },
      state,
    );
    assert.ok(state.lastBuildTime >= state.lastCommitTime);
  });

  test("clears build-pending on npm run build", () => {
    const state = createResultState();
    state.lastCommitTime = Date.now() - 1000;
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: "npm run build" }, exitCode: 0 },
      state,
    );
    assert.ok(state.lastBuildTime >= state.lastCommitTime);
  });

  test("does not set on failed commit (exitCode 1)", () => {
    const state = createResultState();
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: 'git commit -m "fix"' }, exitCode: 1 },
      state,
    );
    assert.equal(state.lastCommitTime, 0);
  });

  test("does not set on git commit --amend", () => {
    const state = createResultState();
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: "git commit --amend" }, exitCode: 0 },
      state,
    );
    assert.equal(state.lastCommitTime, 0);
  });

  test("warns when no build since last commit", () => {
    const state = createResultState();
    state.lastCommitTime = Date.now() - 60000;
    state.lastBuildTime = state.lastCommitTime - 1;
    const result = buildVerifyReminder.test(
      { toolName: "Read", input: { file_path: "/tmp/x" } },
      state,
    );
    assert.ok(result?.warn);
    assert.match(result.warn, /BUILD-VERIFY/);
  });

  test("does not warn when build is after commit", () => {
    const state = createResultState();
    state.lastCommitTime = Date.now() - 60000;
    state.lastBuildTime = state.lastCommitTime + 1;
    const result = buildVerifyReminder.test(
      { toolName: "Read", input: { file_path: "/tmp/x" } },
      state,
    );
    assert.equal(result, undefined);
  });
});

describe("reviewReminder", () => {
  test("injects review reminder when uncommitted lines exceed 200", () => {
    const state = createResultState();
    const result = reviewReminder.test(
      { toolName: "Bash", output: "[main abc1234] fix: thing\n445 uncommitted lines" },
      state,
    );
    assert.ok(result?.context);
    assert.match(result.context, /cross-review/);
    assert.equal(state.linesSinceReview, 445);
  });

  test("does not inject for small commits", () => {
    const state = createResultState();
    const result = reviewReminder.test(
      { toolName: "Bash", output: "[main def5678] docs: readme\n50 uncommitted lines" },
      state,
    );
    assert.equal(result, undefined);
    assert.equal(state.linesSinceReview, 50);
  });

  test("does not trigger for non-commit output", () => {
    const state = createResultState();
    const result = reviewReminder.test(
      { toolName: "Bash", output: "On branch main\nnothing to commit" },
      state,
    );
    assert.equal(result, undefined);
  });

  test("ignores non-shell tools", () => {
    const state = createResultState();
    const result = reviewReminder.test(
      { toolName: "Read", output: "[main abc1234] fix\n999 uncommitted lines" },
      state,
    );
    assert.equal(result, undefined);
  });
});

describe("commitTracker", () => {
  test("increments commitCount on git commit", () => {
    const state = createResultState();
    commitTracker.test(
      { toolName: "Bash", input: { command: 'git commit -m "one"' }, exitCode: 0 },
      state,
    );
    commitTracker.test(
      { toolName: "Bash", input: { command: 'git commit -m "two"' }, exitCode: 0 },
      state,
    );
    assert.equal(state.commitCount, 2);
  });

  test("does not count failed commits", () => {
    const state = createResultState();
    commitTracker.test(
      { toolName: "Bash", input: { command: 'git commit -m "fail"' }, exitCode: 1 },
      state,
    );
    assert.equal(state.commitCount, 0);
  });
});

describe("evaluateResultRules", () => {
  test("returns first matching action", () => {
    const state = createResultState();
    const result = evaluateResultRules(
      { toolName: "Bash", input: { command: 'git commit -m "x"' }, exitCode: 0 },
      state,
    );
    assert.ok(result?.context);
    assert.match(result.context, /BUILD-VERIFY/);
  });

  test("returns undefined when no rule matches", () => {
    const state = createResultState();
    const result = evaluateResultRules(
      { toolName: "Read", input: { file_path: "/tmp/x" } },
      state,
    );
    assert.equal(result, undefined);
  });

  test("accepts custom rule subset", () => {
    const state = createResultState();
    const result = evaluateResultRules(
      { toolName: "Bash", input: { command: 'git commit -m "x"' }, exitCode: 0 },
      state,
      [reviewReminder],
    );
    assert.equal(result, undefined);
  });

  test("all rules have unique names", () => {
    const names = ALL_RESULT_RULES.map((r) => r.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("state is isolated between separate instances", () => {
    const s1 = createResultState();
    const s2 = createResultState();
    buildVerifyReminder.test(
      { toolName: "Bash", input: { command: 'git commit -m "x"' }, exitCode: 0 },
      s1,
    );
    assert.ok(s1.lastCommitTime > 0);
    assert.equal(s2.lastCommitTime, 0);
  });
});
