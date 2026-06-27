// Agent/board settle helpers, split out of session.js (which sits at its line cap). These
// share the bgBoard/runningByTask state and the same "an agent finished — clean it up"
// semantics: bridge a backgrounded sub-agent onto the task board, close a finished agent's
// own tasks, retire it from the authoritative running set, and re-emit the strip.
import {
  addBackgroundTask,
  applyOp,
  closeOpenByAgent,
  closeStragglerTasks,
} from "../features/tasks/tasks-store.js";
import { emitRunning } from "./stream.js";

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").RunningAgentWire} RunningChip */

/** Bridge a backgrounded sub-agent onto the persistent board as an in_progress
 * agent task, so background work shows in the right rail (not just the running
 * strip). Only run_in_background spawns are bridged; foreground sub-agents are
 * not (they'd clutter the board). Idempotent per task_id.
 * @param {{ taskId?: string, toolUseId?: string, desc?: string }} t
 * @param {{ bgSpawns: Set<string>, bgBoard: Map<string, string>, send: (obj: OutMsg) => void }} deps
 */
export function bridgeStart(t, { bgSpawns, bgBoard, send }) {
  if (!t.taskId || !t.toolUseId || !bgSpawns.has(t.toolUseId) || bgBoard.has(t.taskId)) return;
  const title = (t.desc ?? "background task").slice(0, 200);
  const { list, id } = addBackgroundTask(title, "background worker", new Date().toISOString());
  bgBoard.set(t.taskId, id);
  send({ type: "tasks", tasks: list });
}

/** Settle a bridged background task when its worker finishes: completed → mark
 * done (auto-pruned next turn); failed/stopped → remove it.
 * @param {{ taskId?: string, status?: string }} t
 * @param {{ bgBoard: Map<string, string>, send: (obj: OutMsg) => void }} deps
 */
export function bridgeSettle(t, { bgBoard, send }) {
  if (!t.taskId) return;
  const boardId = bgBoard.get(t.taskId);
  if (!boardId) return;
  bgBoard.delete(t.taskId);
  const now = new Date().toISOString();
  const list =
    t.status === "completed"
      ? applyOp({ op: "update", id: boardId, status: "done" }, now)
      : applyOp({ op: "remove", id: boardId }, now);
  send({ type: "tasks", tasks: list });
}

/** Close a finished sub-agent's own open tasks (its scratchpad), keyed by the
 * agent label recorded at task_started. task_notification fires for foreground
 * AND background sub-agents, so this deterministically restores the inline close
 * that the background change removed for foreground work — no LLM cooperation
 * needed. @param {string | undefined} taskId
 * @param {{ runningByTask: Map<string, RunningChip>, send: (obj: OutMsg) => void }} deps */
export function settleAgentTasks(taskId, { runningByTask, send }) {
  if (!taskId) return;
  const label = runningByTask.get(taskId)?.label;
  runningByTask.delete(taskId);
  if (!label) return;
  send({ type: "tasks", tasks: closeOpenByAgent(label) });
}

/** Turn-end backstop: close any open sub-agent task whose owner is no longer
 * running — a foreground straggler whose task_notification never arrived (e.g. a
 * hard interrupt). Live sub-agents (incl. background workers) and the
 * orchestrator's own cross-turn board are preserved.
 * @param {{ runningByTask: Map<string, RunningChip>, send: (obj: OutMsg) => void }} deps */
export function sweepStragglers({ runningByTask, send }) {
  const list = closeStragglerTasks(new Set([...runningByTask.values()].map((v) => v.label)));
  if (list) send({ type: "tasks", tasks: list });
}

/** Session-teardown settle: when the SDK stream ends or errors (the whole CLI
 * subprocess — and thus every in-flight background worker — is gone), remove each
 * bridged background board task and close each still-running sub-agent's tasks, so
 * the board doesn't keep a dead worker as in_progress forever.
 * @param {{ bgBoard: Map<string, string>, runningByTask: Map<string, RunningChip>, send: (obj: OutMsg) => void }} deps */
export function settleAllBackground({ bgBoard, runningByTask, send }) {
  for (const taskId of [...bgBoard.keys()]) {
    bridgeSettle({ taskId, status: "stopped" }, { bgBoard, send });
  }
  for (const taskId of [...runningByTask.keys()]) {
    settleAgentTasks(taskId, { runningByTask, send });
  }
}

// Backstop for an agent that finished without the SDK delivering its task_notification
// (settleAgentTasks never ran) — the server-side stranding d846ab9's snapshot fix left
// uncovered, made visible once sessions stopped tearing down on every disconnect (916e8f3).
// Sized by silence, the ONLY liveness signal we have (the SDK Query exposes no live-task
// list). A live agent normally heartbeats via task_progress, but a long quiet step (e.g. a
// godot build) can go silent for minutes: the worst real gap measured for a genuinely-live,
// later-notified agent was ~530s. So the window is deliberately generous (~1.7x that) — a
// finished chip lingering a few minutes is far better than culling a still-working agent
// (its chip would vanish mid-build, taking its stop button with it). The client's 30-min
// sweep can't help here: it only prunes the client copy, and the next emit/reconnect resync
// re-adds the agent because runningByTask still holds it — only this server sweep removes it.
const STALE_AGENT_MS = 15 * 60_000;

/** Backstop sweep: retire any running agent silent past STALE_AGENT_MS so runningByTask can't
 * re-broadcast a finished worker as "running" forever. Settles its board task + own tasks
 * (same as a real notification), then re-emits the strip on any change.
 * @param {{ bgBoard: Map<string, string>, runningByTask: Map<string, RunningChip>, lastSeen: Map<string, number>, send: (obj: OutMsg) => void }} deps */
export function sweepStaleAgents({ bgBoard, runningByTask, lastSeen, send }) {
  const now = Date.now();
  let changed = false;
  for (const taskId of [...runningByTask.keys()]) {
    if (now - (lastSeen.get(taskId) ?? now) < STALE_AGENT_MS) continue;
    bridgeSettle({ taskId, status: "stopped" }, { bgBoard, send });
    settleAgentTasks(taskId, { runningByTask, send });
    lastSeen.delete(taskId);
    changed = true;
  }
  if (changed) emitRunning(runningByTask, send);
}
