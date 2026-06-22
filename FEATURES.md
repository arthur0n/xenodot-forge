# Features

What Xenodot Forge actually does, as a capability catalog. For the philosophy,
positioning, and setup, see the [README](README.md); for the wire protocol, see
[`ui/PROTOCOL.md`](ui/PROTOCOL.md).

Counts below are badge-tracked (`npm run badges` auto-counts them). The live
source of truth is the **Agents** tab in the UI and the plugin dirs
(`plugin/agents/`, `plugin/skills/`) — this file groups them so it doesn't drift.

## The pipeline

```
idea → game-designer   interviews you, refuses vague scope, writes a one-page design doc
     → godot-dev       implements exactly that doc — nothing more, nothing less
     → godot-verify    headless engine checks; catches what Godot silently drops
     → you             one look in the editor — that's your job
```

Design decisions move **before** inference, not during it. Push-back is the
product: nothing is reported "done" without passing real engine checks.

## Multi-agent orchestration (the Hive)

- **One orchestrator per session** routes and coordinates; it never implements.
- **Background sub-agents** — builders run with `run_in_background`, so you keep
  messaging the Hive while they work; each can be stopped individually.
- **FleetView running strip** — one live chip per in-flight sub-agent. The client
  reconciles it against the server's authoritative running set, so a missed
  lifecycle event self-heals on the next snapshot (no stale cards).
- **Handoff-by-file** — a builder writes its full report to
  `.xenodot/handoffs/<slug>.md`; `handoff-summarizer` distills it to a ≤5-line
  digest the orchestrator acts on (long reports never truncate away).
- **Persistent task board** — `.xenodot/tasks.json`, survives sessions and resume.
- **Concurrent-build hygiene** — every agent shares one working tree (no
  per-agent worktree isolation, by design: faster, simpler). The orchestrator
  partitions scope to disjoint file sets, re-verifies a transient gate fail
  during a concurrent build, and accepts the residual race rather than chase it.

## Agents (17)

Framework agents, namespaced `xenodot:<name>`. Grouped by role:

- **Design & scope** — `game-designer` (the entry point: interviews, locks a
  design doc), `level-designer` (reads a drawn grid, briefs a level concept-first).
- **Builders** — `godot-dev` (core build/glue/export), `godot-player`
  (first-person + follow camera + animation), `godot-combat` (enemy
  health/death, projectiles), `godot-assets` (import/generate models &
  textures), `godot-visuals` (3D-pixel-art rig, lighting, post-process),
  `godot-refactor` (mechanical modularization into components).
- **Art direction & assets** — `art-director` (visual-style direction),
  `asset-advisor` (art-asset sourcing specs + post-upload verification).
- **Researchers (pull-based growth, human-gated)** — `addon-researcher`
  (buy-vs-build for free Godot addons), `skill-researcher` (find a skill when no
  `godot-*` one fits), `cli-researcher` (new agent/tooling capabilities),
  `transcript-researcher` (harvest video knowledge into the library),
  `godot-docs-evangelist` (authoritative API verification; needs the docs MCP).
- **Support** — `bug-triage` (root-cause + what the framework should learn),
  `handoff-summarizer` (the ≤5-line builder-report digest).

## Skills (29)

Procedures (one canonical path, observable outcome), not references. Loaded by
the implementers that own them, not invoked directly. Across these domains:

- **Meta / procedural** — `agent-report`, `autonomous-main-goal`, `caveman`,
  `quick`, `tasks-mcp`.
- **Godot core** — project conventions, typed-GDScript code rules, composition
  (SOLID via component nodes), main-scene shell, `godot-verify`, export builds.
- **Rendering & visuals** — 3D pixelation (SubViewport), pixel-readability
  lighting, screen-space effects, orthographic follow camera, foliage, one-shot VFX.
- **3D mechanics** — first-person controller, travelling projectiles, enemy AI
  (NavigationAgent3D + state machine), FPS enemy combat contract, GridMap levels.
