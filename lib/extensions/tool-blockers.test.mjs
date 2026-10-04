import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ALL_RULES,
  evaluateBlockRules,
  blockBashPython,
  blockBroadUeKill,
  blockDirectConsoleHttp,
  blockDirectEditorLaunch,
  blockForkPush,
  blockLaunchPortOverride,
  blockLivecoding,
  blockMonitorKillSignal,
  blockPsUtf8Bom,
  blockRawUeConsole,
  blockResearchFork,
  blockSendFeedback,
  blockStandaloneUeBypass,
  blockUePythonProbe,
  blockUeRotatorPositional,
  denyJunctionSurgery,
} = await jiti.import("./tool-blockers.ts");

function blocked(rule, toolName, input) {
  const r = rule.test(toolName, input ?? {});
  assert.ok(r?.block, `Expected ${rule.name} to block ${toolName}`);
  return r;
}

function allowed(rule, toolName, input) {
  const r = rule.test(toolName, input ?? {});
  assert.ok(!r?.block, `Expected ${rule.name} to allow ${toolName}`);
}

// -- Individual rule tests --

describe("blockBashPython", () => {
  test("blocks python -c in Bash", () => {
    blocked(blockBashPython, "Bash", { command: 'python -c "print(1)"' });
  });
  test("allows python script.py", () => {
    allowed(blockBashPython, "Bash", { command: "python script.py" });
  });
  test("ignores non-Bash tools", () => {
    allowed(blockBashPython, "PowerShell", { command: 'python -c "x"' });
  });
});

describe("blockBroadUeKill", () => {
  test("blocks broad taskkill /im UnrealEditor", () => {
    blocked(blockBroadUeKill, "Bash", { command: 'taskkill /im UnrealEditor-Win64.exe /f' });
  });
  test("allows PID-targeted kill", () => {
    allowed(blockBroadUeKill, "Bash", { command: "taskkill /pid 12345 /f" });
  });
  test("allows in PowerShell too", () => {
    blocked(blockBroadUeKill, "PowerShell", { command: 'taskkill /im "UnrealEditor.exe" /f' });
  });
});

describe("blockDirectConsoleHttp", () => {
  test("blocks curl to /remote/", () => {
    blocked(blockDirectConsoleHttp, "Bash", { command: "curl localhost:30020/remote/object/call" });
  });
  test("blocks Invoke-WebRequest to /remote/", () => {
    blocked(blockDirectConsoleHttp, "PowerShell", { command: "Invoke-WebRequest localhost:30020/remote/exec" });
  });
  test("allows curl to other endpoints", () => {
    allowed(blockDirectConsoleHttp, "Bash", { command: "curl localhost:3000/api/health" });
  });
});

describe("blockDirectEditorLaunch", () => {
  test("blocks direct UnrealEditor.exe", () => {
    blocked(blockDirectEditorLaunch, "Bash", { command: 'D:\\UE\\UnrealEditor-Win64.exe "project.uproject"' });
  });
  test("allows ue_action.py launch", () => {
    allowed(blockDirectEditorLaunch, "Bash", { command: "python ue_action.py launch" });
  });
});

describe("blockForkPush", () => {
  test("blocks git push", () => {
    blocked(blockForkPush, "Bash", { command: "git push origin main" });
  });
  test("allows git pull", () => {
    allowed(blockForkPush, "Bash", { command: "git pull origin main" });
  });
});

describe("blockLaunchPortOverride", () => {
  test("blocks --port on ue_action.py launch", () => {
    blocked(blockLaunchPortOverride, "Bash", { command: "python ue_action.py launch --port 9999" });
  });
  test("allows launch without --port", () => {
    allowed(blockLaunchPortOverride, "Bash", { command: "python ue_action.py launch" });
  });
});

describe("blockLivecoding", () => {
  test("blocks LiveCoding commands", () => {
    blocked(blockLivecoding, "Bash", { command: "LiveCoding.Compile" });
  });
  test("allows unrelated commands", () => {
    allowed(blockLivecoding, "Bash", { command: "npm run build" });
  });
});

describe("blockMonitorKillSignal", () => {
  test("blocks killing monitor python processes", () => {
    blocked(blockMonitorKillSignal, "Bash", { command: "taskkill /f /im python.exe # monitor" });
  });
  test("allows killing non-monitor processes", () => {
    allowed(blockMonitorKillSignal, "Bash", { command: "taskkill /f /pid 12345" });
  });
});

