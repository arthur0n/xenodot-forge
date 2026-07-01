// Shared game-contamination scanner — the deterministic half of the "is this capability AGNOSTIC?"
// rubric the audit used to eyeball by hand. plugin/ ships + materializes into EVERY game, so a
// promoted or directly-authored skill/agent/tool must carry NO game-specific facts. One scanner, run
// at BOTH seams so contamination cannot enter the spine:
//   • promote  (promote-run.js)      — hard-block a game-coupled capability at the game→plugin boundary
//   • validate (cli/gen-contamination.js) — catch capabilities authored DIRECT-TO-PLUGIN (bypassing
//     promote entirely, as the WIP enemy skills did) over the plugin's own skills/agents/tools
//
// Generalizes the old tools-only `gameDomainRef` (res://-only): now runs for all kinds and adds
// absolute paths, sibling-game refs, and provenance. It flags only DETERMINISTIC, low-false-positive
// signals plus a small explicit denylist of the CURRENT game's proper nouns — fuzzy proper-noun
// judgment past the denylist stays the audit's job (skills legitimately cite res:// convention paths
// like `res://entities/player/player.tscn`, so a blanket res:// block would flood false positives —
// res:// is checked for TOOLS only, where a hardcoded scene genuinely breaks other games' gates).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// res:// refs every game shares — legitimate in a universal tool. Anything else is game-domain.
export const UNIVERSAL_RES = [
  /^res:\/\/main\.tscn\b/,
  /^res:\/\/assets\//,
  /^res:\/\/x-shared-assets\//,
  /^res:\/\/\.godot\//,
  /^res:\/\/addons\//,
];
// Literal engine resource refs (a `$VAR`/arg-built path like `res://$SCENE` has no literal
// extension here, so a tool that takes its scene as a parameter is correctly seen as universal).
const RES_REF = /res:\/\/[A-Za-z0-9_./-]+\.(?:tscn|tres|escn|glb|gltf)\b/g;

// The CURRENT game's known proper nouns (codename + level/scene names). FORGE-LOCAL config, NOT
// shipped in the plugin — update this list when the forge points at a different game. Matched as a
// case-insensitive SUBSTRING, so a compound like `build_firing_yard` is caught too. Keep it to
// UNAMBIGUOUS proper nouns — a level/codename that could never be an agnostic word. Convention-shaped
// names the plugin shares with the game (`player`, `guard`, `camera_rig`, `gen_models`) must NOT go
// here, or the gate floods on legitimate teaching examples.
export const GAME_CODENAMES = ["mercenary", "outpost_alpha", "firing_yard"];

// A hardcoded absolute filesystem path (a res:// or project-relative path is required instead).
const ABS_PATH = /(?:\/Users\/|\/home\/[a-z]|\b[A-Za-z]:\\)/;
// A ref into the sibling game dir the framework points at (`../game`) — one game's tree.
const SIBLING_GAME = /\.\.\/game\b/;
// Provenance tying a technique to ONE specific repo/game instead of stating it agnostically.
const PROVENANCE =
  /\b(?:proven|verified|tested|shipped)\s+(?:on|in)\s+this\s+(?:repo|game|project)\b/i;

/** @typedef {{ signal: string, match: string, hint: string }} Contamination */

/** Scan one text blob for contamination signals.
 * @param {string} text
 * @param {{ checkRes?: boolean }} [opts] checkRes: also flag non-universal res:// refs — pass for
 *   TOOLS only (skills/agents cite res:// convention paths as legitimate illustrative examples).
 * @returns {Contamination[]} */
export function scanText(text, opts = {}) {
  /** @type {Contamination[]} */
  const hits = [];
  const abs = text.match(ABS_PATH);
  if (abs)
    hits.push({
      signal: "absolute-path",
      match: abs[0],
      hint: "hardcoded absolute filesystem path — use a res:// or project-relative path so it resolves in any game/checkout.",
    });
  const sib = text.match(SIBLING_GAME);
  if (sib)
    hits.push({
      signal: "sibling-game",
      match: sib[0],
      hint: "reaches into the sibling game dir — the plugin ships to every game and must not reference one game's tree.",
    });
  const prov = text.match(PROVENANCE);
  if (prov)
    hits.push({
      signal: "provenance",
      match: prov[0],
      hint: "provenance tied to a specific repo/game — state the technique agnostically (the game's own record lives game-local).",
    });
  const lower = text.toLowerCase();
  for (const term of GAME_CODENAMES)
    if (lower.includes(term))
      hits.push({
        signal: "codename",
        match: term,
        hint: `game-specific proper noun "${term}" — strip it to the agnostic method; the game's own facts live game-local, not in the plugin.`,
      });
  if (opts.checkRes)
    for (const ref of text.match(RES_REF) ?? [])
      if (!UNIVERSAL_RES.some((re) => re.test(ref))) {
        hits.push({
          signal: "game-res-ref",
          match: ref,
          hint: `game-domain resource ${ref} — plugin/tools/ materializes into EVERY game, so this fails other games' gates on the missing resource. Parameterize the scene (read it from --scene / the manifest) so it has no hardcoded res:// path. See docs/process/promotion.md → "Tool domains".`,
        });
        break; // one non-universal res:// ref is enough to mark the tool game-domain
      }
  return hits;
}

/** Every file at `p` (a single file, or all files under a directory). @param {string} p @returns {string[]} */
export function filesUnder(p) {
  if (!statSync(p).isDirectory()) return [p];
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) out.push(...filesUnder(f));
    else if (e.isFile()) out.push(f);
  }
  return out;
}

/** Scan a path (a file, or every file under a directory) for contamination.
 * @param {string} p
 * @param {{ checkRes?: boolean, all?: boolean }} [opts] all: return every hit per file (default: the
 *   first hit per file — enough for a promote hard-block).
 * @returns {Array<Contamination & { file: string }>} */
export function scanPath(p, opts = {}) {
  /** @type {Array<Contamination & { file: string }>} */
  const out = [];
  for (const f of filesUnder(p)) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // binary / unreadable — no literal refs to find
    }
    const hits = scanText(text, opts);
    for (const h of opts.all ? hits : hits.slice(0, 1))
      out.push({ file: f, signal: h.signal, match: h.match, hint: h.hint });
  }
  return out;
}
