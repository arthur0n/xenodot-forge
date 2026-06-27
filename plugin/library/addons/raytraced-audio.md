# Raytraced Audio — Wall Occlusion / Muffling / Reverb

**Request** — Evaluate the "Raytraced Audio" GDExtension addon (by Who Stole My Coffee, MIT) for automatic wall-occlusion/muffling/reverb via audio raycasts, to replace our naked-pass-through `AudioStreamPlayer3D` enemy-ambient audio.

**Verdict** — adopted `raytraced_audio` (recommended — conditional; see Why)

**Candidates**
| Addon | Source | License | Godot | Language | Last activity | Notes |
|---|---|---|---|---|---|---|
| Raytraced Audio | https://github.com/WhoStoleMyCoffee/raytraced-audio (Asset Library #4202) | MIT | 4.4 (tested; 4.6 minor bump, standard APIs only) | GDScript (100%) | 2026-06-09 | NOT a GDExtension — pure GDScript; no ABI concern |

**Why** — MIT, pure GDScript (no compiled binary, no ABI/platform risk), no autoload, strict-typed throughout. Asset Library lists 4.4; we run 4.6 — only standard `AudioServer` APIs used, minor version bump is safe for GDScript addons. Plugin adds two buses (`RaytracedReverb`, `RaytracedAmbient` both → Master) at plugin load: additive to our `SFX`/`Music` buses, no collision. Our `AudioOneShot.play_detached` uses flat `AudioStreamPlayer` (2D), never `AudioStreamPlayer3D` — the addon only intercepts `RaytracedAudioPlayer3D` nodes, so one-shot fire-and-free is unaffected. Per-frame raycast cost = `rays_count × (2 + n)` in `_process`: default rays=4, n=enemy count; at 5 enemies = 28 raycasts/frame — within budget for our arena scale. World already has `StaticBody3D` colliders for occlusion geometry. Active maintainer (26 commits, PR merged June 2026). The one caveat: enemy-ambient `AudioStreamPlayer3D` nodes must be swapped to `RaytracedAudioPlayer3D`; this is a targeted node-type swap, not a redesign.

**Install** — Adopt at commit `c73ae5d` (main, 2026-06-09); source https://github.com/WhoStoleMyCoffee/raytraced-audio/archive/c73ae5d.zip; target `addons/raytraced_audio/`; enable via Project Settings → Plugins → Raytraced Audio. godot-dev task: copy `addons/raytraced_audio/` into project, enable plugin, add one `RaytracedAudioListener` as child of the FPS eye-camera, swap enemy-ambient `AudioStreamPlayer3D` nodes to `RaytracedAudioPlayer3D`. Verify: sound muffles when enemy is behind a wall, two new buses appear in AudioServer, `AudioOneShot` one-shots unaffected.

**Later** — If rejected: native DIY fallback = raycast ear→source + lerp `AudioEffectFilter` low-pass by hit count — candidate for `godot-audio` skill extension (route to skill-researcher). Reverb/ambient two-bus split is also a richer model than our flat bus layout; worth noting as a future `godot-audio` skill evolution independent of this addon.
