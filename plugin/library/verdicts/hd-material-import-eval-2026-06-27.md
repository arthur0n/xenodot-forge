# HD PBR material / texture-import skill — eval & verdict (2026-06-27)

**Status** ADOPTED 2026-06-27 → `plugin/skills/godot-hd-material-import/SKILL.md`

**Gap:** No skill owns HD sourced texture/material import. `godot-texture-import-pixel-art` assumes
NEAREST + no-mipmap (correct for placeholder `gen_textures.gd` output + UI/sprites). We now source
HD textures + PBR map sets and have NO canonical path for LINEAR + mipmaps + StandardMaterial3D PBR.
Art-direction call already made (`design/art-direction.md`): stylized-PBR, linear/mipmaps, full map
wiring, ORM pack, normal invert-Y, non-color space for non-albedo. Skill must encode that decision.

**Candidates evaluated (GodotPrompter cache):**

- `assets-pipeline` — import config (Compress/VRAM, Mipmaps, Filter, glTF). Covers the IMPORT half.
- `3d-essentials` (Materials section) — StandardMaterial3D vs ORMMaterial3D, PBR slots (albedo/
  metallic/roughness/normal/ao/emission), per-instance `.duplicate()`. Covers the MATERIAL half.

Together they cover the gap. Neither covers normal-map invert-Y or color-space (sRGB vs linear) —
those come from `art-direction.md` / transcript S3 and the draft adds them. Source is Inspector-prose
(no code, no `.tres`); draft rewrites to our strict-typed-GDScript + `.tres` + `uv1_scale` conventions.

---

## VERDICT: ADOPT — NEW sibling skill `godot-hd-material-import`

A new skill, NOT an extension of `godot-texture-import-pixel-art`. The two import paths CONTRADICT
each other on filter/mipmaps; merging would corrupt the pixel-art skill that still serves placeholder

- UI output. Additive sibling per the art-director brief. Adopt the slice that encodes the
  art-direction decision; park the rest (mobile VRAM, bent-normal hero pass, transparency modes) — all
  available in the library if needed later.

### Ownership (what THIS skill owns vs neighbours)

| Concern                                                                                                    | Owner                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| HD texture import settings (LINEAR filter, mipmaps ON, VRAM Compressed, sRGB vs non-color)                 | **godot-hd-material-import**                                                               |
| PBR material wiring (StandardMaterial3D slots, ORMMaterial3D channel-pack, normal invert-Y, stylized bias) | **godot-hd-material-import**                                                               |
| `uv1_scale` tiling density on a large surface using HD textures                                            | **godot-hd-material-import** (the HD material; tiling _placement_ shared w/ greybox/level) |
| NEAREST/no-mipmap placeholder + UI/sprite import                                                           | godot-texture-import-pixel-art (unchanged, survives)                                       |
| `.glb` mesh import / collider / nested-instance / make-local                                               | godot-mesh-import-pixel-art (HD mesh-import is a SEPARATE open gap, not this skill)        |
| Greybox→asset REPLACE flow                                                                                 | godot-greybox-to-asset (separate draft, separate gap)                                      |
| Lighting/tonemap/ambient tune for live PBR                                                                 | godot-pixel-lighting                                                                       |

---

## 6 buckets

1. **From the source/idea (the gap reaches for):** a canonical HD-texture/PBR-material import path so
   sourced finals shade correctly under Forward+ and stay inside the muted-industrial palette.

2. **From the candidate (what GodotPrompter offers):** import-settings table (Compress/VRAM, Mipmaps,
   Filter Linear, Repeat), the StandardMaterial3D-vs-ORMMaterial3D decision + PBR slot list,
   per-instance `.duplicate()`, the "3D textures: always mipmaps" rule. All Inspector-prose, no code,
   no color-space/invert-Y/stylized-bias.

3. **No-brainers (adopt as-is):** LINEAR filter + mipmaps ON for HD; VRAM Compressed for 3D albedo/
   normal; `StandardMaterial3D` default, `ORMMaterial3D` when channel-packed; "always mipmaps on 3D
   textures"; per-instance `.duplicate()` before mutating a shared material.

4. **Improvements (adopt + rework):** rewrite Inspector steps to strict-typed GDScript building a
   `StandardMaterial3D`/`ORMMaterial3D` in code (so a `.tres` material can be authored/saved and
   reused). ADD what the candidate lacks: color-space (sRGB albedo/emission, non-color for normal/
   roughness/metallic/AO), normal-map invert-Y trap, the stylized-middle bias (roughness↑ metal↓
   normal-mild, albedo dialled toward `ArtStyle` swatch), `uv1_scale` density-match for tiling
   surfaces, opaque surface materials.

5. **Not now — SYSTEM park (Later):** HD mesh-import sibling skill (glTF Advanced-Import / nested-vs-
   make-local / collider) is a SEPARATE gap (transcript S3+S4 #7/#10/#11) — route on its own.
   Bent-normal hero pass (Godot 4.5+), per-material texel-density audit (lock one density family once
   ≥2 HD surfaces ship), `ArtStyle` gaining PBR scalar defaults (roughness floor / metal ceiling).

6. **Definitely skip:** mobile VRAM tuning, transparency-mode matrix (Alpha/Hash/Scissor — opaque
   surfaces only here), 2D pixel-art project-wide filter setup (owned by the pixel-art skill),
   `.blend`/FBX/Collada format notes (we standardize on `.glb`).

---

## Decision next (godot-dev, on adopt)

"Source one HD wall/floor texture set + author its PBR `StandardMaterial3D`/`ORMMaterial3D` using the
new `godot-hd-material-import` skill; verify it reads in the muted palette under Forward+ + Filmic."
Also: CLAUDE.md art rows (lines 27–28, large-surface row) point sourced textures at this skill.

Draft SKILL.md: `library/verdicts/godot-hd-material-import.SKILL-draft.md`
