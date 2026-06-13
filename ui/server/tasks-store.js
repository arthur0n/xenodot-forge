// Persistent task store — the orchestrator's working to-do list, kept in a
// local JSON file next to the game project so it survives across sessions
// (resume). Pure disk module: no per-connection state, re-read/written on each
// mutation. The MCP `tasks` tool (task-tool.js) and the user's `task_update`
// messages (session.js) both funnel through applyOp.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseJSON } from "../lib/json.js";
import { PROJECT_DIR } from "./config.js";

/** @typedef {import("../lib/types.js").Task} Task */

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

/** @param {Task[]} list @param {{ title?: string, owner?: string, note?: string, status?: string }} spec @param {string} now @returns {Task} */
function makeTask(list, spec, now) {
  return {
    id: nextId(list),
    title: String(spec.title ?? "untitled").slice(0, 200),
    owner: OWNERS.has(spec.owner ?? "") ? /** @type {Task["owner"]} */ (spec.owner) : "agent",
    status: STATUSES.has(spec.status ?? "")
      ? /** @type {Task["status"]} */ (spec.status)
      : "pending",
    note: spec.note ? String(spec.note).slice(0, 500) : undefined,
    created: now,
  };
}

/**
 * Apply one mutation and persist. Returns the new list (caller broadcasts it).
 * Unknown ids are ignored so a stale UI click can't throw.
 * @param {{ op: string, title?: string, owner?: string, note?: string, status?: string, id?: string, tasks?: Array<{ title?: string, owner?: string, note?: string }> }} op
 * @param {string} now ISO timestamp (the caller stamps it — keeps this testable)
 * @returns {Task[]}
 */
export function applyOp(op, now) {
  let list = readTasks();
  if (op.op === "add") {
    const specs = Array.isArray(op.tasks) ? op.tasks : [op];
    for (const spec of specs) {
      const task = makeTask(list, spec, now);
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
 * @param {string} title @param {string | undefined} note @param {string} now
 * @returns {{ list: Task[], id: string }} */
export function addBackgroundTask(title, note, now) {
  const list = readTasks();
  const task = makeTask(list, { title, note, status: "in_progress", owner: "agent" }, now);
  list.push(task);
  writeTasks(list);
  return { list, id: task.id };
}

/** One-line summary for the tool result. @param {Task[]} list @returns {string} */
export function summarize(list) {
  const done = list.filter((t) => t.status === "done").length;
  return `${list.length} task${list.length === 1 ? "" : "s"} (${done} done).`;
}
