// Hermes tool: the ONE bridge from the Xenodot Hive to an external Hermes Agent
// (https://hermes-agent.nousresearch.com/) running as a subordinate researcher coworker. Only the
// Hive (orchestrator main loop) calls it — no sub-agent frontmatter grants it, and it has no
// auto-allow branch in canUseTool, so every dispatch passes the per-call permission gate.
//
// FIRE-AND-FORGET UX, but delivery is READ, not pushed. Hermes' runs API has NO callback/webhook:
// POST /v1/runs returns a run_id at once and the agent loops server-side. We never block the Hive
// turn — we spawn a background WATCHER that reads the run to completion:
//   • GET /v1/runs/{id}/events (SSE) — best-effort live progress → activity feed (cosmetic).
//   • GET /v1/runs/{id}           — authoritative state; the final findings ARE the run's `output`.
// When the run finishes we push the findings into the session inbox as a new turn (exactly like a
// user message), so the Hive resumes with them without anything having been held open. A run that
// stalls on an approval gate, or runs past the wall-clock cap, is stopped (POST /v1/runs/{id}/stop)
// and reported as done — never left hanging silently.
//
// Hermes "runs" API (docs/user-guide/features/api-server):
//   POST /v1/runs {input, instructions?} -> {run_id, status:"started"}    (returns at once)
//   GET  /v1/runs/{id}                   -> {status, output, usage, ...}   (status: completed|failed|cancelled)
//   GET  /v1/runs/{id}/events            -> SSE: tool-call/progress/lifecycle events
//   POST /v1/runs/{id}/stop              -> stop a run
//   Auth: Authorization: Bearer <API_SERVER_KEY>
// The request `model` is server-side/cosmetic on a single-profile Hermes, so we don't send it.
//
// Graceful absence: if Hermes is off/unconfigured the handler returns a plain advisory string
// (never throws), so the framework runs exactly as today and the Hive dispatches a researcher itself.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { parseJSON } from "../../lib/json.js";
import { getHermesConfig } from "../core/config.js";
import { applyOp } from "../features/tasks/tasks-store.js";
import { getPersona, PERSONA_IDS } from "../../lib/hermes-personas.js";

/** @typedef {(obj: import("../../lib/types.js").OutMsg) => void} Send */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {(msg: SDKUserMessage) => void} Push */
/** @typedef {import("../../lib/hermes-personas.js").HermesPersona} HermesPersona */

/** A tool text result, in the shape the agent SDK expects. @param {string} text */
const ok = (text) => ({ content: [{ type: /** @type {const} */ ("text"), text }] });

// Timeouts. The POST only opens the run; the watcher then reads it for as long as the run runs,
// up to a wall-clock cap (research can be long, but never unbounded).
const CREATE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
const RUN_WALLCLOCK_MS = 15 * 60_000;

/** Push a Hermes activity line to the UI feed; `persona` names + colors the pill.
 * @param {Send} send @param {string} persona @param {"start" | "progress" | "done"} phase
 * @param {string} text @param {string} [runId] */
function relay(send, persona, phase, text, runId) {
  send({ type: "hermes", phase, runId, text, persona });
}

/** Parse a JSON payload, or null if it isn't JSON. @param {string} data @returns {unknown} */
function parseAs(data) {
  try {
    return parseJSON(data);
  } catch {
    return null;
  }
}

const authHeaders = (/** @type {string} */ key) => ({ authorization: `Bearer ${key}` });
const baseOf = (/** @type {string} */ url) => url.replace(/\/+$/, "");

/** Compose a run's `instructions`: the persona's standing brief plus the Hive's task `context`.
 * Hermes appends this to its own SOUL/base persona and layers it on its system prompt. The agent's
 * FINAL message is the deliverable (it becomes the run's `output`), so we say so explicitly — there
 * is no separate "report back" channel any more. @param {HermesPersona} persona @param {string}
 * [context] @returns {string} */
