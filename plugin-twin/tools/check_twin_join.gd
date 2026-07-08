extends SceneTree
## tools/check_twin_join.gd — GlobalId join-coverage gate (skill: twin-verify, step 4).
##
## Loads a model (.glb/.gltf via GLTFDocument, .tscn via load()) and joins its candidate
## IFC GlobalIds against the property sidecar's keys. Candidates come from BOTH sources:
##   1. named MeshInstance3D nodes — the guid sits on the node or its parent grouping node;
##      Godot dedup suffixes ("<guid>2") are handled: a GlobalId is exactly 22 chars.
##   2. `twin_globalids` metadata arrays (PackedStringArray or Array) on optimized nodes
##      (MultiMeshInstance3D batches from twin-optimize) — each id counts individually.
## A node carrying `twin_globalids` is counted by its meta ids only, never by name too.
##
## Machine-parseable output (one line each), then exit 0/1:
##   JOIN: <matched>/<total> (<pct>%)
##   JOIN-GATE: OK|FAIL (min <pct>%)
##
## Usage (headless-safe, deterministic):
##   $GODOT --headless --path <project> --script tools/check_twin_join.gd -- \
##       --scene=<models/model.glb|scene.tscn> --sidecar=<models/model_props.json> [--min=0.95]
## .tscn paths must be project-relative (res://); .glb and sidecar may also be absolute.

const GUID_LEN := 22

var scene_path := ""
var sidecar_path := ""
var min_ratio := 0.95


func _init() -> void:
	if not _parse_args():
		quit(1)
		return
	_run()


func _parse_args() -> bool:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--scene="):
			scene_path = a.substr(8)
		elif a.begins_with("--sidecar="):
			sidecar_path = a.substr(10)
		elif a.begins_with("--min="):
			min_ratio = float(a.substr(6))
	if scene_path == "" or sidecar_path == "":
		push_error(
			(
				"JOIN-GATE: FAIL — usage: --scene=<model.glb|scene.tscn>"
				+ " --sidecar=<props.json> [--min=0.95]"
			)
		)
		return false
	return true


func _run() -> void:
	var side := _load_sidecar()
	if side.is_empty():
		print("JOIN-GATE: FAIL (empty or unreadable sidecar: %s)" % sidecar_path)
		quit(1)
		return
	print("SIDECAR_KEYS=%d" % side.size())

	var scene := _load_scene()
	if scene == null:
		quit(1)
		return
	root.add_child(scene)

	var mesh_nodes: Array[Node] = []
	var meta_ids: Array[String] = []
	_collect(scene, mesh_nodes, meta_ids)

	var matched := 0
	var total := 0
	var misses: Array[String] = []
	for m in mesh_nodes:
		total += 1
		if _guid_for(m, side) != "":
			matched += 1
		else:
			misses.append(str(m.name))
	for gid in meta_ids:
		total += 1
		if side.has(gid):
			matched += 1
		else:
			misses.append(gid)

	print("JOIN-SOURCES: mesh_nodes=%d multimesh_ids=%d" % [mesh_nodes.size(), meta_ids.size()])
	if not misses.is_empty():
		print("MISS_SAMPLE=", misses.slice(0, 5))
	var pct := 0.0
	if total > 0:
		pct = (100.0 * matched) / total
	print("JOIN: %d/%d (%.1f%%)" % [matched, total, pct])
	if total == 0:
		print(
			(
				(
					"JOIN-GATE: FAIL (min %.1f%%) — no candidates (no MeshInstance3D nodes,"
					+ " no twin_globalids metas)"
				)
				% (min_ratio * 100.0)
			)
		)
		quit(1)
		return
	if float(matched) / float(total) >= min_ratio:
		print("JOIN-GATE: OK (min %.1f%%)" % (min_ratio * 100.0))
		quit(0)
	else:
		print("JOIN-GATE: FAIL (min %.1f%%)" % (min_ratio * 100.0))
		quit(1)


## res:// stays project-mapped; absolute OS paths pass through; bare paths are res://-relative.
func _globalized(p: String) -> String:
	if p.begins_with("res://"):
		return ProjectSettings.globalize_path(p)
	if p.is_absolute_path():
		return p
	return ProjectSettings.globalize_path("res://" + p)


func _load_sidecar() -> Dictionary:
	var txt := FileAccess.get_file_as_string(_globalized(sidecar_path))
	var parsed: Variant = JSON.parse_string(txt)
	if parsed is Dictionary:
		return parsed
	return {}


func _load_scene() -> Node:
	var lower := scene_path.to_lower()
	if lower.ends_with(".glb") or lower.ends_with(".gltf"):
		var gltf := GLTFDocument.new()
		var state := GLTFState.new()
		var err := gltf.append_from_file(_globalized(scene_path), state)
		if err != OK:
			push_error("JOIN-GATE: FAIL — GLB load failed (%s): %s" % [scene_path, err])
			return null
		return gltf.generate_scene(state)
	var res_path := scene_path if scene_path.begins_with("res://") else "res://" + scene_path
	var packed: PackedScene = load(res_path)
	if packed == null:
		push_error("JOIN-GATE: FAIL — cannot load scene %s" % res_path)
		return null
	return packed.instantiate()


## Walk the tree collecting both candidate sources (meta-carrying nodes are meta-only).
func _collect(n: Node, mesh_nodes: Array[Node], meta_ids: Array[String]) -> void:
	if n.has_meta("twin_globalids"):
		var raw: Variant = n.get_meta("twin_globalids")
		if raw is PackedStringArray:
			for gid: String in raw:
				meta_ids.append(gid)
		elif raw is Array:
			for e: Variant in raw:
				meta_ids.append(str(e))
	elif n is MeshInstance3D:
		mesh_nodes.append(n)
	for c in n.get_children():
		_collect(c, mesh_nodes, meta_ids)


## Node names may be Godot-sanitized (dedup suffixes) or the guid may sit on the parent
## grouping node (glTF nodes with children). A GlobalId is exactly GUID_LEN chars.
func _guid_for(n: Node, side: Dictionary) -> String:
	var parent := n.get_parent()
	var cands: Array[String] = [str(n.name), str(parent.name) if parent != null else ""]
	for c in cands:
		if side.has(c):
			return c
		if c.length() > GUID_LEN and side.has(c.substr(0, GUID_LEN)):
			return c.substr(0, GUID_LEN)
	return ""
