---
name: godot-mesh-import-hd
agents: [asset-advisor, godot-assets]
domain: style-hd
description: The standard-HD surface delta for a sourced .glb prop in Godot 4.6 Forward+ — layered on the neutral godot-mesh-import base, which owns place/import, scale, nested-instance, greybox swap, auto-collision and Make-Unique. This skill adds ONLY the HD look: full PBR (albedo/metallic/roughness/normal/AO, or ORM-packed) on a StandardMaterial3D / ORMMaterial3D, LINEAR filter + mipmaps ON, per-map colour space, normal-map invert-Y, and a stylized-flat bias so the muted palette stays dominant — judged through the first-person eye-camera, NOT a SubViewport downscale. Use whenever a sourced HD .glb replaces a greybox box in an HD game, a prop must shade with real PBR maps, or an HD prop renders blurry/aliased/inside-out/black. For the structural import mechanics see godot-mesh-import; for the pixel-art surface see godot-mesh-import-pixel-art; for tiling an HD wall texture see godot-hd-material-import.
---

Discrete HD prop (furniture, item, set dressing) = **sourced standard-HD `.glb` instanced in place of a greybox box** (per `godot-mesh-import`), shaded with real PBR maps. This skill is the **HD surface delta**: the structural workflow (place/import, scale, nested-instance, auto-collision, Make-Unique, Advanced-Import skip/extract) is owned by `godot-mesh-import`; this skill changes only the base's **Step-2 surface material** to LINEAR filter + mipmaps ON + full PBR `StandardMaterial3D`, biased stylized-flat so the muted palette stays dominant. Judge the result in the **F5 first-person camera**, not the editor viewport, and NOT through any SubViewport downscale (this game retired it).

## Requirements

- `godot-mesh-import` — the structural base. Follow ALL of its Steps (place/import, Advanced-Import skip/extract, Make-Unique, near-uniform scale, nested-instance, 1:1 greybox swap + auto-collision, verify) unchanged. This skill overrides only the surface material applied at its **Step 2**, and treats "flat/vertex-coloured = no texture" as not applying — HD sourced props ship real maps.
- `godot-first-person-controller` — judge HD assets through the active first-person eye-camera (F5), not the SubViewport rig.
- `godot-pixel-lighting` — owns the FPS light rig (Filmic + fixed exposure + hard sun + sky/color ambient); HD PBR surfaces react to it. Do NOT add auto-exposure / ACES / AgX.
- `godot-verify` — mandatory 3-layer check after wiring.
- Art-direction defaults (`design/art-direction.md`): stylized-PBR, muted palette via `tools/art_style.gd`.

## Project conventions

- Source at `assets/models/<name>.glb` (snake_case, glTF-binary, self-contained; `assets/` gitignored). A model's own textures, if extracted, go in `assets/textures/<name>.png`.
- Forward+ renderer (required by outline shaders) — HD PBR + mipmaps assume it.
- **One build path:** if greybox was placed by a builder (`tools/build_*.gd`), extend that builder — don't fork a second importer.

## Step 2 delta — full PBR StandardMaterial3D (replaces the base's Step-2 material seam)

Run `godot-mesh-import` Step 2 to Make the mesh + surface material Unique, then wire the HD material below (do not flatten to albedo — HD sourced props ship a map set):

1. Material type:
   - **Separate maps** → `StandardMaterial3D`. Wire each map the source ships: albedo, metallic, roughness, normal, AO, (emission if present).
   - **Channel-packed (one texture = AO+Rough+Metal)** → `ORMMaterial3D`; assign the single ORM texture to its ORM slot.
2. **Filter + mipmaps (the HD inversion of the pixel-art rule):** set `texture_filter` to **LINEAR with mipmaps** (`= 5` / TEXTURE_FILTER_LINEAR_WITH_MIPMAPS). On import, the source textures' Import dock: **Filter = On**, **Mipmaps > Generate = On**. First-person stands at grazing angles against surfaces — NEAREST aliases HD detail and mipmaps off shimmer at distance.
3. **Colour space (PBR correctness):** albedo = sRGB; **normal / roughness / metallic / AO = non-color (linear)**. A roughness map read as sRGB shades wrong. Set per-texture in the Import dock (sRGB → Disable for non-albedo).
4. **Normal-map handedness (the S3 trap):** if lit bumps read as dents (inside-out lighting), the source is DirectX-style → **invert Y**: Advanced Import → Normal Map = Flip Y, or flip the green channel before import. A "smooth map" = inverted roughness → invert before assigning to roughness.
5. **Stylized-flat bias (keep the palette dominant):** push **roughness high**, **metallic low**, **normals mild** (`normal_scale` down). Map sourced albedo toward the nearest `tools/art_style.gd` swatch family (concrete → CONCRETE*\*, steel → STEEL*\_, rust → RUST\_\_, wood → WOOD\_\*); keep within `SATURATION_CEILING = 0.50`, value `[0.16, 0.90]`. When a sourced albedo is louder/glossier than the palette, dial roughness up / metal down — don't admit a new bright hue. NOT photoreal, NOT flat-toon.

For the deeper HD texture-import mechanics (per-map colour-space table, ORM packing, a headless `.tres`-authoring helper), see the surface sibling `godot-hd-material-import`. Everything else — scale, nesting, greybox swap, collision, verify — is `godot-mesh-import` verbatim.

## HD-6. Verify (FPS, not SubViewport)

```bash
tools/validate.sh
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/<level>.tscn main.tscn
```

F5: prop renders as a PBR model (not a flat box), correct real-world size, sits on floor, shades muted-industrial under the FPS sun — reads at first-person grazing distance without aliasing or shimmer. NOT judged through a SubViewport downscale.

## Verification checklist

- [ ] Structural steps followed from `godot-mesh-import` (near-uniform scale, base on floor, name+position kept, nested instance, collider Made Unique)
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
| HD surface aliases / stair-steps up close          | Step-2.2 — set `texture_filter` LINEAR-with-mipmaps (not NEAREST)                                                        |
| Surface shimmers / sparkles at distance or oblique | Step-2.2 — Mipmaps > Generate = On for the source textures                                                               |
| Lit bumps read as dents (inside-out)               | Step-2.4 — normal map is DirectX-style → Flip Y / invert green channel                                                   |
| Surface too smooth / too rough / wrong shine       | Step-2.3 — roughness/metallic map read as sRGB; set non-color (sRGB Off)                                                 |
| Prop too glossy / breaks muted palette             | Step-2.5 — push roughness up, metallic down; dial albedo toward an `art_style.gd` swatch                                 |
| Map slot has no effect                             | Material is `ORMMaterial3D` but maps wired separately (or vice-versa) — match material type to how the source packs maps |
| Prop giant/speck/floats/crushed                    | Structural — see `godot-mesh-import` Step 3 (near-uniform scale, base to y 0)                                            |
| Editing one collider changed all copies            | Structural — Make Unique the shape (see `godot-mesh-import` Step 5)                                                      |
| Re-import doesn't change prop                      | Made-local — must be nested instance (`godot-mesh-import` Step 4)                                                        |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
