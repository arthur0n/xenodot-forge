// Tasks board — rendered from the store's `tasks` slice (a full server snapshot)
// via the keyed reconciler, so rows keep their handlers and any in-flight fade
// across re-renders. Done tasks self-retire 5s after first seen done; that fade
// is a per-node decoration, never a parallel data model.
import { $, el } from "./dom.js";
import { send } from "./websocket.js";
import { subscribe, getState } from "./store.js";
import { reconcile } from "./reconcile.js";
import { agentColor, agentInitial, agentLabel, agentRole } from "./agents.js";

/** @typedef {import("../lib/types.js").Task} Task */

/** @type {Record<string, string>} Status click order. */
const NEXT_STATUS = { pending: "in_progress", in_progress: "done", done: "pending" };
/** @type {Record<string, string>} */
const TICK = { pending: "○", in_progress: "◐", done: "✓" };

const FADE_AFTER = 5000;
const FADE_MS = 420; // must match the .task-row.fading transition

/** ids whose done-fade has finished — hidden until they reappear non-done.
 * Cleared structurally below the moment a (possibly reused) id comes back live,
 * which is what keeps the server's t<n> id reuse from hiding fresh tasks.
 * @type {Set<string>} */
const dismissed = new Set();
/** id -> active retire timer, so re-renders never stack timers.
 * @type {Map<string, ReturnType<typeof setTimeout>>} */
const retiring = new Map();

/** @param {string} id @returns {HTMLElement | undefined} */
const findRow = (id) =>
  /** @type {HTMLElement[]} */ (Array.from($("tasks-list").children)).find(
    (r) => r.dataset.key === id,
  );

/** @param {string} id */
function cancelRetire(id) {
  const t = retiring.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    retiring.delete(id);
  }
  findRow(id)?.classList.remove("fading");
}

/** Arm the one-shot fade+hide for a done task: 5s, then a 420ms fade, then drop
 * it from the board (the server keeps it). Guarded to one timer per id.
 * @param {string} id */
function armRetire(id) {
  if (retiring.has(id)) return;
  retiring.set(
    id,
    setTimeout(() => {
      findRow(id)?.classList.add("fading");
      retiring.set(
        id,
        setTimeout(() => {
          retiring.delete(id);
          dismissed.add(id);
          render(getState().tasks);
        }, FADE_MS),
      );
    }, FADE_AFTER),
  );
}

/** @param {string} id @param {string} answer */
function submitAnswer(id, answer) {
  const text = answer.trim();
  if (!text) return;
  send({ type: "task_update", op: "update", id, answer: text });
}

/** Inline answer affordance for an async question (mcp__ui__ask): one-click option
 * buttons (if the asker supplied any) plus a free-text box. Built once per row; the
 * answered read-only state is swapped in by updateRow. @param {Task} t @returns {HTMLElement} */
function buildAnswerBox(t) {
  const box = el("div", "task-answer");
  if (t.options?.length) {
    const opts = el("div", "task-answer-options");
    for (const opt of t.options) {
      const b = el("button", "btn", opt);
      b.onclick = () => {
        submitAnswer(t.id, opt);
      };
      opts.append(b);
    }
    box.append(opts);
  }
  const row = el("div", "task-answer-row");
  const input = /** @type {HTMLInputElement} */ (document.createElement("input"));
  input.className = "task-answer-input";
  input.type = "text";
  input.placeholder = "Your answer…";
  const send_ = el("button", "btn primary", "Send");
  send_.onclick = () => {
    submitAnswer(t.id, input.value);
  };
  input.onkeydown = (e) => {
    if (/** @type {KeyboardEvent} */ (e).key === "Enter") submitAnswer(t.id, input.value);
  };
  row.append(input, send_);
  box.append(row);
  return box;
}

/** @param {Task} t @returns {HTMLElement} */
function createRow(t) {
  const row = el("div", "task-row");
  const tick = el("button", "task-tick");
  tick.onclick = () => {
    send({
      type: "task_update",
      op: "update",
      id: t.id,
      status: NEXT_STATUS[row.dataset.status ?? "pending"],
    });
  };
  const body = el("div", "task-body");
  const titleRow = el("div", "task-title-row");
  titleRow.append(el("span", "owner-chip"), el("span", "task-title"));
  body.append(titleRow, el("div", "task-note"));
  // A question carries its own inline answer UI; ordinary tasks don't.
  if (t.kind === "question") body.append(buildAnswerBox(t));
  const remove = el("button", "task-remove", "×");
  remove.title = "remove task";
  remove.onclick = () => {
    send({ type: "task_update", op: "remove", id: t.id });
  };
  row.append(tick, body, remove);
  updateRow(row, t);
  return row;
}

