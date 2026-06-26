# Custom Resources vs Dictionaries — when to use which — transcript digest

**Source** — `godot-custom-resources-dicionary.md` (raw now in `transcripts/archive/godot-custom-resources-dicionary.md`). Generic GDScript tutorial: "when is a `Dictionary` a better fit than a custom `Resource`, and when to combine them". Godot 4.x, decision-guidance not implementation.
**Why harvested** — about to **build a better resource-dictionary system**: a data-driven registry/lookup of custom Resources keyed by id (a typed catalog of `.tres` keyed by id that our archetypes/casts/configs plug into).

## What the video teaches

Decision talk, no registry/lookup implementation. Thesis: **Resource = reusable structured-data template stored as its own file** (loadable into many nodes, multiple `.tres` of one type, can hold logic/getters, Inspector-editable). **Dictionary = in-script key→value map**, flexible at runtime (add/remove/`has`/`size`), pairs any-type→any-type, but stuck where defined. Rule of thumb: reused-across-project → Resource (≈90% of cases); one-off in-script container OR runtime-mutating structure OR arbitrary-key pairing → Dictionary. The two **combine**: Resources stored in a Dictionary, Dictionaries defined inside a Resource (e.g. inventory).

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Resource = reusable structured-data template as its own file; load same `.tres` into many nodes; many `.tres` of one type with different values | holds | covered | exactly our model: EnemyArchetype/BossData/CastData/LevelConfig `extends Resource`; godot-effect-composition, cast-system | Reuse (validates) |
| 2 | Reused-across-project data → Resource; one-off in-one-script container → Dictionary (cheaper than a new class) | holds | covered | godot-effect-composition "`.tres`, never JSON"; our convention authors shared data as typed `.tres`. One-off scratch dicts already fine in-script | Reuse |
| 3 | Dictionary for **runtime-mutating** structure (add/remove/`has`/`size` during play) or **arbitrary-key pairing** (any-type→any-type) | holds with caveat | covered | already our exact usage: `enemy_archetype.gd:27` / `boss_data.gd:21` `resistances: Dictionary` (DamageType→float map inside a Resource); occupied-sets are runtime arrays. Caveat: strict-typed GDScript wants typed dicts where possible, no untyped Variant leak (godot-code-rules) | Reuse |
| 4 | Resources can hold **logic** (getter/setter/helper fns), not just data | holds with caveat | covered | RadiusTargetResolver/Effect carry behaviour; CastData methods. Caveat: heavy per-frame stateful behaviour is a component NODE not a Resource (godot-enemy-archetype: behaviours = nodes, Effects = stateless Resources) | Reuse |
| 5 | **Combine** them — Resources stored in a Dictionary, Dictionary inside a Resource (inventory pattern) | holds | **partial → the build target** | a Dictionary INSIDE a Resource = done (`resistances`). A Dictionary OF Resources keyed by id = a `{id -> .tres}` REGISTRY/catalog — **we do not have this**; all refs are direct `@export` slots (`wave_manager.gd:41 spawn_archetype`, weapon casts). This is exactly the system to build | Build (see below) |
| 6 | Break a feature into sub-tasks, pick Resource-vs-Dict per sub-task | holds | covered | general design hygiene; nothing new | Reuse |

**Coverage tally** — covered 4 (#1,#2,#3 caveat,#4 caveat,#6), partial 1 (#5 = the build). **No CLAUDE.md conflict.** Video never says "JSON", never contradicts a convention. It validates our typed-`.tres` model and names the one gap: a keyed catalog.

**Gap that matters for the current build** — point #5's "Dictionary of Resources keyed by id". Today every archetype/cast/config is wired as a **direct typed `@export` slot** (designer drags each `.tres` into each consumer). No central `{id: String -> Resource}` registry, no string-keyed lookup, no "load all `.tres` in a dir" autoload/catalog. A resource-dictionary system = that missing keyed lookup layer. The video gives only the concept (Dict-of-Resources), NOT the Godot-4 implementation (preload table vs `ResourceLoader.load` by path vs scan-dir-at-startup vs `ResourcePreloader`/autoload registry, id-collision handling, typed accessor `get_archetype(id) -> EnemyArchetype`).

**Recommended next**

- **skill-researcher** — find/adopt a "typed `.tres` registry / id-keyed Resource catalog" technique for Godot 4.6 (dir-scan vs preload table vs autoload singleton, typed getter, missing-id fail-fast). This is the reusable technique behind the build and we have no `godot-*` skill covering keyed lookup (effect-composition/data-driven-enemy cover authoring + composition, NOT id-indexed retrieval).
- **game-designer** — decide WHAT needs id-addressing and HOW ids are assigned: which families get a registry (archetypes? casts? level configs? all?), id naming scheme, and whether wave/level data should reference by id-string (data-portable, save-friendly) vs keep direct `@export` slots (type-checked, Inspector-draggable). Real design tradeoff the video raises but doesn't resolve.

**Later** — none. Video adds no other parked-but-valid technique; #1-4/#6 already load-bearing conventions.
