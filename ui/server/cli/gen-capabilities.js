// Generate the per-game capabilities index — the skills side of the machine-readable capability
// map (M2). Written into the game tree at .xenodot/capabilities.json (gitignored, like the
// manifest) by prepareGame() — so it regenerates on server startup, `doctor`, and `forge new`.
//
// For each of the plugin's skills it records: its `domain:` tag, the agents that own it (the
// inversion of the skill→agents audience projection), and whether it is IN this game's profile
// (computed from the domain + the declared {genre, style} via the same inProfile() the runtime
// session filter uses — one source of truth for the index and the preload filter).
//
// The agents side (structured agent frontmatter, orchestrator routing block) is deferred to G1.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROFILE } from "../core/config.js";
import { loadRegistry, ORCH } from "../features/skills/skill-registry.js";
import { inProfile } from "../features/skills/skill-scope.js";

/** @typedef {import("../../lib/profile.js").Profile} Profile */
/** @typedef {{ name: string, domain: string|null, owner_agents: string[], in_profile: boolean }} SkillCap */
/** @typedef {{ profile: Profile, skills: SkillCap[] }} Capabilities */

/** Invert the audience projection (audienceId → skillSet) into skill → sorted owner agent ids.
 * The `@orchestrator` sentinel is rendered as its ORCH token so the record is self-describing.
 * @param {Map<string, Set<string>>} expected @returns {Map<string, string[]>} */
function ownerAgentsBySkill(expected) {
  /** @type {Map<string, string[]>} */
  const owners = new Map();
  for (const [audience, skillSet] of expected)
    for (const skill of skillSet) {
      const list = owners.get(skill) ?? [];
      list.push(audience === ORCH ? "orchestrator" : audience);
      owners.set(skill, list);
    }
  for (const [skill, list] of owners) owners.set(skill, list.sort());
  return owners;
}

/** Build the capabilities record from the plugin registry + this game's profile. Pure-ish (reads
 * the plugin via loadRegistry; no project IO). @returns {Capabilities} */
export function buildCapabilities() {
  const { domains, expected } = loadRegistry();
  const owners = ownerAgentsBySkill(expected);
  const skills = [...domains.keys()].sort().map((name) => {
    const domain = domains.get(name) ?? null;
    return {
      name,
      domain,
      owner_agents: owners.get(name) ?? [],
      // Fail-open when the profile axis is undeclared (inProfile returns true) — the doctor warns
      // separately (see doctor.js), and the top-level `profile` block records what was declared.
      in_profile: inProfile(domain, PROFILE, name),
    };
  });
  return { profile: PROFILE, skills };
}

/** Write <projectDir>/.xenodot/capabilities.json with the skills-side capability map.
 * @param {string} projectDir @returns {Capabilities} */
export function generateCapabilities(projectDir) {
  const capabilities = buildCapabilities();
  const outDir = path.join(projectDir, ".xenodot");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "capabilities.json"),
    JSON.stringify(capabilities, null, 2) + "\n",
  );
  return capabilities;
}

// CLI: `node ui/server/cli/gen-capabilities.js [projectDir]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PROJECT_DIR } = await import("../core/config.js");
  const arg = process.argv[2];
  const target = arg ? path.resolve(arg) : PROJECT_DIR;
  const cap = generateCapabilities(target);
  const inN = cap.skills.filter((s) => s.in_profile).length;
  console.log(
    `capabilities: ${target} — ${cap.skills.length} skills, ${inN} in profile ` +
      `(${cap.profile.genre ?? "genre?"}/${cap.profile.style ?? "style?"}).`,
  );
}
