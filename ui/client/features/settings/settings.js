// Settings entry — the Settings (⚙) modal (Hermes researcher, Codex code-reviewer, Godot docs MCP)
// plus the wiring that boots all three settings surfaces. The Skills (🧩) modal lives in
// ./settings-skills.js and the first-run wizard in ./skill-setup-wizard.js; this module imports
// their init + the connection helpers, keeping each surface in its own file.
// Skills default to framework-only (skillOverrides "*": "off" in starter/.claude/settings.json);
// the Skills panel lets the user opt in built-in/workspace.
import { $, $input } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";
import {
  CUSTOM,
  fillModels,
  toggleCustom,
  testConnection,
  testCodex,
  runIntegrationSetup,
} from "./settings-connection.js";
import { initSkills } from "./settings-skills.js";
import { initSkillSetup, maybeAutoOpenSkillSetup } from "./skill-setup-wizard.js";

// Re-exported so main.js keeps importing it from ./settings.js (it lives in the wizard module).
export { maybeAutoOpenSkillSetup };

async function open() {
  $("settings-error").textContent = "";
  $("hermes-status").textContent = "";
  $("hermes-status").className = "settings-status";
  $("codex-status").textContent = "";
  $("codex-status").className = "settings-status";
  $("docs-status").textContent = "";
  $("docs-status").className = "settings-status";
  try {
    const state = /** @type {import("../../../lib/types.js").ProjectState} */ (
      await fetchJSON("/api/state")
    );
    const h = state.hermes;
    $input("hermes-enabled").checked = h.enabled;
    $input("hermes-url").value = h.apiUrl ?? "";
    $input("hermes-key").value = "";
    $input("hermes-key").placeholder = h.hasKey
      ? "key saved — leave blank to keep it"
      : "paste your Hermes API key";
    fillModels(h.models, h.model);
    const c = state.codex;
    $input("codex-enabled").checked = c.enabled;
    if (c.enabled && !c.vendored) {
      $("codex-status").textContent =
        "Switched on, but the plugin isn't vendored — run npm run codex:setup.";
    }
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
  const sel = /** @type {HTMLSelectElement} */ ($("hermes-model"));
  const model = sel.value === CUSTOM ? $input("hermes-model-custom").value.trim() : sel.value;
  const key = $input("hermes-key").value.trim();
  /** @type {{ enabled: boolean, apiUrl: string, model: string, apiKey?: string }} */
  const hermes = {
    enabled: $input("hermes-enabled").checked,
    apiUrl: $input("hermes-url").value.trim(),
    model,
  };
  if (key) hermes.apiKey = key; // blank → server keeps the saved key
  const codex = { enabled: $input("codex-enabled").checked };
  const docs = { enabled: $input("docs-enabled").checked };
  try {
    const res = /** @type {{ error?: string }} */ (
      await postJSON("/api/settings", { hermes, codex, docs })
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
  $("hermes-test").onclick = () => {
    void testConnection();
  };
  $("codex-test").onclick = () => {
    void testCodex();
  };
  $("codex-setup").onclick = () => {
    void runIntegrationSetup("codex-status", "/api/codex/setup", "Setting up Codex…");
  };
  $("hermes-setup").onclick = () => {
    void runIntegrationSetup(
      "hermes-status",
      "/api/hermes/setup",
      "Setting up Hermes… (installs the local agent)",
    );
  };
  $("hermes-model").addEventListener("change", () => {
    toggleCustom("");
  });
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) close();
  });

  // The Skills (🧩) modal and the first-run wizard own their own buttons + state.
  initSkills();
  initSkillSetup();
}
