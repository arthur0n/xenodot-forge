# Roadmap — Foundation POC ✅ COMPLETE (walk + jump in a 3D pixel-art room)

> **Status: COMPLETE and retired. Superseded by [`itch_demo.md`](./itch_demo.md).**
> This was the framework's _first_ end-to-end validation: prove the agent pipeline could take a
> Godot project from empty to a verifiable, pixelated, walk-+-jump scene, each phase gated by
> observable F5 verification. It passed. The framework has since grown well beyond it —
> **10 agents, 18 skills, a web UI, and a self-improvement loop** (see `CLAUDE.md` for the live
> registry; this doc deliberately does not re-list them).
>
> Active work now targets a shippable itch.io demo — see `itch_demo.md`.
>
> **Divergences from the source tutorials (kept):** orthographic fixed-angle camera (not
> first-person); lighting tuned for pixel readability (no ACES/auto-exposure/SSAO); Jolt physics
> from day one. **CSG blockout (Phase 3) was skipped** in favour of a manual StaticBody3D
> blockout — the gate was satisfied without it.

## Phase table (final)

| Phase                 | Skill(s)                                         | Status     | Gate (observable, F5-testable)                                             |
| --------------------- | ------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| 0 Foundation          | godot-project-conventions                        | ✅ built   | CLAUDE.md conventions section; project runs empty; Jolt enabled            |
| 1 Render pipeline     | godot-3d-pixelation                              | ✅ built   | Scene visibly pixelated at stretch_shrink; crisp (nearest) edges           |
| 2 Camera              | godot-camera-rig                                 | ✅ built   | Orthographic view, no vanishing point; Size zooms, Z-move doesn't          |
| 3 Level blockout      | (godot-csg-blockout)                             | ⏭ skipped | Manual StaticBody3D blockout satisfied the gate; CSG skill never built     |
| 4 Player              | godot-player-controller-3d                       | ✅ built   | Capsule walks camera-relative, jumps, can't leave the room                 |
| 5 Light & environment | godot-pixel-lighting                             | ✅ built   | Sun shadows readable under the player on landing; no blown highlights      |
| **POC GATE**          | —                                                | ✅ pass    | All of the above in one F5 run, recorded pass/fail per phase               |
| 6 Outlines            | godot-screen-effects (depth+normal 4-tap kernel) | ✅ built   | Single-pixel black outlines on depth/normal discontinuities — F5 confirmed |
| 7 Assets              | godot-mesh-import-pixel-art / -texture-import    | ➡ moved    | Folded into `itch_demo.md` Track A (furnish + texture the apartment)       |
| 8 Characters          | godot-animation-libraries                        | ➡ moved    | Out of scope for the demo (static capsule / single idle is fine)           |

Phases 7–8 are no longer tracked here — the asset-import and animation skills now exist
(`CLAUDE.md ## Skills`), and the remaining furnishing/polish work lives in `itch_demo.md`.

## Conventions established here (still in force — canonical copy in `CLAUDE.md`)

- **Jolt physics** (Godot 4.4+); **1 unit = 1 m**, uniform collider scaling.
- Game scenes **nest** imported models — never inherited scenes, never "make local".
- Graybox first; swap to real assets only after the gate (lock + de-collide when swapping).
- Orthographic fixed-angle camera; pixel-readability-first lighting (Filmic, fixed exposure).

→ **Continue at [`itch_demo.md`](./itch_demo.md).**
