// Settings panel — the home of the external Hermes researcher switch and the optional
// Codex code-reviewer switch. Reads the secret-free public config from /api/state, writes
// changes back via POST /api/settings (which merges the `hermes` / `codex` blocks into
// .xenodot.json and takes effect immediately — the server re-reads each per call). The
// Hermes API key is write-only here: it's never sent back to the browser (we show only
// whether one is saved), and a blank key field on save keeps the existing key. Codex has
// no secret to manage — its auth lives in the local `codex` CLI (`codex login`).
import { $, $input, el } from "./dom.js";
import { fetchJSON, postJSON } from "../lib/json.js";

const CUSTOM = "__custom__";

/** Fill the model <select> with the server's curated ids + a "custom…" entry, and
 * select the current model (revealing the custom input when it's not in the list).
 * @param {string[]} models @param {string} current */
function fillModels(models, current) {
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
function toggleCustom(value) {
  const custom = $input("hermes-model-custom");
  const isCustom = /** @type {HTMLSelectElement} */ ($("hermes-model")).value === CUSTOM;
  custom.style.display = isCustom ? "" : "none";
  if (isCustom && value) custom.value = value;
}

/** Probe the gateway with whatever URL/key is currently typed (blank key → saved key)
 * and show a one-line verdict, so you can confirm reachability before saving. */
async function testConnection() {
  const status = $("hermes-status");
  $("settings-error").textContent = "";
  status.className = "settings-status pending";
  status.textContent = "Testing…";
  try {
    const r = /** @type {import("../lib/types.js").HermesCheck} */ (
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
async function testCodex() {
  const status = $("codex-status");
  $("settings-error").textContent = "";
  status.className = "settings-status pending";
  status.textContent = "Checking…";
  try {
    const r = /** @type {import("../lib/types.js").CodexCheck} */ (
      await postJSON("/api/codex/check", {})
    );
    if (r.ok) {
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

async function open() {
  $("settings-error").textContent = "";
  $("hermes-status").textContent = "";
  $("hermes-status").className = "settings-status";
  $("codex-status").textContent = "";
  $("codex-status").className = "settings-status";
  try {
    const state = /** @type {import("../lib/types.js").ProjectState} */ (
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
  try {
    const res = /** @type {{ error?: string }} */ (
      await postJSON("/api/settings", { hermes, codex })
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
  $("hermes-model").addEventListener("change", () => {
    toggleCustom("");
  });
  // Click the dimmed backdrop (not the panel) to dismiss.
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) close();
  });
}
