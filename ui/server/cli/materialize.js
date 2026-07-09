// Materialize the framework's per-game working files into a game directory, so the
// committed game stays pure (both are gitignored) while the plugin remains the single
// source of truth. Regenerated deterministically on server startup, `doctor`, `forge new`.
//
//   • tools/   — COPIED (recursively) from plugin/tools. Godot's `--script` runs the .gd
//                verify/gen helpers from inside the project (res://), so they must be real
//                files in the game. Read-only at runtime; new tools are added to the plugin.
//                Recursion also brings tools/lib/ — the runtime stdlib of class_name helpers
//                the game preloads (NodeBuilder, MeshFlasher, …).
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
  readFileSync,
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
import { FRAMEWORK_PLUGIN_DIR, ASSET_LIBRARY, RES_ASSET_MOUNT } from "../core/config.js";
import { generateManifest } from "./gen-manifest.js";
import { generateCapabilities } from "./gen-capabilities.js";

const TOOLS_SRC = path.join(FRAMEWORK_PLUGIN_DIR, "tools");
const LIB_SRC = path.join(FRAMEWORK_PLUGIN_DIR, "library");

/** Copy plugin/tools → <projectDir>/tools (recursively, including tools/lib/ — the runtime
 * stdlib), overwriting only when the source is newer or the file is missing. Additive: never
 * deletes files it didn't write, so a game's own tools survive.
 * @param {string} projectDir @returns {{copied:number, fresh:number}} */
export function materializeTools(projectDir) {
  const tally = { copied: 0, fresh: 0 };
  if (!existsSync(TOOLS_SRC)) return tally;
  copyTreeAdditive(TOOLS_SRC, path.join(projectDir, "tools"), tally);
  return tally;
}

/** Recursively copy srcDir → dstDir, overwriting a file only when the source is newer or the
 * destination is missing (additive: never deletes). Recurses into subdirectories so the runtime
 * stdlib in tools/lib/ is materialized too. Executable scripts — `.sh` or any extensionless file
 * with a `#!` shebang (e.g. `forge-facts`) — are made runnable.
 * @param {string} srcDir @param {string} dstDir @param {{copied:number, fresh:number}} tally */
function copyTreeAdditive(srcDir, dstDir, tally) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeAdditive(s, d, tally);
      continue;
    }
    if (!entry.isFile()) continue;
    if (existsSync(d) && statSync(d).mtimeMs >= statSync(s).mtimeMs) {
      tally.fresh++;
      continue;
    }
    copyFileSync(s, d);
    if (entry.name.endsWith(".sh") || isShebangScript(s)) chmodSync(d, 0o755);
    tally.copied++;
  }
}

/** Whether a file begins with a `#!` shebang — used to give extensionless tool scripts (e.g.
 * `tools/forge-facts`) the executable bit on materialize. @param {string} file @returns {boolean} */
function isShebangScript(file) {
  try {
    return readFileSync(file, "utf8").startsWith("#!");
  } catch {
    return false;
  }
}

/** Core symlink-ensure shared by every materialize link: idempotent (repoints a stale link),
 * but leaves a REAL directory/file in place untouched (a project that committed its own copy)
 * rather than clobbering it. @param {string} src @param {string} link @param {string} realReason
 * reason reported when a real (non-link) entry sits at `link`
 * @returns {{linked:boolean, reason:string}} */
function ensureSymlink(src, link, realReason) {
  let cur = null;
  try {
    cur = lstatSync(link);
  } catch {
    // link absent — cur stays null
  }
  if (cur?.isSymbolicLink()) {
    if (path.resolve(path.dirname(link), readlinkSync(link)) === path.resolve(src)) {
      return { linked: true, reason: "already linked" };
    }
    rmSync(link);
  } else if (cur) {
    return { linked: false, reason: realReason };
  }
  symlinkSync(src, link);
  return { linked: true, reason: "created" };
}

/** Ensure <projectDir>/library is a symlink to the plugin's library (the single source
 * researcher agents read and write). Idempotent: repoints a stale link, but leaves a real
 * directory in place untouched (a game that committed its own library) rather than
 * clobbering it. @param {string} projectDir @returns {{linked:boolean, reason:string}} */
export function ensureLibraryLink(projectDir) {
  if (!existsSync(LIB_SRC)) return { linked: false, reason: "no plugin library" };
  return ensureSymlink(
    LIB_SRC,
    path.join(projectDir, "library"),
    "a real library/ exists — left untouched",
  );
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
  return ensureSymlink(
    ASSET_LIBRARY,
    path.join(projectDir, RES_ASSET_MOUNT),
    `a real ${RES_ASSET_MOUNT}/ exists — left untouched`,
  );
}

/** Prepare a game directory to be driven by the framework: tools copied, library linked,
 * the external shared-asset library mounted.
 * @param {string} projectDir */
export function prepareGame(projectDir) {
  const tools = materializeTools(projectDir);
  const lib = ensureLibraryLink(projectDir);
  const assets = ensureAssetLibraryLink(projectDir);
  // Tools are now in place, so the manifest's capability list reflects them. Generate after
  // copy. Best-effort: a manifest failure must not break the materialize/doctor/new path.
  let manifest = null;
  try {
    manifest = generateManifest(projectDir);
  } catch {
    /* non-fatal — agents fall back to re-deriving facts if the manifest is absent */
  }
  // The skills-side capability map (domains + in-profile), from the plugin registry + the game
  // profile. Same best-effort discipline: a failure here must not break materialize/doctor/new.
  let capabilities = null;
  try {
    capabilities = generateCapabilities(projectDir);
  } catch {
    /* non-fatal — the runtime filter falls back to fail-open (keep all) if the index is absent */
  }
  return { tools, lib, assets, manifest, capabilities };
}

// CLI: `node ui/server/cli/materialize.js [projectDir]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PROJECT_DIR } = await import("../core/config.js");
  const arg = process.argv[2];
  // A flag-shaped arg must never resolve to a scaffold target (`--help` became a real dir once).
  if (arg?.startsWith("-")) {
    console.error(
      `materialize: ${arg} is not a project path. Usage: npm run materialize -- <path>`,
    );
    process.exit(1);
  }
  const target = arg ? path.resolve(arg) : PROJECT_DIR;
  const { tools, lib, assets } = prepareGame(target);
  console.log(
    `materialize: ${target} — tools copied ${tools.copied}/${tools.copied + tools.fresh}` +
      `, library ${lib.reason}` +
      `, ${RES_ASSET_MOUNT} ${assets.reason}.`,
  );
}
