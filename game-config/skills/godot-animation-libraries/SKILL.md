---
name: godot-animation-libraries
description: Import and play skeletal animations on a sourced 3D character in Godot 4.6 — the separate-glTF workflow (one model file + anim-only files), merging anim clips into an AnimationLibrary loaded onto your own AnimationPlayer, and retargeting a foreign animation (e.g. Mixamo) onto your skeleton via SkeletonProfileHumanoid. Use when an animated rigged .glb arrives in assets/models/, when a character must stop being a static capsule and play a looping idle/walk, when animations come in their own glTF separate from the model, when a sourced animation targets a different skeleton than your character, or when an imported AnimationPlayer's clips won't play / play on the wrong bones. NOT for static-prop import (that is godot-mesh-import-pixel-art), NOT for shader-time foliage sway (godot-foliage), NOT for 2D sprite-frame animation.
---

# Animation libraries for a sourced 3D character

An animated character in this project is a **sourced rigged `.glb` (skeleton + skinned mesh) whose animation clips live in separate anim-only glTF files, merged into one `AnimationLibrary` that you load onto an `AnimationPlayer` on a node you own**. We keep model and animations apart on purpose: re-sourcing the mesh, or adding a new clip pack (idle, walk, wave), is then a one-file swap that never disturbs the other side — the same "swappable visual child" shape as `godot-mesh-import-pixel-art`. When a sourced clip was authored for a _different_ skeleton (Mixamo, Quaternius, any free pack), retargeting through `SkeletonProfileHumanoid` remaps it onto your rig at import so it plays without rebuilding the animation by hand. This is Phase 8 on the roadmap (`docs/roadmap/first_game.md`): gate = an animated character playing a looping idle from a separate animation file.

## Requirements

- `godot-mesh-import-pixel-art` — the authority on importing/scaling/nesting a sourced `.glb` and the Make-Unique gotcha. This skill _extends_ it for the rigged case: import + scale + nest the **model** exactly as that skill says, then add the animation layer here. Do not restate its import/scale/scene-structure rules.
- `godot-3d-pixelation` — judge animation in F5 at SubViewport scale, not the editor viewport. Foot-sliding, wrong-bone retargets, and scale errors are obvious low-res, invisible at full res.
- `godot-composition` — the character is an engine-node base (`CharacterBody3D`) with the model and `AnimationPlayer` as children you own; gameplay drives animation by _calling down_ (`anim_player.play(...)`), animation signals _up_ (`animation_finished`). The `AnimationPlayer` is a component child, never a base class.
- `godot-code-rules` — any `.gd` that drives playback is strict typed GDScript; gate with `tools/validate.sh`.
- `godot-verify` — mandatory 3-layer check after wiring.

## Project conventions

- The character model and each animation pack are glTF-binary in `assets/models/` (snake_case, `assets/` gitignored): `assets/models/<char>.glb` (skeleton + skinned mesh, no clips), `assets/models/<char>_idle.glb`, `assets/models/<char>_walk.glb`, … (anim-only — skeleton + animation, no skin needed). Sourced via the **asset-advisor / asset-sourcing loop**; `library/sources/model-sources.md` is the free-model catalogue. A single `.glb` that already carries both rig and clips is fine too — split via Advanced Import (Step 2) instead of separate files.
- Saved `AnimationLibrary` resources live in `resources/animations/<char>.tres` (our `.tres` home). The model and anim `.glb` files stay in `assets/`; the merged library you load at runtime is a project resource.
- The character is a **nested instance** under a `CharacterBody3D` you own (per `godot-mesh-import-pixel-art` Step 4 / `godot-composition`) — NOT made-local, NOT an inherited scene. The `AnimationPlayer` is a child of _that_ node, animating the nested model's `Skeleton3D`.
- One canonical retarget profile: `SkeletonProfileHumanoid` for any humanoid sourced animation. Non-humanoid rigs (quadrupeds, machines) skip retargeting and require matching bone names at source.
- No AnimationTree yet — this slice covers AnimationPlayer + AnimationLibrary + retargeting only. Blend trees / state machines / IK / spring bones are out of scope until a design doc names them (the patterns exist in the GodotPrompter `animation-system` collection if needed later).

## Steps

**1. Import and nest the model (delegate to godot-mesh-import-pixel-art)**

