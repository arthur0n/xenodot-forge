---
name: godot-gridmap-level
description: Build a tile-based 3D level from a drawn grid (levels/drawn/current.json) with GridMap + MeshLibrary so geometry is computed and grid-snapped, not hand-authored. Use for any Draw-level brief citing current.json, a level with more than ~10 wall/floor pieces, or when hand-typed Transform3D walls clip, mis-size, or drift off their colliders. Covers MeshLibrary tile authoring, the @tool grid importer, the GridMap+instanced-props hybrid, and verify additions. NOT for a tiny hand-built blockout of a few boxes.
---

# godot-gridmap-level

Hand-authoring `Transform3D` matrices fails: mesh and collider get nudged separately and drift (`shared_apartment.tscn` — `WallCorrMBDiv` mesh shifted +6.1 m off its collider). GridMap fixes this structurally: each cell's mesh + collision come from one MeshLibrary item — they cannot drift.

## When to use

- Brief cites `levels/drawn/current.json` → **always** GridMap.
- Level has >~10 wall/floor pieces.
- Hand-authored level with clipping/drifting walls.

**NOT:** small blockout (≲10 primitives, no grid) — plain `StaticBody3D` + `MeshInstance3D` + `CollisionShape3D`.

## Grid → world contract

`levels/drawn/current.json` = `{ width, height, cell_size, cells, items, rooms }`, row-major. Codes: **0 floor · 1 wall · 2 door · 3 window · 4 item**. `items` = `{ id, x, y }`; `rooms` = `{ id, x, y }` (same id = one zone → per-zone wall colour). File `cell_size` is a hint — metres-per-cell and wall height come from the brief.

Cell `(col, row)` → `Vector3i(col, 0, row)`. World pos = `cell * cell_size`. **No by-eye step.**

## Method

### 1. MeshLibrary tiles

Tile source scene: root `Node3D`, one child per tile type, each = `MeshInstance3D` + `StaticBody3D`/`CollisionShape3D`. Export: `Scene → Export As… → MeshLibrary…` → `resources/<name>.meshlib.tres`.

Tile types:

- **floor** — thin slab (or skip; use one big slab in step 3)
- **wall** — solid box `Vector3(cell_size.x, wall_height, cell_size.z)` (full block, not a thin plane)
- **door-frame**, **window-sill** — as needed

Gotchas:

- **Materials on the MESH, not the node.** `surface_material_override` ignored by export. Per-zone colours = separate tile items (`wall_cool`, `wall_cream`, …) with colour baked into mesh material.
- Collision is welded to the tile item — can never drift.
- **Sub-cell-height tiles:** set `MeshInstance3D` origin to `Vector3(0, -(wall_height - tile_height) / 2, 0)` in the source scene or it floats at cell centre.
- **Layered tiles:** one item can carry two `BoxMesh` surfaces (e.g. sill + glass pane with `transparency = TRANSPARENCY_ALPHA, albedo_color.a ≈ 0.3`). Single `StaticBody3D` sized to the sill.
- **Headless collision:** `mesh_library.set_item_shapes(id, [BoxShape3D.new(), Transform3D.IDENTITY])` — flat untyped `Array` alternating `Shape3D` + `Transform3D`. No `ShapePrimitive3D` type in Godot 4.

### 2. GridMap node

Add `GridMap`, assign MeshLibrary `.tres`, set `cell_size = Vector3(metres_per_cell, wall_height, metres_per_cell)`.

### 3. Hybrid: structure in GridMap, floor and props outside

