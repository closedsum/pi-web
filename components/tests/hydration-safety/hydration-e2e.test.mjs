import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 4173;
const STARTUP_TIMEOUT_MS = 60_000;
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return;
    } catch {}
    await delay(1000);
  }
  throw new Error(`Server did not start on port ${port} within ${timeoutMs}ms`);
}

test("no hydration errors on initial page load", async () => {
  const server = spawn("cmd.exe", ["/c", "npx next start --port " + PORT], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = [];
  server.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));

  try {
    await waitForServer(PORT, STARTUP_TIMEOUT_MS);

    const res = await fetch(`http://localhost:${PORT}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { "Accept": "text/html" },
    });
    const html = await res.text();

    const hydrationPatterns = [
      "Hydration failed",
      "server rendered HTML didn't match",
      "There was an error while hydrating",
      "Minified React error #418",
      "Minified React error #423",
      "Minified React error #425",
    ];

    const stderrText = stderr.join("");
    for (const pattern of hydrationPatterns) {
      assert.ok(
        !html.includes(pattern) && !stderrText.includes(pattern),
        `Hydration error detected: "${pattern}"`,
      );
    }
  } finally {
    try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" }); } catch {}
    await delay(500);
  }
});
