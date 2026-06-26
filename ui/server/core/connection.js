// Browser-connection plumbing and lifecycle, split out of session.js (which owns the SDK query and
// message tracking) to keep both under their length caps. A browser connection is NO LONGER the
// session's lifeline: the socket is swappable (Conn), and a disconnect DETACHES rather than aborts,
// so a reconnecting client re-attaches to the same still-running session (registry.js) and its
// sub-agents survive. This module holds the logger/inbox/waitFor primitives plus the
// detach/grace/teardown machinery and the re-attach hooks. It imports no VALUES from session.js
// (only the SessionState type, which is erased), so there is no runtime import cycle.
import { createWriteStream } from "node:fs";
import path from "node:path";
import { LOG_DIR } from "./config.js";
import { registerLive, dropLive } from "./registry.js";
import { emitRunning } from "./stream.js";
import { readTasks } from "../features/tasks/tasks-store.js";
import { readPromotions } from "../features/promotions/promotions-store.js";
import { readAutonomous } from "../features/autonomous/autonomous-store.js";

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").Reply} Reply */
/** @typedef {import("../../lib/types.js").WaitFor} WaitFor */
/** @typedef {import("../../lib/types.js").RunningAgentWire} RunningChip */
/** @typedef {import("./session.js").SessionState} SessionState */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {Map<number, { type: string, resolve: (value: Reply) => void, msg: OutMsg }>} Pending */
/** @typedef {ReturnType<typeof createInbox>} Inbox */
/** A swappable browser connection: the live socket (null while detached) plus the queue of
 * outgoing messages buffered while detached, replayed on re-attach. `send` targets this, not a
 * captured `ws`, so a reconnecting client re-binds to the SAME live session.
 * @typedef {{ socket: (import("ws").WebSocket | null), buffer: OutMsg[] }} Conn */
/** A live session, re-bindable across browser connections. Held in the registry (registry.js)
 * keyed by its SDK session id while running; a reconnecting client re-attaches to it instead of
 * cold-resuming from disk, so its in-flight sub-agents survive a disconnect.
 * @typedef {{
 *   id: string | null,
 *   conn: Conn,
 *   inbox: Inbox,
 *   pending: Pending,
 *   abort: AbortController,
 *   session: SessionState,
 *   busy: { value: boolean },
 *   send: (obj: OutMsg) => void,
 *   log: (dir: string, obj: OutMsg) => void,
 *   endLog: () => void,
 *   graceTimer: (ReturnType<typeof setTimeout> | null),
 *   announced: boolean,
 *   done: boolean,
 *   resync: () => void,
 * }} LiveSession */

// While detached, buffer at most this many outgoing messages for replay on re-attach. A session
// that works for a long time with no client (autonomous mode) would otherwise grow the buffer
// unbounded; keep the most recent ones — the client reconciles snapshots on re-attach anyway
// (resync), so dropping the oldest event chatter is harmless.
const MAX_DETACHED_BUFFER = 2000;

// How long a DETACHED + idle session waits for the client to re-attach before teardown. Grace
// policy = "until idle": while a turn / sub-agent is running the session is kept alive with NO
// timer (evaluateGrace); only once it goes idle with no client attached does this short window
// start — so a quick refresh / phone-wake re-attaches, but a truly-abandoned idle session is reaped.
const IDLE_DETACH_GRACE_MS = 75_000;

/** Per-connection NDJSON logger + the `send` that mirrors every outgoing message into it. `send`
 * targets `conn.socket` (swappable) and BUFFERS into `conn.buffer` while detached (socket null),
 * so a reconnecting client re-binds to this same session. @param {Conn} conn */
