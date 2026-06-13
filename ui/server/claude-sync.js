// Vendor the reference game's Claude config (agents + skills) into the committed
// game-config/ folder, so the framework always ships the latest agents/skills to
// forkers. Run manually with `npm run claude:sync`; also wired into .husky/pre-commit
// so the shippable bundle never drifts. Honors .xenodot.json (see config.js) to locate
// the reference game.
//
// game-config/settings.json is authored in the framework directly (the reference game
// has no settings.json) and is intentionally NOT touched here.
//
// Note for forks: running this vendors YOUR game's config into YOUR fork — which is the
// correct behavior for a fork that ships its own agents/skills.
import { existsSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PROJECT_DIR, PROJECT_FOUND, FRAMEWORK_DIR } from "./config.js";

const DEST = path.join(FRAMEWORK_DIR, "game-config");
const PARTS = ["agents", "skills"];

if (!PROJECT_FOUND) {
  console.warn(`claude:sync: no game project at ${PROJECT_DIR} — nothing to sync.`);
  process.exit(0);
}

const srcClaude = path.join(PROJECT_DIR, ".claude");
let copied = 0;
for (const part of PARTS) {
  const src = path.join(srcClaude, part);
  if (!existsSync(src)) continue;
  const dest = path.join(DEST, part);
  rmSync(dest, { recursive: true, force: true }); // mirror: prune removed files
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  copied++;
}

if (copied === 0) {
  console.warn(`claude:sync: no agents/ or skills/ under ${srcClaude} — skipping.`);
  process.exit(0);
}

execFileSync("git", ["add", DEST], { stdio: "ignore" });
console.log(`claude:sync: vendored ${PARTS.join(", ")} from ${srcClaude} → game-config/ (staged).`);
