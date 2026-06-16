// forge promote — move a game-local capability into the framework plugin so EVERY game
// gets it. Authoring defaults to game-local (game/.claude/skills|agents, or game/tools);
// promotion is the deliberate, human-chosen step that globalizes it (the executor behind
// the orchestrator's "promote to the framework?" gate). After the move the capability is
// gone from this game and the next session loads it from the plugin as xenodot:<name>.
// (Agnostic tools are then copied back into the game as a working copy by materialize.)
//
// Two modes:
//   • Explicit:        npm run promote -- <skills|agents|tools> <name> [/path/to/game]
//                        e.g. npm run promote -- tools profile_frame.gd
//   • Manifest-driven: npm run promote -- --pending [/path/to/game]
//                        promotes every APPROVED entry in .xenodot/promotions.json (filed
//                        via mcp__ui__promote, approved in the UI) and marks it `promoted`.
import path from "node:path";
import { PROJECT_DIR } from "./config.js";
import { approvedPending, markPromoted, readPromotions, summarize } from "./promotions-store.js";
import { PROMOTE_KINDS as KINDS, promoteOne } from "./promote-run.js";

const argv = process.argv.slice(2);
const pending = argv.includes("--pending");
const positional = argv.filter((a) => !a.startsWith("--"));

if (pending) {
  const game = positional[0] ? path.resolve(positional[0]) : PROJECT_DIR;
  const queue = approvedPending();
  if (!queue.length) {
    console.log(`promote --pending: nothing approved-pending. ${summarize(readPromotions())}`);
    process.exit(0);
  }
  let done = 0;
  for (const p of queue) {
    const r = promoteOne(p.kind, p.name, game);
    console.log(`  ${r.ok ? "✓" : "–"} ${r.msg}`);
    if (r.ok) {
      markPromoted(p.id, new Date().toISOString());
      done++;
    }
  }
  console.log(
    `promote --pending: ${done}/${queue.length} promoted. Restart the session to load them` +
      (done ? "; `npm run badges` refreshes the README counts." : "."),
  );
  process.exit(0);
}

// Explicit mode.
const [kind, name, gameArg] = positional;
const game = gameArg ? path.resolve(gameArg) : PROJECT_DIR;
if (!kind || !KINDS.has(kind) || !name) {
  console.error("usage: npm run promote -- <skills|agents|tools> <name> [/path/to/game]");
  console.error(
    "   or: npm run promote -- --pending [/path/to/game]   (promote approved requests)",
  );
  process.exit(1);
}
const result = promoteOne(kind, name, game);
if (!result.ok) {
  console.error(`promote: ${result.msg}`);
  if (result.msg.includes("not found")) {
    console.error(`  Author the ${kind.replace(/s$/, "")} game-local first, then promote it.`);
  }
  process.exit(1);
}
const label = name.replace(/\.md$/, "");
console.log(`promote: ${result.msg}`);
console.log(`Now available to every game as xenodot:${label} — restart the session to load it.`);
if (kind !== "tools") console.log("Tip: run `npm run badges` to refresh the README counts.");
