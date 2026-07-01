---
name: godot-arena-spatial-design
agents: [game-designer, level-designer]
description: OPT-IN spatial-design principles for a combat/arena encounter space in Godot — nine measurable properties (loop topology, interior cover, partitioned sightlines, cover mix, bounded verticality, landmarks, spawn-to-engagement pacing, scale/density, choke-vs-open) that turn a flat blockout into a real firefight space. Use ONLY when the level being built is a combat/arena encounter (enemy waves, gunfights) — apply ALONGSIDE whichever build method is chosen (`godot-greybox` static default, `godot-runtime-arena` runtime, or `godot-gridmap-level` tile-fill). NOT the build mechanism itself, NOT a general level-design bar for non-combat spaces (that's `level-design-principles`).
---

# godot-arena-spatial-design — combat/arena spatial craft (nine principles)

Builds on **`godot-greybox`** (read it first: the static hand-authored mechanics these principles
get authored into — real `StaticBody3D`/`MeshInstance3D`/`Marker3D` nodes written directly into
the saved `.tscn`). This skill is **OPT-IN**: apply it only when the level being built is a
combat/arena encounter space — enemy waves, gunfights, anything where the player fights inside the
room. A market square, a dungeon hallway, or any other non-combat space should NOT be judged
against these principles; use `level-design-principles` instead for those.

A flat, empty room reads as "boring" or "not a real level" for a measurable reason: the absence of
five properties — interior cover, layered sightlines, bounded verticality, ≥3 nameable regions,
and a spawn-to-engagement path that is neither too long nor fully exposed. Author for those;
self-audit by eye before handoff.

## Requirements

- `godot-greybox` — the static hand-authored mechanics these principles get authored into (or
  `godot-runtime-arena` / `godot-gridmap-level` if a different build method was chosen for this
  level). This skill assumes one of them; it is not a build method itself.

## Project conventions

- **Spawns:** `SpawnMarker*` `Marker3D` children wired to the wave/spawn manager's
  `spawn_marker_paths`. Reuse the existing spawn manager — do not invent a new one.

## The nine spatial principles (author for these; self-audit BY EYE)

- **P1 TOPOLOGY = LOOP.** Every cover piece has ≥2 escape routes; no dead-ends (three-lane / figure-8).
  _Biggest lever vs the empty square._ CHECK (editor + F5): you can circle ≥2 ways; no degree-1 pockets.
- **P2 INTERIOR FOOTHOLD.** Each region has ≥1 cover piece NOT touching a perimeter wall. CHECK: walk
  the centre — is there cover to use?
- **P3 PARTITIONED SIGHTLINES.** No standing point sees the whole arena. CHECK: stand at spawn + each
  corner — is any spot exposed to everything?
- **P4 COVER COMPOSITION.** Mix half (crouch/step-out) vs full (blocks LOS), hard vs soft. CHECK: no
  single class dominates.
- **P5 VERTICALITY = RESTRAINT.** Present but bounded (2–3 floor levels). CHECK: is there ANY elevation
  change? (a flat floor = fail).
- **P6 LANDMARKS.** ≥3 nameable sub-regions, distinct massing/height/greybox colour. CHECK: can you
  name 3 distinct areas?
- **P7 SPAWN-TO-ENGAGEMENT.** Path spawn→first fight is in band (not instant, not a long boring run)
  and passes ≥1 cover. CHECK: walk spawn→centre — time it; does it pass cover?
- **P8 SCALE / DENSITY.** Halls ≥2.0 m; doorways ≥1.25×2.5; not oversized (the #1 cause of "empty" —
  shrink footprint). CHECK: footprint vs enemy count reads dense, not a parking lot.
- **P9 CHOKE vs OPEN.** Alternate open spaces with commitment chokes. CHECK: is there a tight passage
  before the big space?

## Pre-handoff self-audit (by eye, in the editor + one F5)

- [ ] interior footholds per region (P2); not a hollow square
- [ ] loop topology, no dead-ends (P1)
- [ ] no point sees the whole arena (P3)
- [ ] cover-class mix (P4)
- [ ] 2–3 verticality levels (P5)
- [ ] ≥3 named landmark regions (P6)
- [ ] spawn-to-engagement in band + passes cover (P7)
- [ ] cover sits ON the navmesh

## Error → Fix

| Symptom                              | Fix                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Arena reads empty in the centre      | add interior-foothold cover per region (P2); shrink footprint if oversized |
| Whole arena visible from spawn       | add internal wall/massing (P3)                                             |
| Cover floats / enemies path under it | re-place cover on the floor; re-bake `nav_region`                          |

---

Applies on top of `godot-greybox` (default), `godot-runtime-arena` (opt-in runtime), or
`godot-gridmap-level` (opt-in tile-fill) — whichever build method was chosen for this level.
Adapted from The Level Design Book (book.leveldesignbook.com) + GDC talks (FMPONE, Steve Lee,
Griesemer, Worch). Reference, no code copied.
