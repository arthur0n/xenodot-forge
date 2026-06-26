# Verdict — new-onset motion sickness (FPS, Blast Court) — 2026-06-23

Input: Hermes findings `.xenodot/handoffs/hermes-motion-sickness.md` (run run_d85e737934e647d397a7903d1895d702), grounded against real repo code by skill-researcher. Hermes could not read the repo; this verdict resolves its 6 open questions and maps each mitigation to concrete files.

## Grounding results (Hermes open questions answered)

1. **Crosshair always visible?** YES. `entities/hud/crosshair.gd` = center-drawn Control via `_draw()`, no hide path. → **M7 N/A** (already shipped).
2. **Trap respawn — teleport vs lerp; frequency?** Hard teleport: `levels/blast_court.gd:193` `body.global_position = SPAWN_POS` + `rotation.y` + `velocity = ZERO`. NO lerp. Fall is a **telegraphed dwell-trap** (0.8s `DWELL_TIME`, emissive pulse, 3s reclose) → avoidable, **occasional NOT core**. Still the acute discontinuity. Fade wired `main.gd:71` `flash_fade.bind(0.08, 0.25)`.
3. **flash_fade shape?** `arena_hud.gd:175` — fade-in `0.08s` → fade-out `0.25s`, **NO black-hold middle**. Snap lands mid-transition, never under full black. → confirms **M1 gap exactly**.
4. **Glow config?** `blast_court.tscn` Env_bc: `glow_enabled=true`, `glow_intensity=0.3`, `glow_hdr_threshold=1.2` (LOW), `glow_blend_mode=2` (ADDITIVE), `tonemap_mode=2` (Filmic). Low threshold + bright noon → many surfaces over threshold → **flicker risk CONFIRMED**.
5. **Lighting?** Sun `light_energy=1.2`, near-top-down pitch (~-80°, `Transform3D` basis), `shadow_enabled` hard, `ambient_light_energy=0.8`. → confirms **M2/M3**.
6. **Metallic?** target/npc `metallic=0.0` (safe). **Viewmodel = sourced `assets/models/scifi_smg.glb`**, NO metallic override in `rifle.tscn` → embedded glb material, value UNKNOWN, plausibly >0.5 (sci-fi/metal). → **A/B candidate**, can't confirm statically.
7. **Sprint FOV instant?** NO — `player.gd:266` per-frame `lerpf(_camera.fov, target_fov, sprint_fov_lerp*delta)`, `sprint_fov_lerp=8.0`. ADS uses tween. → **M5 downgraded to optional** (already smoothed; delta 85→91 = +6°, minor).

## Useful vs N/A for THIS project

| Mitigation                | Verdict                       | Why                                                             |
| ------------------------- | ----------------------------- | --------------------------------------------------------------- |
| M1 respawn occlusion      | **USEFUL — MUST**             | acute trigger; current fade has no black-hold; cheap, contained |
| M2 tame glow              | **USEFUL — MUST + A/B first** | low hdr_threshold confirmed; glow-off A/B = primary diagnostic  |
| M3 soften shadow contrast | **USEFUL — MUST**             | energy 1.2 + near-top-down hard shadows confirmed               |
| M4 movement vignette      | **USEFUL — SHOULD**           | no vignette exists; highest-value non-gameplay comfort fix      |
| M5 smooth sprint FOV      | **OPTIONAL**                  | already lerped (8.0); only consider smaller delta 85→88         |
| M6 cap concurrent chasers | **OPTIONAL**                  | gameplay change; defer unless sickness combat-specific          |
| M7 crosshair              | **N/A**                       | already always-visible                                          |
| M8 comfort settings menu  | **PARK**                      | out of POC scope; no options UI exists                          |
| M9 third-person camera    | **REJECT**                    | contradicts `godot-first-person-controller` genre lock          |

## Framework promotion — should a future game-feel/polish skill ABSORB comfort patterns?

**Recommend folding a comfort/readability category into a future game-feel/polish skill (not yet built)** (human-gated foreground step — left for a human to author). Rationale: comfort = measurable readability, fits L3 sweep's "input responsiveness & readability" category. Durable patterns worth encoding:

- **Comfort-respawn occlusion** — any hard camera teleport must occlude under full black (fade-in → HOLD black ≥0.1s → fade-out), OR lerp the camera. Reusable beyond Blast Court.
- **Movement vignette rig** — velocity-proportional edge darkening (CanvasLayer ColorRect + shader, lerp intensity ~0.2s so vignette itself doesn't flicker). Standard XR "tunneling vignette". Framework-grade.
- **Glow-flicker guidance (Godot 4.6)** — `glow_hdr_threshold ≥2.0`, intensity 0.4-0.6, soft (not additive) blend; audit metallic >0.5 on viewmodels above threshold. Engine-version-specific gotcha (forum 132818 / godot#57693).
- **Crosshair anchor** — always-visible centered reticle as a comfort requirement (Seok 2021), not just a combat aid.

**SKIP** M6/M8/M9 from framework (gameplay/scope/genre-specific). Vignette could alternatively be its own `godot-comfort-vignette` skill if it grows; for now a category in that proposed game-feel skill is the lighter call.

## Severity model (grounded)

M1 = acute threshold-crosser (event-triggered). M2+M3 = chronic baseline visual stress (builds over session). Diagnose by symptom timing: if sickness hits ON falls → M1 dominant; if builds over a session → M2/M3 dominant. A/B order per Hermes: **M1 fix + glow OFF first**, revert one at a time.

— skill-researcher, grounded against repo HEAD (commit e89175e).
