import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { checkPortAvailable } = require("../bin/port-check.js");

function listenOnFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => resolve(server));
    server.on("error", reject);
  });
}

// --- free-port path (ECONNREFUSED → resolve) ---

test("resolves when nothing is listening on the port", async () => {
  const server = await listenOnFreePort();
  const { port } = server.address();
  server.close();
  await new Promise((r) => server.on("close", r));
  await assert.doesNotReject(checkPortAvailable(port, "127.0.0.1"));
});

// --- occupied-port path (connect succeeds → reject EADDRINUSE) ---

test("rejects with EADDRINUSE when a server is listening", async () => {
  const server = await listenOnFreePort();
  const { port } = server.address();
  try {
    await assert.rejects(
      checkPortAvailable(port, "127.0.0.1"),
      (err) => {
        assert.equal(err.code, "EADDRINUSE");
        assert.match(err.message, /port.*in use/i);
        assert.match(err.message, new RegExp(String(port)));
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("rejects with EADDRINUSE when bound to the same host", async () => {
  const server = await listenOnFreePort("127.0.0.1");
  const { port } = server.address();
  try {
    await assert.rejects(
      checkPortAvailable(port, "127.0.0.1"),
      { code: "EADDRINUSE" },
    );
  } finally {
    server.close();
  }
});

// --- error message quality ---

test("includes the port number and remediation hint in the error", async () => {
  const server = await listenOnFreePort();
  const { port } = server.address();
  try {
    await assert.rejects(
      checkPortAvailable(port, "127.0.0.1"),
      (err) => {
        assert.match(err.message, new RegExp(String(port)));
        assert.match(err.message, /--port/);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

// --- timeout path ---

test("resolves on timeout when connection neither succeeds nor refuses", async () => {
  const start = Date.now();
  await checkPortAvailable(1, "192.0.2.1", 200);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 150, `resolved too fast (${elapsed}ms), timeout may not have fired`);
  assert.ok(elapsed < 2000, `took ${elapsed}ms, expected ~200ms timeout`);
});

// --- timing ---

test("completes quickly when the port is free", async () => {
  const server = await listenOnFreePort();
  const { port } = server.address();
  server.close();
  await new Promise((r) => server.on("close", r));
  const start = Date.now();
  await checkPortAvailable(port, "127.0.0.1");
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `port check took ${elapsed}ms, expected < 1000ms`);
});

test("completes quickly when the port is occupied", async () => {
  const server = await listenOnFreePort();
  const { port } = server.address();
  try {
    const start = Date.now();
    await checkPortAvailable(port, "127.0.0.1").catch(() => {});
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `port check took ${elapsed}ms, expected < 1000ms`);
  } finally {
    server.close();
  }
});
