---
created: 2026-09-21T15:44:35.975Z
title: Fix MiniMax model prefix in model-registry
area: lib
files:
  - lib/model-registry.ts
  - lib/model-registry.test.mjs
  - lib/model-display.json
---

## Problem

`model-registry.test.mjs` fails: "family minimax is not reachable via any known model prefix". Introduced by commit a93fe9e (feat: add MiniMax M3 provider and model family color). The `model-display.json` has a `minimax` family entry but `model-registry.ts` `getModelFamily()` has no prefix pattern that matches MiniMax model IDs (e.g. `MiniMax-M3`).

## Solution

Add the MiniMax prefix to the `MODEL_PREFIXES` array in `model-registry.ts` so `getModelFamily()` resolves MiniMax models to the `minimax` family correctly.
