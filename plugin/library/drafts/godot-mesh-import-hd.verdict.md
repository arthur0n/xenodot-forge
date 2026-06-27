# Verdict — HD mesh-import skill

**GAP**: builders have no canonical workflow for importing/shading a sourced standard-HD `.glb`. Existing `godot-mesh-import-pixel-art` bakes NEAREST/flat + Requires the retired SubViewport rig.

**RECOMMEND: ADOPT a NEW thin sibling `godot-mesh-import-hd`** (not extend, not reject).

**Status** ADOPTED 2026-06-27 → `plugin/skills/godot-mesh-import-hd/SKILL.md`

## Key finding (drives the recommendation)

`godot-mesh-import-pixel-art` ALREADY owns the entire _structural_ workflow the gap named: nested-instance vs inherited vs make-local decision, glTF Advanced-Import (skip / override-vs-extract / embedded), auto-collision (`-col`/`-convcol` + headless box-from-AABB), Make-Unique on duplicated CollisionShape, near-uniform scale, 1:1 greybox swap. The ONLY thing wrong for HD is its **Step 2 (material/filter)**: NEAREST + `texture_filter=1` + "flat/vertex-coloured = no texture", and it `Requires godot-3d-pixelation`.

So the HD skill is NOT a re-do of structure. It DELEGATES structure to the pixel-art skill and OWNS only the HD deltas → stays thin, avoids drift, honours art-director "additive new sibling, don't touch pixel-art skill".

## Candidates evaluated (GodotPrompter, MIT — only library source)

- `assets-pipeline` — general import reference. Confirms import-dock mechanics (glTF, mipmaps, VRAM compress, collision suffixes, Advanced-Import). Broad, multi-format, C# variants, audio/resource sections = irrelevant. No greybox→asset swap, no nested-instance decision, no stylized-PBR bias. Not adoptable wholesale.
- `3d-essentials` — confirms StandardMaterial3D/ORMMaterial3D PBR map list + `.duplicate()` per-instance. Mostly lighting/GI. Reference only.

Neither owns the project workflow. The load-bearing specifics come from the TRANSCRIPT (S3/S4) + `design/art-direction.md`. Draft is rewritten from those, briefed with the art-director HD defaults.

## 6 buckets

1. **From the source/idea** — HD greybox→asset push needs a canonical sourced-`.glb` import+shade workflow: glTF Advanced-Import, nested-instance, auto-collision, Make-Unique, full PBR with LINEAR/mipmaps/stylized bias.
2. **From the candidate** — `assets-pipeline`/`3d-essentials` give import-dock mechanics + PBR map list + ORM + collision suffixes as raw reference; no project workflow, no swap order, no stylized bias.
3. **No-brainers (adopt as-is)** — the HD material/filter deltas (LINEAR+mipmaps, full PBR StandardMaterial3D/ORM, non-color space for non-albedo, normal Flip-Y trap, stylized roughness-up/metal-down bias, judge in F5 FPS camera). All map 1:1 to art-direction.md decisions already made.
4. **Improvements (adopt but reworked)** — DELEGATE structure to `godot-mesh-import-pixel-art` instead of duplicating (override its Step 2 only); swap its `Requires godot-3d-pixelation` for `godot-first-person-controller` + `godot-pixel-lighting`; tie albedo to `tools/art_style.gd` swatches.
5. **Not now — SYSTEM park (framework)** — (a) sibling HD **texture-import** skill for tileable walls/floors (`uv1_scale` density match) — same convention-conflict, art-direction.md row 66 names it; (b) `godot-greybox-to-asset` MIGRATION skill (swap order, lock+magenta-hide greybox while swapping, decorate-last) — transcript S5, owns the REPLACE half `godot-greybox` lacks; (c) import name-suffix automation / import scripts (transcript #12). All framework-level, route to Later.
6. **Definitely skip** — `assets-pipeline` audio/resource-format/threaded-load sections, all C# variants, VRAM-compress-for-mobile, CSG greyboxing.

## What the new skill OWNS vs existing skills

- OWNS: HD material/filter/mipmap/colour-space/normal-handedness/stylized-bias deltas for a sourced HD `.glb` prop; judging through the FPS camera.
- DELEGATES (does not duplicate): nested-instance + Advanced-Import + auto-collision + Make-Unique + scale + 1:1 swap → `godot-mesh-import-pixel-art`.
- NOT: pixel-art placeholder props (pixel-art skill, kept for gen_models); tileable wall/floor textures (texture-import + its future HD sibling); greybox blockout authoring (`godot-greybox`); greybox→asset migration order (parked); animation import (`godot-animation-libraries`); light rig (`godot-pixel-lighting`).

## CLAUDE.md additions on adopt

- "## Skills" list: one line for `godot-mesh-import-hd`.
- Art-import rows (per art-direction.md §"CLAUDE.md change recommended"): point the _sourced_ discrete-prop row at `godot-mesh-import-hd`; leave `gen_models.gd` placeholder on the pixel-art skill. (orchestrator/godot-dev makes that edit — not me.)

Draft: `library/drafts/godot-mesh-import-hd.SKILL.md` → target `.claude/skills/godot-mesh-import-hd/SKILL.md`.
