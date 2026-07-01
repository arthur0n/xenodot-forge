// Contamination gate — the deterministic half of the "is this capability AGNOSTIC?" rubric, run over
// the plugin's OWN skills/agents/tools. promote-run.js blocks contamination at the game→plugin
// boundary; this is the ONLY thing that catches capabilities authored DIRECT-TO-PLUGIN (bypassing
// promote entirely, as the WIP enemy skills did). Shares the exact scanner with promote
// (ui/server/features/promotions/contamination.js), so there is one definition and no drift. Mirrors
// gen-skill-scope.js: bare-node; wired into `npm run validate`, the pre-commit hook, and CI.
//
// Scans the PROMOTABLE kinds (skills/agents/tools) — NOT plugin/library/, whose agnostic-records
// cleanup (game-coupled addon/tool digests) is tracked separately in the audit ledger.
//   node ui/server/cli/gen-contamination.js     # exits 1 on any contamination
import { existsSync } from "node:fs";
import path from "node:path";
import { FRAMEWORK_PLUGIN_DIR } from "../core/config.js";
import { scanPath } from "../features/promotions/contamination.js";

// res:// is checked for TOOLS only — a tool with a hardcoded game scene breaks other games' gates,
// whereas skills/agents cite res:// convention paths as legitimate illustrative examples.
const DIRS = [
  { dir: "skills", checkRes: false },
  { dir: "agents", checkRes: false },
  { dir: "tools", checkRes: true },
];

/** @type {Array<{ file: string, signal: string, match: string, hint: string }>} */
const hits = [];
for (const { dir, checkRes } of DIRS) {
  const root = path.join(FRAMEWORK_PLUGIN_DIR, dir);
  if (!existsSync(root)) continue;
  hits.push(...scanPath(root, { checkRes, all: true }));
}

if (hits.length) {
  console.error(`✗ contamination: ${hits.length} game-specific ref(s) in the plugin spine:`);
  for (const h of hits) {
    console.error(
      `    ${path.relative(FRAMEWORK_PLUGIN_DIR, h.file)}: "${h.match}" (${h.signal}) — ${h.hint}`,
    );
  }
  console.error(
    "  The plugin ships to EVERY game and must stay agnostic. Strip the game-specific ref (the " +
      "game's own facts live game-local), or parameterize it — the same rule promote enforces.",
  );
  process.exit(1);
}
console.log("ok  contamination: plugin skills/agents/tools are agnostic");
