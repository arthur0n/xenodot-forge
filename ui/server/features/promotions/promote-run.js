// The file-move half of promotion: resolve a game-local capability's source +
// plugin destination and move it. Pure (no argv, no process.exit), so both the
// CLI (`promote.js`) and the UI server (a one-click "Promote now" from the
// promotions board) share the exact same move semantics.
import { existsSync, renameSync, rmSync, mkdirSync, cpSync } from "node:fs";
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
  mkdirSync(path.dirname(dst), { recursive: true });
  movePath(src, dst);
  return { ok: true, msg: `moved ${kind}/${name} → plugin` };
}
