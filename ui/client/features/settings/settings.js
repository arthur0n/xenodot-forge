// Settings + Skills panels — one module, two modals (wired together in initSettings).
//   Settings modal (⚙): Hermes researcher, Codex code-reviewer, Godot docs MCP.
//   Skills modal (🧩, its own toolbar button): the session skill allowlist (built-in +
//   workspace), per-agent skill recalibration, and the first-run skill-setup wizard.
// Skills default to framework-only (skillOverrides "*": "off" in
// starter/.claude/settings.json); the Skills panel lets the user opt in built-in/workspace.
import { $, $input, el } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";

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
async function testCodex() {
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

/** Render skill toggle rows into a container element.
 * @param {HTMLElement} container
 * @param {{ name: string, description: string }[]} skills
 * @param {Record<string, string>} overrides */
function renderSkillToggles(container, skills, overrides) {
  container.replaceChildren();
  if (!skills.length) {
    container.textContent = "None found.";
    return;
  }
  for (const skill of skills) {
    const checked = overrides[skill.name] === "on";
    const label = /** @type {HTMLLabelElement} */ (el("label", "form-label settings-toggle"));
    label.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem";
    const cb = /** @type {HTMLInputElement} */ (el("input", ""));
    cb.type = "checkbox";
    cb.dataset["skill"] = skill.name;
    cb.checked = checked;
    const nameSpan = el("span", "", skill.name);
    label.append(cb, nameSpan);
    if (skill.description) {
      const desc = el("span", "muted");
      desc.style.cssText = "font-size:0.8em;margin-left:0.25rem";
      desc.textContent = `— ${skill.description}`;
      label.append(desc);
    }
    container.append(label);
  }
}

/** Collect skill overrides from toggle checkboxes in a container.
 * @param {HTMLElement} container @returns {Record<string, string>} */
function collectOverrides(container) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const cb of /** @type {NodeListOf<HTMLInputElement>} */ (
    container.querySelectorAll("input[data-skill]")
  )) {
    if (cb.dataset["skill"]) result[cb.dataset["skill"]] = cb.checked ? "on" : "off";
  }
  return result;
}

/** @type {{ agents: {name:string, model:string|null, skills:string[], core:string[]}[], allSkills: string[] } | null} */
let _agentSkillsData = null;

/** One skill toggle row. Core skills are shown locked (always-on) + labeled so they're visible.
 * @param {string} agent @param {string} skill @param {boolean} checked @param {boolean} isCore */
function skillToggle(agent, skill, checked, isCore) {
  const label = /** @type {HTMLLabelElement} */ (el("label", "form-label settings-toggle"));
  label.style.cssText =
    "display:flex;align-items:center;gap:0.5rem;margin:0.1rem 0 0.1rem 0.5rem;font-size:0.88em";
  const cb = /** @type {HTMLInputElement} */ (el("input", ""));
  cb.type = "checkbox";
  cb.checked = checked;
  cb.disabled = isCore; // core skills come from a group (all/workers/builders) — always on
  cb.dataset["agent"] = agent;
  cb.dataset["skill"] = skill;
  label.append(cb, el("span", "", skill));
  if (isCore) {
    const tag = el("span", "muted");
    tag.style.cssText = "font-size:0.8em";
    tag.textContent = "core";
    label.append(tag);
  }
  return label;
}

/** Render the per-agent recalibration panel: each agent's CURRENT skills are shown up front (core
 * ones locked + labeled, e.g. caveman/tasks-mcp), with an "+ add" reveal for the rest.
 * @param {NonNullable<typeof _agentSkillsData>} data */
function renderAgentSkills(data) {
  const container = /** @type {HTMLElement} */ ($("agent-skills-list"));
  container.replaceChildren();
  for (const agent of data.agents) {
    const coreSet = new Set(agent.core);
    const block = el("div", "");
    block.style.cssText =
      "margin-bottom:0.6rem;padding-bottom:0.4rem;border-bottom:1px solid #2a2a2a";
    const head = el("div", "form-label");
    head.style.cssText = "margin-bottom:0.15rem";
    head.textContent = `${agent.name}${agent.model ? ` · ${agent.model}` : ""} — ${agent.skills.length}`;
    block.append(head);
    // the agent's CURRENT skills (always visible) — core first (locked), then domain (toggleable)
    for (const skill of [...agent.skills].sort(
      (a, b) => Number(coreSet.has(b)) - Number(coreSet.has(a)),
    ))
      block.append(skillToggle(agent.name, skill, true, coreSet.has(skill)));
    // the rest, available to add, tucked behind a reveal
    const rest = data.allSkills.filter((s) => !agent.skills.includes(s));
    if (rest.length) {
      const det = el("details", "");
      const sum = el("summary", "muted");
      sum.style.cssText = "cursor:pointer;font-size:0.82em;margin-left:0.5rem";
      sum.textContent = `+ add a skill (${rest.length})`;
      det.append(sum);
      for (const skill of rest) det.append(skillToggle(agent.name, skill, false, false));
      block.append(det);
    }
    container.append(block);
  }
}

