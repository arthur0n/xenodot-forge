# playback.gd — the recording player: feeds a loaded twin-recording into the SAME
# binding runtime as live data by injecting frames through the DataBus seam
# (data_bus.gd inject_frame). Bindings, labels and the overlay readout never know
# playback exists — they see only DataBus signals (the pinned Phase-4 consumer
# invariant). Plain Node composed under Main (like binding_map.gd), NOT an autoload —
# the DataBus stays the viewer's one justified singleton; this finds it by path.
#
# Determinism contract (the Phase-4 playback gate relies on this): the clock is pure
# accumulated `delta * speed` — never a wall-clock read — and due frames are emitted in
# file order, so two runs over the same file with the same play/seek/set_speed calls
# emit identical (tag, value, seq) sequences. Under `--headless --fixed-fps N` every
# delta is constant, which makes runs FRAME-exact reproducible, not just order-exact.
#
# Parsing/validation and the time queries live in core/recording.gd (split so each file
# stays small and the recording format has exactly one home on the viewer side).
extends Node

## Continuous transport state for the HUD (overlay/timeline.gd). Rate-limited to
## HUD_UPDATE_HZ while playing; discrete transitions (load/play/pause/seek/end) always
## emit immediately so the HUD never shows a stale state.
signal playback_state(playing: bool, position_ms: int, duration_ms: int)

## Emitted once per successful load_recording() — the timeline bar reveals itself on this.
signal playback_loaded(duration_ms: int, tag_count: int)

# Typed handles, by preload — the per-file `--check-only` gate does not inject autoload
# names (godot-code-rules), and the recording model is a plain RefCounted script.
const DataBusScript := preload("res://core/data_bus.gd")
const RecordingScript := preload("res://core/recording.gd")

# playback_state rate while playing, Hz. 10 Hz keeps the slider/time label visibly
# smooth (and matches the sim's default publish rate) while staying well below
# per-frame signal spam at 60 fps. Discrete transitions bypass this limit.
const HUD_UPDATE_HZ := 10.0

# set_speed() clamp bounds. SPEED_MIN equals the slowest timeline UI step and SPEED_MAX
# sits one doubling above its fastest (overlay/timeline.gd SPEED_STEPS — the two files
# cross-reference each other; change them together) so scripted callers get headroom.
# Zero/negative is excluded outright: it would stall or reverse the clock, which the
# ascending-t_ms recording format cannot express.
const SPEED_MIN := 0.25
const SPEED_MAX := 8.0

# Boot rate: real time — one recorded ms per wall-clock ms, the least surprising default.
const SPEED_DEFAULT := 1.0

var _recording: RecordingScript = RecordingScript.new()  # empty (loaded==false) until load
var _playing := false
var _speed := SPEED_DEFAULT
var _position_ms := 0.0  # float ms accumulator; rounded to int only at the API boundary
var _cursor := 0  # index into _recording.frames of the NEXT frame to emit
var _hud_cooldown := 0.0  # seconds until the next rate-limited playback_state

@onready var _data_bus: DataBusScript = get_node("/root/DataBus")


func _process(delta: float) -> void:
	if not _playing:
		return
	_position_ms += delta * _speed * DataBusScript.MSEC_PER_SEC
	_emit_due_frames()
	if _at_end():
		# End of recording: pause AT the end — no auto-loop (a surprise restart is worse
		# than a stopped bar; replay is an explicit seek(0) + play()).
		_position_ms = float(_recording.duration_ms)
		_playing = false
		_emit_state()
		return
	_hud_cooldown -= delta
	if _hud_cooldown <= 0.0:
		_hud_cooldown = 1.0 / HUD_UPDATE_HZ
		_emit_state()


## Parse + validate the NDJSON recording at `path` (absolute or res://). On success the
## DataBus switches to MODE_PLAYBACK (closing the live socket — see data_bus.set_mode: a
## live frame mid-scrub would fight the timeline), the position rewinds to 0, and
## playback_loaded plus a paused playback_state fire; the caller decides when to play().
## On failure the parser already push_warning'd, nothing is emitted, the DataBus is
## untouched, and the viewer stays fully live. Named load_recording (not `load`) to
## avoid shadowing GDScript's global load().
func load_recording(path: String) -> bool:
	var parsed: RecordingScript = RecordingScript.new()
	if not parsed.load_file(path):
		return false
	_recording = parsed
	_playing = false
	_position_ms = 0.0
	_cursor = 0
	_hud_cooldown = 0.0
	_data_bus.set_mode(DataBusScript.MODE_PLAYBACK)
	playback_loaded.emit(_recording.duration_ms, _recording.tag_count())
	_emit_state()
	return true


## Start/resume the clock. No-op when nothing is loaded, already playing, or the end was
## reached (no auto-restart — see the no-auto-loop note in _process).
func play() -> void:
	if not _recording.loaded or _playing or _at_end():
		return
	_playing = true
	_emit_state()


## Freeze the clock. Position is kept; consumers keep their last-injected values.
func pause() -> void:
	if not _playing:
		return
	_playing = false
	_emit_state()


## Jump to `t_ms` (clamped to [0, duration]). Pinned seek semantics: emit ONE snapshot
## frame per tag — the last frame with t_ms <= T, in header-tag order (the FIXED order
## keeps runs deterministic); tags with no frame yet emit nothing. Playback then
## continues forward from T at the current speed; play/pause state is unchanged.
func seek(t_ms: int) -> void:
	if not _recording.loaded:
		return
	var target := clampi(t_ms, 0, _recording.duration_ms)
	for frame: RecordingScript.Frame in _recording.snapshot_at(target):
		_data_bus.inject_frame(frame.tag, frame.value, frame.seq)
	_position_ms = float(target)
	_cursor = _recording.first_index_after(target)
	_emit_state()


## Set the rate multiplier, clamped to [SPEED_MIN, SPEED_MAX]. Out-of-range values are
## push_warning'd and clamped — a bad caller value must not stall or reverse the clock.
func set_speed(multiplier: float) -> void:
	if multiplier < SPEED_MIN or multiplier > SPEED_MAX:
		push_warning(
			"playback: speed %f outside [%f, %f] — clamped" % [multiplier, SPEED_MIN, SPEED_MAX]
		)
	_speed = clampf(multiplier, SPEED_MIN, SPEED_MAX)


func speed() -> float:
	return _speed


func is_playing() -> bool:
	return _playing


func is_loaded() -> bool:
	return _recording.loaded


func duration_ms() -> int:
	return _recording.duration_ms


func position_ms() -> int:
	return roundi(_position_ms)


# True once the clock passed the last frame AND that frame was emitted. The cursor check
# matters when the final frames share t_ms == duration: the clock can reach the end on
# the same tick that still has frames to drain.
func _at_end() -> bool:
	return _cursor >= _recording.frames.size() and _position_ms >= float(_recording.duration_ms)


# Emit, in file order, every frame whose t_ms the clock has passed. Emits are synchronous:
# consumers (binding_map, labels) update inside this call, exactly like a live packet.
func _emit_due_frames() -> void:
	var total := _recording.frames.size()
	while _cursor < total:
		var frame: RecordingScript.Frame = _recording.frames[_cursor]
		if float(frame.t_ms) > _position_ms:
			break
		_data_bus.inject_frame(frame.tag, frame.value, frame.seq)
		_cursor += 1


func _emit_state() -> void:
	playback_state.emit(_playing, roundi(_position_ms), _recording.duration_ms)
