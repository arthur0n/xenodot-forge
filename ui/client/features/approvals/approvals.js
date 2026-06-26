// Questions & approvals. The interactive card lives IN THE CHAT (where the
// user is looking); the right panel keeps a mini indicator. Both settle
// together. The typed-form variant (mcp__ui__form) lives in ./form.js and
// reuses registerPending / settle from here.
import { $, el } from "../../core/dom.js";
import { send } from "../../core/websocket.js";
import { paint, agentLabel } from "../agents/agents.js";
import { VERB_KIND, shorten, stripEnvPrefix } from "../activity/activity-log.js";

/** A colored chip naming the agent that raised a card (omitted for the main
 * loop). Lets concurrent approvals from different agents be told apart.
 * @param {string} [agent] @returns {HTMLElement | null} */
export function agentChip(agent) {
  return agent && agent !== "main"
    ? paint(el("span", "card-agent", agentLabel(agent)), agent)
    : null;
}

/** @type {Map<number, { chatCard: HTMLElement, panelCard: HTMLElement }>} */
const pendingCards = new Map(); // id -> { chatCard, panelCard }

const updateBadges = () => {
  const n = pendingCards.size;
  $("approvals-badge").textContent = String(n);
  $("pill-badge").textContent = String(n);
  $("approvals-pill").style.display = n ? "" : "none";
  $("approvals-empty").style.display = n ? "none" : "";
};

/** @param {number} id @param {HTMLElement} chatCard @param {HTMLElement} panelCard */
export function registerPending(id, chatCard, panelCard) {
  // A re-attaching client gets its open cards replayed by the server (replayPending); skip if this
  // one is already on screen so an in-page reconnect doesn't render a duplicate. The freshly-built
  // (still-unattached) nodes are simply discarded.
  if (pendingCards.has(id)) return;
  pendingCards.set(id, { chatCard, panelCard });
  $("chat-inner").append(chatCard);
  $("approvals-list").append(panelCard);
  updateBadges();
}

/** @param {number} id @param {string} note @param {boolean} [denied] */
export function settle(id, note, denied) {
  const p = pendingCards.get(id);
  if (!p) return;
  pendingCards.delete(id);
  p.panelCard.remove();
  p.chatCard.classList.add("resolved");
  const resolved = /** @type {HTMLElement | null} */ (
    p.chatCard.querySelector(".approval-resolved")
  );
  if (resolved) {
    resolved.textContent = note;
    if (denied) resolved.style.color = "var(--red)";
  }
  p.chatCard.querySelectorAll("button, input, textarea").forEach((n) => {
    /** @type {HTMLButtonElement} */ (n).disabled = true;
  });
  updateBadges();
}

/** @param {import("../../../lib/types.js").ToolInput} [input] @returns {string} */
const permissionCmd = (input) =>
  shorten(
    input?.command
      ? stripEnvPrefix(input.command)
      : (input?.file_path ?? JSON.stringify(input ?? {}).slice(0, 200)),
  );

/** @param {Extract<import("../../../lib/types.js").ServerMsg, { type: "permission" }>} m */
export function renderPermission(m) {
  const kind = VERB_KIND[m.toolName] ?? "task";
  /** @param {object} payload @param {string} note @param {boolean} [denied] */
  const act = (payload, note, denied) => () => {
    send({ type: "reply", id: m.id, payload });
    settle(m.id, note, denied);
  };
  const mkActions = () => {
    const actions = el("div", "approval-actions");
    /** @param {string} label @param {string} cls @param {object} payload @param {string} note @param {boolean} [denied] */
    const mk = (label, cls, payload, note, denied) => {
      const b = el("button", `btn ${cls}`, label);
      b.onclick = act(payload, note, denied);
      return b;
    };
    actions.append(
      mk("Allow once", "primary", { allow: true }, "✓ Approved — running"),
      mk("Always", "", { allow: true, always: true }, "✓ Approved for this session"),
      mk("Deny", "ghost", { allow: false }, "✕ Denied — not run", true),
    );
    return actions;
  };
  const mkCmd = () => {
    const cmd = el("div", "cmd");
    cmd.append(el("span", "prompt", "$ "), permissionCmd(m.input));
    return cmd;
  };

  // Inline chat card (interactive, primary)
  const chatCard = el("div", "card approval");
  const head = el("div", "card-head");
  const headChip = agentChip(m.agent);
  if (headChip) head.append(headChip, " ");
  head.append(el("span", `verb-pill verb-${kind}`, m.toolName), ` waiting for your approval`);
  const body = el("div", "approval-body");
  body.append(mkCmd(), mkActions());
  chatCard.append(head, body, el("div", "approval-resolved"));

  // Panel mini (interactive too — both resolve together)
  const panelCard = el("div", "approval-mini");
  const row = el("div", "approval-mini-row");
  const rowChip = agentChip(m.agent);
  if (rowChip) row.append(rowChip, " ");
  row.append(el("span", `verb-pill verb-${kind}`, m.toolName));
  panelCard.append(row, mkCmd(), mkActions());

  registerPending(m.id, chatCard, panelCard);
}

