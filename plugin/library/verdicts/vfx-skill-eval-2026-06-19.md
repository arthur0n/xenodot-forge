# Verdict — VFX for the FPS POC (Hermes findings eval)

Date: 2026-06-19 · Agent: skill-researcher · Input: Hermes VFX findings (run c47cfbbd…)
Decision gate: pending user (mcp**ui**ask filed). Recommend-only run — no skill/.claude written.

## Gap

FPS POC has NO juice on its combat seams: muzzle is a code-pulsed OmniLight3D, hit/death is a
StandardMaterial3D emission swap (`_flash()`), rescue is a green-flash branch. Zero
GPUParticles3D / CPUParticles3D / Decal / trail anywhere in code (confirmed by grep). Need a
reusable way to spawn fire-and-forget 3D VFX off existing gameplay signals.

## Library candidate evaluated

`GodotPrompter/skills/particles-vfx` (MIT). Generic particle REFERENCE: GPU-vs-CPU table,
ParticleProcessMaterial props, subemitters, trails, attractors, recipes. Strong facts but
**2D+3D+C# mixed, no FPS framing, no one-shot-free rig, no router, no project seams**. Adoptable
slice = the 3D GPUParticles facts + one-shot/explosiveness/cleanup discipline; everything 2D/C#/
attractor/flipbook is irrelevant to this POC. Not adoptable wholesale; rewrite slice into our skill.

## Godot 4.6 facts — VERIFIED vs docs (not taken on faith)

- GPUParticles3D `finished` signal: EXISTS (4.6). `one_shot`, `explosiveness`, `emitting`: EXIST.
  → Hermes' "free self on `finished`" rig is valid.
- Particle trails: docs say "only supported in the Forward+ and Mobile renderer" — NOT
  Compatibility. We are Forward+ → OK. (GPUTrail3D community plugin = same Forward+ constraint.)
- Decal: not supported in Compatibility; Forward+/Mobile only. We are Forward+ → OK.
- GPUParticles3D as default over CPUParticles3D: correct for Forward+ 3D.

All load-bearing Hermes claims hold. (Hermes' OTHER claim "no godot-screen-effects installed" is
WRONG — we DO have it; vignette belongs there, see below.)

## Grounded seams — CONFIRMED in repo (exact)

- weapon.gd: `signal fired`, `hit_confirmed`, `kill_confirmed`; `_flash_pulse()` drives MuzzleFlash.
- melee.gd: same `hit_confirmed`/`kill_confirmed` contract (+ `hit_with_position`).
- projectile.gd: `signal hit(target)`, duck-typed `body.on_hit()` (top_level Area3D).
- enemy.gd / npc.gd: `signal died`; `_flash()` emission swap; npc green +1-life branch.
- rifle.tscn / weapon.tscn: `Muzzle` Marker3D → child `MuzzleFlash` OmniLight3D ("off by default").
- player: NO `health_changed`, NO health field → **vignette has no trigger yet** (blocker).

## DECISIONS

### 1. New skill? YES — ONE skill: `godot-oneshot-vfx`

VFX is recurring + genre-general (every combat seam wants juice; many effects share one
spawn-free lifecycle). The reuse bar for a skill is met. "Modularize on demand" is satisfied: the
_pattern_ (spawn a Node3D-rooted one-shot, free on `finished`, route via a thin map) is the reusable
unit — NOT each individual effect. Mirrors our existing audio "fire-and-free / reparent-before-free"
discipline, so it slots into an established house style.

Scope of the skill = **the rig + the routing pattern only**:

- `vfx_base.tscn` (Node3D root + GPUParticles3D child) + `VfxOneShot.gd`: set `one_shot=true`,
  `explosiveness`, `emitting=true`, `queue_free()` on `finished`. local_coords correctness.
- Thin router that maps gameplay signals → effect scenes. **Recommend a PLAIN component/helper, NOT
  a new autoload** — `godot-composition` prefers composition over autoloads; a `VFXRouter` autoload
  contradicts CLAUDE.md. Park "promote to autoload" only if many scenes need it.
- The 4.6 GPUParticles3D facts + perf budget (lifetime 0.2–0.8s, ≤~200/burst, no shadow-cast flash).
- Shadowless OmniLight3D flash pattern; MeshInstance3D scale-tween shockwave (cheap, no particles).
- Naming/path conventions for THIS project (entities/vfx/ effect scenes; PascalCase nodes).

### 2. Effect family ownership (do NOT pile all into the new skill)

