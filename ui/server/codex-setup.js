// Guided one-shot Codex setup — makes the OPTIONAL OpenAI Codex code reviewer usable from
// Xenodot, without touching the framework spine (`plugin/`). End to end:
//
//   1. check the `codex` CLI is installed (offer `npm i -g @openai/codex` if it's missing),
//   2. check you're logged in (`codex login status`) and, if not, print the one command to
//      run — `codex login` (ChatGPT account incl. Free tier, OR an OpenAI API key). We never
//      store or see the credential; the Codex CLI owns it (auth.json under CODEX_HOME),
//   3. VENDOR the plugin: clone OpenAI's `codex-plugin-cc` into the gitignored `vendor/` dir,
//      because the Agent SDK's `plugins` option only loads `{ type: "local" }` paths — there
//      is no marketplace/git source at the SDK layer (so we put it on disk ourselves),
//   4. flip Xenodot's `.xenodot.json` `codex` block on, so session.js loads the plugin.
//
// We deliberately do NOT enable the plugin's opt-in Stop-hook "review gate" (it can spin up
// long Claude↔Codex loops). Reviews stay ON-DEMAND: type `/codex:review` in a session.
//
// Usage: npm run codex:setup                       guided (only prompt: install y/N)
//        npm run codex:setup -- --yes              assume yes (auto-install + clone)
//        npm run codex:setup -- --ref=v1.2.3       pin the plugin clone to a tag/branch
//        npm run codex:setup -- --reset            UNDO: disable + remove the vendored clone
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { saveCodexConfig, CONFIG_FILE, CODEX_PLUGIN_DIR, FRAMEWORK_DIR } from "./config.js";

const argv = process.argv.slice(2);
/** @param {string} n @returns {boolean} */
const flag = (n) => argv.includes(`--${n}`);
/** @param {string} n @returns {string | undefined} */
const val = (n) =>
  argv
    .find((a) => a.startsWith(`--${n}=`))
    ?.split("=")
    .slice(1)
    .join("=");

const ASSUME_YES = flag("yes");
const RESET = flag("reset");
const REPO_URL = "https://github.com/openai/codex-plugin-cc";
const REF = val("ref"); // optional tag/branch to pin the clone to
// The clone target (gitignored). CODEX_PLUGIN_DIR points at `<this>/plugins/codex`, the
// loadable plugin root the SDK is given (it carries `.claude-plugin/plugin.json`).
const VENDOR_DIR = path.join(FRAMEWORK_DIR, "vendor", "codex-plugin-cc");
const PLUGIN_MANIFEST = path.join(CODEX_PLUGIN_DIR, ".claude-plugin", "plugin.json");
const INSTALL_CMD = "npm install -g @openai/codex";

/** Ask a yes/no-ish question; with --yes, auto-answer "y".
 * @param {import("node:readline/promises").Interface} rl @param {string} q @returns {Promise<string>} */
async function ask(rl, q) {
  if (ASSUME_YES) return "y";
  return (await rl.question(q)).trim().toLowerCase();
}

/** @param {string} a @returns {boolean} */
const yes = (a) => a === "y" || a === "yes";

/** Is a command on PATH (exit 0 for `<cmd> <probe>`)? @param {string} cmd @param {string[]} probe @returns {boolean} */
const onPath = (cmd, probe) => spawnSync(cmd, probe, { stdio: "ignore" }).status === 0;

/** Node must be ≥ 18.18 (the plugin's stated floor). @returns {boolean} */
function nodeOk() {
  const [maj = 0, min = 0] = process.versions.node.split(".").map(Number);
  return maj > 18 || (maj === 18 && min >= 18);
}

/** Ensure the `codex` CLI is installed, offering the global npm install.
 * @param {import("node:readline/promises").Interface} rl @returns {Promise<boolean>} */
async function ensureCli(rl) {
  if (onPath("codex", ["--version"])) {
    console.log("✓ codex CLI is installed.");
    return true;
  }
  if (!onPath("npm", ["--version"])) {
    console.log("codex is not on PATH and npm is unavailable. Install Codex, then re-run.");
    console.log(`    ${INSTALL_CMD}`);
    return false;
  }
  console.log("codex is not on your PATH. It can be installed globally with:");
  console.log(`    ${INSTALL_CMD}\n`);
  if (!yes(await ask(rl, "Run it now? [y/N] "))) {
    console.log("Skipped. Install Codex yourself, then re-run `npm run codex:setup`.");
    return false;
  }
  if (spawnSync("npm", ["install", "-g", "@openai/codex"], { stdio: "inherit" }).status !== 0) {
    console.error("Install failed — see the output above.");
    return false;
  }
  if (!onPath("codex", ["--version"])) {
    console.log("\nInstalled, but `codex` isn't on PATH in THIS shell yet.");
    console.log("Open a new terminal (or reload your shell), then re-run `npm run codex:setup`.");
    return false;
  }
  return true;
}

