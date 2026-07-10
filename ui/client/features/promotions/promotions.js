// Promotions board — the right-rail surface for capability promotion requests
// (filed by mcp__ui__promote, recorded in .xenodot/promotions.json). Low-frequency,
// so a plain full re-render on each snapshot is fine (no keyed reconciler). The user
// approves/rejects here; the actual file move is a deliberate `npm run promote --
// --pending` step, so an approved row shows that hint rather than a spinner.
import { $, el } from "../../core/dom.js";
import { send } from "../../core/websocket.js";
import { subscribe } from "../../core/store.js";

/** @typedef {import("../../../lib/types.js").Promotion} Promotion */

const STATUS_LABEL = {
  requested: "wants promoting",
  approved: "approved · ready to promote",
  rejected: "rejected",
  promoted: "promoted ✓",
};

/** @param {Promotion} p @returns {HTMLElement} */
function row(p) {
  const node = el("div", `promo-row status-${p.status}`);
  const head = el("div", "promo-head");
  head.append(el("span", "promo-kind", p.kind.replace(/s$/, "")), el("span", "promo-name", p.name));
  node.append(head);
  if (p.reason) node.append(el("div", "promo-reason", p.reason));
  node.append(el("div", "promo-status", STATUS_LABEL[p.status] ?? p.status));
  if (p.status === "requested") {
    const actions = el("div", "promo-actions");
    const approve = el("button", "btn primary", "Promote");
    approve.onclick = () => {
      send({ type: "promotion_decide", id: p.id, decision: "approved" });
    };
    const reject = el("button", "btn ghost", "Keep local");
    reject.onclick = () => {
      send({ type: "promotion_decide", id: p.id, decision: "rejected" });
    };
    actions.append(approve, reject);
    node.append(actions);
  } else if (p.status === "approved") {
    // Gated through — one click runs the move server-side and marks it promoted.
    const actions = el("div", "promo-actions");
    const run = /** @type {HTMLButtonElement} */ (el("button", "btn primary", "Promote now"));
    run.title = "Move it into the framework plugin now";
    run.onclick = () => {
      run.disabled = true;
      run.textContent = "promoting…";
      send({ type: "promotion_run", id: p.id });
    };
    actions.append(run);
    node.append(actions);
  }
  return node;
}

/** @param {readonly Promotion[]} items */
function render(items) {
  // Hide settled noise: drop promoted/rejected entries from the panel (the manifest
  // keeps them as the audit trail). Show only live requests + approved-pending.
  const live = items.filter((p) => p.status === "requested" || p.status === "approved");
  const list = $("promotions-list");
  list.replaceChildren();
  for (const p of live) list.append(row(p));
  // Pending-request count rides on the Promote tab; the pane shows an empty
  // placeholder when there's nothing waiting.
  const pending = live.filter((p) => p.status === "requested").length;
  $("promote-tabcount").textContent = pending ? String(pending) : "";
  $("promotions-empty").style.display = live.length ? "none" : "";
}

export function initPromotions() {
  subscribe("promotions", render);
}
