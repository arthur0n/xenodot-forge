// Topbar + session status, rendered from the store: the connection dot, model
// name, the session-state line, and cumulative usage. These were scattered
// imperative writes across the websocket handlers and composer; now one
// subscriber owns each, driven purely by state.
import { $ } from "./dom.js";
import { subscribe } from "./store.js";

/** Whether the socket has ever been open — distinguishes "connecting…" at first
 * load from "disconnected" after a drop (both are connection.open === false). */
let everOpen = false;

/** @param {import("./store.js").State} s */
function paintModel(s) {
  $("model-name").textContent = s.connection.open
    ? s.session.model || "connecting…"
    : everOpen
      ? "disconnected"
      : "connecting…";
}

/** Paint the session's context-window meter: bar width = % of the window used,
 * coloured green/amber/red so the user can compact or reset before a long session
 * gets expensive. Red (≥70%) lands before the SDK's own auto-compact (~80–92%), so
 * the user acts on their own schedule, not mid-task.
 * @param {import("./store.js").State["session"]} sess */
function paintContextMeter(sess) {
  const pct = sess.contextPct;
  const bar = $("ctx-bar");
  const label = $("ctx-label");
  if (pct == null) {
    bar.style.width = "0";
    label.textContent = "";
    return;
  }
  const level = pct >= 70 ? "ctx-hot" : pct >= 50 ? "ctx-warn" : "";
  bar.style.width = `${Math.min(100, Math.round(pct))}%`;
  bar.className = `ctx-bar${level ? " " + level : ""}`;
  label.className = `ctx-label${level === "ctx-hot" ? " ctx-hot" : ""}`;
  const used = Math.round((sess.contextTokens ?? 0) / 1000);
  const max = Math.round((sess.contextMax ?? 0) / 1000);
  label.textContent = `context ${used}k / ${max}k · ${Math.round(pct)}%`;
}

export function initStatusbar() {
  subscribe("connection", (conn, s) => {
    if (conn.open) everOpen = true;
    $("conn-dot").classList.toggle("pulse", conn.open);
    $("session-dot").classList.toggle("pulse", conn.open);
    paintModel(s);
  });
  subscribe("session", (sess, s) => {
    $("session-model").textContent = sess.model || "starting…";
    if (sess.status) $("session-meta").textContent = sess.status;
    paintContextMeter(sess);
    paintModel(s);
  });
  subscribe("usage", (u) => {
    if (u.cost > 0 || u.tokens > 0) {
      $("usage").textContent = `$${u.cost.toFixed(2)} · ${(u.tokens / 1000).toFixed(1)}k tok`;
    }
  });
  // The Xenodot mark breathes its machine-spirit glow while the hive works a
  // turn, and settles when idle — the creature reacting to the forge.
  subscribe("busy", (busy) => {
    document.querySelector(".brand")?.classList.toggle("busy", Boolean(busy));
  });
}
