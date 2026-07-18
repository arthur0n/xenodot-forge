// WebSocket transport. Owns the socket and `send`; every incoming message is
// folded into the store (store.js → reducer.js) and the store's per-slice
// subscribers render. The only non-store work left here: the interactive
// approval cards (still imperative — they settle correctly on their own path),
// mirroring the policy into its dropdown, and kicking a project re-read after a
// turn so newly created files appear.
//
// The socket is NO LONGER the session's lifeline: the server keeps a session (and its
// sub-agents) running for a grace window after a disconnect, so on close we AUTO-RECONNECT with
// backoff to `?resume=<sessionId>` and the server re-attaches us to the same live session — an idle
// tab, a sleeping phone, or a flaky network no longer kills the run. Only after we give up do we
// fall back to "ended — refresh".
import { $input } from "./dom.js";
import { parseJSON } from "../../lib/json.js";
import { resumeId } from "./state.js";
import { renderAsk, renderPermission } from "../features/approvals/approvals.js";
import { renderForm } from "../features/approvals/form.js";
import { loadState } from "../features/project/project-tree.js";
import { dispatch, update, getState } from "./store.js";

/** @typedef {import("../../lib/types.js").ServerMsg} ServerMsg */

const MAX_RECONNECT_ATTEMPTS = 10; // backoff for a couple minutes, then declare the session ended
const MAX_BACKOFF_MS = 15_000;

/** @type {WebSocket | null} */
let ws = null;
let attempts = 0;
/** Outgoing messages enqueued while the socket is down, flushed on (re)open so a click made during
 * a brief reconnect isn't lost. @type {object[]} */
const outbox = [];

/** The re-attach/resume key: the live session id once the server has announced it (the `session`
 * message), else the `?resume=<id>` the page opened with (null for a fresh session).
 * @returns {string | null} */
function reconnectId() {
  return getState().session.id ?? resumeId;
}

function wsUrl() {
  const id = reconnectId();
  return `ws://${location.host}${id ? `?resume=${encodeURIComponent(id)}` : ""}`;
}

/** Send a JSON message to the server, buffering while the socket is down. @param {object} o */
export function send(o) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
  else outbox.push(o);
}

function flushOutbox() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  while (outbox.length) ws.send(JSON.stringify(/** @type {object} */ (outbox.shift())));
}

function connect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    attempts = 0;
    update((s) => ({
      ...s,
      connection: { open: true },
      // Drop the transient reconnect banner; the re-attach resync repaints everything else.
      session:
        s.session.status === "reconnecting…" ? { ...s.session, status: "running" } : s.session,
    }));
    flushOutbox();
  };
  ws.onmessage = handleMessage;
  ws.onerror = () => {
    // A socket error is always followed by `close`, where the reconnect logic lives — nothing here.
  };
  ws.onclose = () => {
    update((s) => ({
      ...s,
      connection: { open: false },
      busy: false,
      thinking: { active: false, label: "" },
    }));
    if (attempts < MAX_RECONNECT_ATTEMPTS) {
      attempts += 1;
      const delay = Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
      // KEEP the running strip: the server holds the session alive through its grace window, so the
      // sub-agents are still running and get re-synced on re-attach. Clearing here would flash the
      // strip empty on every blip.
      update((s) => ({ ...s, session: { ...s.session, status: "reconnecting…" } }));
      setTimeout(connect, delay);
    } else {
      // Gave up — the grace window has almost certainly lapsed and the session is gone. (A manual
      // refresh still re-attaches if it somehow survived: ?resume carries the id.)
      update((s) => ({
        ...s,
        running: [],
        session: { ...s.session, status: "ended — refresh for a new session" },
      }));
    }
  };
}

/** @param {MessageEvent} ev */
function handleMessage(ev) {
  const m = /** @type {ServerMsg} */ (parseJSON(ev.data));
  dispatch(m); // the store + its subscribers render everything stateful
  switch (m.type) {
    case "ask":
      renderAsk(m);
      break;
    case "form":
      renderForm(m);
      break;
    case "permission":
      renderPermission(m);
      break;
    case "policy":
      $input("mode-select").value = m.value;
      break;
    case "event":
      if (m.message.type === "result") void loadState(); // agents may have created files
      break;
    case "tasks":
    case "running":
    case "promotions":
    case "status":
    case "history":
    case "permission_denied":
    case "context":
    case "hermes":
    case "extAgent":
    case "session":
    case "autonomousMode":
    case "idle":
      break; // fully handled by the store
  }
}

connect();
