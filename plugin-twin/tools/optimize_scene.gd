extends SceneTree
## tools/optimize_scene.gd — headless twin-model scene optimizer (skill: twin-optimize).
##
## Mechanizes the manual optimization toolkit on an imported twin model: groups repeated
## meshes into region-chunked MultiMeshInstance3D fields (the measured chunked-MultiMesh
## recipe — chunks give the frustum culler units it can actually reject), optionally adds
## BoxOccluder3D occluders to big meshes (opt-in: occlusion culling is a per-frame CPU
## raster cost, net-NEGATIVE on flat scenes) and visibility ranges by size class.
##
## The IFC GlobalId join survives instancing: each MultiMeshInstance3D carries meta
## "twin_globalids" (PackedStringArray ordered by instance index — the original node
## names) and the report embeds the same map, so data binding can still resolve
## instance -> GlobalId (per-instance color via set_instance_color later).
##
## Usage (headless-safe, deterministic — no randomness, no viewport access):
##   $GODOT --headless --path . --script tools/optimize_scene.gd -- \
##       --in=<model.glb|scene.tscn> --out=<optimized.tscn> --report=<report.json> \
##       [--chunks=8] [--min-instances=8] [--occluders] [--vis-ranges]
##
## Exit code: 0 = optimized scene + report written, 1 = any failure.

const FLOATS_PER_INSTANCE := 12  # TRANSFORM_3D buffer: 12 floats/instance, row-major 3x4
const MIN_CHUNKS := 1
const MAX_CHUNKS := 32  # 8x8 proven; 64-256 total chunks is the sane band (twin-optimize)
const OCCLUDER_MIN_VOLUME_M3 := 10.0  # --occluders: world-AABB volume gate (documented default)
const OCCLUDER_SHRINK := 0.9  # occluder box = 90% of the AABB, avoids self-occlusion artifacts
const VIS_SMALL_DIAGONAL_M := 0.5  # --vis-ranges: world-AABB diagonal < 0.5 m -> small class
const VIS_MEDIUM_DIAGONAL_M := 2.0  # < 2 m -> medium class; larger meshes keep no range
const VIS_SMALL_END_M := 40.0  # small meshes vanish past 40 m
const VIS_MEDIUM_END_M := 120.0  # medium meshes vanish past 120 m

var in_path := ""
var out_path := ""
var report_path := ""
var chunks := 8
var min_instances := 8
var want_occluders := false
var want_vis_ranges := false

var _skipped_surface_override := 0


## One instancing candidate: every MeshInstance3D sharing (mesh resource, material_override).
class MeshGroup:
	var mesh: Mesh
	var override_material: Material
	var nodes: Array[MeshInstance3D] = []


func _init() -> void:
	_main()


## Node3D.global_transform silently returns identity until the tree is live (_init runs
## before the first main-loop iteration), so wait one frame before touching transforms.
func _main() -> void:
	await process_frame
	quit(_run())


