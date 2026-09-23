import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { E2E_CONFIG } from "./_e2e-harness.mjs";

const require = createRequire(import.meta.url);

// Load a real gsd-config hook module so tests use its tables (model IDs,
// profiles) instead of hand-copied literals that drift. Throws with a clear
// message when the hooks dir is missing (set PI_TEST_HOOKS_DIR to override).
export function loadHook(name) {
  const path = join(E2E_CONFIG.hooksDir, name);
  if (!existsSync(path)) {
    throw new Error(`gsd-config hook not found: ${path} (set PI_TEST_HOOKS_DIR)`);
  }
  return require(path);
}
