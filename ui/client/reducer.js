// Pure fold of every ServerMsg into the store's State. Snapshots replace a
// slice; events append or fold. This is a port of the old websocket.js
// `handle*` dispatch — "mutate the DOM" became "return new state." Each fold
// keeps a slice's reference stable unless it actually changed, so the store's
// per-slice subscribers only fire on real changes (see store.js).
//
// Imports are deliberately DOM-free (format.js + agents.js have no browser
// globals at import time), so this module — and reducer.check.js — run under
// bare node.
import { VERB_KIND, toolDetail } from "./format.js";
import { agentLabel } from "./agents.js";

/** @typedef {import("./store.js").State} State */
/** @typedef {import("./store.js").ChatEntry} ChatEntry */
/** @typedef {import("./store.js").RunningAgent} RunningAgent */
/** @typedef {import("./store.js").Approval} Approval */
/** @typedef {import("../lib/types.js").ServerMsg} ServerMsg */
/** @typedef {import("../lib/types.js").SdkEvent} SdkEvent */
/** @typedef {import("../lib/types.js").ContentBlock} ContentBlock */
/** @typedef {import("../lib/types.js").HistoryItem} HistoryItem */

/** @param {State} s @param {ServerMsg} msg @returns {State} */
export function reduce(s, msg) {
  switch (msg.type) {
    case "tasks":
      return { ...s, tasks: msg.tasks }; // SNAPSHOT — replace
    case "promotions":
      return { ...s, promotions: msg.items }; // SNAPSHOT — replace
    case "policy":
      return { ...s, policy: msg.value }; // SNAPSHOT — replace
    case "history":
      return foldHistory(s, msg.items ?? []);
    case "status":
      return { ...s, chat: [...s.chat, { kind: "banner", text: msg.text }] };
    case "ask":
    case "form":
    case "permission":
      return { ...s, approvals: [...s.approvals, toApproval(msg)] };
    case "permission_denied":
      return foldDenied(s, msg);
    case "idle":
      return foldIdle(s);
    case "context":
      return {
        ...s,
        session: {
          ...s.session,
          contextPct: msg.percentage,
          contextTokens: msg.totalTokens,
          contextMax: msg.maxTokens,
        },
      };
    case "event":
      return reduceEvent(s, msg.message);
    default:
      return s;
  }
}

/** A tool was auto-denied (no interactive approver). Always log it to the
 * activity stream; for a backgrounded denial — which the user can't see
 * inline — also raise a chat banner so the friction is loud, not silent.
 * @param {State} s @param {Extract<ServerMsg, { type: "permission_denied" }>} msg @returns {State} */
function foldDenied(s, msg) {
  const reason = msg.background ? "background" : (msg.reason ?? "denied");
  const row = {
    kind: "deny",
    agent: msg.agent ?? "main",
    verb: "Denied",
    detail: `${msg.toolName} · ${reason}`,
  };
  const next = { ...s, activity: [...s.activity, row] };
  if (!msg.background) return next;
  const text = `${agentLabel(msg.agent ?? "agent")} couldn't use ${msg.toolName} (background auto-deny) — run it foreground or grant a permission mode.`;
  return { ...next, chat: [...next.chat, { kind: "banner", text }] };
}

/** Session/turn truly settled (every SDK stream exit path emits this). Clear the
 * busy flag, the thinking indicator and the whole running strip — the backstop
 * for any turn that ended without a `result` event (error, abort, early end), the
 * main cause of a stuck "agent running". Identity-preserving when nothing is live.
 * @param {State} s @returns {State} */
function foldIdle(s) {
  if (!s.busy && !s.running.length && !s.thinking.active) return s;
  return {
    ...s,
    busy: false,
    thinking: { active: false, label: "" },
    running: [],
    session: { ...s.session, status: s.session.status || "idle" },
  };
}

/** @param {State} s @param {HistoryItem[]} items @returns {State} */
function foldHistory(s, items) {
  /** @type {ChatEntry[]} */
  const entries = items.map((it) =>
    it.role === "user"
      ? { kind: "user", text: it.text }
      : { kind: "agent", who: "main", text: it.text },
  );
  return { ...s, chat: [...s.chat, ...entries] };
}

/** @param {Extract<ServerMsg, { type: "ask" | "form" | "permission" }>} msg @returns {Approval} */
function toApproval(msg) {
  if (msg.type === "ask")
    return { id: msg.id, kind: "ask", agent: msg.agent, questions: msg.input?.questions };
  if (msg.type === "form") return { id: msg.id, kind: "form", agent: msg.agent, form: msg.input };
  return {
    id: msg.id,
    kind: "permission",
    agent: msg.agent,
    toolName: msg.toolName,
    toolInput: msg.input,
  };
}

// ---------- the polymorphic SDK `event` fold ----------

/** @param {State} s @param {SdkEvent} m @returns {State} */
function reduceEvent(s, m) {
  if (m.type === "system" && m.subtype === "init") return foldInit(s, m);
  if (m.type === "system" && m.subtype === "task_started") return foldTaskStarted(s, m);
  if (m.type === "system" && m.subtype === "task_notification") return foldTaskNotification(s, m);
  if (m.type === "assistant") return foldAssistant(s, m);
  if (m.type === "user") return foldUser(s, m);
  if (m.type === "result") return foldResult(s, m);
  return s; // unknown subtype — identity-preserving no-op
}

/** @param {State} s @param {SdkEvent} m @returns {State} */
function foldInit(s, m) {
  const model = m.model ?? "";
  return {
    ...s,
    session: { model, status: "running" },
    activity: [...s.activity, { kind: "session", agent: "main", verb: "Sess", detail: model }],
  };
}

