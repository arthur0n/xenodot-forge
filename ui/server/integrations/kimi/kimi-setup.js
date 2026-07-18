// Kimi setup — non-interactive installer/wiring for the external Kimi coder (kimi-cli
// driven over ACP). Mirrors codex-setup's zero-secret model: this installs the CLI (if
// missing) and flips the config switch; the one step it CANNOT do is auth — `kimi login`
// is an interactive browser/terminal flow the user finishes themselves (surfaced as the
// `manual` follow-up in the portal).
//
//   Runnable: `npm run kimi:setup`   (also POST /api/agents/kimi/setup → this script)
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { saveKimiConfig } from "../../core/config.js";

/** Installer candidates, best first: uv is fastest and cleanest, pipx equivalent, bare
 * pip --user the fallback. Each is (tool, argv). kimi-cli is a PyPI package (Python),
 * NOT npm — see docs/roadmap/agents_portal_kimi.md. */
const INSTALLERS = [
  { bin: "uv", argv: ["tool", "install", "kimi-cli"] },
  { bin: "pipx", argv: ["install", "kimi-cli"] },
  { bin: "pip3", argv: ["install", "--user", "kimi-cli"] },
];

/** A generous cap for one installer run (it resolves + downloads a Python package tree). */
const INSTALL_TIMEOUT_MS = 240_000;

/** @param {string} bin @param {string[]} argv @param {number} [timeoutMs] */
function run(bin, argv, timeoutMs = 15_000) {
  const r = spawnSync(bin, argv, { encoding: "utf8", timeout: timeoutMs });
  return { ok: r.status === 0, out: (r.stdout || r.stderr || "").trim() };
}

/** True when the `kimi` CLI answers on PATH. */
function cliPresent() {
  return run("kimi", ["--version"]).ok;
}

/** Install kimi-cli via the first available installer; returns a human line. */
function installCli() {
  for (const { bin, argv } of INSTALLERS) {
    if (!run(bin, ["--version"]).ok) continue;
    console.log(`installing kimi-cli via ${bin}…`);
    const r = run(bin, argv, INSTALL_TIMEOUT_MS);
    if (r.ok && cliPresent()) return { ok: true, how: bin };
    console.log(r.out.slice(-500));
  }
  return { ok: false, how: null };
}

function main() {
  if (cliPresent()) {
    console.log("✓ kimi CLI already installed");
  } else {
    const inst = installCli();
    if (!inst.ok) {
      console.error(
        "✗ could not install kimi-cli — install it yourself (`uv tool install kimi-cli` " +
          "or `pipx install kimi-cli`, needs Python), then re-run `npm run kimi:setup`.",
      );
      process.exit(1);
    }
    console.log(`✓ kimi-cli installed (via ${inst.how})`);
  }
  const saved = saveKimiConfig({ enabled: true });
  if ("error" in saved) {
    console.error(`✗ could not enable Kimi in .xenodot.json: ${saved.error}`);
    process.exit(1);
  }
  console.log("✓ Kimi enabled in .xenodot.json");
  console.log(
    "→ one manual step left: run `kimi login` in a terminal (Kimi account or Moonshot API key), " +
      "then verify with `npm run kimi:check`.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
