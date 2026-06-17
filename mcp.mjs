// Minimal MCP (Model Context Protocol) stdio server.
//
// Exposes a Coffilot canvas's agent actions as MCP tools so editors that speak
// MCP — Cursor in particular — can build, test, package, run, debug and read
// live JVM metrics from the project, reusing the exact same handlers the Copilot
// canvas uses. This is the bridge that lets Coffilot be "used with Cursor".
//
// Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (the MCP stdio
// transport). While this server runs nothing else may write to stdout — the
// standalone session routes its logs to stderr for exactly this reason.

import { createInterface } from "node:readline";

// The protocol revision we implement. Clients negotiate during `initialize`; we
// echo a supported version rather than blindly mirroring the client's.
const PROTOCOL_VERSION = "2024-11-05";

/**
 * Start serving MCP over stdio for the given canvas declaration.
 * @param {{ actions?: Array }} canvas - the canvas definition (with `actions`).
 * @param {{ log?: (msg: string) => void, version?: string }} [opts]
 */
export function startMcpServer(canvas, opts = {}) {
  const log = typeof opts.log === "function" ? opts.log : () => {};
  const version = opts.version || "0.1.0";
  const actions = Array.isArray(canvas && canvas.actions) ? canvas.actions : [];
  const byName = new Map(actions.map((a) => [a.name, a]));

  const write = (msg) => {
    try {
      process.stdout.write(JSON.stringify(msg) + "\n");
    } catch {
      /* the client may have gone away mid-write */
    }
  };
  const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
  const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

  async function handle(msg) {
    const { id, method, params } = msg || {};
    const isRequest = id !== undefined && id !== null;
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "coffilot", version },
        });
        return;
      // Notifications carry no id and expect no reply.
      case "notifications/initialized":
      case "initialized":
        return;
      case "ping":
        if (isRequest) reply(id, {});
        return;
      case "tools/list":
        reply(id, {
          tools: actions.map((a) => ({
            name: a.name,
            description: a.description || "",
            inputSchema: a.inputSchema || { type: "object", properties: {} },
          })),
        });
        return;
      case "tools/call": {
        const name = params && params.name;
        const action = byName.get(name);
        if (!action) {
          fail(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        try {
          const result = await action.handler({ input: (params && params.arguments) || {} });
          reply(id, { content: [{ type: "text", text: asText(result) }] });
        } catch (e) {
          // Tool errors are reported in-band (isError) per MCP, not as protocol
          // errors, so the agent can read and react to the failure.
          reply(id, { isError: true, content: [{ type: "text", text: `Error: ${(e && e.message) || e}` }] });
        }
        return;
      }
      default:
        if (isRequest) fail(id, -32601, `Method not found: ${method}`);
    }
  }

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // ignore malformed frames
    }
    Promise.resolve(handle(msg)).catch((e) => log(`[coffilot] MCP handler error: ${(e && e.stack) || e}`));
  });
  // Keep the process alive on the input stream; exit when the client closes it.
  rl.on("close", () => process.exit(0));
  log(`[coffilot] MCP server ready on stdio (${actions.length} tools)`);
}

function asText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
