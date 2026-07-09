---
name: godot-animation-libraries
agents: [godot-player]
domain: godot-core
description: Import and play skeletal animations on a sourced 3D character in Godot 4.6 — the separate-glTF workflow (one model file + anim-only files), merging anim clips into an AnimationLibrary loaded onto your own AnimationPlayer, and retargeting a foreign animation (e.g. Mixamo) onto your skeleton via SkeletonProfileHumanoid. Use when an animated rigged .glb arrives in assets/models/, when a character must stop being a static capsule and play a looping idle/walk, when animations come in their own glTF separate from the model, when a sourced animation targets a different skeleton than your character, or when an imported AnimationPlayer's clips won't play / play on the wrong bones. NOT for static-prop import (that is godot-mesh-import + its style delta), NOT for shader-time foliage sway (godot-foliage), NOT for 2D sprite-frame animation.
---

# Animation libraries for a sourced 3D character

Animated character = **sourced rigged `.glb` (skeleton + skinned mesh) + anim clips in separate anim-only glTF files, merged into one `AnimationLibrary` loaded onto an `AnimationPlayer` on a node you own.** Model and anims stay apart: re-sourcing either is a one-file swap. Foreign skeleton clips (Mixamo, Quaternius) retarget via `SkeletonProfileHumanoid`. Verification target: animated character playing looping idle from a separate anim file.

## Requirements

