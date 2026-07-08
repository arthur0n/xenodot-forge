extends SceneTree
## tools/optimize_scene.gd — headless twin-model scene optimizer (skill: twin-optimize).
##
## The thin SceneTree DRIVER: it parses args, loads the model, orchestrates the passes (hints ->
## group -> chunk -> optional occluder/vis-range), writes the report, and saves the optimized scene.
## The heavy lifting lives in two tools/lib helpers so no single file games the gdlint line cap by
## compressing docs: TwinHints (hint sidecar load/validate/materialize) and TwinChunks (AUTO grid
## math + MultiMesh chunk emission).
##
## Repeated meshes are grouped by (mesh, material_override); each group of >= --min-instances is
## collapsed into region-chunked MultiMeshInstance3D fields (grid AUTO per group), the smaller ones
## left as individual MeshInstance3Ds. Instance buffers hold GLOBAL transforms; the IFC join
## survives via the `twin_globalids` meta each batch carries; instance colours init white and are
## driven per-instance at runtime by the data binder. --hints overrides per-node behavior by
## GlobalId (schema + materialized group/meta names: see TwinHints); unmatched ids are reported.
##
##   $GODOT --headless --path . --script tools/optimize_scene.gd -- --in=<glb|tscn> \
##       --out=<optimized.tscn> --report=<report.json> [--chunks=auto|<int>] \
##       [--target-per-chunk=32] [--min-instances=8] [--hints=<h.json>] [--occluders] [--vis-ranges]

## --occluders: minimum world-AABB volume (cubic metres) for a leftover mesh to get an occluder.
## Below this, a box occluder costs more to rasterize into the depth buffer than the draws it saves.
const OCCLUDER_MIN_VOLUME_M3 := 10.0

## --vis-ranges size classes by world-AABB diagonal (metres) and the distance each class fades at.
## Small clutter can vanish close; medium fixtures a bit further; large structure always draws.
const VIS_SMALL_DIAGONAL_M := 0.5  # diagonal < 0.5 m -> "small"
const VIS_MEDIUM_DIAGONAL_M := 2.0  # diagonal < 2 m -> "medium"; larger keeps no range
const VIS_SMALL_END_M := 40.0  # small meshes fade past 40 m
const VIS_MEDIUM_END_M := 120.0  # medium meshes fade past 120 m

## Smallest legal --min-instances: a group of 1 is not a group, so instancing never applies below 2.
const MIN_INSTANCES_FLOOR := 2

## Default --min-instances: a group needs at least this many members to collapse into a MultiMesh.
## Below ~8 the per-MultiMesh bookkeeping (a node + buffer + custom_aabb) isn't worth the draw-call
## it saves; 8 is the twin-optimize default and matches the skill's documented examples.
const DEFAULT_MIN_INSTANCES := 8

## Default instances-per-chunk target for AUTO gridding (--target-per-chunk). Tens of instances per
## chunk is the sweet spot for frustum/occlusion culling granularity (twin-optimize bench).
const DEFAULT_TARGET_PER_CHUNK := 32

## Default fixed grid side when --chunks=<int> parsing needs a fallback (AUTO is the real default).
const DEFAULT_FIXED_CHUNKS := 8

var in_path := ""
var out_path := ""
var report_path := ""
var hints_path := ""
var auto_chunks := true  # DEFAULT: per-group grid from instance count (--chunks=<int> forces fixed)
var chunks := DEFAULT_FIXED_CHUNKS  # fixed-grid fallback when --chunks=<int> is passed
var target_per_chunk := DEFAULT_TARGET_PER_CHUNK
var min_instances := DEFAULT_MIN_INSTANCES
var want_occluders := false
var want_vis_ranges := false
var _skipped_surface_override := 0
var _hinted_ids := {}  # MeshInstance3D.get_instance_id() -> true; survivors skipped by grouping


## A set of MeshInstance3Ds sharing one mesh resource and one material_override — the unit the
## chunk emitter turns into MultiMeshes.
class MeshGroup:
	var mesh: Mesh
	var override_material: Material
	var nodes: Array[MeshInstance3D] = []


func _init() -> void:
	_main()


