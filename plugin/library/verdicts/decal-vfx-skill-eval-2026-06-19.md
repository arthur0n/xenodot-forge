# Decal VFX skill-gap evaluation — 2026-06-19

**Agent:** skill-researcher · **Mode:** recommend-only (board question filed, no skill written)

## Gap (as understood)

Pooled, surface-projected `Decal` VFX in Godot 4.6 Forward+. No `godot-*` skill owns it:
`godot-oneshot-vfx` is GPUParticles3D/MeshInstance3D fire-and-free only and its description
explicitly excludes decals. We already shipped an improvised rig:
`entities/vfx/scorch_decal_pool.gd` (8-slot round-robin, fade+recycle over 10s, Tween.kill
before reuse) + a placeholder scorch PNG from `tools/gen_textures.gd` imported with the
seamless-tileable template. A concurrent godot-dev task (t253) is adding collision-normal
plumbing + fixing the degenerate basis.

## Library candidates evaluated

Source: GodotPrompter (only registered source). No `decal`/`vfx-pool` skill exists.

- `particles-vfx` — GPUParticles only, no decals. Irrelevant to gap.
- `3d-essentials/references/decals.md` — the ONLY decal coverage. Useful **seed**, but buggy:
  classify per section below.

### 3d-essentials decals.md — section classification

- _useful_: the core idea "Decal projects along -Y; orient -Y to surface normal"; `size` Y =
  projection depth; `distance_fade_*`; the bullet-hole/scorch use-case.
- _conflicts / wrong_:
  - **No pooling** — spawns `Decal.new()` per hit + `create_timer(30).queue_free`. Anti-pattern
    for a clustered-budget resource and contradicts our pooled rig.
  - **Orientation bug**: `if hit_normal.abs() != Vector3.UP: look_at(...)` skips ALL non-vertical
    normals — exactly the wall case we need — and `look_at`/`looking_at` is still degenerate when
    the normal is parallel to the chosen up vector (±Z with `Vector3.FORWARD`, the bug in our
    `place()` line 45).
  - **Cost myth**: skill (and our `scorch_decal_pool.gd` header comment) say decals cost a
    "deferred pass". FALSE per 4.6 docs — see verified facts.
  - _irrelevant_: C# duplicate of every snippet (GDScript-only project).

Verdict on candidate: **adopt-a-subset by rewrite** — keep only the projection concept; drop
the spawn-per-hit lifecycle, fix the orientation, correct the cost model.

## Godot 4.6 Decal facts — verified against docs (not taken on faith)

Source: https://docs.godotengine.org/en/4.6/classes/class_decal.html +
.../tutorials/assets_pipeline/importing_images.html

- **Clustered, NOT deferred.** Doc verbatim: "Godot uses clustered decals, meaning they are
  stored in cluster data and drawn when the mesh is drawn, they are not drawn as a
  post-processing effect." → the "each Decal = one deferred pass" claim in our pool comment and
  in the library skill is WRONG. Correct cost model: each visible Decal is one **clustered
  element**, sharing the **512 clustered-element budget with lights + reflection probes**
  (Forward+). Pooling is still right (bounds the live count + avoids per-hit alloc/free churn),
  but justify it by the shared cluster budget + alloc churn, not a per-decal deferred pass.
- Textures auto-stored in a **texture atlas**; all decals drawn together.
- Forward+/Mobile only (Compatibility excluded). We are Forward+. OK.
- Properties (4.6 defaults): `albedo_mix=1.0`, `modulate=Color(1,1,1,1)`,
  `distance_fade_enabled=false` / `_begin=40.0` / `_length=10.0`, `upper_fade=0.3` /
  `lower_fade=0.3` (box-edge fade), `normal_fade=0.0` (>0 has a small perf cost). `texture_albedo`
  alpha = the projection mask.

### Decal texture import vs tileable surface texture — verified

- `process/premult_alpha` → **must stay FALSE**. Doc: premult requires a material with the
  Premul-Alpha blend mode (BaseMaterial3D or `render_mode blend_premul_alpha`). A `Decal` node
  exposes no blend-mode control → it cannot consume a premult texture correctly. (Currently FALSE
  — correct.)
- `process/fix_alpha_border` → **TRUE** (kills the white/dark fringe on alpha edges under
  filtering). Currently TRUE — correct.
- `mipmaps/generate` → **TRUE** for a decal (projected at varying distance → mipmaps stop
  shimmer; doc: "not grainy in the distance in 3D"). Currently **FALSE** (inherited from the
  pixel-art tileable template) → the one real import delta. Minor for a placeholder; matters for
  HD/final.
- `compress/mode=0` (Lossless) — fine; same as tileable default. Not a differentiator. VRAM
  compression would add artifacts in the alpha mask — keep Lossless for the placeholder.
