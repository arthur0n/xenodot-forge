// Server configuration — argv parsing, paths and policy constants, resolved
// once at startup. Importing this module also validates --allow and exits on a
// bad value (a load-time side effect, by design).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseJSON } from "../../lib/json.js";
import { resolveEngineBin } from "./engine-bin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The ui/ directory (this file lives in ui/server/core/). */
export const UI_DIR = path.join(__dirname, "..", "..");
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

/** OpenAI's official `codex-plugin-cc`, vendored on disk so the SDK can load it as a
 * SECOND local plugin (the SDK `plugins` option only accepts `{ type: "local" }`, no
 * marketplace/git refs). OFF by default and OUTSIDE the framework spine: nothing is
 * committed — `npm run codex:setup` clones it here (gitignored `vendor/`). The loadable
 * plugin root is `plugins/codex/` inside the cloned repo (it carries its own
 * `.claude-plugin/plugin.json`). session.js appends it only when `getCodexConfig().enabled`
 * AND this path exists, so a missing/disabled Codex changes nothing. */
export const CODEX_PLUGIN_DIR = path.join(
  FRAMEWORK_DIR,
  "vendor",
  "codex-plugin-cc",
  "plugins",
  "codex",
);

const args = process.argv.slice(2);

/** @typedef {{ name?: string, projectFile?: string, bin?: string }} EngineConfig */
/** Persisted Hermes block (see getHermesConfig). The apiKey lives only here (the
 * file is gitignored) or in env — it is never returned to the browser.
 * @typedef {{ enabled?: boolean, apiUrl?: string, apiKey?: string, model?: string }} HermesConfig */
/** Persisted Codex block (see getCodexConfig). Just an on/off switch — auth is owned by
 * the local `codex` CLI (`codex login`), so there is no key or URL to store here.
 * @typedef {{ enabled?: boolean }} CodexConfig */
/** Persisted Godot-docs MCP block (see getDocsConfig). Just an on/off switch — the docs
 * server is a stateless public-docs proxy (the bundled `@nuskey8/godot-docs-mcp`), so there is
 * no key or URL to store here. @typedef {{ enabled?: boolean }} DocsConfig */

/** Parsed `.xenodot.json` (written by `npm run setup`), or `{}` if absent/invalid.
 * Read once: it carries both the saved project path and the engine block. */
