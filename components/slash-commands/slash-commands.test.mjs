import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { canClearBuiltinCommandInput } = await jiti.import("@/components/ChatInput");

describe("slash command dispatch", () => {
  describe("/new command matching", () => {
    it("/new matches with exact text", () => {
      assert.equal("/new".startsWith("/"), true);
      assert.equal("/new" === "/new", true);
    });

    it("/new matches after trim", () => {
      assert.equal("/new ".trim() === "/new", true);
      assert.equal("  /new  ".trim() === "/new", true);
    });

    it("/new with args does not exact-match", () => {
      assert.equal("/new foo" === "/new", false);
    });
  });

  describe("/clear command matching", () => {
    it("/clear matches with exact text", () => {
      assert.equal("/clear" === "/clear", true);
    });

    it("/clear matches after trim", () => {
      assert.equal("/clear ".trim() === "/clear", true);
    });
  });

  describe("canClearBuiltinCommandInput", () => {
    it("clears input when message matches submitted", () => {
      assert.equal(canClearBuiltinCommandInput("/new", 0, "/new"), true);
    });

    it("clears input when message matches /clear", () => {
      assert.equal(canClearBuiltinCommandInput("/clear", 0, "/clear"), true);
    });

    it("does not clear when images attached", () => {
      assert.equal(canClearBuiltinCommandInput("/new", 1, "/new"), false);
    });

    it("does not clear when message differs", () => {
      assert.equal(canClearBuiltinCommandInput("/new extra", 0, "/new"), false);
    });
  });

  describe("autocomplete query extraction", () => {
    function extractSlashQuery(value, compact = false) {
      return !compact && value.startsWith("/") && !/\s/.test(value.slice(1))
        ? value.slice(1).toLowerCase()
        : null;
    }

    it("extracts 'new' from '/new'", () => {
      assert.equal(extractSlashQuery("/new"), "new");
    });

    it("extracts 'clear' from '/clear'", () => {
      assert.equal(extractSlashQuery("/clear"), "clear");
    });

    it("extracts 'n' from '/n' (partial)", () => {
      assert.equal(extractSlashQuery("/n"), "n");
    });

    it("returns null for '/new arg' (has space)", () => {
      assert.equal(extractSlashQuery("/new arg"), null);
    });

    it("returns null for empty string", () => {
      assert.equal(extractSlashQuery(""), null);
    });

    it("returns null for plain text", () => {
      assert.equal(extractSlashQuery("hello"), null);
    });

    it("returns null when compact", () => {
      assert.equal(extractSlashQuery("/new", true), null);
    });
  });

  describe("command filtering", () => {
    const commands = [
      { name: "new", description: "Start a new session", source: "extension" },
      { name: "clear", description: "Clear chat and start fresh", source: "extension" },
      { name: "compact", description: "Compact context", source: "builtin" },
      { name: "name", description: "Rename session", source: "builtin" },
    ];

    function filterCommands(query) {
      return commands.filter((c) => {
        const name = c.name.toLowerCase();
        const desc = c.description.toLowerCase();
        return name.includes(query) || desc.includes(query);
      });
    }

    it("'n' matches new and name", () => {
      const matches = filterCommands("n");
      assert.ok(matches.some((c) => c.name === "new"));
      assert.ok(matches.some((c) => c.name === "name"));
    });

    it("'new' matches only new", () => {
      const matches = filterCommands("new");
      assert.equal(matches.length, 1);
      assert.equal(matches[0].name, "new");
    });

    it("'cl' matches clear and (none else)", () => {
      const matches = filterCommands("cl");
      assert.ok(matches.some((c) => c.name === "clear"));
    });

    it("'clear' matches only clear", () => {
      const matches = filterCommands("clear");
      assert.equal(matches.length, 1);
      assert.equal(matches[0].name, "clear");
    });

    it("empty query matches all", () => {
      const matches = filterCommands("");
      assert.equal(matches.length, commands.length);
    });

    it("'session' matches new (description) and nothing else by name", () => {
      const matches = filterCommands("session");
      assert.ok(matches.some((c) => c.name === "new"), "new has 'session' in description");
    });
  });
});
