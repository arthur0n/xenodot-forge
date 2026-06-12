# Xenodot Forge

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Godot 4.x](https://img.shields.io/badge/Godot-4.x-blue.svg)
![Skills: 9](https://img.shields.io/badge/Skills-9-purple.svg)
![Agents: 6](https://img.shields.io/badge/Agents-6-orange.svg)
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

game/       Your Godot project lives here (gitignored — it has its own repo).
            The framework tracks only the folder, not the contents.
```

There is **no template**. The agents, skills, and verification tools live _inside the game project_ (`game/.claude/`, `game/tools/`) and evolve with the project through the framework's own loops: bug triage, skill research, friction reports. One live copy — the framework uses what's there. The reference project during this POC is [DiceOfFate](https://github.com/Coghatch-ai/dicefate).

## Requirements

- [Claude Code](https://claude.com/claude-code) installed and authenticated
- Godot 4.x (skills target 4.x APIs; verified against 4.6)
- Node.js 18+ (only for the web UI)

## Quickstart

1. Drop a Godot project with a `.claude/` setup into `game/` (clone one that has it, or your own):

   ```bash
   git clone <your-godot-project> game
   ```

2. Start Claude Code **from inside the project directory** — that's what makes agents and skills discoverable:

   ```bash
   cd game && claude
   ```

3. Ask for something. If the scope is clear and small, `godot-dev` builds and verifies it. If it's big or vague, `game-designer` will interview you — one question at a time, with a recommended answer — until the scope collapses to one buildable slice. That's a feature.

### Optional: web UI

```bash
npm install
node ui/server/index.js game   # or any path to a Godot project (or: npm start game)
# open http://localhost:3117
```

## Design principles

- **Small slices.** A design doc is done when a single agent task can implement it and verification plus one human look can confirm it.
- **Push-back is the product.** The framework should refuse to silently fill vague briefs with its own assumptions. If the scope isn't clear, it asks.
- **Verification is mandatory.** Godot exits 0 on script parse errors and silently drops unknown `.tscn` properties. `tools/verify_scene.gd` exists because bugs that should have been caught shipped "verified" without it.
- **You stay the designer.** The framework keeps the loop fast and honest — it does not replace your judgement on what game to build.

## Status

⚠️ **Proof of concept.** Shared so you can fork it and experiment with your own game. APIs, file layouts, and agent prompts will change without notice.

**Not accepting contributions for now** — issues and PRs are unlikely to be reviewed. Fork freely; it's MIT.

## Inspirations

This project doesn't exist in a vacuum. These people and projects shaped how it thinks about AI-assisted workflows, skill design, and Godot tooling.

**[Matt Pocock](https://github.com/mattpocock/skills/)** — the idea that skills should be _procedures_, not references. One canonical path, observable outcomes, no ambiguity about what "done" means.

**[Eduardo Schildt](https://www.youtube.com/watch?v=iPbYzFWECz4)** — grounded exploration of AI-assisted game development workflows in practice, not just in theory.

**[Brackeys](https://www.youtube.com/watch?v=ke5KpqcoiIU)** — returning to teach Godot at a moment when the ecosystem needed it. A reminder that clarity and enthusiasm aren't mutually exclusive.

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

## License

[MIT](LICENSE)