| Family                           | Home                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| muzzle flash particles           | NEW `godot-oneshot-vfx` (off the `fired` seam; reuse existing MuzzleFlash light)                                                                                                         |
| impact / hit-spark / death burst | NEW skill (off `hit`/`hit_confirmed`/`died`) — but the hit/death _contract_ stays `godot-shooter-enemy-combat`; VFX just hangs a listener on `died`/`hit_confirmed`. No contract change. |
| projectile trail                 | EXISTING `godot-travelling-projectile-3d` — trail is a property baked onto the projectile mesh, not a one-shot. Add as a small addition there, NOT the VFX skill.                        |
| rescue halo                      | NEW skill (off npc green branch) — build task once palette known                                                                                                                         |
| **damage vignette**              | EXISTING `godot-screen-effects` (shaders/post/) — NOT a new skill. Hermes wrongly thought it absent.                                                                                     |
| scorch / blood decals            | NEW skill (pooled Decal) — but design doc parks decals as "Later"; DEFER.                                                                                                                |

### 3. Open questions to route BEFORE any build

- **VFX palette / art-direction** → art-director. firing-yard art-doc parks glow + decals as "Later",
  has NO VFX colour spec. Blocker for muzzle/impact/death colour + intensity.
- **player `health_changed` signal** → game-designer/godot-dev decision. Vignette can't trigger
  without a player health model; player currently has none. Blocks the vignette effect entirely.
- **`_vfx_root` container placement** → where freed one-shots live (a Main-level `VfxRoot` Node3D vs
  level-local). Mirror the audio reparent-before-free choice. godot-dev decides at build.
- **per-surface impact tag** (metal vs concrete vs flesh) → defer; single generic impact first.

### 4. Smallest first adoption (RECOMMENDED)

1. Author ONE skill `godot-oneshot-vfx` (rig + router pattern + 4.6 facts + perf budget).
2. Then a BUILD task: muzzle-flash particles on `fired` + ONE generic impact burst on
   projectile `hit`. Cheapest, highest-visibility, needs only a minimal palette from art-director.
3. DEFER: vignette (needs health_changed), decals (design "Later"), trails (small projectile-skill
   addition, do after that task), rescue halo, per-surface tags, layered subemitters.

Parked-for-later (available in library if needed): subemitters, attractors, GPUParticlesCollision3D,
flipbook, dynamic amount_ratio quality scaling, GPUTrail3D plugin.

## Proposed new-skill outline (author FOREGROUND after approval)

Target path: `.claude/skills/godot-oneshot-vfx/SKILL.md`
CLAUDE.md "## Skills" line:
`- godot-oneshot-vfx: fire-and-free 3D VFX (GPUParticles3D one-shot freed on \`finished\`) routed off combat seams (fired/hit/died) — muzzle, impact, death burst, shockwave; perf budget; Forward+. NOT the vignette (godot-screen-effects) nor the projectile trail (godot-travelling-projectile-3d).`

Sections:

- Title + why (fire-and-free mirrors audio house style; one rig, many effects; on-demand).
- `## Requirements`: godot-composition, godot-code-rules; Forward+ renderer; combat seams exist
  (godot-shooter-enemy-combat, godot-travelling-projectile-3d).
- `## Project conventions`: effect scenes in entities/vfx/<name>.tscn; PascalCase nodes; freed
  one-shots reparent under a surviving VfxRoot before owner queue_free() (audio pattern); no autoload.
- `## Steps`: (1) vfx_base.tscn + VfxOneShot.gd (one_shot/explosiveness/finished→queue_free,
  local_coords); (2) thin router component mapping fired/hit/died → effect scene `_spawn_vfx()`;
  (3) muzzle flash off `fired` (reuse MuzzleFlash OmniLight3D, shadowless pulse); (4) generic impact
  burst off projectile `hit`; (5) MeshInstance3D scale-tween shockwave alt; perf budget inline.
- `## Verification checklist`: burst fires once on shot/hit, node frees after lifetime (no leak in
  remote tree), flash casts no shadow, runs in Forward+, validate.sh passes.
- `## Error → Fix`: invisible (no draw-pass mesh) · never frees (one_shot off / finished not
  connected) · burst on wrong spot (local_coords) · trail empty (Compatibility renderer) · re-trigger
  needs restart() before emitting.
- Attribution: `Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.`

## Eval copy

No eval copy made (candidate read directly from cache; recommend-only run, no .claude write).
