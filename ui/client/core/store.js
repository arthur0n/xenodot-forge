// The single client-side source of truth. Every server message folds into
// `state` through the reducer; each view subscribes to ONE slice and renders
// from it. One truth, one paint path — which is what removes the "desync"
// class the old imperative-per-message UI suffered (see reducer.js).
//
// Per-slice subscription (not a central render) keeps a repaint O(its slice):
// a `tasks` message only repaints the task board, because the reducer returns a
// NEW reference for a changed slice and the SAME reference for untouched ones,
// and dispatch only notifies listeners whose slice reference actually changed.
import { reduce } from "./reducer.js";

/** @typedef {import("../../lib/types.js").Task} Task */
/** @typedef {import("../../lib/types.js").Promotion} Promotion */
/** @typedef {import("../../lib/types.js").Todo} Todo */
/** @typedef {import("../../lib/types.js").LogEntry} LogEntry */
/** @typedef {import("../../lib/types.js").FormSpec} FormSpec */
/** @typedef {import("../../lib/types.js").Question} Question */
/** @typedef {import("../../lib/types.js").ToolInput} ToolInput */
/** @typedef {import("../../lib/types.js").ServerMsg} ServerMsg */

/** A chat-column entry. Append-only; rendered by index (no key needed).
 * @typedef {{ kind: "user" | "agent" | "banner", who?: string, text: string }} ChatEntry */

/** A pending interactive card (ask | form | permission), keyed by server id and
 * settled in place when the user replies.
 * @typedef {object} Approval
 * @property {number} id
 * @property {"ask" | "form" | "permission"} kind
 * @property {string} [agent]
 * @property {Question[]} [questions]   - kind "ask"
 * @property {FormSpec} [form]          - kind "form"
 * @property {string} [toolName]        - kind "permission"
 * @property {ToolInput} [toolInput]    - kind "permission"
 * @property {{ note: string, denied?: boolean }} [settled]
 */

/** A live sub-agent chip. `started` drives the view's elapsed ticker.
 * @typedef {{ id: string, label: string, desc: string, started: number,
 *   background: boolean, taskId?: string, stopping?: boolean }} RunningAgent */

/** The "thinking…" indicator state (what tool the hive is on right now).
 * @typedef {{ active: boolean, label: string }} Thinking */

/**
 * @typedef {object} State
 * @property {Task[]} tasks               - replaced wholesale by every `tasks` snapshot
 * @property {Promotion[]} promotions      - replaced wholesale by every `promotions` snapshot
 * @property {string} policy              - replaced by every `policy` snapshot
 * @property {RunningAgent[]} running      - folded from spawn / tool_result / task events
 * @property {Approval[]} approvals        - keyed by id; appended then settled in place
 * @property {ChatEntry[]} chat            - append-only: history + agent text + banners + user input
 * @property {LogEntry[]} activity         - append-only (oldest first; the view prepends)
 * @property {Todo[]} todos                - replaced by each TodoWrite
 * @property {Thinking} thinking
 * @property {{ cost: number, input: number, output: number, cacheCreate: number, cacheRead: number }} usage - per-session run ledger; local SDK-reported estimate, not billing-accurate
 * @property {{ open: boolean }} connection
 * @property {{ model: string, status: string, id?: string | null, contextPct?: number, contextTokens?: number, contextMax?: number }} session - `id` is the SDK session id, the reconnect/re-attach key (set by the server's `session` message)
 * @property {Record<string, { pct?: number, status?: string, resetsAt?: number }>} rateLimit - claude.ai plan utilization, keyed by window (five_hour | seven_day | …)
 * @property {boolean} busy                - hive MAIN turn in flight (drives the composer button)
 * @property {import("../../lib/types.js").Autonomous} autonomousMode - the standing Main Goal + ON/OFF flag (header badge)
 */

/** @returns {State} */
export function initialState() {
  return {
    tasks: [],
    promotions: [],
    policy: "ask",
    running: [],
    approvals: [],
    chat: [],
    activity: [],
    todos: [],
    thinking: { active: false, label: "" },
    usage: { cost: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    connection: { open: false },
    session: { model: "", status: "" },
    rateLimit: {},
    busy: false,
    autonomousMode: {
      active: false,
      goal: "",
      intervalMs: 300000,
      startedAt: null,
      lastCheckAt: null,
      checks: 0,
      status: null,
      report: null,
    },
  };
}

/** @type {State} */
let state = initialState();

/** @typedef {{ slice: keyof State, fn: (value: unknown, full: Readonly<State>) => void }} Listener */
/** @type {Set<Listener>} */
const listeners = new Set();

/** @returns {Readonly<State>} */
export const getState = () => state;

/**
 * Subscribe to ONE slice. Fires immediately with the current value, then on
 * every change where the slice reference differs. Returns an unsubscribe fn.
 * @template {keyof State} K
 * @param {K} slice
 * @param {(value: State[K], full: Readonly<State>) => void} fn
 * @returns {() => void}
 */
export function subscribe(slice, fn) {
  const loose = /** @type {(value: unknown, full: Readonly<State>) => void} */ (
    /** @type {unknown} */ (fn)
  );
  /** @type {Listener} */
  const entry = { slice, fn: loose };
  listeners.add(entry);
  fn(state[slice], state);
  return () => {
    listeners.delete(entry);
  };
}

/** @param {Readonly<State>} prev @param {Readonly<State>} next */
function notify(prev, next) {
  for (const { slice, fn } of listeners) {
    if (!Object.is(prev[slice], next[slice])) fn(next[slice], next);
  }
}

/** Fold a server message into state and notify the slices that changed.
 * @param {ServerMsg} msg */
export function dispatch(msg) {
  const next = reduce(state, msg);
  if (next === state) return;
  const prev = state;
  state = next;
  notify(prev, next);
}

/** Apply a local (non-protocol) state change — connection open/close, the
 * composer's optimistic user message + busy flag. Same notify path as dispatch.
 * @param {(s: Readonly<State>) => State} fn */
export function update(fn) {
  const next = fn(state);
  if (next === state) return;
  const prev = state;
  state = next;
  notify(prev, next);
}
