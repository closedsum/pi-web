import assert from "node:assert/strict";

export const sidebarExtensionSource = `export default function (pi) {
  pi.registerCommand("e2e-sidebar-widget", {
    handler: async (mode, ctx) => {
      if (mode === "set") {
        ctx.ui.setWidget("e2e-sidebar", ["Task 1: done", "Task 2: pending", "Task 3: in progress"], {
          placement: "aboveEditor",
        });
        ctx.ui.notify("Widget set");
      } else if (mode === "update") {
        ctx.ui.setWidget("e2e-sidebar", ["Task 1: done", "Task 2: done", "Task 3: done"], {
          placement: "aboveEditor",
        });
        ctx.ui.notify("Widget updated");
      } else if (mode === "clear") {
        ctx.ui.setWidget("e2e-sidebar", undefined);
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
  const extensionsHeader = page.getByRole("button", { name: /^Extensions/ });
  assert.equal(await extensionsHeader.count(), 0, "Extensions section hidden without widgets");

  // 2. Set a widget — Extensions section appears in sidebar
  await sendCommand("set");
  await waitForNotice("Widget set");
  await extensionsHeader.waitFor({ timeout: 5000 });
  assert.ok(await extensionsHeader.isVisible(), "Extensions header visible after setWidget");

  // 3. Verify widget content is rendered
  await page.getByText("Task 1: done", { exact: false }).waitFor({ timeout: 5000 });

  // 4. Verify badge shows count (the button text includes the count span)
  const headerText = await extensionsHeader.textContent();
  assert.match(headerText ?? "", /Extensions\s*1/, "Badge shows widget count");

  // 5. Screenshot
  await page.screenshot({ path: `${artifacts}/sidebar-extensions-visible.png` });

  // 6. Update widget — content changes (reactivity)
  await sendCommand("update");
  await waitForNotice("Widget updated");
  await page.getByText("Task 3: done", { exact: false }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${artifacts}/sidebar-extensions-updated.png` });

  // 7. Clear widget — Extensions section disappears
  await sendCommand("clear");
  await waitForNotice("Widget cleared");
  await extensionsHeader.waitFor({ state: "hidden", timeout: 5000 });
  assert.equal(await extensionsHeader.count(), 0, "Extensions section hidden after removeWidget");

  await page.screenshot({ path: `${artifacts}/sidebar-extensions-cleared.png` });
}