Drop `assets/models/<char>.glb`, let Godot import it, scale it to footprint, and nest the model PackedScene under a `CharacterBody3D` you own. Confirm the imported scene contains a `Skeleton3D` (the rig) and a `MeshInstance3D` skinned to it. If the model `.glb` also ships an `AnimationPlayer` with clips you want to keep, skip step 3 and use those clips directly; otherwise its `AnimationPlayer` (if any) can be empty.

**2. Split clips inside one glTF — only if anims are NOT in separate files**

If a single `.glb` carries one long timeline with several motions, split it at import instead of sourcing separate files:

1. Double-click the `.glb` in FileSystem → **Advanced Import Settings**.
2. **Animations** tab → add a clip per motion with **start frame** / **end frame**.
3. Set **loop mode** per clip: **Linear** for idle/walk/run, **None** for one-shots (wave, attack, hit). The `-loop` source-name suffix does the same at export time.
4. Re-import. The clips now exist as named animations in the imported scene's `AnimationPlayer`.

Prefer separate anim-only files (one motion per `.glb`) — they re-source cleanly. Use the split path only when the source already bundles everything.

**3. Build one AnimationLibrary from the separate anim-only glTFs**

Each anim-only `.glb` imports as a scene whose `AnimationPlayer` holds that motion. Pull the clips out and merge them into one `AnimationLibrary` you save to `resources/animations/`. Do this once with an author-time `@tool` script (the one build path — don't hand-rebuild it), then load the saved `.tres` at runtime:

```gdscript
@tool
extends EditorScript
## tools/build_<char>_anim_library.gd — merge anim-only glTFs into one AnimationLibrary.
## Run from the editor: File > Run. Author-time only; not shipped game code.

const ANIM_GLBS: Dictionary = {
	"idle": "res://assets/models/<char>_idle.glb",
	"walk": "res://assets/models/<char>_walk.glb",
}
const OUT_PATH: String = "res://resources/animations/<char>.tres"


func _run() -> void:
	var library := AnimationLibrary.new()
	for clip_name: String in ANIM_GLBS:
		var packed: PackedScene = load(ANIM_GLBS[clip_name])
		var scene: Node = packed.instantiate()
		var player: AnimationPlayer = scene.find_child("AnimationPlayer", true, false)
		if player == null:
			push_error("No AnimationPlayer in %s" % ANIM_GLBS[clip_name])
			scene.free()
			continue
		# An anim-only glTF usually exposes its motion as a single clip named "Animation".
		var source_lib: AnimationLibrary = player.get_animation_library("")
		var first: StringName = source_lib.get_animation_list()[0]
		var clip: Animation = source_lib.get_animation(first).duplicate(true)
		library.add_animation(StringName(clip_name), clip)
		scene.free()
	var err := ResourceSaver.save(library, OUT_PATH)
	if err != OK:
		push_error("Save failed: %d" % err)
	else:
		print("VERIFY: wrote %s with %s" % [OUT_PATH, library.get_animation_list()])
```

This gives you `resources/animations/<char>.tres` whose clips are named `idle`, `walk`, … (not the raw glTF clip names).

**4. Load the library onto your own AnimationPlayer**

Add an `AnimationPlayer` as a child of the `CharacterBody3D` (a node you own — not the imported model's player), then load the merged library and bind its `root_node` to the nested model so its tracks reach the `Skeleton3D`:

```gdscript
extends CharacterBody3D
## entities/<char>/<char>.gd — drives the character's animation.

@export var anim_library: AnimationLibrary  # assign resources/animations/<char>.tres in the Inspector
@onready var _anim: AnimationPlayer = $AnimationPlayer
@onready var _model: Node3D = $Model  # the nested .glb instance


func _ready() -> void:
	if anim_library != null:
		_anim.add_animation_library("", anim_library)
	# Tracks address the skeleton relative to the player; point root at the model.
	_anim.root_node = _anim.get_path_to(_model)
	_anim.play("idle")


func _physics_process(_delta: float) -> void:
	var moving := velocity.length() > 0.1
	var wanted := "walk" if moving else "idle"
	if _anim.current_animation != wanted:
		_anim.play(wanted)
```

`play()` with the already-playing clip is a no-op, so the `current_animation` guard prevents a per-frame reset of non-looping clips. Calls go _down_ (gameplay → `play`); for follow-up on one-shots connect `animation_finished` (signal _up_) rather than polling.

**5. Retarget a foreign animation onto your skeleton (Mixamo / mismatched rig)**

When a sourced clip was authored for a different skeleton than your character's, its tracks name bones your rig doesn't have, so it won't play. Retarget at import so the tracks address generic profile bones instead:

1. Select the anim-only `.glb` in FileSystem → Import dock (or double-click → **Advanced Import Settings**).
2. Under **Animation**, enable **Retarget** and assign a `SkeletonProfile` — use **`SkeletonProfileHumanoid`** for any humanoid.
3. In the bone map, map the source skeleton's bones onto the profile's generic names (Hips, Spine, LeftUpperArm, …). Mixamo's `mixamorig:` bones map cleanly to the humanoid profile.
4. Re-import. The clip's tracks now target the profile's generic bone names.
5. Ensure your **character** model imports against the **same** `SkeletonProfileHumanoid` (same Import-dock step on `<char>.glb`). Both sides speaking the profile is what lets a foreign clip drive your rig.

After retargeting, the anim-only `.glb` feeds Step 3's library builder exactly like a native clip.

**6. Verify**

```bash
tools/validate.sh                                                            # the playback .gd is typed
$GODOT --headless --path . --script tools/verify_scene.gd -- entities/<char>/<char>.tscn main.tscn
```

Then F5 with the character in a level: the mesh deforms (not a rigid T-pose), the looping idle plays on loop with no snap at the loop point, switching to `walk` blends/cuts cleanly, feet don't sink or float, and the motion reads as crisp/blocky at SubViewport scale.

## Verification checklist

- [ ] Model `.glb` imported and **nested** under a `CharacterBody3D` you own (per `godot-mesh-import-pixel-art`), with a visible `Skeleton3D` + skinned `MeshInstance3D`
- [ ] Animations came from **separate** anim-only glTFs (or were split via Advanced Import) — model file carries no gameplay logic
- [ ] One merged `AnimationLibrary` saved at `resources/animations/<char>.tres` with clean clip names (`idle`, `walk`, …)
- [ ] The `AnimationPlayer` is a child of _your_ node, loads the library, and its `root_node` points at the nested model so tracks reach the `Skeleton3D`
- [ ] Looping clips set to Loop (idle/walk/run); one-shots set to None — no per-frame reset (the `current_animation` guard is present)
- [ ] If a foreign clip was used: both the clip AND the character imported against the **same** `SkeletonProfileHumanoid`; bones mapped; re-imported
- [ ] One build path: the library is built by the `@tool` script, not hand-assembled in parallel
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`
- [ ] F5: mesh deforms, idle loops without a snap, walk switches cleanly, feet stay on the floor, crisp at SubViewport scale

## Error → Fix

| Symptom                                                  | Fix                                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Character is a rigid T-pose / no deformation             | The `AnimationPlayer` isn't driving the skeleton — Step 4, set `root_node` to the nested model so tracks reach the `Skeleton3D`; confirm a clip is actually playing       |
| Animation plays but no bone moves                        | Track node paths don't resolve from `root_node` — the player's `root_node` must point at the model that owns the `Skeleton3D`, not at the `CharacterBody3D`               |
| Foreign clip (Mixamo) does nothing                       | Skeleton mismatch — Step 5, retarget the clip AND the character against the same `SkeletonProfileHumanoid`, map bones, re-import                                          |
| Idle snaps/pops at the loop point                        | Clip loop mode is None — set it to Linear in Advanced Import (or the `-loop` source suffix), re-import, rebuild the library                                               |
| Clip resets to frame 0 every physics frame               | `play()` called every frame on a one-shot — Step 4, guard with `if _anim.current_animation != wanted`                                                                     |
| Library has raw glTF clip names ("Armature\|Idle")       | Step 3 — `add_animation("idle", clip)` renames on merge; rebuild with the `@tool` script                                                                                  |
| Re-importing an updated model loses the animation wiring | The model was made-local — it must be a nested instance (per `godot-mesh-import-pixel-art` Step 4); the `AnimationPlayer`/library live on your node, not inside the model |
| Mesh deforms but is giant/tiny/sunk                      | Scale/seat is the model-import step — `godot-mesh-import-pixel-art` Step 3 (Root Scale to footprint, base at y 0); animation doesn't change scale                         |
| Feet slide across the floor while walking                | Root-motion vs in-place mismatch — either drive `velocity` from the clip's root motion, or use an in-place clip and move the body in code; don't do both                  |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
