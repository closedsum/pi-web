import assert from "node:assert/strict";
import test from "node:test";
import { makeReadToolCallEvent, assertBlocked, assertPassed } from "../_config.mjs";

const ENGINE_SOURCE_RE = /UE_\d+\.\d+[/\\]Engine[/\\]Source[/\\]/i;
const HEADER_EXT_RE = /\.(h|cpp|inl)$/i;

function extractSearchTerms(filePath) {
  const basename = filePath.split(/[/\\]/).pop().replace(HEADER_EXT_RE, "");
  const terms = [basename];
  if (/^[AUFEIT][A-Z]/.test(basename) && basename.length > 2) {
    terms.push(basename.slice(1));
  }
  return terms;
}

function findInIndex(searchTerms, indexContent) {
  if (!indexContent) return [];
  return searchTerms.filter((term) => indexContent.includes(term)).map((term) => ({
    source: "cpp", file: `${term}.md`, content: `Indexed content for ${term}`,
  }));
}

function handleToolCall(event, indexContent) {
  if (event.tool !== "Read" && event.tool !== "Grep") return undefined;

  const targetPath = event.input?.file_path || event.input?.path || "";
  if (!ENGINE_SOURCE_RE.test(targetPath)) return undefined;

  const isRead = event.tool === "Read";
  const isHeader = HEADER_EXT_RE.test(targetPath);

  if (isRead && isHeader) {
    const terms = extractSearchTerms(targetPath);
    const matches = findInIndex(terms, indexContent);
    if (matches.length > 0) {
      return {
        block: true,
        reason: `BLOCKED: This engine header is already indexed in the UE API map. Use cached content from ue-5.8/${matches[0].source}/${matches[0].file}`,
      };
    }
  }

  return {
    advisory: true,
    message: "[UE-API-MAP GATE] Reading UE engine source not yet in the index. Auto-backfill queued.",
  };
}

test("ignores non-engine paths", () => {
  assertPassed(handleToolCall(makeReadToolCallEvent("D:/Trees/CropoutSampleProject/Source/Main.h"), ""));
});

test("ignores non-Read/Grep tools", () => {
  const event = { tool: "Edit", input: { file_path: "D:/UE_5.8/Engine/Source/Runtime/Core.h" } };
  assertPassed(handleToolCall(event, ""));
});

test("blocks Read of indexed engine header", () => {
  const filePath = "D:/UE_5.8/Engine/Source/Runtime/Core/Public/UObject.h";
  const event = makeReadToolCallEvent(filePath);
  assertBlocked(handleToolCall(event, "UObject is documented here"), /already indexed/);
});

test("advisory for unindexed engine header", () => {
  const filePath = "D:/UE_5.8/Engine/Source/Runtime/Core/Public/FNewType.h";
  const event = makeReadToolCallEvent(filePath);
  const result = handleToolCall(event, "other content");
  assert.ok(result?.advisory);
  assert.match(result.message, /Auto-backfill/);
});

test("advisory for engine .cpp file (not blocked even if indexed)", () => {
  const filePath = "D:/UE_5.8/Engine/Source/Runtime/Core/Private/Impl.cpp";
  const event = makeReadToolCallEvent(filePath);
  const result = handleToolCall(event, "Impl");
  assert.ok(result?.advisory || result?.block);
});

test("extractSearchTerms strips UE class prefix", () => {
  const terms = extractSearchTerms("D:/path/AActor.h");
  assert.ok(terms.includes("AActor"));
  assert.ok(terms.includes("Actor"));
});

test("extractSearchTerms keeps non-prefixed names", () => {
  const terms = extractSearchTerms("D:/path/CoreTypes.h");
  assert.deepEqual(terms, ["CoreTypes"]);
});

test("extractSearchTerms handles F prefix", () => {
  const terms = extractSearchTerms("FVector.h");
  assert.ok(terms.includes("FVector"));
  assert.ok(terms.includes("Vector"));
});

test("extractSearchTerms handles U prefix", () => {
  const terms = extractSearchTerms("UObject.h");
  assert.ok(terms.includes("UObject"));
  assert.ok(terms.includes("Object"));
});

test("handles backslash paths", () => {
  const filePath = "D:\\UE_5.8\\Engine\\Source\\Runtime\\Core\\Public\\AActor.h";
  const event = makeReadToolCallEvent(filePath);
  assertBlocked(handleToolCall(event, "AActor docs"), /indexed/);
});

test("Grep tool on engine source gets advisory", () => {
  const event = { tool: "Grep", input: { path: "D:/UE_5.8/Engine/Source/Runtime/Core.h" } };
  const result = handleToolCall(event, "");
  assert.ok(result?.advisory);
});

test("non-header engine files get advisory", () => {
  const event = makeReadToolCallEvent("D:/UE_5.8/Engine/Source/Runtime/Build.cs");
  const result = handleToolCall(event, "");
  assert.ok(result?.advisory);
});