## Node3D.global_transform returns identity during SceneTree._init — wait one frame first so the
## buffers capture the real world transforms.
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
	var est_before := _est_draw_items(scene_root)
	# Hints materialize per-node overrides + mark survivors BEFORE grouping; then group->chunk->MM.
	var hint_report := TwinHints.apply(meshes, hints_path, _globalized(hints_path), _hinted_ids)
	var groups := _group_meshes(meshes)
	var inst := _instance_groups(scene_root, groups)

	# Optional passes operate on the meshes that stayed un-instanced.
	var occluders_added := _occluder_pass(scene_root) if want_occluders else 0
	var vis_ranges_set := _vis_range_pass(scene_root) if want_vis_ranges else 0
	var est_after := _est_draw_items(scene_root)
	if not _save_scene(scene_root):
		return 1

	var report := _build_report(
		meshes_before, nodes_before, scene_root, groups.size(), inst, hint_report
	)
	report["est_draw_items_before"] = est_before
	report["est_draw_items_after"] = est_after
	report["occluders_added"] = occluders_added
	report["vis_ranges_set"] = vis_ranges_set
	if not _write_report(report):
		return 1
	var summary := report.duplicate()
	summary.erase("per_group")
	summary.erase("globalid_map")
	print("OPTIMIZE: OK ", JSON.stringify(summary))
	return 0


## The tallies from the group->chunk pass, threaded back into _run for the report.
class InstanceResult:
	var per_group: Array[Dictionary] = []
	var gid_map := {}
	var groups_instanced := 0
	var multimeshes := 0
	var instances_total := 0


## Build the TwinInstanced container: emit MultiMesh chunks for every group that meets
## --min-instances, free the source meshes it absorbed, and record per-group report rows. Groups
## below the threshold are left in place and reported as non-instanced.
func _instance_groups(scene_root: Node3D, groups: Array[MeshGroup]) -> InstanceResult:
	var res := InstanceResult.new()
	var container := Node3D.new()
	container.name = "TwinInstanced"
	scene_root.add_child(container)
	# Buffers hold GLOBAL transforms, so pin the container to world identity (its local absorbs any
	# root transform) — a non-identity root would DOUBLE-apply and break the per-chunk custom_aabb.
	container.global_transform = Transform3D.IDENTITY
	for gi: int in groups.size():
		var g := groups[gi]
		var label := _group_label(g, gi)
		if g.nodes.size() < min_instances:
			res.per_group.append({"mesh": label, "count": g.nodes.size(), "instanced": false})
			continue
		var grid := TwinChunks.grid_for_group(g.nodes.size(), auto_chunks, chunks, target_per_chunk)
		var made := TwinChunks.emit_chunks(
			container, g.mesh, g.override_material, g.nodes, gi, res.gid_map, grid
		)
		res.groups_instanced += 1
		res.multimeshes += made
		res.instances_total += g.nodes.size()
		res.per_group.append(
			{
				"mesh": label,
				"count": g.nodes.size(),
				"instanced": true,
				"grid": grid,
				"multimeshes": made
			}
		)
		for node: MeshInstance3D in g.nodes:
			node.get_parent().remove_child(node)
			node.free()
	if container.get_child_count() == 0:
		scene_root.remove_child(container)
		container.free()
	return res


func _build_report(
	meshes_before: int,
	nodes_before: int,
	scene_root: Node3D,
	groups_total: int,
	res: InstanceResult,
	hint_report: Dictionary
) -> Dictionary:
	return {
		"input": in_path,
		"output": out_path,
		"chunks": "auto" if auto_chunks else str(chunks),
		"target_per_chunk": target_per_chunk if auto_chunks else 0,
		"min_instances": min_instances,
		"meshes_before": meshes_before,
		"nodes_before": nodes_before,
		"nodes_after": _count_nodes(scene_root),
		"groups_total": groups_total,
		"groups_instanced": res.groups_instanced,
		"multimeshes": res.multimeshes,
		"instances_total": res.instances_total,
		"skipped_surface_override": _skipped_surface_override,
		"globalid_map_size": res.instances_total,
		"hints_file": hint_report["hints_file"],
		"hints_applied": hint_report["hints_applied"],
		"hints_unmatched": hint_report["hints_unmatched"],
		"per_group": res.per_group,
		"globalid_map": res.gid_map,
	}


