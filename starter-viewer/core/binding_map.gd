# binding_map.gd — the data-binding runtime. Loads an agent-emitted binding map
# (binding_map.json), joins each tag to model geometry by IFC GlobalId, and drives a
# per-target visual response from the live DataBus stream.
#
# Pipeline (all at scene (re)load, then per DataBus frame):
#  1. load_map(path)   — read + validate JSON. Unknown keys tolerated; a binding missing a
#                        required field is push_warning'd and SKIPPED, never fatal.
#  2. build_index(root)— one tree walk of `root`: GlobalId -> Array[Locator]. A node whose
#                        name is a 22-char IFC GlobalId yields a "node" locator; a
#                        MultiMeshInstance3D carrying meta "twin_globalids"
#                        (PackedStringArray, index = instance position) yields one "mmi"
#                        locator per entry. Duplicate GlobalIds -> many locators, all driven.
#  3. tag_update       — normalize value into the binding's [min,max], colour = ramp lerp,
#                        apply to every resolved target ("albedo_ramp" or "label").
#
# This is a plain Node (added under Main), NOT an autoload: the DataBus is the viewer's one
# justified singleton; everything else composes. Consumes ONLY the DataBus contract
# (tag_update / connection_changed), like every other binder.
extends Node

## Emitted after build_index — (resolved bindings, total bindings) for the HUD.
signal bindings_rebuilt(resolved: int, total: int)

# Typed handle on the DataBus autoload — by path, not the `DataBus` global (the per-file
# `--check-only` gate does not inject autoload names; see godot-code-rules).
const DataBusScript := preload("res://core/data_bus.gd")
const TagLabel3DScript := preload("res://overlay/tag_label_3d.gd")

# IFC GlobalId: exactly 22 chars from the buildingSMART base64 alphabet. Godot's node-name
# dedup can suffix a name, so we key on the 22-char prefix (matches twin-import's join rule).
const GLOBALID_LEN := 22
const GLOBALID_CHARS := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"

const RESPONSE_ALBEDO := "albedo_ramp"
const RESPONSE_LABEL := "label"
const LABEL_MARGIN := 0.35  # metres above the target's AABB / instance origin


# One validated binding row. min/max are named *_value to dodge SHADOWED_GLOBAL_IDENTIFIER
# against the global min()/max().
class Binding:
	var tag: String
	var globalid: String
	var min_value: float
	var max_value: float
	var response: String
	var ramp_low: Color
	var ramp_high: Color
	var targets: Array[Target] = []


# A resolved render site. "node": drive `geom.material_override`; "mmi": drive
# `mmi.multimesh.set_instance_color(index, …)`. Render caches (material/label/warned) live
# per-target so duplicate GlobalIds each keep their own state.
class Target:
	var kind: String
	var host: Node3D  # geometry node ("node") or the MultiMeshInstance3D ("mmi")
	var index: int = -1
	var material: StandardMaterial3D = null
	var label: Label3D = null  # a TagLabel3D; stored as its base to avoid the class_name in isolation
	var warned: bool = false


# A GlobalId hit found during the tree walk, before it becomes a per-binding Target.
class Locator:
	var kind: String
	var host: Node3D
	var index: int = -1


## Read once after build; total bindings that resolved to >= 1 target, and the map size.
var resolved_count := 0
var total_count := 0

var _data_bus: DataBusScript
var _bindings: Array[Binding] = []
var _by_tag := {}  # tag(String) -> Binding
var _index := {}  # globalid(String) -> Array[Locator]


func _ready() -> void:
	_data_bus = get_node("/root/DataBus")
	_data_bus.tag_update.connect(_on_data_bus_tag_update)


## Load + validate the binding map at `path` (res://… or absolute). Returns the number of
## valid bindings parsed. A malformed file or bad root logs a warning and yields 0 — never
## crashes the viewer.
func load_map(path: String) -> int:
	_bindings.clear()
	_by_tag.clear()
	if not FileAccess.file_exists(path):
		push_warning("binding_map: no map at '%s' — 0 bindings" % path)
		return 0
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("binding_map: '%s' is not a JSON object — 0 bindings" % path)
		return 0
	var root_obj: Dictionary = parsed
	var raw_list: Variant = root_obj.get("bindings")
	if typeof(raw_list) != TYPE_ARRAY:
		push_warning("binding_map: '%s' has no 'bindings' array — 0 bindings" % path)
		return 0
	var list: Array = raw_list
	for raw: Variant in list:
		var binding := _parse_binding(raw)
		if binding != null:
			_bindings.append(binding)
			# A tag drives ONE binding; a re-bind silently last-wins here, so name both GlobalIds
			# loudly — a duplicate tag in the map is almost always an authoring mistake.
			if _by_tag.has(binding.tag):
				var prior: Binding = _by_tag[binding.tag]
				push_warning(
					(
						"binding_map: tag '%s' bound twice — GlobalId '%s' now wins over '%s' (last wins)"
						% [binding.tag, binding.globalid, prior.globalid]
					)
				)
			_by_tag[binding.tag] = binding
	return _bindings.size()


