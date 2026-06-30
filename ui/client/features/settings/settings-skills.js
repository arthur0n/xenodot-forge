// Skills modal (🧩) — the session skill allowlist (built-in + workspace) and the per-agent skill
// recalibration list. Owns its loaded state; initSkills wires its toolbar button + modal.
import { $, el } from "../../core/dom.js";
import { fetchJSON, postJSON } from "../../../lib/json.js";

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

/** Wire the Skills modal: its own 🧩 toolbar button + modal (built-in/workspace allowlist + agent
 * skills). Called from initSettings. */
export function initSkills() {
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
}
