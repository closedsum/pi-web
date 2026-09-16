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

describe("SidebarExtensions", () => {
  describe("visibility", () => {
    it("renders nothing when widgets array is empty", () => {
      const html = render({ widgets: [] });
      assert.equal(html, "");
    });

    it("renders section when widgets are present", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.ok(html.length > 0, "expected non-empty output");
    });
  });

  describe("header", () => {
    it("renders header with Extensions label", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /Extensions/i);
    });

    it("shows widget count badge", () => {
      const html = render({ widgets: [makeWidget("a"), makeWidget("b")] });
      assert.match(html, /2/);
    });

    it("renders chevron icon", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /<svg/);
      assert.match(html, /polyline/);
    });
  });

  describe("expand/collapse", () => {
    it("starts expanded by default (no storage)", () => {
      const html = render({ widgets: [makeWidget("a")], storage: null });
      assert.match(html, /a-line-1/);
    });

    it("starts collapsed when storage says false", () => {
      const storage = makeStorage({ [STORAGE_KEY]: "false" });
      const html = render({ widgets: [makeWidget("a")], storage });
      assert.doesNotMatch(html, /a-line-1/);
    });

    it("starts expanded when storage says true", () => {
      const storage = makeStorage({ [STORAGE_KEY]: "true" });
      const html = render({ widgets: [makeWidget("a")], storage });
      assert.match(html, /a-line-1/);
    });

    it("chevron rotated when expanded", () => {
      const html = render({ widgets: [makeWidget("a")], storage: null });
      assert.match(html, /rotate\(90deg\)/);
    });

    it("chevron not rotated when collapsed", () => {
      const storage = makeStorage({ [STORAGE_KEY]: "false" });
      const html = render({ widgets: [makeWidget("a")], storage });
      assert.doesNotMatch(html, /rotate\(90deg\)/);
    });
  });

  describe("content rendering", () => {
    it("renders widget content via ExtensionWidgets when expanded", () => {
      const html = render({ widgets: [makeWidget("a", 2)] });
      assert.match(html, /a-line-1/);
      assert.match(html, /a-line-2/);
    });

    it("renders multiple widgets", () => {
      const html = render({ widgets: [makeWidget("a"), makeWidget("b")] });
      assert.match(html, /a-line-1/, "first widget content visible (expanded by default)");
      assert.match(html, /widget-key">b</, "second widget trigger present");
    });

    it("scrollable container has overflow-y auto", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /overflow-y:\s*auto/i);
    });
  });

  describe("border styling", () => {
    it("has top border separator", () => {
      const html = render({ widgets: [makeWidget("a")] });
      assert.match(html, /border-top/);
    });
  });

  describe("widget permutations", () => {
    for (const count of [1, 2, 5]) {
      for (const startOpen of [true, false]) {
        const label = `${count} widget(s), startOpen=${startOpen}`;
        it(label, () => {
          const widgets = Array.from({ length: count }, (_, i) => makeWidget(`w${i}`));
          const storage = startOpen ? null : makeStorage({ [STORAGE_KEY]: "false" });
          const html = render({ widgets, storage });
          if (startOpen) {
            assert.match(html, /w0-line-1/, "expanded: first widget content visible");
          } else {
            assert.doesNotMatch(html, /w0-line-1/, "collapsed: widget content hidden");
          }
          assert.match(html, new RegExp(String(count)), `badge shows count ${count}`);
        });
      }
    }
  });

  describe("placement variants", () => {
    for (const placement of ["aboveEditor", "belowEditor"]) {
      it(`renders widget with placement=${placement}`, () => {
        const html = render({ widgets: [makeWidget("p", 2, placement)] });
        assert.match(html, /p-line-1/);
      });
    }
  });
});
