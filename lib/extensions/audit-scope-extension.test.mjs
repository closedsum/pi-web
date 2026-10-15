import assert from "node:assert/strict";
import test, { describe, beforeEach, afterEach } from "node:test";
import path from "path";
import os from "os";
import fs from "fs";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./audit-scope-extension.ts");
  } catch { return import("./audit-scope-extension.ts"); }
}

function encodeScope(scope) {
  const json = JSON.stringify(scope);
  return Buffer.from(json).toString("base64url");
}

describe("decodeScope", () => {
  test("decodes valid base64url token with files and creates", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: ["/a/b.ts"], creates: ["/a/c.ts"] });
    const scope = decodeScope(token);
    assert.ok(scope.files instanceof Set);
    assert.ok(scope.files.has(path.resolve("/a/b.ts")));
    assert.ok(scope.creates instanceof Set);
    assert.ok(scope.creates.has(path.resolve("/a/c.ts")));
  });

  test("returns empty creates set when creates is omitted", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: ["/a/b.ts"] });
    const scope = decodeScope(token);
    assert.equal(scope.creates.size, 0);
  });

  test("throws on invalid base64url", async () => {
    const { decodeScope } = await loadSubject();
    assert.throws(() => decodeScope("!!!not-valid!!!"), /invalid.*scope.*token/i);
  });

  test("throws when files array is missing", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ creates: ["/a.ts"] });
    assert.throws(() => decodeScope(token), /files/i);
  });

  test("throws when files is empty array", async () => {
    const { decodeScope } = await loadSubject();
    const token = encodeScope({ files: [] });
    assert.throws(() => decodeScope(token), /files/i);
  });
});

describe("checkAuditScope", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-audit-scope-"));
    fs.writeFileSync(path.join(tmpDir, "allowed.ts"), "export const x = 1;\n");
    fs.mkdirSync(path.join(tmpDir, "subdir"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "subdir", "nested.ts"), "export const y = 2;\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns undefined when no scope token (not an audit session)", async () => {
    const { checkAuditScope } = await loadSubject();
    const result = checkAuditScope("Write", { file_path: "/any/path.ts" }, undefined);
    assert.equal(result, undefined);
  });

  test("returns undefined when scope token is empty string", async () => {
    const { checkAuditScope } = await loadSubject();
    const result = checkAuditScope("Write", { file_path: "/any/path.ts" }, "");
    assert.equal(result, undefined);
  });

  test("returns undefined for non-file tools (Bash, Read, Grep)", async () => {
    const { checkAuditScope } = await loadSubject();
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    assert.equal(checkAuditScope("Bash", { command: "ls" }, token), undefined);
    assert.equal(checkAuditScope("Read", { file_path: "/etc/passwd" }, token), undefined);
    assert.equal(checkAuditScope("Grep", { pattern: "foo" }, token), undefined);
  });

  test("allows Write to file in scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Write", { file_path: filePath, content: "new" }, token);
    assert.equal(result, undefined);
  });

  test("allows Edit to file in scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Edit", { file_path: filePath, old_string: "x", new_string: "y" }, token);
    assert.equal(result, undefined);
  });

  test("blocks Write to file outside scope with OUT_OF_SCOPE", async () => {
    const { checkAuditScope } = await loadSubject();
    const allowedFile = path.join(tmpDir, "allowed.ts");
    const outsideFile = path.join(tmpDir, "other.ts");
    fs.writeFileSync(outsideFile, "bad");
    const token = encodeScope({ files: [allowedFile] });
    const result = checkAuditScope("Write", { file_path: outsideFile, content: "new" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("OUT_OF_SCOPE"));
  });

  test("blocks Edit to file outside scope", async () => {
    const { checkAuditScope } = await loadSubject();
    const allowedFile = path.join(tmpDir, "allowed.ts");
    const outsideFile = path.join(tmpDir, "subdir", "nested.ts");
    const token = encodeScope({ files: [allowedFile] });
    const result = checkAuditScope("Edit", { file_path: outsideFile }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("OUT_OF_SCOPE"));
  });

  test("blocks path traversal attempts", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    // Use raw string to preserve .. (path.join normalizes it away on Windows)
    const traversal = tmpDir + path.sep + ".." + path.sep + "escape.ts";
    const result = checkAuditScope("Write", { file_path: traversal, content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    assert.ok(result.reason.includes("TRAVERSAL"));
  });

  test("blocks non-absolute paths", async () => {
    const { checkAuditScope } = await loadSubject();
    const filePath = path.join(tmpDir, "allowed.ts");
    const token = encodeScope({ files: [filePath] });
    const result = checkAuditScope("Write", { file_path: "relative/path.ts", content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
  });

  test("blocks when file_path is missing from input", async () => {
    const { checkAuditScope } = await loadSubject();
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    const result = checkAuditScope("Write", { content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
  });

  test("handles symlink scope escape", async () => {
    const { checkAuditScope } = await loadSubject();
    const escapePath = path.join(os.tmpdir(), `pi-web-escape-target-${process.pid}.ts`);
    fs.writeFileSync(escapePath, "secret");
    const symlinkPath = path.join(tmpDir, "sneaky-link.ts");
    try {
      fs.symlinkSync(escapePath, symlinkPath);
    } catch {
      fs.rmSync(escapePath, { force: true });
      return;
    }
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")] });
    const result = checkAuditScope("Write", { file_path: symlinkPath, content: "x" }, token);
    assert.ok(result);
    assert.equal(result.block, true);
    fs.rmSync(escapePath, { force: true });
  });

  test("allows Write to creates-set path that does not exist yet", async () => {
    const { checkAuditScope } = await loadSubject();
    const newFile = path.join(tmpDir, "brand-new.ts");
    const token = encodeScope({ files: [path.join(tmpDir, "allowed.ts")], creates: [newFile] });
    const result = checkAuditScope("Write", { file_path: newFile, content: "new" }, token);
    assert.equal(result, undefined);
  });
});
