// Skill-scope registry guard — the per-agent skill index is DECLARED once (each
// plugin/skills/*/SKILL.md carries an `agents:` tag naming its audience) and PROJECTED into each
// plugin/agents/*.md `skills:` frontmatter (what the SDK reads as AgentDefinition.skills). This checks
// the two stay in sync, so the "only required skills per agent" scoping can't silently drift. The read
// + inversion core lives in ui/server/features/skills/skill-registry.js (shared with the set_skill tool
// + the recalibration UI). Mirrors structure.check.js: bare-node; wired into `npm run validate`, the
// pre-commit hook, and CI.
//   node ui/server/cli/gen-skill-scope.js            # --check (default): exits 1 on any drift
//   node ui/server/cli/gen-skill-scope.js --write     # advisory: print the projected skills: blocks
//
// Tag vocabulary (in a skill's `agents: [...]`): bare agent names, plus reserved tokens —
//   all          → the orchestrator + every agent          (e.g. caveman)
//   workers      → every agent that manages the board (has the mcp__ui__tasks tool)
//   builders     → godot-dev, godot-refactor + the domain specialists (the code-writers)
//   orchestrator → the main session only (cross-checked against ORCHESTRATOR_FRAMEWORK_SKILLS)
import { ORCHESTRATOR_FRAMEWORK_SKILLS } from "../features/skills/skill-catalog.js";
import { ORCH, loadRegistry } from "../features/skills/skill-registry.js";

const { skills, agents, agentNames, expected, errors } = loadRegistry();
const onDisk = new Set(skills.keys());
/** @type {string[]} */ const warnings = [];

/** Set difference a − b as a sorted array. @param {Set<string>} a @param {Set<string>} b */
const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/** Body references to skills near a load/follow verb, or `name` skill mentions. @param {string} body */
function bodySkillRefs(body) {
  /** @type {Set<string>} */
  const refs = new Set();
  for (const m of body.matchAll(/(?:load|follow)\b[^.\n]*?`([a-z][a-z0-9-]+)`/g))
    if (m[1]) refs.add(m[1]);
  for (const m of body.matchAll(/`([a-z][a-z0-9-]+)`(?:\*{1,2}|_)?\s+skill\b/g))
    if (m[1]) refs.add(m[1]);
  return refs;
}

// Actual skills: per audience (the orchestrator's set is the framework constant).
/** @type {Map<string, Set<string>>} */
const actual = new Map();
actual.set(ORCH, new Set(ORCHESTRATOR_FRAMEWORK_SKILLS));
for (const n of agentNames) actual.set(n, new Set(agents.get(n)?.skills));

for (const [id, want] of expected) {
  /** @type {Set<string>} */
  const have = actual.get(id) ?? new Set();
  const label =
    id === ORCH ? "ORCHESTRATOR_FRAMEWORK_SKILLS" : `agent \`${id}\` frontmatter skills:`;
  // D1: every listed skill exists on disk.
  for (const s of have)
    if (!onDisk.has(s)) errors.push(`${label} lists \`${s}\`, which is not a skill on disk`);
  // D2: the projection (skill tags) and the frontmatter must match exactly, both directions.
  for (const s of minus(want, have))
    errors.push(
      `${label} is missing \`${s}\` (a skill tags this audience but the frontmatter omits it)`,
    );
  for (const s of minus(have, want))
    errors.push(
      `${label} lists \`${s}\`, but \`${s}\`'s \`agents:\` tag does not include this audience`,
    );
}

// Self-check: keep each context's tier-1 skill INDEX small. Past ~10–15 the always-listed description
// budget bites and selection accuracy erodes as descriptions overlap (the index is the "these exist +
// roughly what they do" signal; full skills load on demand). An over-cap agent is the signal to split
// it into domain-specialized agents (core + domain).
const INDEX_SOFT_CAP = 10;
for (const [id, have] of actual) {
  if (have.size > INDEX_SOFT_CAP)
    warnings.push(
      `${id === ORCH ? "orchestrator" : `agent \`${id}\``} carries ${have.size} skills in its index ` +
        `(> ${INDEX_SOFT_CAP}) — consider splitting it into domain-specialized agents (core + domain)`,
    );
}

// Body-reference checks: an agent body that names a skill it doesn't list. Two cases —
//   - the skill EXISTS on disk → ERROR (real drift: the prose claims a skill the agent isn't wired to
//     load). Fix by adding it to skills:, OR — if the skill belongs to another agent and the body is
//     just cross-referencing it — reword the prose so it doesn't read as a self-claim. (You cannot
//     simply add a builder-scoped skill to a non-builder here: that trips the D2 audience check above.)
//   - the skill is NOT on disk and looks godot-/gd- → WARNING (heuristic: may be a game-local skill).
for (const [name, a] of agents) {
  const listed = new Set(a.skills);
  for (const ref of bodySkillRefs(a.body)) {
    if (onDisk.has(ref)) {
      if (!listed.has(ref))
        errors.push(
          `agent \`${name}\` body references the \`${ref}\` skill but its frontmatter skills: omits it ` +
            `(add it to skills:, or reword the prose as a cross-reference if the skill belongs to another agent)`,
        );
    } else if (/^godot-|^gd-/.test(ref)) {
      warnings.push(
        `agent \`${name}\` body references \`${ref}\` as a skill, but it is not a FRAMEWORK skill ` +
          `(may be a game-local skill in the game's .claude/skills/ — a framework agent shouldn't ` +
          `hard-depend on a game-specific skill; and per-agent frontmatter scoping can hide it)`,
      );
    }
  }
}

if (process.argv.includes("--write")) {
  console.log(
    "# Projected skills: blocks (from each skill's agents: tag) — sync agent frontmatter to these:\n",
  );
  for (const id of [ORCH, ...agentNames]) {
    const list = [...(expected.get(id) ?? [])].sort();
    console.log(`## ${id === ORCH ? "orchestrator (ORCHESTRATOR_FRAMEWORK_SKILLS)" : id}`);
    console.log(
      id === ORCH ? `  [${list.join(", ")}]` : "skills:\n" + list.map((s) => `  - ${s}`).join("\n"),
    );
    console.log("");
  }
}

for (const w of warnings) console.warn(`⚠ skill-scope: ${w}`);
if (errors.length) {
  console.error(`✗ skill-scope: ${errors.length} drift error(s) in skill scoping:`);
  for (const e of errors) console.error(`    ${e}`);
  console.error(
    "  Fix the skill tag, the agent frontmatter, or the body reference so they agree (run --write to see the expected blocks).",
  );
  process.exit(1);
}
console.log(
  `ok  skill-scope: ${skills.size} skills, ${agentNames.length} agents, scoping in sync` +
    (warnings.length ? ` (${warnings.length} warning(s) above)` : ""),
);
