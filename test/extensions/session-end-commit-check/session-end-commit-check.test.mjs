import assert from "node:assert/strict";
import test from "node:test";

const SESSION_END_RE = /^(?:\/quit|\/exit|bye|goodbye|done|done for now|i'm done|stop|end session|wrap up|that's it|that's all|signing off|gotta go|all done|session over)\s*[.!]?\s*$/i;

function handleInput(prompt, state = {}) {
  if (!SESSION_END_RE.test(prompt.trim())) return undefined;
  if (!state.uncommittedFiles?.length) return undefined;
  const fileList = state.uncommittedFiles.slice(0, 10).join(", ");
  const extra = state.uncommittedFiles.length > 10 ? ` (+${state.uncommittedFiles.length - 10} more)` : "";
  return {
    inject: `[SESSION-END] ${state.uncommittedFiles.length} uncommitted file(s) detected: ${fileList}${extra}. Commit or stash before ending.`,
  };
}

test("warns on session end with uncommitted files", () => {
  const result = handleInput("done", { uncommittedFiles: ["src/main.ts", "lib/util.ts"] });
  assert.ok(result?.inject);
  assert.match(result.inject, /SESSION-END/);
  assert.match(result.inject, /2 uncommitted/);
});

test("warns on /quit with uncommitted files", () => {
  const result = handleInput("/quit", { uncommittedFiles: ["file.ts"] });
  assert.ok(result?.inject);
});

test("does not warn without session end keywords", () => {
  assert.equal(handleInput("fix the bug", { uncommittedFiles: ["file.ts"] }), undefined);
});

test("does not warn when no uncommitted files", () => {
  assert.equal(handleInput("done", { uncommittedFiles: [] }), undefined);
});

test("truncates file list over 10 files", () => {
  const files = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
  const result = handleInput("bye", { uncommittedFiles: files });
  assert.match(result.inject, /\+5 more/);
});

test("handles case variations", () => {
  assert.ok(handleInput("Done!", { uncommittedFiles: ["f.ts"] }));
  assert.ok(handleInput("BYE", { uncommittedFiles: ["f.ts"] }));
  assert.ok(handleInput("session over", { uncommittedFiles: ["f.ts"] }));
});