export function createLogger(conn) {
  const sessionTag = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(LOG_DIR, `session-${sessionTag}.ndjson`);
  const logStream = createWriteStream(logFile, { flags: "a" });
  /** @param {string} dir @param {OutMsg} obj */
  const log = (dir, obj) => {
    logStream.write(JSON.stringify({ ts: new Date().toISOString(), dir, ...obj }) + "\n");
    const m = obj.message;
    const brief =
      obj.type === "event"
        ? `${m?.type ?? ""}${m?.subtype ? "/" + m.subtype : ""}`
        : (obj.type ?? "");
    console.log(`[${sessionTag}] ${dir} ${brief}`);
  };
  /** @param {OutMsg} obj */
  const send = (obj) => {
    log("out", obj);
    const s = conn.socket;
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(obj));
    else {
      conn.buffer.push(obj);
      if (conn.buffer.length > MAX_DETACHED_BUFFER) conn.buffer.shift();
    }
  };
  console.log(`session log: ${logFile}`);
  return { log, send, end: () => logStream.end() };
}

/** The user side of the session: an async iterable the SDK consumes, fed by
 * the browser's user_input messages. */
export function createInbox() {
  /** @type {SDKUserMessage[]} */
  const queue = [];
  /** @type {(() => void) | null} */
  let wake = null;
  let closed = false;
  // Re-iterable over a PERSISTENT queue: each [Symbol.asyncIterator]() mints a fresh
  // generator, so a 529-retry's second query() gets a live iterator after the SDK called
  // .return() on the first one at teardown. push/close and the `iterable` property are
  // unchanged, so every other consumer (check loop, hermesPush, board turns) is untouched.
  // Only one query() is ever live at a time, so two iterators never race on queue.shift().
  async function* gen() {
    while (!closed) {
      let next;
      while ((next = queue.shift())) yield next;
      if (closed) return;
      await new Promise((resolve) => {
        wake = () => {
          resolve(undefined);
        };
      });
    }
  }
  const iterable = { [Symbol.asyncIterator]: () => gen() };
  return {
    iterable,
    /** @param {SDKUserMessage} msg */
    push(msg) {
      queue.push(msg);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
  };
}

/** @param {(obj: OutMsg) => void} send @param {Pending} pending @returns {WaitFor} */
export function makeWaitFor(send, pending) {
  let nextId = 1;
  return (type, payload) => {
    const id = nextId++;
    // Keep the exact wire message: a client that re-attaches (or fully reloads) after the card
    // was raised gets it replayed (replayPending), so an open approval survives a disconnect.
    const msg = { type, id, ...payload };
    send(msg);
    return new Promise((resolve) => {
      pending.set(id, { type, resolve, msg });
    });
  };
}

/** Decide a detached session's fate. Attached OR actively working → keep alive (cancel any pending
 * teardown). Detached AND idle → arm the short idle-grace, after which teardown fires. Idempotent;
 * called on detach, on every turn boundary (busy flips), and on re-attach. @param {LiveSession} ls */
export function evaluateGrace(ls) {
  if (ls.conn.socket || ls.busy.value) {
    if (ls.graceTimer) {
      clearTimeout(ls.graceTimer);
      ls.graceTimer = null;
    }
    return;
  }
  ls.graceTimer ??= setTimeout(() => {
    teardown(ls);
  }, IDLE_DETACH_GRACE_MS);
}

/** End a session for good (idle grace expired, or the stream terminated). Settle every pending
 * interaction so canUseTool / the form handler return — an unresolved promise leaves an orphaned
 * process whose transcript ends mid-tool_use (which 400s any later resume). Then stop the check
 * loop, abort the CLI (this is what finally kills the sub-agents), close the log, and drop it from
 * the registry so a reconnect falls back to disk-resume. Idempotent via the `done` flag — it runs
 * from both the grace timer and runSession's terminal `finally`. @param {LiveSession} ls */
export function teardown(ls) {
  if (ls.done) return;
  ls.done = true;
  if (ls.graceTimer) {
    clearTimeout(ls.graceTimer);
    ls.graceTimer = null;
  }
  ls.session.autonomousLoop?.disarm();
  ls.inbox.close();
  for (const { type, resolve } of ls.pending.values()) {
    resolve(type === "permission" ? { allow: false } : { cancelled: true });
  }
  ls.pending.clear();
  ls.abort.abort();
  ls.endLog();
  console.log(`[${ls.id ?? "pre-id"}] teardown — session ended`);
  if (ls.id) dropLive(ls.id);
}

/** A browser socket closed. DON'T abort — DETACH: null the socket (so `send` buffers) and let the
 * grace policy decide whether/when to tear down. The autonomous loop and all pending approvals are
 * left intact so the session keeps running. Guarded by socket identity, so a stale `close` from a
 * socket that has already been replaced is a no-op. @param {import("ws").WebSocket} ws @param {LiveSession} ls */
export function onSocketDetach(ws, ls) {
  if (ls.conn.socket !== ws) return;
  ls.conn.socket = null;
  evaluateGrace(ls);
  // One readable trail for the reconnect path: detach → reattach (recovered) vs detach → teardown
  // (reaped). The device test (background a mobile tab mid-subagent) watches for these.
  console.log(`[${ls.id ?? "pre-id"}] detach — kept alive (${ls.busy.value ? "working" : "idle"})`);
}

/** Re-send the open approval cards (ask / form / permission) to a (re)attached client, so a card
 * raised before the disconnect — and lost on a full page reload — reappears. The client de-dupes by
 * id, so an in-page reconnect that still shows the card won't double-render. @param {LiveSession} ls */
export function replayPending(ls) {
  for (const { msg } of ls.pending.values()) ls.send(msg);
}

/** Flush messages buffered while detached to the freshly-attached socket, in order. @param {LiveSession} ls */
export function flushBuffer(ls) {
  const s = ls.conn.socket;
  if (!s || s.readyState !== s.OPEN) return;
  const buffered = ls.conn.buffer;
  ls.conn.buffer = [];
  for (const obj of buffered) s.send(JSON.stringify(obj));
}

/** Build the three reconnect hooks for a live session: `resync` (re-emit snapshots so a (re)attached
 * client rebuilds its view), `onSessionId` (register in the registry + announce the id once), and
 * `onBusyChange` (drive the detach grace at turn boundaries). Extracted from runSession to keep it
 * under its line cap and to colocate the re-attach machinery.
 * @param {{ ls: LiveSession, send: (obj: OutMsg) => void, session: SessionState, runningByTask: Map<string, RunningChip> }} deps
 * @returns {{ resync: () => void, onSessionId: (id: string) => void, onBusyChange: () => void }} */
export function buildSessionHooks({ ls, send, session, runningByTask }) {
  // Re-emit every authoritative snapshot the client needs to rebuild its view from scratch — used
  // at startup AND when a reconnecting client re-attaches (reattach calls ls.resync).
  const resync = () => {
    send({ type: "policy", value: session.policy });
    send({ type: "tasks", tasks: readTasks() });
    emitRunning(runningByTask, send);
    send({ type: "promotions", items: readPromotions() });
    send({ type: "autonomousMode", payload: readAutonomous() });
  };
  ls.resync = resync;
  // Register in the live-session registry the moment the SDK reveals the session id (mid-stream),
  // so a reconnecting client can re-attach. Idempotent across 529-resumes (same id); re-keys if it
  // ever changes. Announce the id once so a fresh page learns its reconnect key.
  const onSessionId = (/** @type {string} */ id) => {
    if (ls.announced && ls.id === id) return;
    if (ls.id && ls.id !== id) dropLive(ls.id);
    ls.id = id;
    registerLive(id, ls);
    if (!ls.announced) {
      ls.announced = true;
      send({ type: "session", id });
    }
  };
  // Re-evaluate the detach grace at each turn boundary (busy flips): keep a detached session alive
  // while a sub-agent runs, start the idle window once it goes quiet.
  const onBusyChange = () => {
    evaluateGrace(ls);
  };
  return { resync, onSessionId, onBusyChange };
}