/** Diff the recalibration checkboxes against the loaded state → the changes to POST.
 * @returns {{ agent: string, skill: string, on: boolean }[]} */
function collectAgentSkillChanges() {
  if (!_agentSkillsData) return [];
  const orig = new Map(_agentSkillsData.agents.map((a) => [a.name, new Set(a.skills)]));
  /** @type {{ agent: string, skill: string, on: boolean }[]} */
  const changes = [];
  for (const cb of /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("#agent-skills-list input[data-agent]")
  )) {
    const agent = cb.dataset["agent"];
    const skill = cb.dataset["skill"];
    if (!agent || !skill) continue;
    if (cb.checked !== (orig.get(agent)?.has(skill) ?? false))
      changes.push({ agent, skill, on: cb.checked });
  }
  return changes;
}

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

/** Open the dedicated Skills panel: the session skill allowlist (built-in + workspace) and the
 * per-agent recalibration list, loaded from /api/skills + /api/agent-skills. */
async function openSkills() {
  $("skills-error").textContent = "";
  try {
    const [skillsData, agentSkills] = await Promise.all([
      /** @type {Promise<{ workspace: { name: string, description: string }[], builtins: string[], overrides: Record<string, string> }>} */ (
        fetchJSON("/api/skills")
      ),
      /** @type {Promise<NonNullable<typeof _agentSkillsData>>} */ (fetchJSON("/api/agent-skills")),
    ]);
    const builtinSkills = skillsData.builtins.map((name) => ({ name, description: "" }));
    renderSkillToggles(
      /** @type {HTMLElement} */ ($("skills-builtins-list")),
      builtinSkills,
      skillsData.overrides,
    );
    renderSkillToggles(
      /** @type {HTMLElement} */ ($("skills-workspace-list")),
      skillsData.workspace,
      skillsData.overrides,
    );
    _agentSkillsData = agentSkills;
    renderAgentSkills(agentSkills);
  } catch {
    $("skills-error").textContent = "Couldn't load skills — is the server up to date?";
  }
  $("skills-modal").style.display = "";
}

function closeSkills() {
  $("skills-modal").style.display = "none";
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

/** Save the Skills panel: the session allowlist (/api/skills) + any per-agent recalibration
 * changes (/api/agent-skills). Agent-skill edits hit framework files and need a restart. */
async function saveSkills() {
  const err = $("skills-error");
  err.textContent = "";
  err.style.color = "";
  // Session allowlist: framework "*" off, then the built-in + workspace opt-ins.
  const overrides = {
    "*": "off",
    ...collectOverrides(/** @type {HTMLElement} */ ($("skills-builtins-list"))),
    ...collectOverrides(/** @type {HTMLElement} */ ($("skills-workspace-list"))),
  };
  try {
    const agentChanges = collectAgentSkillChanges();
    /** @type {Promise<{ error?: string }>[]} */
    const posts = [
      /** @type {Promise<{ error?: string }>} */ (postJSON("/api/skills", { overrides })),
    ];
    if (agentChanges.length)
      posts.push(
        /** @type {Promise<{ error?: string }>} */ (
          postJSON("/api/agent-skills", { changes: agentChanges })
        ),
      );
    const results = await Promise.all(posts);
    const saveErr = results.map((r) => r.error).find(Boolean);
    if (saveErr) {
      err.textContent = saveErr;
      return;
    }
    if (agentChanges.length) {
      // Agent-skill edits are written to the framework files now, but take effect on the NEXT
      // session. Refresh the panel from disk so the change is visible, confirm, and stay open.
      try {
        const fresh = /** @type {NonNullable<typeof _agentSkillsData>} */ (
          await fetchJSON("/api/agent-skills")
        );
        _agentSkillsData = fresh;
        renderAgentSkills(fresh);
      } catch {
        /* non-fatal */
      }
      err.style.color = "#6c6";
      err.textContent = `✓ Saved ${agentChanges.length} agent-skill change(s) — restart the framework (npm start) to load them.`;
      return;
    }
  } catch {
    err.textContent = "Save failed — restart the UI server (npm start) and try again.";
    return;
  }
  closeSkills();
}

// ── Skill setup wizard ────────────────────────────────────────────────────────

/** @type {{ workspace: {name:string,description:string}[], builtins: string[], overrides: Record<string,string>, setupDone: boolean, contexts: Record<string,string[]> } | null} */
let _skillsData = null;
/** @type {string} */
let _selectedContext = "";

/** @param {number} step */
function showStep(step) {
  $("skill-setup-step-1").style.display = step === 1 ? "" : "none";
  $("skill-setup-step-2").style.display = step === 2 ? "" : "none";
}

function closeSkillSetup() {
  $("skill-setup-modal").style.display = "none";
}

/** @param {{ name: string, description: string }[]} skills
 *  @param {string[]} recommended
 *  @param {HTMLElement} container */
function renderWizardToggles(skills, recommended, container) {
  container.replaceChildren();
  if (!skills.length) {
    container.textContent = "None found.";
    return;
  }
  for (const skill of skills) {
    const checked = recommended.includes(skill.name);
    const label = /** @type {HTMLLabelElement} */ (el("label", "form-label settings-toggle"));
    label.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem";
    const cb = /** @type {HTMLInputElement} */ (el("input", ""));
    cb.type = "checkbox";
    cb.dataset["skill"] = skill.name;
    cb.checked = checked;
    const nameSpan = el("span", "", skill.name);
    label.append(cb, nameSpan);
    if (skill.description) {
      const desc = el("span", "muted");
      desc.style.cssText = "font-size:0.8em;margin-left:0.25rem";
      desc.textContent = `— ${skill.description}`;
      label.append(desc);
    }
    container.append(label);
  }
}

/** Move to step 2 with recommended defaults for the chosen context. */
function applyContext() {
  if (!_skillsData) return;
  const recommended = _skillsData.contexts[_selectedContext] ?? [];
  const builtinSkills = _skillsData.builtins.map((name) => ({ name, description: "" }));
  const workspaceNames = new Set(_skillsData.workspace.map((s) => s.name));
  const dedupedBuiltins = builtinSkills.filter((s) => !workspaceNames.has(s.name));
  renderWizardToggles(
    dedupedBuiltins,
    recommended,
    /** @type {HTMLElement} */ ($("skill-setup-builtins-list")),
  );
  renderWizardToggles(
    _skillsData.workspace,
    recommended,
    /** @type {HTMLElement} */ ($("skill-setup-workspace-list")),
  );
  showStep(2);
}

async function openSkillSetup() {
  $("skill-setup-error-1").textContent = "";
  $("skill-setup-error-2").textContent = "";
  _selectedContext = "";
  for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("[name=skill-context]")
  )) {
    r.checked = false;
  }
  if (!_skillsData) {
    try {
      _skillsData = /** @type {typeof _skillsData} */ (await fetchJSON("/api/skills"));
    } catch {
      return;
    }
  }
  showStep(1);
  $("skill-setup-modal").style.display = "";
}