function buildInstructions(persona, context) {
  const headless =
    "\n\n--- How this runs ---\n" +
    "You are running headless for the Xenodot Hive: there is no interactive human in this run. " +
    "Your FINAL message IS your entire deliverable — put your complete, self-contained findings " +
    "there (a partial answer or a question back is lost). Work to a conclusion, then stop.\n\n" +
    "--- Your own brain ---\n" +
    "Use and grow your own memory and skills freely: if you work out a reusable research workflow, " +
    "save it as a skill, and remember durable facts about this team and its stack — this is your " +
    "private brain (~/.hermes) and it makes your next investigation faster. But you NEVER edit the " +
    "caller's game or codebase, run their build, or write their files; you only investigate and " +
    "report. Adopting anything into their project is a separate human-gated step you take no part in.";
  const extra = context?.trim();
  return persona.brief + headless + (extra ? `\n\n--- Task context ---\n${extra}` : "");
}

/** Create a run and return its id. The POST returns immediately; the agent loops server-side.
 * @param {string} base @param {string} key @param {string} task @param {string} instructions
 * @param {AbortSignal} signal @returns {Promise<string>} */
async function createRun(base, key, task, instructions, signal) {
  const res = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(key) },
    body: JSON.stringify({ input: task, instructions }),
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

/** The synthetic user turn that delivers Hermes' findings back to the Hive (same shape as a real
 * user message — see session.js inbox.push). @param {string} runId @param {HermesPersona} persona
 * @param {string} findings @returns {SDKUserMessage} */
function findingsTurn(runId, persona, findings) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[Hermes · ${persona.name} — run ${runId} delivered its findings]\n\n${findings}\n\n` +
            "Hand these to the matching xenodot:*-researcher for the human verdict + library write.",
        },
      ],
    },
  };
}

/** The synthetic user turn that tells the Hive a fired run did NOT deliver (failed, timed out, or
 * stalled on an approval gate). Re-enters the session like a user message so the Hive's prompt
 * fallback fires — dispatch the matching researcher directly instead of waiting forever.
 * @param {string} runId @param {HermesPersona} persona @param {string} reason @returns {SDKUserMessage} */
function fallbackTurn(runId, persona, reason) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[Hermes · ${persona.name} — run ${runId} did NOT deliver findings: ${reason}]\n\n` +
            "Treat this as no Hermes result. Dispatch the matching xenodot:*-researcher yourself to " +
            "run the investigation instead.",
        },
      ],
    },
  };
}

/** Resolve after `ms`, or early if `signal` aborts (so the watcher unblocks on teardown).
 * @param {number} ms @param {AbortSignal} signal @returns {Promise<void>} */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** Fetch one run's current state. @param {string} base @param {string} key @param {string} runId
 * @param {AbortSignal} signal @returns {Promise<Record<string, unknown> | null>} */
async function fetchRun(base, key, runId, signal) {
  const res = await fetch(`${base}/v1/runs/${runId}`, { headers: authHeaders(key), signal });
  if (!res.ok) throw new Error(`run status ${res.status}`);
  return /** @type {Record<string, unknown> | null} */ (
    parseAs(await res.text().catch(() => "{}"))
  );
}

/** Best-effort stop of a run (timeout / approval gate). Never throws. @param {string} base
 * @param {string} key @param {string} runId @returns {Promise<void>} */
async function stopRun(base, key, runId) {
  try {
    await fetch(`${base}/v1/runs/${runId}/stop`, { method: "POST", headers: authHeaders(key) });
  } catch {
    /* the run will still hit its own server-side limits; nothing more we can do */
  }
}

/** Decide what a polled run state means. @param {Record<string, unknown> | null} state
 * @returns {{ kind: "pending" } | { kind: "approval" } |
 *   { kind: "completed", output: string } | { kind: "ended", reason: string }} */
function classifyRun(state) {
  const status = typeof state?.status === "string" ? state.status.toLowerCase() : "";
  if (status.includes("approval")) return { kind: "approval" };
  if (status === "completed") {
    const out = state?.output;
    const output = typeof out === "string" ? out : out == null ? "" : JSON.stringify(out);
    return { kind: "completed", output };
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    const why = typeof state?.error === "string" ? ` — ${state.error.slice(0, 200)}` : "";
    return { kind: "ended", reason: `${status}${why}` };
  }
  return { kind: "pending" };
}

/** Map a Hermes tool name to a plain-language self-improvement line, or null if it isn't one.
 * Hermes' own-brain tools (skill management + memory) are the self-improvement we now leave on;
 * surfacing them lets you SEE Hermes learning. Best-effort: tool names may vary across versions,
 * so we match on substrings. @param {string} tool @returns {string | null} */