/** `codex login status` exits 0 when authenticated. We never store the credential — just
 * tell the user the one command to run if they're not logged in. @returns {boolean} */
function checkAuth() {
  if (onPath("codex", ["login", "status"])) {
    console.log("✓ Logged in to Codex.");
    return true;
  }
  console.log(
    "• Not logged in to Codex. Run this once (browser / API key, billed to YOUR account):",
  );
  console.log("    codex login            # or, inside a Claude Code session:  ! codex login");
  console.log(
    "  Codex review is billed to your ChatGPT/OpenAI account — your Anthropic plan doesn't cover it.",
  );
  return false;
}

/** Clone `codex-plugin-cc` into the gitignored vendor dir (idempotent: a no-op when the plugin
 * manifest is already present). @returns {boolean} whether the plugin is on disk afterwards. */
function vendorPlugin() {
  if (existsSync(PLUGIN_MANIFEST)) {
    console.log(`✓ Review plugin already vendored → ${CODEX_PLUGIN_DIR}`);
    return true;
  }
  if (!onPath("git", ["--version"])) {
    console.log(
      `• git is unavailable — clone it yourself:\n    git clone ${REPO_URL} ${VENDOR_DIR}`,
    );
    return false;
  }
  // A leftover partial clone (dir exists but no manifest) would make `git clone` fail; clear it.
  if (existsSync(VENDOR_DIR)) rmSync(VENDOR_DIR, { recursive: true, force: true });
  mkdirSync(path.dirname(VENDOR_DIR), { recursive: true });
  const args = ["clone", "--depth", "1", ...(REF ? ["--branch", REF] : []), REPO_URL, VENDOR_DIR];
  console.log(`Cloning ${REPO_URL}${REF ? ` (${REF})` : ""} → vendor/codex-plugin-cc …`);
  if (spawnSync("git", args, { stdio: "inherit" }).status !== 0) {
    console.error("Clone failed — check your network, then re-run `npm run codex:setup`.");
    return false;
  }
  if (!existsSync(PLUGIN_MANIFEST)) {
    console.error(
      `Cloned, but ${PLUGIN_MANIFEST} is missing — the plugin layout may have changed.`,
    );
    return false;
  }
  console.log(`✓ Review plugin vendored → ${CODEX_PLUGIN_DIR}`);
  return true;
}

/** Flip Xenodot's codex switch on. @returns {boolean} */
function enableCodex() {
  const res = saveCodexConfig({ enabled: true });
  if ("error" in res) {
    console.error(`Failed to save Xenodot config: ${res.error}`);
    return false;
  }
  console.log(`✓ Xenodot wired → ${CONFIG_FILE} (codex enabled)`);
  return true;
}

/** Undo what setup wrote: disable the switch and remove the vendored clone. Leaves the global
 * `codex` CLI and your `codex login` session untouched. */
function resetSetup() {
  console.log("Xenodot · removing the Codex setup\n");
  const res = saveCodexConfig({ enabled: false });
  console.log("error" in res ? `• ${res.error}` : "✓ Disabled codex in .xenodot.json.");
  if (existsSync(VENDOR_DIR)) {
    rmSync(VENDOR_DIR, { recursive: true, force: true });
    console.log("✓ Removed the vendored vendor/codex-plugin-cc clone.");
  } else {
    console.log("• No vendored clone to remove (already clean).");
  }
  console.log("\nDone. (The global `codex` CLI and your `codex login` session are untouched.)");
}

/** @param {boolean} ready */
function printNext(ready) {
  console.log("\nNext:");
  console.log("  • Verify anytime:  npm run codex:check   (⚙ Settings → Test too)");
  console.log("  • In a game session, type  /codex:review --base main  to review the game diff,");
  console.log('    or  /codex:adversarial-review "focus on save/load"  for a steerable pass.');
  console.log(
    "  • For framework code, install the plugin in a terminal Claude Code session — see CODEX.md.",
  );
  if (!ready) {
    console.log(
      "\n• Not fully ready yet — re-run `npm run codex:check` after fixing the items above.",
    );
  }
}

async function main() {
  if (RESET) {
    resetSetup();
    return;
  }
  console.log("Xenodot · guided Codex setup (optional, on-demand code review)\n");
  if (!nodeOk()) {
    console.error(`✗ Node ${process.versions.node} is too old — Codex needs Node ≥ 18.18.`);
    process.exitCode = 1;
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!(await ensureCli(rl))) {
      process.exitCode = 1;
      return;
    }
    const authed = checkAuth();
    const vendored = vendorPlugin();
    enableCodex();
    printNext(authed && vendored);
  } finally {
    rl.close();
  }
}

await main();
