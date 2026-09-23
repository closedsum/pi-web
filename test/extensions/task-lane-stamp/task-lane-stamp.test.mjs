import assert from "node:assert/strict";
import test from "node:test";
import { SKIP_WITHOUT_HOOKS, loadHook } from "../_hooks.mjs";

// The model-ID -> short-name table comes from the real hook so model swaps
// there need no edits here.
const hook = loadHook("task-lane-stamp.cjs", ["MODEL_SHORT"]);
const MODEL_SHORT = hook?.MODEL_SHORT ?? {};
const hookTest = (name, fn) => test(name, { skip: hook ? false : SKIP_WITHOUT_HOOKS }, fn);

function idFor(short) {
  const id = Object.keys(MODEL_SHORT).find((key) => MODEL_SHORT[key] === short);
  if (!id) throw new Error(`task-lane-stamp MODEL_SHORT has no model for '${short}'`);
  return id;
}

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

hookTest("stamps subject from lane manifest", () => {
  const event = {
    tool: "TaskCreate",
    input: { owner: "lane:fix-auth", subject: "Fix authentication" },
  };
  const manifests = { "fix-auth": { provider: "codex", model: idFor("sol"), effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.equal(result.subject, "[codex sol high · lane fix-auth] Fix authentication");
});

hookTest("strips existing prefix before stamping", () => {
  const event = {
    tool: "TaskUpdate",
    input: { owner: "lane:my-lane", subject: "[old prefix] My task" },
  };
  const manifests = { "my-lane": { provider: "claude", model: "claude-opus-5[1m]", effort: "max" } };
  const result = handleToolCall(event, manifests);
  assert.equal(result.subject, "[claude opus5 max · lane my-lane] My task");
});

hookTest("extracts slug from metadata.lane_slug", () => {
  const event = {
    tool: "TaskCreate",
    input: { metadata: { lane_slug: "decomp-v2" }, subject: "Decompose" },
  };
  const manifests = { "decomp-v2": { provider: "qwen-cli", model: "qwen3.8-max", effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.match(result.subject, /qwen-cli qwen38 high/);
});

hookTest("extracts slug from owner with group suffix", () => {
  const slug = extractSlug({ owner: "lane:my-task (group batch-1)" });
  assert.equal(slug, "my-task");
});

hookTest("returns null slug for non-lane owner", () => {
  assert.equal(extractSlug({ owner: "user:bedit" }), null);
  assert.equal(extractSlug({ owner: "" }), null);
  assert.equal(extractSlug({}), null);
});

hookTest("blocks when manifest not found", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:missing", subject: "x" } };
  const result = handleToolCall(event, {});
  assert.ok(result.block);
  assert.match(result.reason, /not found/);
});

hookTest("blocks when manifest missing required fields", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:bad", subject: "x" } };
  const manifests = { bad: { provider: "codex" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.block);
  assert.match(result.reason, /missing/);
});

hookTest("blocks when manifest is invalid JSON", () => {
  const event = { tool: "TaskCreate", input: { owner: "lane:broken", subject: "x" } };
  const manifests = { broken: { parseError: true } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.block);
  assert.match(result.reason, /not valid JSON/);
});

hookTest("ignores non-task tools", () => {
  assert.equal(handleToolCall({ tool: "Edit", input: { owner: "lane:x" } }, {}), undefined);
});

hookTest("ignores tasks without lane owner", () => {
  const event = { tool: "TaskCreate", input: { subject: "no lane" } };
  assert.equal(handleToolCall(event, {}), undefined);
});

hookTest("modelShort maps every hook model and passes unknown IDs through", () => {
  assert.ok(Object.keys(MODEL_SHORT).length >= 8, "hook MODEL_SHORT looks truncated");
  for (const [id, short] of Object.entries(MODEL_SHORT)) assert.equal(modelShort(id), short);
  for (const tier of ["sol", "terra", "luna", "astra"]) assert.ok(idFor(tier), `hook maps a model to '${tier}'`);
  assert.equal(modelShort("unknown-model"), "unknown-model");
});

hookTest("works with TaskUpdate", () => {
  const event = {
    tool: "TaskUpdate",
    input: { owner: "lane:update-test", subject: "Update me" },
  };
  const manifests = { "update-test": { provider: "codex", model: idFor("terra"), effort: "high" } };
  const result = handleToolCall(event, manifests);
  assert.ok(result.allow);
  assert.match(result.subject, /codex terra high/);
});

hookTest("lane_slug takes priority over owner", () => {
  const slug = extractSlug({ owner: "lane:from-owner", metadata: { lane_slug: "from-metadata" } });
  assert.equal(slug, "from-metadata");
});