func _run() -> int:
	if not _parse_args():
		return 1
	var scene_root := _load_input()
	if scene_root == null:
		return 1
	root.add_child(scene_root)

	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, meshes)
	var meshes_before := meshes.size()
	var nodes_before := _count_nodes(scene_root)
	var est_before := 0
	for mi: MeshInstance3D in meshes:
		est_before += maxi(mi.mesh.get_surface_count(), 1)

	# --- Instancing pass: group -> chunk -> MultiMesh, originals removed. ---
	var groups := _group_meshes(meshes)
	var container := Node3D.new()
	container.name = "TwinInstanced"
	scene_root.add_child(container)
	var per_group: Array[Dictionary] = []
	var gid_map := {}
	var groups_instanced := 0
	var multimeshes := 0
	var instances_total := 0
	for gi: int in groups.size():
		var g := groups[gi]
		var label := _group_label(g, gi)
		if g.nodes.size() < min_instances:
			per_group.append({"mesh": label, "count": g.nodes.size(), "instanced": false})
			continue
		var made := _emit_chunks(container, g, gi, gid_map)
		groups_instanced += 1
		multimeshes += made
		instances_total += g.nodes.size()
		per_group.append(
			{"mesh": label, "count": g.nodes.size(), "instanced": true, "multimeshes": made}
		)
		for node: MeshInstance3D in g.nodes:
			node.get_parent().remove_child(node)
			node.free()
	if container.get_child_count() == 0:
		scene_root.remove_child(container)
		container.free()

	# --- Optional passes operate on the meshes that stayed un-instanced. ---
	var occluders_added := 0
	if want_occluders:
		occluders_added = _occluder_pass(scene_root)
	var vis_ranges_set := 0
	if want_vis_ranges:
		vis_ranges_set = _vis_range_pass(scene_root)

	# --- Draw-item estimate after: one item per (mesh, surface) + per (chunk, surface). ---
	var remaining: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, remaining)
	var est_after := 0
	for mi: MeshInstance3D in remaining:
		est_after += maxi(mi.mesh.get_surface_count(), 1)
	var mmis: Array[MultiMeshInstance3D] = []
	_collect_mmis(scene_root, mmis)
	for m: MultiMeshInstance3D in mmis:
		est_after += maxi(m.multimesh.mesh.get_surface_count(), 1)

	if not _save_scene(scene_root):
		return 1

	var report := {
		"input": in_path,
		"output": out_path,
		"chunks": chunks,
		"min_instances": min_instances,
		"meshes_before": meshes_before,
		"nodes_before": nodes_before,
		"nodes_after": _count_nodes(scene_root),
		"groups_total": groups.size(),
		"groups_instanced": groups_instanced,
		"multimeshes": multimeshes,
		"instances_total": instances_total,
		"skipped_surface_override": _skipped_surface_override,
		"occluders_added": occluders_added,
		"vis_ranges_set": vis_ranges_set,
		"est_draw_items_before": est_before,
		"est_draw_items_after": est_after,
		"globalid_map_size": instances_total,
		"per_group": per_group,
		"globalid_map": gid_map,
	}
	if not _write_report(report):
		return 1
	var summary := report.duplicate()
	summary.erase("per_group")
	summary.erase("globalid_map")
	print("OPTIMIZE: OK ", JSON.stringify(summary))
	return 0


func _parse_args() -> bool:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--in="):
			in_path = a.substr(5)
		elif a.begins_with("--out="):
			out_path = a.substr(6)
		elif a.begins_with("--report="):
			report_path = a.substr(9)
		elif a.begins_with("--chunks="):
			chunks = clampi(a.substr(9).to_int(), MIN_CHUNKS, MAX_CHUNKS)
		elif a.begins_with("--min-instances="):
			min_instances = maxi(a.substr(16).to_int(), 2)
		elif a == "--occluders":
			want_occluders = true
		elif a == "--vis-ranges":
			want_vis_ranges = true
		else:
			push_error("OPTIMIZE: FAIL — unknown argument '%s'" % a)
			return false
	if in_path == "" or out_path == "" or report_path == "":
		push_error("OPTIMIZE: FAIL — --in=, --out= and --report= are all required")
		return false
	return true


## .glb/.gltf loads at runtime via GLTFDocument (no editor import); .tscn/.scn via load().
func _load_input() -> Node3D:
	var ext := in_path.get_extension().to_lower()
	if ext == "glb" or ext == "gltf":
		return _load_gltf()
	if ext == "tscn" or ext == "scn":
		return _load_packed()
	push_error("OPTIMIZE: FAIL — unsupported input '%s' (want .glb/.gltf/.tscn/.scn)" % in_path)
	return null


func _load_gltf() -> Node3D:
	var path := in_path
	if path.begins_with("res://") or path.begins_with("user://"):
		path = ProjectSettings.globalize_path(path)
	var gltf := GLTFDocument.new()
	var state := GLTFState.new()
	var err := gltf.append_from_file(path, state)
	if err != OK:
		push_error("OPTIMIZE: FAIL — GLB load error %d for %s" % [err, in_path])
		return null
	var scene := gltf.generate_scene(state) as Node3D
	if scene == null:
		push_error("OPTIMIZE: FAIL — GLB produced no Node3D root: %s" % in_path)
	return scene


func _load_packed() -> Node3D:
	var packed := load(in_path) as PackedScene
	if packed == null:
		push_error("OPTIMIZE: FAIL — cannot load %s" % in_path)
		return null
	var scene := packed.instantiate() as Node3D
	if scene == null:
		push_error("OPTIMIZE: FAIL — scene root of %s is not a Node3D" % in_path)
	return scene


