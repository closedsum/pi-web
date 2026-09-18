import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/pi-web.js", import.meta.url));

function occupyPort(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(port, host, () => resolve(server));
    server.on("error", reject);
  });
}

test("exits with a clear error when the port is already in use", async () => {
  const server = await occupyPort(0);
  const { port } = server.address();
  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, "-p", String(port)],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.notEqual(result.status, 0, "should exit non-zero");
    assert.match(
      result.stderr,
      /port.*in use/i,
      "stderr should mention port conflict",
    );
    assert.match(
      result.stderr,
      new RegExp(String(port)),
      "stderr should include the port number",
    );
  } finally {
    server.close();
  }
});

test("includes remediation hint about --port flag", async () => {
  const server = await occupyPort(0);
  const { port } = server.address();
  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, "-p", String(port)],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.match(result.stderr, /--port/, "should suggest --port flag");
  } finally {
    server.close();
  }
});

test("does not mention port conflict when port is free (--help still works)", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "--help"],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr || "", /port.*in use/i);
});
