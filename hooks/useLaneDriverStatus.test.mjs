import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const mod = await jiti.import("./useLaneDriverStatus.ts");

describe("useLaneDriverStatus module", () => {
  test("exports useLaneDriverStatus function", () => {
    assert.equal(typeof mod.useLaneDriverStatus, "function");
  });

  test("exports LaneDriverState type (function exists at runtime)", () => {
    assert.ok(mod.useLaneDriverStatus, "Hook should be accessible");
  });
});