## Walk `root` once, build the GlobalId -> Locator index, resolve every binding's targets,
## and (re)wire the response caches. Safe to call again on a scene/model reload.
func build_index(root: Node) -> void:
	_index.clear()
	if root != null:
		_walk(root)
	resolved_count = 0
	total_count = _bindings.size()
	for binding: Binding in _bindings:
		binding.targets = _collect_targets(binding)
		if not binding.targets.is_empty():
			resolved_count += 1
		else:
			# A stale map is a real bug — be loud, per the twin-bind-data contract.
			push_warning(
				(
					"binding_map: GlobalId '%s' (tag %s) resolved 0 targets"
					% [binding.globalid, binding.tag]
				)
			)
	bindings_rebuilt.emit(resolved_count, total_count)


## Public read surface for verification gates (twin-verify binding smoke): resolved-target counts
## by kind, plus how many "mmi" targets are actually DRIVABLE (a MultiMesh with use_colors and the
## instance index in range). Lets a gate assert the write path is wired without reaching into the
## private binding list. Returns {"node": int, "mmi": int, "wired_mmi": int}.
func target_counts() -> Dictionary:
	var node_count := 0
	var mmi_count := 0
	var wired_mmi := 0
	for binding: Binding in _bindings:
		for target: Target in binding.targets:
			if target.kind == "node":
				node_count += 1
			elif target.kind == "mmi":
				mmi_count += 1
				if _is_mmi_wired(target):
					wired_mmi += 1
	return {"node": node_count, "mmi": mmi_count, "wired_mmi": wired_mmi}


func _is_mmi_wired(target: Target) -> bool:
	if not (target.host is MultiMeshInstance3D):
		return false
	var mmi: MultiMeshInstance3D = target.host
	var mm := mmi.multimesh
	return mm != null and mm.use_colors and target.index >= 0 and target.index < mm.instance_count


## Public read surface for verification gates: the current albedo of every DRIVEN "node" target
## (one whose per-target override material has been created by a tag update). Iteration order is
## stable across calls, so a gate can sample twice ~1 s apart and diff to prove LIVE driving.
func driven_node_albedos() -> Array[Color]:
	var out: Array[Color] = []
	for binding: Binding in _bindings:
		for target: Target in binding.targets:
			if target.kind == "node" and target.material != null:
				out.append(target.material.albedo_color)
	return out


func _parse_binding(raw: Variant) -> Binding:
	if typeof(raw) != TYPE_DICTIONARY:
		push_warning("binding_map: skipped a non-object binding entry")
		return null
	var row: Dictionary = raw
	if (
		typeof(row.get("tag")) != TYPE_STRING
		or typeof(row.get("globalid")) != TYPE_STRING
		or typeof(row.get("response")) != TYPE_STRING
	):
		push_warning("binding_map: skipped a binding missing tag/globalid/response")
		return null
	var lo := _to_float(row.get("min"))
	var hi := _to_float(row.get("max"))
	if is_nan(lo) or is_nan(hi):
		push_warning("binding_map: skipped '%s' — min/max not numeric" % row["tag"])
		return null
	var ramp := _parse_ramp(row.get("ramp"))
	if ramp.is_empty():
		push_warning("binding_map: skipped '%s' — ramp needs two colour strings" % row["tag"])
		return null
	var binding := Binding.new()
	binding.tag = row["tag"]
	binding.globalid = row["globalid"]
	binding.min_value = lo
	binding.max_value = hi
	binding.response = row["response"]
	binding.ramp_low = ramp[0]
	binding.ramp_high = ramp[1]
	return binding


# Two-colour ramp -> [low, high], or [] if malformed. JSON numbers arrive as float; a
# hex string like "#00ff00" must be a valid Color.html.
func _parse_ramp(raw: Variant) -> Array[Color]:
	if typeof(raw) != TYPE_ARRAY:
		return []
	var arr: Array = raw
	if arr.size() != 2:
		return []
	var out: Array[Color] = []
	for entry: Variant in arr:
		if typeof(entry) != TYPE_STRING:
			return []
		var hex: String = entry
		if not Color.html_is_valid(hex):
			return []
		out.append(Color.html(hex))
	return out


func _to_float(raw: Variant) -> float:
	var t := typeof(raw)
	if t == TYPE_FLOAT or t == TYPE_INT:
		var f: float = raw
		return f
	return NAN


# One depth-first pass: record every GlobalId site. A node can be BOTH a named geometry site
# and (if it is an optimized MultiMeshInstance3D) a set of instance sites.
func _walk(node: Node) -> void:
	if node is Node3D:
		var node3d: Node3D = node
		if node3d.has_meta("twin_globalids"):
			_index_mmi(node3d)
		var gid := _globalid_from_name(node3d.name)
		if gid != "":
			_add_locator(gid, "node", node3d, -1)
	for child: Node in node.get_children():
		_walk(child)


