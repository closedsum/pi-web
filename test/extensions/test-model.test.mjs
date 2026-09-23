import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TEST_CONFIG } from "./_config.mjs";
import { E2E_CONFIG } from "./_e2e-harness.mjs";
import { GPT } from "./_models.mjs";

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const TEST_MODEL = readJson("../test-model.json");
const DISPLAY = readJson("../../lib/model-display.json");
const overridden = () => Boolean(process.env.PI_TEST_PROVIDER || process.env.PI_TEST_MODEL || process.env.PI_TEST_EFFORT);

test("test-model.json defines provider, model, and effort", () => {
  for (const key of ["provider", "model", "effort"]) {
    assert.equal(typeof TEST_MODEL[key], "string", `${key} must be a string`);
    assert.ok(TEST_MODEL[key].length > 0, `${key} must be non-empty`);
  }
});

test("test-model.json model is a known display model", () => {
  assert.ok(Object.values(DISPLAY.displayNames).includes(TEST_MODEL.model),
    `${TEST_MODEL.model} must be a displayNames value in lib/model-display.json`);
});

test("test-model.json effort is a known effort level", () => {
  assert.ok(Object.hasOwn(DISPLAY.effortColors, TEST_MODEL.effort),
    `${TEST_MODEL.effort} must be an effortColors key in lib/model-display.json`);
});

test("TEST_CONFIG and E2E_CONFIG come from test-model.json", (t) => {
  if (overridden()) return t.skip("PI_TEST_* override set");
  for (const cfg of [TEST_CONFIG, E2E_CONFIG]) {
    assert.equal(cfg.provider, TEST_MODEL.provider);
    assert.equal(cfg.model, TEST_MODEL.model);
    assert.equal(cfg.effort, TEST_MODEL.effort);
  }
});

test("GPT tier IDs come from model-display.json", () => {
  for (const tier of ["sol", "terra", "luna", "astra"]) {
    assert.equal(GPT[tier], DISPLAY.displayNames[tier], `GPT.${tier}`);
  }
});
