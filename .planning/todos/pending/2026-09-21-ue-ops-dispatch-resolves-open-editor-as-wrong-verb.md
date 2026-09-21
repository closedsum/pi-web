---
created: 2026-09-21T17:40:00.000Z
title: ue_ops_dispatch resolves "open editor" as wrong verb
area: tooling
files:
  - ~/.claude/get-shit-done/bin/ue/ue_ops_dispatch.py
  - ~/.pi/agent/extensions/gsd-ue-dispatch.ts
---

## Problem

`ue_ops_dispatch.py` resolves intent "open the Unreal Editor for CropoutSampleProject" as CsMCP verb `open` (requires a running editor on port 8090) instead of `launch` (starts UnrealEditor.exe with the .uproject). Opening the editor doesn't need CsMCP — it should use the global launch script. The planner model (gpt-5.6-luna) picks the wrong verb.

This blocks pi-web orchestrator mode from launching editors since bash/powershell are gated and the model can only use `ue_dispatch`.

## Solution

`ue_dispatch` should route "open editor" / "launch editor" intents to the global editor launch script (`ue-launch-csmcp.py` or a simpler non-CsMCP launcher). The dispatcher's verb resolution or fallback logic needs to handle the case where no editor is running — instead of reporting `no_editor`, it should launch one.
