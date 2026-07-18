// Agent-generic ACP client — JSON-RPC 2.0 over stdio against a spawned agent process
// speaking the Agent Client Protocol (Zed's ACP; kimi-cli's `kimi acp` today, any other
// ACP agent tomorrow). This module owns ONLY the wire: spawn, newline-delimited framing,
// request/response correlation, agent→client request dispatch, teardown. What the events
// MEAN (activity feed, approvals, diffs) is the caller's business (see kimi-tool.js).
//
// Protocol shape (verified against kimi-cli 1.49.0):
//   client → agent requests:      initialize, session/new, session/prompt
//   client → agent notifications: session/cancel
//   agent → client notifications: session/update (streamed progress/tool calls/plan)
//   agent → client requests:      session/request_permission, fs/* (only if capabilities say so)
import { spawn } from "node:child_process";
import { parseJSON } from "../../../lib/json.js";

/** The ACP protocol major version we speak (kimi-cli 1.49.0 answers version 1). */
export const ACP_PROTOCOL_VERSION = 1;

/** Default per-request timeout. Generous: `initialize`/`session/new` answer in ms, but
 * this also guards a hung agent process from leaking pending promises forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @typedef {{ jsonrpc: "2.0", id?: number | string, method?: string, params?: unknown,
 *   result?: unknown, error?: { code: number, message: string, data?: unknown } }} RpcMessage
 */

/**
 * @typedef {object} AcpClient
 * @property {(method: string, params: unknown, timeoutMs?: number) => Promise<unknown>} request
 *   Send a client→agent request; resolves with `result`, rejects on error/exit/timeout.
 * @property {(method: string, params: unknown) => void} notify - fire a notification (no reply)
 * @property {() => void} kill - SIGKILL the agent process (teardown of last resort)
 * @property {Promise<{ code: number | null, signal: string | null }>} exited - settles when the process ends
 */

/**
 * Spawn an ACP agent process and return the wire client.
 * @param {{
 *   command: string, args: string[], cwd: string, env?: Record<string, string>,
 *   onNotification: (method: string, params: unknown) => void,
 *   onRequest: (method: string, params: unknown) => Promise<unknown>,
 *   onStderr?: (line: string) => void,
 * }} opts
 * @returns {AcpClient}
 */
export function startAcpClient({ command, args, cwd, env, onNotification, onRequest, onStderr }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  /** @type {Map<number | string, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();

  /** Reject every in-flight request (process died / stream closed). @param {string} why */
  const failAll = (why) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    pending.clear();
  };

  /** @type {Promise<{ code: number | null, signal: string | null }>} */
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      failAll(`ACP agent exited (code=${code} signal=${signal ?? "none"})`);
      resolve({ code, signal });
    });
  });
  child.on("error", (err) => {
    failAll(`ACP agent failed to start: ${err.message}`);
  });

  /** @param {RpcMessage} msg */
  const write = (msg) => {
    child.stdin.write(JSON.stringify(msg) + "\n");
  };

  /** Answer an agent→client request via the caller's handler; errors become JSON-RPC
   * errors so a throwing handler never wedges the agent. @param {RpcMessage} msg */
  const answerRequest = (msg) => {
    const id = /** @type {number | string} */ (msg.id);
    onRequest(msg.method ?? "", msg.params)
      .then((result) => {
        write({ jsonrpc: "2.0", id, result: result ?? {} });
      })
      .catch((e) => {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        });
      });
  };

  /** @param {RpcMessage} msg */
  const dispatch = (msg) => {
    if (msg.id != null && msg.method) {
      answerRequest(msg);
      return;
    }
    if (msg.method) {
      onNotification(msg.method, msg.params);
      return;
    }
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    else p.resolve(msg.result);
  };

  let buf = "";
  child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      /** @type {RpcMessage | null} */
      let msg = null;
      try {
        msg = /** @type {RpcMessage} */ (parseJSON(line));
      } catch {
        /* non-JSON stdout noise — ignore; the protocol lines are all JSON */
      }
      if (msg) dispatch(msg);
    }
  });
  child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
    if (onStderr) for (const line of chunk.toString().split("\n")) if (line.trim()) onStderr(line);
  });

  return {
    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`ACP ${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) {
      write({ jsonrpc: "2.0", method, params });
    },
    kill() {
      child.kill("SIGKILL");
    },
    exited,
  };
}
