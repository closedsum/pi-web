import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildDebugState } = await jiti.import("./debug-state.ts");

function makeSession(id, overrides = {}) {
  return { id, name: `session-${id}`, cwd: "/test", ...overrides };
}

function makeProvider(alive, state = {}) {
  return {
    isAlive: () => alive,
    getState: async () => state,
  };
}

function makeWidget(key, lineCount = 2) {
  return {
    key,
    lines: Array.from({ length: lineCount }, (_, i) => `${key}-line-${i}`),
    placement: "aboveEditor",
  };
}

describe("buildDebugState", () => {
  describe("response shape", () => {
    it("returns correct shape with zero sessions", async () => {
      const result = await buildDebugState([], () => undefined);
      assert.equal(typeof result.serverTime, "string");
      assert.equal(result.activeSessions, 0);
      assert.equal(result.aliveSessions, 0);
      assert.equal(result.totalExtensionWidgets, 0);
      assert.ok(Array.isArray(result.sessions));
      assert.equal(result.sessions.length, 0);
    });

    it("includes session fields", async () => {
      const sessions = [makeSession("s1", { name: "test", cwd: "/project" })];
      const result = await buildDebugState(sessions, () => makeProvider(true));
      const s = result.sessions[0];
      assert.equal(s.id, "s1");
      assert.equal(s.name, "test");
      assert.equal(s.cwd, "/project");
      assert.equal(s.alive, true);
      assert.equal(typeof s.extensionWidgetCount, "number");
      assert.ok(Array.isArray(s.extensionWidgets));
    });
  });

  describe("alive detection", () => {
    it("reports alive=true for living sessions", async () => {
      const result = await buildDebugState([makeSession("s1")], () => makeProvider(true));
      assert.equal(result.sessions[0].alive, true);
      assert.equal(result.aliveSessions, 1);
    });

    it("reports alive=false for dead sessions", async () => {
      const result = await buildDebugState([makeSession("s1")], () => makeProvider(false));
      assert.equal(result.sessions[0].alive, false);
      assert.equal(result.aliveSessions, 0);
    });

    it("reports alive=false when provider is undefined", async () => {
      const result = await buildDebugState([makeSession("s1")], () => undefined);
      assert.equal(result.sessions[0].alive, false);
    });
  });

  describe("extension widgets", () => {
    it("returns widgets from alive sessions", async () => {
      const widgets = [makeWidget("gsd")];
      const result = await buildDebugState(
        [makeSession("s1")],
        () => makeProvider(true, { extensionWidgets: widgets }),
      );
      assert.equal(result.sessions[0].extensionWidgetCount, 1);
      assert.deepEqual(result.sessions[0].extensionWidgets, widgets);
      assert.equal(result.totalExtensionWidgets, 1);
    });

    it("returns empty widgets for dead sessions", async () => {
      const widgets = [makeWidget("gsd")];
      const result = await buildDebugState(
        [makeSession("s1")],
        () => makeProvider(false, { extensionWidgets: widgets }),
      );
      assert.equal(result.sessions[0].extensionWidgetCount, 0);
      assert.equal(result.totalExtensionWidgets, 0);
    });

    it("surfaces getState errors in _error field", async () => {
      const result = await buildDebugState(
        [makeSession("s1")],
        () => ({
          isAlive: () => true,
          getState: async () => { throw new Error("connection lost"); },
        }),
      );
      assert.equal(result.sessions[0].alive, true);
      assert.equal(result.sessions[0].extensionWidgetCount, 0);
      assert.ok(result.sessions[0]._error, "error should be surfaced, not swallowed");
      assert.match(result.sessions[0]._error, /connection lost/);
    });
  });

  describe("multi-session permutations", () => {
    for (const sessionCount of [1, 3, 5]) {
      for (const aliveRatio of [0, 0.5, 1]) {
        for (const widgetCount of [0, 2]) {
          const aliveCount = Math.floor(sessionCount * aliveRatio);
          const label = `${sessionCount} sessions, ${aliveCount} alive, ${widgetCount} widgets each`;

          it(label, async () => {
            const sessions = Array.from({ length: sessionCount }, (_, i) => makeSession(`s${i}`));
            const widgets = Array.from({ length: widgetCount }, (_, i) => makeWidget(`w${i}`));

            const result = await buildDebugState(sessions, (id) => {
              const idx = sessions.findIndex((s) => s.id === id);
              return makeProvider(idx < aliveCount, { extensionWidgets: widgets });
            });

            assert.equal(result.activeSessions, sessionCount);
            assert.equal(result.aliveSessions, aliveCount);
            assert.equal(result.totalExtensionWidgets, aliveCount * widgetCount);

            for (let i = 0; i < sessionCount; i++) {
              const s = result.sessions[i];
              if (i < aliveCount) {
                assert.equal(s.alive, true, `session ${i} should be alive`);
                assert.equal(s.extensionWidgetCount, widgetCount);
              } else {
                assert.equal(s.alive, false, `session ${i} should be dead`);
                assert.equal(s.extensionWidgetCount, 0);
              }
            }
          });
        }
      }
    }
  });
});
