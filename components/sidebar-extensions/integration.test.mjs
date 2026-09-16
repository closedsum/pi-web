import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SidebarExtensions } = await jiti.import("./SidebarExtensions.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SidebarExtensions, props),
    ),
  );
}

function makeWidget(key, lineCount = 2, placement = "aboveEditor") {
  return {
    key,
    lines: Array.from({ length: lineCount }, (_, i) => `${key}-line-${i + 1}`),
    placement,
  };
}

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) { return store.get(k) ?? null; },
    setItem(k, v) { store.set(k, v); },
    _store: store,
  };
}

const STORAGE_KEY = "pi-web:sidebar-extensions:open";

describe("SidebarExtensions integration", () => {
  describe("widget lifecycle permutations", () => {
    const scenarios = [
      { name: "zero widgets", widgets: [], expectEmpty: true },
      { name: "one widget expanded", widgets: [makeWidget("a")], expectEmpty: false, expectContent: /a-line-1/ },
      { name: "three widgets", widgets: [makeWidget("x"), makeWidget("y"), makeWidget("z")], expectEmpty: false, expectContent: /x-line-1/ },
    ];

    for (const { name, widgets, expectEmpty, expectContent } of scenarios) {
      it(name, () => {
        const html = render({ widgets });
        if (expectEmpty) {
          assert.equal(html, "");
        } else {
          assert.ok(html.length > 0);
          if (expectContent) assert.match(html, expectContent);
        }
      });
    }
  });

  describe("storage x widget count matrix", () => {
    for (const storageState of ["open", "closed", "absent"]) {
      for (const widgetCount of [0, 1, 3]) {
        const label = `storage=${storageState}, widgets=${widgetCount}`;
        it(label, () => {
          const widgets = Array.from({ length: widgetCount }, (_, i) => makeWidget(`w${i}`));
          let storage;
          if (storageState === "open") storage = makeStorage({ [STORAGE_KEY]: "true" });
          else if (storageState === "closed") storage = makeStorage({ [STORAGE_KEY]: "false" });
          else storage = null;

          const html = render({ widgets, storage });

          if (widgetCount === 0) {
            assert.equal(html, "", `${label}: no output for empty widgets`);
            return;
          }

          assert.ok(html.length > 0, `${label}: non-empty output`);
          assert.match(html, /Extensions/i, `${label}: header present`);
          assert.match(html, new RegExp(String(widgetCount)), `${label}: badge shows count`);

          if (storageState === "closed") {
            assert.doesNotMatch(html, /w0-line-1/, `${label}: content hidden when closed`);
          } else {
            assert.match(html, /w0-line-1/, `${label}: content visible when open/absent`);
          }
        });
      }
    }
  });

  describe("mixed placement rendering", () => {
    it("renders widgets from different placements together", () => {
      const widgets = [
        makeWidget("above", 2, "aboveEditor"),
        makeWidget("below", 2, "belowEditor"),
      ];
      const html = render({ widgets });
      assert.match(html, /above-line-1/);
      assert.match(html, /widget-key">below</, "below widget trigger present");
    });
  });

  describe("accessibility", () => {
    it("section header is a button", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /<button/);
    });

    it("chevron is an SVG with polyline", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /<svg/);
      assert.match(html, /<polyline/);
    });

    it("scrollable content area has overflow-y auto", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /overflow-y:\s*auto/i);
    });
  });
});
