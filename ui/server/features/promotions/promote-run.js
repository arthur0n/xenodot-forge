// The file-move half of promotion: resolve a game-local capability's source +
// plugin destination and move it. Pure (no argv, no process.exit), so both the
// CLI (`promote.js`) and the UI server (a one-click "Promote now" from the
// promotions board) share the exact same move semantics.
import {
  existsSync,
  renameSync,
  rmSync,
  mkdirSync,
  cpSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { FRAMEWORK_PLUGIN_DIR } from "../../core/config.js";

export const PROMOTE_KINDS = new Set(["skills", "agents", "tools"]);

/** Resolve the game-local source path and the plugin destination for this capability.
 * @param {string} kind @param {string} name @param {string} game */
export function locate(kind, name, game) {
  if (kind === "skills") {
    return {
      src: path.join(game, ".claude", "skills", name),
      dst: path.join(FRAMEWORK_PLUGIN_DIR, "skills", name),
    };
  }
  if (kind === "agents") {
    const file = name.endsWith(".md") ? name : `${name}.md`;
    return {
      src: path.join(game, ".claude", "agents", file),
      dst: path.join(FRAMEWORK_PLUGIN_DIR, "agents", file),
    };
  }
  return {
    src: path.join(game, "tools", name),
    dst: path.join(FRAMEWORK_PLUGIN_DIR, "tools", name),
  };
}

/** Move src→dst, falling back to copy+remove across filesystems. @param {string} src @param {string} dst */
function movePath(src, dst) {
  try {
    renameSync(src, dst);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e)?.code !== "EXDEV") throw e;
    cpSync(src, dst, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

// Tool DOMAIN gate (universal vs game). plugin/tools/ materializes into EVERY game, so a
// promotable tool must be UNIVERSAL: it hardcodes no game-specific resource path. A verify/play
// bot bound to one game's scene (e.g. play_*.gd referencing res://levels/test_arena.tscn) is
// GAME-DOMAIN — promoting it drops it into every game's tools/, where the missing scene fails the
// gate (this is how orphan play_boss_*/verify_arena_* bots accumulated). It must stay game-local.
// Universal resource refs every game shares are allowed; anything else marks it game-domain.
const UNIVERSAL_RES = [
  /^res:\/\/main\.tscn\b/,
  /^res:\/\/assets\//,
  /^res:\/\/x-shared-assets\//,
  /^res:\/\/\.godot\//,
  /^res:\/\/addons\//,
];
// Literal engine resource refs (a `$VAR`/arg-built path like `res://$SCENE` has no literal
// extension here, so a tool that takes its scene as a parameter is correctly seen as universal).
const RES_REF = /res:\/\/[A-Za-z0-9_./-]+\.(?:tscn|tres|escn|glb|gltf)\b/g;

/** Every file at `p` (a single file, or all files under a tool directory). @param {string} p */
function filesUnder(p) {
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

/** The first hardcoded game-specific resource ref in a tool, or null if it is universal.
 * @param {string} p @returns {string | null} */
function gameDomainRef(p) {
  for (const f of filesUnder(p)) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // binary / unreadable — no literal refs to find
    }
    for (const ref of text.match(RES_REF) ?? []) {
      if (!UNIVERSAL_RES.some((re) => re.test(ref))) return ref;
    }
  }
  return null;
}

/** Promote one capability game→plugin. Never throws on a skip — returns the outcome so
 * the batch path can keep going. @param {string} kind @param {string} name @param {string} game
 * @returns {{ ok: boolean, msg: string }} */
export function promoteOne(kind, name, game) {
  if (!PROMOTE_KINDS.has(kind)) return { ok: false, msg: `skip ${kind}/${name}: unknown kind` };
  const { src, dst } = locate(kind, name, game);
  if (!existsSync(src)) return { ok: false, msg: `skip ${kind}/${name}: not found at ${src}` };
  if (existsSync(dst))
    return {
      ok: false,
      msg:
        `skip ${kind}/${name}: it is a materialized core file already in the plugin (${dst}). ` +
        `promote only ADDS new capabilities — it never UPDATES core. To improve it, edit it ` +
        `in the plugin directly (it re-materializes to every game); keep game-specific bits ` +
        `in a game-local extension the core sources. See docs/process/promotion.md → "Updating an existing core file".`,
    };
  if (kind === "tools") {
    const ref = gameDomainRef(src);
    if (ref)
      return {
        ok: false,
        msg:
          `skip tools/${name}: GAME-DOMAIN tool — it hardcodes ${ref}, a resource only this game has. ` +
          `plugin/tools/ materializes into EVERY game, so promoting it fails other games' gates on the ` +
          `missing scene (how orphan play_*/verify_* bots accumulated). Keep it game-local in tools/. ` +
          `To make it universal, parameterize the scene (read it from --scene / the manifest) so it has ` +
          `no hardcoded res:// path, then re-promote. See docs/process/promotion.md → "Tool domains".`,
      };
  }
  mkdirSync(path.dirname(dst), { recursive: true });
  movePath(src, dst);
  return { ok: true, msg: `moved ${kind}/${name} → plugin` };
}
