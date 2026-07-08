# timeline.gd — playback scrub bar (bottom-of-screen Control HUD): play/pause button,
# speed cycle, position slider (drag = seek), current/total time label. This is the ONE
# consumer allowed to know playback exists — it IS the playback control surface;
# everything else (bindings, overlay readout, labels) stays a pure DataBus consumer per
# the Phase-4 invariant. main.gd instances this scene next to the Playback node and
# wires the pair with bind_playback(). Hidden until the player's playback_loaded fires —
# a live-only viewer never shows it.
#
# Keys: Space = play/pause toggle, only while the bar is visible (see CLAUDE.md).
extends Control

const PlaybackScript := preload("res://core/playback.gd")

# Speed-cycle ladder: the standard media-player halving/doubling steps around 1.0 (real
# time). Every step MUST stay inside playback.gd's [SPEED_MIN, SPEED_MAX] clamp — the
# two files cross-reference each other; change them together.
const SPEED_STEPS: Array[float] = [0.25, 0.5, 1.0, 2.0, 4.0]

# Index of 1.0 in SPEED_STEPS — playback boots at real time, the least surprising rate
# (must match playback.gd's SPEED_DEFAULT).
const SPEED_DEFAULT_INDEX := 2

# Slider granularity in ms: 1 ms is the recording format's native resolution (t_ms is
# an integer), so a drag can land exactly on any frame's timestamp.
const SLIDER_STEP_MS := 1.0

# Unit conversions for the m:ss time label. Integer twins of data_bus.gd's float
# MSEC_PER_SEC — same physical constants; ints here because the label math is integer.
const MSEC_PER_SEC := 1000
const SEC_PER_MIN := 60

const PLAY_TEXT := "Play"  # button label while paused (pressing starts playback)
const PAUSE_TEXT := "Pause"  # button label while playing (pressing pauses)

var _playback: PlaybackScript
var _speed_index := SPEED_DEFAULT_INDEX
var _dragging := false  # mid-drag: playback_state must not move the slider under the hand

@onready var _play_button: Button = %PlayButton
@onready var _speed_button: Button = %SpeedButton
@onready var _slider: HSlider = %PositionSlider
@onready var _time_label: Label = %TimeLabel


func _ready() -> void:
	visible = false  # revealed by _on_playback_playback_loaded — never shown without a recording
	_slider.step = SLIDER_STEP_MS
	_play_button.pressed.connect(_on_play_button_pressed)
	_speed_button.pressed.connect(_on_speed_button_pressed)
	_slider.drag_started.connect(_on_position_slider_drag_started)
	_slider.drag_ended.connect(_on_position_slider_drag_ended)
	_slider.value_changed.connect(_on_position_slider_value_changed)


func _unhandled_key_input(event: InputEvent) -> void:
	if not visible or _playback == null:
		return
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_SPACE:
		_toggle_play()
		get_viewport().set_input_as_handled()


## Wire this bar to the player. main.gd calls this right after instancing BOTH, before
## the recording loads, so playback_loaded is never missed. The only public entry point.
func bind_playback(player: PlaybackScript) -> void:
	_playback = player
	_playback.playback_loaded.connect(_on_playback_playback_loaded)
	_playback.playback_state.connect(_on_playback_playback_state)


func _toggle_play() -> void:
	if _playback.is_playing():
		_playback.pause()
	else:
		_playback.play()


func _apply_speed() -> void:
	var speed: float = SPEED_STEPS[_speed_index]
	_playback.set_speed(speed)
	_speed_button.text = "%sx" % String.num(speed)


# m:ss (minutes unpadded — recordings are minutes, not hours). `%` is modulo, not
# integer division, so the strict int-division warning stays quiet.
func _format_ms(ms: int) -> String:
	var total_sec := floori(float(ms) / float(MSEC_PER_SEC))
	var minutes := floori(float(total_sec) / float(SEC_PER_MIN))
	var seconds := total_sec % SEC_PER_MIN
	return "%d:%02d" % [minutes, seconds]


func _on_playback_playback_loaded(duration_ms: int, _tag_count: int) -> void:
	_slider.max_value = float(duration_ms)
	_apply_speed()  # push the default step into the player so the button and engine agree
	visible = true


func _on_playback_playback_state(playing: bool, position_ms: int, duration_ms: int) -> void:
	_play_button.text = PAUSE_TEXT if playing else PLAY_TEXT
	_time_label.text = "%s / %s" % [_format_ms(position_ms), _format_ms(duration_ms)]
	if not _dragging:
		# set_value_no_signal: programmatic moves must not loop back into seek() —
		# value_changed stays a pure "the USER moved the slider" event.
		_slider.set_value_no_signal(float(position_ms))


func _on_play_button_pressed() -> void:
	_toggle_play()


func _on_speed_button_pressed() -> void:
	_speed_index = (_speed_index + 1) % SPEED_STEPS.size()
	_apply_speed()


func _on_position_slider_drag_started() -> void:
	_dragging = true


func _on_position_slider_drag_ended(_value_changed: bool) -> void:
	_dragging = false


func _on_position_slider_value_changed(value: float) -> void:
	_playback.seek(roundi(value))
