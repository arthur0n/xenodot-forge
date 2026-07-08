# tools/lib/twin_hints.gd — the hint-sidecar half of the twin-optimize optimizer, split out of
# optimize_scene.gd so the SceneTree driver stays thin (house pattern: class_name static utils in
# tools/lib/, referenced by bare class name — see NodeBuilder).
#
# Owns loading/validating the --hints sidecar and MATERIALIZING each matched hint onto its
# MeshInstance3D. The group/meta names below are a CONTRACT: smoke_binding.gd's hints mode asserts
# the optimized scene carries exactly these groups, so the two files MUST agree. A matched node is
# marked a "survivor" (its instance id recorded in the caller's `hinted_ids`) so the grouping pass
# keeps it OUT of instancing — it stays a real MeshInstance3D.
class_name TwinHints
extends RefCounted

# --- hint materialization contract (MUST match smoke_binding.gd's hints-mode assertions) -------

## Schema version the sidecar must declare ({"version":1,...}); a mismatch is warned, not fatal.
const SCHEMA_VERSION := 1

## IFC GlobalId length in chars. Hint keys join to node names on this prefix, exactly as the join
## gate does (check_twin_join.gd GUID_LEN / binding_map.gd GLOBALID_LEN — all three are the same
## buildingSMART fact: a GlobalId is 22 base64 chars). Godot dedup suffixes ("<guid>2") are peeled
## by matching the first GUID_LEN chars.
const GUID_LEN := 22

## Group put on a node hinted `no_instance` — it survives as a MeshInstance3D. smoke_binding.gd
## asserts a node in this group exists in the optimized scene.
const GROUP_NO_INSTANCE := "twin_no_instance"

## Group put on a node hinted `occluder`. smoke_binding.gd asserts a node in this group exists.
const GROUP_OCCLUDER := "twin_occluder"

## Meta carrying the hinted LOD end distance (float, metres); mirrored to visibility_range_end.
const META_LOD_END := "twin_lod_end"

## Meta carrying the hinted tag list (PackedStringArray).
const META_TAGS := "twin_tags"

## Occluder box size as a fraction of the mesh's local AABB. 0.9 == 90 %: shrinking the box keeps
## its faces just inside the visible geometry so a surface never occludes itself at grazing angles.
const OCCLUDER_SHRINK := 0.9


## Load, validate, and apply the hint sidecar to `meshes`, recording survivors in `hinted_ids`
## (instance id -> true) so the caller's grouping skips them. `display_path` is the user-facing
## path (for warnings); `abs_path` is the globalized path actually read. An empty `display_path`
## means no --hints was given → a no-op report. Returns the optimizer report fields:
## {hints_file, hints_applied, hints_unmatched} (unmatched keys sorted).
static func apply(
	meshes: Array[MeshInstance3D], display_path: String, abs_path: String, hinted_ids: Dictionary
) -> Dictionary:
	if display_path == "":
		return {"hints_file": "", "hints_applied": 0, "hints_unmatched": []}
	var hints := _load(abs_path, display_path)
	var matched_keys := {}
	var applied := 0
	for mi: MeshInstance3D in meshes:
		var key := _match_key(String(mi.name), hints)
		if key == "":
			continue
		var h: Variant = hints[key]
		if h is Dictionary:
			var hd: Dictionary = h
			hinted_ids[mi.get_instance_id()] = true
			_materialize(mi, hd)
			matched_keys[key] = true
			applied += 1
	var unmatched: Array[String] = []
	for k: String in hints.keys():
		if not matched_keys.has(k):
			unmatched.append(k)
	unmatched.sort()
	return {"hints_file": display_path, "hints_applied": applied, "hints_unmatched": unmatched}


## The hint key that matches `node_name`: an exact hit, else the GUID_LEN-char prefix (peeling
## Godot's dedup suffix, the same join rule the gate uses). "" if neither is present in `hints`.
static func _match_key(node_name: String, hints: Dictionary) -> String:
	if hints.has(node_name):
		return node_name
	if node_name.length() >= GUID_LEN and hints.has(node_name.substr(0, GUID_LEN)):
		return node_name.substr(0, GUID_LEN)
	return ""


## Read {"version":1,"hints":{GlobalId->hint}} at `abs_path`, returning the inner GlobalId->hint
## map (or {} when empty/unreadable/not-an-object). A version other than SCHEMA_VERSION is warned
## but still read — best-effort, never fatal.
static func _load(abs_path: String, display_path: String) -> Dictionary:
	var txt := FileAccess.get_file_as_string(abs_path)
	var parsed: Variant = JSON.parse_string(txt) if txt != "" else null
	if not (parsed is Dictionary):
		push_warning("OPTIMIZE: hints file empty/unreadable/not-an-object: %s" % display_path)
		return {}
	var doc: Dictionary = parsed
	if doc.get("version", 0) != SCHEMA_VERSION:
		push_warning(
			(
				"OPTIMIZE: hints version != %d (got %s): %s"
				% [SCHEMA_VERSION, doc.get("version"), display_path]
			)
		)
	var inner: Variant = doc.get("hints", {})
	return inner if inner is Dictionary else {}


## Materialize one hint onto `mi`: no_instance/occluder groups, an occluder child (forced,
## bypassing the volume gate), a LOD end distance, and a tag list. Group/meta names are the gate
## contract (constants above).
static func _materialize(mi: MeshInstance3D, h: Dictionary) -> void:
	if h.get("no_instance", false) == true:
		mi.add_to_group(GROUP_NO_INSTANCE, true)
	if h.get("occluder", false) == true:
		mi.add_to_group(GROUP_OCCLUDER, true)
		add_occluder(mi)  # forced regardless of --occluders / the volume gate
	if h.has("lod_end"):
		var end_m := float(str(h["lod_end"]))
		mi.visibility_range_end = end_m
		mi.set_meta(META_LOD_END, end_m)
	var raw_tags: Variant = h.get("tags")
	if raw_tags is Array:
		var tags := PackedStringArray()
		for t: Variant in raw_tags:
			tags.append(str(t))
		mi.set_meta(META_TAGS, tags)


## Add a child OccluderInstance3D whose BoxOccluder3D is OCCLUDER_SHRINK of `mi`'s local AABB,
## centred on that AABB. Shared by the hint pass (forced) and the driver's --occluders volume pass.
static func add_occluder(mi: MeshInstance3D) -> void:
	var local := mi.mesh.get_aabb()
	var occ := BoxOccluder3D.new()
	occ.size = local.size * OCCLUDER_SHRINK
	var oi := OccluderInstance3D.new()
	oi.name = "TwinOccluder"
	oi.occluder = occ
	oi.position = local.get_center()
	mi.add_child(oi)
