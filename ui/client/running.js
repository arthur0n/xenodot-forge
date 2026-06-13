// Running-agents panel — shows every sub-agent currently in flight (the
// orchestrator can run several at once), each as a colored chip with its task
// and an elapsed timer. Replaces the old single-agent status bar.
import { $, el } from "./dom.js";
import { paint, agentLabel } from "./agents.js";
import { send } from "./websocket.js";

/** @typedef {{ label: string, desc: string, started: number, background?: boolean, taskId?: string, elapsed?: HTMLElement }} Running */
/** @type {Map<string, Running>} */
const running = new Map(); // tool_use id -> running agent
/** @type {ReturnType<typeof setInterval> | undefined} */
let timer;

/** @param {number} seconds @returns {string} */
function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  return m ? `${m}m ${seconds % 60}s` : `${seconds}s`;
}

function tick() {
  const now = Date.now();
  for (const r of running.values()) {
    if (r.elapsed) r.elapsed.textContent = fmt(Math.floor((now - r.started) / 1000));
  }
}

function render() {
  const box = $("running-agents");
  box.replaceChildren();
  if (!running.size) {
    box.style.display = "none";
    clearInterval(timer);
    timer = undefined;
    return;
  }
  for (const r of running.values()) {
    // paint the chip so --agent-color flows to its border, dot, and name.
    const chip = paint(el("div", "running-agent"), r.label);
    chip.append(el("span", "status-dot"));
    chip.append(el("span", "agent-name", agentLabel(r.label)));
    if (r.desc) chip.append(el("span", "running-target", r.desc));
    r.elapsed = el("span", "elapsed", "0s");
    chip.append(r.elapsed);
    // A backgrounded worker outlives the hive turn, so it gets its own stop
    // (stop_task → query.stopTask), distinct from the group interrupt below.
    if (r.background && r.taskId) {
      const tid = r.taskId;
      const x = el("button", "chip-stop", "✕");
      x.title = "Stop this background agent";
      x.onclick = () => {
        send({ type: "stop_task", taskId: tid });
      };
      chip.append(x);
    }
    box.append(chip);
  }
  const stop = el("button", "running-stop", "■ Stop");
  stop.title = "Stop the hive — interrupt the current turn (background agents have their own ✕)";
  stop.onclick = () => {
    send({ type: "stop" });
  };
  box.append(stop);
  box.style.display = "";
  timer ??= setInterval(tick, 1000);
  tick();
}

/** @param {string} id @param {string} label @param {string} [desc] @param {boolean} [background] */
export function startAgent(id, label, desc, background = false) {
  running.set(id, { label, desc: desc ?? "", started: Date.now(), background });
  render();
}

/** Tie a backgrounded chip to its SDK task id (from task_started) and flag it
 * background, so it survives the end-of-turn clear and gets a per-chip stop.
 * @param {string} id @param {string} taskId */
export function attachTask(id, taskId) {
  const r = running.get(id);
  if (r) {
    r.taskId = taskId;
    r.background = true;
    render();
  }
}

/** True for a backgrounded worker: its immediate "running in the background"
 * tool_result must NOT remove the chip — only its task_notification does.
 * @param {string} id @returns {boolean} */
export function isBackground(id) {
  return Boolean(running.get(id)?.background);
}

/** Remove a chip by tool_use id; returns its label (for a result banner).
 * @param {string} id @returns {string | undefined} */
export function stopAgent(id) {
  const r = running.get(id);
  if (r && running.delete(id)) {
    render();
    return r.label;
  }
  return undefined;
}

/** Remove a backgrounded chip by its SDK task id; returns its label.
 * @param {string} taskId @returns {string | undefined} */
export function stopAgentByTask(taskId) {
  for (const [id, r] of running) {
    if (r.taskId === taskId) {
      running.delete(id);
      render();
      return r.label;
    }
  }
  return undefined;
}

/** Clear FOREGROUND chips — backstop at end of turn. Background workers outlive
 * the turn that spawned them, so they stay until their task_notification. */
export function clearAll() {
  let changed = false;
  for (const [id, r] of running) {
    if (!r.background) {
      running.delete(id);
      changed = true;
    }
  }
  if (changed) render();
}
