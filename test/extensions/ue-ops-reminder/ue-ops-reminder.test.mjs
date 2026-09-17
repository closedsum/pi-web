import assert from "node:assert/strict";
import test from "node:test";

const DEFAULT_VERBS = [
  "close", "launch", "start", "stop", "build", "clean",
  "kill", "open", "run", "restart", "shut", "shutdown",
];
const DEFAULT_NOUNS = [
  "editor", "pie", "unreal", "ue", "ubt", "cook", "package", "csmcp",
];

function hasMatch(text, words) {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("\\b(?:" + escaped.join("|") + ")\\b", "i");
  return re.test(text);
}

function detectUeIntent(prompt, verbs = DEFAULT_VERBS, nouns = DEFAULT_NOUNS) {
  if (typeof prompt !== "string" || !prompt.trim()) return false;
  return hasMatch(prompt, verbs) && hasMatch(prompt, nouns);
}

function mergeSet(defaults, catalogEntries, field) {
  const s = new Set(defaults.map((v) => v.toLowerCase()));
  if (catalogEntries) {
    for (const entry of catalogEntries) {
      const arr = entry[field];
      if (Array.isArray(arr)) {
        for (const v of arr) s.add(String(v).toLowerCase());
      }
    }
  }
  return s;
}

test("detects launch editor", () => {
  assert.ok(detectUeIntent("launch the editor"));
});

test("detects start pie", () => {
  assert.ok(detectUeIntent("start PIE"));
});

test("detects build unreal", () => {
  assert.ok(detectUeIntent("build unreal project"));
});

test("detects stop editor", () => {
  assert.ok(detectUeIntent("stop the editor"));
});

test("detects restart csmcp", () => {
  assert.ok(detectUeIntent("restart csmcp sidecar"));
});

test("detects kill ue process", () => {
  assert.ok(detectUeIntent("kill the UE process"));
});

test("detects open editor", () => {
  assert.ok(detectUeIntent("open the unreal editor"));
});

test("detects shutdown editor", () => {
  assert.ok(detectUeIntent("shutdown the editor"));
});

test("no match without verb", () => {
  assert.ok(!detectUeIntent("the editor is running"));
});

test("no match without noun", () => {
  assert.ok(!detectUeIntent("start the server"));
});

test("no match on empty prompt", () => {
  assert.ok(!detectUeIntent(""));
  assert.ok(!detectUeIntent(null));
});

test("case insensitive matching", () => {
  assert.ok(detectUeIntent("LAUNCH EDITOR"));
  assert.ok(detectUeIntent("Build UBT"));
});

test("mergeSet extends defaults with catalog entries", () => {
  const merged = mergeSet(DEFAULT_VERBS, [{ verbs: ["deploy", "test"] }], "verbs");
  assert.ok(merged.has("launch"));
  assert.ok(merged.has("deploy"));
  assert.ok(merged.has("test"));
});

test("mergeSet handles missing catalog", () => {
  const merged = mergeSet(DEFAULT_VERBS, null, "verbs");
  assert.equal(merged.size, DEFAULT_VERBS.length);
});

test("mergeSet deduplicates entries", () => {
  const merged = mergeSet(["start"], [{ verbs: ["Start", "START"] }], "verbs");
  assert.equal(merged.size, 1);
});

test("custom verbs and nouns work", () => {
  assert.ok(detectUeIntent("deploy the widget", ["deploy"], ["widget"]));
  assert.ok(!detectUeIntent("deploy the widget", ["launch"], ["widget"]));
});

test("detects cook intent", () => {
  assert.ok(detectUeIntent("run cook for package"));
});

test("clean ubt detected", () => {
  assert.ok(detectUeIntent("clean the ubt output"));
});