- **Art & assets** — animation libraries, mesh/texture pixel-art import,
  procedural model & texture generation, level-design principles.

## Web UI

Runs the same agents from a browser (`npm start` → `http://localhost:8338`):

- **Chat** — composer + message history.
- **Activity feed + FleetView** — live event stream (tool calls, agent prose,
  transitions) and the running-agents strip.
- **Task board** — the persistent right-rail to-do list (agent- and user-owned).
- **Approval gates** — agent questions render as clickable choices
  (`AskUserQuestion`), typed **forms** (`mcp__ui__form`), and tool calls as
  allow/deny cards. Questions always reach you regardless of permission policy.
- **Promotions board** — approve/reject promoting a game-local skill/agent/tool
  into the framework plugin.
- **Sessions** — browse, resume (full context), and `compact` a session in place.
- **Settings** — Hermes, Codex, Godot-docs MCP toggles; model/provider; skill scope.
- **Draw Level** — sketch a level on a grid; hands off to `level-designer`.
- **Get Assets** — request/upload PNG textures or `.glb` models; placed into the
  game (`assets/`) or the shared library (`x-shared-assets/`) and wired + verified.
- **Autonomous panel** — set a standing Main Goal and watch the check loop.
- **Project tree** — read-only browse of scenes/scripts/design docs.
- **Context meter** — live context-window usage (green→amber→red) per session.

## Verification & safety

- **`godot-verify` gate** — `verify_scene.gd` / `verify_render.gd`: scenes load,
  node paths resolve, properties aren't silently dropped, and frames actually
  render. Godot exits 0 on parse errors, so this exists because "verified" bugs shipped.
- **Validate gate + smoke tests** — GDScript lint/format checks and headless
  scene/playthrough smoke runs.
- **Permission policy** — per-session, live-switchable: `ask` (default, every
  un-allowlisted tool prompts) / `edits` (edits auto-allowed) / `all`.
- **PreToolUse safety hooks** — guard destructive operations and protect the
  lint/config files; the `rtk` command hook no-ops safely if rtk isn't installed.
- **Auto-deny visibility** — a headless sub-agent's un-reachable approval is
  surfaced in the activity log (and a banner) instead of dying silently.

## Autonomous mode

A standing **Main Goal** plus a recurring **check loop**: the Hive evaluates the
goal, dispatches the next slice each tick, and reports progress — still gated by
the same approvals. Off by default; set/cleared from the Autonomous panel
(`ui/server/features/autonomous/`, `mcp__ui__autonomous`,
`.xenodot/autonomous.json`).

## Integrations (opt-in, off by default)

- **Hermes** — an external research agent with its own model/provider/billing.
  The Hive dispatches it for deep web research; it stays advisory (a Xenodot
  researcher + you own the verdict). Setup: [`HERMES.md`](HERMES.md).
- **Codex** — OpenAI's Codex reviewer plugin, on-demand only via `/codex:review`;
  credentials live in the `codex` CLI, never in Xenodot. Setup: [`CODEX.md`](CODEX.md).
- **Godot-docs MCP** — official Godot 4.x docs as an MCP source, powering
  `godot-docs-evangelist`; enabled in Settings.

## Growth loop

A new skill/agent/tool starts **game-local** in `<game>/.claude/` and is usable
immediately. When one proves broadly useful, file a promotion
(`mcp__ui__promote`); you approve it on the board and run
`npm run promote -- …` to move it into the plugin. Researchers write findings
back into the knowledge base (`library/`, a symlink to `plugin/library/`).

## Provider flexibility

The Hive drives Claude Code through the Agent SDK, so **Amazon Bedrock, Google
Vertex, Azure Foundry, and enterprise gateways** are first-class backends (flip
the standard `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / gateway env
vars). Non-Claude models route through an Anthropic-API-compatible proxy
(LiteLLM, claude-code-router). You're tied to an API _shape_, not a vendor — but
the pipeline is tuned for Claude's tool calls, so non-Claude models lose some fidelity.
