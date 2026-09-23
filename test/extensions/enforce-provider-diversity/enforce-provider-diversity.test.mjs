import assert from "node:assert/strict";
import test from "node:test";
import { GPT } from "../_models.mjs";

const DEFAULT_PROVIDERS = ["codex", "claude", "qwen-cli"];

const TASK_PROVIDER_ORDER = {
  review: ["codex", "qwen-cli", "claude"],
  research: ["claude", "qwen-cli", "codex"],
  planning: ["codex", "claude", "qwen-cli"],
  narrow: ["qwen-cli", "codex", "claude"],
  generic: ["codex", "claude", "qwen-cli"],
};

function canonicalProvider(value) {
  const aliases = { qwen: "qwen-cli", "qwen-cli": "qwen-cli", codex: "codex", claude: "claude" };
  return typeof value === "string" ? aliases[value.trim().toLowerCase()] || null : null;
}

function taskFamily(task) {
  const type = String(task?.task_type || task?.type || task?.metadata?.task_type || "").toLowerCase();
  if (/review/.test(type)) return "review";
  if (/research/.test(type)) return "research";
  if (/plan/.test(type)) return "planning";
  if (/narrow|small|simple/.test(type)) return "narrow";
  return "generic";
}

function providerProfile(provider, family) {
  if (provider === "codex") {
    if (family === "review") return { model: GPT.sol, effort: "xhigh" };
    if (family === "planning") return { model: GPT.astra, effort: "xhigh" };
    if (family === "narrow") return { model: GPT.luna, effort: "medium" };
    return { model: GPT.terra, effort: "high" };
  }
  if (provider === "claude") {
    if (family === "research") return { model: "claude-opus-5[1m]", effort: "max" };
    return { model: "claude-sonnet-5[1m]", effort: "high" };
  }
  if (family === "review" || family === "research") return { model: "qwen3.8-max", effort: "high" };
  return { model: "qwen3.8-flash", effort: "medium" };
}

function assignProviders(manifest) {
  if (!manifest || typeof manifest !== "object") return { error: "manifest must be an object" };
  if (!Array.isArray(manifest.wave)) return { error: "wave must be an array" };

  const available = manifest.availableProviders || [...DEFAULT_PROVIDERS];
  const counts = Object.fromEntries(available.map((p) => [p, 0]));
  const assigned = [];
  const unlocked = [];

  for (let i = 0; i < manifest.wave.length; i++) {
    const task = manifest.wave[i];
    const explicit = task.provider || task.metadata?.provider;
    if (explicit) {
      const canonical = canonicalProvider(explicit);
      if (!canonical) return { error: `unknown provider: ${explicit}` };
      counts[canonical] = (counts[canonical] || 0) + 1;
      assigned[i] = { ...task, provider: canonical };
    } else {
      unlocked.push(i);
    }
  }

  for (const i of unlocked) {
    const task = manifest.wave[i];
    const family = taskFamily(task);
    const order = TASK_PROVIDER_ORDER[family] || TASK_PROVIDER_ORDER.generic;
    const candidates = order.filter((p) => available.includes(p));
    candidates.sort((a, b) => (counts[a] || 0) - (counts[b] || 0));
    const provider = candidates[0];
    counts[provider] = (counts[provider] || 0) + 1;
    const profile = providerProfile(provider, family);
    assigned[i] = { ...task, provider, model: task.model || profile.model, effort: task.effort || profile.effort };
  }

  return { manifest: { ...manifest, wave: assigned }, distribution: counts };
}

test("assigns providers evenly across wave", () => {
  const result = assignProviders({
    wave: [{ subject: "t1" }, { subject: "t2" }, { subject: "t3" }],
  });
  assert.ok(!result.error);
  const providers = result.manifest.wave.map((t) => t.provider);
  const unique = new Set(providers);
  assert.equal(unique.size, 3);
});

test("respects explicit provider locks", () => {
  const result = assignProviders({
    wave: [
      { subject: "t1", provider: "claude" },
      { subject: "t2" },
    ],
  });
  assert.equal(result.manifest.wave[0].provider, "claude");
});

test("errors on unknown provider", () => {
  const result = assignProviders({
    wave: [{ subject: "t1", provider: "unknown-ai" }],
  });
  assert.ok(result.error);
  assert.match(result.error, /unknown provider/);
});

test("errors on non-array wave", () => {
  const result = assignProviders({ wave: "not-array" });
  assert.ok(result.error);
});

test("errors on non-object manifest", () => {
  const result = assignProviders(null);
  assert.ok(result.error);
});

test("review tasks prefer codex first", () => {
  const result = assignProviders({
    wave: [{ subject: "review", task_type: "review" }],
  });
  assert.equal(result.manifest.wave[0].provider, "codex");
});

test("research tasks prefer claude first", () => {
  const result = assignProviders({
    wave: [{ subject: "research", task_type: "research" }],
  });
  assert.equal(result.manifest.wave[0].provider, "claude");
});

test("narrow tasks prefer qwen-cli first", () => {
  const result = assignProviders({
    wave: [{ subject: "narrow", task_type: "narrow" }],
  });
  assert.equal(result.manifest.wave[0].provider, "qwen-cli");
});

test("assigns model and effort from provider profile", () => {
  const result = assignProviders({
    wave: [{ subject: "t1", task_type: "review" }],
  });
  const task = result.manifest.wave[0];
  assert.equal(task.model, GPT.sol);
  assert.equal(task.effort, "xhigh");
});

test("explicit model on task is preserved", () => {
  const result = assignProviders({
    wave: [{ subject: "t1", model: "custom-model" }],
  });
  assert.equal(result.manifest.wave[0].model, "custom-model");
});

test("canonicalProvider normalizes aliases", () => {
  assert.equal(canonicalProvider("qwen"), "qwen-cli");
  assert.equal(canonicalProvider("Codex"), "codex");
  assert.equal(canonicalProvider("Claude"), "claude");
  assert.equal(canonicalProvider("unknown"), null);
  assert.equal(canonicalProvider(42), null);
});

test("distribution counts are correct", () => {
  const result = assignProviders({
    wave: [{ subject: "t1" }, { subject: "t2" }, { subject: "t3" }],
  });
  const total = Object.values(result.distribution).reduce((a, b) => a + b, 0);
  assert.equal(total, 3);
});

test("large wave balances across providers", () => {
  const wave = Array.from({ length: 6 }, (_, i) => ({ subject: `t${i}` }));
  const result = assignProviders({ wave });
  const counts = Object.values(result.distribution);
  assert.ok(counts.every((c) => c === 2));
});
