// Server configuration — argv parsing, paths and policy constants, resolved
// once at startup. Importing this module also validates --allow and exits on a
// bad value (a load-time side effect, by design).
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJSON } from "../lib/json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The ui/ directory (this file lives in ui/server/). */
export const UI_DIR = path.join(__dirname, "..");
/** The framework root (the folder you cloned/forked). */
export const FRAMEWORK_DIR = path.join(UI_DIR, "..");
/** The framework's capabilities (agents, skills, tools, hooks) packaged as a local
 * Claude Code plugin — the single source of truth. Loaded into every session via the
 * SDK `plugins` option (see session.js), so a game project needs no copied agents or
 * skills; it stays pure game and the plugin provides the framework regardless of cwd. */
export const FRAMEWORK_PLUGIN_DIR = path.join(FRAMEWORK_DIR, "plugin");
/** Saved-path config written by `npm run setup` — gitignored, so each fork
 * remembers its own game project without committing it. */
export const CONFIG_FILE = path.join(FRAMEWORK_DIR, ".xenodot.json");

const args = process.argv.slice(2);

/** @typedef {{ name?: string, projectFile?: string, bin?: string }} EngineConfig */

/** Parsed `.xenodot.json` (written by `npm run setup`), or `{}` if absent/invalid.
 * Read once: it carries both the saved project path and the engine block. */
const SAVED = (() => {
  try {
    return /** @type {{ projectDir?: string, engine?: EngineConfig, assetLibrary?: string }} */ (
      parseJSON(readFileSync(CONFIG_FILE, "utf8"))
    );
  } catch {
    return {};
  }
})();

/** Where the framework reads the game project from. The framework is
 * independent of the project: it points at this folder in place and never
 * vendors or tracks it. Resolution order (first hit wins):
 *   1. a path argument:        `npm start /path/to/project`
 *   2. the GAME_DIR env var
 *   3. the saved path:         `.xenodot.json` (set once via `npm run setup`)
 *   4. default sibling:        `../game` (next to the framework folder)
 */
function resolveProjectDir() {
  const argPath = args.find((a) => !a.startsWith("--"));
  if (argPath) return path.resolve(argPath);
  if (process.env.GAME_DIR) return path.resolve(process.env.GAME_DIR);
  if (SAVED.projectDir) return path.resolve(SAVED.projectDir);
  return path.resolve(FRAMEWORK_DIR, "..", "game");
}

export const PROJECT_DIR = resolveProjectDir();

/** The target engine: Godot or a source-compatible fork (Redot / Blazium). The
 * forks share Godot's project format, scene files, GDScript and CLI, so swapping
 * the binary is the whole switch — see docs/engines.md. Resolution (first hit
 * wins): env (`ENGINE_NAME` / `ENGINE_PROJECT_FILE` / `ENGINE_BIN`) →
 * `.xenodot.json` `engine` field → Godot defaults.
 *   - `projectFile`: on-disk marker used to detect a project. `project.godot` by
 *     default, which the forks also use, so detection works for them unchanged.
 *   - `bin`: optional engine executable the verify gate runs; when set it is
 *     exported to sessions as `$GODOT` (see session.js). Otherwise the game's
 *     `tools/validate.sh` resolves it from `$GODOT`/PATH. */
export const ENGINE = {
  name: process.env.ENGINE_NAME ?? SAVED.engine?.name ?? "godot",
  projectFile: process.env.ENGINE_PROJECT_FILE ?? SAVED.engine?.projectFile ?? "project.godot",
  bin: process.env.ENGINE_BIN ?? SAVED.engine?.bin ?? null,
};
/** Capitalized engine name for UI/CLI copy, e.g. "Godot", "Redot", "Blazium". */
export const ENGINE_LABEL = ENGINE.name.charAt(0).toUpperCase() + ENGINE.name.slice(1);

/** The game's res:// mount name for the external shared-asset library — a symlink
 * materialize.js creates (`<game>/x-shared-assets` → ASSET_LIBRARY), so a model resolves
 * at `res://x-shared-assets/models/<name>.glb`. One literal, shared across config /
 * materialize / asset-write / doctor / the client, to avoid drift. */
export const RES_ASSET_MOUNT = "x-shared-assets";

/** The external "shared asset library": free-library example assets (models/textures) the
 * game uses but kept OUTSIDE its tree, so the game stays pure game. Symlinked into the game
 * at `res://x-shared-assets/` — and, unlike the knowledge library, NOT .gdignored, so Godot
 * scans and imports it. The framework is per-game, so this dir is effectively this game's,
 * just external. Resolution (first hit wins): env `XENODOT_ASSET_LIBRARY` → `.xenodot.json`
 * `assetLibrary` → default sibling `../x-shared-assets`. May start empty — the framework
 * only needs to know where it is. */
export const ASSET_LIBRARY = path.resolve(
  process.env.XENODOT_ASSET_LIBRARY ??
    SAVED.assetLibrary ??
    path.join(FRAMEWORK_DIR, "..", RES_ASSET_MOUNT),
);

// When an engine binary is configured, propagate it as $GODOT so the verify gate
// uses it. The Claude Code session the SDK spawns inherits this process's env, so
// every `$GODOT` call (tools/validate.sh, the godot-verify skill) hits the chosen
// fork binary with no per-shell setup. A binary set in the shell already (without
// an explicit engine.bin) is left untouched. Load-time side effect, by design.
if (ENGINE.bin) process.env.GODOT = ENGINE.bin;

