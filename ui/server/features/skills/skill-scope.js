// Skill-scope profile filter (M2) — PURE functions that decide which of an agent's preload skills
// belong in a given game profile {genre, style}, keyed off each skill's `domain:` tag. The IO
// (reading domains + the profile) lives in the callers (gen-capabilities.js, session.js); these
// stay side-effect-free and unit-tested in skill-scope.check.js.
//
// A skill is profile-LOCKED iff its domain starts `genre-` or `style-`. Every other domain
// (universal · godot-core · design · project-local) is profile-agnostic and always kept — so the
// lock test is exactly the prefix test, with no second list to drift from SKILL_DOMAINS.

/** The one pixel-art importer every game keeps, HD included. The aesthetic-NEUTRAL structural core
 * now lives in the always-kept base skills `godot-mesh-import` / `godot-texture-import` (domain
 * `godot-core`), so an HD game no longer reaches into a `style-pixel` skill for structure — the pixel
 * and HD import skills are equal deltas on those bases (D10-import-layering-inversion). That leaves
 * only `godot-texture-import-pixel-art` kept-always: the `gen_*` placeholder pipeline
 * (`godot-procedural-texture`) writes pixel `.import` sidecars regardless of the game's final style,
 * so even an HD game needs it for placeholder output. `godot-mesh-import-pixel-art` is now a pure
 * style delta (its structure moved to the base; `gen_models` placeholders are flat-shaded, no NEAREST
 * texture) and is dropped off-style like any other. Documented, not name-magic. @type {ReadonlySet<string>} */
export const STYLE_PIXEL_KEEP_ALWAYS = new Set(["godot-texture-import-pixel-art"]);

/** Does a skill with `domain` belong in a game whose profile is `{genre, style}`?
 *   - non-locked domain (universal/godot-core/design/project-local, or any non genre-/style- prefix)
 *     → keep.
 *   - `genre-*` → keep iff it equals `profile.genre`.
 *   - `style-*` → keep iff it equals `profile.style`, EXCEPT the pixel importers (kept always).
 *   - missing skill domain, or the relevant profile axis undeclared → keep (FAIL-OPEN: a
 *     not-yet-profiled game never starves an agent; the gate separately rejects missing tags).
 * @param {string|null|undefined} domain the skill's domain tag
 * @param {{genre?: string|null, style?: string|null}} profile
 * @param {string} [skillName] only consulted for the importer carve-out
 * @returns {boolean} */
export function inProfile(domain, profile, skillName) {
  if (!domain) return true;
  if (domain.startsWith("genre-")) return !profile?.genre || domain === profile.genre;
  if (domain.startsWith("style-")) {
    if (skillName && STYLE_PIXEL_KEEP_ALWAYS.has(skillName)) return true;
    return !profile?.style || domain === profile.style;
  }
  return true;
}

/** Filter one agent's preload skill list down to the skills in the game profile, preserving order.
 * @param {string[]} agentSkills the agent's declared `skills:` (frontmatter order)
 * @param {Map<string,string|null>|Record<string,string|null>} skillDomains name → domain
 * @param {{genre?: string|null, style?: string|null}} profile
 * @returns {string[]} */
export function filterAgentSkills(agentSkills, skillDomains, profile) {
  /** @param {string} n @returns {string|null|undefined} */
  const domainOf = (n) => (skillDomains instanceof Map ? skillDomains.get(n) : skillDomains[n]);
  return agentSkills.filter((name) => inProfile(domainOf(name), profile, name));
}
