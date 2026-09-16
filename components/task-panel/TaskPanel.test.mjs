import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TaskPanel } = await jiti.import("./TaskPanel.tsx");

test("TaskPanel renders 'No project selected' when cwd is null", () => {
  const html = renderToStaticMarkup(createElement(TaskPanel, { cwd: null }));
  assert.match(html, /No project selected/);
  assert.match(html, /Tasks/);
});

test("TaskPanel renders the header with Tasks label", () => {
  const html = renderToStaticMarkup(createElement(TaskPanel, { cwd: null }));
  assert.match(html, />Tasks</);
});

test("TaskPanel renders a refresh button", () => {
  const html = renderToStaticMarkup(createElement(TaskPanel, { cwd: null }));
  assert.match(html, /title="Refresh"/);
});
