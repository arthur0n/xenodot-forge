# tools/lib/twin_chunks.gd — the MultiMesh emission half of the twin-optimize optimizer, split
# out of optimize_scene.gd so the SceneTree driver stays a thin orchestrator (house pattern:
# class_name static utils in tools/lib/, referenced by bare class name — see NodeBuilder).
#
# Owns: the AUTO per-group grid math (grid_for_group), the XZ chunk bucketing, and the actual
# MultiMeshInstance3D emission — including the 16-float instance buffer write (transform + colour)
# and the `twin_globalids` join-survival meta. The grouping of MeshInstance3Ds into same
# (mesh, material) sets stays in the driver; this file consumes those groups as (mesh, material,
# nodes) triples so no cross-file inner-class type has to cross the boundary.
class_name TwinChunks
extends RefCounted

# --- MultiMesh instance buffer layout (MultiMesh.TRANSFORM_3D + use_colors) --------------------
# With use_colors=true the per-instance buffer stride is a 3x4 row-major transform followed by an
# RGBA colour quad. These are Godot engine facts about MultiMesh.buffer, not tunable knobs.

## Floats per instance for a 3x4 (row-major) Transform3D: 3 basis rows x 4 columns.
const TRANSFORM_FLOATS := 12

## Floats per instance for the RGBA colour quad appended when use_colors is on.
const RGBA_FLOATS := 4

## Total buffer floats per instance. Driven from its parts so the two can never disagree; this is
## the "16 floats/instance" the twin-optimize skill documents (12 transform + 4 colour).
const STRIDE := TRANSFORM_FLOATS + RGBA_FLOATS

## Initial value written to every colour channel: 1.0 == opaque white RGBA. Instances start white
## and are tinted per-instance at runtime by the data binder (binding_map.gd set_instance_color).
const INSTANCE_COLOR_INIT := 1.0

# --- AUTO grid bounds --------------------------------------------------------------------------
# The per-group grid side is clamped to this band. 8x8 (=64 cells) is proven in the twin-optimize
# bench; 1x1..32x32 keeps total chunks in the sane 1..1024 range (a group never explodes into more
# MultiMeshInstances than the draw-call win it buys).

## Smallest grid side: a single cell (one MultiMesh for the whole group).
const MIN_CHUNKS := 1

## Largest grid side: 32 (=32x32=1024 cells). Above this the per-chunk MultiMesh overhead outweighs
## the frustum/occlusion-culling granularity it buys (twin-optimize).
const MAX_CHUNKS := 32


## AUTO grid side for a group of `count` instances: clamp(ceil(sqrt(ceil(count/target))), 1, 32).
## Sized so each cell holds ~`target_per_chunk` instances. When `auto_chunks` is false the caller's
## fixed `chunks` side is used verbatim (the --chunks=<int> escape hatch).
static func grid_for_group(
	count: int, auto_chunks: bool, chunks: int, target_per_chunk: int
) -> int:
	if not auto_chunks:
		return chunks
	var cells := ceili(float(count) / float(target_per_chunk))
	return clampi(ceili(sqrt(float(cells))), MIN_CHUNKS, MAX_CHUNKS)


## Region-chunk one (mesh, material, nodes) group into `grid`x`grid` MultiMeshInstance3Ds on the XZ
## plane (one MultiMesh per non-empty cell), appended under `container`. Each instance keeps its
## GLOBAL transform (the container is pinned to world identity by the driver). Colours init to
## white; use_colors is on so the runtime binder can tint per instance. Every emitted node carries
## a `twin_globalids` meta (instance index -> node name) so the join gate survives instancing; that
## same array is mirrored into `gid_map` keyed by node name for the optimizer report. Returns the
## number of MultiMeshInstance3Ds created.
static func emit_chunks(
	container: Node3D,
	mesh: Mesh,
	override_material: Material,
	nodes: Array[MeshInstance3D],
	gi: int,
	gid_map: Dictionary,
	grid: int
) -> int:
	var world_aabbs: Array[AABB] = []
	var bounds := AABB()
	for i: int in nodes.size():
		var wa := nodes[i].global_transform * nodes[i].mesh.get_aabb()
		world_aabbs.append(wa)
		bounds = wa if i == 0 else bounds.merge(wa)
	var cell_x := bounds.size.x / float(grid)
	var cell_z := bounds.size.z / float(grid)
	var buckets := _bucket_by_cell(nodes, bounds, cell_x, cell_z, grid)
	var made := 0
	for b: int in buckets.size():
		var idxs: Array = buckets[b]
		if idxs.is_empty():
			continue
		var mmi := _emit_cell(mesh, override_material, nodes, world_aabbs, idxs, gi, b, grid)
		container.add_child(mmi)
		gid_map[String(mmi.name)] = mmi.get_meta("twin_globalids")
		made += 1
	return made


