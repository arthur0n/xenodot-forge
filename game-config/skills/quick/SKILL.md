---
name: quick
description: Quick-action entry point for the DiceOfFate framework — routes a small game request either straight to godot-dev or back to the pipeline, with one consistent report shape. Use when the user invokes /quick <task>, or asks for a small concrete game change and it's unclear whether it needs the game-designer first.
---

# /quick — small-task dispatch

The quick path is where vibe-coding sneaks back in. This skill exists so the designer-vs-direct decision is a checklist, not a judgment call, and so every quick action returns the same report and feeds the learning loop.

## Routing check

Dispatch godot-dev directly ONLY if all four hold:

1. **Covered** — every pattern the task needs is in an existing godot-\* skill or `design/` doc; nothing structural must be invented.
2. **Small** — touches about one entity/scene/script (plus wiring in main or the level).
3. **Observable** — the result is verifiable with godot-verify plus one F5 look.
4. **No new conventions** — no new input actions, folders, or project-wide decisions.

If any check fails, do not dispatch. Report in one line _which_ check failed and why, then offer the right route: **game-designer** (too big / unclear scope), **skill-researcher** (uncovered pattern — check 1 failed). Failing the check is a correct outcome of /quick, not an error.

## Dispatch (on pass)

Spawn **godot-dev** with: the task in 1–2 sentences, which godot-\* skills to load (always include godot-code-rules when the task touches .gd files), the relevant `design/` doc if one applies, and the reminder that the `tools/validate.sh` gate is mandatory.

## Report (always this shape)

- **Result** — what changed, player-visible, one sentence
- **Files** — paths touched
- **Verify** — `tools/validate.sh` outcome (plus render check when run), quoted from godot-dev's report
- **Friction** — from godot-dev's Friction line, or "none"

End by telling the user what to look at on F5.

## Learning gate

If Friction is not "none", offer — ask, never auto-run: "Want bug-triage to look at this friction?" One offer, then drop it; the user owns the gate.
