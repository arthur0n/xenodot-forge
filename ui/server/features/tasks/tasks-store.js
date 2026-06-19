// Persistent task store — the orchestrator's working to-do list, kept in a
// local JSON file next to the game project so it survives across sessions
// (resume). Pure disk module: no per-connection state, re-read/written on each
// mutation. The MCP `tasks` tool (task-tool.js) and the user's `task_update`
// messages (session.js) both funnel through applyOp.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseJSON } from "../../../lib/json.js";
import { PROJECT_DIR } from "../../core/config.js";

/** @typedef {import("../../../lib/types.js").Task} Task */

const OWNERS = new Set(["agent", "user"]);
const STATUSES = new Set(["pending", "in_progress", "done"]);

/** @returns {string} */
const tasksDir = () => path.join(PROJECT_DIR, ".xenodot");
/** @returns {string} */
const tasksPath = () => path.join(tasksDir(), "tasks.json");

/** Read the persisted list; an absent or corrupt file is an empty list.
 * @returns {Task[]} */
export function readTasks() {
  try {
    const parsed = parseJSON(readFileSync(tasksPath(), "utf8"));
    return Array.isArray(parsed) ? /** @type {Task[]} */ (parsed) : [];
  } catch {
    return [];
  }
}

/** @param {Task[]} list */
function writeTasks(list) {
  mkdirSync(tasksDir(), { recursive: true });
  writeFileSync(tasksPath(), JSON.stringify(list, null, 2) + "\n");
}

/** Next `t<n>` id, one past the highest numeric suffix in use.
 * @param {Task[]} list @returns {string} */