- **Floor:** one `StaticBody3D` slab sized to `(width*cell_size.x × thin × height*cell_size.z)` — beats per-cell tiles, no seams.
- **Props (code 4 / `items`):** group same-id cells → one instance at computed world pos `Vector3(col*cell_size.x, y, row*cell_size.z)` + offset. Never eyeballed.
- **Collision is pipeline default** (not parked). Prop holder = `StaticBody3D` + `CollisionShape3D` + unique `BoxShape3D` sized to model AABB. Compute AABB headlessly: instance model, walk `MeshInstance3D`s accumulating `Transform3D` from holder origin, enclose 8 corners. Box, never trimesh.
- **Multi-cell same-id = ONE instance** at group centre, not N copies.
- **Owner — two cases, do NOT conflate them.** Nodes the builder **CREATES** (a `MeshInstance3D`, light, or collision it `new()`s up) → set `child.owner = scene_root` so they serialize into the `.tscn`. An **INSTANCED sub-scene** (`.glb` / `.tscn` — a prop instance, the Player) → set owner ONLY on the instance ROOT (`prop.owner = scene_root`); **NEVER walk into its internal children.** The instance's internals serialize via the PackedScene instance automatically; re-owning them turns them into level-override nodes (bloats the `.tscn`) AND breaks `find_child(name, recursive, owned=true)` against that instance, because its children no longer report their own scene root as `.owner`. (A recursive owner-walk on the Player instance is exactly what dropped the eye-`Camera3D` from `main.gd`'s `find_child("Camera3D", true, true)` on the second level — see godot-main-scene.)
- **Never `set_script()` an instanced PackedScene node.** A node from `instantiate()`ing a `.tscn`/`.glb` whose ROOT already carries that script needs no `set_script()` — re-assigning the same (or any) script to an already-instanced scene node RESETS that instance to script defaults in Godot 4: it silently discards the exported-property overrides baked into the instanced scene and resets `@onready` wiring, with NO error or warning. The scene still loads and passes headless verify, but at runtime the instance uses stale/default values (a recoil/movement export change that showed zero in-game effect across two round-trips traced to exactly this). Only `set_script()` on nodes the builder `new()`s up itself (a bare `Node` WaveManager, a created light); for `instantiate()`d entities, set the script in the entity's OWN `.tscn` once and never re-assert it on the instance.

### 4. Editor importer (`@tool extends GridMap`)

Populates GridMap from JSON in editor → save scene → cells bake into `.tscn`. Nothing reads JSON at runtime.

> **SEAM:** `JSON.parse_string` returns `Variant`. Strict config (`unsafe_cast=2`) requires type-guard + `@warning_ignore` on every cast.

```gdscript
@tool
extends GridMap
## Author-time importer. Set rebuild = true in inspector to repopulate, then save.

@export var rebuild: bool = false:
	set(value):
		if value and Engine.is_editor_hint():
			_build_from_grid()

func _build_from_grid() -> void:
	var file: FileAccess = FileAccess.open("res://levels/drawn/current.json", FileAccess.READ)
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		push_error("gridmap importer: grid JSON is not a Dictionary")
		return
	@warning_ignore("unsafe_cast")
	var grid: Dictionary = parsed as Dictionary
	@warning_ignore("unsafe_cast")
	var w: int = int(grid["width"] as float)
	@warning_ignore("unsafe_cast")
	var cells: Array = grid["cells"] as Array
	clear()
	for i: int in range(cells.size()):
		@warning_ignore("unsafe_cast")  # SEAM: Array element is Variant
		var code: int = int(cells[i] as float)
		var col: int = i % w
		@warning_ignore("integer_division")
		var row: int = i / w
		var item: int = _item_for(code, col, row)
		if item >= 0:
			set_cell_item(Vector3i(col, 0, row), item)
```

`_item_for()` maps code + zone → MeshLibrary item id; returns `-1` for floor/door/empty.

### 4b. Headless build path (`@tool extends SceneTree`)

