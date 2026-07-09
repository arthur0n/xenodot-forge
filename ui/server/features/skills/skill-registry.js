// Skill-scope registry CORE — the read + inversion logic shared by the CLI validator
// (cli/gen-skill-scope.js), the set_skill MCP tool, and the recalibration UI. The per-skill `agents:`
// tag in each plugin/skills/*/SKILL.md is the source of truth; it inverts to a per-agent skill set
// (projected into agent frontmatter). Deliberately node:fs-only — NO config.js — so it stays
// side-effect-free for `npm run validate`. Paths resolve from this file's location.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // ui/server/features/skills
const PLUGIN = path.join(HERE, "..", "..", "..", "..", "plugin");
export const SKILLS_DIR = path.join(PLUGIN, "skills");
export const AGENTS_DIR = path.join(PLUGIN, "agents");
/** The base plugin root, exported so the CLI validator can resolve it without pulling in
 * config.js (this module deliberately stays config-free — no load-time side effects). */
export const PLUGIN_DIR = PLUGIN;

/** Sentinel for the main session (the hive) in audience sets — NOT an agent file. Its tag token is
 * `orchestrator`; its skill set is ORCHESTRATOR_FRAMEWORK_SKILLS (in skill-catalog.js). */
export const ORCH = "@orchestrator";

/** The closed set of `domain:` values every skill must declare (M2 taxonomy). One key per skill,
 * its DOMINANT profile lock. `universal`/`godot-core`/`design`/`project-local` are always kept by
 * the profile filter; `genre-*`/`style-*` are dropped when they mismatch the game profile. The
 * source of truth for the enum — the gate, the capabilities index, and the runtime filter all read
 * it from here. @type {readonly string[]} */
export const SKILL_DOMAINS = [
  "universal",
  "godot-core",
  "design",
  "genre-fps",
  "genre-topdown-iso",
  "style-pixel",
  "style-hd",
  "project-local",
];

/** The code-writers (stable hardcoded alias). godot-dev is the core/general builder; the rest are
 * domain specialists split off from it. Builders carry a 7-skill shared core, so the index cap for a
 * builder is higher (15 = 7 core + ~8 domain); see gen-skill-scope.js. @type {string[]} */
export const BUILDERS = [
  "godot-dev",
  "godot-refactor",
  "godot-weapons-abilities",
  "godot-enemy",
  "godot-vfx",
  "godot-player",
  "godot-visuals",
  "godot-assets",
];

/** The frontmatter block (between the first two `---`) and the body that follows.
 * @param {string} text @returns {{ fm: string, body: string }} */
export function split(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { fm: m[1] ?? "", body: m[2] ?? "" } : { fm: "", body: text };
}

/** Parse a `skills:` YAML block (`  - name` items) from a frontmatter string.
 * @param {string} fm @returns {string[]} */
export function parseSkillsList(fm) {
  const lines = fm.split("\n");
  const start = lines.findIndex((l) => /^skills:/.test(l));
  if (start < 0) return [];
  /** @type {string[]} */
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item?.[1]) out.push(item[1]);
    else if (/^\S/.test(line)) break; // next top-level key
  }
  return out;
}

/** Discover skills: { dir-name -> agents tag tokens }.
 * @param {string} [dir] skills dir to read (defaults to the base plugin's)
 * @returns {Map<string,string[]>} */
export function readSkills(dir = SKILLS_DIR) {
  /** @type {Map<string, string[]>} */
  const skills = new Map();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const { fm } = split(readFileSync(file, "utf8"));
    const tag = fm.match(/^agents:\s*\[([^\]]*)\]/m);
    skills.set(
      e.name,
      tag?.[1]
        ? tag[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    );
  }
  return skills;
}

/** Discover each skill's `domain:` tag: { dir-name -> domain-or-null }. Reads the frontmatter block
 * ONLY (via split), so a stray `domain:` in a skill's body prose can't be mistaken for the tag.
 * @param {string} [dir] skills dir to read (defaults to the base plugin's)
 * @returns {Map<string,string|null>} */
export function readSkillDomains(dir = SKILLS_DIR) {
  /** @type {Map<string, string|null>} */
  const domains = new Map();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const { fm } = split(readFileSync(file, "utf8"));
    domains.set(e.name, fm.match(/^domain:\s*(\S+)/m)?.[1] ?? null);
  }
  return domains;
}

/** Gate the `domain:` tags: push an error for any skill missing one or carrying a value outside
 * SKILL_DOMAINS — mirrors the missing-`agents:` gate. Errors flow to the CLI's `errors[]`, which
 * `gen-skill-scope.js` exits 1 on. @param {Map<string,string|null>} domains @param {string[]} [errors] */