function describeSelfImprovement(tool) {
  const t = tool.toLowerCase();
  // Read-only skill loads (list/view) aren't learning — don't dress them up.
  if (t.includes("skill") && /(manage|create|write|edit|patch|update|save|delete|remove)/.test(t)) {
    return "🧠 Hermes is updating its own skills";
  }
  if (t.includes("memory") && !/(search|recall|read|view|list)/.test(t)) {
    return "🧠 Hermes is updating its own memory";
  }
  return null;
}

/** Pull a short, human-meaningful progress line out of one parsed SSE event, or null to skip
 * (token deltas and shapeless frames are ignored — progress pills are cosmetic; `output` is truth).
 * @param {string} event @param {unknown} data @returns {string | null} */
function extractProgress(event, data) {
  if (!data || typeof data !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  const str = (/** @type {unknown} */ v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const tool = str(d.tool) ?? str(d.name);
  if (tool) {
    // Self-improvement is the headline reason Hermes is worth it — make it visible. When Hermes
    // grows its OWN brain (skill_manage / memory tools → ~/.hermes, never our code), surface a
    // plain-language line instead of the bare tool name so you can watch it get smarter.
    const learned = describeSelfImprovement(tool);
    if (learned) return learned.slice(0, 240);
    return `· ${tool}`.slice(0, 240);
  }
  const msg = str(d.message) ?? str(d.summary) ?? str(d.status);
  if (msg) return msg.slice(0, 240);
  // A named lifecycle event with no payload text — surface the event name, not raw token deltas.
  if (event && !str(d.delta) && !str(d.text)) return event.slice(0, 240);
  return null;
}

/** Parse one SSE frame ("event:"/"data:" lines, blank-line terminated) → progress line or null.
 * @param {string} frame @returns {string | null} */
function progressFromFrame(frame) {
  /** @type {string[]} */
  const dataLines = [];
  let event = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    else if (line.startsWith("event:")) event = line.slice(6).trim();
  }
  if (!dataLines.length) return null;
  return extractProgress(event, parseAs(dataLines.join("\n")));
}

/** Best-effort live progress: read the run's SSE event stream and hand each meaningful line to
 * `onText`. Any error is swallowed — the poll loop is the source of truth, so progress is pure
 * sugar. @param {string} base @param {string} key @param {string} runId
 * @param {(text: string) => void} onText @param {AbortSignal} signal @returns {Promise<void>} */
async function streamProgress(base, key, runId, onText, signal) {
  try {
    const res = await fetch(`${base}/v1/runs/${runId}/events`, {
      headers: { ...authHeaders(key), accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const line = progressFromFrame(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (line) onText(line);
      }
    }
  } catch {
    /* best-effort: SSE unavailable/dropped is non-fatal — the poll loop still delivers findings */
  }
}

/** Watch a fired run to its end and report back to the session: stream progress to the feed, push
 * the final `output` into the inbox as a Hive turn, or report failure/approval/timeout. Runs in the
 * background (the tool call has already returned). @param {string} base @param {string} key
 * @param {string} runId @param {HermesPersona} persona @param {Send} send @param {Push} push */
async function watchRun(base, key, runId, persona, send, push) {
  const ctrl = new AbortController();
  const deadline = Date.now() + RUN_WALLCLOCK_MS;
  // A run that didn't deliver: a `done` pill AND a fallback turn, so the Hive is re-engaged and
  // its prompt fallback (dispatch the researcher) fires instead of the pipeline stalling silently.
  const fail = (/** @type {string} */ reason) => {
    relay(send, persona.id, "done", `Hermes run ${runId} ${reason}.`, runId);
    try {
      push(fallbackTurn(runId, persona, reason));
    } catch {
      /* session gone — nothing to deliver to */
    }
  };
  void streamProgress(
    base,
    key,
    runId,
    (text) => {
      relay(send, persona.id, "progress", text, runId);
    },
    ctrl.signal,
  );
  try {
    for (;;) {
      if (Date.now() > deadline) {
        await stopRun(base, key, runId);
        fail(`exceeded the ${Math.round(RUN_WALLCLOCK_MS / 60_000)}m limit and was stopped`);
        return;
      }
      await sleep(POLL_INTERVAL_MS, ctrl.signal);
      if (ctrl.signal.aborted) return;
      let state;
      try {
        state = await fetchRun(base, key, runId, ctrl.signal);
      } catch {
        continue; // transient read error — keep polling until the deadline
      }
      const verdict = classifyRun(state);
      if (verdict.kind === "pending") continue;
      if (verdict.kind === "approval") {
        await stopRun(base, key, runId);
        fail("paused on an approval gate (unsupported headless) and was stopped");
        return;
      }
      if (verdict.kind === "ended") {
        fail(verdict.reason);
        return;
      }
      // completed
      relay(send, persona.id, "done", "Hermes delivered its findings.", runId);
      try {
        push(findingsTurn(runId, persona, verdict.output));
      } catch {
        /* session gone — nothing to deliver to */
      }
      // Deterministically surface the delivery as a durable, user-owned lead on the task board the
      // moment it lands — independent of the Hive's turn scheduling (same pattern as mcp__ui__ask /
      // asset requests). The user reads the findings in the feed, then clicks this to route them.
      try {
        const tasks = applyOp(
          {
            op: "add",
            owner: "user",
            title: `Hermes · ${persona.name} findings ready (run ${runId})`,
            note: "Review the findings in the feed, then route to the matching xenodot:*-researcher for the verdict + library write.",
          },
          new Date().toISOString(),
        );
        send({ type: "tasks", tasks });
      } catch {
        /* board write failed — non-fatal; the feed + findingsTurn still carry the delivery */
      }
      return;
    }
  } finally {
    ctrl.abort(); // tear down the SSE stream
  }
}

const FEEDBACK_WALLCLOCK_MS = 3 * 60_000;

/** Build the Hermes feedback tool. Fires a short self-update run so Hermes can record the team's
 * verdict in its own memory/skills — non-blocking, no findings delivery.
 * @param {Send} send */
export function makeHermesFeedbackTool(send) {
  return tool(
    "hermes_feedback",
    "Send the team's verdict on a Hermes findings delivery back to Hermes so it can update its " +
      "own memory/skills. Call this ONCE per delivery — after the matching xenodot:*-researcher " +
      "has written the verdict to library/verdicts/. Fire-and-forget: returns immediately, no " +
      "findings come back. Even 'not-useful' runs deserve feedback so Hermes learns what to avoid.",
    {
      runId: z.string().describe("The run id from the findings message header (run <id>)."),
      verdict: z
        .enum(["useful", "partial", "not-useful"])
        .describe(
          "'useful' = cited, actionable, novel; 'partial' = some findings helped, others stale/off-topic; 'not-useful' = off-topic, uncited, or no value found.",
        ),
      notes: z
        .string()
        .describe("1–3 lines on what was good, missing, or wrong with the findings."),
    },
    async (input) => {
      const cfg = getHermesConfig();
      if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) {
        return ok("Hermes is off or not configured — feedback skipped.");
      }
      const apiUrl = cfg.apiUrl;
      const apiKey = cfg.apiKey;
      const base = baseOf(apiUrl);
      const task = `Process feedback on run ${input.runId}: verdict=${input.verdict}. Update your memory/skills based on this lesson.`;
      const instructions =
        `The Xenodot Hive reviewed your run ${input.runId}.\n` +
        `Verdict: ${input.verdict}\n` +
        `Notes: ${input.notes}\n\n` +
        "Update your memory and/or skills to reflect this lesson — record what worked, " +
        "what to avoid, or how to improve similar investigations. " +
        "Do NOT research further. This is a self-update task only. " +
        "Your FINAL message IS your deliverable.";
      const ctrl = new AbortController();
      const timer = setTimeout(() => {
        ctrl.abort();
      }, CREATE_TIMEOUT_MS);
      let runId;
      try {
        runId = await createRun(base, apiKey, task, instructions, ctrl.signal);
      } catch (err) {
        const msg = ctrl.signal.aborted
          ? "Hermes did not accept the feedback run within 30s."
          : `Hermes feedback call failed: ${err instanceof Error ? err.message : String(err)}`;
        return ok(`${msg} Feedback not recorded.`);
      } finally {
        clearTimeout(timer);
      }
      relay(
        send,
        "researcher",
        "start",
        `Feedback on run ${input.runId} (${input.verdict})`,
        runId,
      );
      // Watch with a short cap — memory writes are fast; no findings delivery on completion.
      void (async () => {
        const deadline = Date.now() + FEEDBACK_WALLCLOCK_MS;
        const pollCtrl = new AbortController();
        try {
          for (;;) {
            if (Date.now() > deadline) {
              await stopRun(base, apiKey, runId);
              relay(send, "researcher", "done", `Feedback run ${runId} timed out.`, runId);
              return;
            }
            await sleep(POLL_INTERVAL_MS, pollCtrl.signal);
            if (pollCtrl.signal.aborted) return;
            let state;
            try {
              state = await fetchRun(base, apiKey, runId, pollCtrl.signal);
            } catch {
              continue;
            }
            const verdict = classifyRun(state);
            if (verdict.kind === "pending") continue;
            if (verdict.kind === "approval") {
              await stopRun(base, apiKey, runId);
              relay(
                send,
                "researcher",
                "done",
                `Feedback run ${runId} stopped (approval gate).`,
                runId,
              );
              return;
            }
            relay(
              send,
              "researcher",
              "done",
              `Hermes recorded feedback for run ${input.runId}.`,
              runId,
            );
            return;
          }
        } finally {
          pollCtrl.abort();
        }
      })();
      return ok(
        `Feedback dispatched to Hermes (run ${runId}). It will update its own memory. Fire-and-forget — move on.`,
      );
    },
  );
}

/** Build the Hermes start tool. Fire-and-forget: POST the run, kick off a background watcher that
 * reads it to completion (mcp-callback-free), return at once.
 * @param {Send} send @param {Push} push the session inbox.push — how findings re-enter the Hive */
export function makeHermesTool(send, push) {
  return tool(
    "hermes",
    "Delegate a heavy, multi-step research/investigation to your external Hermes coworker " +
      "(web search + memory). FIRE-AND-FORGET: this returns immediately; Hermes works in the " +
      "background, streams progress to the feed, and delivers its findings to you LATER as a new " +
      "message — so DO NOT wait on it; continue or wrap up the turn. Pick a `persona`: 'researcher' " +
      "(default — cited investigation) or 'critic' (adversarially stress-test a claim/plan/findings). " +
      "ONLY the Hive calls this. Hermes is advisory — it never writes files or adopts anything; when " +
      "its findings arrive, hand them to the matching xenodot:*-researcher for the verdict + library " +
      "write. Gated (allow/deny) per call. If it reports Hermes is off/unconfigured, dispatch the " +
      "researcher sub-agent yourself instead.",
    {
      task: z.string().describe("The single research question / investigation to delegate."),
      persona: z
        .enum(/** @type {[string, ...string[]]} */ (PERSONA_IDS))
        .optional()
        .describe(
          "Which coworker persona to delegate as: 'researcher' (default — deep, cited investigation) or 'critic' (adversarially stress-test a claim, plan, or set of findings).",
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Optional background woven into Hermes' instructions: what we know, constraints, what a good answer looks like.",
        ),
    },
    async (input) => {
      const cfg = getHermesConfig();
      if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) {
        return ok(
          "Hermes is off or not configured (enable it + set the API key in Settings, or via " +
            "`npm run hermes`). Fall back to dispatching the matching xenodot:*-researcher yourself.",
        );
      }
      const persona = getPersona(input.persona);
      const base = baseOf(cfg.apiUrl);
      const instructions = buildInstructions(persona, input.context);
      // Short timeout for the POST only — it returns fast; the watcher then reads the run.
      const ctrl = new AbortController();
      const timer = setTimeout(() => {
        ctrl.abort();
      }, CREATE_TIMEOUT_MS);
      try {
        const runId = await createRun(base, cfg.apiKey, input.task, instructions, ctrl.signal);
        // Read the run to completion in the background; the tool returns now (fire-and-forget).
        void watchRun(base, cfg.apiKey, runId, persona, send, push);
        relay(send, persona.id, "start", input.task.slice(0, 240), runId);
        return ok(
          `Hermes ${persona.name} run started (id ${runId}) — working in the background. It will ` +
            "stream progress to the feed and deliver its findings to you as a new message. Do not " +
            "wait; continue or wrap up this turn.",
        );
      } catch (err) {
        const msg = ctrl.signal.aborted
          ? "Hermes did not accept the run within 30s."
          : `Hermes call failed: ${err instanceof Error ? err.message : String(err)}`;
        relay(send, persona.id, "done", msg);
        return ok(
          `${msg} Treat this as no Hermes result — dispatch a xenodot:*-researcher instead.`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
