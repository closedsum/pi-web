/**
 * Shared mock pi API for extension module tests.
 * Each test creates a fresh MockPi, loads the extension factory, then
 * exercises handlers via pi.emit(event, payload).
 */
export function createMockPi(overrides = {}) {
  const tools = new Map();
  const handlers = new Map();
  const entries = [];
  const messages = [];

  const pi = {
    tools,
    handlers,
    entries,
    messages,

    registerTool(tool) { tools.set(tool.name, tool); },

    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },

    sendMessage(msg, opts) {
      messages.push({ ...msg, _opts: opts });
    },

    appendEntry(type, data) {
      entries.push({ type: "custom", customType: type, data, timestamp: Date.now() });
    },

    getActiveTools() {
      return overrides.activeTools ?? ["read", "write", "edit", "bash", "powershell", "grep", "glob"];
    },

    setActiveTools() {},

    emit(event, payload, ctx) {
      const eventHandlers = handlers.get(event) ?? [];
      let result;
      for (const handler of eventHandlers) {
        result = handler(payload, ctx);
        if (result?.block || result?.action === "handled") break;
      }
      return result;
    },

    reset() {
      entries.length = 0;
      messages.length = 0;
    },
  };

  return pi;
}

/**
 * Load an extension factory and return the wired mock pi.
 */
export async function loadExtension(factory, options = {}) {
  const pi = createMockPi(options);
  const ext = typeof factory === "function" ? factory(options) : factory;
  await ext.factory(pi);
  return pi;
}

/**
 * Assert that a tool_call event blocks with a reason matching the pattern.
 */
export function assertBlocks(pi, toolName, input, pattern) {
  const result = pi.emit("tool_call", { toolName, input: input ?? {} });
  if (!result?.block) {
    throw new Error(`Expected tool_call '${toolName}' to be blocked, but it was allowed`);
  }
  if (pattern && !pattern.test(result.reason ?? "")) {
    throw new Error(`Block reason "${result.reason}" does not match ${pattern}`);
  }
  return result;
}

/**
 * Assert that a tool_call event is allowed (not blocked).
 */
export function assertAllows(pi, toolName, input) {
  const result = pi.emit("tool_call", { toolName, input: input ?? {} });
  if (result?.block) {
    throw new Error(`Expected tool_call '${toolName}' to be allowed, but it was blocked: ${result.reason}`);
  }
  return result;
}
