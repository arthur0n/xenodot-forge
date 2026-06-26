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
import { agentLabel } from "../features/agents/agents.js";
import { getPersona } from "../../lib/hermes-personas.js";

/** @typedef {import("./store.js").State} State */
/** @typedef {import("./store.js").ChatEntry} ChatEntry */
/** @typedef {import("./store.js").RunningAgent} RunningAgent */
/** @typedef {import("./store.js").Approval} Approval */
/** @typedef {import("../../lib/types.js").ServerMsg} ServerMsg */
/** @typedef {import("../../lib/types.js").SdkEvent} SdkEvent */
/** @typedef {import("../../lib/types.js").ContentBlock} ContentBlock */
/** @typedef {import("../../lib/types.js").HistoryItem} HistoryItem */

/** @param {State} s @param {ServerMsg} msg @returns {State} */
export function reduce(s, msg) {
  switch (msg.type) {
    case "tasks":
      return { ...s, tasks: msg.tasks }; // SNAPSHOT — replace
    case "running":
      return foldRunningSnapshot(s, msg.agents); // SNAPSHOT — reconcile by id
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
      // De-dupe on id: a re-attaching client gets its open cards replayed (replayPending), which
      // would otherwise double-append one already in the store on an in-page reconnect.
      return s.approvals.some((a) => a.id === msg.id)
        ? s
        : { ...s, approvals: [...s.approvals, toApproval(msg)] };
    case "session":
      return { ...s, session: { ...s.session, id: msg.id } }; // reconnect key (see websocket.js)
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
    case "hermes":
      return foldHermes(s, msg);
    case "autonomousMode":
      return { ...s, autonomousMode: msg.payload }; // SNAPSHOT — replace
    case "event":
      return reduceEvent(s, msg.message);
    default:
      return s;
  }
}

/** A relayed progress line from the external Hermes researcher (mcp__ui__hermes). Logs
 * it to the activity stream and, while a run is live (start/progress), shows it in the
 * thinking indicator; "done" clears the indicator. @param {State} s
 * @param {Extract<ServerMsg, { type: "hermes" }>} msg @returns {State} */
function foldHermes(s, msg) {
  const persona = getPersona(msg.persona);
  const detail = msg.text.slice(0, 200);
  return {
    ...s,
    thinking:
      msg.phase === "done"
        ? { active: false, label: "" }
        : { active: true, label: `${persona.name} · ${detail.slice(0, 60)}` },
    activity: [
      ...s.activity,
      { kind: "hermes", agent: "hermes", verb: persona.name, detail, color: persona.color },
    ],
  };
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
  if (m.type === "rate_limit_event") return foldRateLimit(s, m);
  return s; // unknown subtype — identity-preserving no-op
}

/** Stash the claude.ai plan's live utilization, keyed by window (five_hour |
 * seven_day | …), so the session panel can show actual plan burn ("plan: N%")
 * next to the per-session context meter. @param {State} s @param {SdkEvent} m @returns {State} */
function foldRateLimit(s, m) {
  const info = m.rate_limit_info;
  if (!info?.rateLimitType) return s;
  const pct =
    info.utilization == null
      ? undefined
      : info.utilization <= 1
        ? info.utilization * 100
        : info.utilization;
  return {
    ...s,
    rateLimit: {
      ...s.rateLimit,
      [info.rateLimitType]: { pct, status: info.status, resetsAt: info.resetsAt },
    },
  };
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

// Grace window for the spawn→snapshot race: a chip is created by the spawn tool_use
// fold (foldSpawn) a beat before the server's task_started lands it in the authoritative
// running snapshot. Keep an unmatched chip this new so the reconcile never culls a
// just-spawned agent before the server has acknowledged it.
const RUNNING_GRACE_MS = 4000;

/** Reconcile the running strip against the server's authoritative live set (its
 * `runningByTask` map). Snapshot membership wins: a chip absent from it is dropped — the
 * stale-card fix, since a missed task_notification can no longer strand a chip — UNLESS it
 * was spawned within the grace window. A matched chip keeps its client-only fields
 * (started, stopping, desc) and gains the server's taskId/background; a chip the client
 * never folded (missed spawn) is added. Identity-preserving on an equivalent result, so a
 * no-op snapshot doesn't repaint the strip. @param {State} s
 * @param {import("../../lib/types.js").RunningAgentWire[]} agents @returns {State} */
function foldRunningSnapshot(s, agents) {
  const now = Date.now();
  /** @type {Map<string, import("../../lib/types.js").RunningAgentWire>} */
  const byTool = new Map();
  /** @type {Map<string, import("../../lib/types.js").RunningAgentWire>} */
  const byTask = new Map();
  for (const a of agents) {
    if (a.toolUseId) byTool.set(a.toolUseId, a);
    if (a.taskId) byTask.set(a.taskId, a);
  }
  /** @type {RunningAgent[]} */
  const next = [];
  const taken = new Set();
  for (const r of s.running) {
    const a = byTool.get(r.id) ?? (r.taskId ? byTask.get(r.taskId) : undefined);
    if (a) {
      taken.add(a.toolUseId);
      next.push({ ...r, taskId: a.taskId, background: a.background });
    } else if (now - r.started < RUNNING_GRACE_MS) {
      next.push(r); // spawned a beat ago — its task_started hasn't landed in the snapshot yet
    }
    // else: the authoritative set no longer holds it → drop the stale chip
  }
  for (const a of agents) {
    if (taken.has(a.toolUseId)) continue;
    if (next.some((r) => r.id === a.toolUseId || (r.taskId && r.taskId === a.taskId))) continue;
    next.push({
      id: a.toolUseId,
      label: a.label,
      desc: a.desc,
      started: a.started,
      background: a.background,
      taskId: a.taskId,
    });
  }
  return sameRunning(s.running, next) ? s : { ...s, running: next };
}

/** Equivalent iff same length and, position-for-position, equal identity fields. The
 * reconcile rebuilds chip objects, so this content compare (not ref equality) is what lets
 * a no-op snapshot keep the slice reference and skip a repaint.
 * @param {readonly RunningAgent[]} a @param {readonly RunningAgent[]} b @returns {boolean} */
function sameRunning(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.id === y?.id &&
      x.taskId === y?.taskId &&
      x.background === y?.background &&
      x.stopping === y?.stopping
    );
  });
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
  // Per-turn `result.usage` accumulated into a session ledger. Cache classes
  // usually dwarf raw input/output, so dropping them (as before) under-reported
  // the meter by an order of magnitude — count all four.
  return {
    ...s,
    usage: {
      cost: s.usage.cost + (m.total_cost_usd ?? 0),
      input: s.usage.input + (u.input_tokens ?? 0),
      output: s.usage.output + (u.output_tokens ?? 0),
      cacheCreate: s.usage.cacheCreate + (u.cache_creation_input_tokens ?? 0),
      cacheRead: s.usage.cacheRead + (u.cache_read_input_tokens ?? 0),
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
