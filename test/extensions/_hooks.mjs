import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

// PI_TEST_HOOKS_DIR overrides the gsd-config hooks location.
export const HOOKS_DIR_OVERRIDE = process.env.PI_TEST_HOOKS_DIR || "";
export const HOOKS_DIR = HOOKS_DIR_OVERRIDE || join(homedir(), "gsd-config", "get-shit-done", "hooks");

export const SKIP_WITHOUT_HOOKS = "gsd-config hooks not installed (set PI_TEST_HOOKS_DIR)";

// Load a real gsd-config hook so tests use its tables (model IDs, profiles)
// instead of hand-copied literals that drift. Returns null only when gsd-config
// is not installed at all (default hooks dir absent), so callers can skip.
// Throws when an explicit PI_TEST_HOOKS_DIR is wrong, when an installed hooks
// dir lacks the hook, or when a required export has the wrong type.
// required: { exportName: "function" | "object" | ... } (typeof checks).
export function loadHook(name, required = {}) {
  if (!existsSync(HOOKS_DIR)) {
    if (HOOKS_DIR_OVERRIDE) throw new Error(`hooks dir not found: ${HOOKS_DIR} (PI_TEST_HOOKS_DIR)`);
    return null;
  }
  const path = join(HOOKS_DIR, name);
  if (!existsSync(path)) throw new Error(`gsd-config hook missing from installed hooks dir: ${path}`);
  const mod = require(path);
  const bad = Object.entries(required)
    .filter(([key, type]) => typeof mod[key] !== type || mod[key] === null)
    .map(([key, type]) => `${key} (expected ${type})`);
  if (bad.length) throw new Error(`${name} exports invalid: ${bad.join(", ")}`);
  return mod;
}

/** test() variant that skips when the hook is unavailable; use only for tests that read hook tables. */
export function hookTestFor(hook) {
  return (name, fn) => test(name, { skip: hook ? false : SKIP_WITHOUT_HOOKS }, fn);
}
