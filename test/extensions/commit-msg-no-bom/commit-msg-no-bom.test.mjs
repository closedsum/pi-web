import assert from "node:assert/strict";
import test from "node:test";

function stripBomAndValidate(content) {
  const hasBom = content.length >= 3 && content.charCodeAt(0) === 0xfeff;
  const cleaned = hasBom ? content.slice(1) : content;
  const subjectLine = cleaned.split(/\r\n|\r|\n/, 1)[0] || "";
  if (subjectLine.trim() === "") {
    return { error: "commit message subject line is empty after stripping the BOM", cleaned, hasBom };
  }
  return { error: null, cleaned, hasBom };
}

test("strips BOM and returns cleaned content", () => {
  const result = stripBomAndValidate("﻿fix: remove bug");
  assert.equal(result.hasBom, true);
  assert.equal(result.cleaned, "fix: remove bug");
  assert.equal(result.error, null);
});

test("passes through content without BOM", () => {
  const result = stripBomAndValidate("feat: new feature\n\nBody text");
  assert.equal(result.hasBom, false);
  assert.equal(result.cleaned, "feat: new feature\n\nBody text");
  assert.equal(result.error, null);
});

test("rejects empty subject after BOM strip", () => {
  const result = stripBomAndValidate("﻿\n\nBody only");
  assert.equal(result.hasBom, true);
  assert.ok(result.error);
  assert.match(result.error, /empty/);
});

test("rejects completely empty message", () => {
  const result = stripBomAndValidate("");
  assert.ok(result.error);
  assert.match(result.error, /empty/);
});

test("handles CRLF line endings", () => {
  const result = stripBomAndValidate("fix: thing\r\n\r\nBody");
  assert.equal(result.error, null);
  assert.equal(result.cleaned, "fix: thing\r\n\r\nBody");
});
