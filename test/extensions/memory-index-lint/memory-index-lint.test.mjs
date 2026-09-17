import assert from "node:assert/strict";
import test from "node:test";

const INDEX_RE = /^\s*-\s*\[[^\]]+\]\(([^)\\/]+\.md)\)\s*(?:—\s*(.*))?\s*$/i;
const STATUS_RE = /\b(SUPERSEDED|DEPRECATED|OBSOLETE)\b/gi;

function parseIndexLine(line) {
  const match = INDEX_RE.exec(line);
  if (!match) return null;
  return { fileName: match[1], hookText: match[2] || "" };
}

function checkStatusWords(hookText, memoryDescription) {
  const findings = [];
  let m;
  const pattern = new RegExp(STATUS_RE.source, "gi");
  while ((m = pattern.exec(memoryDescription))) {
    const word = m[1].toUpperCase();
    if (!new RegExp(`\\b${word}\\b`, "i").test(hookText)) {
      findings.push(`${word} not reflected in index`);
    }
  }
  return findings;
}

test("parses standard index line", () => {
  const result = parseIndexLine("- [Cross-review timing](feedback_cross_review_timing.md) — takes 10+ min");
  assert.equal(result.fileName, "feedback_cross_review_timing.md");
  assert.match(result.hookText, /10\+ min/);
});

test("returns null for non-index lines", () => {
  assert.equal(parseIndexLine("# Memory Index"), null);
  assert.equal(parseIndexLine("Some plain text"), null);
});

test("detects missing SUPERSEDED in hook text", () => {
  const findings = checkStatusWords("old rule about thing", "SUPERSEDED by new rule");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /SUPERSEDED/);
});

test("passes when status word is in hook text", () => {
  const findings = checkStatusWords("DEPRECATED — old approach", "DEPRECATED, use new one");
  assert.equal(findings.length, 0);
});

test("handles multiple status words", () => {
  const findings = checkStatusWords("just a note", "SUPERSEDED and OBSOLETE");
  assert.equal(findings.length, 2);
});
