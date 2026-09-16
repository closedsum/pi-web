import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  loadExtensionsOpen,
  saveExtensionsOpen,
  EXTENSIONS_OPEN_STORAGE_KEY,
} from "./sidebar-extensions-state.ts";

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, value); },
    _store: store,
  };
}

function makeThrowingStorage() {
  return {
    getItem() { throw new Error("storage unavailable"); },
    setItem() { throw new Error("storage unavailable"); },
  };
}

describe("sidebar-extensions-state", () => {
  describe("loadExtensionsOpen", () => {
    it("returns true by default when storage is empty", () => {
      const storage = makeStorage();
      assert.equal(loadExtensionsOpen(storage), true);
    });

    it("returns true when stored value is 'true'", () => {
      const storage = makeStorage({ [EXTENSIONS_OPEN_STORAGE_KEY]: "true" });
      assert.equal(loadExtensionsOpen(storage), true);
    });

    it("returns false when stored value is 'false'", () => {
      const storage = makeStorage({ [EXTENSIONS_OPEN_STORAGE_KEY]: "false" });
      assert.equal(loadExtensionsOpen(storage), false);
    });

    it("returns true when storage is null", () => {
      assert.equal(loadExtensionsOpen(null), true);
    });

    it("returns true when storage throws", () => {
      assert.equal(loadExtensionsOpen(makeThrowingStorage()), true);
    });

    it("returns true for unexpected stored values", () => {
      const storage = makeStorage({ [EXTENSIONS_OPEN_STORAGE_KEY]: "banana" });
      assert.equal(loadExtensionsOpen(storage), true);
    });
  });

  describe("saveExtensionsOpen", () => {
    it("stores 'true' for open=true", () => {
      const storage = makeStorage();
      saveExtensionsOpen(true, storage);
      assert.equal(storage._store.get(EXTENSIONS_OPEN_STORAGE_KEY), "true");
    });

    it("stores 'false' for open=false", () => {
      const storage = makeStorage();
      saveExtensionsOpen(false, storage);
      assert.equal(storage._store.get(EXTENSIONS_OPEN_STORAGE_KEY), "false");
    });

    it("does not throw when storage is null", () => {
      assert.doesNotThrow(() => saveExtensionsOpen(true, null));
    });

    it("does not throw when storage throws", () => {
      assert.doesNotThrow(() => saveExtensionsOpen(true, makeThrowingStorage()));
    });

    it("overwrites previous value", () => {
      const storage = makeStorage({ [EXTENSIONS_OPEN_STORAGE_KEY]: "true" });
      saveExtensionsOpen(false, storage);
      assert.equal(storage._store.get(EXTENSIONS_OPEN_STORAGE_KEY), "false");
      saveExtensionsOpen(true, storage);
      assert.equal(storage._store.get(EXTENSIONS_OPEN_STORAGE_KEY), "true");
    });
  });

  describe("round-trip permutations", () => {
    for (const initial of [true, false]) {
      for (const update of [true, false]) {
        it(`save(${initial}) then save(${update}) then load => ${update}`, () => {
          const storage = makeStorage();
          saveExtensionsOpen(initial, storage);
          saveExtensionsOpen(update, storage);
          assert.equal(loadExtensionsOpen(storage), update);
        });
      }
    }
  });
});