async function saveSkillSetupWizard() {
  const err = $("skill-setup-error-2");
  err.textContent = "";
  /** @type {Record<string, string>} */
  const overrides = {};
  for (const cb of /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("#skill-setup-step-2 input[data-skill]")
  )) {
    if (cb.dataset["skill"]) overrides[cb.dataset["skill"]] = cb.checked ? "on" : "off";
  }
  try {
    const res = /** @type {{ error?: string }} */ (
      await postJSON("/api/setup/skills", { context: _selectedContext, overrides })
    );
    if (res.error) {
      err.textContent = res.error;
      return;
    }
    _skillsData = null; // invalidate cache so settings panel refreshes
  } catch {
    err.textContent = "Save failed — is the server running?";
    return;
  }
  closeSkillSetup();
  // Reload skills panel in settings if open
  $("skills-workspace-list").textContent = "Restart the framework (npm start) to apply.";
  $("skills-builtins-list").textContent = "";
}

// ── Public init ───────────────────────────────────────────────────────────────

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
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) close();
  });

  // Skills panel — its own 🧩 toolbar button + modal (built-in/workspace allowlist + agent skills).
  $("skills-btn").onclick = () => {
    void openSkills();
  };
  $("skills-cancel").onclick = closeSkills;
  $("skills-save").onclick = () => {
    void saveSkills();
  };
  $("skills-modal").addEventListener("click", (e) => {
    if (e.target === $("skills-modal")) closeSkills();
  });

  // Skill setup wizard
  $("skill-setup-open").onclick = () => {
    void openSkillSetup();
  };
  $("skill-setup-cancel-1").onclick = closeSkillSetup;
  $("skill-setup-modal").addEventListener("click", (e) => {
    if (e.target === $("skill-setup-modal")) closeSkillSetup();
  });
  $("skill-setup-next").onclick = () => {
    if (!_selectedContext) {
      $("skill-setup-error-1").textContent = "Please select an option.";
      return;
    }
    applyContext();
  };
  $("skill-setup-back").onclick = () => {
    showStep(1);
  };
  $("skill-setup-save").onclick = () => {
    void saveSkillSetupWizard();
  };
  for (const r of /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("[name=skill-context]")
  )) {
    r.addEventListener("change", () => {
      _selectedContext = r.value;
    });
  }
}

/** Auto-open the skill setup wizard when no setup has been done yet.
 * Called from main.js after the initial state load. */
export async function maybeAutoOpenSkillSetup() {
  try {
    _skillsData = /** @type {typeof _skillsData} */ (await fetchJSON("/api/skills"));
    if (!_skillsData?.setupDone) void openSkillSetup();
  } catch {
    /* non-fatal */
  }
}
