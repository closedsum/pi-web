import assert from "node:assert/strict";
import test from "node:test";

const BUG_SIGNALS = ["bug", "error", "crash", "broken", "fails", "regression", "doesn't work", "not working"];
const TRIVIAL_SIGNALS = ["typo", "rename", "bump version", "gitignore", "missing import", "config change"];

function classify(prompt) {
  const lower = prompt.toLowerCase().trim();
  if (lower.startsWith("/") || lower.startsWith("!")) return null;
  if (lower.length < 15) return null;
  if (lower.endsWith("?") || /^(?:what|how|why|can|does|is|are|where|which|explain)\s/i.test(lower)) return null;
  if (["thanks", "got it", "sounds good", "ok", "yes", "no", "go ahead", "lgtm"].some(c => lower === c)) return null;
  for (const s of BUG_SIGNALS) { if (lower.includes(s)) return "bug-fix"; }
  for (const s of TRIVIAL_SIGNALS) { if (lower.includes(s)) return "fast"; }
  return "decide";
}

test("routes bug keywords to bug-fix", () => {
  assert.equal(classify("the login page crashes when I submit"), "bug-fix");
  assert.equal(classify("there is a regression in the API"), "bug-fix");
  assert.equal(classify("the build fails on Windows"), "bug-fix");
});

test("routes trivial keywords to fast", () => {
  assert.equal(classify("fix this typo in the README"), "fast");
  assert.equal(classify("rename the variable to camelCase"), "fast");
  assert.equal(classify("bump version to 2.0"), "fast");
});

test("skips slash commands", () => {
  assert.equal(classify("/gsd:progress"), null);
});

test("skips short prompts", () => {
  assert.equal(classify("continue"), null);
  assert.equal(classify("yes do it"), null);
});

test("skips questions", () => {
  assert.equal(classify("what does this function do?"), null);
  assert.equal(classify("how should we approach this problem?"), null);
});

test("falls back to decide for ambiguous prompts", () => {
  assert.equal(classify("implement a new authentication system with OAuth"), "decide");
});