function nextId(list) {
  const max = list.reduce((m, t) => {
    const n = Number(String(t.id).replace(/^t/, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `t${max + 1}`;
}

/** @param {Task[]} list @param {{ title?: string, owner?: string, note?: string, status?: string, agent?: string, kind?: "question", options?: string[], answer?: string }} spec @param {string} now @returns {Task} */
function makeTask(list, spec, now) {
  return {
    id: nextId(list),
    title: String(spec.title ?? "untitled").slice(0, 200),
    owner: OWNERS.has(spec.owner ?? "") ? /** @type {Task["owner"]} */ (spec.owner) : "agent",
    status: STATUSES.has(spec.status ?? "")
      ? /** @type {Task["status"]} */ (spec.status)
      : "pending",
    note: spec.note ? String(spec.note).slice(0, 500) : undefined,
    // Which agent created this task, so the server can deterministically close a
    // sub-agent's open tasks when it finishes (see closeOpenByAgent). "main" =
    // orchestrator; "background" = a bridged background worker; otherwise the
    // sub-agent's subagent_type. Internal — the client renderer ignores it.
    agent: spec.agent ? String(spec.agent).slice(0, 80) : undefined,
    // Async-question fields (mcp__ui__ask). Absent on ordinary tasks.
    ...(spec.kind === "question" ? { kind: /** @type {const} */ ("question") } : {}),
    ...(Array.isArray(spec.options) && spec.options.length
      ? { options: spec.options.map((o) => String(o).slice(0, 120)).slice(0, 8) }
      : {}),
    ...(spec.answer != null ? { answer: String(spec.answer).slice(0, 1000) } : {}),
    created: now,
  };
}

/**
 * Apply one mutation and persist. Returns the new list (caller broadcasts it).
 * Unknown ids are ignored so a stale UI click can't throw.
 * @param {{ op: string, title?: string, owner?: string, note?: string, status?: string, id?: string, _by?: string, answer?: string, tasks?: Array<{ title?: string, owner?: string, note?: string }> }} op
 * @param {string} now ISO timestamp (the caller stamps it — keeps this testable)
 * @returns {Task[]}
 */
export function applyOp(op, now) {
  let list = readTasks();
  if (op.op === "add") {
    const specs = Array.isArray(op.tasks) ? op.tasks : [op];
    for (const spec of specs) {
      // `_by` (the creating agent) rides on the top-level op — inject it into
      // every spec, including each entry of a batch add, for closeOpenByAgent.
      const task = makeTask(list, { ...spec, agent: op._by }, now);
      list.push(task);
    }
  } else if (op.op === "update") {
    list = list.map((t) => {
      if (t.id !== op.id) return t;
      return {
        ...t,
        ...(op.title != null ? { title: String(op.title).slice(0, 200) } : {}),
        ...(op.note != null ? { note: String(op.note).slice(0, 500) } : {}),
        ...(op.status != null && STATUSES.has(op.status)
          ? { status: /** @type {Task["status"]} */ (op.status) }
          : {}),
        ...(op.owner != null && OWNERS.has(op.owner)
          ? { owner: /** @type {Task["owner"]} */ (op.owner) }
          : {}),
        // Answering an async question resolves it: record the answer and mark it
        // done (so the board stops nagging; the orchestrator reads it next turn).
        ...(op.answer != null
          ? {
              answer: String(op.answer).slice(0, 1000),
              status: /** @type {Task["status"]} */ ("done"),
            }
          : {}),
      };
    });
  } else if (op.op === "remove") {
    list = list.filter((t) => t.id !== op.id);
  }
  writeTasks(list);
  return list;
}

/** Drop agent-owned `done` tasks at a turn boundary so the board reflects live
 * work instead of a graveyard of completed items. Keeps open tasks and every
 * user-owned to-do (those are the user's to clear). Returns the new list, or
 * null when nothing was pruned (so the caller can skip a redundant broadcast).
 * @returns {Task[] | null} */
export function pruneDoneTasks() {
  const list = readTasks();
  const kept = list.filter((t) => !(t.owner === "agent" && t.status === "done"));
  if (kept.length === list.length) return null;
  writeTasks(kept);
  return kept;
}

/** Add one in_progress agent task bridging a backgrounded worker onto the board;
 * returns the new list plus the created id (so the caller can settle it later).
 * Tagged `agent: "background"` so the straggler sweep never touches a live worker.
 * @param {string} title @param {string | undefined} note @param {string} now
 * @returns {{ list: Task[], id: string }} */
export function addBackgroundTask(title, note, now) {
  const list = readTasks();
  const task = makeTask(
    list,
    { title, note, status: "in_progress", owner: "agent", agent: "background" },
    now,
  );
  list.push(task);
  writeTasks(list);
  return { list, id: task.id };
}

/** Normalize a question title for idempotent matching: trim, lowercase, collapse
 * internal whitespace. The single source of truth for "same question" used by both
 * the addQuestion dedup and the inline-ask block (session.js canUseTool).
 * @param {string} s @returns {string} */
export function normalizeQ(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Find an already-open (`status !== "done"`) async question whose title matches
 * `title` (normalized). Returns the existing task, or undefined. Lets a second
 * channel coalesce onto the first instead of opening a divergent record.
 * @param {string} title @returns {Task | undefined} */
export function findOpenQuestion(title) {
  const want = normalizeQ(title);
  return readTasks().find(
    (t) => t.kind === "question" && t.status !== "done" && normalizeQ(t.title) === want,
  );
}

/** File an async question onto the board (see mcp__ui__ask / ask-tool.js) as an
 * `owner:"user"` item the user answers inline. owner:"user" keeps it clear of the
 * pruner and the sub-agent task-closers, so it survives until the user answers and
 * the orchestrator relays it — exactly the durability a fire-and-forget worker's
 * question needs. Idempotent: a re-spawned/looping worker filing the same question
 * coalesces onto the open one (refreshing its options) rather than stacking a
 * duplicate (the addPromotion pattern). @param {string} question
 * @param {string[] | undefined} options @param {string | undefined} agent
 * @param {string} now @returns {Task[]} */
export function addQuestion(question, options, agent, now) {
  const list = readTasks();
  const open = list.find(
    (t) =>
      t.kind === "question" && t.status !== "done" && normalizeQ(t.title) === normalizeQ(question),
  );
  if (open) {
    // Duplicate of a still-open question: refresh options, don't stack a second record.
    if (Array.isArray(options) && options.length) {
      open.options = options.map((o) => String(o).slice(0, 120)).slice(0, 8);
    }
    writeTasks(list);
    return list;
  }
  list.push(
    makeTask(
      list,
      { title: question, options, owner: "user", status: "pending", agent, kind: "question" },
      now,
    ),
  );
  writeTasks(list);
  return list;
}

/** Mark `done` every open (not-done) `owner:"agent"` task, optionally scoped to
 * one creating agent. The deterministic close: callers pass the finishing agent's
 * label so only its tasks close (see closeOpenByAgent / the `complete_open` op).
 * With no `agent`, closes ALL open agent tasks (blunt fallback). Always returns
 * the new list so the caller can broadcast + summarize.
 * @param {string} [agent] @returns {Task[]} */
export function closeOpenAgentTasks(agent) {
  const list = readTasks().map((t) =>
    t.owner === "agent" && t.status !== "done" && (agent == null || t.agent === agent)
      ? { ...t, status: /** @type {Task["status"]} */ ("done") }
      : t,
  );
  writeTasks(list);
  return list;
}

/** Close a specific agent's open tasks (its scratchpad) — called when that
 * sub-agent finishes (task_notification). Same-label workers running in parallel
 * would close each other's tasks, but the orchestrator forbids backgrounding two
 * workers on the same files and foreground runs serially, so collisions don't
 * arise in practice. @param {string} agent @returns {Task[]} */
export function closeOpenByAgent(agent) {
  return closeOpenAgentTasks(agent);
}

/** Turn-end backstop: mark `done` any open `owner:"agent"` task left by a
 * sub-agent that is no longer running — i.e. a foreground straggler whose
 * task_notification never arrived (hard interrupt/abort). Skips the orchestrator's
 * own board (`agent: "main"`), live background workers (`agent: "background"`),
 * and any sub-agent still listed in `running`. Returns the new list, or null when
 * nothing changed (so the caller can skip a redundant broadcast).
 * @param {Set<string>} running labels of sub-agents still in flight
 * @returns {Task[] | null} */
export function closeStragglerTasks(running) {
  const list = readTasks();
  let changed = false;
  const next = list.map((t) => {
    const straggler =
      t.owner === "agent" &&
      t.status !== "done" &&
      t.agent != null &&
      t.agent !== "main" &&
      t.agent !== "background" &&
      !running.has(t.agent);
    if (!straggler) return t;
    changed = true;
    return { ...t, status: /** @type {Task["status"]} */ ("done") };
  });
  if (!changed) return null;
  writeTasks(next);
  return next;
}

/** One-line summary for the tool result. Always names the still-open tasks so the
 * agent can tell at a glance whether its work is closed (not just a count).
 * @param {Task[]} list @returns {string} */
export function summarize(list) {
  const open = list.filter((t) => t.status !== "done");
  const done = list.length - open.length;
  const base = `${list.length} task${list.length === 1 ? "" : "s"} (${done} done).`;
  if (!open.length) return list.length ? `${base} All closed.` : base;
  const items = open.map((t) => `${t.id} ${t.title} [${t.status}]`).join(", ");
  return `${base} OPEN: ${items}`;
}