```gdscript
@tool
extends SceneTree

func _init() -> void:
	var root: Node3D = Node3D.new()
	root.name = "LevelName"
	var grid_map: GridMap = GridMap.new()
	grid_map.name = "LevelMap"
	grid_map.mesh_library = load("res://resources/your_tiles.meshlib.tres")
	grid_map.cell_size = Vector3(cell_x, wall_height, cell_z)
	grid_map.cell_center_x = false
	grid_map.cell_center_y = false
	grid_map.cell_center_z = false
	_populate_from_grid(grid_map)  # use SEAM casting pattern from step 4
	root.add_child(grid_map)
	grid_map.owner = root
	# add floor slab, DirectionalLight3D, WorldEnvironment, Player...
	var packed: PackedScene = PackedScene.new()
	packed.pack(root)
	ResourceSaver.save(packed, "res://levels/level_name.tscn")
	quit()
```

Run: `$GODOT --headless --path . --script scripts/build_<name>.gd`

**One build path per scene, one tracked location.** The builder is game-authored content — keep it in `scripts/` (tracked), NOT in `tools/` (gitignored, reserved for plugin-generated files and clobbered on regen). Never let a second copy drift; don't duplicate JSON-parsing logic.

**Splitting a builder that nears the 500-line cap.** Partition BY PHASE, not by lettered slice: a bare `class_name <Level>Geometry` / `<Level>Props` / `<Level>Hazards` helper of `static func`s (NOT `extends RefCounted`), each taking `scene_root` + grid params, called in order from the `build_<name>.gd` orchestrator. Phase names are stable and self-documenting; lettered "slices" (`SliceE`) hide what moved where. The orchestrator stays the only `SceneTree` script. (See `build_firing_yard.gd`.)

**The baked `.tscn` is generated output — never hand-edit it.** Any node, property, or dependency a fix adds directly to the baked scene (a `NavigationRegion3D`, a marker, a group) is silently overwritten on the next builder run, and the bug returns looking like a fresh regression. Every persistent node AND every baked asset the scene needs MUST be produced by the builder. Baked resources (navmesh, MeshLibrary) load from a tracked `.tres` the builder instances — e.g. `add_navmesh()` loads `res://levels/<level>_navmesh.tres` into a `NavigationRegion3D` the builder adds; do not bake the region into the `.tscn` by hand. Re-bake that `.tres` whenever the floor/level geometry changes — the builder does not regenerate it.

- **Editor (step 4):** flip `rebuild`, save, commit baked `.tscn`. Best for editor iteration.
- **Headless (step 4b):** run once → `.tscn`, keep for rebuilds. Best for agent-driven builds.

## Verify additions (+ standard godot-verify)

1. GridMap has MeshLibrary assigned + `get_used_cells()` not empty (unassigned = silent empty render).
2. `cell_size` matches brief metres-per-cell × wall height.
3. Scene **saved after** importer ran (cells baked into `.tscn`).
4. Floor slab covers grid extent; props at sensible scale.
5. F5 in `Main/LevelHost`: no wall clips, collider matches every visible wall.
6. **Actor inventory after a builder refactor/split.** When the builder is split into phase scripts (geometry/props/hazards/…), assert the rebuilt scene still contains every gameplay node the old one had — spawn manager, spawn markers, patrol waypoints, player. A regenerated `.tscn` missing a wired node renders fine and throws no error; it just stops spawning (the actor block is the easiest thing to drop on the way into a new sub-script). List the expected actor nodes and confirm each is present (`get_node_or_null("WaveManager")`, marker/waypoint counts > 0, and — for any level hosting nav-driven enemies — `get_node_or_null("NavigationRegion3D")` with a non-null `navigation_mesh`) before claiming the build done. A nav-less level renders fine and stays killable but its enemies never move (`NavigationAgent3D` finds no path); a render-only verify will not catch it.

## Loading & style

Loads under `Main/LevelHost` like any level (`main.gd`'s `_levels`). Flat `StandardMaterial3D` pixel-art look on tile meshes. `DirectionalLight3D` + `WorldEnvironment` (Sky) as blockout levels (skills: godot-pixel-lighting, godot-3d-pixelation).