## Assign each node to its XZ grid cell (row-major cell index = cz*grid + cx). A degenerate axis
## (zero extent) collapses to column/row 0 so a flat group still buckets cleanly.
static func _bucket_by_cell(
	nodes: Array[MeshInstance3D], bounds: AABB, cell_x: float, cell_z: float, grid: int
) -> Array[Array]:
	var buckets: Array[Array] = []
	for i: int in grid * grid:
		buckets.append([])
	for i: int in nodes.size():
		var origin := nodes[i].global_transform.origin
		var cx := 0
		if cell_x > 0.0:
			cx = clampi(int((origin.x - bounds.position.x) / cell_x), 0, grid - 1)
		var cz := 0
		if cell_z > 0.0:
			cz = clampi(int((origin.z - bounds.position.z) / cell_z), 0, grid - 1)
		buckets[cz * grid + cx].append(i)
	return buckets


## Build one cell's MultiMeshInstance3D from the node indices `idxs` (into `nodes`). Sets use_colors
## BEFORE instance_count/buffer (the stride only becomes STRIDE floats once use_colors is on) and
## instance_count BEFORE the buffer (a later count silently drops the buffer). Names the node
## TwinMM_g<gi>_c<col>_<row> and tags it with the per-instance GlobalId list.
static func _emit_cell(
	mesh: Mesh,
	override_material: Material,
	nodes: Array[MeshInstance3D],
	world_aabbs: Array[AABB],
	idxs: Array,
	gi: int,
	b: int,
	grid: int
) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true  # MUST precede instance_count/buffer — sets the buffer stride to STRIDE
	mm.mesh = mesh
	mm.instance_count = idxs.size()  # MUST precede the buffer assignment (silent no-op otherwise)
	var buf := PackedFloat32Array()
	buf.resize(idxs.size() * STRIDE)
	var gids := PackedStringArray()
	var chunk_aabb := AABB()
	for j: int in idxs.size():
		var idx: int = idxs[j]
		var o := j * STRIDE
		_put(buf, o, nodes[idx].global_transform)
		for k: int in RGBA_FLOATS:
			buf[o + TRANSFORM_FLOATS + k] = INSTANCE_COLOR_INIT  # white; tinted per-instance at runtime
		gids.append(String(nodes[idx].name))
		chunk_aabb = world_aabbs[idx] if j == 0 else chunk_aabb.merge(world_aabbs[idx])
	mm.buffer = buf
	mm.custom_aabb = chunk_aabb
	var mmi := MultiMeshInstance3D.new()
	@warning_ignore("integer_division")
	var crow: int = b / grid
	mmi.name = "TwinMM_g%d_c%d_%d" % [gi, b % grid, crow]
	mmi.multimesh = mm
	if override_material != null:
		mmi.material_override = override_material
	mmi.set_meta("twin_globalids", gids)
	return mmi


## Write a Transform3D into `buf` at float offset `o` as TRANSFORM_FLOATS (12) floats: the basis as
## 3 row-major rows interleaved with the origin column (the layout MultiMesh.buffer expects).
static func _put(buf: PackedFloat32Array, o: int, xf: Transform3D) -> void:
	var b := xf.basis
	buf[o] = b.x.x
	buf[o + 1] = b.y.x
	buf[o + 2] = b.z.x
	buf[o + 3] = xf.origin.x
	buf[o + 4] = b.x.y
	buf[o + 5] = b.y.y
	buf[o + 6] = b.z.y
	buf[o + 7] = xf.origin.y
	buf[o + 8] = b.x.z
	buf[o + 9] = b.y.z
	buf[o + 10] = b.z.z
	buf[o + 11] = xf.origin.z
