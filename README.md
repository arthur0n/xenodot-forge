# Xenodot Forge

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Godot-family 4.x](https://img.shields.io/badge/Godot--family-4.x-blue.svg)
![Skills: 29](https://img.shields.io/badge/Skills-29-purple.svg)
![Agents: 17](https://img.shields.io/badge/Agents-17-orange.svg)
![Status: POC](https://img.shields.io/badge/Status-POC-yellow.svg)

An experiment in building games on **Godot and its compatible forks (Redot, Blazium)** with Claude Code using **a deliberate pipeline instead of a chat box**.

## The real goal

Most frameworks hand you a fixed toolbox. This one is designed to be **broken, rebuilt, and replaced by you**.

The agents self-improve from your experience, every bug, every awkward pattern, every moment where the pipeline slowed you down instead of helping is signal. The `bug-triage`, `skill-researcher`, and `godot-refactor` agents exist specifically to close that loop: find the friction, trace the root cause, update the skills, rewrite the rules. The framework you end up with is not the one you started with.

The tools are here. The shape of the framework is yours to decide.

### Roadmap:

✅ [Foundation POC](https://github.com/arthur0n/xenodot-forge/blob/main/docs/roadmap/first_game.md) is complete and retired.

✅ [FPS POC](https://github.com/arthur0n/xenodot-forge/blob/main/docs/roadmap/fps_poc.md) Part 1 completed.

## Progress

> **Disclaimer:** I don't have much time, so progress is slower than I'd like — but I'll keep the updates coming.

**Latest: `v0.1.9`** — FleetView stale-card fix (authoritative running snapshot), orchestrator
concurrency rules, opt-in Codex reviewer, domain-grouped UI refactor. Full history in
[Releases](https://github.com/arthur0n/xenodot-forge/releases); the reference game is on
[Itch](https://arthur0n.itch.io).

## Why this exists

Most AI-assisted game dev setups hand you a frontier model and a blank prompt. Describe your game, get some code, paste it in, pray it runs. That works, until you want to ship something repeatable, reviewable, and actually _yours_.

This project bets on a different loop: **move the design decisions to before inference, not during it.** You don't tell the model what to build; you go through a structured interview that cuts scope to one buildable slice, produces a locked design doc, and only _then_ hands it off to a dev agent. The model stops guessing. You stop pasting broken code.

The pipeline looks like this:

```
idea → game-designer       (interviews you, pushes back on vague scope, writes a one-page design doc)
     → godot-dev           (implements exactly that doc, nothing more, nothing less)
     → godot-verify        (headless engine checks, catches what Godot silently drops)
     → you                 (one look in the editor, that's your job)
```

Push-back is the product. The designer agent will not silently fill gaps. It asks, narrows, and confirms before anything gets built. Nothing gets reported "done" without passing real engine checks.

## Naming

| Term              | What it means                                                        |
| ----------------- | -------------------------------------------------------------------- |
| **Xenodot**       | The ecosystem                                                        |
| **Xenodot Forge** | This framework: web UI + the agent workflow                          |
| **Xenodots**      | The individual agents (designer, dev, refactor, researchers, triage) |
| **Xenodot Hive**  | The multi-agent orchestrator: the main coordination loop             |

## What's inside

```
ui/         Web UI (Node), run sessions from a browser.
            Designer questions render as clickable forms.
            Tool approvals become allow/deny buttons.
            Live event feed so you see what's happening.
```

**The framework is independent of your game, it contains no game folder.** It
_points at_ your Godot project wherever it lives (by default a sibling folder named
`game/`), reads it in place, and never tracks it. Your project stays in its own git
repo; the framework drives Claude Code against it.

**The full capability catalog lives in [FEATURES.md](FEATURES.md)** — agents, skills, the
web UI, verification, autonomous mode, and integrations. How it ships (the plugin vs. game
separation) is in [What ships](#what-ships) below. The reference project during this POC is
[DiceOfFate](https://github.com/Coghatch-ai/dicefate).

## Requirements

- [Claude Code](https://claude.com/claude-code) installed and authenticated
- A Godot-family engine 4.x: **Godot**, **Redot**, or **Blazium** (skills target
  4.x APIs; verified against 4.6). The forks share Godot's project format, GDScript
  and CLI, so they run the same pipeline unchanged, see [docs/engines.md](docs/engines.md).
- Node.js 18+ (only for the web UI)

## Cost & subscriptions

Separate bills, by design — only the **Hive** is required. The Hive (orchestrator + sub-agents)
runs on your local Claude Code login. **Hermes** (optional researcher) and **Codex** (optional
reviewer) are separate runtimes, each with its own provider and billing.

| Rail                  | What runs                                                                             | How you pay                                                                                                                       | Switch it                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Hive** (required)   | Claude Code via the Agent SDK, pinned to Opus 4.8                                     | Claude **subscription** (Pro ~$20 / Max ~$100–200 mo, usage-capped) **or** Anthropic **API key** (~$5/$25 per 1M in/out)          | subscription: `claude` `/login`; API key: set `ANTHROPIC_API_KEY`                         |
| **Hermes** (optional) | External [Hermes Agent](https://hermes-agent.nousresearch.com/), model of your choice | Provider it points at — **OpenRouter** / Nous Portal / your own key, metered per token (~$0.25–$2.50 per deep run)                | install + setup: [`HERMES.md`](HERMES.md); then ⚙ Settings or `npm run hermes`            |
| **Codex** (optional)  | OpenAI's Codex reviewer (`/codex:review`), on-demand                                  | a **ChatGPT subscription with Codex access** (Plus / Pro / Business) **or** an OpenAI **API key** — billed to your OpenAI account | setup: [`CODEX.md`](CODEX.md) (`npm run codex:setup` + `codex login`); ⚙ Settings → Codex |

- **Your Anthropic plan covers only the Hive.** Hermes and Codex each bring their own account and billing — Hermes always needs its own API key; Codex bills to your ChatGPT/OpenAI account.
- **Codex on a plain ChatGPT subscription.** A Plus (or higher) plan with Codex access works — no separate API key needed. On a ChatGPT login, point Codex at a general model (`gpt-5.5`), not a `*-codex` variant (those are rejected). Details in [`CODEX.md`](CODEX.md).
- **Hermes and Codex are off by default**; the framework runs fully on the Hive alone.
- You **can** point the Hive at the Anthropic API (or a compatible endpoint) via env vars instead of the subscription login. I don't — a subscription beats an API key for heavy use; API keys are better for ad-hoc requests.

> **Disclaimer (maintainer's setup):** I run on paid AI subscriptions across providers (~$150/mo, a company expense) because I work across several projects, so the flat fee pays off. That is **not required** — the framework runs on Pro, on pay-per-token API, or with the optional rails off entirely. If you want a cheaper setup, open an issue and I'll help you wire one.

## Quickstart

The framework and your Godot game are **two separate repos, side by side** (recommended, not required — any path works):

```
your-workspace/
├── xenodot-forge/   ← this framework (cloned)
└── game/            ← your Godot project (any name; its own git repo)
```

1. **Clone the framework and install:**

   ```bash
   git clone https://github.com/arthur0n/xenodot-forge.git
   cd xenodot-forge && npm install
   ```

2. **Point it at your game.** Scaffolds a new runnable project if the path doesn't exist, or wires an existing one in place (and remembers it):

   ```bash
   npm run new -- ../game     # any path works: ../game, /abs/path, ../nested/project
   ```

3. **Run the web UI:**

   ```bash
   npm start                  # http://localhost:3117
   ```

Every command runs **from inside `xenodot-forge/`** and takes the game path as an argument, so your game can be named anything and live anywhere. Re-check wiring anytime with `npm run doctor -- <path>`.

### Let Claude do it for you

Open Claude Code in your workspace and paste this:

```text
Read https://raw.githubusercontent.com/arthur0n/xenodot-forge/main/README.md and follow its
Quickstart to set up and run it against my Godot game at: <PATH TO MY GODOT GAME>. Run the
commands yourself, fix anything that fails, and tell me when it's running.
```

### Terminal Claude Code instead of the web UI

Install the plugin once (`npm run doctor` prints the exact commands), then run `claude` from your game folder:

```
/plugin marketplace add /path/to/xenodot-forge
/plugin install xenodot@xenodot-forge
```

### Updating

Your game lives in its own repo, so pulling the latest framework never touches your work:

```bash
cd xenodot-forge && git pull
```

## What ships

The framework's Claude Code setup is in two parts:

- **Framework spine** (`.claude/`), rules + the rtk hook for working _on the framework_
  (the Node/TS web UI). Committed; nothing to install.
- **The xenodot plugin** (`plugin/`), the agents, `godot-*` skills, the game-agnostic
  verification tools (the validate gate, verify/gen scripts), safety hooks, and the
  knowledge base (`library/`). The **single source of truth** for what a game gets. The web
  UI loads it via the Agent SDK `plugins` option; terminal Claude Code installs it once from
  the bundled marketplace (`.claude-plugin/marketplace.json`). Capabilities namespace as
  `xenodot:<name>`.

Nothing is copied into your game. The only per-game files the framework materializes are
gitignored and regenerated on demand: `tools/` (copied, Godot runs `.gd` helpers from
`res://`) and `library/` (a symlink to the plugin's knowledge base). Your committed game
stays pure game.

**Example assets stay out of your game.** Free CC0 models/textures live in an external
`x-shared-assets/` library, mounted into the game as a gitignored symlink Godot imports
(`res://x-shared-assets/`). Override its location with `assetLibrary` in `.xenodot.json`; you
place files into the game or the shared library from the **Get Assets** modal. See
[FEATURES.md](FEATURES.md).

**Growing the framework.** New skills/agents/tools start **game-local** in `<game>/.claude/`
and are usable immediately; you **promote** the keepers into the plugin
(`npm run promote -- skills <name>`). The clone → new → run path is guarded by
`npm run test:onboarding` (and CI). Full growth loop in [FEATURES.md](FEATURES.md).

## Using the web UI

The web UI runs the same agents from a browser (full feature list in
[FEATURES.md](FEATURES.md)):

```bash
cd xenodot-forge
npm start                    # opens http://localhost:3117
```

`npm run new` (or `npm run setup`) already saved your game's path to `.xenodot.json`
(gitignored), so `npm start` finds it with no arguments. The framework only
**reads** your project, it stays in its own repo.

You can point at any project, no setup needed:

```bash
npm start /path/to/another/project     # one-off override
GAME_DIR=/path/to/project npm start    # via environment variable
```

**Path resolution order** (first match wins): CLI argument → `GAME_DIR` env var →
saved `.xenodot.json` → default sibling `../game`.

**Troubleshooting, opens but shows no sessions or files?** The UI is pointed at
a folder with no `project.godot`. The server prints a warning on start and the
sidebar shows how to fix it. Point it at your game and restart:

```bash
npm run setup -- /path/to/your/game
```

## Design principles

- **Small slices.** A design doc is done when a single agent task can implement it and verification plus one human look can confirm it.
- **Push-back is the product.** The framework should refuse to silently fill vague briefs with its own assumptions. If the scope isn't clear, it asks.
- **Verification is mandatory.** Godot exits 0 on script parse errors and silently drops unknown `.tscn` properties. `tools/verify_scene.gd` exists because bugs that should have been caught shipped "verified" without it.
- **You stay the designer.** The framework keeps the loop fast and honest, it does not replace your judgement on what game to build.

## Not a competitor, a conductor

This framework isn't trying to beat Claude Code, [Hermes](https://hermes-agent.org/), or any model provider. It's built to **use them under the hood, with you still holding the wheel.** The bet isn't "our agent vs theirs", it's "the right tools composed behind one honest, human-gated loop."

- **Bring your own provider.** The Hive drives Claude Code through the Agent SDK, so Bedrock / Vertex / Foundry / enterprise gateways are first-class backends and non-Claude models route through an Anthropic-compatible proxy — you're tied to an API _shape_, not a vendor. (Setup details in [FEATURES.md](FEATURES.md#provider-flexibility).)
- **Other agents as delegated workers, not bosses.** The Hive stays the orchestrator and you keep approving its moves; a persistent agent like Hermes plugs in _underneath_ as a sub-agent the Hive dispatches to (over Hermes's OpenAI-compatible HTTP API), useful for work outside Godot's core: long-running memory, web research, multi-step ops. Anything it produces re-enters the same verification gates before it counts as done. (Running such an agent _on top_ as the conductor is possible too, but only on a leash that checkpoints with you, we compose autonomy, we don't surrender it.)
- **The one rule that doesn't bend: human in the loop.** Every other piece, provider, model, outer orchestrator, is swappable. The approval gates, the designer interview, and the human-run `promote` are not.

## Honest limitations (and where they're going)

No spin. Where it's weak today, and the intended direction, marked clearly as _not yet shipped_:

- **The learning loop is deliberately manual.** Skills improve only when _you_ run `promote`. That's the point, you stay the gatekeeper, but knowledge accrues slower than auto-capturing agents like Hermes. _Direction: assisted capture that drafts the skill and still waits for your yes._
- **API-shape lock-in.** Native backends are all Claude-family (Bedrock / Vertex / Foundry / gateway); other models need a translating proxy and lose some tool-use fidelity, since the pipeline is tuned for Claude's tool calls. _Direction: first-class, UI-level provider switching, with the fidelity gap measured honestly instead of hidden._
- **Hermes worker bridge is early (POC).** The Hermes-as-sub-agent story above is now **shipped as a gated POC**: a small in-process tool (`mcp__ui__hermes`) wraps Hermes's HTTP `runs` API (Hermes is an MCP _client_, not yet a server), every dispatch passes the human approval gate, and Hermes stays purely advisory — it investigates, a Xenodot researcher + you own the verdict and the library write. Off by default; setup is in [`HERMES.md`](HERMES.md). _Still open: proving its research actually beats the native researcher on real gaps, and a single source of truth for skills/memory aligned to the [agentskills.io](https://agentskills.io) standard so two systems don't grow two brains._
- **No persistent cross-session memory of _you_.** Each run starts fresh against the game repo; it doesn't remember your preferences the way an always-on agent does. _Direction: an optional, human-curated memory layer, off by default._
- **Verification is Godot-specific and headless-bound.** The gates catch what the engine silently drops, but render checks are shallow and there's no gameplay/behavioral testing yet. _Direction: deeper runtime assertions._
- **Local, single-user, not always-on.** The web UI is one person at one machine, no multi-channel, no 24/7. That's by design (human in the loop), but a real limit if you wanted hands-off automation, which this deliberately is not for.
- **It's a POC, and narrow.** Godot-family only; APIs, layouts, and prompts change without notice. _Direction: stabilize the pipeline contract before chasing breadth._

## Releases & versioning

Git tags are the source of truth, in a 4-part scheme keyed to the change type:

- `feat` → new **sub-version**: `v0.1.2` → `v0.1.3`
- `fix` / `chore` / `refactor` → new **build**: `v0.1.2` → `v0.1.2.1`

When you commit **in a terminal**, the pre-commit hook asks whether to cut a
release. Pick a type and it bumps `package.json` and tags the commit; press enter
to skip. Agent/CI commits (no TTY) are never prompted.

Tags are created **locally**, push them yourself:

```bash
git push origin main
git push origin v0.1.3
```

For a scripted / non-interactive release, stage the bump into your next commit:

```bash
npm run release -- feat   # or: fix | chore | refactor
git commit -m "…"          # post-commit creates the tag
```

`package.json` tracks the 3-part sub-version; the 4th build digit lives only in
the git tag (npm versions must be valid 3-part semver).

> **The plugin is the framework.** Changes under `plugin/` (agents, skills, tools, the
> knowledge base) ARE framework changes, list them in release notes as normal. Game-specific
> capabilities stay game-local until you `npm run promote` them into the plugin.

## Status

⚠️ **Proof of concept.** Shared so you can clone it and experiment with your own game. APIs, file layouts, and agent prompts will change without notice.

**Not accepting contributions for now**, issues and PRs are unlikely to be reviewed. Fork freely; it's MIT.

## Inspirations

This project doesn't exist in a vacuum. These people and projects shaped how it thinks about AI-assisted workflows, skill design, and Godot tooling.

**[Matt Pocock](https://github.com/mattpocock/skills/)**, the idea that skills should be _procedures_, not references. One canonical path, observable outcomes, no ambiguity about what "done" means.

**[Eduardo Schildt](https://www.youtube.com/@eduardoschildt)** - Game designer and artist who loves making games and sharing what I learn through game dev tutorials.

- [Donation page](https://ko-fi.com/eduardoschildt)
- [Demo Projects](https://pixelagegames.itch.io/)

**[Brackeys](https://www.youtube.com/@Brackeys)**, Top-quality game development tutorials on everything from Unity, Godot and programming to game design. A reminder that clarity and enthusiasm aren't mutually exclusive.

- [Donation Page](paypal.com/donate/?hosted_button_id=VCMM2PLRRX8GU)
- [Discord](discord.gg/brackeys)
- [Games](https://brackeysgames.itch.io/)

**[Jan Mesarč, GodotPrompter](https://github.com/jame581/GodotPrompter)**, the most complete Godot × Claude Code library out there: ~48 skills covering 2D, 3D, UI, audio, multiplayer, C#, optimization and more, plus 9 specialized agents. Parts of this project's plugin scaffolding are adapted from it (MIT, with thanks). If you want broad Godot coverage for Claude Code today, use GodotPrompter, it's excellent.

This project is not a competitor on breadth. The differences are in philosophy:

|              | GodotPrompter                                     | Xenodot Forge                                                         |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------- |
| Scope        | Broad reference library (48+ skills)              | Narrow pipeline with a locked design step                             |
| Skill style  | Reference: variants + trade-offs, GDScript and C# | Procedure: one canonical path, GDScript only                          |
| Entry point  | Skills you invoke directly                        | Designer interview gates what gets built                              |
| Verification | Code-review checklists                            | Observable runtime gates + error→fix tables                           |
| Growth rule  | n/a                                               | One skill at a time, adopted after passing its gate on a real project |

If you want broad coverage now, go use GodotPrompter. If you want to experiment with the pipeline model on your own project, clone this.

## Framework UI

<img width="1722" height="882" alt="image" src="https://github.com/user-attachments/assets/0b6b3223-ac6e-48c1-99c6-208f7e311370" />

<img width="1612" height="1084" alt="image" src="https://github.com/user-attachments/assets/bd2e67f8-04e3-4b43-85f1-da199208073a" />

### Functional Questions - Approval Gate

<img width="581" height="606" alt="image" src="https://github.com/user-attachments/assets/8c4acf45-dda3-44b4-8be5-d204bdfffdc6" />

### Tools use - Approval Gate

<img width="582" height="159" alt="image" src="https://github.com/user-attachments/assets/3b16e771-64ac-404b-8a03-e86437c99c5c" />

### Activities List

<img width="343" height="691" alt="image" src="https://github.com/user-attachments/assets/b8c0a286-ded8-493b-8994-bcaf571b5815" />

### Session Management

<img width="403" height="394" alt="image" src="https://github.com/user-attachments/assets/8b8ac8ae-1134-4bd3-9dd7-c6fb98e8befc" />

### Agents

<img width="411" height="339" alt="image" src="https://github.com/user-attachments/assets/f3e3b2f9-561b-45de-956d-80156054da0c" />

### Draw Level

<img width="642" height="649" alt="image" src="https://github.com/user-attachments/assets/6f6d4e2d-1ca0-4d8f-aa17-ee3a199e349b" />

## License

[MIT](LICENSE)
