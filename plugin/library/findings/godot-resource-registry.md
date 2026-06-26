# Skill-researcher finding — id-keyed Resource registry

**Gap** — no `godot-*` skill covers id-indexed retrieval of typed Resources. Today every ref is a direct typed `@export` slot (`wave_manager.spawn_archetype`); no `get_archetype("grunt")` accessor, no dir-scan/preload table, no collision/missing-id fail-fast.

**Candidate evaluated** — GodotPrompter `resource-pattern` (+ `references/collections.md`, `configuration-pattern.md`), MIT. Best/only match. (Also scanned `inventory-system`, `save-load`, `dependency-injection` — none is a keyed-catalog skill.)

**Classification**

- USEFUL (sec 6 + collections.md): three registration strategies — `Array[T]` database Resource w/ `find_by_name` typed getter; `ResourcePreloader` node; `DirAccess` dir-walk loader. The `find_by_name` loop is the seed of `get_archetype(id)`.
- IRRELEVANT (cut): all C# parity blocks; 2D examples (`CharacterBody2D`); save/serialization (sec 9), sharing/duplicate (sec 8), anti-patterns — out of this gap's scope.
- GAPS (skill does NOT cover; I author to spec): id-collision detection (none); missing-id fail-fast (getter returns `null` soft-fail — violates fail-fast); coexistence with direct `@export` slots (unaddressed); strict-typed accessor returning the concrete type.

**Verdict** — candidate is a THIN seed (~⅓ of required surface: registration strategies only). Useful core fills the registration third; collision + fail-fast + coexistence + typed-getter authored fresh to DiceOfFate conventions. Adoptable AS-REWRITE. One canonical path chosen: a per-family **dir-scan-at-boot registry Resource (NOT an autoload)** keyed by an `id: StringName` field on each Resource, with collision push_error + fatal missing-id getter. Rejected alternatives (parked): `ResourcePreloader` node (manual key upkeep) and autoload-singleton registry (violates composition-over-autoloads).

**Recommendation** — ADOPT as `godot-resource-registry` (rewritten draft below). Coexists with current direct `@export` slots: registry is additive (string-id lookup for save/data-portable refs), slots stay for type-checked Inspector wiring.

**Note for game-designer** — separate open decision: which families get a registry + id naming scheme + whether wave/level data references by id-string vs keeps `@export` slots. Skill provides the mechanism; designer picks the policy.

Attribution: Adapted from GodotPrompter (MIT), Copyright (c) GodotPrompter Contributors.

---

## READY-TO-WRITE SKILL.md

Target path: `.claude/skills/godot-resource-registry/SKILL.md`

````markdown
---
name: godot-resource-registry
description: Build a typed id-keyed catalog over a family of custom Resources in Godot 4.6 — a {StringName id -> .tres} registry that dir-scans a folder at boot, fails fast on a duplicate or missing id, and returns the concrete Resource type. Use when a task needs string-id lookup of authored .tres — "get_archetype(\"grunt\")", "look up a CastData/EnemyArchetype/LevelConfig by id", "registry/catalog of resources", "load all .tres in a folder", "reference an archetype by name from save data", "id-indexed resource table" — or when direct @export slots can't address a Resource by a data-portable string id. NOT the Resource-authoring/composition pattern (that is godot-effect-composition / godot-enemy-archetype / cast-system) — this is the id-indexed RETRIEVAL layer over Resources those skills author.
---

# godot-resource-registry

A registry is a thin `{StringName id -> Resource}` lookup over one family of authored `.tres` files. We build it as a **plain Resource that dir-scans its folder once at boot** — not an autoload, not a `ResourcePreloader` node — because a scanned registry needs zero per-file upkeep (drop a new `.tres` in the folder, it appears), keeps the catalog out of global singleton state (composition over autoloads), and stays a typed value a consumer holds by `@export` or `preload`. It is **additive**: direct typed `@export` slots stay for Inspector-draggable, type-checked wiring; the registry adds string-id addressing for data-portable references (save files, wave/level data, console). Lookups **fail fast** — a duplicate id `push_error`s at scan, a missing id is a hard `assert` — so a typo never silently returns `null`.

## Requirements

- `godot-code-rules` applied — strict typed GDScript, no untyped/Variant leak, explicit return types.
- The Resource family already authored as typed `.tres` (`godot-effect-composition` / `godot-enemy-archetype` / `cast-system`). This skill indexes them; it does not author them.
- Each indexed Resource class carries an `@export var id: StringName` field, unique within its folder.

## Project conventions

- Resource families + folders: `EnemyArchetype` (`tools/lib/enemy/enemy_archetype.gd`) → `.tres` in `archetypes/`; `BossData` (`tools/lib/enemy/boss_data.gd`); `CastData` (`tools/lib/cast/cast_data.gd`); `LevelConfig` (`tools/lib/level/level_config.gd`). All `extends Resource`.
- The registry script lives beside the family it indexes (e.g. `tools/lib/enemy/archetype_registry.gd`); reusable cross-entity glue belongs in `tools/lib/`.
- One registry CLASS per family — keep families separate (an arena registry of archetypes ≠ a cast registry), don't build one god-catalog.
- `id` is `StringName` (cheap compare, hashes well as a dict key), authored in the Inspector on each `.tres`. snake_case ids (`"grunt"`, `"tank_shooter"`).
- Registry is a value, not a singleton: a consumer holds it via `@export var registry: ArchetypeRegistry` or `preload`s the registry `.tres`. NO autoload (godot-composition).
- Coexistence: existing direct `@export` slots (e.g. `wave_manager.spawn_archetype: EnemyArchetype`) stay as-is — type-checked, Inspector-draggable. Use the registry only where a string id is the natural key (save data, level/wave tables, debug commands). Both reference the SAME `.tres` on disk.

