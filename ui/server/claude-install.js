// Deploy the framework's vendored game config (game-config/) into a game project's
// .claude/, WITHOUT overwriting files that already exist. Forkers run this once after
// `npm run setup`. Use --force for a clean reset (overwrite everything).
//
// Usage: npm run claude:install               (target = configured game, see config.js)
//        npm run claude:install -- --force
//        node ui/server/claude-install.js /path/to/game [--force]
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PROJECT_DIR, FRAMEWORK_DIR } from "./config.js";

const SRC = path.join(FRAMEWORK_DIR, "game-config");
const force = process.argv.slice(2).includes("--force");
const dest = path.join(PROJECT_DIR, ".claude");

if (!existsSync(SRC)) {
  console.error(`claude:install: ${SRC} not found — run \`npm run claude:sync\` first.`);
  process.exit(1);
}

const tally = { created: 0, overwritten: 0, skipped: 0 };

/** Recursively copy src → dst, skipping existing files unless --force.
 * @param {string} src @param {string} dst */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d);
    } else if (!existsSync(d)) {
      copyFileSync(s, d);
      tally.created++;
    } else if (force) {
      copyFileSync(s, d);
      tally.overwritten++;
    } else {
      tally.skipped++;
    }
  }
}

/** @returns {boolean} */
function hasRtk() {
  try {
    execFileSync("rtk", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

copyTree(SRC, dest);

console.log(
  `claude:install: ${dest} — created ${tally.created}, overwritten ${tally.overwritten}, skipped ${tally.skipped}.`,
);
if (tally.skipped && !force) {
  console.log(
    `  ${tally.skipped} existing file(s) left untouched. Re-run with --force to overwrite.`,
  );
}
if (!hasRtk()) {
  console.log("  Note: `rtk` is not on PATH. The hook no-ops safely until you install it.");
}
console.log("  If the rtk hook doesn't fire, approve it once via /hooks in Claude Code.");
