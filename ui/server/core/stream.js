// Best-effort context-meter helper for the session message stream. Split out of
// session.js to keep that file under its length cap.

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").RunningAgentWire} RunningChip */

/** Build a running-strip chip from a `task_started` system message. The server holds these
 * as the authoritative live set; the client reconciles its strip against them.
 * @param {{ task_id?: string, tool_use_id?: string, subagent_type?: string, description?: string }} message
 * @param {Set<string>} bgSpawns tool_use ids spawned run_in_background @returns {RunningChip} */
export function runningChip(message, bgSpawns) {
  const toolUseId = message.tool_use_id ?? "";
  return {
    taskId: message.task_id ?? "",
    toolUseId,
    label: message.subagent_type ?? "",
    desc: message.description ?? "",
    started: Date.now(),
    background: bgSpawns.has(toolUseId),
  };
}

/** Push the authoritative running-agents snapshot to the browser; the client reconciles its
 * strip against it, so a missed task_started/notification self-heals on the next emit.
 * @param {Map<string, RunningChip>} runningByTask @param {(obj: OutMsg) => void} send */
export function emitRunning(runningByTask, send) {
  send({ type: "running", agents: [...runningByTask.values()] });
}

/** Read the session's live context-window usage and push it to the UI meter.
 * Best-effort: getContextUsage is a streaming-mode control request and can throw if the
 * turn raced the session teardown — a missing meter update is harmless, so swallow errors
 * rather than killing the message loop.
 * @param {{ getContextUsage?: () => Promise<{ totalTokens: number, maxTokens: number, percentage: number }> }} q
 * @param {(obj: OutMsg) => void} send */
export async function emitContextUsage(q, send) {
  try {
    const u = await q.getContextUsage?.();
    if (!u) return;
    send({
      type: "context",
      percentage: u.percentage,
      totalTokens: u.totalTokens,
      maxTokens: u.maxTokens,
    });
  } catch {
    // session ended or control request unsupported — skip this meter update
  }
}

// ── API-529 (Overloaded) deterministic retry ───────────────────────────────────
// The SDK runs the engine as a SUBPROCESS with its own short (seconds-scale) backoff.
// A SUSTAINED overload reaches us as a typed stream message — an `api_retry` with
// error:"overloaded", or a `result` flagged api_error_status 529 — NOT as a thrown
// APIError. So detection lives on the stream (isOverloadMessage); the thrown form
// (isOverloadError) is only a backstop for the rarer case where the subprocess itself
// dies. Contract: on a 529, wait 5 min, resume the same session, retry up to MAX, then
// stop — self-stopping on the first clean turn. The SDK's own backoff is seconds, far
// short of the 5-min interval, so the external loop is still required.

/** @typedef {Awaited<ReturnType<typeof import("@anthropic-ai/claude-agent-sdk").query>>} Query */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKMessage} SDKMessage */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {{ agentByTool: Map<string, string>, bgSpawns: Set<string>, bgBoard: Map<string, string>, runningByTask: Map<string, RunningChip>, send: (obj: OutMsg) => void }} TrackDeps */
/** @typedef {{ send: (obj: OutMsg) => void, trackMessage: (m: SDKMessage, deps: TrackDeps) => void, trackDeps: TrackDeps, busy: { value: boolean }, sid: { value: string | null }, overload: { value: boolean }, onSessionId?: (id: string) => void, onBusyChange?: () => void }} StreamDeps */

const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 min between API-529 retries
const MAX_529_RETRIES = 3; // cap so a sustained outage can't loop forever

/** True when an SDK stream message reports an API-529 / overload. @param {SDKMessage} m */
export function isOverloadMessage(m) {
  if (m.type === "system" && m.subtype === "api_retry")
    return m.error === "overloaded" || m.error_status === 529;
  if (m.type === "assistant") return m.error === "overloaded";
  if (m.type === "result" && m.subtype === "success")
    return m.is_error && m.api_error_status === 529;
  if (m.type === "result") return /\b529\b|overloaded/i.test(m.errors.join(" "));
  return false;
}

/** Backstop for the rare case the subprocess dies on overload and the SDK throws.
 * @param {unknown} err */
function isOverloadError(err) {
  const e = /** @type {{ status?: unknown, message?: unknown }} */ (err ?? {});
  return e.status === 529 || /\b529\b|overloaded/i.test(String(e.message ?? err));
}

