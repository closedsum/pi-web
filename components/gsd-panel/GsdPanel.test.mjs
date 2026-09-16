import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { GsdPanel } = await jiti.import("./GsdPanel.tsx");

test("GsdPanel renders 'No project selected' when cwd is null", () => {
  const html = renderToStaticMarkup(createElement(GsdPanel, { cwd: null }));
  assert.match(html, /No project selected/);
  assert.match(html, /Tasks/);
});

test("GsdPanel renders the header with Tasks label", () => {
  const html = renderToStaticMarkup(createElement(GsdPanel, { cwd: null }));
  assert.match(html, />Tasks</);
});

test("GsdPanel renders a refresh button", () => {
  const html = renderToStaticMarkup(createElement(GsdPanel, { cwd: null }));
  assert.match(html, /title="Refresh"/);
});
