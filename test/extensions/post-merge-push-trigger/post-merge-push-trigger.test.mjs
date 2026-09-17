import assert from "node:assert/strict";
import test from "node:test";

function detectSuccessfulMerge(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed._error) return false;
  const status = parsed.status || parsed.summary?.status;
  return status === "integrated";
}

function buildNotice(slug) {
  return `[POST-MERGE] ${slug} integrated. Suggested: run verification suites, cross-review, then push.`;
}

test("detects successful merge", () => {
  assert.ok(detectSuccessfulMerge({ status: "integrated", slug: "fix-auth" }));
});

test("detects merge from summary shape", () => {
  assert.ok(detectSuccessfulMerge({ summary: { status: "integrated" }, slug: "x" }));
});

test("rejects merge with error", () => {
  assert.ok(!detectSuccessfulMerge({ status: "integrated", _error: "conflict" }));
});

test("rejects non-integrated status", () => {
  assert.ok(!detectSuccessfulMerge({ status: "failed" }));
  assert.ok(!detectSuccessfulMerge({ status: "running" }));
});

test("rejects null/undefined", () => {
  assert.ok(!detectSuccessfulMerge(null));
  assert.ok(!detectSuccessfulMerge(undefined));
});

test("formats notice", () => {
  const notice = buildNotice("fix-auth");
  assert.match(notice, /POST-MERGE/);
  assert.match(notice, /fix-auth integrated/);
});
