// Xenodot Codex review wrapper — the `CODEX_COMPANION` the ORCHESTRATOR invokes (config.js
// repoints CODEX_COMPANION here and keeps the vendored script as CODEX_VENDOR_COMPANION).
//
// Everything is passed THROUGH to the vendored `codex-companion.mjs` unchanged, EXCEPT review
// intents: those are forced to `adversarial-review` (the only review kind whose prompt we can
// shape — plain `review` is OpenAI's native reviewer with no focus slot) with the framework's
// data-driven review lens (`ui/codex-criteria.md`) prepended to any caller focus. The lens thus
// reaches the Codex reviewer WITHOUT living in the orchestrator's system prompt.
//
// Known, accepted gap: a review the USER launches by typing `/codex:review` calls the vendored
// script directly and bypasses this wrapper, so it carries no lens (documented in codex-block.md).
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This file lives in ui/server/integrations/codex/ — ui/ is three levels up.
const UI_DIR = path.resolve(__dirname, "..", "..", "..");
const FRAMEWORK_DIR = path.join(UI_DIR, "..");
const VENDOR_COMPANION = path.join(
  FRAMEWORK_DIR,
  "vendor",
  "codex-plugin-cc",
  "plugins",
  "codex",
  "scripts",
  "codex-companion.mjs",
);
const CRITERIA_FILE = path.join(UI_DIR, "codex-criteria.md");

/** Review subcommands whose prompt we can shape. `review` (native) takes no focus, so we
 * upgrade it to `adversarial-review`. */
const REVIEW_SUBCOMMANDS = new Set(["review", "adversarial-review"]);
/** Long flags on the review commands that CONSUME the next token as their value — mirrors the
 * vendored `handleReviewCommand` config (`valueOptions: base/scope/model/cwd`). */
const VALUE_FLAGS = new Set(["base", "scope", "model", "cwd"]);
/** Short aliases that consume a value (`m`→model, `C`→cwd). */
const SHORT_VALUE_FLAGS = new Set(["m", "C"]);

/** Mirror the vendored `normalizeArgv`: a single combined string is shell-split, so the wrapper
 * behaves when called with one quoted blob instead of separate args.
 * @param {string[]} argv @returns {string[]} */
function normalizeArgv(argv) {
  if (argv.length !== 1) return argv;
  const raw = argv[0];
  if (!raw?.trim()) return [];
  return splitArgString(raw);
}

/** Minimal shell-like splitter: whitespace separates tokens, single/double quotes group them.
 * @param {string} raw @returns {string[]} */
function splitArgString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

/** Split a review command's args into flag tokens (including consumed values) and focus
 * positionals, mirroring the vendored parser's value-option handling.
 * @param {string[]} rest @returns {{ flags: string[], focus: string[] }} */
function splitReviewArgs(rest) {
  /** @type {string[]} */ const flags = [];
  /** @type {string[]} */ const focus = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === undefined) continue;
    if (token === "--") {
      focus.push(...rest.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=", 2);
      flags.push(token);
      const next = rest[i + 1];
      if (inline === undefined && VALUE_FLAGS.has(key ?? "") && next !== undefined) {
        flags.push(next);
        i += 1;
      }
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      flags.push(token);
      const next = rest[i + 1];
      if (SHORT_VALUE_FLAGS.has(token.slice(1)) && next !== undefined) {
        flags.push(next);
        i += 1;
      }
      continue;
    }
    focus.push(token);
  }
  return { flags, focus };
}

/** Decide the args to hand the vendored companion: passthrough for non-review subcommands;
 * for review intents, force `adversarial-review` and inject the data-driven lens.
 * @param {string[]} argv @returns {string[]} */
function buildArgs(argv) {
  const sub = argv[0];
  if (sub === undefined || !REVIEW_SUBCOMMANDS.has(sub)) return argv;

  if (!existsSync(CRITERIA_FILE)) {
    console.error(
      `[xenodot codex] ${CRITERIA_FILE} missing — running the review WITHOUT the data-driven lens.`,
    );
    return argv;
  }
  const criteria = readFileSync(CRITERIA_FILE, "utf8").trim();
  const { flags, focus } = splitReviewArgs(argv.slice(1));
  const callerFocus = focus.join(" ").trim();
  const mergedFocus = callerFocus
    ? `${criteria}\n\n--- caller's extra focus ---\n${callerFocus}`
    : criteria;
  return ["adversarial-review", ...flags, mergedFocus];
}

/** Build the final args, spawn the vendored companion, and forward its exit code/signal. */
function main() {
  const finalArgs = buildArgs(normalizeArgv(process.argv.slice(2)));
  const child = spawn("node", [VENDOR_COMPANION, ...finalArgs], { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`[xenodot codex] failed to launch the vendored companion: ${err.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

// Run only when invoked directly (so importing the pure helpers for tests doesn't spawn).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  normalizeArgv,
  splitArgString,
  splitReviewArgs,
  buildArgs,
  VENDOR_COMPANION,
  CRITERIA_FILE,
};
