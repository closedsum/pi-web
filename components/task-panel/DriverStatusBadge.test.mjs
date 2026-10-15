import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatHeartbeatAge } = await jiti.import("../../lib/lane-driver-poller.ts");

describe("formatHeartbeatAge", () => {
  test("null returns null", () => {
    assert.equal(formatHeartbeatAge(null), null);
  });

  test("negative returns null", () => {
    assert.equal(formatHeartbeatAge(-1), null);
  });

  test("0ms returns '0s'", () => {
    assert.equal(formatHeartbeatAge(0), "0s");
  });

  test("5000ms returns '5s'", () => {
    assert.equal(formatHeartbeatAge(5000), "5s");
  });

  test("59999ms rounds to '60s'", () => {
    assert.equal(formatHeartbeatAge(59999), "60s");
  });

  test("60000ms returns '1m'", () => {
    assert.equal(formatHeartbeatAge(60000), "1m");
  });

  test("3599999ms returns '59m'", () => {
    assert.equal(formatHeartbeatAge(3599999), "59m");
  });

  test("3600000ms returns '1h'", () => {
    assert.equal(formatHeartbeatAge(3600000), "1h");
  });

  test("7200000ms returns '2h'", () => {
    assert.equal(formatHeartbeatAge(7200000), "2h");
  });
});
