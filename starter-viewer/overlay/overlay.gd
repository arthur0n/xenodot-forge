# overlay.gd — minimal HUD (CanvasLayer): DataBus connection status, tag
# traffic (distinct tags seen + last update), and FPS. Pure consumer of the
# DataBus contract; extend it per twin, or replace it wholesale.
extends CanvasLayer

# Typed handle on the DataBus autoload. Resolved by PATH, not by the `DataBus`
# global: the per-file `--check-only` gate does not inject autoload names
# (godot-code-rules), while /root/<key> + a preload-typed var stays analyzable.
const DataBusScript := preload("res://core/data_bus.gd")

const STATUS_UP_COLOR := Color(0.35, 0.85, 0.45)
const STATUS_DOWN_COLOR := Color(0.9, 0.5, 0.35)

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


func _on_data_bus_connection_changed(up: bool) -> void:
	if up:
		_status_label.text = "DataBus: connected (%s)" % _data_bus.url
	else:
		_status_label.text = "DataBus: offline — retrying %s" % _data_bus.url
	_status_label.modulate = STATUS_UP_COLOR if up else STATUS_DOWN_COLOR


func _on_data_bus_tag_update(tag: String, value: float, seq: int, latency_ms: float) -> void:
	_seen_tags[tag] = true
	_last_line = "%s=%.3f seq=%d lat=%.1fms" % [tag, value, seq, latency_ms]


## Report how many of the binding map's rows resolved to model geometry (set by main.gd after
## the resolution index is built). N/M below M signals a stale map — a GlobalId that missed.
func set_bindings(resolved: int, total: int) -> void:
	_bindings_label.text = "bindings: %d/%d resolved" % [resolved, total]
