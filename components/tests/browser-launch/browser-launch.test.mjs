import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const TEMP_PROFILE = join(FIXTURES_DIR, "test-devprofile");
const TEMP_BAT = join(FIXTURES_DIR, "test-pi.bat");

test("pi.bat wipes browser profile directory before launch", () => {
  mkdirSync(TEMP_PROFILE, { recursive: true });
  writeFileSync(join(TEMP_PROFILE, "stale-cache.txt"), "should be deleted");
  assert.ok(existsSync(join(TEMP_PROFILE, "stale-cache.txt")), "precondition: stale file exists");

  const batContent = [
    "@echo off",
    `set "PI_BROWSER_PROFILE=${TEMP_PROFILE}"`,
    `if exist "%PI_BROWSER_PROFILE%" rmdir /s /q "%PI_BROWSER_PROFILE%"`,
    `mkdir "%PI_BROWSER_PROFILE%"`,
    `echo clean > "%PI_BROWSER_PROFILE%\\marker.txt"`,
  ].join("\r\n");
  writeFileSync(TEMP_BAT, batContent);

  execSync(`cmd.exe /c "${TEMP_BAT}"`, { stdio: "ignore", timeout: 10_000 });

  assert.ok(!existsSync(join(TEMP_PROFILE, "stale-cache.txt")), "stale cache must be wiped");
  assert.ok(existsSync(join(TEMP_PROFILE, "marker.txt")), "fresh profile directory must be created");
  const marker = readFileSync(join(TEMP_PROFILE, "marker.txt"), "utf8").trim();
  assert.strictEqual(marker, "clean", "marker must confirm fresh state");
});

test("pi.bat works when profile directory does not exist", () => {
  if (existsSync(TEMP_PROFILE)) rmSync(TEMP_PROFILE, { recursive: true, force: true });
  assert.ok(!existsSync(TEMP_PROFILE), "precondition: profile dir absent");

  const batContent = [
    "@echo off",
    `set "PI_BROWSER_PROFILE=${TEMP_PROFILE}"`,
    `if exist "%PI_BROWSER_PROFILE%" rmdir /s /q "%PI_BROWSER_PROFILE%"`,
    `mkdir "%PI_BROWSER_PROFILE%"`,
    `echo clean > "%PI_BROWSER_PROFILE%\\marker.txt"`,
  ].join("\r\n");
  writeFileSync(TEMP_BAT, batContent);

  execSync(`cmd.exe /c "${TEMP_BAT}"`, { stdio: "ignore", timeout: 10_000 });

  assert.ok(existsSync(join(TEMP_PROFILE, "marker.txt")), "profile directory must be created fresh");
});

test("debug port flag is present in pi.bat", () => {
  const bat = readFileSync(join(process.env.USERPROFILE || process.env.HOME, "pi.bat"), "utf8");
  assert.ok(bat.includes("--remote-debugging-port="), "pi.bat must set --remote-debugging-port");
  assert.ok(bat.includes("--user-data-dir="), "pi.bat must set --user-data-dir");
  assert.ok(bat.includes("rmdir /s /q"), "pi.bat must wipe profile before launch");
});

test("cleanup", () => {
  if (existsSync(TEMP_PROFILE)) rmSync(TEMP_PROFILE, { recursive: true, force: true });
  if (existsSync(TEMP_BAT)) rmSync(TEMP_BAT);
  if (existsSync(FIXTURES_DIR)) try { rmSync(FIXTURES_DIR, { recursive: true, force: true }); } catch {}
});
