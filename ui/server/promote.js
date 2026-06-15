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
import { existsSync, renameSync, rmSync, mkdirSync, cpSync } from "node:fs";
import path from "node:path";
import { PROJECT_DIR, FRAMEWORK_PLUGIN_DIR } from "./config.js";
import { approvedPending, markPromoted, readPromotions, summarize } from "./promotions-store.js";

const KINDS = new Set(["skills", "agents", "tools"]);
const argv = process.argv.slice(2);
const pending = argv.includes("--pending");
const positional = argv.filter((a) => !a.startsWith("--"));

/** Resolve the game-local source path and the plugin destination for this capability.
 * @param {string} kind @param {string} name @param {string} game */
function locate(kind, name, game) {
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
function promoteOne(kind, name, game) {
  if (!KINDS.has(kind)) return { ok: false, msg: `skip ${kind}/${name}: unknown kind` };
  const { src, dst } = locate(kind, name, game);
  if (!existsSync(src)) return { ok: false, msg: `skip ${kind}/${name}: not found at ${src}` };
  if (existsSync(dst))
    return { ok: false, msg: `skip ${kind}/${name}: already in the plugin (${dst})` };
  mkdirSync(path.dirname(dst), { recursive: true });
  movePath(src, dst);
  return { ok: true, msg: `moved ${kind}/${name} → plugin` };
}

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