/** Stamp the owner chip. An agent-owned task that knows its creator names the
 * Xenodot that owns it — a filled sigil (the agent's initial) plus its role,
 * tinted by that agent's identity color and echoed as a left accent on the row,
 * so the board tracks the same agent by the same hue the running strip and
 * activity log use. User-owned tasks read "You"; legacy agent tasks with no
 * recorded creator fall back to a plain "Agent" stamp.
 * @param {HTMLElement} row @param {HTMLElement} chip @param {Task} t */
function updateOwnerChip(row, chip, t) {
  const agent = t.owner === "agent" ? t.agent : undefined;
  chip.replaceChildren();
  if (t.owner === "agent") {
    // Always a stamped tag (sigil + label). A known creator names its Xenodot —
    // role, identity color, and a matching row accent. An unattributed agent task
    // (e.g. a legacy entry) gets a generic "Agent" stamp in the default accent.
    row.classList.toggle("identified", Boolean(agent));
    if (agent) row.style.setProperty("--agent-color", agentColor(agent));
    else row.style.removeProperty("--agent-color");
    chip.className = agent ? "owner-chip owner-agent identified" : "owner-chip owner-agent";
    chip.title = agent ? agentLabel(agent) : "";
    chip.append(
      el("span", "owner-sigil", agent ? agentInitial(agent) : "A"),
      el("span", "owner-label", agent ? agentRole(agent) : "Agent"),
    );
  } else {
    row.style.removeProperty("--agent-color");
    chip.className = "owner-chip owner-user";
    chip.title = "";
    chip.append(el("span", "owner-label", "You"));
  }
}

/** @param {HTMLElement} row @param {Task} t */
function updateRow(row, t) {
  row.classList.remove(
    "status-pending",
    "status-in_progress",
    "status-done",
    "owner-agent",
    "owner-user",
    "identified",
  );
  const prevStatus = row.dataset.status;
  row.classList.add(`status-${t.status}`, `owner-${t.owner}`);
  row.dataset.status = t.status;
  const tick = /** @type {HTMLElement | null} */ (row.querySelector(".task-tick"));
  if (tick) {
    tick.textContent = TICK[t.status] ?? "○";
    tick.setAttribute("title", `mark ${NEXT_STATUS[t.status] ?? "pending"}`);
    // Struck-done: when a task FIRST flips to done (not on load or re-render),
    // the tick stamps in like a punch hitting the billet. Restart via reflow so
    // a toggled-back-and-done task replays it.
    if (t.status === "done" && prevStatus && prevStatus !== "done") {
      tick.classList.remove("struck");
      void tick.offsetWidth;
      tick.classList.add("struck");
    }
  }
  const chip = /** @type {HTMLElement | null} */ (row.querySelector(".owner-chip"));
  if (chip) updateOwnerChip(row, chip, t);
  const title = row.querySelector(".task-title");
  if (title) title.textContent = t.title;
  const note = /** @type {HTMLElement | null} */ (row.querySelector(".task-note"));
  if (note) {
    note.textContent = t.note ?? "";
    note.style.display = t.note ? "" : "none";
  }
  // Once a question is answered, swap its input for the read-only answer — guarded
  // so an unanswered question's in-progress typing survives unrelated re-renders.
  const answerBox = /** @type {HTMLElement | null} */ (row.querySelector(".task-answer"));
  if (answerBox && t.kind === "question" && t.answer && answerBox.dataset.answered !== "1") {
    answerBox.dataset.answered = "1";
    answerBox.replaceChildren(el("div", "task-answer-done", `✓ ${t.answer}`));
  }
}

/** @param {readonly Task[]} tasks */
function render(tasks) {
  // A non-done task is live again — clear any stale dismissal/countdown so a
  // reused id (server reuses t<n> after pruning) or a toggled-back task paints.
  for (const t of tasks) {
    if (t.status !== "done") {
      dismissed.delete(t.id);
      cancelRetire(t.id);
    }
  }
  const visible = tasks.filter((t) => !dismissed.has(t.id));
  reconcile($("tasks-list"), visible, { key: (t) => t.id, create: createRow, update: updateRow });
  // Live (not-done) count rides on the Tasks tab; empty placeholder shows when
  // the board has nothing at all.
  const open = visible.filter((t) => t.status !== "done").length;
  $("tasks-tabcount").textContent = open ? String(open) : "";
  $("tasks-empty").style.display = visible.length ? "none" : "";
  for (const t of visible) if (t.status === "done") armRetire(t.id);
}

export function initTasks() {
  subscribe("tasks", render);
}
