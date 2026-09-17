import assert from "node:assert/strict";
import test from "node:test";

const APPROVED_V2_ACTIONS = {
  orientation: [
    "set_actor_location", "set_actor_rotation", "set_pawn_location",
    "teleport_pawn", "teleport_player",
  ],
  bt: [
    "clear_tree", "create_tree", "inject_tree", "set_tree",
    "start_tree", "stop_tree",
  ],
};

const REQUIRED_NORMALIZATION = ["lowercase", "hyphen_to_space", "underscore_to_space", "collapse_whitespace"];

function normalizedWords(value) {
  if (typeof value !== "string") return [];
  return value.toLowerCase().replace(/[-_]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function compileDispatchPolicy(manifest) {
  const schema = manifest?.schema;
  const groups = new Map();
  const errors = [];
  if (schema !== 2) return { schema, groups, errors };

  for (const [groupName, approvedActions] of Object.entries(APPROVED_V2_ACTIONS)) {
    const group = manifest?.groups?.[groupName];
    if (!group || group.mode !== "group_name_only") {
      errors.push(`${groupName}: unsupported anchoring contract`);
      continue;
    }
    if (JSON.stringify(group.normalization) !== JSON.stringify(REQUIRED_NORMALIZATION)) {
      errors.push(`${groupName}: unsupported normalization policy`);
      continue;
    }
    const actions = approvedActions.map((name) => {
      const [verb, ...nouns] = normalizedWords(name);
      return { verb, nouns };
    });
    groups.set(groupName, { actions });
  }
  return { schema, groups, errors };
}

function selectDispatchPolicy(compiled, requested) {
  if (requested === "v1" || compiled.schema !== 2) {
    return { version: "v1", groups: new Map(), error: null };
  }
  if (requested && requested !== "v2") {
    return { version: "v1", groups: new Map(), error: `unknown policy: ${requested}` };
  }
  return { version: "v2", groups: compiled.groups, error: null };
}

test("compileDispatchPolicy returns errors for schema != 2", () => {
  const result = compileDispatchPolicy({ schema: 1 });
  assert.equal(result.schema, 1);
  assert.equal(result.groups.size, 0);
});

test("compileDispatchPolicy compiles valid schema 2 manifest", () => {
  const manifest = {
    schema: 2,
    groups: {
      orientation: { mode: "group_name_only", prose_nouns: [], normalization: REQUIRED_NORMALIZATION, actions: {}, verb_aliases: {} },
      bt: { mode: "group_name_only", prose_nouns: [], normalization: REQUIRED_NORMALIZATION, actions: {}, verb_aliases: {} },
    },
  };
  const result = compileDispatchPolicy(manifest);
  assert.equal(result.schema, 2);
  assert.ok(result.groups.has("orientation"));
  assert.ok(result.groups.has("bt"));
});

test("compileDispatchPolicy errors on wrong mode", () => {
  const manifest = {
    schema: 2,
    groups: { orientation: { mode: "full_match" } },
  };
  const result = compileDispatchPolicy(manifest);
  assert.ok(result.errors.some((e) => e.includes("orientation")));
});

test("compileDispatchPolicy errors on wrong normalization", () => {
  const manifest = {
    schema: 2,
    groups: {
      orientation: { mode: "group_name_only", prose_nouns: [], normalization: ["lowercase"] },
    },
  };
  const result = compileDispatchPolicy(manifest);
  assert.ok(result.errors.some((e) => e.includes("normalization")));
});

test("normalizedWords splits hyphen/underscore to spaces", () => {
  assert.deepEqual(normalizedWords("set_actor_location"), ["set", "actor", "location"]);
  assert.deepEqual(normalizedWords("my-action"), ["my", "action"]);
  assert.deepEqual(normalizedWords(""), []);
  assert.deepEqual(normalizedWords(null), []);
});

test("selectDispatchPolicy returns v1 when requested", () => {
  const compiled = compileDispatchPolicy({ schema: 2, groups: {} });
  const policy = selectDispatchPolicy(compiled, "v1");
  assert.equal(policy.version, "v1");
});

test("selectDispatchPolicy returns v2 for schema 2", () => {
  const manifest = {
    schema: 2,
    groups: {
      orientation: { mode: "group_name_only", prose_nouns: [], normalization: REQUIRED_NORMALIZATION, actions: {}, verb_aliases: {} },
      bt: { mode: "group_name_only", prose_nouns: [], normalization: REQUIRED_NORMALIZATION, actions: {}, verb_aliases: {} },
    },
  };
  const compiled = compileDispatchPolicy(manifest);
  const policy = selectDispatchPolicy(compiled, undefined);
  assert.equal(policy.version, "v2");
});

test("selectDispatchPolicy errors on unknown policy string", () => {
  const compiled = compileDispatchPolicy({ schema: 2, groups: {} });
  const policy = selectDispatchPolicy(compiled, "v3");
  assert.equal(policy.version, "v1");
  assert.ok(policy.error);
});

test("selectDispatchPolicy returns v1 for schema 1", () => {
  const compiled = compileDispatchPolicy({ schema: 1 });
  const policy = selectDispatchPolicy(compiled, undefined);
  assert.equal(policy.version, "v1");
});
