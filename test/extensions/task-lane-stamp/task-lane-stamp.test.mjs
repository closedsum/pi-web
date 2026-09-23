import assert from "node:assert/strict";
import test from "node:test";

const MODEL_SHORT = {
  "claude-sonnet-5[1m]": "sonnet5",
  "claude-opus-5[1m]": "opus5",
  "claude-opus-4-6[1m]": "opus4.6",
  "gpt-6-sol": "sol",
  "gpt-5.6-terra": "terra",
  "gpt-6-luna": "luna",
  "gpt-6-astra": "astra",
  "qwen3.8-max": "qwen38",
  "qwen3.8-flash": "qwen38flash",
};

const OWNER_RE = /^lane:(?<slug>[A-Za-z0-9._-]+)(?: \(group [^)]+\))?$/;

function modelShort(model) {
  return MODEL_SHORT[model] || model;
}

function stripPrefix(subject) {
  return String(subject || "").replace(/^\[[^\]\n]*\]\s*/, "");
}

function extractSlug(toolInput) {
  const metadata = toolInput.metadata || {};
  if (typeof metadata.lane_slug === "string" && metadata.lane_slug) return metadata.lane_slug;
  const owner = toolInput.owner;
  if (typeof owner === "string") {
    const m = owner.match(OWNER_RE);
    if (m) return m.groups.slug;
  }
  return null;
}

function buildStampedSubject(manifest, slug, subject) {
  const missing = ["provider", "model", "effort"].filter((k) => !manifest[k]);
  if (missing.length) return { error: `missing: ${missing.join(", ")}` };
  const prefix = `[${manifest.provider} ${modelShort(manifest.model)} ${manifest.effort} · lane ${slug}] `;
  return { subject: prefix + stripPrefix(subject) };
}

function handleToolCall(event, manifestStore = {}) {
  if (event.tool !== "TaskCreate" && event.tool !== "TaskUpdate") return undefined;

  const input = event.input || {};
  const slug = extractSlug(input);
  if (!slug) return undefined;

  const manifest = manifestStore[slug];
  if (!manifest) {
    return { block: true, reason: `[TASK-LANE-STAMP] BLOCKED: lane manifest not found for ${slug}.` };
  }
  if (manifest.parseError) {
    return { block: true, reason: `[TASK-LANE-STAMP] BLOCKED: manifest is not valid JSON.` };
  }

  const stamp = buildStampedSubject(manifest, slug, input.subject);
  if (stamp.error) {
    return { block: true, reason: `[TASK-LANE-STAMP] BLOCKED: ${stamp.error}` };
  }

  return { allow: true, subject: stamp.subject };
}

test("stamps subject from lane manifest", () => {
  const event = {
    tool: "TaskCreate",
    input: { owner: "lane:fix-auth", subject: "Fix authentication" },
  };
  const manifests = { "fix-auth": { provider: "codex", model: "gpt-6-sol", effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.equal(result.subject, "[codex sol high · lane fix-auth] Fix authentication");
});

test("strips existing prefix before stamping", () => {
  const event = {
    tool: "TaskUpdate",
    input: { owner: "lane:my-lane", subject: "[old prefix] My task" },
  };
  const manifests = { "my-lane": { provider: "claude", model: "claude-opus-5[1m]", effort: "max" } };
  const result = handleToolCall(event, manifests);
  assert.equal(result.subject, "[claude opus5 max · lane my-lane] My task");
});

test("extracts slug from metadata.lane_slug", () => {
  const event = {
    tool: "TaskCreate",
    input: { metadata: { lane_slug: "decomp-v2" }, subject: "Decompose" },
  };
  const manifests = { "decomp-v2": { provider: "qwen-cli", model: "qwen3.8-max", effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.match(result.subject, /qwen-cli qwen38 high/);
});

test("extracts slug from owner with group suffix", () => {
  const slug = extractSlug({ owner: "lane:my-task (group batch-1)" });
  assert.equal(slug, "my-task");
});

test("returns null slug for non-lane owner", () => {
  assert.equal(extractSlug({ owner: "user:bedit" }), null);
  assert.equal(extractSlug({ owner: "" }), null);
  assert.equal(extractSlug({}), null);
});

test("blocks when manifest not found", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:missing", subject: "x" } };
  const result = handleToolCall(event, {});
  assert.ok(result.block);
  assert.match(result.reason, /not found/);
});

test("blocks when manifest missing required fields", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:bad", subject: "x" } };
  const manifests = { bad: { provider: "codex" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.block);
  assert.match(result.reason, /missing/);
});

test("blocks when manifest is invalid JSON", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:broken", subject: "x" } };
  const manifests = { broken: { parseError: true } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.block);
  assert.match(result.reason, /not valid JSON/);
});

test("ignores non-task tools", () => {
  assert.equal(handleToolCall({ tool: "Edit", input: { owner: "lane:x" } }, {}), undefined);
});

test("ignores tasks without lane owner", () => {
  const event = { tool: "TaskCreate", input: { subject: "no lane" } };
  assert.equal(handleToolCall(event, {}), undefined);
});

test("modelShort maps all known models", () => {
  assert.equal(modelShort("claude-sonnet-5[1m]"), "sonnet5");
  assert.equal(modelShort("gpt-6-astra"), "astra");
  assert.equal(modelShort("qwen3.8-flash"), "qwen38flash");
  assert.equal(modelShort("unknown-model"), "unknown-model");
});

test("works with TaskUpdate", () => {
  const event = {
    tool: "TaskUpdate",
    input: { owner: "lane:update-test", subject: "Update me" },
  };
  const manifests = { "update-test": { provider: "codex", model: "gpt-5.6-terra", effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.match(result.subject, /codex terra high/);
});

test("lane_slug takes priority over owner", () => {
  const slug = extractSlug({ owner: "lane:from-owner", metadata: { lane_slug: "from-metadata" } });
  assert.equal(slug, "from-metadata");
});