## Steps

1. Add the id field to the indexed Resource class (once per family):

```gdscript
# tools/lib/enemy/enemy_archetype.gd
class_name EnemyArchetype
extends Resource

@export var id: StringName = &""    # unique within archetypes/; the registry key
@export var display_name: String = "Grunt"
# ... existing stats ...
```

2. Author the registry class — dir-scan at boot, collision + missing-id fail-fast, typed getter:

```gdscript
# tools/lib/enemy/archetype_registry.gd
class_name ArchetypeRegistry
extends Resource

## Scanned {id -> EnemyArchetype} catalog over a folder of .tres.
## Not an autoload: a consumer holds this via @export or preload.

const FOLDER: String = "res://archetypes/"

var _by_id: Dictionary[StringName, EnemyArchetype] = {}
var _loaded: bool = false


func _ensure_loaded() -> void:
	if _loaded:
		return
	_loaded = true
	var dir: DirAccess = DirAccess.open(FOLDER)
	if dir == null:
		push_error("ArchetypeRegistry: cannot open '%s'" % FOLDER)
		return
	for file_name: String in dir.get_files():
		if not (file_name.ends_with(".tres") or file_name.ends_with(".res")):
			continue
		var res: Resource = ResourceLoader.load(FOLDER.path_join(file_name))
		var arch: EnemyArchetype = res as EnemyArchetype
		if arch == null:
			continue
		if arch.id == &"":
			push_error("ArchetypeRegistry: '%s' has empty id" % file_name)
			continue
		if _by_id.has(arch.id):
			push_error("ArchetypeRegistry: duplicate id '%s' (%s)" % [arch.id, file_name])
			continue
		_by_id[arch.id] = arch


## Fatal on a missing id — a typo must never silently yield null.
func get_archetype(id: StringName) -> EnemyArchetype:
	_ensure_loaded()
	assert(_by_id.has(id), "ArchetypeRegistry: unknown id '%s'" % id)
	return _by_id[id]


func has_id(id: StringName) -> bool:
	_ensure_loaded()
	return _by_id.has(id)


func ids() -> Array[StringName]:
	_ensure_loaded()
	return _by_id.keys()
```

3. Author one registry `.tres` (`archetypes/archetype_registry.tres`, or wherever the consumer expects it) so it can be `@export`-wired or `preload`ed. The registry holds no Inspector data — it scans — so the `.tres` is just a typed handle.

4. Wire a consumer by id WITHOUT removing its existing slot:

```gdscript
# a consumer that resolves a string id (e.g. from save/level data)
@export var registry: ArchetypeRegistry
@export var spawn_archetype: EnemyArchetype   # existing direct slot — keep it

func spawn_by_id(id: StringName) -> void:
	var arch: EnemyArchetype = registry.get_archetype(id)
	_spawn(arch)
```

5. Clone the class per family that needs id-addressing (`CastRegistry` over `entities/weapon/`, `LevelRegistry`, etc.) — same shape, swap the type + `FOLDER`. Don't merge families into one registry.

## Verification checklist

- A fresh `.tres` dropped in the folder is returned by `get_archetype()` with no code change.
- `get_archetype("grunt")` returns the same object as the direct `@export` slot pointing at `grunt.tres` (one `.tres`, two reference paths).
- Two `.tres` with the same `id` → a `duplicate id` error in the Output log at first lookup; second is skipped, not silently overwritten.
- `get_archetype(&"typo")` halts in a debug build (assert) rather than returning `null` and crashing later.
- `tools/validate.sh` passes (typed dict, explicit return types, no Variant leak).
- A headless `tools/smoke_*.gd` boots, calls `get_archetype()` for a known id, and asserts the returned type + a field — registry resolves at runtime (godot-runtime-smoke).

## Error → Fix

| Symptom                                    | Fix                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `cannot open 'res://…/'`                   | `FOLDER` path wrong or folder absent — fix the const / create the folder.                              |
| Getter returns wrong/empty type            | `.tres` not the expected class, or `as Type` cast nulled it — confirm `class_name` + `@export var id`. |
| `duplicate id` error                       | Two `.tres` share an `id` — make ids unique within the folder.                                         |
| Lookup returns `null` instead of asserting | Getter used `_by_id.get(id)` — use `assert(_by_id.has(id), …)` then index, per Steps.                  |
| `id` empty / not matching                  | `id` left at `&""` in the Inspector — author it on each `.tres`.                                       |
| `UNTYPED_DECLARATION` at `_by_id`          | Type the dict: `Dictionary[StringName, EnemyArchetype]`.                                               |
| Registry as autoload feels tempting        | Don't — hold it via `@export`/`preload`; autoload violates composition-over-autoloads.                 |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
````

CLAUDE.md "## Skills" one-line entry (add to the list):

- godot-resource-registry: typed id-keyed catalog over a family of custom Resources — a `{StringName id -> .tres}` registry Resource (NOT autoload) that dir-scans its folder at boot, `push_error`s on duplicate id, hard-asserts on missing id, returns the concrete type via `get_archetype(id)`. Additive to direct `@export` slots (string-id addressing for save/level/wave data; slots stay for Inspector wiring). The id-indexed RETRIEVAL layer over Resources that godot-effect-composition / godot-enemy-archetype / cast-system AUTHOR — not their authoring/composition pattern.
