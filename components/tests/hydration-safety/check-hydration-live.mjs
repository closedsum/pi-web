import { execSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";

const PORT = 4174;
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return true;
    } catch {}
    await delay(1000);
  }
  return false;
}

async function main() {
  console.log("Starting dev server on port", PORT);
  const server = spawn("cmd.exe", ["/c", `npx next dev --turbopack --port ${PORT}`], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const serverStderr = [];
  server.stderr?.on("data", (c) => serverStderr.push(c.toString()));

  try {
    const ready = await waitForServer(PORT, 60_000);
    if (!ready) { console.log("FAIL: Server did not start"); process.exit(1); }
    console.log("Server ready. Launching Playwright browser...");

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle", timeout: 30_000 });
    await delay(3000);

    await browser.close();

    const hydrationErrors = consoleErrors.filter((e) =>
      e.includes("Hydration failed") ||
      e.includes("server rendered HTML didn't match") ||
      e.includes("There was an error while hydrating") ||
      e.includes("Minified React error #418") ||
      e.includes("Minified React error #423") ||
      e.includes("Minified React error #425")
    );

    if (hydrationErrors.length > 0) {
      console.log("\nFAIL: Hydration errors detected:");
      for (const e of hydrationErrors) console.log("  -", e);
      console.log("\nAll console errors:");
      for (const e of consoleErrors) console.log("  -", e.slice(0, 200));
      process.exit(1);
    }

    console.log("PASS: No hydration errors.");
    if (consoleErrors.length > 0) {
      console.log(`(${consoleErrors.length} non-hydration console errors — may be expected)`);
    }
  } finally {
    try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" }); } catch {}
    await delay(500);
  }
}

main().catch((e) => { console.error("Script error:", e.message); process.exit(1); });
