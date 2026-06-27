---
name: godot-mesh-import-hd
agents: [asset-advisor, godot-assets]
description: Import, shade and wire a SOURCED standard-HD .glb prop in Godot 4.6 Forward+ as a discrete first-person prop — the HD sibling of godot-mesh-import-pixel-art, for stylized-PBR sourced finals (NOT NEAREST/flat pixel placeholders). Use whenever a sourced HD .glb arrives in assets/models/ for the greybox→asset swap, when a prop must shade with real PBR maps (albedo/metallic/roughness/normal/AO, ORM packed), when an imported HD model renders blurry/aliased/inside-out/black, when an HD normal map lights inside-out, or when deciding filter/mipmap/material settings for a sourced HD model. NOT the pixel-art placeholder path (that is godot-mesh-import-pixel-art, kept for gen_models output), NOT tiling a wall texture (godot-texture-import-pixel-art / its HD sibling).
---

Discrete HD prop (furniture, item, set dressing) = **sourced standard-HD `.glb` instanced in place of a greybox box**, shaded with real PBR maps. This is the HD sibling of `godot-mesh-import-pixel-art`: the **structural** workflow (place/import, scale, nested-instance, auto-collision, Make-Unique, Advanced-Import skip/extract) is **identical and OWNED THERE** — do not re-do it here. This skill only swaps in the HD **material / filter / mipmap / lighting** deltas: LINEAR filter + mipmaps ON + full PBR `StandardMaterial3D`, biased stylized-flat so the muted palette stays dominant. Judge the result in the **F5 first-person camera**, not the editor viewport, and NOT through any SubViewport downscale (this game retired it).

## Requirements

- `godot-mesh-import-pixel-art` — the structural authority. Follow its Steps 1, 1a, 3, 4, 5, 6 (place/import, Advanced-Import skip/extract, near-uniform scale, nested-instance decision, 1:1 greybox swap + auto-collision + Make-Unique, verify) UNCHANGED. This skill overrides ONLY its Step 2 (filtering) and its "flat/vertex-coloured = no texture" assumption.
- `godot-first-person-controller` — judge HD assets through the active first-person eye-camera (F5), not the SubViewport rig.
- `godot-pixel-lighting` — owns the FPS light rig (Filmic + fixed exposure + hard sun + sky/color ambient); HD PBR surfaces react to it. Do NOT add auto-exposure / ACES / AgX.
- `godot-verify` — mandatory 3-layer check after wiring.
- Art-direction defaults (`design/art-direction.md`): stylized-PBR, muted palette via `tools/art_style.gd`.

## Project conventions

- Source at `assets/models/<name>.glb` (snake_case, glTF-binary, self-contained; `assets/` gitignored). A model's own textures, if extracted, go in `assets/textures/<name>.png`.
- `.glb` imports as **PackedScene**; nest it under an owned node (per pixel-art Step 4). Never make-local a sourced prop.
- Forward+ renderer (required by outline shaders) — HD PBR + mipmaps assume it.
- **One build path:** if greybox was placed by a builder (`tools/build_*.gd`), extend that builder — don't fork a second importer.

## Steps

Run `godot-mesh-import-pixel-art` Steps 1, 1a, 3, 4, 5, 6 as written. Replace its **Step 2 (filtering)** with the HD material step below, and treat "flat/vertex-coloured no texture" as not applying — HD sourced props ship real maps.

**HD-2. Material — full PBR StandardMaterial3D (replaces pixel-art Step 2)**

HD sourced props ship a map set. Wire it; do not flatten to albedo.

1. Instance model → select `MeshInstance3D` → Mesh → **Make Unique** → Surface 0 → Material → **Make Unique** (shared `.glb` resource gotcha — same as pixel-art).
2. Material type:
   - **Separate maps** → `StandardMaterial3D`. Wire each map the source ships: albedo, metallic, roughness, normal, AO, (emission if present).
   - **Channel-packed (one texture = AO+Rough+Metal)** → `ORMMaterial3D`; assign the single ORM texture to its ORM slot.
