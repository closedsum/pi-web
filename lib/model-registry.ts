import config from "./model-display.json";

export const MODEL_FAMILY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(config.families).map(([name, def]) => [name, def.color]),
);

const FAMILY_FALLBACK_COLOR = config.fallbackColor;

const FAMILY_PATTERNS: Array<[RegExp, string]> = Object.entries(config.families).map(
  ([name, def]) => [new RegExp(`^(${def.prefixes.join("|")})`, "i"), name],
);

export const MODEL_DISPLAY_MAP: Record<string, string> = config.displayNames;

export const TAG_COLORS = config.tagColors;

export function getModelFamily(model: string): string | undefined {
  const m = model.toLowerCase();
  for (const [pattern, family] of FAMILY_PATTERNS) {
    if (pattern.test(m)) return family;
  }
  return undefined;
}

export function getModelFamilyColor(model: string): string {
  const family = getModelFamily(model);
  return family ? (MODEL_FAMILY_COLORS[family] ?? FAMILY_FALLBACK_COLOR) : FAMILY_FALLBACK_COLOR;
}

export function resolveModelDisplayName(model: string): string {
  return MODEL_DISPLAY_MAP[model] ?? model;
}
