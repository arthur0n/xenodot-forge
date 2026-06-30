// Settings modal — Hermes model selection + integration connection tests (Hermes / Codex).
// Pure helpers used by the Settings (⚙) modal lifecycle and wired in initSettings.
import { $, $input, el } from "../../core/dom.js";
import { postJSON } from "../../../lib/json.js";

export const CUSTOM = "__custom__";

/** Fill the model <select> with the server's curated ids + a "custom…" entry, and
 * select the current model (revealing the custom input when it's not in the list).
 * @param {string[]} models @param {string} current */
export function fillModels(models, current) {
  const sel = /** @type {HTMLSelectElement} */ ($("hermes-model"));
  sel.replaceChildren();
  for (const id of models) {
    const opt = /** @type {HTMLOptionElement} */ (el("option", "", id));
    opt.value = id;
    sel.append(opt);
  }
  const customOpt = /** @type {HTMLOptionElement} */ (el("option", "", "custom…"));
  customOpt.value = CUSTOM;
  sel.append(customOpt);

  const known = models.includes(current);
  sel.value = known ? current : CUSTOM;
  toggleCustom(known ? "" : current);
}

/** Show/hide the free-text custom-model input and seed its value. @param {string} value */
export function toggleCustom(value) {
  const custom = $input("hermes-model-custom");
  const isCustom = /** @type {HTMLSelectElement} */ ($("hermes-model")).value === CUSTOM;
  custom.style.display = isCustom ? "" : "none";
  if (isCustom && value) custom.value = value;
}

/** Probe the gateway with whatever URL/key is currently typed (blank key → saved key)
 * and show a one-line verdict, so you can confirm reachability before saving. */
export async function testConnection() {
  const status = $("hermes-status");
  $("settings-error").textContent = "";
  status.className = "settings-status pending";
  status.textContent = "Testing…";
  try {
    const r = /** @type {import("../../../lib/types.js").HermesCheck} */ (
      await postJSON("/api/hermes/check", {
        apiUrl: $input("hermes-url").value.trim(),
        apiKey: $input("hermes-key").value.trim(),
      })
    );
    if (r.ok) {
      const list = r.models?.length ? ` — models: ${r.models.slice(0, 4).join(", ")}` : "";
      status.className = "settings-status ok";
      status.textContent = `✓ Reachable${list}`;
    } else {
      status.className = "settings-status bad";
      status.textContent = `✗ ${r.error ?? "Unreachable."}`;
    }
  } catch {
    status.className = "settings-status bad";
    status.textContent = "✗ Test failed — is the UI server up to date? (restart with npm start)";
  }
}

/** Probe the LOCAL Codex install (CLI on PATH? logged in? plugin vendored?) and show a
 * one-line verdict. No network, no billing — it's all local. */
export async function testCodex() {
  const status = $("codex-status");
  $("settings-error").textContent = "";
  status.className = "settings-status pending";
  status.textContent = "Checking…";
  try {
    const r = /** @type {import("../../../lib/types.js").CodexCheck} */ (
      await postJSON("/api/codex/check", {})
    );
    if (r.ok && r.caveat) {
      // Installed + logged in, but the configured model won't route (e.g. a *-codex
      // model on a ChatGPT login). Surface it loudly — "Ready" would be a lie.
      status.className = "settings-status bad";
      status.textContent = `⚠ ${r.caveat}`;
    } else if (r.ok) {
      const ver = r.version ? ` — codex v${r.version}` : "";
      const mode = r.authMode ? ` (${r.authMode})` : "";
      status.className = "settings-status ok";
      status.textContent = `✓ Ready${ver}${mode}`;
    } else {
      status.className = "settings-status bad";
      status.textContent = `✗ ${r.error ?? "Not ready."}`;
    }
  } catch {
    status.className = "settings-status bad";
    status.textContent = "✗ Test failed — is the UI server up to date? (restart with npm start)";
  }
}

/** Run a framework setup script server-side (codex/hermes :setup) and report it. The integration's
 * prompt block loads at SESSION START, so success ALWAYS says RESTART; `manual` adds Hermes' OAuth.
 * @param {string} statusId @param {string} endpoint @param {string} pending */
export async function runIntegrationSetup(statusId, endpoint, pending) {
  const status = $(statusId);
  $("settings-error").textContent = "";
  status.className = "settings-status pending";
  status.textContent = pending;
  try {
    const r = /** @type {{ ok: boolean, error?: string, manual?: string }} */ (
      await postJSON(endpoint, {})
    );
    status.className = `settings-status ${r.ok ? "ok" : "bad"}`;
    status.textContent = r.ok
      ? `✓ Set up. ${r.manual ? r.manual + " " : ""}RESTART the session to activate.`
      : `✗ Setup failed — ${r.error ?? "see the server log"}`;
  } catch {
    status.className = "settings-status bad";
    status.textContent = "✗ Setup request failed — is the UI server up to date?";
  }
}