- Filter NEAREST vs linear: a soft scorch wants linear, but filter is a material/project setting,
  not import — defer to the pixel-art-residue art decision (CLAUDE.md note), don't hardcode.

**Ownership of the import question:** belongs in the NEW decal skill, NOT
`godot-texture-import-pixel-art` (NEAREST/no-mip tileable contract) nor `godot-procedural-texture`
(generation only). Decal albedo-mask import is its own small contract.

## Orientation technique (skill documents this; dev owns the plumbing)

Degenerate-safe alignment of a Decal (-Y projection) to an arbitrary surface normal: pick the
basis-building helper that never collapses when the normal is parallel to a fixed up vector —
e.g. build the basis from the normal with a fallback secondary axis chosen by `abs(normal)`
component test, instead of a single hardcoded `Vector3.FORWARD`/`Vector3.UP` reference (the
`Basis.looking_at(-normal, Vector3.FORWARD)` in `place()` line 45 collapses on ±Z normals; the
library's `look_at(...)` collapses on the up-parallel case). Skill documents the technique only;
the projectile/collision-normal plumbing is godot-dev (t253), not the skill.

## Decision

**NEW skill — game-local first.** Recommend ADOPT.

- Real demand exists now (rig shipped + active fix task) → clears "modularize ON DEMAND only".
- No existing skill owns it; godot-oneshot-vfx boundary explicitly excludes decals.
- Captures 3 non-obvious, currently-wrong-in-our-code facts: clustered/512 cost model,
  degenerate-safe normal orientation, decal import contract.
- Duck-typing house style respected: NO @abstract contract, plain Node3D pool + duck-typed
  `place(pos, normal)` seam. (Parked: any abstract VFX-emitter base.)
- Starts game-local in `.claude/skills/godot-decal-vfx/`; promote to the framework plugin later
  only if a second project/use reuses it.

**Proposed name:** `godot-decal-vfx`
**Target path (foreground author after approval):**
`<game>/.claude/skills/godot-decal-vfx/SKILL.md`

### SKILL.md outline (template order)

- Frontmatter `name: godot-decal-vfx`; description with triggers: "scorch", "bullet hole",
  "blood splat", "decal on hit/impact", "pooled decal", "project texture on wall/floor",
  "decal flickers/leaks", "decal wrong orientation on a wall".
- Title + one para _why_: clustered budget → pool; -Y projection → orient to normal;
  fire-and-fade lifecycle distinct from godot-oneshot-vfx (which it must cite as the
  particles/mesh sibling).
- `## Requirements`: Forward+ renderer; godot-composition (router is a component, not autoload);
  godot-code-rules; the collision-normal seam (godot-shooter-enemy-combat / projectile) supplies the
  normal.
- `## Project conventions`: `entities/vfx/`, PascalCase nodes, scorch PNG path, decal import
  settings table (premult FALSE / fix_alpha_border TRUE / mipmaps TRUE / Lossless), pool size 8,
  fade 10s, routed off `hit`/`died` seams via a component (not autoload).
- `## Steps`: (1) import the albedo-mask texture; (2) build the fixed Decal pool (Node3D + N
  Decal children, alpha-0 hidden); (3) degenerate-safe `place(pos, normal)`; (4) fade tween with
  kill-before-reuse; (5) wire the router component to combat seams.
- `## Verification checklist`: scorch appears flat on floor AND on a vertical wall (no skew/no
  gap); 9th hit recycles slot 1 (no leak in remote tree); decal fades to nothing over ~10s; no
  "Signal already connected"; runs in Forward+ only.
- `## Error → Fix` table: decal invisible → Compatibility renderer / albedo alpha all-zero;
  decal skewed on wall → degenerate basis (±Z normal); white fringe on edges → fix_alpha_border
  off; shimmer at distance → mipmaps off; decals vanish past N → exceeded 512 cluster budget.
- Attribution: `Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT
License, Copyright (c) GodotPrompter Contributors.`

### Alternatives considered (rejected)

- Add to godot-oneshot-vfx — rejected: that skill's contract is particle/mesh fire-and-free; a
  pooled persistent clustered resource is a different lifecycle; merging muddies its boundary.
- Add import bits to godot-texture-import-pixel-art — rejected: different import contract
  (mipmaps + fix_alpha_border for a mask vs NEAREST/no-mip tileable).
- Nothing / document inline — rejected: 3 facts are already wrong in shipped code/comments; a
  one-real-use rig that's actively being bug-fixed is exactly the "on demand" trigger.

## Library tech parked (available if needed later)

- GodotPrompter `3d-essentials` full decals.md (normal-map decals, distance-fade tuning,
  texture_normal/orm channels) — not needed for the scorch placeholder.

## No eval copy made

Candidate read in-cache only; nothing copied into `.claude/skills/eval/`. Nothing to delete.
