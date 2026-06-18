// Codex readiness probe — the fast "is the Codex reviewer actually usable from here?"
// check. Unlike the Hermes probe (an HTTP call to a gateway), Codex is a LOCAL CLI, so
// this just inspects the machine: is the `codex` binary on PATH, are you logged in, and
// has the plugin been vendored on disk? No network, no billing.
//
//   • Importable: `checkCodex()` → a plain verdict object.
//       Used by the UI's `POST /api/codex/check` (the ⚙ Settings "Test" button).
//   • Runnable:   `npm run codex:check` prints a one-line readiness summary — handy while
//       standing Codex up from the terminal.
//
// Auth is owned by the Codex CLI, not by Xenodot: `codex login status` exits 0 when
// credentials are present (file-based auth.json under CODEX_HOME, default ~/.codex, or the
// OS credential store) and 1 otherwise — so we shell that as the source of truth and never
// store a key ourselves. The plugin is "vendored" once `npm run codex:setup` clones it.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCodexConfig, CODEX_PLUGIN_DIR } from "./config.js";

/** The verdict of one probe. `cli` = the `codex` binary is on PATH; `authOk` = `codex login
 * status` reports credentials; `vendored` = the plugin is cloned on disk (loadable). `ok` = all
 * three (Codex is ready to review). `enabled` mirrors the saved switch, for the summary line.
 * @typedef {{
 *   ok: boolean,
 *   enabled: boolean,
 *   cli: boolean,
 *   version?: string,
 *   authOk: boolean,
 *   authMode?: string,
 *   vendored: boolean,
 *   error?: string,
 * }} CodexCheck */

/** Run a `codex …` subcommand, returning {status, out} (out = trimmed stdout, or stderr on
 * failure). status is null when the binary isn't found (ENOENT). @param {string[]} argv
 * @param {number} timeoutMs @returns {{ status: number | null, out: string }} */
function runCodex(argv, timeoutMs) {
  const r = spawnSync("codex", argv, { encoding: "utf8", timeout: timeoutMs });
  const out = (r.stdout || r.stderr || "").trim();
  return { status: r.status, out };
}

/** Inspect the local Codex install. Synchronous (cheap local spawns); returns a verdict the
 * Settings panel and the CLI both render. @param {number} [timeoutMs] @returns {CodexCheck} */
export function checkCodex(timeoutMs = 8000) {
  const enabled = getCodexConfig().enabled;
  const vendored = existsSync(path.join(CODEX_PLUGIN_DIR, ".claude-plugin", "plugin.json"));

  const ver = runCodex(["--version"], timeoutMs);
  if (ver.status === null) {
    return {
      ok: false,
      enabled,
      cli: false,
      authOk: false,
      vendored,
      error:
        "`codex` is not on PATH — install it with `npm i -g @openai/codex`, then `codex login`.",
    };
  }
  const version = ver.out.replace(/^codex(?:-cli)?\s+/i, "").trim() || undefined;

  // `codex login status` exits 0 when authenticated, 1 when not. The printed line names the
  // active sign-in mode (ChatGPT account vs API key) — surface it for context.
  const auth = runCodex(["login", "status"], timeoutMs);
  const authOk = auth.status === 0;
  const firstLine = auth.out.split("\n")[0]?.trim();
  const authMode = authOk && firstLine ? firstLine : undefined;

  return {
    // cli is already proven (we returned early otherwise) — ready iff logged in AND vendored.
    ok: authOk && vendored,
    enabled,
    cli: true,
    version,
    authOk,
    authMode,
    vendored,
    error: authOk
      ? vendored
        ? undefined
        : "Codex CLI is ready, but the review plugin isn't vendored yet — run `npm run codex:setup`."
      : "Not logged in — run `codex login` (ChatGPT account or API key).",
  };
}

// --- CLI: `npm run codex:check` --------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = checkCodex();
  if (!r.enabled) {
    console.log("Codex is OFF — enable it in ⚙ Settings or `npm run codex:setup`.");
  }
  if (!r.cli) {
    console.error(`✗ ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ codex CLI present${r.version ? ` (v${r.version})` : ""}`);
    console.log(
      r.authOk
        ? `  ✓ logged in${r.authMode ? ` — ${r.authMode}` : ""}`
        : "  ✗ not logged in — run `codex login` (ChatGPT account or API key).",
    );
    console.log(
      r.vendored
        ? `  ✓ review plugin vendored → ${CODEX_PLUGIN_DIR}`
        : "  ✗ review plugin not vendored — run `npm run codex:setup`.",
    );
    console.log(
      r.ok
        ? "✓ Codex is ready — type `/codex:review` in a session (or terminal Claude Code) to review."
        : "• Codex is not fully set up yet (see above).",
    );
    if (!r.ok) process.exitCode = 1;
  }
}
