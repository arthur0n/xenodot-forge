# Raytraced Audio in Godot (Game From Scratch) — transcript digest

**Source** — `godot-raytrace-audio-plugin.md` (now in `transcripts/archive/`). Game From Scratch walkthrough of the third-party **"Raytraced Audio"** GDExtension plugin by _Who Stole My Coffee?_ — MIT, on GitHub + Godot Asset Library.
**Why harvested** — we are about to build RAYTRACE / spatial audio (immersive occluded enemy audio) over our existing `AudioStreamPlayer3D` enemy-ambient setup.

**Key fact up front: this is an ADDON, not a technique.** The whole video is "install a GDExtension and wire its nodes." It teaches no DIY occlusion algorithm — the raytracing is a black box inside the C++ plugin. So the primary decision is an **addon-researcher gate**, not a skill gap.

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Raytraced Audio = a third-party **GDExtension addon** (clone repo or Asset Library → drop `add-ons/` → enable in Project Settings → Plugins). | holds with caveat — GDExtension = compiled native; must match Godot 4.6 + our platform/export targets; MIT but external code in the tree. | gap — we ship native-only audio; no GDExtension addon vetted. | nothing covers it → **addon-researcher** territory | Addon-gate |
| 2 | Add one **RaytracedAudioListener** node under the active camera = "the ear"; this is where the raytracing logic runs (≥1 required). | holds — attaches to our first-person eye-camera (`godot-first-person-controller`); replaces native AudioListener3D role. | gap | new node type from the addon | Addon-gate |
| 3 | Replace each `AudioStreamPlayer3D` source with the addon's **RaytracedAudioPlayer** (stream + autoplay, same positional-audio mental model). | holds with caveat — would swap our enemy-ambient `AudioStreamPlayer3D` for the addon node; our fire-and-free / despawn-reparent pattern (`AudioOneShot`) would need re-validation against the addon node's API. | partial — `godot-audio` owns the native-source pattern; addon node is the unverified substitute. | `godot-audio` (native) vs addon node | Addon-gate |
| 4 | Occlusion/muffling is automatic: rays cast from ear → source through world **colliders** (StaticBody3D + CollisionShape) muffle + occlude sound behind walls. Needs collision geometry, not just visuals. | holds — our greybox/arena walls already carry StaticBody3D colliders (`godot-greybox`), so the world is ready. | gap — we have NO occlusion today; sound passes through walls. | the actual feature we want; depends on collider coverage | Addon-gate (this is the payoff) |
| 5 | Listener exposes per-effect toggles **muffling / echoing / ambient**; two buses — **reverb** (large enclosed rooms) + **ambient** (strength/pan of outside sound). | holds with caveat — bus model is addon-internal, parallel to our `Master→SFX/Music` `default_bus_layout.tres`; integration with our buses unverified. | partial — we own a bus layout; addon's reverb/ambient buses are separate. | `default_bus_layout.tres` vs addon buses | Addon-gate |
| 6 | Loop ambient/music streams via Import → Loop Mode = Forward; positional sources autoplay. | holds | covered — `godot-audio` already states loop-on for music, loop-off for SFX. | `godot-audio` | Covered (no action) |
| 7 | A character-controller addon + editable-children camera setup (video's scaffolding). | out of scope | covered — we have `godot-first-person-controller`; ignore the video's add-on controller. | — | Skip |

**Verdict (on top of the buckets):** the feature (occlusion-aware enemy audio) is real and currently a genuine gap, but it arrives as a **compiled GDExtension** — so this is an **addon-researcher evaluation with the addon gate**, not a skill-researcher harvest. Recommend dispatching addon-researcher ONLY if raytraced occlusion is in-scope for the current iteration; otherwise park.

**Recommended next** (bucket 3/4 — act on now, if in scope):

- **addon-researcher** (addon gate) — evaluate the _Raytraced Audio_ GDExtension by _Who Stole My Coffee?_: Godot 4.6 + Forward+ + our export-target ABI compatibility, MIT-license fit, perf cost of per-frame audio raycasts, and whether the **RaytracedAudioPlayer** node coexists with our `AudioOneShot` fire-and-free / despawn-reparent pattern and `default_bus_layout.tres`. Verdict feeds the human adopt decision. [Points 1–5]

**Later** (bucket 5 — valid, parked; framework/system):

- DIY fallback if the addon fails the gate: a native occlusion approximation (raycast ear→source, lerp a low-pass `AudioEffectFilter` / volume by hit count) is a candidate **godot-audio skill extension** — route to **skill-researcher** only if the addon is rejected and occlusion is still wanted. NOT game-specific build work.
- The reverb/ambient two-bus split (large-room reverb + outside-pan ambient) is a richer bus model than our flat `Master→SFX/Music`; note as a possible `godot-audio` evolution, independent of this addon.
