import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// PI_TEST_HOOKS_DIR overrides the gsd-config hooks location.
export const HOOKS_DIR_OVERRIDE = process.env.PI_TEST_HOOKS_DIR || "";
export const HOOKS_DIR = HOOKS_DIR_OVERRIDE || join(homedir(), "gsd-config", "get-shit-done", "hooks");

// Load a real gsd-config hook so tests use its tables (model IDs, profiles)
// instead of hand-copied literals that drift. Returns null when gsd-config is
// not installed (callers skip); throws when an explicit PI_TEST_HOOKS_DIR is
// wrong or the hook lacks a required export.
export function loadHook(name, required = []) {
  const path = join(HOOKS_DIR, name);
  if (!existsSync(path)) {
    if (HOOKS_DIR_OVERRIDE) throw new Error(`gsd-config hook not found: ${path} (PI_TEST_HOOKS_DIR)`);
    return null;
  }
  const mod = require(path);
  const missing = required.filter((key) => mod[key] === undefined);
  if (missing.length) throw new Error(`${name} does not export ${missing.join(", ")}`);
  return mod;
}

export const SKIP_WITHOUT_HOOKS = "gsd-config hooks not installed (set PI_TEST_HOOKS_DIR)";
