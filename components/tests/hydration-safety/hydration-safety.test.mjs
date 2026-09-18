import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const PATTERN = /useState\(\(\)\s*=>\s*\{[^}]*(?:localStorage|sessionStorage)\b/g;

function collectTsx(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "fixtures") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...collectTsx(full));
    else if (entry.endsWith(".tsx")) results.push(full);
  }
  return results;
}

function scanFile(file) {
  const src = readFileSync(file, "utf8");
  const hits = [];
  let match;
  while ((match = PATTERN.exec(src)) !== null) {
    const line = src.slice(0, match.index).split("\n").length;
    hits.push(line);
  }
  return hits;
}

test("fixture: detects violation.tsx", () => {
  const fixture = join(import.meta.dirname, "fixtures", "violation.tsx");
  const hits = scanFile(fixture);
  assert.ok(hits.length > 0, "scanner must catch localStorage in useState initializer");
});

test("fixture: safe.tsx passes clean", () => {
  const fixture = join(import.meta.dirname, "fixtures", "safe.tsx");
  const hits = scanFile(fixture);
  assert.deepStrictEqual(hits, [], "useEffect pattern must not trigger");
});

test("no localStorage/sessionStorage inside useState initializers in components/", () => {
  const componentsRoot = join(import.meta.dirname, "..", "..");
  const files = collectTsx(componentsRoot);
  const violations = [];

  for (const file of files) {
    const hits = scanFile(file);
    for (const line of hits) {
      const rel = file.replace(componentsRoot + "\\", "").replace(componentsRoot + "/", "");
      violations.push(`${rel}:${line}`);
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `Hydration hazard: localStorage/sessionStorage in useState initializer.\n` +
    `Move the read to a useEffect hook so SSR and client render match.\n` +
    `Violations:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
  );
});
