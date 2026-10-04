import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ALL_INPUT_RULES,
  evaluateInputRules,
  taskRouting,
  gapEnforcement,
  sessionReminder,
} = await jiti.import("./input-handlers.ts");

describe("taskRouting", () => {
  test("routes bug keywords to bug-fix", () => {
    const r = taskRouting.test({ text: "the login page crashes when I submit" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /TASK-ROUTING.*[Bb]ug/);
  });

  test("routes regression to bug-fix", () => {
    const r = taskRouting.test({ text: "there is a regression in the API response format" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /[Bb]ug/);
  });

  test("routes trivial keywords to fast", () => {
    const r = taskRouting.test({ text: "fix this typo in the README file" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /[Tt]rivial/);
  });

  test("routes rename to fast", () => {
    const r = taskRouting.test({ text: "rename the variable to camelCase please" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /[Tt]rivial/);
  });

  test("skips slash commands", () => {
    assert.equal(taskRouting.test({ text: "/gsd:progress" }), undefined);
  });

  test("skips short prompts", () => {
    assert.equal(taskRouting.test({ text: "continue" }), undefined);
    assert.equal(taskRouting.test({ text: "yes do it" }), undefined);
  });

  test("skips questions", () => {
    assert.equal(taskRouting.test({ text: "what does this function do?" }), undefined);
    assert.equal(taskRouting.test({ text: "how should we approach this problem?" }), undefined);
  });

  test("skips extension-injected input", () => {
    assert.equal(taskRouting.test({ text: "the login crashes", source: "extension" }), undefined);
  });

  test("returns undefined for ambiguous prompts", () => {
    assert.equal(taskRouting.test({ text: "implement a new authentication system with OAuth" }), undefined);
  });
});

describe("gapEnforcement", () => {
  test("appends context when prompt mentions a gap", () => {
    const r = gapEnforcement.test({ text: "there's a gap in our test coverage for the dispatch module" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /GAP-ENFORCEMENT/);
  });

  test("appends context for missing features", () => {
    const r = gapEnforcement.test({ text: "this feature is not implemented yet and we need it" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /GAP-ENFORCEMENT/);
  });

  test("returns undefined for unrelated prompts", () => {
    assert.equal(gapEnforcement.test({ text: "add a new button to the settings panel please" }), undefined);
  });

  test("skips extension-injected input", () => {
    assert.equal(gapEnforcement.test({ text: "there's a gap", source: "extension" }), undefined);
  });
});

describe("sessionReminder", () => {
  test("appends session context for substantive prompts", () => {
    const r = sessionReminder.test({ text: "implement the new model selector with provider grouping" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /SESSION-REMINDER/);
    assert.match(r.text, /[Ss]uperpowers/);
  });

  test("skips short prompts", () => {
    assert.equal(sessionReminder.test({ text: "ok" }), undefined);
  });

  test("skips slash commands", () => {
    assert.equal(sessionReminder.test({ text: "/gsd:help" }), undefined);
  });

  test("skips questions", () => {
    assert.equal(sessionReminder.test({ text: "what does this function do in the codebase?" }), undefined);
  });

  test("skips extension-injected input", () => {
    assert.equal(sessionReminder.test({ text: "implement the feature", source: "extension" }), undefined);
  });
});

describe("evaluateInputRules", () => {
  test("returns first matching action", () => {
    const r = evaluateInputRules({ text: "the build fails on Windows with a regression" });
    assert.equal(r?.action, "transform");
    assert.match(r.text, /TASK-ROUTING/);
  });

  test("returns undefined when no rule matches", () => {
    assert.equal(evaluateInputRules({ text: "ok" }), undefined);
  });

  test("accepts a custom rule subset", () => {
    const r = evaluateInputRules({ text: "the build fails" }, [gapEnforcement]);
    assert.equal(r, undefined);
  });

  test("all rules have unique names", () => {
    const names = ALL_INPUT_RULES.map((r) => r.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("all rules are pure (no shared state)", () => {
    for (const rule of ALL_INPUT_RULES) {
      rule.test({ text: "test prompt with enough content" });
      rule.test({ text: "test prompt with enough content" });
    }
  });
});
