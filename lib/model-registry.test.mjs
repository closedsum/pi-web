import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-registry.ts");
  } catch {
    return import("./model-registry.ts");
  }
}

const {
  MODEL_FAMILY_COLORS,
  MODEL_DISPLAY_MAP,
  TAG_COLORS,
  getModelFamily,
  getModelFamilyColor,
  resolveModelDisplayName,
} = await loadSubject();

test("MODEL_FAMILY_COLORS has entries for all expected families", () => {
  for (const family of ["anthropic", "openai", "qwen", "meta"]) {
    assert.ok(MODEL_FAMILY_COLORS[family], `missing color for family: ${family}`);
  }
});

test("MODEL_FAMILY_COLORS values are all distinct", () => {
  const colors = Object.values(MODEL_FAMILY_COLORS);
  const unique = new Set(colors);
  assert.equal(unique.size, colors.length, `duplicate colors found: ${colors}`);
});

test("getModelFamily maps short model names to correct families", () => {
  const cases = [
    ["opus5", "anthropic"],
    ["sonnet5", "anthropic"],
    ["haiku", "anthropic"],
    ["fable", "anthropic"],
    ["claude-3.5-sonnet", "anthropic"],
    ["gpt-6-sol", "openai"],
    ["sol", "openai"],
    ["terra", "openai"],
    ["luna", "openai"],
    ["astra", "openai"],
    ["gpt-6-astra", "openai"],
    ["gpt-6-luna", "openai"],
    ["gpt-5.6-terra", "openai"],
    ["qwen38", "qwen"],
    ["qwen3.8-max", "qwen"],
    ["qwen3.8-flash", "qwen"],
    ["muse", "meta"],
    ["muse-spark-1.3", "meta"],
  ];
  for (const [model, expected] of cases) {
    assert.equal(getModelFamily(model), expected, `${model} should be ${expected}`);
  }
});

test("getModelFamily returns undefined for unknown models", () => {
  assert.equal(getModelFamily("unknown-model"), undefined);
  assert.equal(getModelFamily("llama-3"), undefined);
});

test("getModelFamilyColor returns family color for known models", () => {
  assert.equal(getModelFamilyColor("opus5"), MODEL_FAMILY_COLORS.anthropic);
  assert.equal(getModelFamilyColor("sol"), MODEL_FAMILY_COLORS.openai);
  assert.equal(getModelFamilyColor("qwen38"), MODEL_FAMILY_COLORS.qwen);
  assert.equal(getModelFamilyColor("muse"), MODEL_FAMILY_COLORS.meta);
});

test("getModelFamilyColor returns fallback for unknown models", () => {
  const fallback = getModelFamilyColor("unknown-model");
  assert.equal(fallback, "#a78bfa");
  assert.ok(!Object.values(MODEL_FAMILY_COLORS).includes(fallback),
    "fallback should not collide with any family color");
});

test("MODEL_DISPLAY_MAP maps all expected short names", () => {
  const expectedMappings = {
    sol: "gpt-6-sol",
    terra: "gpt-5.6-terra",
    luna: "gpt-6-luna",
    astra: "gpt-6-astra",
    opus5: "opus-5",
    sonnet5: "sonnet-5",
    haiku: "haiku-4.5",
    fable: "fable-5.1",
    qwen38: "qwen-3.8",
    muse: "muse-spark-1.3",
  };
  for (const [short, full] of Object.entries(expectedMappings)) {
    assert.equal(MODEL_DISPLAY_MAP[short], full, `${short} -> ${full}`);
  }
});

test("resolveModelDisplayName maps short names to display names", () => {
  assert.equal(resolveModelDisplayName("sol"), "gpt-6-sol");
  assert.equal(resolveModelDisplayName("muse"), "muse-spark-1.3");
  assert.equal(resolveModelDisplayName("opus5"), "opus-5");
});

test("resolveModelDisplayName passes through already-full names", () => {
  assert.equal(resolveModelDisplayName("gpt-6-sol"), "gpt-6-sol");
  assert.equal(resolveModelDisplayName("muse-spark-1.3"), "muse-spark-1.3");
  assert.equal(resolveModelDisplayName("some-unknown"), "some-unknown");
});

test("TAG_COLORS has effort and tasktype entries", () => {
  assert.ok(TAG_COLORS.effort, "missing tag color for effort");
  assert.ok(TAG_COLORS.tasktype, "missing tag color for tasktype");
});

test("TAG_COLORS are distinct from each other and from family colors", () => {
  assert.notEqual(TAG_COLORS.effort, TAG_COLORS.tasktype,
    "effort and tasktype must be visually distinct");
  const familyColors = new Set(Object.values(MODEL_FAMILY_COLORS));
  assert.ok(!familyColors.has(TAG_COLORS.effort),
    "effort color should not collide with a family color");
  assert.ok(!familyColors.has(TAG_COLORS.tasktype),
    "tasktype color should not collide with a family color");
});

test("every family in config is reachable via at least one known model name", () => {
  const knownModels = ["opus5", "sonnet5", "haiku", "fable", "sol", "terra", "luna", "astra", "gpt-6-sol", "qwen38", "qwen3.8-max", "muse", "muse-spark-1.3", "MiniMax-M3"];
  for (const family of Object.keys(MODEL_FAMILY_COLORS)) {
    const matched = knownModels.some((m) => getModelFamily(m) === family);
    assert.ok(matched, `family "${family}" is not reachable via any known model prefix`);
  }
});
