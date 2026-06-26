// Skill allowlist management — reads workspace skills from ~/.claude/commands/,
// exposes the known built-in Claude Code skill list, and reads/writes the
// skillOverrides block in the game project's .claude/settings.json.
// The setup wizard writes .xenodot/skill-setup.json; the server applies it on next start.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PROJECT_DIR } from "../../core/config.js";
import { parseJSON } from "../../../lib/json.js";
import {
  BUILTIN_SKILLS,
  ORCHESTRATOR_FRAMEWORK_SKILLS,
  REQUIRED_ORCHESTRATOR_BUILTINS,
  getWorkspaceSkills,
} from "./skill-catalog.js";

// Re-export the catalog so existing importers (core/index.js, the /api/skills route) keep
// pulling the built-in list + orchestrator floor + workspace reader from this module.
export {
  BUILTIN_SKILLS,
  ORCHESTRATOR_FRAMEWORK_SKILLS,
  REQUIRED_ORCHESTRATOR_BUILTINS,
  getWorkspaceSkills,
};

/** Recommended skills per setup context. Skills listed here default to "on"; all others "off".
 * @type {Record<string, string[]>} */
export const SKILL_CONTEXTS = {
  "new-project": ["init", "verify"],
  "existing-project": ["verify", "code-review", "review"],
  "new-to-claude": ["init", "keybindings-help", "fewer-permission-prompts"],
};

const GAME_SETTINGS = path.join(PROJECT_DIR, ".claude", "settings.json");

/** Path to the skill setup record written by the UI wizard. Lives in .xenodot/ (gitignored). */
export const SETUP_FILE = path.join(PROJECT_DIR, ".xenodot", "skill-setup.json");

/** Whether the skill setup wizard has been completed for this game project. */
export function hasSkillSetup() {
  return existsSync(SETUP_FILE);
}

/** Write the wizard result to .xenodot/skill-setup.json. Does NOT apply to settings yet —
 * that happens on the next server start via applySkillSetup().
 * @param {string} context @param {Record<string, string>} overrides
 * @returns {{ ok: true } | { error: string }} */
export function saveSkillSetup(context, overrides) {
  try {
    writeFileSync(SETUP_FILE, JSON.stringify({ context, overrides }, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Read .xenodot/skill-setup.json and apply its overrides to game/.claude/settings.json.
 * Called at server startup. No-op if the file doesn't exist.
 * @returns {{ applied: boolean }} */
export function applySkillSetup() {
  if (!existsSync(SETUP_FILE)) return { applied: false };
  try {
    const data = /** @type {{ context?: string, overrides?: Record<string, string> }} */ (
      parseJSON(readFileSync(SETUP_FILE, "utf8"))
    );
    if (!data.overrides) return { applied: false };
    saveSkillOverrides(data.overrides);
    return { applied: true };
  } catch {
    return { applied: false };
  }
}

/** Current skillOverrides from the game project's .claude/settings.json.
 * @returns {Record<string, string>} */
export function getSkillOverrides() {
  try {
    const raw = /** @type {Record<string, unknown>} */ (
      parseJSON(readFileSync(GAME_SETTINGS, "utf8"))
    );
    return /** @type {Record<string, string>} */ (raw.skillOverrides ?? {});
  } catch {
    return {};
  }
}

/** Merge overrides into the game project's .claude/settings.json, preserving all other fields.
 * @param {Record<string, string>} overrides @returns {{ ok: true } | { error: string }} */
export function saveSkillOverrides(overrides) {
  /** @type {Record<string, unknown>} */
  let saved = {};
  try {
    saved = /** @type {Record<string, unknown>} */ (parseJSON(readFileSync(GAME_SETTINGS, "utf8")));
  } catch {
    /* absent/invalid — start fresh */
  }
  try {
    writeFileSync(
      GAME_SETTINGS,
      JSON.stringify({ ...saved, skillOverrides: overrides }, null, 2) + "\n",
    );
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Resolve the skill-name allowlist for the MAIN SESSION (orchestrator), passed to the SDK as
 * `options.skills`. The SDK hides every unlisted skill from the model's listing and rejects it
 * from the Skill tool (files stay on disk). The set =
 *   ORCHESTRATOR_FRAMEWORK_SKILLS  (framework meta floor — always on)
 *   ∪ REQUIRED_ORCHESTRATOR_BUILTINS (required builtins, e.g. update-config — always on, not toggleable)
 *   ∪ the built-in/workspace skills the user enabled via skillOverrides.
 * DOMAIN skills are deliberately EXCLUDED — both the framework `godot-*` skills AND the game's
 * own `.claude/skills` (e.g. godot-decal-vfx, cast-system). The orchestrator only ROUTES; domain
 * skills belong to the implementer agents, not the hive. (Blanket-including game-local skills here
 * polluted the hive's index — its `godot-oneshot-vfx` bare name even pulled in the framework copy as
 * `xenodot:godot-oneshot-vfx`.) This is also what finally makes `skillOverrides` do something.
 *
 * Override semantics (skillOverrides: Record<name, "on"|"off">), applied to built-ins/workspace only:
 *   per-name "on"/"off" wins; else the "*" wildcard; else DEFAULT-DENY. An unconfigured project
 *   therefore gets a lean orchestrator (meta only), not all ~18 built-in "system" skills.
 * Read live per session, so a `/api/skills` POST takes effect on the next new session.
 * @returns {string[]} */
export function resolveSessionSkills() {
  return computeSessionSkills({
    floor: [...ORCHESTRATOR_FRAMEWORK_SKILLS, ...REQUIRED_ORCHESTRATOR_BUILTINS],
    candidates: [...BUILTIN_SKILLS, ...getWorkspaceSkills().map((s) => s.name)],
    overrides: getSkillOverrides(),
  });
}

/** Pure set-resolution of the session skill allowlist from already-gathered inputs — the testable
 * core of resolveSessionSkills() (which supplies the IO; see skills.check.js). `floor` is ALWAYS
 * included; `candidates` (built-ins/workspace) are gated by `overrides`: a per-name "on"/"off"
 * wins, else the "*" wildcard, else default-deny.
 * @param {{ floor: string[], candidates: string[], overrides: Record<string,string> }} p
 * @returns {string[]} */
export function computeSessionSkills({ floor, candidates, overrides }) {
  const wildcard = overrides["*"]; // "on" | "off" | undefined
  const enabled = candidates.filter((name) => {
    const o = overrides[name];
    if (o === "on") return true;
    if (o === "off") return false;
    return wildcard === "on"; // default-deny unless the wildcard turns everything on
  });
  return [...new Set([...floor, ...enabled])];
}
