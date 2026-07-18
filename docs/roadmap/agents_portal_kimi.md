# Roadmap — External-Agent Portal + Kimi K3 Coder (ACP)

> **Status: IMPLEMENTED (2026-07-18).** All three phases landed: (A) agents portal + server
> registry (`ui/server/agents/`, `ui/client/features/agents-portal/`), (B) Kimi coder over ACP
> (`ui/server/integrations/acp/acp-client.js`, `integrations/kimi/`, `mcp-tools/kimi-tool.js`),
> (C) Kimi reviewer role (`role: "reviewer"` on `mcp__ui__kimi`, read-only).
>
> **Spike results (kimi-cli 1.49.0):** `kimi acp` handshake verified (protocol v1, full
> capabilities); auth cleanly errors -32000 until `kimi login`. Headless fallback
> (`--print --output-format stream-json`) confirmed first-class. **Correction:** kimi-cli is
> **Python on PyPI** (`uv tool install kimi-cli` / `pipx`), NOT npm/TS as first researched.
>
> **Remaining human steps:** browser walkthrough of the portal; create a Kimi/Moonshot
> account + `kimi login`; then e2e-verify the auth-gated spike items (prompt streaming,
> permission cards honored, cancel) on the first real dispatch.
>
> **Interrupt (as built):** removing Kimi's board task cancels its run (ACP `session/cancel`
>
> - kill) — plus a 20-minute wall-clock cap. The `stop_task` control targets SDK workers only.

## Context

Goal: give framework users **options** for external agents with good onboarding (today's setup
UX is bad). Codex (reviewer) and Hermes (researcher) exist as two bespoke integrations sharing
only an envelope (config trio, prompt block, check/setup routes, settings card). This roadmap
adds:

- **Phase A** — an "Agents" **portal** (guided connect wizard) backed by a **server registry**,
  validated first against the two existing agents. Future agent = 1 adapter file + 1 registry
  entry.
- **Phase B** — **Kimi K3** (Moonshot, launched 2026-07-16, API model `kimi-k3` at
  api.moonshot.ai) as an **autonomous coder**, driven via **ACP** (Agent Client Protocol,
  JSON-RPC over stdio) against the official `kimi-cli` — edits, permissions and progress flow
  through the framework's approvals + activity feed (in-ecosystem, not a rogue CLI). Gated by a
  spike; headless worktree-spawn documented as fallback.
- **Phase C** — Kimi **review** role reusing the same runtime.

Decisions (locked): portal+registry v1; coder first, review after; ACP runtime;
**human/Hive-gated merge** (no auto-integrate); **CLI-login-only** auth (zero stored secret,
codex model); **Hive MCP dispatch** only in v1 (no board button).

Correction found during design: `.xenodot.json` is **gitignored/untracked** — the hermes key is
plaintext-at-rest locally, not committed. No migration needed; Kimi stores no secret at all.

## Phase A — Portal + registry (validate with codex + hermes)

**Registry** — new domain dir `ui/server/agents/`, file `registry.js`: plain array of
descriptors `{id, label, blurb, roles, runtimeKind, fields, publicConfig, saveConfig, check,
setupScript, installDocPath}`. Descriptors import the **existing** functions
(`hermesPublicConfig`/`saveHermesConfig` from `ui/server/core/config.js:275-334`, `getCodex*`
:341-385; `checkHermes`/`checkCodex` from `ui/server/integrations/*/`). Envelope-catalog only —
**no runtime rewrite**; `session.js` prompt-block injection and MCP/plugin wiring untouched.
Roles stored in each config block (`hermes.roles` default `["researcher","critic"]`,
`codex.roles` default `["reviewer"]`). Docs block stays a plain toggle, out of portal (scope).

**API** (`ui/server/core/index.js`) — `GET /api/agents` (descriptor list + secret-stripped
status); `POST /api/agents/:id/{check,setup,settings}` via a prefix branch mirroring the
`DELETE /api/sessions/` pattern (:464). `handleSettingsPost` (:145-181) iterates the registry
instead of hard-coded ids. Old per-agent routes stay as thin aliases for one release.

**Portal UI** — new `ui/client/features/agents-portal/portal.js`, data-driven from
`GET /api/agents`. Replaces the three hand-written cards at `ui/index.html:408-546` with one
`<div id="agents-portal-list">`. Wizard per card: **detect** (auto-check on open) → **guide
install** (installDocPath + Setup button) → **paste key** (only providers with secret fields,
i.e. hermes) → **test** → **enable** → **assign roles**. Generalize
`testConnection/testCodex/runIntegrationSetup` in
`ui/client/features/settings/settings-connection.js` into `testAgent(id)/runSetup(id)`; reuse
existing modal DOM/CSS classes verbatim. Typedefs in `ui/lib/types.js`.

**Verify A**: `npm run validate` clean; manual walkthrough with live codex+hermes accounts
(detect → toggle → test → save → `.xenodot.json` updates); start a session and confirm
HERMES_BLOCK/CODEX_BLOCK still inject + a hermes dispatch and `/codex:review` still work. Zero
runtime regression = acceptance bar.

## Phase B — Kimi ACP coder

**Spike first (gate, ~½ day, scratchpad only):**

1. `npx -y @moonshotai/kimi-cli --version`; confirm `acp` subcommand exists (absent → fallback
   immediately).
2. Throwaway Node harness: spawn `kimi acp` in a temp git repo, raw JSON-RPC: `initialize`
   (declare fs + permission caps) → `session/new` → `session/prompt` "create hello.txt
   containing hi".
