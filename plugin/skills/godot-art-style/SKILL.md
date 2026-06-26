---
name: godot-art-style
agents: [art-director, godot-assets]
description: Single source of truth for a 3D-pixel-art game's palette + visual style language in Godot — a shared `tools/art_style.gd` const module of NAMED swatches and style scalars that the procedural generators (`gen_textures.gd`, `gen_models.gd`) `preload()` and read, so textures and models cohere by construction instead of drifting from hand-copied `Color()` literals. The GAME owns its swatches + scalars (its look); this skill is the pattern and the conventional location, never the palette. Use when placeholder art looks incoherent across textures/models, when the same colour is typed into more than one generator, before adding a new procedural texture/model spec, or when an art-director needs one place to set the look. NOT an asset-sourcing or import skill (that is asset-advisor / godot-mesh-import-pixel-art / godot-texture-import-pixel-art).
---

# Godot Art Style (one palette, one style language)

Procedural generators tend to each hard-code their own colours — `tools/gen_textures.gd` inlines
per-spec `PackedColorArray` palettes and `tools/gen_models.gd` declares its own
`const SOME_MATERIAL = Color(...)`. They cohere only because the numbers were hand-copied to
match; edit one and the other silently drifts, and there is nothing for the import skills or an
art-director to point at.

The fix is one shared, named source of truth: a `tools/art_style.gd` const module (named
swatches + a few style scalars) that **both** generators `preload()` and read by name. Then a
texture's "metal" and a model's "metal" are byte-identical by construction, adding a spec means
picking a named swatch (not eyeballing RGB), and the whole game's look has a single dial. This is
the backing config for the art-director flow: the art-director's direction maps onto these named
swatches/scalars, and the generator builder re-runs the unchanged generators.

> **Method vs facts.** This skill is the _pattern_ and the _conventional path_. The actual
> swatches and scalar values are the GAME's — each game authors its own `ArtStyle` for its genre
> (a sci-fi shooter's cool metals + emissive accents, a cozy sim's warm woods, …). The framework
> never ships a palette.

## Requirements

- `godot-procedural-texture` — `tools/gen_textures.gd` is one of the two consumers; it reads swatches instead of inline palettes.
- `godot-procedural-model` — `tools/gen_models.gd` is the other consumer; it reads swatches instead of local `const` colours.
- `godot-code-rules` — `tools/art_style.gd` is strict typed GDScript: file header, typed `const`s, no `Variant`.

## Project conventions — the conventional location

- **One module, one place: `res://tools/art_style.gd`**, `class_name ArtStyle`, a pure const
  container (no instance state). Both generators `preload("res://tools/art_style.gd")` and
  reference `ArtStyle.<SWATCH>`. This module IS the game's style home — everything about the look
  lives here, nowhere else. (Builder decision docs in `design/` are a separate thing — not style.)
- Swatches are `const … : Color`. Style scalars are typed `const`s. Names are descriptive
  material+value (e.g. `METAL_MID`, `ACCENT_EMISSIVE`), never hex.
- A generator must NOT introduce a new inline `Color(...)` literal for a material that has (or
  should have) a named swatch — add the swatch to `ArtStyle` first, then reference it. Genuinely
  one-off accent colours may stay local but should be rare.
- This is the placeholder/style source of truth; sourced/final art still goes through the
  asset-advisor loop, but should respect the same palette + style language.
- **Who touches it:** the art-director emits direction _as decisions about this module_ (which
  named swatches exist + their values, the scalars, how materials map onto them); the
  asset/generator builder (`godot-assets`) creates/edits `tools/art_style.gd` and the generators.
  This skill documents the pattern.

## Seeding the module (no baked palette)

Author `ArtStyle` for THIS game. Two ways in:

- **Existing project:** seed swatches from the colours already in the generators (extract the
  de-facto palette) so nothing changes visually on first adoption, then de-duplicate.
- **New game:** the art-director sets the palette for the genre; name swatches by material+value;
  pick a few style scalars (value range, saturation ceiling, ramp shades, texel density).

## Steps

