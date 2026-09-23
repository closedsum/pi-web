import { readFileSync } from "node:fs";

// GPT tier -> model ID, derived from lib/model-display.json so a model
// retirement is a single edit there rather than one per test file.
const { displayNames } = JSON.parse(
  readFileSync(new URL("../../lib/model-display.json", import.meta.url), "utf8"),
);

export const GPT = {
  sol: displayNames.sol,
  terra: displayNames.terra,
  luna: displayNames.luna,
  astra: displayNames.astra,
};
