# overlay.gd — minimal HUD (CanvasLayer): DataBus source status (LIVE / PLAYBACK /
# OFFLINE), tag traffic (distinct tags seen + last update), and FPS. Pure consumer of
# the DataBus contract — signals plus the public `mode` field; it never touches the
# player. Extend it per twin, or replace it wholesale.
extends CanvasLayer

# Typed handle on the DataBus autoload. Resolved by PATH, not by the `DataBus`
# global: the per-file `--check-only` gate does not inject autoload names
# (godot-code-rules), while /root/<key> + a preload-typed var stays analyzable.
const DataBusScript := preload("res://core/data_bus.gd")

# Status-line colours. LIVE green = healthy socket; PLAYBACK amber = recorded data (the
# HUD must never let a recording impersonate live truth — amber flags "not live" without
# screaming "broken"); OFFLINE red-ish = socket down, retrying.
const STATUS_LIVE_COLOR := Color(0.35, 0.85, 0.45)
const STATUS_PLAYBACK_COLOR := Color(0.95, 0.72, 0.25)
const STATUS_OFFLINE_COLOR := Color(0.9, 0.5, 0.35)

var _seen_tags := {}  # tag -> true (distinct-tag set)
var _last_line := "waiting for data"

@onready var _data_bus: DataBusScript = get_node("/root/DataBus")
@onready var _status_label: Label = %StatusLabel
@onready var _tags_label: Label = %TagsLabel
@onready var _fps_label: Label = %FpsLabel
@onready var _bindings_label: Label = %BindingsLabel


func _ready() -> void:
	_data_bus.connection_changed.connect(_on_data_bus_connection_changed)
	_data_bus.tag_update.connect(_on_data_bus_tag_update)
	_on_data_bus_connection_changed(_data_bus.is_up())


func _process(_delta: float) -> void:
	_fps_label.text = "fps: %d" % int(Engine.get_frames_per_second())
	_tags_label.text = "tags: %d | %s" % [_seen_tags.size(), _last_line]


# Source truth for the status line: DataBus mode first (playback closes the socket, so
# `up` is always false there — see data_bus.set_mode), then socket state.
func _on_data_bus_connection_changed(up: bool) -> void:
	if _data_bus.mode == DataBusScript.MODE_PLAYBACK:
		_status_label.text = "DataBus: PLAYBACK (recording)"
		_status_label.modulate = STATUS_PLAYBACK_COLOR
	elif up:
		_status_label.text = "DataBus: LIVE (%s)" % _data_bus.url
		_status_label.modulate = STATUS_LIVE_COLOR
	else:
		_status_label.text = "DataBus: OFFLINE — retrying %s" % _data_bus.url
		_status_label.modulate = STATUS_OFFLINE_COLOR


func _on_data_bus_tag_update(tag: String, value: float, seq: int, latency_ms: float) -> void:
	_seen_tags[tag] = true
	_last_line = "%s=%.3f seq=%d lat=%.1fms" % [tag, value, seq, latency_ms]


## Report how many of the binding map's rows resolved to model geometry (set by main.gd after
## the resolution index is built). N/M below M signals a stale map — a GlobalId that missed.
func set_bindings(resolved: int, total: int) -> void:
	_bindings_label.text = "bindings: %d/%d resolved" % [resolved, total]