func _collect_meshes(n: Node, out: Array[MeshInstance3D]) -> void:
	var mi := n as MeshInstance3D
	if mi != null and mi.mesh != null:
		out.append(mi)
	for c: Node in n.get_children():
		_collect_meshes(c, out)


func _collect_mmis(n: Node, out: Array[MultiMeshInstance3D]) -> void:
	var mmi := n as MultiMeshInstance3D
	if mmi != null and mmi.multimesh != null and mmi.multimesh.mesh != null:
		out.append(mmi)
	for c: Node in n.get_children():
		_collect_mmis(c, out)


func _count_nodes(n: Node) -> int:
	var total := 1
	for c: Node in n.get_children():
		total += _count_nodes(c)
	return total


## Group key = shared mesh resource + material_override identity. Nodes with per-surface
## override materials are excluded entirely — MultiMeshInstance3D cannot express them.
func _group_meshes(meshes: Array[MeshInstance3D]) -> Array[MeshGroup]:
	var groups: Array[MeshGroup] = []
	var key_to_idx: Dictionary[String, int] = {}
	for mi: MeshInstance3D in meshes:
		if _has_surface_overrides(mi):
			_skipped_surface_override += 1
			continue
		var key := _group_key(mi)
		if not key_to_idx.has(key):
			var g := MeshGroup.new()
			g.mesh = mi.mesh
			g.override_material = mi.material_override
			key_to_idx[key] = groups.size()
			groups.append(g)
		groups[key_to_idx[key]].nodes.append(mi)
	return groups


func _group_key(mi: MeshInstance3D) -> String:
	var mesh_id := mi.mesh.resource_path
	if mesh_id == "":
		mesh_id = str(mi.mesh.get_instance_id())
	var mat_id := "none"
	if mi.material_override != null:
		mat_id = str(mi.material_override.get_instance_id())
	return mesh_id + "|" + mat_id


func _has_surface_overrides(mi: MeshInstance3D) -> bool:
	for s: int in mi.get_surface_override_material_count():
		if mi.get_surface_override_material(s) != null:
			return true
	return false


func _group_label(g: MeshGroup, gi: int) -> String:
	if g.mesh.resource_name != "":
		return g.mesh.resource_name
	return "%s#%d" % [g.mesh.get_class(), gi]


## Emits region-chunked MultiMeshInstance3D nodes for one group: the group's world AABB is
## gridded chunks x chunks on the XZ plane, instances land in the cell holding their origin,
## one MultiMesh per non-empty cell with a correct per-chunk custom_aabb so culling works.
## Chunk nodes sit at identity; instance transforms are the originals' global transforms.
## Returns the number of chunks created; fills gid_map[chunk node name] = ordered GlobalIds.
func _emit_chunks(container: Node3D, g: MeshGroup, gi: int, gid_map: Dictionary) -> int:
	var world_aabbs: Array[AABB] = []
	var bounds := AABB()
	for i: int in g.nodes.size():
		var wa := g.nodes[i].global_transform * g.nodes[i].mesh.get_aabb()
		world_aabbs.append(wa)
		bounds = wa if i == 0 else bounds.merge(wa)
	var cell_x := bounds.size.x / float(chunks)
	var cell_z := bounds.size.z / float(chunks)
	var buckets: Array[Array] = []
	for i: int in chunks * chunks:
		buckets.append([])
	for i: int in g.nodes.size():
		var origin := g.nodes[i].global_transform.origin
		var cx := 0
		if cell_x > 0.0:
			cx = clampi(int((origin.x - bounds.position.x) / cell_x), 0, chunks - 1)
		var cz := 0
		if cell_z > 0.0:
			cz = clampi(int((origin.z - bounds.position.z) / cell_z), 0, chunks - 1)
		buckets[cz * chunks + cx].append(i)
	var made := 0
	for b: int in buckets.size():
		var idxs: Array = buckets[b]
		if idxs.is_empty():
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = g.mesh
		mm.instance_count = idxs.size()  # MUST be set BEFORE buffer (silent no-op otherwise)
		var buf := PackedFloat32Array()
		buf.resize(idxs.size() * FLOATS_PER_INSTANCE)
		var gids := PackedStringArray()
		var chunk_aabb := AABB()
		for j: int in idxs.size():
			var idx: int = idxs[j]
			_put(buf, j * FLOATS_PER_INSTANCE, g.nodes[idx].global_transform)
			gids.append(String(g.nodes[idx].name))
			chunk_aabb = world_aabbs[idx] if j == 0 else chunk_aabb.merge(world_aabbs[idx])
		mm.buffer = buf
		mm.custom_aabb = chunk_aabb  # world == local: the chunk node sits at identity
		var mmi := MultiMeshInstance3D.new()
		@warning_ignore("integer_division")
		var crow: int = b / chunks
		mmi.name = "TwinMM_g%d_c%d_%d" % [gi, b % chunks, crow]
		mmi.multimesh = mm
		if g.override_material != null:
			mmi.material_override = g.override_material
		mmi.set_meta("twin_globalids", gids)
		container.add_child(mmi)
		gid_map[String(mmi.name)] = gids
		made += 1
	return made


