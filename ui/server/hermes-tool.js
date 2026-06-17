// Hermes tool: the ONE bridge from the Xenodot Hive to an external Hermes Agent
// (https://hermes-agent.nousresearch.com/) running as a subordinate researcher. Only
// the Hive (orchestrator main loop) calls it — no sub-agent frontmatter grants it, and
// it has no auto-allow branch in canUseTool, so every dispatch passes the per-call
// permission gate (allow/deny in the web UI). Hermes investigates; it never writes
// files or adopts anything — its findings come back as the tool result, which the Hive
// hands to a Xenodot researcher for the human verdict + the in-convention library write.
//
// API contract (Hermes "runs" API — docs/user-guide/features/api-server):
//   POST /v1/runs               {input, instructions?} -> {run_id, status}
//   GET  /v1/runs/{id}/events   SSE; OpenAI Responses event types
//                               (response.output_text.delta carries `.delta`,
//                                response.completed is terminal)
//   GET  /v1/runs/{id}          -> {status, output}  (authoritative final text)
//   POST /v1/runs/{id}/stop     interrupt a run
//   Auth: Authorization: Bearer <API_SERVER_KEY>
// The request `model` field is server-side/cosmetic on a single-profile Hermes, so we
// don't send it; the effective model lives in Hermes' own ~/.hermes/config.yaml.
//
// Graceful absence: if Hermes is off/unconfigured the handler returns a plain advisory
// string (never throws), so the framework runs exactly as today and the Hive falls back
// to dispatching the researcher sub-agents itself.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { parseJSON } from "../lib/json.js";
import { getHermesConfig } from "./config.js";

/** One SSE event we care about (OpenAI Responses shape). Other fields are ignored.
 * @typedef {{ type?: string, delta?: string, item?: { type?: string, name?: string } }} StreamEvent */
/** @typedef {(obj: import("../lib/types.js").OutMsg) => void} Send */

/** A relayed progress line, pushed to the UI activity log via `send`.
 * @param {Send} send @param {"start" | "progress" | "done"} phase @param {string} text @param {string} [runId] */
function relay(send, phase, text, runId) {
  send({ type: "hermes", phase, runId, text });
}

/** Join the `data:` lines of one raw SSE block ("" for a keepalive/comment).
 * @param {string} block @returns {string} */
function sseData(block) {
  return block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("\n");
}

/** Parse a JSON payload, or null if it isn't JSON. Callers cast the result.
 * @param {string} data @returns {unknown} */
function parseAs(data) {
  try {
    return parseJSON(data);
  } catch {
    return null;
  }
}

const authHeaders = (/** @type {string} */ key) => ({ authorization: `Bearer ${key}` });
const baseOf = (/** @type {string} */ url) => url.replace(/\/+$/, "");

/** Create a run and return its id. @param {string} base @param {string} key
 * @param {{ task: string, context?: string }} input @param {AbortSignal} signal @returns {Promise<string>} */
