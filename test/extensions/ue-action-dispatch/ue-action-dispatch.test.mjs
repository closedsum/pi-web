import assert from "node:assert/strict";
import test from "node:test";

const SYSTEM_NOTIFICATION_MARKER = "[SYSTEM NOTIFICATION";
const MAX_PROMPT_BYTES = 8000;
const MAX_PROSE_LINES = 30;

function extractUserProse(prompt) {
  if (typeof prompt !== "string" || !prompt.length) return null;
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) return null;
  const lines = prompt.split("\n");
  let inSystemBlock = false;
  let inCodeFence = false;
  const userLines = [];
  for (const line of lines) {
    if (line.includes("<system-reminder>") || line.includes("<task-notification>")) {
      inSystemBlock = true;
      continue;
    }
    if (line.includes("</system-reminder>") || line.includes("</task-notification>")) {
      inSystemBlock = false;
      continue;
    }
    if (inSystemBlock) continue;
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (line.startsWith(SYSTEM_NOTIFICATION_MARKER)) continue;
    userLines.push(line);
  }
  if (userLines.length === 0) return null;
  if (userLines.length > MAX_PROSE_LINES) return null;
  return userLines.join("\n").trim() || null;
}

function blankQuotedSpans(text) {
  return text.replace(/"[^"]{10,}"/g, '""').replace(/'[^']{10,}'/g, "''");
}

function stripLeadingFraming(text) {
  return text.replace(/^(?:then\s+|now[,\s]+|I\s+need\s+to\s+|please\s+|can\s+you\s+)/i, "").trim();
}

function matchVerb(prose, patterns) {
  const stripped = stripLeadingFraming(prose);
  for (const p of patterns) {
    if (p.test(stripped)) return true;
  }
  return false;
}

test("extractUserProse returns user text", () => {
  const result = extractUserProse("build the project");
  assert.equal(result, "build the project");
});

test("extractUserProse strips system reminders", () => {
  const prompt = "do something\n<system-reminder>\nhidden\n</system-reminder>\nmore text";
  assert.equal(extractUserProse(prompt), "do something\nmore text");
});

test("extractUserProse strips task notifications", () => {
  const prompt = "run tests\n<task-notification>\ntask done\n</task-notification>";
  assert.equal(extractUserProse(prompt), "run tests");
});

test("extractUserProse strips code fences", () => {
  const prompt = "fix this\n```\nconst x = 1;\n```\nthanks";
  assert.equal(extractUserProse(prompt), "fix this\nthanks");
});

test("extractUserProse returns null for empty prompt", () => {
  assert.equal(extractUserProse(""), null);
  assert.equal(extractUserProse(null), null);
});

test("extractUserProse returns null for oversized prompt", () => {
  const big = "x".repeat(MAX_PROMPT_BYTES + 1);
  assert.equal(extractUserProse(big), null);
});

test("extractUserProse returns null for too many prose lines", () => {
  const lines = Array.from({ length: MAX_PROSE_LINES + 1 }, (_, i) => `line ${i}`);
  assert.equal(extractUserProse(lines.join("\n")), null);
});

test("extractUserProse returns null for system-only prompts", () => {
  const prompt = "<system-reminder>\nall system\n</system-reminder>";
  assert.equal(extractUserProse(prompt), null);
});

test("blankQuotedSpans removes long quoted strings", () => {
  const text = 'run "this is a long quoted path" now';
  const result = blankQuotedSpans(text);
  assert.match(result, /run ""/);
  assert.ok(!result.includes("long quoted path"));
});

test("blankQuotedSpans preserves short quotes", () => {
  const text = 'run "short" now';
  assert.equal(blankQuotedSpans(text), 'run "short" now');
});

test("stripLeadingFraming removes then", () => {
  assert.equal(stripLeadingFraming("then build it"), "build it");
});

test("stripLeadingFraming removes now", () => {
  assert.equal(stripLeadingFraming("now, run tests"), "run tests");
});

test("stripLeadingFraming removes please", () => {
  assert.equal(stripLeadingFraming("please open the editor"), "open the editor");
});

test("stripLeadingFraming removes can you", () => {
  assert.equal(stripLeadingFraming("can you start PIE"), "start PIE");
});

test("stripLeadingFraming removes I need to", () => {
  assert.equal(stripLeadingFraming("I need to build"), "build");
});

test("matchVerb detects verb after stripping framing", () => {
  const patterns = [/^build\b/i, /^run\b/i];
  assert.ok(matchVerb("please build the project", patterns));
  assert.ok(matchVerb("then run tests", patterns));
  assert.ok(!matchVerb("deploy the app", patterns));
});
