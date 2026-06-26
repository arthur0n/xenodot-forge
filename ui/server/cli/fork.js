// forge fork — stamp out a NEW, self-contained workspace that brings the WHOLE framework along
// (its own copy of xenodot-forge, own git, own config), with NO game content carried over.
// This is the opposite of `forge new`: `new` makes a thin game that SHARES this forge (tools
// copied, library symlinked back here, the single source unchanged); `fork` COPIES the framework
// so the new workspace is independent and portable — fork it again, version it on its own.
//
// fork only copies the framework. It does NOT create the game or the shared-asset library — the
// new forge's `./bootstrap` does that by running the existing `npm run new` (scaffolds starter →
// setup → materialize → doctor) and starting the server + graphify. Keeps this script to one job.
//
// Layout produced:
//   <workspace>/xenodot-forge/   ← filtered copy of this framework (no node_modules/.git/logs/…)
//   (game/ and x-shared-assets/ are created later by `./bootstrap` → `npm run new`)
//
// Usage: npm run fork -- /path/to/new-workspace
import { existsSync, readdirSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { FRAMEWORK_DIR } from "../core/config.js";

const argv = process.argv.slice(2);
const targetArg = argv.find((a) => !a.startsWith("--"));
if (!targetArg) {
  console.error(
    "fork: a target workspace path is required.\n  Usage: npm run fork -- /path/to/new-workspace",
  );
  process.exit(1);
}
const workspace = path.resolve(targetArg);
const destForge = path.join(workspace, "xenodot-forge");

// Guard: never clobber an existing, non-empty forge copy (the one destructive-ish risk here).
if (existsSync(destForge) && readdirSync(destForge).length > 0) {
  console.error(`fork: ${destForge} already exists and is not empty — refusing to overwrite.`);
  process.exit(1);
}

// Derived/runtime/secret paths that must NOT travel into the copy. Mirrors the framework's own
// .gitignore (node_modules, logs, vendor, graphify-out, .xenodot-run, opendocs, game_assets,
// plugin/.xenodot, .xenodot.json) plus git internals + macOS cruft. node_modules → `npm ci`,
// graphify-out → `graphify`, .xenodot.json → `npm run setup` (all re-created by ./bootstrap).
const SKIP = new Set([
  "node_modules",
  ".git",
  "logs",
  "vendor",
  "graphify-out",
  ".xenodot-run",
  "opendocs",
  "game_assets",
  ".xenodot.json",
  ".DS_Store",
]);
// plugin/.xenodot is the only nested skip — match it by full relative path.
const PLUGIN_RUNTIME = path.join(FRAMEWORK_DIR, "plugin", ".xenodot");

/** cpSync filter: reject a path when its basename is in SKIP, or it is the plugin runtime dir.
 * @param {string} src @returns {boolean} keep? */
function keep(src) {
  if (path.resolve(src) === path.resolve(PLUGIN_RUNTIME)) return false;
  return !SKIP.has(path.basename(src));
}

console.log(`fork: copying framework → ${destForge}`);
cpSync(FRAMEWORK_DIR, destForge, { recursive: true, filter: keep });

// Own git: the copy is meant to be independently versioned. Best-effort — a missing/odd git
// must not fail the fork (the copy is already on disk and usable).
try {
  execFileSync("git", ["init", "-q", destForge], { stdio: "ignore" });
  console.log(`fork: initialized a fresh git repo in ${destForge}`);
} catch {
  console.log(`fork: skipped 'git init' (git unavailable) — run it yourself if you want one.`);
}

console.log(
  `\nfork: done. Next:\n` +
    `    cd ${destForge}\n` +
    `    ./bootstrap            # npm ci → npm run new (scaffolds game) → start server → graphify (bg)`,
);
