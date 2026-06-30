// First-run skill-setup wizard — pick a context (step 1), then opt into recommended skills
// (step 2). Owns its own cached skills data + selected context; initSkillSetup wires its modal.
import { $, el } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";

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

/** Wire the skill-setup wizard modal: open/cancel/next/back/save + the context radios. Called
 * from initSettings. */
export function initSkillSetup() {
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