describe("blockPsUtf8Bom", () => {
  test("blocks Out-File without utf8NoBOM", () => {
    blocked(blockPsUtf8Bom, "PowerShell", { command: '"text" | Out-File script.py' });
  });
  test("allows Out-File with utf8NoBOM", () => {
    allowed(blockPsUtf8Bom, "PowerShell", { command: '"text" | Out-File -Encoding utf8NoBOM script.py' });
  });
  test("ignores non-PowerShell", () => {
    allowed(blockPsUtf8Bom, "Bash", { command: 'echo "text" > script.py' });
  });
});

describe("blockRawUeConsole", () => {
  test("blocks py.exec", () => {
    blocked(blockRawUeConsole, "Bash", { command: 'py.exec("import unreal")' });
  });
  test("blocks unreal.execute_console_command", () => {
    blocked(blockRawUeConsole, "PowerShell", { command: "unreal.SystemLibrary.execute_console_command()" });
  });
});

describe("blockResearchFork", () => {
  test("blocks research forks", () => {
    blocked(blockResearchFork, "Agent", { prompt: "Research which database is best for our use case", subagent_type: "fork" });
  });
  test("allows non-research forks", () => {
    allowed(blockResearchFork, "Agent", { prompt: "Find where getModelFamily is defined", subagent_type: "fork" });
  });
  test("allows non-fork agents", () => {
    allowed(blockResearchFork, "Agent", { prompt: "Research the best approach", subagent_type: "general-purpose" });
  });
});

describe("blockSendFeedback", () => {
  test("blocks SendFeedback tool", () => {
    blocked(blockSendFeedback, "SendFeedback");
  });
  test("allows other tools", () => {
    allowed(blockSendFeedback, "Read");
  });
});

describe("blockStandaloneUeBypass", () => {
  test("blocks --standalone flag", () => {
    blocked(blockStandaloneUeBypass, "Bash", { command: "python ue_action.py run --standalone" });
  });
  test("allows normal ue_action calls", () => {
    allowed(blockStandaloneUeBypass, "Bash", { command: "python ue_action.py build" });
  });
});

describe("blockUePythonProbe", () => {
  test("blocks import unreal", () => {
    blocked(blockUePythonProbe, "Bash", { command: "python -c 'import unreal'" });
  });
  test("blocks from unreal import", () => {
    blocked(blockUePythonProbe, "PowerShell", { command: "from unreal import EditorAssetLibrary" });
  });
});

describe("blockUeRotatorPositional", () => {
  test("blocks FRotator(0, 90, 0)", () => {
    blocked(blockUeRotatorPositional, "Bash", { command: "FRotator(0, 90, 0)" });
  });
  test("allows FRotator without positional args", () => {
    allowed(blockUeRotatorPositional, "Bash", { command: "FRotator rot;" });
  });
});

describe("denyJunctionSurgery", () => {
  test("blocks mklink /j on plugin dirs", () => {
    blocked(denyJunctionSurgery, "Bash", { command: "mklink /j PluginDir target" });
  });
  test("allows mklink on non-plugin dirs", () => {
    allowed(denyJunctionSurgery, "Bash", { command: "mklink /j SomeDir target" });
  });
});

// -- Integration test: evaluateBlockRules --

describe("evaluateBlockRules", () => {
  test("returns first matching block", () => {
    const result = evaluateBlockRules("SendFeedback", {});
    assert.ok(result?.block);
    assert.match(result.reason, /disabled/);
  });

  test("returns undefined when no rule matches", () => {
    const result = evaluateBlockRules("Read", { file_path: "/tmp/test.txt" });
    assert.equal(result, undefined);
  });

  test("accepts a custom rule subset", () => {
    const result = evaluateBlockRules("SendFeedback", {}, [blockBashPython]);
    assert.equal(result, undefined);
  });

  test("all rules have unique names", () => {
    const names = ALL_RULES.map((r) => r.name);
    assert.equal(new Set(names).size, names.length, "Duplicate rule names found");
  });

  test("all rules are pure functions (no shared mutable state)", () => {
    for (const rule of ALL_RULES) {
      rule.test("Bash", { command: "echo test" });
      rule.test("Bash", { command: "echo test" });
    }
  });
});