const SAVED = (() => {
  try {
    return /** @type {{ projectDir?: string, engine?: EngineConfig, assetLibrary?: string, hermes?: HermesConfig }} */ (
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

/** Merge a resolved engine binary into `.xenodot.json` so the lookup is one-time, not
 * per-boot — every other saved field (projectDir, hermes, …) is preserved. Best-effort:
 * a write failure is non-fatal (the in-memory `$GODOT` still works for this run).
 * @param {string} bin */
function persistEngineBin(bin) {
  /** @type {Record<string, unknown>} */
  let saved = {};
  try {
    saved = /** @type {Record<string, unknown>} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    /* absent/invalid — start fresh */
  }
  const prev = /** @type {EngineConfig} */ (saved.engine ?? {});
  try {
    writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ ...saved, engine: { ...prev, bin } }, null, 2) + "\n",
    );
  } catch {
    /* non-fatal — $GODOT is still set in-process for this run */
  }
}

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

// Resolve the engine binary ONCE and propagate it as $GODOT so the verify gate and every
// agent shell use it with no per-call setup. The Claude Code session the SDK spawns inherits
// this process's env, so every `$GODOT` call (tools/validate.sh, the godot-verify skill) hits
// the chosen binary — killing the per-shell `GODOT=…` re-derivation that otherwise repeats on
// every Bash call. Precedence: an explicit engine.bin (env/.xenodot.json) wins untouched; else,
// when nothing is configured, auto-probe and PERSIST the result so the lookup is truly one-time.
// Load-time side effect, by design.
if (ENGINE.bin) {
  process.env.GODOT = ENGINE.bin;
} else {
  const resolved = resolveEngineBin(ENGINE.name);
  if (resolved) {
    ENGINE.bin = resolved;
    process.env.GODOT = resolved;
    persistEngineBin(resolved);
  }
}

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

/** The generated per-game facts manifest (engine bin/version, render config, commands,
 * capability registry) — written by gen-manifest.js inside prepareGame(). Exported so the
 * spawned session and `tools/forge-facts` can read deterministic project facts instead of
 * re-deriving them (re-reading project.godot, re-globbing tools/) on every task. */
export const MANIFEST_FILE = path.join(PROJECT_DIR, ".xenodot", "manifest.json");
process.env.XENODOT_MANIFEST = MANIFEST_FILE;

/** Whether PROJECT_DIR actually holds an engine project (Godot or a fork) —
 * drives the startup warning and the UI's empty-state banner. */
export const PROJECT_FOUND = existsSync(path.join(PROJECT_DIR, ENGINE.projectFile));
export const PORT = Number(process.env.PORT ?? 8338);

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

// In-process MCP tool the orchestrator calls to report on the standing Main Goal
// (Autonomous Mode): op "progress" stamps a one-line status, "complete" files the
// final report and turns the loop off, "pause" stops it. Like the other UI-control
// tools it only mutates local state + broadcasts (no real side effect), so it
// bypasses the permission policy.
export const AUTONOMOUS_TOOL = "mcp__ui__autonomous";

// In-process MCP tool the HIVE (orchestrator main loop) calls to delegate the heavy
// investigation half of research to an external Hermes Agent. Unlike the UI-control
// tools above it is a REAL side effect (a billable network call), so it deliberately
// has NO auto-allow branch in canUseTool — every dispatch hits the per-call
// permission gate (allow/deny in the web UI). Granted to the Hive only: no sub-agent
// frontmatter lists it, so only the foreground Hive can call it.
export const HERMES_TOOL = "mcp__ui__hermes";

/** Hermes model ids for the settings dropdown; the user can also enter a custom id. The Nous
 * Portal (provider `nous`) routes non-Nous ids too (e.g. `qwen/*`, `z-ai/*`), so they're valid
 * picklist entries as long as they're in the Portal model catalog.
 * NOTE: this is a LABEL only — our `runs` call doesn't send a model, and the effective
 * model is chosen inside Hermes itself (`hermes config set model.default …` → `~/.hermes/config.yaml`).
 * Nous also recommends an agentic model to *drive* the agent, so treat these as a record of
 * which Hermes model you pointed Hermes at, not a control. */
export const HERMES_DEFAULT_MODEL = "nousresearch/hermes-4-70b";
export const HERMES_MODELS = [
  "z-ai/glm-5.2",
  "nousresearch/hermes-4-405b",
  HERMES_DEFAULT_MODEL,
  "nousresearch/hermes-4.3-36b",
];

/** Effective Hermes config, resolved fresh on every call (env overrides → `.xenodot.json`
 * `hermes` block → disabled), so switching it on from the CLI or the UI takes effect
 * WITHOUT a server restart. The apiKey is read here but must never be sent to the browser
 * (see hermesPublicConfig).
 * @returns {{ enabled: boolean, apiUrl: string | null, apiKey: string | null, model: string }} */
export function getHermesConfig() {
  /** @type {HermesConfig} */
  let saved = {};
  try {
    saved =
      /** @type {{ hermes?: HermesConfig }} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8")))
        .hermes ?? {};
  } catch {
    /* absent/invalid — treat as no saved block */
  }
  const env = process.env;
  const enabled =
    env.HERMES_ENABLED != null ? env.HERMES_ENABLED === "true" : Boolean(saved.enabled);
  return {
    enabled,
    apiUrl: env.HERMES_API_URL ?? saved.apiUrl ?? null,
    apiKey: env.HERMES_API_KEY ?? saved.apiKey ?? null,
    model: env.HERMES_MODEL ?? saved.model ?? HERMES_DEFAULT_MODEL,
  };
}

/** Browser-safe view of the Hermes config for /api/state: the secret key is replaced
 * by a boolean `hasKey`. @returns {{ enabled: boolean, apiUrl: string | null, model: string, hasKey: boolean, models: string[] }} */
export function hermesPublicConfig() {
  const c = getHermesConfig();
  return {
    enabled: c.enabled,
    apiUrl: c.apiUrl,
    model: c.model,
    hasKey: Boolean(c.apiKey),
    models: HERMES_MODELS,
  };
}

/** Merge a partial Hermes block into `.xenodot.json`, preserving every other field
 * (projectDir, engine, …). An empty-string apiKey is dropped (don't overwrite a saved
 * key with blank when the UI didn't resend it); a non-empty one replaces it.
 * @param {HermesConfig} patch @returns {{ ok: true } | { error: string }} */
export function saveHermesConfig(patch) {
  /** @type {Record<string, unknown>} */
  let saved = {};
  try {
    saved = /** @type {Record<string, unknown>} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    /* absent/invalid — start fresh */
  }
  const prev = /** @type {HermesConfig} */ (saved.hermes ?? {});
  /** @type {HermesConfig} */
  const next = { ...prev };
  if (patch.enabled != null) next.enabled = patch.enabled;
  if (patch.apiUrl != null) next.apiUrl = patch.apiUrl;
  if (patch.model != null) next.model = patch.model;
  if (patch.apiKey) next.apiKey = patch.apiKey; // blank/undefined → keep existing
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...saved, hermes: next }, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Effective Codex config, resolved fresh on every call (env `CODEX_ENABLED` →
 * `.xenodot.json` `codex` block → disabled), so toggling it from the UI or the CLI takes
 * effect WITHOUT a server restart (session.js re-reads it when a new session starts).
 * There is no secret here — Codex auth lives in the local `codex` CLI (`codex login`).
 * @returns {{ enabled: boolean }} */
export function getCodexConfig() {
  /** @type {CodexConfig} */
  let saved = {};
  try {
    saved =
      /** @type {{ codex?: CodexConfig }} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8"))).codex ??
      {};
  } catch {
    /* absent/invalid — treat as no saved block */
  }
  const env = process.env;
  const enabled = env.CODEX_ENABLED != null ? env.CODEX_ENABLED === "true" : Boolean(saved.enabled);
  return { enabled };
}

/** Browser-safe view of the Codex config for /api/state: `enabled` plus whether the plugin
 * has actually been vendored on disk (so the settings panel can tell "switched on but not yet
 * installed" from "ready"). No secrets — there are none. Deliberately does NOT shell out to
 * `codex` (that probe is the Settings "Test" button → codex-check.js), keeping /api/state cheap.
 * @returns {{ enabled: boolean, vendored: boolean }} */
export function codexPublicConfig() {
  return { enabled: getCodexConfig().enabled, vendored: existsSync(CODEX_PLUGIN_DIR) };
}

/** Merge a partial Codex block into `.xenodot.json`, preserving every other field
 * (projectDir, engine, hermes, …). @param {CodexConfig} patch @returns {{ ok: true } | { error: string }} */
export function saveCodexConfig(patch) {
  /** @type {Record<string, unknown>} */
  let saved = {};
  try {
    saved = /** @type {Record<string, unknown>} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    /* absent/invalid — start fresh */
  }
  const prev = /** @type {CodexConfig} */ (saved.codex ?? {});
  /** @type {CodexConfig} */
  const next = { ...prev };
  if (patch.enabled != null) next.enabled = patch.enabled;
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...saved, codex: next }, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write failed" };
  }
}