/** Bind a backgrounded spawn's SDK task id to its chip (so it survives the
 * end-of-turn clear and gets a per-chip stop). @param {State} s @param {SdkEvent} m @returns {State} */
function foldTaskStarted(s, m) {
  const id = m.tool_use_id;
  const taskId = m.task_id;
  if (!id || !taskId) return s;
  let changed = false;
  const running = s.running.map((r) => {
    if (r.id !== id) return r;
    changed = true;
    return { ...r, taskId, background: true };
  });
  return changed ? { ...s, running } : s;
}

/** A backgrounded worker settled: drop its chip and post a result banner.
 * @param {State} s @param {SdkEvent} m @returns {State} */
function foldTaskNotification(s, m) {
  const chip = s.running.find(
    (r) =>
      (m.tool_use_id != null && r.id === m.tool_use_id) ||
      (m.task_id != null && r.taskId === m.task_id),
  );
  const running = chip ? s.running.filter((r) => r !== chip) : s.running;
  const tail = m.summary ? ` — ${m.summary.slice(0, 160)}` : "";
  const text = `${agentLabel(chip?.label ?? "agent")} ${m.status ?? "done"}${tail}`;
  return { ...s, running, chat: [...s.chat, { kind: "banner", text }] };
}

/** Turn end: fold usage, drop the thinking indicator, clear FOREGROUND chips
 * (background workers outlive the turn), mark idle. Replaces running.js#clearAll
 * — now a pure state transition that can't desync the DOM. @param {State} s @param {SdkEvent} m @returns {State} */
function foldResult(s, m) {
  const u = m.usage ?? {};
  const hasForeground = s.running.some((r) => !r.background);
  const cost = (m.total_cost_usd ?? 0).toFixed(3);
  return {
    ...s,
    usage: {
      cost: s.usage.cost + (m.total_cost_usd ?? 0),
      tokens: s.usage.tokens + (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    },
    busy: false,
    thinking: { active: false, label: "" },
    running: hasForeground ? s.running.filter((r) => r.background) : s.running,
    session: {
      ...s.session,
      status: `idle · last turn ${Math.round((m.duration_ms ?? 0) / 1000)}s`,
    },
    activity: [
      ...s.activity,
      {
        kind: "session",
        agent: "main",
        verb: "Sess",
        detail: `turn ${m.subtype ?? ""} — $${cost}`,
      },
    ],
  };
}

/** @param {State} s @param {SdkEvent} m @returns {State} */
function foldAssistant(s, m) {
  const who = m.subagent_type ?? labelForParent(s, m.parent_tool_use_id) ?? "main";
  let next = who === "main" && !s.busy ? { ...s, busy: true } : s;
  for (const b of m.message?.content ?? []) next = foldBlock(next, b, who);
  return next;
}

/** The actor for a sub-agent message that omits subagent_type: the chip its
 * spawn id maps to. @param {State} s @param {string | null | undefined} parentId @returns {string | undefined} */
function labelForParent(s, parentId) {
  if (!parentId) return undefined;
  return s.running.find((r) => r.id === parentId)?.label;
}

/** @param {State} s @param {ContentBlock} b @param {string} who @returns {State} */
function foldBlock(s, b, who) {
  if (b.type === "text") return foldText(s, b.text ?? "", who);
  if (b.type === "tool_use") return foldToolUse(s, b, who);
  return s;
}

/** Main's prose goes to the chat column; a sub-agent's prose to the activity log.
 * @param {State} s @param {string} text @param {string} who @returns {State} */
function foldText(s, text, who) {
  if (!text.trim()) return s;
  if (who === "main") return { ...s, chat: [...s.chat, { kind: "agent", who: "main", text }] };
  return {
    ...s,
    activity: [...s.activity, { kind: "say", agent: who, text: text.trim().slice(0, 200) }],
  };
}

/** @param {State} s @param {ContentBlock} b @param {string} who @returns {State} */
function foldToolUse(s, b, who) {
  const name = b.name ?? "tool";
  if ((name === "Task" || name === "Agent") && b.id) return foldSpawn(s, b, who);
  if (name === "TodoWrite" && b.input?.todos) return { ...s, todos: b.input.todos };
  const verb = name === "mcp__ui__form" ? "Form" : name;
  const detail = toolDetail(b.input);
  return {
    ...s,
    thinking: { active: true, label: detail ? `${verb} · ${detail.slice(0, 60)}` : verb },
    activity: [...s.activity, { kind: VERB_KIND[name] ?? "task", verb, agent: who, detail }],
  };
}

/** @param {State} s @param {ContentBlock} b @param {string} who @returns {State} */
function foldSpawn(s, b, who) {
  const id = b.id;
  if (!id) return s;
  const label = b.input?.subagent_type ?? "agent";
  const desc = b.input?.description ?? "";
  /** @type {RunningAgent} */
  const chip = {
    id,
    label,
    desc,
    started: Date.now(),
    background: Boolean(b.input?.run_in_background),
  };
  return {
    ...s,
    running: [...s.running, chip],
    thinking: { active: true, label: `Spawn · ${(desc || label).slice(0, 60)}` },
    activity: [...s.activity, { kind: "spawn", agent: who, child: label, detail: desc }],
  };
}

/** A tool_result ends a FOREGROUND sub-agent (a backgrounded worker's immediate
 * "running in the background" result must not remove its chip — its
 * task_notification does). @param {State} s @param {SdkEvent} m @returns {State} */
function foldUser(s, m) {
  let running = s.running;
  for (const b of m.message?.content ?? []) {
    if (b.type !== "tool_result" || !b.tool_use_id) continue;
    const chip = running.find((r) => r.id === b.tool_use_id);
    if (chip && !chip.background) running = running.filter((r) => r !== chip);
  }
  return running === s.running ? s : { ...s, running };
}