3. Must-work checklist (5/5 = build ACP): handshake caps; streamed `session/update` incl.
   tool_call; **permission request we can approve/deny and see honored**; **`session/cancel`
   actually interrupts**; terminal stopReason + file exists.
4. Failure (esp. permissions/cancel) → **fallback**: same `kimi-tool.js` + worktree + diff
   delivery, but headless `kimi run` (no live stream/approvals; safety = worktree isolation +
   human diff gate). Only `acp-client.js` swaps out.

**New files:**

- `ui/server/integrations/acp/acp-client.js` — agent-generic ACP client (JSON-RPC 2.0/stdio;
  reusable later for Gemini CLI etc.).
- `ui/server/integrations/kimi/kimi-check.js` (CLI on PATH? logged in? acp mode?),
  `kimi-setup.js` (install + pin kimi-cli version), `kimi-worktree.js` (create/reap
  `git worktree` under gitignored `.xenodot-run/kimi/<taskId>/`; startup sweep for orphans;
  final `git diff`).
- `ui/server/mcp-tools/kimi-tool.js` — `makeKimiTool({send, push, waitFor})`, fire-and-forget
  mirroring `hermes-tool.js:511` shape.
- `ui/kimi-block.md` — orchestrator prompt block (delegate discrete impl tasks; isolated
  worktree; streams progress; asks approvals; delivers diff).

**Edits:**

- `ui/server/core/config.js` — `getKimiConfig/kimiPublicConfig/saveKimiConfig` +
  `KIMI_MODELS`/`KIMI_DEFAULT_MODEL` (`kimi-k3`). **No secret field** (CLI login owns
  credential).
- `ui/server/mcp-tools/ui-server.js:33-44` — register kimi tool; thread `waitFor` into
  `buildUiServer` deps (the one new dep vs hermes).
- `ui/server/core/session.js` — pass `waitFor` at :342; inject `KIMI_BLOCK` at :337 gated on
  enabled; wire `stop_task` control (:576+) → ACP `session/cancel` + kill child.
- `ui/server/agents/registry.js` — kimi descriptor (`roles:["coder"]`, `runtimeKind:"acp"`).
- `ui/client/features/agents/agents.js:37,55-65` — kimi ROLE_COLOR + DISPLAY.
- `ui/lib/types.js` + `ui/client/core/reducer.js:62-89` — generalize `{type:"hermes"}` relay
  msg into `{type:"extAgent", agentId, phase, …}` with hermes alias kept.
- `package.json` — `kimi:setup`, `kimi:check` scripts.

**Runtime flow:** Hive calls `mcp__ui__kimi {task, context}` → tool creates board task, spawns
`kimi acp` with `cwd`=fresh worktree, returns immediately. `session/update` chunks → activity
feed (extAgent relay); ACP `session/request_permission` → **existing
`waitFor("permission", {toolName, input, agent:"kimi"})`** (`session.js:120-168`) → same inline
approval cards, kimi-colored chip. Completion → worktree `git diff` delivered as synthetic user
turn via `push(...)` (like `findingsTurn` hermes-tool.js:123) + board task done. **Merge is
always a separate human/Hive step** — Kimi never touches the Hive tree.

**Verify B**: `npm run validate`; spike 5/5 logged (or fallback engaged + documented); e2e:
enable Kimi in portal → ask Hive to delegate a small impl → board task appears, feed streams
progress, edit raises kimi-chipped approval, approve, diff arrives as message, worktree has
change, Hive tree untouched; stop-worker mid-run kills it. Also confirm concurrent Kimi + Hive
approval cards don't collide (pending-id map, risk R3).

## Phase C — Kimi reviewer (small)

`kimi-tool.js` gains `role:"coder"|"reviewer"` param: reviewer branch swaps preamble to review
brief (no-edit), permission gate auto-denies writes, findings deliver via same synthetic turn.
Add `"reviewer"` to descriptor roles. ~30 lines + brief md. Verify: dispatch review over real
diff → findings arrive, zero files modified.

## Risks

- **R1** kimi-cli ACP maturity (permissions/cancel weakest) — mitigated by gating spike +
  designed fallback.
- **R2** ACP/kimi-cli drift — pin version in `kimi-setup.js`, centralize method names in
  `acp-client.js`.
- **R3** `waitFor` concurrency: permissions resolve by id (`pending.get(msg.id)`) so parallel
  Kimi+Hive approvals should be safe — verify during B.
- **R4** orphaned worktrees — reap on teardown + startup sweep.
- **R5** cost: k3 = $3 in / $15 out per M tokens and autonomous — keep edits human-gated
  (default policy), surface per-task cost line in feed (stretch).

## Reference — Kimi K3 / Moonshot facts (researched 2026-07-17)

- `kimi-k3` API live: OpenAI-compatible `https://api.moonshot.ai/v1` and Anthropic-compatible
  `https://api.moonshot.ai/anthropic`. `tool_choice=required` works on k3 (not k2.6/k2.7).
- Official CLI: `MoonshotAI/kimi-cli` (npm, TypeScript, MIT) — MCP + **ACP** support, VS Code
  extension; login via Kimi account or Moonshot API key.
- Quirks: Anthropic endpoint rescales temperature ×0.6, rejects `document` blocks; streaming
  tool-call args arrive as incremental JSON deltas.
- No official Node SDK — `openai` npm package with `baseURL` override is the blessed path (not
  needed for the ACP design, listed for the fallback/own-loop options).

## Repo rules

Plain JS + JSDoc (no .ts); new server files in matching domain dirs; `npm run validate` zero
warnings before commit; `rtk` prefix on shell commands.
