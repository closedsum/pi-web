import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TEST_CONFIG, TEST_MODEL_FILE, resolveTestModel } from "./_config.mjs";
import { E2E_CONFIG } from "./_e2e-harness.mjs";

const DISPLAY = JSON.parse(readFileSync(new URL("../../lib/model-display.json", import.meta.url), "utf8"));
const FILE = { provider: "p-file", model: "m-file", effort: "high" };

test("test-model.json defines provider, model, and effort", () => {
  for (const key of ["provider", "model", "effort"]) {
    assert.equal(typeof TEST_MODEL_FILE[key], "string", `${key} must be a string`);
    assert.ok(TEST_MODEL_FILE[key].length > 0, `${key} must be non-empty`);
  }
});

test("test-model.json effort is a known thinking level", () => {
  assert.ok(Object.hasOwn(DISPLAY.effortColors, TEST_MODEL_FILE.effort),
    `${TEST_MODEL_FILE.effort} must be one of ${Object.keys(DISPLAY.effortColors).join(", ")}`);
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

test("resolveTestModel ignores empty overrides", () => {
  assert.deepEqual(resolveTestModel({ PI_TEST_MODEL: "", PI_TEST_EFFORT: "" }, FILE),
    { provider: "p-file", model: "m-file", effort: "high" });
});

test("TEST_CONFIG and E2E_CONFIG resolve from test-model.json plus this run's env", () => {
  const expected = resolveTestModel(process.env, TEST_MODEL_FILE);
  for (const cfg of [TEST_CONFIG, E2E_CONFIG]) {
    assert.equal(cfg.provider, expected.provider);
    assert.equal(cfg.model, expected.model);
    assert.equal(cfg.effort, expected.effort);
  }
});
