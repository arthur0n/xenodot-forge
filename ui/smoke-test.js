// Scripted browser: connects to the UI server, sends one prompt, auto-answers
// questions and auto-allows permissions, prints the session.
// Usage: node ui/smoke-test.js ["prompt"]
import WebSocket from "ws";
import { parseJSON } from "./lib/json.js";

/** @typedef {import("./lib/types.js").ServerMsg} ServerMsg */
/** @typedef {import("./lib/types.js").SdkEvent} SdkEvent */
/** @typedef {import("./lib/types.js").ContentBlock} ContentBlock */

const resume = process.argv[3]; // optional session id to resume
const PORT = Number(process.env.PORT ?? 8338);
const ws = new WebSocket(`ws://localhost:${PORT}${resume ? `?resume=${resume}` : ""}`);
/** @param {object} o */
const send = (o) => {
  ws.send(JSON.stringify(o));
};
const prompt = process.argv[2] ?? "Reply with exactly: POC-OK. Do not use any tools.";

ws.on("open", () => {
  console.log("[client] connected, sending prompt");
  send({ type: "user_input", text: prompt });
});

/** @param {ContentBlock} b */
function handleBlock(b) {
  if (b.type === "text") console.log("[assistant]", b.text);
  if (b.type === "tool_use") console.log("[tool_use]", b.name);
}

/** @param {SdkEvent} msg */
function handleEvent(msg) {
  if (msg.type === "system") console.log("[system]", msg.subtype, msg.model ?? "");
  if (msg.type === "assistant") for (const b of msg.message?.content ?? []) handleBlock(b);
  if (msg.type === "result") {
    console.log("[result]", msg.subtype, `$${(msg.total_cost_usd ?? 0).toFixed(4)}`);
    process.exit(msg.subtype === "success" ? 0 : 1);
  }
}

/** @param {Extract<ServerMsg, { type: "form" }>} m */
function handleForm(m) {
  /** @type {Record<string, string | number | boolean | string[]>} */
  const values = {};
  for (const f of m.input?.fields ?? []) {
    if (f.type === "note") continue; // read-only, returns no value
    values[f.id] =
      f.type === "checkbox"
        ? true
        : f.type === "multiselect"
          ? /** @type {string[]} */ ([f.options?.[0]?.label].filter(Boolean))
          : f.type === "select"
            ? (f.options?.[0]?.label ?? "")
            : f.type === "number"
              ? 1
              : "smoke";
    console.log("[form]", f.id, "→", JSON.stringify(values[f.id]));
  }
  send({ type: "reply", id: m.id, payload: { values } });
}

/** @param {Extract<ServerMsg, { type: "ask" }>} m */
function handleAsk(m) {
  const questions = m.input?.questions ?? [];
  /** @type {Record<string, string>} */
  const answers = {};
  for (const q of questions) {
    const first = q.options?.[0];
    answers[q.question] = typeof first === "string" ? first : (first?.label ?? "yes");
    console.log("[ask]", q.question, "→", answers[q.question]);
  }
  send({ type: "reply", id: m.id, payload: { answers } });
}

ws.on("message", (data) => {
  const m = /** @type {ServerMsg} */ (parseJSON(data));
  if (m.type === "status") console.log("[status]", m.text);
  else if (m.type === "history") console.log("[history]", (m.items ?? []).length, "items replayed");
  else if (m.type === "event") handleEvent(m.message);
  else if (m.type === "permission") {
    console.log("[permission]", m.toolName, "→ allowing");
    send({ type: "reply", id: m.id, payload: { allow: true } });
  } else if (m.type === "form") handleForm(m);
  else if (m.type === "ask") handleAsk(m);
});

ws.on("error", (e) => {
  console.error("[client] error:", e.message);
  process.exit(1);
});
setTimeout(
  () => {
    console.error("[client] timeout");
    process.exit(1);
  },
  Number(process.env.SMOKE_TIMEOUT_MS ?? 180000),
);