1. Create `tools/art_style.gd` (illustrative shape — fill swatches for YOUR game):

   ```gdscript
   # tools/art_style.gd — single source of truth for the game's palette + style language.
   # Both procedural generators preload this; never re-type a swatch's Color elsewhere.
   class_name ArtStyle
   extends RefCounted

   # --- Swatches (named material+value, not hex) — author for YOUR game ---
   const METAL_DARK: Color = Color(0.20, 0.22, 0.26)
   const METAL_MID: Color = Color(0.40, 0.43, 0.48)
   const METAL_LIGHT: Color = Color(0.62, 0.66, 0.72)
   const ACCENT_EMISSIVE: Color = Color(0.20, 0.80, 0.90)
   # … add the swatches your materials need.

   # --- Style scalars (the look's dials) ---
   const VALUE_MIN: float = 0.16          # darkest a shade should go (keep silhouette readable)
   const VALUE_MAX: float = 0.90          # brightest (avoid blown highlights in the SubViewport)
   const SATURATION_CEILING: float = 0.55 # limited-palette feel; no neon
   const RAMP_SHADES: int = 3             # shades per material ramp (pixel-art banding)
   const TEXEL_DENSITY: int = 32          # px per metre for tileable surface textures
   ```

2. Refactor `tools/gen_models.gd`: delete its local colour `const`s, `preload("res://tools/art_style.gd")`, and replace each `Color(...)` with the matching `ArtStyle.<SWATCH>`.
3. Refactor `tools/gen_textures.gd`: replace inline per-spec `PackedColorArray` palette literals with arrays built from `ArtStyle` swatches; drive shade count off `ArtStyle.RAMP_SHADES` and tiling off `ArtStyle.TEXEL_DENSITY` where applicable.
4. Regenerate both: re-run the generators headless, then `$GODOT --headless --path . --import`.
5. Gate: `tools/validate.sh`, then `godot-verify` — the regenerated placeholders must render identically to before this refactor (same colours, now sourced from one place).

> Adding a new material later: add the swatch(es) to `ArtStyle` FIRST, then reference the name in the generator spec. Never re-type a `Color(...)` a second generator will also need.

## Style language (the look this palette serves)

- **Limited palette, value-led.** Materials read by VALUE contrast, not hue — keep saturation under `SATURATION_CEILING`. Silhouette and readability through the SubViewport downscale come first.
- **Banded ramps.** Each material is ~`RAMP_SHADES` discrete shades (dark → mid → light), not a smooth gradient — that is the pixel-art read.
- **Value range clamped.** Stay within `[VALUE_MIN, VALUE_MAX]`; nothing pure-black (kills silhouette) or pure-white (blows out under Filmic tonemap).
- **Consistent texel density.** Tileable surfaces author at `TEXEL_DENSITY` px/m so walls/floors share a pixel scale.

## Verification checklist

- [ ] `tools/art_style.gd` exists, is `class_name ArtStyle`, strict-typed, and `validate.sh` passes.
- [ ] Both generators `preload` it; neither contains an inline `Color(...)` for a material that has a named swatch.
- [ ] Regenerating both produces visually identical placeholders to before the refactor (the seed values match what was hand-copied).
- [ ] Changing one swatch in `ArtStyle` and regenerating changes that material in BOTH a texture and a model (single source of truth proven).
- [ ] No duplicated colour literal remains across the two generators (a swatch's `Color(...)` appears only in `art_style.gd`).

## Error → Fix

| Symptom                                              | Fix                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Texture and model versions of a material don't match | A generator still has an inline `Color(...)` — replace with the `ArtStyle.<SWATCH>`            |
| `class_name ArtStyle` collides                       | Name is project-unique; rename only if a real clash exists, update both `preload` references   |
| Placeholders changed appearance after the refactor   | A swatch was mistyped vs the seed — diff against the values you seeded from                    |
| Want to restyle the whole game                       | Edit `ArtStyle` swatches/scalars once + regenerate; do NOT touch the generators' logic         |
| New material needs a colour                          | Add the named swatch to `ArtStyle` first, then reference it — never inline it in the generator |

---

Framework skill — the game owns its swatches + scalars in `tools/art_style.gd`; this skill is the pattern, not the palette.
