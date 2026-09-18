import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkRecentProjectsDropdown(page, artifacts) {
  const btn = page.locator('button[aria-label="Recent projects"]');
  if (await btn.count() === 0) return;

  // Open the dropdown
  await btn.first().click();
  await page.waitForTimeout(300);

  const heading = page.locator("text=Recent Projects").first();
  await heading.waitFor({ state: "visible", timeout: 3000 });

  const box = await heading.boundingBox();
  assert.ok(box, "Recent Projects dropdown heading must have a bounding box");

  const viewport = page.viewportSize();
  assert.ok(box.x >= 0, `Dropdown left edge (${box.x}px) must not be off-screen`);
  assert.ok(
    box.x + box.width <= viewport.width,
    `Dropdown right edge (${box.x + box.width}px) must not exceed viewport width (${viewport.width}px)`,
  );
  assert.ok(box.y >= 0, `Dropdown top edge (${box.y}px) must not be off-screen`);

  await page.screenshot({ path: join(artifacts, `recent-projects-dropdown-${viewport.width}.png`) });

  // Close by clicking the same button (toggle)
  await btn.first().click();
  await page.waitForTimeout(300);

  // Re-open and verify positioning is stable
  await btn.first().click();
  await page.waitForTimeout(300);

  if (await heading.isVisible()) {
    const box2 = await heading.boundingBox();
    assert.ok(box2, "Dropdown must reappear on re-open");
    assert.ok(box2.x >= 0, `Re-open: left edge (${box2.x}px) must stay in viewport`);
    assert.ok(
      box2.x + box2.width <= viewport.width,
      `Re-open: right edge must stay in viewport`,
    );
  }

  // Close for next test
  await btn.first().click();
  await page.waitForTimeout(200);

  console.log("PASS: recent projects dropdown stays in viewport");
}