async function createRun(base, key, input, signal) {
  const res = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(key) },
    body: JSON.stringify(
      input.context ? { input: input.task, instructions: input.context } : { input: input.task },
    ),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Hermes ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`,
    );
  }
  const body = /** @type {{ run_id?: string } | null} */ (
    parseAs(await res.text().catch(() => "{}"))
  );
  const runId = body?.run_id;
  if (!runId) throw new Error("Hermes did not return a run_id");
  return runId;
}

/** Stream a run's SSE events, relaying progress; resolves when the run ends.
 * @param {string} base @param {string} key @param {string} runId @param {Send} send @param {AbortSignal} signal */
async function streamEvents(base, key, runId, send, signal) {
  const res = await fetch(`${base}/v1/runs/${runId}/events`, {
    headers: { accept: "text/event-stream", ...authHeaders(key) },
    signal,
  });
  if (!res.ok || !res.body || typeof res.body.getReader !== "function") return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const data = sseData(buf.slice(0, sep));
      buf = buf.slice(sep + 2);
      if (!data || data === "[DONE]") continue;
      const evt = /** @type {StreamEvent | null} */ (parseAs(data));
      if (!evt) continue;
      if (evt.type === "response.completed" || evt.type === "response.failed") return;
      const line = progressLine(evt);
      if (line) relay(send, "progress", line, runId);
    }
  }
}

/** The one informative progress line for an event, or "" to skip it.
 * @param {StreamEvent} evt @returns {string} */
function progressLine(evt) {
  if (evt.type === "response.output_text.delta" && evt.delta) return evt.delta.trim().slice(0, 240);
  if (evt.item?.type === "function_call" && evt.item.name) return `tool: ${evt.item.name}`;
  return "";
}

/** Read the authoritative final text from the run record. @param {string} base @param {string} key
 * @param {string} runId @param {AbortSignal} signal @returns {Promise<string>} */
async function finalText(base, key, runId, signal) {
  const res = await fetch(`${base}/v1/runs/${runId}`, { headers: authHeaders(key), signal });
  if (!res.ok) return "";
  const state = /** @type {{ output?: string } | null} */ (
    parseAs(await res.text().catch(() => "{}"))
  );
  return state?.output ?? "";
}

/** Best-effort interrupt; errors are swallowed. @param {string} base @param {string} key @param {string} runId */
function stopRun(base, key, runId) {
  void fetch(`${base}/v1/runs/${runId}/stop`, { method: "POST", headers: authHeaders(key) }).catch(
    () => {},
  );
}

/** Create → stream → finalize one Hermes run, returning its findings.
 * @param {{ apiUrl: string, apiKey: string }} cfg @param {{ task: string, context?: string }} input
 * @param {Send} send @param {AbortSignal} signal @returns {Promise<string>} */
async function runHermes(cfg, input, send, signal) {
  const base = baseOf(cfg.apiUrl);
  const runId = await createRun(base, cfg.apiKey, input, signal);
  // If the run is aborted (timeout), tell Hermes to stop rather than just dropping the socket.
  signal.addEventListener(
    "abort",
    () => {
      stopRun(base, cfg.apiKey, runId);
    },
    { once: true },
  );
  await streamEvents(base, cfg.apiKey, runId, send, signal);
  const out = await finalText(base, cfg.apiKey, runId, signal);
  return out || "(Hermes returned no final text)";
}

/** @param {Send} send */
export function makeHermesTool(send) {
  return tool(
    "hermes",
    "Delegate a heavy, multi-step research/investigation to the external Hermes Agent " +
      "(the main researcher). Use for capability-gap, tooling, or knowledge-gap research that " +
      "benefits from Hermes' web search + memory + skills; keep quick lookups local. ONLY the " +
      "Hive calls this — sub-agents never do. Hermes is advisory: it investigates and returns " +
      "findings; it NEVER writes files or adopts anything. Hand the returned findings to the " +
      "matching xenodot:*-researcher, which owns the human adopt/reject verdict and the library " +
      "write. Every call is gated (allow/deny) in the UI. If it reports Hermes is off/unconfigured, " +
      "dispatch the researcher sub-agent yourself instead.",
    {
      task: z.string().describe("The single research question / investigation to delegate."),
      context: z
        .string()
        .optional()
        .describe(
          "Optional background passed as Hermes `instructions`: what we know, constraints, what a good answer looks like.",
        ),
      timeout_s: z
        .number()
        .optional()
        .describe("Max seconds to wait for Hermes before giving up (default 300)."),
    },
    async (input) => {
      const cfg = getHermesConfig();
      if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) {
        return {
          content: [
            {
              type: "text",
              text:
                "Hermes is off or not configured (enable it + set the API key in Settings, or via " +
                "`npm run hermes`). Fall back to dispatching the matching xenodot:*-researcher to " +
                "investigate this yourself.",
            },
          ],
        };
      }
      const ctrl = new AbortController();
      const ms = Math.max(1, input.timeout_s ?? 300) * 1000;
      const timer = setTimeout(() => {
        ctrl.abort();
      }, ms);
      relay(send, "start", input.task.slice(0, 240));
      try {
        // cfg.apiUrl/apiKey are non-null past the guard; pass a narrowed copy.
        const findings = await runHermes(
          { apiUrl: cfg.apiUrl, apiKey: cfg.apiKey },
          input,
          send,
          ctrl.signal,
        );
        relay(send, "done", "Hermes finished.");
        return { content: [{ type: "text", text: findings }] };
      } catch (err) {
        const msg = ctrl.signal.aborted
          ? `Hermes timed out after ${Math.round(ms / 1000)}s.`
          : `Hermes call failed: ${err instanceof Error ? err.message : String(err)}`;
        relay(send, "done", msg);
        return {
          content: [
            {
              type: "text",
              text: `${msg} Treat this as no Hermes result — fall back to a xenodot:*-researcher for this investigation.`,
            },
          ],
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