## Draw-item estimate: one item per (mesh, surface) for loose meshes + per (chunk, surface) for
## MultiMeshInstances. A cheap proxy for the draw-call count before/after optimization.
func _est_draw_items(scene_root: Node3D) -> int:
	var est := 0
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, meshes)
	for mi: MeshInstance3D in meshes:
		est += maxi(mi.mesh.get_surface_count(), 1)
	var mmis: Array[MultiMeshInstance3D] = []
	_collect_mmis(scene_root, mmis)
	for m: MultiMeshInstance3D in mmis:
		est += maxi(m.multimesh.mesh.get_surface_count(), 1)
	return est


func _parse_args() -> bool:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--in="):
			in_path = a.substr("--in=".length())
		elif a.begins_with("--out="):
			out_path = a.substr("--out=".length())
		elif a.begins_with("--report="):
			report_path = a.substr("--report=".length())
		elif a.begins_with("--hints="):
			hints_path = a.substr("--hints=".length())
		elif a.begins_with("--chunks="):
			var val := a.substr("--chunks=".length())
			auto_chunks = val == "auto"
			if not auto_chunks:
				chunks = clampi(val.to_int(), TwinChunks.MIN_CHUNKS, TwinChunks.MAX_CHUNKS)
		elif a.begins_with("--target-per-chunk="):
			target_per_chunk = maxi(a.substr("--target-per-chunk=".length()).to_int(), 1)
		elif a.begins_with("--min-instances="):
			min_instances = maxi(
				a.substr("--min-instances=".length()).to_int(), MIN_INSTANCES_FLOOR
			)
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


func _load_input() -> Node3D:  # .glb/.gltf via GLTFDocument (no import); .tscn/.scn via load()
	var ext := in_path.get_extension().to_lower()
	if ext == "glb" or ext == "gltf":
		return _load_gltf()
	if ext == "tscn" or ext == "scn":
		return _load_packed()
	push_error("OPTIMIZE: FAIL — unsupported input '%s' (want .glb/.gltf/.tscn/.scn)" % in_path)
	return null


func _load_gltf() -> Node3D:
	var gltf := GLTFDocument.new()
	var state := GLTFState.new()
	var err := gltf.append_from_file(_globalized(in_path), state)
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


func _globalized(p: String) -> String:  # res:// / bare paths -> absolute OS path
	if p == "":
		return ""
	if p.begins_with("res://") or p.begins_with("user://"):
		return ProjectSettings.globalize_path(p)
	if p.is_absolute_path():
		return p
	return ProjectSettings.globalize_path("res://" + p)


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


## Group the collected meshes by (mesh resource, material_override). Hinted survivors and meshes
## with per-surface override materials (which a shared MultiMesh can't reproduce) are excluded.
func _group_meshes(meshes: Array[MeshInstance3D]) -> Array[MeshGroup]:
	var groups: Array[MeshGroup] = []
	var key_to_idx: Dictionary[String, int] = {}
	for mi: MeshInstance3D in meshes:
		if _hinted_ids.has(mi.get_instance_id()):
			continue
		if _has_surface_overrides(mi):
			_skipped_surface_override += 1
			continue
		var mesh_id := mi.mesh.resource_path
		if mesh_id == "":
			mesh_id = str(mi.mesh.get_instance_id())
		var mat := mi.material_override
		var key := mesh_id + "|" + (str(mat.get_instance_id()) if mat != null else "none")
		if not key_to_idx.has(key):
			var g := MeshGroup.new()
			g.mesh = mi.mesh
			g.override_material = mat
			key_to_idx[key] = groups.size()
			groups.append(g)
		groups[key_to_idx[key]].nodes.append(mi)
	return groups


func _has_surface_overrides(mi: MeshInstance3D) -> bool:
	for s: int in mi.get_surface_override_material_count():
		if mi.get_surface_override_material(s) != null:
			return true
	return false


func _group_label(g: MeshGroup, gi: int) -> String:
	if g.mesh.resource_name != "":
		return g.mesh.resource_name
	return "%s#%d" % [g.mesh.get_class(), gi]


## --occluders: add a box occluder to every leftover mesh whose world-AABB volume clears the gate.
func _occluder_pass(scene_root: Node3D) -> int:
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(scene_root, meshes)
	var added := 0
	for mi: MeshInstance3D in meshes:
		if (mi.global_transform * mi.mesh.get_aabb()).get_volume() <= OCCLUDER_MIN_VOLUME_M3:
			continue
		TwinHints.add_occluder(mi)
		added += 1
	return added


## --vis-ranges: set a visibility_range_end on leftover meshes by size class (small/medium/large).
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
