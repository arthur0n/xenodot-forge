// External-agent registry — the envelope-level catalog of the optional agents a user
// can connect (Hermes researcher, Codex reviewer, …). ONE descriptor per agent, and
// each descriptor only POINTS at the agent's existing config trio (core/config.js) and
// probe (integrations/*-check.js) — the runtime paths (prompt blocks, MCP tools, plugin
// mounts in session.js) stay bespoke per agent and are NOT dispatched through here.
// This is what the Agents portal (ui/client/features/agents-portal/) and the generic
// /api/agents routes render, so adding a future agent = its integration files + one
// descriptor here.
import {
  getHermesConfig,
  hermesPublicConfig,
  saveHermesConfig,
  codexPublicConfig,
  saveCodexConfig,
  kimiPublicConfig,
  saveKimiConfig,
  HERMES_DEFAULT_ROLES,
  CODEX_DEFAULT_ROLES,
  KIMI_DEFAULT_ROLES,
} from "../core/config.js";
import { checkHermes } from "../integrations/hermes/hermes-check.js";
import { checkCodex } from "../integrations/codex/codex-check.js";
import { checkKimi } from "../integrations/kimi/kimi-check.js";

/** @typedef {import("../../lib/types.js").AgentField} AgentField */
/** @typedef {import("../../lib/types.js").AgentInstall} AgentInstall */

/**
 * One connectable external agent, as the portal + generic routes see it.
 * `publicConfig`/`saveConfig`/`check` are the agent's EXISTING envelope functions —
 * the registry adds no behavior of its own.
 * @typedef {object} AgentProvider
 * @property {string} id - config-block key and route segment, e.g. "hermes"
 * @property {string} label - display name, e.g. "Hermes"
 * @property {string} blurb - one-paragraph portal copy: what it is, what it costs
 * @property {string} [docHref] - external "learn more" link
 * @property {string} [runbook] - repo doc with the full runbook, e.g. "HERMES.md"
 * @property {string[]} roles - hive roles this agent CAN fill (the pickable catalog)
 * @property {string[]} defaultRoles - out-of-the-box role selection
 * @property {"mcp-tool" | "cli-plugin" | "acp"} runtimeKind - descriptive only; nothing dispatches on it
 * @property {AgentField[]} fields - connection fields the portal renders (secrets flagged)
 * @property {AgentInstall} [install] - first-time install steps (collapsible in the portal)
 * @property {() => import("../../lib/types.js").AgentPublicDescriptor["status"]} publicConfig - secret-free saved config (existing xPublicConfig)
 * @property {(patch: object) => ({ ok: true } | { error: string })} saveConfig - existing saveXConfig
 * @property {(body: Record<string, string | undefined>) => object | Promise<object>} check - readiness probe; `body` carries typed-but-unsaved field values
 * @property {{ script: string, extraArgs: string[], manual: string | null }} [setup] - npm setup script for POST /api/agents/:id/setup
 */

/** A trimmed typed value, or the saved fallback when it's blank/missing.
 * @param {string | undefined} typed @param {string | null} fallback @returns {string | null} */
