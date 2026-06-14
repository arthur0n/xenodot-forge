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
/** Saved-path config written by `npm run setup` — gitignored, so each fork
 * remembers its own game project without committing it. */
export const CONFIG_FILE = path.join(FRAMEWORK_DIR, ".xenodot.json");

const args = process.argv.slice(2);

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
  try {
    const saved = /** @type {{ projectDir?: string }} */ (
      parseJSON(readFileSync(CONFIG_FILE, "utf8"))
    );
    if (saved.projectDir) return path.resolve(saved.projectDir);
  } catch {}
  return path.resolve(FRAMEWORK_DIR, "..", "game");
}

export const PROJECT_DIR = resolveProjectDir();
/** Whether PROJECT_DIR actually holds a Godot project — drives the startup
 * warning and the UI's empty-state banner. */
export const PROJECT_FOUND = existsSync(path.join(PROJECT_DIR, "project.godot"));
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