- `godot-mesh-import` — import/scale/nest the model exactly as that base skill says (+ the game's style delta for the surface); this skill adds the animation layer only.
- `godot-3d-pixelation` — judge in F5 at SubViewport scale (foot-sliding, wrong-bone retargets obvious low-res).
- `godot-composition` — `CharacterBody3D` base + model + `AnimationPlayer` as children; gameplay calls down (`anim_player.play()`), animation signals up (`animation_finished`).
- `godot-code-rules` — any `.gd` driving playback must be strict-typed; gate with `tools/validate.sh`.
- `godot-verify` — mandatory 3-layer check after wiring.

## Project conventions

- `assets/models/<char>.glb` (skeleton + skinned mesh, no clips), `assets/models/<char>_idle.glb`, `<char>_walk.glb` … (anim-only, skeleton + animation, no skin needed). `assets/` gitignored.
- Saved `AnimationLibrary` → `resources/animations/<char>.tres`.
- Character = **nested instance** under owned `CharacterBody3D` — not made-local, not inherited scene. `AnimationPlayer` is a child of that node, animating the nested model's `Skeleton3D`.
- Retarget profile: `SkeletonProfileHumanoid` for humanoid clips. Non-humanoid (quadrupeds, machines) skip retargeting — requires matching bone names at source.
- No `AnimationTree` yet — scope is AnimationPlayer + AnimationLibrary + retargeting only.

## Steps

**1. Import and nest the model**

Delegate to `godot-mesh-import`. Confirm imported scene contains `Skeleton3D` + skinned `MeshInstance3D`. If model `.glb` ships an `AnimationPlayer` with wanted clips, use those directly (skip step 3).

**2. Split clips from one glTF (only if anims NOT in separate files)**

If a single `.glb` carries one long timeline with multiple motions:

1. Double-click `.glb` → **Advanced Import Settings**.
2. **Animations** tab → add clip per motion with **start/end frame**.
3. Set loop mode: **Linear** for idle/walk/run; **None** for one-shots.
4. Re-import.

Prefer separate anim-only files — they re-source cleanly. Use split only when the source bundles everything.

**3. Build AnimationLibrary from separate anim-only glTFs**

```gdscript
@tool
extends EditorScript
## tools/build_<char>_anim_library.gd — merge anim-only glTFs into one AnimationLibrary.
## Run from editor: File > Run. Author-time only.

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

Produces `resources/animations/<char>.tres` with clips named `idle`, `walk`, … (not raw glTF clip names).

**4. Load library onto your own AnimationPlayer**

```gdscript
extends CharacterBody3D
## entities/<char>/<char>.gd

@export var anim_library: AnimationLibrary  # assign resources/animations/<char>.tres in Inspector
@onready var _anim: AnimationPlayer = $AnimationPlayer
@onready var _model: Node3D = $Model  # nested .glb instance


func _ready() -> void:
	if anim_library != null:
		_anim.add_animation_library("", anim_library)
	_anim.root_node = _anim.get_path_to(_model)  # tracks must reach Skeleton3D
	_anim.play("idle")


func _physics_process(_delta: float) -> void:
	var moving := velocity.length() > 0.1
	var wanted := "walk" if moving else "idle"
	if _anim.current_animation != wanted:  # guard prevents per-frame reset of one-shots
		_anim.play(wanted)
```

`play()` on an already-playing clip is a no-op — the `current_animation` guard is still needed for one-shots. Calls go down (gameplay → `play`); connect `animation_finished` for follow-up on one-shots (signal up).

**5. Retarget a foreign animation (Mixamo / mismatched rig)**

1. Select anim-only `.glb` in FileSystem → Import dock → **Advanced Import Settings**.
2. **Animation** tab → enable **Retarget** → assign `SkeletonProfileHumanoid`.
3. Map source bones to profile generic names (Hips, Spine, LeftUpperArm, …). Mixamo's `mixamorig:` bones map cleanly.
4. Re-import.
5. Import **character** model against the **same** `SkeletonProfileHumanoid`. Both sides must speak the same profile.

After retargeting, the anim-only `.glb` feeds step 3's library builder like any native clip.

**6. Verify**

```bash
tools/validate.sh
$GODOT --headless --path . --script tools/verify_scene.gd -- entities/<char>/<char>.tscn main.tscn
```

F5 with character in a level: mesh deforms (not T-pose), idle loops with no snap, walk switches cleanly, feet don't sink/float, motion crisp/blocky at SubViewport scale.

## Verification checklist

- [ ] Model `.glb` imported and **nested** under owned `CharacterBody3D` (per `godot-mesh-import`), with visible `Skeleton3D` + skinned `MeshInstance3D`
- [ ] Anims from **separate** anim-only glTFs (or split via Advanced Import) — model file carries no gameplay logic
- [ ] One merged `AnimationLibrary` at `resources/animations/<char>.tres` with clean clip names
- [ ] `AnimationPlayer` is child of your node, loads library, `root_node` points at nested model
- [ ] Looping clips set to Loop; one-shots set to None — `current_animation` guard present
- [ ] If foreign clip: both clip AND character against same `SkeletonProfileHumanoid`; bones mapped; re-imported
- [ ] One build path: library built by `@tool` script, not hand-assembled
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`
- [ ] F5: mesh deforms, idle loops without snap, walk switches cleanly, feet on floor, crisp at SubViewport scale

## Error → Fix

| Symptom                                            | Fix                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Rigid T-pose / no deformation                      | Step 4 — set `root_node` to nested model; confirm clip playing                                                                |
| Clip plays but no bone moves                       | `root_node` wrong — must point at model owning `Skeleton3D`, not at `CharacterBody3D`                                         |
| Foreign clip (Mixamo) does nothing                 | Skeleton mismatch — Step 5: retarget clip AND character against same `SkeletonProfileHumanoid`                                |
| Idle snaps/pops at loop point                      | Clip loop mode is None — set to Linear in Advanced Import, re-import, rebuild library                                         |
| Clip resets to frame 0 every physics frame         | `play()` called every frame — Step 4: guard with `if _anim.current_animation != wanted`                                       |
| Library has raw glTF clip names ("Armature\|Idle") | Step 3 — `add_animation("idle", clip)` renames on merge; rebuild with `@tool` script                                          |
| Re-import loses animation wiring                   | Model was made-local — must be nested instance; `AnimationPlayer`/library on your node                                        |
| Mesh deforms but giant/tiny/sunk                   | Scale/seat is the model-import step — `godot-mesh-import` Step 3                                                              |
| Feet slide while walking                           | Root-motion vs in-place mismatch — drive `velocity` from clip root motion, or use in-place clip + move body in code; not both |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
