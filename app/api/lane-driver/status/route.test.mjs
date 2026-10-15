import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const routeModule = await jiti.import("./route.ts");
const { GET, dynamic } = routeModule;

function makeRequest(params = {}) {
  const url = new URL("http://localhost/api/lane-driver/status");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  req.nextUrl = url;
  return req;
}

describe("lane-driver status route", () => {
  test("exports force-dynamic", () => {
    assert.equal(dynamic, "force-dynamic");
  });

  test("exports GET handler", () => {
    assert.equal(typeof GET, "function");
  });

  test("missing cwd returns 400 with unknown status", async () => {
    const res = await GET(makeRequest());
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.status, "unknown");
    assert.equal(body.reason, "invalid-cwd");
  });

  test("relative cwd returns 400", async () => {
    const res = await GET(makeRequest({ cwd: "relative/path" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.reason, "invalid-cwd");
  });

  test("cache-control header is no-store on all responses", async () => {
    const res = await GET(makeRequest());
    const cc = res.headers.get("Cache-Control");
    assert.ok(cc && cc.includes("no-store"), `Expected no-store, got: ${cc}`);
  });

  test("reason field uses closed enum values only", async () => {
    const VALID_REASONS = new Set([
      "no_lock_file",
      "v1_signal_zero",
      "v1_pid_dead",
      "pid_dead",
      "heartbeat_stale",
      "v2_identity_verified",
      "unknown_error",
      "invalid-cwd",
      "access-denied",
      "internal-error",
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    assert.ok(
      VALID_REASONS.has(body.reason),
      `Reason "${body.reason}" not in closed enum`,
    );
  });
});
