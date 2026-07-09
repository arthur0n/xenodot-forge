---
type: source-list
title: "Model Sources — free low-poly / CC0 3D models (interim sourcing loop)"
description: "adopt the web-link + human-in-the-loop loop below as the interim"
timestamp: 2026-06-15T22:28:18+01:00
---

# Model Sources — free low-poly / CC0 3D models (interim sourcing loop)

**Request** — 3D props the agent pipeline can't author itself: discrete furniture and
items (bed, wardrobe, nightstand, chair, desk, kitchen/bath fixtures, set dressing).
A discrete prop is a **sourced low-poly `.glb` model instanced in place of its greybox
box** — NOT a texture wrapped on a `BoxMesh` (see the art-kind router in `CLAUDE.md` →
Project conventions, and skill `godot-mesh-import-pixel-art`). The SubViewport downscale
pipeline + orthographic camera already make a clean low-poly mesh read as 3D pixel art.

**Verdict** — adopt the **web-link + human-in-the-loop loop** below as the interim
solution: the model analogue of `asset-sources.md` (which covers texture _generators_).
Explicitly a prototype path — okay quality, fast, "any low-poly that fits works." Models
arrive at `assets/models/<name>.glb`. **Authoring bespoke props in Blender is `parked`**
(see bottom) until sourcing quality/consistency becomes the bottleneck.

This is the framework's answer when a task is **blocked on a missing 3D prop** — the model
analogue of `addon-researcher` for missing systems. The **asset-advisor** agent drives it:
gate 1 writes the search + format/scale spec; gate 2 verifies the downloaded `.glb`.
Surfaced in the web UI under the **Get Assets** tab; the loop also lives in `CLAUDE.md` →
"Sourcing art assets".

## The loop

1. Open **Get Assets** (the 🎨 button in the composer). It lists any open `Asset: <name>`
   requests the orchestrator filed (each with a tailored brief) alongside the sources below.
   No open request? Use the ad-hoc upload (name it yourself).
2. Find a fitting low-poly model on a source below, download the **`.glb`**, then **upload
   it in the modal** — the forge server routes by file type and writes a model to
   `assets/models/<name>.glb` (snake_case). The upload asks the orchestrator to run
   **asset-advisor** (gate 2), which verifies the model and, on PASS, dispatches the wiring
   to godot-dev (on FAIL it returns the reasons + a corrected spec to re-source).
3. Wire it (a godot-dev task — auto-dispatched on upload, not done by the orchestrator) per
   skill **`godot-mesh-import-pixel-art`**: import, NEAREST + Make-Unique only if the model
   carries a texture, **scale to the greybox footprint**, instance in place of the named
   greybox node (keep its name + position).
4. Run `godot-verify` (layers 1–3) — confirm it loads, is sized right, sits on the floor,
   and renders crisp at SubViewport scale.

## Sources

| Source               | URL                                                                                                       | Free / signup       | Output                                                                                               | Fit                                                                | Verdict                             |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Poly Pizza           | https://poly.pizza/                                                                                       | Free, **no login**  | **`.glb`** + FBX; thousands of low-poly props; CC0 & CC-BY (attribution shown per model); has an API | furniture, items, props — the everyday objects                     | adopt — **primary**                 |
| Kenney               | https://kenney.nl/assets                                                                                  | Free, **no signup** | `.glb`/`.gltf`/OBJ packs; **CC0**; curated, consistent game-ready style                              | whole prop sets (furniture, kitchen, etc.) with one matching style | adopt — primary (style consistency) |
| Quaternius           | https://quaternius.com/                                                                                   | Free, **no signup** | `.glb`/`.gltf`/FBX packs; **CC0**; low-poly, often rigged/animated                                   | nature, props, characters in packs                                 | adopt — primary                     |
| OpenGameArt (CC0 3D) | https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=10&field_art_licenses_tid%5B%5D=4929 | Free, no signup     | mixed (OBJ/FBX/Blend; some glTF) — **convert to `.glb` if needed**                                   | odd one-off props not in the packs                                 | adopt — fallback                    |
| Poly Haven           | https://polyhaven.com/models                                                                              | Free, no signup     | glTF/FBX/Blend; **CC0**; higher-detail props (decor, furniture)                                      | a hero prop that needs more detail                                 | adopt — fallback                    |

## Search patterns (copy-paste)

- **Furniture / item** — search the bare noun on **poly.pizza** ("wardrobe", "bed", "desk",
  "nightstand", "chair"), sort by low-poly, grab the `.glb`. For a whole room that should
  match, take one **Kenney** pack instead so every prop shares a style.
- **Style note** — prefer flat-material / vertex-coloured low-poly (no texture to filter);
  it reads cleanest through the downscale and needs no NEAREST step.
- **License** — CC0 = no attribution. CC-BY (some Poly Pizza models) = keep the author/URL
  in a credits note. asset-advisor records the licence at gate 2.

## Known gaps (don't over-promise)

- **Pixel-art-_styled_ 3D is rare.** Most free models are generic low-poly, not pixel-textured.
  For the prototype that's fine — the downscale supplies the pixel look; don't block on finding
  a "pixel" model.
- **Scale is never consistent across sources.** Every model imports at a different size — the
  scale-to-footprint step (base skill `godot-mesh-import`, Step 3) is mandatory, not optional.
- **`.gltf` (text) needs conversion.** The single-file upload accepts `.glb` only. Re-export or
  convert multi-file `.gltf` (+ `.bin` + textures) to a self-contained `.glb` first.
- **CC-BY attribution drifts.** Re-confirm a model's licence on its page before relying on it.

## Later — parked: authoring props in Blender (v2)

When sourced models stop fitting (a bespoke prop no catalogue has, or a need for one consistent
hand-made style across the whole game), author low-poly props yourself: model → Smart UV unwrap →
paint a low-res texture at a fixed texel density → export `.glb` (NEAREST on import). Trade-off:
real modelling skill + time vs. exact-fit, consistent, owned assets. Not worth it for the POC —
revisit when sourcing/clicking is the bottleneck. Verdict: `parked`. Promote to a fresh
`library/blender-prop-authoring.md` verdict + a skill-researcher follow-up when adopted.