/** Absolute path to the docs MCP server's launchable entry, or null if the package isn't
 * installed. We resolve the dnt-compiled `esm/` build and run it with `node` directly: the
 * package's `bin` wrongly points at raw `src/index.ts`, which Node refuses to type-strip under
 * node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so `npx`-ing the bin fails. The
 * package is a framework dependency, so this normally resolves; the null guard keeps a missing
 * install from spawning `node undefined` (the toggle then simply mounts nothing). */
export const DOCS_MCP_ENTRY = (() => {
  try {
    return createRequire(import.meta.url).resolve("@nuskey8/godot-docs-mcp/esm/index.js");
  } catch {
    return null;
  }
})();

/** Effective Godot-docs MCP config, resolved fresh on every call (env `DOCS_ENABLED` →
 * `.xenodot.json` `docs` block → disabled), so toggling it from the UI or the CLI takes
 * effect WITHOUT a server restart (session.js re-reads it when a new session starts). The
 * docs MCP is the official-docs source of truth (`@nuskey8/godot-docs-mcp`, run via npx over
 * stdio); there is no secret — it queries the public docs site.
 * @returns {{ enabled: boolean }} */
export function getDocsConfig() {
  /** @type {DocsConfig} */
  let saved = {};
  try {
    saved =
      /** @type {{ docs?: DocsConfig }} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8"))).docs ??
      {};
  } catch {
    /* absent/invalid — treat as no saved block */
  }
  const env = process.env;
  const enabled = env.DOCS_ENABLED != null ? env.DOCS_ENABLED === "true" : Boolean(saved.enabled);
  return { enabled };
}

/** Browser-safe view of the Godot-docs config for /api/state: just `enabled` (there are no
 * secrets). @returns {{ enabled: boolean }} */
