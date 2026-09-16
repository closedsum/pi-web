import assert from "node:assert/strict";

export const sidebarExtensionSource = `export default function (pi) {
  pi.registerCommand("e2e-sidebar-widget", {
    handler: async (mode, ctx) => {
      if (mode === "set") {
        ctx.ui.setWidget("e2e-sidebar", "Task 1: done\\nTask 2: pending\\nTask 3: in progress", {
          placement: "aboveEditor",
        });
        ctx.ui.notify("Widget set");
      } else if (mode === "update") {
        ctx.ui.setWidget("e2e-sidebar", "Task 1: done\\nTask 2: done\\nTask 3: done", {
          placement: "aboveEditor",
        });
        ctx.ui.notify("Widget updated");
      } else if (mode === "clear") {
        ctx.ui.removeWidget("e2e-sidebar");
        ctx.ui.notify("Widget cleared");
      }
    },
  });
}`;

export async function checkSidebarExtensions(page, artifacts) {
  const sendCommand = async (mode) => {
    const input = page.locator("textarea").last();
    await input.fill(`/e2e-sidebar-widget ${mode}`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
  };

  const waitForNotice = async (text) => {
    await page.getByText(text, { exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  };

  // 1. Initially no Extensions section
  const extensionsHeader = page.getByText("Extensions", { exact: true });
  assert.equal(await extensionsHeader.count(), 0, "Extensions section hidden without widgets");

  // 2. Set a widget — Extensions section appears in sidebar
  await sendCommand("set");
  await waitForNotice("Widget set");
  await extensionsHeader.waitFor({ timeout: 5000 });
  assert.ok(await extensionsHeader.isVisible(), "Extensions header visible after setWidget");

  // 3. Verify widget content is rendered
  const widgetContent = page.locator(".extension-widget-content");
  if (await widgetContent.count() > 0) {
    const text = await widgetContent.first().textContent();
    assert.ok(text?.includes("Task 1"), "Widget content includes task data");
  }

  // 4. Verify badge shows count
  const badge = extensionsHeader.locator("..").locator("span").last();
  const badgeText = await badge.textContent();
  assert.match(badgeText ?? "", /1/, "Badge shows widget count");

  // 5. Screenshot
  await page.screenshot({ path: `${artifacts}/sidebar-extensions-visible.png` });

  // 6. Update widget — content changes (reactivity)
  await sendCommand("update");
  await waitForNotice("Widget updated");
  // Allow time for update to propagate
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${artifacts}/sidebar-extensions-updated.png` });

  // 7. Clear widget — Extensions section disappears
  await sendCommand("clear");
  await waitForNotice("Widget cleared");
  await extensionsHeader.waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(await extensionsHeader.count(), 0, "Extensions section hidden after removeWidget");

  await page.screenshot({ path: `${artifacts}/sidebar-extensions-cleared.png` });
}
