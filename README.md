# Xenodot Forge

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Godot 4.x](https://img.shields.io/badge/Godot-4.x-blue.svg)
![Skills: 11](https://img.shields.io/badge/Skills-11-purple.svg)
![Agents: 7](https://img.shields.io/badge/Agents-7-orange.svg)
![Status: POC](https://img.shields.io/badge/Status-POC-yellow.svg)

An experiment in building Godot games with Claude Code using **a deliberate pipeline instead of a chat box**.

## The real goal

Most frameworks hand you a fixed toolbox. This one is designed to be **broken, rebuilt, and replaced by you**.

The agents self-improve from your experience — every bug, every awkward pattern, every moment where the pipeline slowed you down instead of helping is signal. The `bug-triage`, `skill-researcher`, and `godot-refactor` agents exist specifically to close that loop: find the friction, trace the root cause, update the skills, rewrite the rules. The framework you end up with is not the one you started with.

The tools are here. The shape of the framework is yours to decide.

### Roadmap:

🔨 0.1 - [First Game Tutorial](https://github.com/arthur0n/xenodot-forge/blob/main/docs/roadmap/first_game.md)

## Why this exists

Most AI-assisted game dev setups hand you a frontier model and a blank prompt. Describe your game, get some code, paste it in, pray it runs. That works — until you want to ship something repeatable, reviewable, and actually _yours_.

This project bets on a different loop: **move the design decisions to before inference, not during it.** You don't tell the model what to build; you go through a structured interview that cuts scope to one buildable slice, produces a locked design doc, and only _then_ hands it off to a dev agent. The model stops guessing. You stop pasting broken code.

The pipeline looks like this:

```
idea → game-designer       (interviews you, pushes back on vague scope, writes a one-page design doc)
     → godot-dev           (implements exactly that doc — nothing more, nothing less)
     → godot-verify        (headless engine checks — catches what Godot silently drops)
     → you                 (one look in the editor, that's your job)
```

Push-back is the product. The designer agent will not silently fill gaps. It asks, narrows, and confirms before anything gets built. Nothing gets reported "done" without passing real engine checks.

## Naming

| Term              | What it means                                                        |
| ----------------- | -------------------------------------------------------------------- |
| **Xenodot**       | The ecosystem                                                        |
| **Xenodot Forge** | This framework — web UI + the agent workflow                         |
| **Xenodots**      | The individual agents (designer, dev, refactor, researchers, triage) |
| **Xenodot Hive**  | The multi-agent orchestrator — the main coordination loop            |

## What's inside

```
ui/         Web UI (Node) — run sessions from a browser.
            Designer questions render as clickable forms.
            Tool approvals become allow/deny buttons.
            Live event feed so you see what's happening.
```

**The framework is independent of your game — it contains no game folder.** It
_points at_ your Godot project wherever that project lives (by default a sibling
folder named `game/`, next to this one), reads it in place, and never copies,
vendors, or tracks it. Your project stays in its own git repo; the framework
just drives Claude Code against it.

There is **no template**. The agents, skills, and verification tools live
_inside your game project_ (`<project>/.claude/`, `<project>/tools/`) and evolve
with it through the framework's own loops: bug triage, skill research, friction
reports. One live copy — the framework uses what's there. The reference project
during this POC is [DiceOfFate](https://github.com/Coghatch-ai/dicefate).

## Requirements

- [Claude Code](https://claude.com/claude-code) installed and authenticated
- Godot 4.x (skills target 4.x APIs; verified against 4.6)
- Node.js 18+ (only for the web UI)

## Quickstart

The framework and your game are two separate repos. Keep them side by side:

```
your-workspace/
├── xenodot-forge/     ← this framework (your fork)
└── game/              ← your Godot project (its own git repo)
```

1. Fork this framework, then clone it and your Godot project as siblings:

   ```bash
   git clone <your-fork-of-xenodot-forge> xenodot-forge
   git clone <your-godot-project> game     # any Godot project with a .claude/ setup
   ```

   The folder can be named anything and live anywhere — `game/` next to the
   framework is just the default the UI looks for. (Don't have a project yet?
   Clone the reference one: `git clone https://github.com/Coghatch-ai/dicefate game`.)

2. **Terminal workflow** — start Claude Code from inside the project so its
   agents and skills are discoverable:

   ```bash
   cd game && claude
   ```

   Ask for something. If the scope is clear and small, `godot-dev` builds and
   verifies it. If it's big or vague, `game-designer` interviews you — one
   question at a time, with a recommended answer — until the scope collapses to
   one buildable slice. That's a feature.

## Installing the Claude config

The framework ships its Claude Code setup in two parts:

- **Framework spine** (`.claude/`) — rules + the rtk hook for working _on the
  framework_. It's committed, so your fork already has it; nothing to install.
- **Game config** (`game-config/`) — the rtk hook + the godot agents + skills the
  framework deploys _into a game_. Install it once into your game:

  ```bash
  cd xenodot-forge
  npm run setup -- ../game     # point at your game first (if you haven't)
  npm run claude:install       # copy agents + skills + hook into ../game/.claude
  ```

`claude:install` is **non-destructive** — it never overwrites files you already
have (your agents evolve in place). Pass `--force` for a clean reset to the
shipped bundle:

```bash
npm run claude:install -- --force
```

The hook is `rtk hook claude`, guarded so it **no-ops safely if `rtk` isn't
installed** — Bash keeps working. Get rtk for the token savings; the agents work
either way. On first use you may need to approve the project hook once via
`/hooks` in Claude Code.

> **Maintaining a fork:** `game-config/` is kept current automatically — a
> pre-commit step (`npm run claude:sync`) re-vendors your reference game's
> `.claude/` agents + skills on every commit, so what you ship never drifts.

## Using the web UI

The web UI runs the same agents from a browser: designer questions become
clickable forms, tool approvals become allow/deny buttons, and a live feed shows
what's happening.

```bash
cd xenodot-forge
npm install
npm run setup -- ../game     # remember where your game lives (do this once)
npm start                    # then open http://localhost:3117
```

`npm run setup` saves the path to `.xenodot.json` (gitignored) so you don't
repeat it. The framework only **reads** your project — it stays in its own repo.

You can point at any project, no setup needed:

```bash
npm start /path/to/another/project     # one-off override
GAME_DIR=/path/to/project npm start    # via environment variable
```

**Path resolution order** (first match wins): CLI argument → `GAME_DIR` env var →
saved `.xenodot.json` → default sibling `../game`.

**Troubleshooting — opens but shows no sessions or files?** The UI is pointed at
a folder with no `project.godot`. The server prints a warning on start and the
sidebar shows how to fix it. Point it at your game and restart:

```bash
npm run setup -- /path/to/your/game
```

## Design principles

- **Small slices.** A design doc is done when a single agent task can implement it and verification plus one human look can confirm it.
- **Push-back is the product.** The framework should refuse to silently fill vague briefs with its own assumptions. If the scope isn't clear, it asks.
- **Verification is mandatory.** Godot exits 0 on script parse errors and silently drops unknown `.tscn` properties. `tools/verify_scene.gd` exists because bugs that should have been caught shipped "verified" without it.
- **You stay the designer.** The framework keeps the loop fast and honest — it does not replace your judgement on what game to build.

## Releases & versioning

Git tags are the source of truth, in a 4-part scheme keyed to the change type:

- `feat` → new **sub-version**: `v0.1.2` → `v0.1.3`
- `fix` / `chore` / `refactor` → new **build**: `v0.1.2` → `v0.1.2.1`

When you commit **in a terminal**, the pre-commit hook asks whether to cut a
release. Pick a type and it bumps `package.json` and tags the commit; press enter
to skip. Agent/CI commits (no TTY) are never prompted.

Tags are created **locally** — push them yourself:

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

> **Vendored game config is not a framework change.** Anything under
> `game-config/` is synced from the game project's own repo
> ([DiceOfFate](https://github.com/Coghatch-ai/diceofate)) — those agents/skills
> are the game's work, not framework features. Attribute them to the game repo;
> don't list them in framework release notes. `npm run release` prints a reminder
> when `game-config/` changed since the last tag, so you can verify before cutting.

## Status

⚠️ **Proof of concept.** Shared so you can fork it and experiment with your own game. APIs, file layouts, and agent prompts will change without notice.

**Not accepting contributions for now** — issues and PRs are unlikely to be reviewed. Fork freely; it's MIT.

## Inspirations

This project doesn't exist in a vacuum. These people and projects shaped how it thinks about AI-assisted workflows, skill design, and Godot tooling.

**[Matt Pocock](https://github.com/mattpocock/skills/)** — the idea that skills should be _procedures_, not references. One canonical path, observable outcomes, no ambiguity about what "done" means.

**[Eduardo Schildt](https://www.youtube.com/@eduardoschildt)** - Game designer and artist who loves making games and sharing what I learn through game dev tutorials.

- [Donation page](https://ko-fi.com/eduardoschildt)
- [Demo Projects](https://pixelagegames.itch.io/)

**[Brackeys](https://www.youtube.com/@Brackeys)** — Top-quality game development tutorials on everything from Unity, Godot and programming to game design. A reminder that clarity and enthusiasm aren't mutually exclusive.

- [Donation Page](paypal.com/donate/?hosted_button_id=VCMM2PLRRX8GU)
- [Discord](discord.gg/brackeys)
- [Games](https://brackeysgames.itch.io/)

**[Jan Mesarč — GodotPrompter](https://github.com/jame581/GodotPrompter)** — the most complete Godot × Claude Code library out there: ~48 skills covering 2D, 3D, UI, audio, multiplayer, C#, optimization and more, plus 9 specialized agents. Parts of this project's plugin scaffolding are adapted from it (MIT, with thanks). If you want broad Godot coverage for Claude Code today, use GodotPrompter — it's excellent.

This project is not a competitor on breadth. The differences are in philosophy:

|              | GodotPrompter                                     | Xenodot Forge                                                         |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------- |
| Scope        | Broad reference library (48+ skills)              | Narrow pipeline with a locked design step                             |
| Skill style  | Reference: variants + trade-offs, GDScript and C# | Procedure: one canonical path, GDScript only                          |
| Entry point  | Skills you invoke directly                        | Designer interview gates what gets built                              |
| Verification | Code-review checklists                            | Observable runtime gates + error→fix tables                           |
| Growth rule  | —                                                 | One skill at a time, adopted after passing its gate on a real project |

If you want broad coverage now, go use GodotPrompter. If you want to experiment with the pipeline model on your own project, fork this.

## Framework UI

### Functional Questions - Approval Gate

<img width="581" height="606" alt="image" src="https://github.com/user-attachments/assets/8c4acf45-dda3-44b4-8be5-d204bdfffdc6" />

### Tools use - Approval Gate

<img width="582" height="159" alt="image" src="https://github.com/user-attachments/assets/3b16e771-64ac-404b-8a03-e86437c99c5c" />

### Activities List

<img width="517" height="750" alt="image" src="https://github.com/user-attachments/assets/e9f7f50d-622d-4183-9f72-a7e828d79b3c" />

### Session Management

<img width="372" height="661" alt="image" src="https://github.com/user-attachments/assets/c0454de1-6962-43fb-b8c3-27de68cef965" />

## License

[MIT](LICENSE)
