// The file-move half of promotion: resolve a game-local capability's source +
// plugin destination and move it. Pure (no argv, no process.exit), so both the
// CLI (`promote.js`) and the UI server (a one-click "Promote now" from the
// promotions board) share the exact same move semantics.
import { existsSync, readFileSync, renameSync, rmSync, mkdirSync, cpSync } from "node:fs";
import path from "node:path";
import { FRAMEWORK_PLUGIN_DIR } from "../../core/config.js";
import { scanPath } from "./contamination.js";

export const PROMOTE_KINDS = new Set(["skills", "agents", "tools"]);

// smoke_*.gd / play_*.gd auto-join the gate by filename glob (tools/lib/checks.sh
// run_gd_bots) — no explicit reference needed.
const AUTO_GLOB_RE = /^(smoke|play)_.*\.gd$/;

/** Whether a game-local tool is actually wired into the gate: it either matches the
 * smoke_ / play_ auto-glob prefix, or its name is referenced by the game's validate.sh /
 * validate.local.sh / checks.sh. Used to reject promoting an orphan tool nothing runs.
 * @param {string} name @param {string} game @returns {boolean} */
export function isGateWired(name, game) {
  if (AUTO_GLOB_RE.test(name)) return true;
  const wiringFiles = [
    path.join(game, "tools", "validate.sh"),
    path.join(game, "tools", "validate.local.sh"),
    path.join(game, "tools", "lib", "checks.sh"),
  ];
  return wiringFiles.some((file) => {
    try {
      return readFileSync(file, "utf8").includes(name);
    } catch {
      return false;
    }
  });
}

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

/** Promote one capability game→plugin. Never throws on a skip — returns the outcome so
 * the batch path can keep going. @param {string} kind @param {string} name @param {string} game
 * @param {{ force?: boolean }} [opts] force: promote despite a contamination block (CLI --force).
 * @returns {{ ok: boolean, msg: string }} */
export function promoteOne(kind, name, game, opts = {}) {
  if (!PROMOTE_KINDS.has(kind)) return { ok: false, msg: `skip ${kind}/${name}: unknown kind` };
  const { src, dst } = locate(kind, name, game);
  // Check "already in the plugin" BEFORE "missing game-local source": a capability already shipped
  // in the plugin usually has NO game-local copy, so the src-missing check would otherwise fire a
  // confusing "not found at <game path>" instead of the clear "already in the plugin" skip.
  if (existsSync(dst))
    return {
      ok: false,
      msg:
        `skip ${kind}/${name}: it is already in the plugin (${dst}). ` +
        `promote only ADDS new capabilities — it never UPDATES core. To improve it, edit it ` +
        `in the plugin directly (it re-materializes to every game); keep game-specific bits ` +
        `in a game-local extension the core sources. See docs/process/promotion.md → "Updating an existing core file".`,
    };
  if (!existsSync(src)) return { ok: false, msg: `skip ${kind}/${name}: not found at ${src}` };
  // Contamination gate: plugin/ ships to EVERY game, so a promoted capability must be AGNOSTIC.
  // res:// game-domain refs are a hard functional break for TOOLS only (a hardcoded scene fails other
  // games' gates); skills/agents cite res:// convention paths legitimately, so they are gated on the
  // universal signals (codenames, absolute/sibling-game paths, provenance) instead. --force overrides.
  if (!opts.force) {
    const [hit] = scanPath(src, { checkRes: kind === "tools" });
    if (hit)
      return {
        ok: false,
        msg:
          `skip ${kind}/${name}: GAME-CONTAMINATION (${hit.signal}) — ` +
          `${path.relative(game, hit.file)} contains "${hit.match}". ${hit.hint} ` +
          `plugin/ ships to every game, so it must be agnostic (the game's own facts live game-local). ` +
          `Fix it and re-promote, or pass --force to promote anyway. See docs/process/promotion.md.`,
      };
  }
  mkdirSync(path.dirname(dst), { recursive: true });
  movePath(src, dst);
  return { ok: true, msg: `moved ${kind}/${name} → plugin` };
}
