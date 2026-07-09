---
name: godot-playgrade
agents: [godot-playtester]
domain: godot-core
description: The rubric CONTRACT for grading a built Godot game by PLAYING it, not reviewing its code — the deterministic half of the generator-evaluator loop. Use when grading a build against its design Acceptance: run tools/playgrade.sh (it scores runs-clean / renders-healthy / core-loop-functional / data-driven / feel-responsive into a structured playgrade-report.json with hard thresholds and an exit code), author the adversarial play_*.gd bots it runs, and root-cause each FAIL. Defines criteria + thresholds + the finding format; tools/playgrade.sh is the implementation.
---

# Godot Playgrade

Grade a build by **playing it**, against the design's Acceptance — the embodied evaluator the
static gate can't be. This skill is the **contract**; `tools/playgrade.sh` is the implementation.

## Deterministic by design — what the script does vs what you do

The grade is a **script + a structured verdict**, not your opinion. Keep your judgment surface
small:

- `tools/playgrade.sh` **grades** — composes `tools/lib/checks.sh` + the game's `play_*.gd` bots
  into the 5 criteria below and writes `.xenodot/playgrade/<slug>.json` (exit 0 iff overall PASS;
  SKIPs never fail). Re-run it; same build → same verdict.
- **You** do only what a script can't: (1) **author** the adversarial `tools/play_<slug>.gd` bots
  it runs (from the design Acceptance — see godot-playthrough-bot for the SceneTree bot pattern), and
  (2) **root-cause** each FAIL into the report's `findings`.

Never hand-wave a PASS the script didn't produce, and never overrule a deterministic FAIL — fix the
build or, if the check itself is wrong, file that as evaluator divergence (the rubric gets tuned,
not bypassed).

## Run it

```bash
tools/playgrade.sh --slug <slug> --design design/<slug>.md [--scene <entry.tscn>]
# → .xenodot/playgrade/<slug>.json   (the verdict);  exit 0 = PASS, 1 = FAIL
```

## The rubric (5 criteria, hard thresholds)

| #   | criterion             | check fn                                    | regime                         | FAIL when                                                                    | v1                    |
| --- | --------------------- | ------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- | --------------------- |
| 1   | runs-clean            | `check_scene_errors` + `check_smoke`        | headless                       | any non-benign `ERROR`/`SCRIPT ERROR`                                        | GRADED                |
| 2   | renders-healthy       | `check_render` (flat-color floor)           | windowed (**SKIP** no display) | output is a flat color (valid scene, renders nothing)                        | GRADED with a display |
| 3   | core-loop-functional  | `check_play_bots`                           | headless                       | any Acceptance-derived assertion fails                                       | GRADED                |
| 4   | data-driven-adherence | codex-criteria lens                         | static                         | orphan-data / magic-number-in-logic / parallel-system                        | SKIP → Codex/agent    |
| 5   | feel-responsive       | latency/continuity asserts in the play bots | headless                       | input→response latency > K, or per-frame displacement out of `[floor, ceil]` | SKIP → REPORT         |

Subjective juice/polish is **out** of the automated rubric — surface it as a `human F5 needed`
note, never as a fake metric.

### How the SKIP criteria graduate (v1 → full)

- **renders-healthy (2):** the binary flat-color floor (`check_render` → `tools/verify_render.gd`,
  godot-verify L3) is live: GRADED when a display is present, **SKIP, never FAIL, headless**
  (Godot headless returns blank images — a FAIL there is a false red). The calibrated
  render-metric bands (per-arena scripts) remain the next graduation step.
- **data-driven (4):** credit the Codex `adversarial-review` finding (it injects `codex-criteria.md`)
  when Codex is in the team; otherwise apply the lens as a read pass. Not re-derived by the script.
- **feel-responsive (5):** today the `play_*.gd` bots assert latency/continuity inline and it is
  REPORTed; it graduates to a gated criterion once thresholds are calibrated (below).

## Thresholds: inferred defaults → REPORT → calibrate → gate

Same discipline as render-health. **Binary criteria** (runs-clean, each Acceptance assertion) gate
immediately — they have no number to tune. **Numeric criteria** (feel latency/continuity, render
bands) start as **inferred defaults in REPORT mode**: measure them on a known-good build first, then
set each bound with margin before letting them hard-gate. Never hardcode a number as a gate without
having measured the good build.

- **Generic contract** (the criteria, regimes, the finding format, this discipline) lives **here**.
- **Game-specific numbers** + which Acceptance check maps to which criterion live in the per-game
  `design/<slug>.md` **Acceptance** section. Read it to derive the play plan.

## Authoring the play bots (criteria 3 and 5)

From the design Acceptance, author `tools/play_<slug>.gd` (the godot-playthrough-bot SceneTree
pattern: `Input.action_press` / `viewport.push_input`, `await physics_frame`, assert state-deltas
and signals via await-with-timeout, exit 0/1). For each Acceptance check, add the straight-line
assertion plus at least one adversarial edge case the builder's own `smoke_*.gd` did not cover (a
boundary input, an off-axis approach, a failure input). These bots are what `check_play_bots` runs.

An Acceptance check whose truth depends on LIVE physics-overlap (`Area3D.body_entered` between two
independently-moving bodies) or REAL continuous-input reachability (a walking player actually
reaching a volume) CANNOT be graded headless — the bot can only assert the code path via a
teleport/stub, which is a FALSE GREEN. Mark that check regime `windowed` → status SKIP with a
`human F5 needed` note; NEVER let it contribute a headless PASS. crit-3 (core-loop-functional) gates
green only on genuinely headless-decidable checks.

## The finding format (you fill these in)

`playgrade.sh` seeds one `findings[]` entry per FAILed criterion with the evidence log; you enrich
each into the article's format and write the report **gate-first** to
`.xenodot/handoffs/playgrade-<slug>.md`:

```
<file>:<line> — <root cause> — repro: <exact bot invocation / input timeline> — <criterion: measured vs threshold>
```

Relay only `<path> — playgrade PASS|FAIL`; the orchestrator digests the file via handoff-summarizer.

## On PASS

Recommend promoting any `play_*.gd` that caught a **real** regression into the builder's floor gate
as a `smoke_<seam>.gd` — every catch hardens the next build's self-gate (the virtuous cycle).

## The verdict schema (`.xenodot/playgrade/<slug>.json`)

```json
{
  "slug": "...",
  "design": "...",
  "overall": "PASS|FAIL",
  "criteria": [
    {
      "id": "...",
      "regime": "...",
      "status": "PASS|FAIL|SKIP",
      "measured": "...",
      "threshold": "...",
      "evidence": "<log path>",
      "detail": "..."
    }
  ],
  "findings": [
    {
      "criterion": "...",
      "file": "...",
      "line": 0,
      "root_cause": "...",
      "repro": "...",
      "evidence_log": "<log path>"
    }
  ]
}
```

This JSON is the loop's contract: the orchestrator reads `overall` + the exit code to drive
iteration; the QA-tuning loop logs divergence against it.
