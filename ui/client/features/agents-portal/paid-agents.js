// Paid agents — the always-visible rail strip answering "which BILLED external agents are
// active right now?". Every entry of GET /api/agents is an agent that spends the user's
// own money on its own account (Hermes → provider/Nous billing, Codex → OpenAI/ChatGPT,
// Kimi → Moonshot, …), so unlike the built-in roster they must never be silently on —
// this strip keeps that state one glance away, outside the Settings modal. Data-driven
// from the same registry the portal renders: a future agent needs NO edit here.
// Clicking the strip opens Settings (the portal owns connect/enable/test).
import { $, el } from "../../core/dom.js";
import { fetchJSON } from "../../../lib/json.js";

/** @typedef {import("../../../lib/types.js").AgentPublicDescriptor} AgentDescriptor */

/** Re-fetch the registry and repaint the strip. Section stays hidden until the first
 * successful fetch with a non-empty catalog (older servers without /api/agents → hidden). */
export async function refreshPaidAgents() {
  const section = $("paid-agents");
  const list = $("paid-agents-list");
  if (!section || !list) return;
  /** @type {AgentDescriptor[]} */
  let agents;
  try {
    agents = /** @type {AgentDescriptor[]} */ (await fetchJSON("/api/agents"));
  } catch {
    return; // endpoint missing/unreachable — leave the strip as it was
  }
  if (!Array.isArray(agents) || agents.length === 0) return;

  list.replaceChildren(
    ...agents.map((a) => {
      const on = a.status?.enabled === true;
      const row = el("div", `paid-agent-row${on ? " on" : ""}`);
      row.append(
        el("span", `dot${on ? "" : " idle"}`),
        el("span", "paid-agent-name", a.label),
        el(
          "span",
          "paid-agent-state",
          on ? (a.status.roles?.length ? a.status.roles.join(" · ") : "active") : "off",
        ),
      );
      return row;
    }),
  );
  const onCount = agents.filter((a) => a.status?.enabled === true).length;
  const badge = $("paid-agents-badge");
  if (badge) badge.textContent = `${onCount}/${agents.length}`;
  section.style.display = "";
}

/** Boot: first paint + click-through to Settings (where the portal cards live). */
export function initPaidAgents() {
  const section = $("paid-agents");
  if (section)
    section.onclick = () => {
      $("settings-btn")?.click();
    };
  void refreshPaidAgents();
}