3. **Filter + mipmaps (the HD inversion of the pixel-art rule):** set `texture_filter` to **LINEAR with mipmaps** (`= 5` / TEXTURE_FILTER_LINEAR_WITH_MIPMAPS). On import, the source textures' Import dock: **Filter = On**, **Mipmaps > Generate = On**. First-person stands at grazing angles against surfaces — NEAREST aliases HD detail and mipmaps off shimmer at distance.
4. **Colour space (PBR correctness):** albedo = sRGB; **normal / roughness / metallic / AO = non-color (linear)**. A roughness map read as sRGB shades wrong. Set per-texture in the Import dock (sRGB → Disable for non-albedo).
5. **Normal-map handedness (the S3 trap):** if lit bumps read as dents (inside-out lighting), the source is DirectX-style → **invert Y**: Advanced Import → Normal Map = Flip Y, or flip the green channel before import. A "smooth map" = inverted roughness → invert before assigning to roughness.
6. **Stylized-flat bias (keep the palette dominant):** push **roughness high**, **metallic low**, **normals mild** (`normal_scale` down). Map sourced albedo toward the nearest `tools/art_style.gd` swatch family (concrete → CONCRETE*\*, steel → STEEL*\_, rust → RUST\_\_, wood → WOOD\_\*); keep within `SATURATION_CEILING = 0.50`, value `[0.16, 0.90]`. When a sourced albedo is louder/glossier than the palette, dial roughness up / metal down — don't admit a new bright hue. NOT photoreal, NOT flat-toon.

**HD-6. Verify (FPS, not SubViewport)**

```bash
tools/validate.sh
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/<level>.tscn main.tscn
```

F5: prop renders as a PBR model (not a flat box), correct real-world size, sits on floor, shades muted-industrial under the FPS sun — reads at first-person grazing distance without aliasing or shimmer. NOT judged through a SubViewport downscale.

## Verification checklist

- [ ] `assets/models/<name>.glb` imported, no Output errors
- [ ] Structural steps followed from `godot-mesh-import-pixel-art` (near-uniform scale, base on floor, name+position kept, nested instance, collider Made Unique)
- [ ] Surface material Made Unique; full PBR — `StandardMaterial3D` (separate maps) or `ORMMaterial3D` (packed)
- [ ] `texture_filter` = LINEAR-with-mipmaps; source textures imported Filter On + Mipmaps Generate On
- [ ] Non-albedo maps (normal/rough/metal/AO) imported as non-color (sRGB Off)
- [ ] Normal map handedness correct (Flip Y if bumps read as dents)
- [ ] Stylized bias applied: roughness up, metal down, normals mild; albedo within palette value/saturation range
- [ ] Lighting unchanged (`godot-pixel-lighting` Filmic + fixed exposure; no auto-exposure / ACES / AgX)
- [ ] One build path (builder extended, not forked)
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`
- [ ] F5: PBR prop reads at first-person distance, no aliasing/shimmer, palette stays muted

## Error → Fix

| Symptom                                            | Fix                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| HD surface aliases / stair-steps up close          | HD-2.3 — set `texture_filter` LINEAR-with-mipmaps (not NEAREST)                                                          |
| Surface shimmers / sparkles at distance or oblique | HD-2.3 — Mipmaps > Generate = On for the source textures                                                                 |
| Lit bumps read as dents (inside-out)               | HD-2.5 — normal map is DirectX-style → Flip Y / invert green channel                                                     |
| Surface too smooth / too rough / wrong shine       | HD-2.4 — roughness/metallic map read as sRGB; set non-color (sRGB Off)                                                   |
| Prop too glossy / breaks muted palette             | HD-2.6 — push roughness up, metallic down; dial albedo toward an `art_style.gd` swatch                                   |
| Highlights bloom / blow out                        | Keep `godot-pixel-lighting` Filmic + fixed exposure; don't add auto-exposure                                             |
| Map slot has no effect                             | Material is `ORMMaterial3D` but maps wired separately (or vice-versa) — match material type to how the source packs maps |
| Prop giant/speck/floats/crushed                    | Structural — see `godot-mesh-import-pixel-art` Step 3 (near-uniform scale, base to y 0)                                  |
| Editing one collider changed all copies            | Structural — Make Unique the shape (see `godot-mesh-import-pixel-art`)                                                   |
| Re-import doesn't change prop                      | Made-local — must be nested instance (`godot-mesh-import-pixel-art` Step 4)                                              |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