func _index_mmi(node: Node3D) -> void:
	var raw: Variant = node.get_meta("twin_globalids")
	var ids := PackedStringArray()
	if raw is PackedStringArray:
		ids = raw
	elif raw is Array:
		var arr: Array = raw
		for entry: Variant in arr:
			ids.append(str(entry))
	for i in ids.size():
		_add_locator(ids[i], "mmi", node, i)


func _add_locator(globalid: String, kind: String, host: Node3D, index: int) -> void:
	var loc := Locator.new()
	loc.kind = kind
	loc.host = host
	loc.index = index
	var bucket: Array[Locator] = _index.get(globalid, [] as Array[Locator])
	bucket.append(loc)
	_index[globalid] = bucket


# The GlobalId carried by a node name, or "" if the name isn't one. Godot dedup can suffix
# ("Guid@2"), so we take the 22-char prefix and confirm the IFC base64 alphabet — that keeps
# WorldEnvironment / CameraRig / etc. out of the index.
func _globalid_from_name(node_name: String) -> String:
	if node_name.length() < GLOBALID_LEN:
		return ""
	var prefix := node_name.substr(0, GLOBALID_LEN)
	for i in GLOBALID_LEN:
		if GLOBALID_CHARS.find(prefix[i]) == -1:
			return ""
	return prefix


func _collect_targets(binding: Binding) -> Array[Target]:
	var out: Array[Target] = []
	var locators: Array[Locator] = _index.get(binding.globalid, [] as Array[Locator])
	for loc: Locator in locators:
		var target := Target.new()
		target.kind = loc.kind
		target.host = loc.host
		target.index = loc.index
		out.append(target)
	return out


func _on_data_bus_tag_update(tag: String, value: float, _seq: int, _latency_ms: float) -> void:
	var binding: Binding = _by_tag.get(tag)
	if binding == null:
		return
	var t := 1.0
	if not is_equal_approx(binding.min_value, binding.max_value):
		t = clampf(inverse_lerp(binding.min_value, binding.max_value, value), 0.0, 1.0)
	var colour := binding.ramp_low.lerp(binding.ramp_high, t)
	for target: Target in binding.targets:
		if binding.response == RESPONSE_ALBEDO:
			_apply_albedo(target, colour)
		elif binding.response == RESPONSE_LABEL:
			_ensure_label(target, binding)


func _apply_albedo(target: Target, colour: Color) -> void:
	if target.kind == "mmi":
		_apply_mmi_colour(target, colour)
		return
	if not (target.host is GeometryInstance3D):
		if not target.warned:
			target.warned = true
			push_warning("binding_map: albedo_ramp target '%s' is not geometry" % target.host.name)
		return
	var geom: GeometryInstance3D = target.host
	if target.material == null:
		# A fresh per-target override — never mutate the shared/imported material.
		target.material = StandardMaterial3D.new()
		geom.material_override = target.material
	target.material.albedo_color = colour


func _apply_mmi_colour(target: Target, colour: Color) -> void:
	if not (target.host is MultiMeshInstance3D):
		return
	var mmi: MultiMeshInstance3D = target.host
	var mm := mmi.multimesh
	if mm == null:
		return
	if not mm.use_colors:
		if not target.warned:
			target.warned = true
			push_warning(
				(
					"binding_map: MultiMesh '%s' has use_colors=false — skipping instance colour"
					% mmi.name
				)
			)
		return
	if target.index >= 0 and target.index < mm.instance_count:
		mm.set_instance_color(target.index, colour)


# The "label" response reuses the TagLabel3D binder: spawn one above the target ONCE, then it
# self-updates from the DataBus (text + green→red ramp). No per-frame work here after spawn.
func _ensure_label(target: Target, binding: Binding) -> void:
	if target.label != null:
		return
	var label := TagLabel3DScript.new()
	label.tag = binding.tag
	label.value_min = binding.min_value
	label.value_max = binding.max_value
	target.label = label
	target.host.add_child(label)
	label.position = _label_offset(target)


func _label_offset(target: Target) -> Vector3:
	if target.kind == "mmi" and target.host is MultiMeshInstance3D:
		var mmi: MultiMeshInstance3D = target.host
		var mm := mmi.multimesh
		if mm != null and target.index >= 0 and target.index < mm.instance_count:
			var origin := mm.get_instance_transform(target.index).origin
			return origin + Vector3(0.0, LABEL_MARGIN, 0.0)
	if target.host is VisualInstance3D:
		var vis: VisualInstance3D = target.host
		var aabb := vis.get_aabb()
		return Vector3(0.0, aabb.position.y + aabb.size.y + LABEL_MARGIN, 0.0)
	return Vector3(0.0, LABEL_MARGIN, 0.0)
