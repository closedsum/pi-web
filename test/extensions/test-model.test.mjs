import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { TEST_CONFIG, TEST_MODEL_FILE, resolveTestModel, validateTestModel } from "./_config.mjs";
import { E2E_CONFIG } from "./_e2e-harness.mjs";

const { THINKING_LEVELS } = await createJiti(import.meta.url).import("../../lib/thinking-levels.ts");
const FILE = { provider: "p-file", model: "m-file", effort: "high" };

test("test-model.json defines provider, model, and effort", () => {
  assert.equal(validateTestModel(TEST_MODEL_FILE), TEST_MODEL_FILE);
});

test("validateTestModel rejects whitespace so typos surface here, not as e2e flakes", () => {
  assert.throws(() => validateTestModel({ provider: "p", model: "gpt-6-sol ", effort: "high" }), /invalid: model$/);
});

test("resolveTestModel validates overridden values too", () => {
  assert.throws(() => resolveTestModel({ PI_TEST_MODEL: "has space" }, FILE), /after PI_TEST_\* overrides.*model$/);
});

test("test-model.json effort is a runtime thinking level", () => {
  assert.ok(THINKING_LEVELS.has(TEST_MODEL_FILE.effort),
    `${TEST_MODEL_FILE.effort} must be one of ${[...THINKING_LEVELS].join(", ")}`);
});

test("resolveTestModel uses the file when no override is set", () => {
  assert.deepEqual(resolveTestModel({}, FILE), { provider: "p-file", model: "m-file", effort: "high" });
});

test("resolveTestModel applies each PI_TEST_* override independently", () => {
  assert.deepEqual(resolveTestModel({ PI_TEST_MODEL: "m-env" }, FILE),
    { provider: "p-file", model: "m-env", effort: "high" });
  assert.deepEqual(resolveTestModel({ PI_TEST_PROVIDER: "p-env", PI_TEST_EFFORT: "low" }, FILE),
    { provider: "p-env", model: "m-file", effort: "low" });
});

test("validateTestModel rejects non-object roots and bad fields, naming the keys", () => {
  for (const root of [null, [], "x", 3]) {
    assert.throws(() => validateTestModel(root), /must be a JSON object/);
  }
  assert.throws(() => validateTestModel({ provider: "p", model: "m" }), /invalid: effort$/);
  assert.throws(() => validateTestModel({ provider: "", model: 5, effort: "high" }), /invalid: provider, model$/);
  assert.throws(() => resolveTestModel({}, { provider: "p" }), /invalid: model, effort$/);
});

test("resolveTestModel ignores empty overrides", () => {
  assert.deepEqual(resolveTestModel({ PI_TEST_MODEL: "", PI_TEST_EFFORT: "" }, FILE),
    { provider: "p-file", model: "m-file", effort: "high" });
});

test("TEST_CONFIG is test-model.json resolved with this run's env; E2E_CONFIG carries it", () => {
  assert.deepEqual({ ...TEST_CONFIG }, resolveTestModel(process.env, TEST_MODEL_FILE));
  const { provider, model, effort } = E2E_CONFIG;
  assert.deepEqual({ provider, model, effort }, { ...TEST_CONFIG });
});
