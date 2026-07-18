// Kimi readiness probe — the fast "is the Kimi coder actually usable from here?" check.
// Kimi is a LOCAL CLI (kimi-cli, PyPI) driven over ACP, so this inspects the machine: is
// the `kimi` binary on PATH, does its ACP mode answer the initialize handshake, and is it
// authenticated (`kimi login` → ~/.kimi/config.toml)? Auth state is probed the honest way —
// an ACP `session/new` against a scratch dir answers -32000 "Authentication required" when
// logged out — so the verdict reflects what a real run would hit. No billing (no prompt is
// ever sent).
//
//   • Importable: `checkKimi()` → a verdict promise.
//       Used by the portal's `POST /api/agents/kimi/check` (the Test button).
//   • Runnable:   `npm run kimi:check` prints a one-line readiness summary.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getKimiConfig } from "../../core/config.js";
import { startAcpClient, ACP_PROTOCOL_VERSION } from "../acp/acp-client.js";

/** JSON-RPC error code kimi-cli's ACP server answers on `session/new` when logged out. */
const AUTH_REQUIRED_CODE = -32000;

/** The verdict of one probe. `cli` = the `kimi` binary is on PATH; `acpOk` = `kimi acp`
 * answered the initialize handshake; `authOk` = a session can actually be opened (logged
 * in). `ok` = all three (Kimi is ready to code). `enabled` mirrors the saved switch.
 * @typedef {{
 *   ok: boolean,
 *   enabled: boolean,
 *   cli: boolean,
 *   version?: string,
 *   acpOk: boolean,
 *   authOk: boolean,
 *   error?: string,
 * }} KimiCheck */

/** Probe `kimi acp`: initialize, then try session/new in a scratch dir to learn the auth
 * state. Always kills the child before resolving.
 * @param {number} timeoutMs @returns {Promise<{ acpOk: boolean, authOk: boolean, error?: string }>} */
async function probeAcp(timeoutMs) {
  const scratch = mkdtempSync(path.join(tmpdir(), "kimi-check-"));
  const client = startAcpClient({
    command: "kimi",
    args: ["acp"],
    cwd: scratch,
    onNotification: () => {},
    onRequest: () => Promise.resolve({}),
  });
  try {
    await client.request(
      "initialize",
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
      timeoutMs,
    );
    try {
      await client.request("session/new", { cwd: scratch, mcpServers: [] }, timeoutMs);
      return { acpOk: true, authOk: true };
    } catch (e) {
      const code = /** @type {{ code?: number }} */ (e).code;
      if (code === AUTH_REQUIRED_CODE) return { acpOk: true, authOk: false };
      return {
        acpOk: true,
        authOk: false,
        error: `session/new failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } catch (e) {
    return {
      acpOk: false,
      authOk: false,
      error: `ACP handshake failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    client.kill();
  }
}

/** Inspect the local Kimi install. Async (the ACP probe spawns the CLI); returns a verdict
 * the portal and the CLI both render. @param {number} [timeoutMs] @returns {Promise<KimiCheck>} */
export async function checkKimi(timeoutMs = 15_000) {
  const enabled = getKimiConfig().enabled;
  const ver = spawnSync("kimi", ["--version"], { encoding: "utf8", timeout: timeoutMs });
  if (ver.status === null || ver.status !== 0) {
    return {
      ok: false,
      enabled,
      cli: false,
      acpOk: false,
      authOk: false,
      error:
        "`kimi` is not on PATH — install kimi-cli (`uv tool install kimi-cli` or `pipx install kimi-cli`), then `kimi login`.",
    };
  }
  const version = (ver.stdout || "").replace(/^kimi,?\s*version\s*/i, "").trim() || undefined;
  const acp = await probeAcp(timeoutMs);
  return {
    ok: acp.acpOk && acp.authOk,
    enabled,
    cli: true,
    version,
    acpOk: acp.acpOk,
    authOk: acp.authOk,
    error: acp.authOk
      ? acp.error
      : (acp.error ??
        "Not logged in — run `kimi login` in a terminal (Kimi account or Moonshot API key)."),
  };
}

// --- CLI: `npm run kimi:check` ----------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await checkKimi();
  if (!r.enabled) console.log("Kimi is OFF — enable it in ⚙ Settings or `npm run kimi:setup`.");
  if (!r.cli) {
    console.error(`✗ ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ kimi CLI present${r.version ? ` (v${r.version})` : ""}`);
    console.log(r.acpOk ? "  ✓ ACP mode answers (kimi acp)" : `  ✗ ${r.error}`);
    console.log(r.authOk ? "  ✓ logged in" : "  ✗ not logged in — run `kimi login` in a terminal.");
    console.log(
      r.ok
        ? "✓ Kimi is ready — the Hive can dispatch coding tasks to it (mcp__ui__kimi)."
        : "• Kimi is not fully set up yet (see above).",
    );
    if (!r.ok) process.exitCode = 1;
  }
}