function typedOr(typed, fallback) {
  const t = typed?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** @type {AgentProvider[]} */
export const AGENT_REGISTRY = [
  {
    id: "hermes",
    label: "Hermes",
    blurb:
      "An external Hermes Agent the Hive can use as its main researcher. Only the Hive calls it; every dispatch is gated (allow/deny). Hermes is advisory — it investigates and returns findings; it never writes files or adopts anything. Separate program with its own model and billing (your Anthropic plan does not cover it); you run it locally and point Xenodot at it.",
    docHref: "https://hermes-agent.nousresearch.com/",
    runbook: "HERMES.md",
    roles: ["researcher", "critic"],
    defaultRoles: HERMES_DEFAULT_ROLES,
    runtimeKind: "mcp-tool",
    fields: [
      {
        key: "apiUrl",
        label: "Hermes server URL",
        type: "text",
        placeholder: "http://localhost:8642  (your running Hermes gateway)",
      },
      {
        key: "apiKey",
        label: "Server key (Hermes API_SERVER_KEY)",
        type: "password",
        secret: true,
        placeholder: "the API_SERVER_KEY you set on your Hermes server",
      },
      {
        key: "model",
        label: "Hermes model (label only)",
        type: "select",
        note: "A label only — the model that powers Hermes is chosen inside Hermes (hermes setup → ~/.hermes/config.yaml); we don't send a model with the request.",
      },
    ],
    install: {
      summary: "First time? You must install & run Hermes on this machine first",
      intro:
        "Fastest: the Set up button (or `npm run hermes:setup`) does the install + wiring and hands off to `hermes setup` for the model. Then run `hermes gateway` and Test below. By hand:",
      code: [
        "# 1. Install (sets up python/node/ripgrep + the global `hermes` command)",
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
        "",
        "# 2. Pick a model + paste your PROVIDER key (the billable one — stays inside Hermes)",
        "hermes setup --portal",
        "",
        "# 3. Turn the local API server on — add to ~/.hermes/.env :",
        "#      API_SERVER_ENABLED=true",
        "#      API_SERVER_KEY=pick-any-secret      ← the “Server key” field (you invent it)",
        "",
        "# 4. Run the gateway (serves http://localhost:8642)",
        "hermes gateway",
      ].join("\n"),
      after:
        "Then: URL http://localhost:8642, Server key = the API_SERVER_KEY you invented, and Test.",
    },
    publicConfig: hermesPublicConfig,
    saveConfig: (patch) =>
      saveHermesConfig(/** @type {import("../core/config.js").HermesConfig} */ (patch)),
    check: (body) => {
      // Probe the URL/key typed in the panel (test BEFORE saving); blank → saved value.
      const saved = getHermesConfig();
      return checkHermes({
        apiUrl: typedOr(body.apiUrl, saved.apiUrl),
        apiKey: typedOr(body.apiKey, saved.apiKey),
      });
    },
    setup: {
      script: "hermes:setup",
      extraArgs: ["--yes"],
      manual: "Then finish Nous auth in a terminal: `hermes portal`.",
    },
  },
  {
    id: "codex",
    label: "Codex",
    blurb:
      "OpenAI's Codex as an optional, on-demand code reviewer. When on, type /codex:review (or /codex:adversarial-review) in a session to review the current diff. Advisory and never auto-runs. Billed to your ChatGPT/OpenAI account — your Anthropic plan doesn't cover it; Codex owns the credential (codex login), Xenodot never sees it.",
    docHref: "https://developers.openai.com/codex/",
    runbook: "CODEX.md",
    roles: ["reviewer"],
    defaultRoles: CODEX_DEFAULT_ROLES,
    runtimeKind: "cli-plugin",
    fields: [],
    install: {
      summary: "First time? Install the Codex CLI & vendor the plugin",
      intro:
        "One command installs the @openai/codex CLI (if missing), clones OpenAI's review plugin into the gitignored vendor/ dir, and switches it on. Then log in once:",
      code: [
        "npm run codex:setup     # install check + vendor the plugin + enable",
        "codex login             # ChatGPT account (incl. Free) or API key",
      ].join("\n"),
      after: "Verify anytime with Test below or `npm run codex:check`.",
    },
    publicConfig: codexPublicConfig,
    saveConfig: (patch) =>
      saveCodexConfig(/** @type {import("../core/config.js").CodexConfig} */ (patch)),
    check: () => checkCodex(),
    setup: { script: "codex:setup", extraArgs: [], manual: null },
  },
  {
    id: "kimi",
    label: "Kimi",
    blurb:
      "Moonshot's Kimi as an autonomous coder the Hive can delegate discrete implementation tasks to. It codes in an isolated git worktree (never the shared tree), streams progress to the feed, raises inline approval cards, and delivers a reviewable diff — merging is always a separate human-gated step. Driven over ACP via the local kimi-cli; billed to your Kimi/Moonshot account, and the CLI owns the credential (kimi login) — Xenodot stores no key.",
    docHref: "https://github.com/MoonshotAI/kimi-cli",
    runbook: "docs/roadmap/agents_portal_kimi.md",
    roles: ["coder", "reviewer"],
    defaultRoles: KIMI_DEFAULT_ROLES,
    runtimeKind: "acp",
    fields: [],
    install: {
      summary: "First time? Install kimi-cli & log in",
      intro:
        "One command installs the kimi-cli (PyPI, via uv/pipx) and switches Kimi on. Then log in once (Kimi account or Moonshot API key — the CLI owns the credential):",
      code: [
        "npm run kimi:setup     # install kimi-cli + enable",
        "kimi login             # Kimi account or Moonshot API key",
      ].join("\n"),
      after: "Verify anytime with Test below or `npm run kimi:check`.",
    },
    publicConfig: kimiPublicConfig,
    saveConfig: (patch) =>
      saveKimiConfig(/** @type {import("../core/config.js").KimiConfig} */ (patch)),
    check: () => checkKimi(),
    setup: {
      script: "kimi:setup",
      extraArgs: [],
      manual: "Then log in: `kimi login` in a terminal.",
    },
  },
];

/** The registry entry for `id`, or undefined. @param {string} id */
export function getAgent(id) {
  return AGENT_REGISTRY.find((d) => d.id === id);
}

/** The browser-facing catalog for GET /api/agents: every descriptor's static copy +
 * its current secret-free saved config as `status`. No probes — checks are explicit
 * (POST /api/agents/:id/check), keeping this route as cheap as /api/state.
 * @returns {import("../../lib/types.js").AgentPublicDescriptor[]} */
export function listAgents() {
  return AGENT_REGISTRY.map((d) => ({
    id: d.id,
    label: d.label,
    blurb: d.blurb,
    docHref: d.docHref,
    runbook: d.runbook,
    roles: d.roles,
    defaultRoles: d.defaultRoles,
    runtimeKind: d.runtimeKind,
    fields: d.fields,
    install: d.install,
    hasSetup: Boolean(d.setup),
    status: d.publicConfig(),
  }));
}
