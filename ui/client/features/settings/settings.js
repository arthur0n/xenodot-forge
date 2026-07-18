// Settings entry — the Settings (⚙) modal: the Agents portal (external agents from the
// server registry — Hermes, Codex, …) plus the Godot-docs toggle, and the wiring that
// boots all the settings surfaces. The portal cards render data-driven from GET
// /api/agents (see ../agents-portal/portal.js); the Skills (🧩) modal lives in
// ./settings-skills.js and the first-run wizard in ./skill-setup-wizard.js.
// Skills default to framework-only (skillOverrides "*": "off" in starter/.claude/settings.json);
// the Skills panel lets the user opt in built-in/workspace.
import { $, $input } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";
import { openPortal, collectAgentSettings } from "../agents-portal/portal.js";
import { initSkills } from "./settings-skills.js";
import { initSkillSetup, maybeAutoOpenSkillSetup } from "./skill-setup-wizard.js";

// Re-exported so main.js keeps importing it from ./settings.js (it lives in the wizard module).
export { maybeAutoOpenSkillSetup };

async function open() {
  $("settings-error").textContent = "";
  $("docs-status").textContent = "";
  $("docs-status").className = "settings-status";
  try {
    // The portal owns the agent cards (fetches /api/agents itself); /api/state only
    // feeds the docs toggle here.
    await openPortal();
    const state = /** @type {import("../../../lib/types.js").ProjectState} */ (
      await fetchJSON("/api/state")
    );
    $input("docs-enabled").checked = state.docs.enabled;
  } catch {
    $("settings-error").textContent = "Couldn't load settings — is the server up to date?";
  }
  $("settings-modal").style.display = "";
}

function close() {
  $("settings-modal").style.display = "none";
}

async function save() {
  const err = $("settings-error");
  err.textContent = "";
  err.style.color = "";
  const docs = { enabled: $input("docs-enabled").checked };
  try {
    const res = /** @type {{ error?: string }} */ (
      await postJSON("/api/settings", { ...collectAgentSettings(), docs })
    );
    if (res.error) {
      err.textContent = res.error;
      return;
    }
  } catch {
    err.textContent = "Save failed — restart the UI server (npm start) and try again.";
    return;
  }
  close();
}

export function initSettings() {
  $("settings-btn").onclick = () => {
    void open();
  };
  $("settings-cancel").onclick = close;
  $("settings-save").onclick = () => {
    void save();
  };
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) close();
  });

  // The Skills (🧩) modal and the first-run wizard own their own buttons + state.
  initSkills();
  initSkillSetup();
}