/** Resolve after `ms`, or early when `signal` aborts (a disconnect/Stop cancels the
 * wait). Resolves, never rejects — the caller checks `signal.aborted` to decide to bail.
 * @param {number} ms @param {AbortSignal} signal @returns {Promise<void>} */
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(undefined);
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      resolve(undefined);
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A synthetic user turn nudging the resumed model after a 529 — a bare resume with an
 * empty queue would just idle. Same shape as a real user turn / answerTurn.
 * @param {number} attempt @param {number} max @returns {SDKUserMessage} */
function retryTurn(attempt, max) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[System] The previous turn failed with API 529 (Overloaded). Auto-resumed ` +
            `(retry ${attempt}/${max}). Continue exactly where you left off; re-issue any ` +
            `tool call that didn't complete.`,
        },
      ],
    },
  };
}

/** Stream one query's messages to the browser: capture the live session id (for resume),
 * flag a sustained overload (so runWithRetry can act on it), keep the autonomous turn-busy
 * flag in sync, and refresh the context meter at each turn end. @param {Query} q
 * @param {StreamDeps} deps */
async function streamQuery(
  q,
  { send, trackMessage, trackDeps, busy, sid, overload, onSessionId, onBusyChange },
) {
  for await (const message of q) {
    const sessionId = /** @type {{ session_id?: string }} */ (message).session_id;
    if (sessionId) {
      sid.value = sessionId; // live id so a 529 retry can resume this session
      onSessionId?.(sessionId); // register in the live-session registry so a client can re-attach
    }
    if (isOverloadMessage(message)) overload.value = true; // sustained 529 surfaces here, not a throw
    trackMessage(message, trackDeps);
    send({ type: "event", message });
    // busy flips drive the detach grace policy (onBusyChange): keep a detached session alive while
    // a turn runs, start the idle window the moment it goes quiet.
    if (message.type === "assistant") {
      busy.value = true;
      onBusyChange?.();
    }
    if (message.type === "result") {
      busy.value = false;
      onBusyChange?.();
      void emitContextUsage(q, send);
    }
  }
}

/** Drive the streaming session with deterministic API-529 retry. Builds the query via
 * `makeQuery(resume)`, streams it through the passed `streamQuery`, captures the live
 * session id (sid) for resume, and on a sustained overload waits 5 min then resumes the
 * SAME session — up to MAX_529_RETRIES, self-stopping on the first clean turn. Sets
 * `session.query` each attempt (the interrupt/stop handle). Non-overload errors re-throw
 * to the caller's terminal handling.
 * @param {{
 *   makeQuery: (resume: string | null) => Query,
 *   trackMessage: (m: SDKMessage, deps: TrackDeps) => void,
 *   trackDeps: TrackDeps,
 *   send: (obj: OutMsg) => void,
 *   abort: AbortController,
 *   busy: { value: boolean },
 *   session: { query?: unknown },
 *   inbox: { push: (m: SDKUserMessage) => void },
 *   resumeId: string | null,
 *   onSessionId?: (id: string) => void,
 *   onBusyChange?: () => void,
 * }} deps */
export async function runWithRetry({
  makeQuery,
  trackMessage,
  trackDeps,
  send,
  abort,
  busy,
  session,
  inbox,
  resumeId,
  onSessionId,
  onBusyChange,
}) {
  const sid = { value: resumeId };
  let retries = 0;
  for (;;) {
    const overload = { value: false };
    const q = makeQuery(sid.value);
    session.query = q;
    try {
      await streamQuery(q, {
        send,
        trackMessage,
        trackDeps,
        busy,
        sid,
        overload,
        onSessionId,
        onBusyChange,
      });
    } catch (err) {
      if (isOverloadError(err)) overload.value = true;
      else throw err; // genuine terminal error → caller's catch reports it
    }
    if (!overload.value) {
      send({ type: "status", text: retries > 0 ? "resumed after overload" : "session ended" });
      return;
    }
    retries += 1;
    if (retries > MAX_529_RETRIES || abort.signal.aborted) {
      send({
        type: "status",
        text: `API overloaded (529) — gave up after ${retries - 1} ${retries - 1 === 1 ? "retry" : "retries"}`,
      });
      return;
    }
    send({
      type: "status",
      text: `API overloaded (529) — retry ${retries}/${MAX_529_RETRIES} in 5m…`,
    });
    await delay(RETRY_DELAY_MS, abort.signal);
    if (abort.signal.aborted) return; // user disconnected/stopped during the wait
    if (!sid.value) {
      send({ type: "status", text: "overload before session id — cannot resume; stopping" });
      return;
    }
    inbox.push(retryTurn(retries, MAX_529_RETRIES)); // give the resumed model a turn to act on
  }
}
