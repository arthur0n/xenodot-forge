// WebSocket transport. Owns the socket and `send`; every incoming message is
// folded into the store (store.js → reducer.js) and the store's per-slice
// subscribers render. The only non-store work left here: the interactive
// approval cards (still imperative — they settle correctly on their own path),
// mirroring the policy into its dropdown, and kicking a project re-read after a
// turn so newly created files appear.
import { $input } from "./dom.js";
import { parseJSON } from "../lib/json.js";
import { resumeId } from "./state.js";
import { renderAsk, renderPermission } from "./approvals.js";
import { renderForm } from "./form.js";
import { loadState } from "./project-tree.js";
import { dispatch, update } from "./store.js";

/** @typedef {import("../lib/types.js").ServerMsg} ServerMsg */

const ws = new WebSocket(
  `ws://${location.host}${resumeId ? `?resume=${encodeURIComponent(resumeId)}` : ""}`,
);

/** Send a JSON message to the server. @param {object} o */
export function send(o) {
  ws.send(JSON.stringify(o));
}

ws.onopen = () => {
  update((s) => ({ ...s, connection: { open: true } }));
};
ws.onclose = () => {
  update((s) => ({
    ...s,
    connection: { open: false },
    busy: false,
    thinking: { active: false, label: "" },
    // The socket is the session — once it closes, no chip can ever settle (the
    // server can't reach us with a task_notification/idle). Drop the running
    // strip too, or orphaned chips sit on "agent running" until a refresh.
    running: [],
    session: { ...s.session, status: "ended — refresh for a new session" },
  }));
};

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
    case "promotions":
    case "status":
    case "history":
    case "permission_denied":
    case "context":
    case "idle":
      break; // fully handled by the store
  }
}

ws.onmessage = handleMessage;