/** @param {Extract<import("../../../lib/types.js").ServerMsg, { type: "ask" }>} m */
export function renderAsk(m) {
  const questions = m.input?.questions ?? [];
  const picked = questions.map(() => /** @type {Set<string>} */ (new Set()));

  // Inline chat card holds the form (selection state lives in one place)
  const chatCard = el("div", "card approval");
  const head = el("div", "card-head");
  const headChip = agentChip(m.agent);
  if (headChip) head.append(headChip, " ");
  head.append("Question for you");
  const body = el("div", "approval-body");
  questions.forEach((q, qi) => {
    body.append(el("div", "approval-mini-row", q.question));
    (q.options ?? []).forEach((opt) => {
      const label = typeof opt === "string" ? opt : opt.label;
      const b = el("button", "btn", label);
      if (typeof opt === "object" && opt.description) b.title = opt.description;
      b.dataset.q = String(qi);
      b.onclick = () => {
        if (q.multiSelect) {
          b.classList.toggle("primary");
          const set = picked[qi];
          if (set?.has(label)) set.delete(label);
          else set?.add(label);
        } else {
          body.querySelectorAll(`[data-q="${qi}"]`).forEach((x) => {
            x.classList.remove("primary");
          });
          b.classList.add("primary");
          picked[qi] = new Set([label]);
        }
      };
      body.append(b);
    });
    const custom = document.createElement("input");
    custom.type = "text";
    custom.placeholder = "or type your own answer…";
    custom.className = "cmd";
    custom.dataset.custom = String(qi);
    body.append(custom);
  });
  const actions = el("div", "approval-actions");
  const submit = el("button", "btn primary", "Answer");
  submit.onclick = () => {
    /** @type {Record<string, string>} */
    const answers = {};
    questions.forEach((q, qi) => {
      const customEl = /** @type {HTMLInputElement | null} */ (
        body.querySelector(`[data-custom="${qi}"]`)
      );
      const custom = customEl?.value.trim() ?? "";
      answers[q.question] = custom || [...(picked[qi] ?? [])].join(", ") || "";
    });
    send({ type: "reply", id: m.id, payload: { answers } });
    settle(m.id, "✓ Answered");
  };
  actions.append(submit);
  body.append(actions);
  chatCard.append(head, body, el("div", "approval-resolved"));

  // Panel mini: passive pointer to the chat card
  const panelCard = el("div", "approval-mini");
  const miniRow = el("div", "approval-mini-row");
  const rowChip = agentChip(m.agent);
  if (rowChip) miniRow.append(rowChip, " ");
  miniRow.append(`❓ ${questions[0]?.question?.slice(0, 60) ?? "question"}`);
  panelCard.append(miniRow);
  const jump = el("button", "btn", "Answer in chat →");
  jump.onclick = () => {
    chatCard.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  panelCard.append(jump);

  registerPending(m.id, chatCard, panelCard);
}

/** Topbar pill jumps to the oldest pending card in the chat. */
export function initApprovalsPill() {
  $("approvals-pill").onclick = () => {
    const first = pendingCards.values().next().value;
    if (first) first.chatCard.scrollIntoView({ behavior: "smooth", block: "center" });
  };
}