// Expose the plugin and its knowledge base to the spawned session so framework agents
// can locate the library (and the framework itself, for promotion / self-improvement)
// regardless of the game cwd — they read/write via these paths, granted by
// `additionalDirectories` (see session.js). Inherited by the Claude Code subprocess.
process.env.XENODOT_PLUGIN = FRAMEWORK_PLUGIN_DIR;
process.env.XENODOT_LIBRARY = path.join(FRAMEWORK_PLUGIN_DIR, "library");
// The external shared-asset library (see ASSET_LIBRARY). Exported so the spawned session,
// its agents (asset-advisor reads/verifies the sourced file here) and validate.sh can locate
// it regardless of cwd; the game reaches the same bytes via the res://x-shared-assets symlink.
process.env.XENODOT_ASSET_LIBRARY = ASSET_LIBRARY;

/** Whether PROJECT_DIR actually holds an engine project (Godot or a fork) —
 * drives the startup warning and the UI's empty-state banner. */
export const PROJECT_FOUND = existsSync(path.join(PROJECT_DIR, ENGINE.projectFile));
export const PORT = Number(process.env.PORT ?? 3117);

// Default permission policy for new sessions: ask | edits | all.
// Override per session from the UI header. AskUserQuestion always prompts.
export const POLICIES = ["ask", "edits", "all"];
export const DEFAULT_POLICY = args.find((a) => a.startsWith("--allow="))?.split("=")[1] ?? "ask";
if (!POLICIES.includes(DEFAULT_POLICY)) {
  console.error(`--allow must be one of: ${POLICIES.join(", ")}`);
  process.exit(1);
}
export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// In-process MCP tool the main agent calls to put a typed form in front of the
// user (see makeFormTool). Like AskUserQuestion, the form IS the user
// interaction, so it bypasses the permission policy.
export const FORM_TOOL = "mcp__ui__form";

// In-process MCP tool the orchestrator calls to manage its persistent task
// list (see task-tool.js). Like the form tool it's a UI-control surface, not a
// real side effect, so it bypasses the permission policy.
export const TASK_TOOL = "mcp__ui__tasks";

// In-process MCP tool the agent calls to request one art asset (see asset-tool.js).
// Like the task tool it only files a task-board item (a UI-control surface, no real
// side effect), so it bypasses the permission policy.
export const ASSET_TOOL = "mcp__ui__request_asset";

// In-process MCP tool a (typically backgrounded) agent calls to ask the user a
// question WITHOUT blocking — it files a question onto the board and returns
// immediately, where mcp__ui__form would pause the session waiting on a reply
// (impossible for a fire-and-forget worker). The orchestrator relays the answer on
// a later turn. UI-control surface, no real side effect, so it bypasses the policy.
export const ASK_TOOL = "mcp__ui__ask";

// In-process MCP tool an agent calls to request promoting a game-local capability
// (tool/skill/agent) into the framework plugin. Like the task tool it only files a
// record on the promotions board (a UI-control surface, no real side effect — the
// move happens later via `npm run promote`), so it bypasses the permission policy.
export const PROMOTE_TOOL = "mcp__ui__promote";

// Bare tool names auto-allowed (no permission prompt) for the whole session — the
// read/research/exec toolset background sub-agents need. This is the ONE lever that
// reaches a backgrounded (headless) sub-agent: it has no interactive approver, so
// the SDK auto-denies anything not pre-approved, and only BARE-name allows reach it
// — an argument-scoped settings rule like `Bash(**)`/`Read(**)` does NOT (that's why
// backgrounded researchers were denied Read/Bash/WebSearch/WebFetch despite the
// settings allowlist). Passed as SDK `allowedTools` (see session.js). Deliberately
// NOT Write/Edit — game/library edits ride the agents' `acceptEdits` mode, and
// authoring under `.claude/` stays a foreground, human-approved act (orchestrator
// rule). Bash is safe here because the destructive-git/-shell PreToolUse hooks gate
// it independently of the permission layer.
export const AUTO_ALLOW_TOOLS = ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"];

// The main loop is an orchestrator: pinned model (not the user's default) and a
// routing-focused system prompt, editable in ui/orchestrator.md.
export const MODEL = args.find((a) => a.startsWith("--model="))?.split("=")[1] ?? "claude-opus-4-8";
// Reasoning effort for the orchestrator turn. The main loop routes and dispatches
// rather than reasoning hard, so default to a modest level; each sub-agent's own
// `effort:` frontmatter overrides this while that agent is active. The pinned
// model (claude-opus-4-8) supports low|medium|high|xhigh|max.
export const EFFORT = /** @type {import("@anthropic-ai/claude-agent-sdk").EffortLevel} */ (
  args.find((a) => a.startsWith("--effort="))?.split("=")[1] ?? "medium"
);
export const ORCHESTRATOR_PROMPT = readFileSync(path.join(UI_DIR, "orchestrator.md"), "utf8");

// Claude Code's own transcript store for this project — every session here is
// listed and resumable, terminal ones included.
export const TRANSCRIPT_DIR = path.join(
  homedir(),
  ".claude",
  "projects",
  PROJECT_DIR.replace(/[/.]/g, "-"),
);

export const LOG_DIR = path.join(UI_DIR, "..", "logs");