export function validateSkillDomains(domains, errors) {
  for (const [skill, domain] of domains) {
    if (!domain)
      errors?.push(
        `skill \`${skill}\` has no \`domain:\` tag — every skill must declare a domain (${SKILL_DOMAINS.join(" · ")})`,
      );
    else if (!SKILL_DOMAINS.includes(domain))
      errors?.push(
        `skill \`${skill}\` has invalid domain \`${domain}\` — must be one of ${SKILL_DOMAINS.join(" · ")}`,
      );
  }
}

/** Discover agents: { name -> { skills, tools, model, effort, description, body } }. `description`
 * and `effort` are captured so a full AgentDefinition can be reconstructed at session start (the
 * M2 profile-filtered `options.agents` overlay) without dropping the agent's tuning.
 * @param {string} [dir] agents dir to read (defaults to the base plugin's)
 * @returns {Map<string,{skills:string[],tools:string[],model:string|null,effort:string|null,description:string,body:string}>} */
export function readAgents(dir = AGENTS_DIR) {
  /** @type {Map<string, {skills:string[],tools:string[],model:string|null,effort:string|null,description:string,body:string}>} */
  const agents = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const { fm, body } = split(readFileSync(path.join(dir, f), "utf8"));
    const tools = (fm.match(/^tools:\s*(.+)$/m)?.[1] ?? "").split(",").map((s) => s.trim());
    const model = fm.match(/^model:\s*(\S+)/m)?.[1] ?? null;
    const effort = fm.match(/^effort:\s*(\S+)/m)?.[1] ?? null;
    const description = fm.match(/^description:\s*(.+?)\s*$/m)?.[1] ?? "";
    agents.set(f.replace(/\.md$/, ""), {
      skills: parseSkillsList(fm),
      tools,
      model,
      effort,
      description,
      body,
    });
  }
  return agents;
}

/** Expand one audience token into agent ids (or the ORCH sentinel). Unknown tokens push to `errors`
 * if supplied (the CLI gates on them; the tool/UI ignores them).
 * @param {string} token @param {string[]} agentNames @param {string[]} workers @param {string[]} [errors]
 * @returns {string[]} */
export function expandToken(token, agentNames, workers, errors) {
  if (token === "all") return [ORCH, ...agentNames];
  if (token === "workers") return workers;
  if (token === "builders") return BUILDERS;
  if (token === "orchestrator") return [ORCH];
  if (agentNames.includes(token)) return [token];
  errors?.push(`unknown audience token \`${token}\` (not a reserved token or an agent name)`);
  return [];
}

/** Invert the skill tags into the expected per-audience skill sets.
 * @param {Map<string,string[]>} skills @param {string[]} agentNames @param {string[]} workers
 * @param {string[]} [errors] @returns {Map<string, Set<string>>} audienceId -> expected skill names */
export function expectedByAudience(skills, agentNames, workers, errors) {
  /** @type {Map<string, Set<string>>} */
  const expected = new Map();
  expected.set(ORCH, new Set());
  for (const n of agentNames) expected.set(n, new Set());
  for (const [skill, tokens] of skills) {
    if (!tokens.length)
      errors?.push(
        `skill \`${skill}\` has no \`agents:\` tag — every skill must declare an audience`,
      );
    for (const t of tokens)
      for (const id of expandToken(t, agentNames, workers, errors)) expected.get(id)?.add(skill);
  }
  return expected;
}

/** Read everything + compute the projection in one call. Workers = agents with the board tool.
 * @param {string} [root] plugin root to read (defaults to the base plugin) — parameterized so
 *   a sibling plugin's registry can be loaded too.
 * @returns {{ skills: Map<string,string[]>, domains: Map<string,string|null>,
 *   agents: ReturnType<typeof readAgents>, agentNames: string[], workers: string[],
 *   expected: Map<string,Set<string>>, errors: string[] }} */
export function loadRegistry(root = PLUGIN) {
  const skillsDir = path.join(root, "skills");
  const skills = readSkills(skillsDir);
  const domains = readSkillDomains(skillsDir);
  const agents = readAgents(path.join(root, "agents"));
  const agentNames = [...agents.keys()].sort();
  const workers = agentNames.filter((n) => agents.get(n)?.tools.includes("mcp__ui__tasks"));
  /** @type {string[]} */
  const errors = [];
  const expected = expectedByAudience(skills, agentNames, workers, errors);
  validateSkillDomains(domains, errors);
  return { skills, domains, agents, agentNames, workers, expected, errors };
}
