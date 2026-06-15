// Materialize the framework's per-game working files into a game directory, so the
// committed game stays pure (both are gitignored) while the plugin remains the single
// source of truth. Regenerated deterministically on server startup, `doctor`, `forge new`.
//
//   • tools/   — COPIED from plugin/tools. Godot's `--script` runs the .gd verify/gen
//                helpers from inside the project (res://), so they must be real files
//                in the game. Read-only at runtime; new tools are added to the plugin.
//   • library/ — SYMLINKED to plugin/library. Researcher agents READ sources and WRITE
//                verdicts/digests here; a symlink keeps the framework the single source
//                so that knowledge persists in the plugin, not a throwaway game copy.
//   • x-shared-assets/ — SYMLINKED to the external asset library (config.js ASSET_LIBRARY):
//                free-library example assets the game uses but keeps OUTSIDE its tree. Unlike
//                library/, this link is NOT .gdignored — Godot must scan & import it.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  chmodSync,
  statSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FRAMEWORK_PLUGIN_DIR, ASSET_LIBRARY, RES_ASSET_MOUNT } from "./config.js";

const TOOLS_SRC = path.join(FRAMEWORK_PLUGIN_DIR, "tools");
const LIB_SRC = path.join(FRAMEWORK_PLUGIN_DIR, "library");

/** Copy plugin/tools → <projectDir>/tools, overwriting only when the source is newer or
 * the file is missing. Additive: never deletes files it didn't write, so a game's own
 * tools survive. @param {string} projectDir @returns {{copied:number, fresh:number}} */
export function materializeTools(projectDir) {
  const tally = { copied: 0, fresh: 0 };
  if (!existsSync(TOOLS_SRC)) return tally;
  const dst = path.join(projectDir, "tools");
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(TOOLS_SRC, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const s = path.join(TOOLS_SRC, entry.name);
    const d = path.join(dst, entry.name);
    if (existsSync(d) && statSync(d).mtimeMs >= statSync(s).mtimeMs) {
      tally.fresh++;
      continue;
    }
    copyFileSync(s, d);
    if (entry.name.endsWith(".sh")) chmodSync(d, 0o755);
    tally.copied++;
  }
  return tally;
}

/** Ensure <projectDir>/library is a symlink to the plugin's library (the single source
 * researcher agents read and write). Idempotent: repoints a stale link, but leaves a real
 * directory in place untouched (a game that committed its own library) rather than
 * clobbering it. @param {string} projectDir @returns {{linked:boolean, reason:string}} */
export function ensureLibraryLink(projectDir) {
  if (!existsSync(LIB_SRC)) return { linked: false, reason: "no plugin library" };
  const link = path.join(projectDir, "library");
  let cur = null;
  try {
    cur = lstatSync(link);
  } catch {
    // link absent — cur stays null
  }
  if (cur?.isSymbolicLink()) {
    if (path.resolve(path.dirname(link), readlinkSync(link)) === path.resolve(LIB_SRC)) {
      return { linked: true, reason: "already linked" };
    }
    rmSync(link);
  } else if (cur) {
    return { linked: false, reason: "a real library/ exists — left untouched" };
  }
  symlinkSync(LIB_SRC, link);
  return { linked: true, reason: "created" };
}

/** Ensure <projectDir>/x-shared-assets is a symlink to the external shared-asset library
 * (config.js ASSET_LIBRARY) — free-library example assets the game uses but keeps OUTSIDE its
 * tree. NOTE: unlike ensureLibraryLink (whose source carries a .gdignore so Godot skips it),
 * this link MUST be scanned by Godot — do NOT add a .gdignore anywhere up this chain, or the
 * assets silently fail to import. Creates the external dir + its models/ and textures/ subdirs
 * first (it may start empty) so the symlink resolves. Idempotent: repoints a stale link, but
 * leaves a real directory untouched (a game that vendored its own).
 * @param {string} projectDir @returns {{linked:boolean, reason:string}} */
export function ensureAssetLibraryLink(projectDir) {
  mkdirSync(path.join(ASSET_LIBRARY, "models"), { recursive: true });
  mkdirSync(path.join(ASSET_LIBRARY, "textures"), { recursive: true });
  const link = path.join(projectDir, RES_ASSET_MOUNT);
  let cur = null;
  try {
    cur = lstatSync(link);
  } catch {
    // link absent — cur stays null
  }
  if (cur?.isSymbolicLink()) {
    if (path.resolve(path.dirname(link), readlinkSync(link)) === path.resolve(ASSET_LIBRARY)) {
      return { linked: true, reason: "already linked" };
    }
    rmSync(link);
  } else if (cur) {
    return { linked: false, reason: `a real ${RES_ASSET_MOUNT}/ exists — left untouched` };
  }
  symlinkSync(ASSET_LIBRARY, link);
  return { linked: true, reason: "created" };
}

/** Prepare a game directory to be driven by the framework: tools copied, library linked,
 * the external shared-asset library mounted.
 * @param {string} projectDir */
export function prepareGame(projectDir) {
  const tools = materializeTools(projectDir);
  const lib = ensureLibraryLink(projectDir);
  const assets = ensureAssetLibraryLink(projectDir);
  return { tools, lib, assets };
}

// CLI: `node ui/server/materialize.js [projectDir]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PROJECT_DIR } = await import("./config.js");
  const target = process.argv[2] ? path.resolve(process.argv[2]) : PROJECT_DIR;
  const { tools, lib, assets } = prepareGame(target);
  console.log(
    `materialize: ${target} — tools copied ${tools.copied}/${tools.copied + tools.fresh}, library ${lib.reason}, ${RES_ASSET_MOUNT} ${assets.reason}.`,
  );
}
