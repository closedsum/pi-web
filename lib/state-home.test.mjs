import assert from "node:assert/strict";
import test, { describe } from "node:test";
import path from "path";
import os from "os";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./state-home.ts");
  } catch { return import("./state-home.ts"); }
}

describe("resolveStateHome", () => {
  test("returns GSD_STATE_HOME when set", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "/custom/gsd" });
    assert.equal(result, path.resolve("/custom/gsd"));
  });

  test("falls back to ~/.gsd when GSD_STATE_HOME not set", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({});
    assert.equal(result, path.join(os.homedir(), ".gsd"));
  });

  test("falls back when GSD_STATE_HOME is empty string", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "" });
    assert.equal(result, path.join(os.homedir(), ".gsd"));
  });

  test("resolves relative paths", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome({ GSD_STATE_HOME: "relative/path" });
    assert.equal(result, path.resolve("relative/path"));
  });

  test("uses process.env by default", async () => {
    const { resolveStateHome } = await loadSubject();
    const result = resolveStateHome();
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0);
  });
});