export function docsPublicConfig() {
  return { enabled: getDocsConfig().enabled };
}

/** Merge a partial Godot-docs block into `.xenodot.json`, preserving every other field
 * (projectDir, engine, hermes, codex, …). @param {DocsConfig} patch @returns {{ ok: true } | { error: string }} */
export function saveDocsConfig(patch) {
  /** @type {Record<string, unknown>} */
  let saved = {};
  try {
    saved = /** @type {Record<string, unknown>} */ (parseJSON(readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    /* absent/invalid — start fresh */
  }
  const prev = /** @type {DocsConfig} */ (saved.docs ?? {});
  /** @type {DocsConfig} */
  const next = { ...prev };
  if (patch.enabled != null) next.enabled = patch.enabled;
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...saved, docs: next }, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write failed" };
  }
}

// Bare tool names auto-allowed (no permission prompt) for the whole session — the
// read/research/exec toolset background sub-agents need. This is the ONE lever that
// reaches a backgrounded (headless) sub-agent: it has no interactive approver, so
// the SDK auto-denies anything not pre-approved, and only BARE-name allows reach it
// — an argument-scoped settings rule like `Bash(**)`/`Read(**)` does NOT (that's why
// backgrounded researchers were denied Read/Bash/WebSearch/WebFetch despite the
// settings allowlist). Passed as SDK `allowedTools` (see session.js). Deliberately
// NOT Write/Edit — those are granted to backgrounded sub-agents by the plugin's
// `allow-game-edits.sh` PreToolUse hook (game/library paths, `.claude/` excluded).
// We do NOT use a per-agent `permission-mode: acceptEdits` for this: the CLI drops
// escalating modes that come from a repo/plugin trust tier (see
// filterEscalatingDefaultMode), so a plugin agent's acceptEdits is a no-op — which is
// what silently broke background edits. Authoring under `.claude/` stays a foreground,
// human-approved act (orchestrator rule). Bash is safe here because the
// destructive-git/-shell PreToolUse hooks gate it independently of the permission layer.
export const AUTO_ALLOW_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  // Godot-docs MCP tools (mounted only when getDocsConfig().enabled — see session.js).
  // Listed unconditionally: allowing a tool that isn't mounted is a harmless no-op, and a
  // bare full tool id is the one allow-lever that reaches a backgrounded (headless) sub-agent.
  "mcp__godot-docs__godot_docs_search",
  "mcp__godot-docs__godot_docs_get_page",
  "mcp__godot-docs__godot_docs_get_class",
];

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
export const HERMES_BLOCK = readFileSync(path.join(UI_DIR, "hermes-block.md"), "utf8");
/** Absolute path to the vendored Codex companion CLI (OpenAI's `codex-plugin-cc`) — the same
 * Node script the `/codex:*` slash commands wrap. The orchestrator does NOT call this directly;
 * it goes through CODEX_COMPANION (our wrapper) below. */
export const CODEX_VENDOR_COMPANION = path.join(CODEX_PLUGIN_DIR, "scripts", "codex-companion.mjs");
/** The Codex companion the ORCHESTRATOR invokes (injected into CODEX_BLOCK, replacing the
 * `{{CODEX_COMPANION}}` placeholder, so the orchestrator can launch reviews/tasks ITSELF via Bash).
 * A thin framework wrapper around the vendored companion that forces review intents to the
 * `adversarial-review` pass and injects the data-driven review lens (`ui/codex-criteria.md`) —
 * see ui/server/integrations/codex/codex-review.js. Slash commands still hit the vendored script
 * directly. The launch path is consent-gated by policy, not by capability. */
export const CODEX_COMPANION = path.join(
  UI_DIR,
  "server",
  "integrations",
  "codex",
  "codex-review.js",
);
export const CODEX_BLOCK = readFileSync(path.join(UI_DIR, "codex-block.md"), "utf8").replaceAll(
  "{{CODEX_COMPANION}}",
  CODEX_COMPANION,
);
export const DOCS_BLOCK = readFileSync(path.join(UI_DIR, "docs-block.md"), "utf8");

// Claude Code's own transcript store for this project — every session here is
// listed and resumable, terminal ones included.
export const TRANSCRIPT_DIR = path.join(
  homedir(),
  ".claude",
  "projects",
  PROJECT_DIR.replace(/[/.]/g, "-"),
);

export const LOG_DIR = path.join(UI_DIR, "..", "logs");
