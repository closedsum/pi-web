import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./thinking-levels.ts");
  } catch { return import("./thinking-levels.ts"); }
}

const { THINKING_LEVELS, isThinkingLevel } = await loadSubject();

test("THINKING_LEVELS lists the runtime thinking levels in order", () => {
  assert.deepEqual([...THINKING_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
});

test("isThinkingLevel accepts known levels only", () => {
  assert.equal(isThinkingLevel("high"), true);
  assert.equal(isThinkingLevel("max"), true);
  assert.equal(isThinkingLevel("HIGH"), false);
  assert.equal(isThinkingLevel(""), false);
  assert.equal(isThinkingLevel(undefined), false);
});

test("no lib module redefines the thinking-level set", () => {
  const dir = new URL("./", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && f !== "thinking-levels.ts")
    .filter((f) => /\[\s*"off",\s*"minimal",\s*"low",\s*"medium",\s*"high",\s*"xhigh",\s*"max"\s*\]/
      .test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(offenders, [], "import THINKING_LEVELS from lib/thinking-levels.ts instead");
});