## MultiMesh.buffer layout for TRANSFORM_3D (no color/custom): 12 floats per instance,
## the 3x4 transform row-major (per row: basis column x/y/z components, then origin).
func _put(buf: PackedFloat32Array, o: int, xf: Transform3D) -> void:
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


## --occluders: any remaining mesh whose WORLD AABB volume exceeds 10 m3 gets a child
## OccluderInstance3D + BoxOccluder3D sized to 90% of its LOCAL AABB (inherits the node's
## transform, so rotation/scale stay correct). Explicit box occluders need NO bake.
## Off by default: Godot's occlusion culling is a per-frame CPU Embree raster that costs
## before it saves — net-negative on flat scenes (twin-optimize, measured).
func _occluder_pass(scene_root: Node3D) -> int:
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, meshes)
	var added := 0
	for mi: MeshInstance3D in meshes:
		var local := mi.mesh.get_aabb()
		var world := mi.global_transform * local
		if world.get_volume() <= OCCLUDER_MIN_VOLUME_M3:
			continue
		var occ := BoxOccluder3D.new()
		occ.size = local.size * OCCLUDER_SHRINK
		var oi := OccluderInstance3D.new()
		oi.name = "TwinOccluder"
		oi.occluder = occ
		oi.position = local.get_center()
		mi.add_child(oi)
		added += 1
	return added


## --vis-ranges: size classes by world-AABB diagonal — small (< 0.5 m) vanishes past 40 m,
## medium (< 2 m) past 120 m, large keeps no range (structure must never pop out).
## Applies to remaining un-instanced meshes only; chunked fields cull per-chunk already.
func _vis_range_pass(scene_root: Node3D) -> int:
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, meshes)
	var set_count := 0
	for mi: MeshInstance3D in meshes:
		var diagonal := (mi.global_transform * mi.mesh.get_aabb()).size.length()
		if diagonal < VIS_SMALL_DIAGONAL_M:
			mi.visibility_range_end = VIS_SMALL_END_M
			set_count += 1
		elif diagonal < VIS_MEDIUM_DIAGONAL_M:
			mi.visibility_range_end = VIS_MEDIUM_END_M
			set_count += 1
	return set_count


## PackedScene.pack silently DROPS any node whose owner is not set — own everything first.
func _save_scene(scene_root: Node3D) -> bool:
	_set_owner_recursive(scene_root, scene_root)
	var packed := PackedScene.new()
	if packed.pack(scene_root) != OK:
		push_error("OPTIMIZE: FAIL — PackedScene.pack failed")
		return false
	var err := ResourceSaver.save(packed, out_path)
	if err != OK:
		push_error("OPTIMIZE: FAIL — save error %d for %s" % [err, out_path])
		return false
	return true


func _set_owner_recursive(n: Node, owner_node: Node) -> void:
	for c: Node in n.get_children():
		c.owner = owner_node
		_set_owner_recursive(c, owner_node)


func _write_report(report: Dictionary) -> bool:
	var abs_path := ProjectSettings.globalize_path(report_path)
	DirAccess.make_dir_recursive_absolute(abs_path.get_base_dir())
	var fa := FileAccess.open(report_path, FileAccess.WRITE)
	if fa == null:
		push_error("OPTIMIZE: FAIL — cannot write %s" % report_path)
		return false
	fa.store_string(JSON.stringify(report, "  "))
	fa.close()
	return true
