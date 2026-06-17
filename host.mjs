// Host adapter.
//
// Coffilot is primarily a GitHub Copilot canvas extension, launched by the
// Copilot host which provides the `@github/copilot-sdk/extension` module at
// runtime (it is deliberately never a package.json dependency). That module
// supplies `createCanvas`/`joinSession`, the canvas-iframe embedding, the agent
// actions, and the live conversation used by "Fix with Copilot".
//
// Editors that don't implement the Copilot canvas runtime (for example Cursor)
// can still drive the same engine: this adapter lets Coffilot run *standalone*.
// In standalone mode it serves the loopback web UI for any browser to open, and
// — when launched as an MCP server — exposes the canvas actions as Model Context
// Protocol tools over stdio, which MCP-capable agents (Cursor, etc.) can call.
//
// The Copilot path is unchanged: when the SDK resolves and standalone mode was
// not requested, the real SDK is returned and everything behaves exactly as
// before.

// Standalone mode is requested explicitly (env or flag); it is also used as an
// automatic fallback when the Copilot SDK cannot be resolved (i.e. we were not
// launched by the Copilot host). The MCP server is opt-in because it claims
// stdout as the JSON-RPC transport.
const wantsMcp = process.env.COFFILOT_MCP === "1" || process.argv.includes("--mcp");
const wantsStandalone = wantsMcp || process.env.COFFILOT_STANDALONE === "1" || process.argv.includes("--standalone");

/**
 * Resolve the host bindings used by extension.mjs.
 *
 * Returns `{ mode, mcp, createCanvas, joinSession }`:
 *  - mode "copilot": the real `@github/copilot-sdk/extension` bindings.
 *  - mode "standalone": local shims that capture the canvas declarations and
 *    return a no-op session, so the loopback server + UI run without the host.
 */
export async function loadHost() {
  if (!wantsStandalone) {
    try {
      const sdk = await import("@github/copilot-sdk/extension");
      return { mode: "copilot", mcp: false, createCanvas: sdk.createCanvas, joinSession: sdk.joinSession };
    } catch {
      // Not launched by the Copilot host (the SDK is unavailable): fall back to
      // standalone so `node extension.mjs` still works from a plain shell.
    }
  }
  return {
    mode: "standalone",
    mcp: wantsMcp,
    createCanvas: standaloneCreateCanvas,
    joinSession: standaloneJoinSession,
  };
}

// In standalone mode a "canvas" is just its declaration object: extension.mjs
// reads its `actions` (for MCP) and calls its `open()` (for the browser URL).
function standaloneCreateCanvas(definition) {
  return definition;
}

// A minimal stand-in for the SDK session. It satisfies the surface extension.mjs
// uses — log/on/send/rpc/dispose/workspacePath — without a live conversation.
function standaloneJoinSession(options = {}) {
  const canvases = Array.isArray(options.canvases) ? options.canvases : [];
  const session = {
    standalone: true,
    canvases,
    workspacePath: undefined,
    // No permission-paths RPC outside the host; project resolution falls back to
    // COFFILOT_PROJECT / cwd path heuristics in extension.mjs.
    rpc: {},
    log(message, meta = {}) {
      // stdout is reserved for the MCP JSON-RPC channel, so diagnostics go to
      // stderr where they never corrupt the protocol stream.
      const level = (meta && meta.level) || "info";
      try {
        process.stderr.write(`[coffilot:${level}] ${message}\n`);
      } catch {
        /* logging must never throw */
      }
    },
    on() {
      /* no host events in standalone */
    },
    off() {},
    async send({ prompt } = {}) {
      // There is no agent conversation to push into; hand the prompt back so an
      // MCP caller (e.g. Cursor's agent) receives the fix request as the tool
      // result and can act on it.
      session.lastPrompt = prompt || "";
      return { prompt: session.lastPrompt };
    },
    dispose() {},
  };
  return session;
}
