import assert from "node:assert/strict";
import test, { describe } from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./shell-command-parser.ts");
  } catch { return import("./shell-command-parser.ts"); }
}

describe("parseNamedArg", () => {
  test("extracts space-separated value", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("python gsd_impl_lane.py pipeline --params-file /path/to/file.json", "--params-file"),
      "/path/to/file.json"
    );
  });

  test("extracts equals-separated value", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file=/path/to/file.json", "--params-file"),
      "/path/to/file.json"
    );
  });

  test("extracts double-quoted value with spaces", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg('cmd --params-file "/path with spaces/file.json"', "--params-file"),
      "/path with spaces/file.json"
    );
  });

  test("extracts single-quoted value with spaces", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file '/path with spaces/file.json'", "--params-file"),
      "/path with spaces/file.json"
    );
  });

  test("returns null when arg not present", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --other-flag value", "--params-file"),
      null
    );
  });

  test("returns null for empty command", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(parseNamedArg("", "--params-file"), null);
  });

  test("does not match partial arg names", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file-extra /wrong", "--params-file"),
      null
    );
  });

  test("extracts arg at start of command", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("--params-file /path/file.json other args", "--params-file"),
      "/path/file.json"
    );
  });

  test("handles Windows backslash paths", async () => {
    const { parseNamedArg } = await loadSubject();
    assert.equal(
      parseNamedArg("cmd --params-file C:\\Users\\user\\file.json", "--params-file"),
      "C:\\Users\\user\\file.json"
    );
  });

  test("extracts from realistic dispatch command", async () => {
    const { parseNamedArg } = await loadSubject();
    const cmd = 'python "C:\\Users\\bedit\\gsd-config\\get-shit-done\\bin\\gsd_impl_lane.py" pipeline --params-file "D:\\Trees\\pi-web\\.planning\\impl-lanes\\p-01-A.json" --detach';
    assert.equal(
      parseNamedArg(cmd, "--params-file"),
      "D:\\Trees\\pi-web\\.planning\\impl-lanes\\p-01-A.json"
    );
  });
});
