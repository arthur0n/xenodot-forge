# data_bus.gd — the "DataBus" autoload. Live tag stream over WebSocketPeer.
#
# Contract (consumed by overlay/, tag_label_3d.gd, and later data-binders):
#   signal tag_update(tag: String, value: float, seq: int, latency_ms: float)
#   signal connection_changed(up: bool)
# One JSON object per packet: {"tag": String, "value": float, "seq": int, "sent_ms": float}.
#
# Gotchas handled (learned in the s2-live spike):
#  - WebSocketPeer.poll() MUST be called every frame or nothing happens.
#  - connect_to_url() is async: returns OK immediately, state goes
#    STATE_CONNECTING -> STATE_OPEN (or CLOSED on failure). Check get_ready_state().
#  - Drain ALL pending packets each frame (get_available_packet_count loop),
#    otherwise a 10 Hz stream backs up behind a 60 fps consumer under hiccups.
#  - Reconnect: a CLOSED peer cannot be reused reliably -> allocate a fresh
#    WebSocketPeer for every connection attempt.
#  - Seq tracking resets on disconnect: the source keeps counting while we are
#    away, so carrying first/last seq across reconnects would report the outage
#    as drops and break the expected-frames math.
extends Node

signal tag_update(tag: String, value: float, seq: int, latency_ms: float)
signal connection_changed(up: bool)

# Default tag-source URL. The :8765 port is the sim's DEFAULT_PORT (plugin-twin/tools/sim/
# server.js) — a sim started with no --port pairs with a default viewer out of the box. (The
# verify_twin.sh gate deliberately runs its own sim on 8899 instead, to avoid colliding with a
# dev-running sim on 8765.)
const DEFAULT_URL := "ws://localhost:8765"
const CONFIG_PATH := "res://viewer.cfg"

# Seconds to wait before re-opening after a CLOSED peer. 1 s is long enough that a downed source
# isn't hammered with reconnect spam, short enough that recovery feels immediate once it returns.
const RECONNECT_DELAY := 1.0

# Milliseconds per second — Time.get_unix_time_from_system() returns seconds; the wire carries ms.
const MSEC_PER_SEC := 1000.0

## WebSocket URL of the tag source. Default comes from viewer.cfg ([viewer] url=...)
## when present, else DEFAULT_URL. Set it before the next (re)connect to redirect.
var url: String = DEFAULT_URL

# --- stats counters (read by the overlay / twin-verify reports) ---
var frames_received := 0
var drops := 0
var reconnects := 0
var latency_min_ms := INF
var latency_max_ms := 0.0

var _latency_sum_ms := 0.0
var _ws: WebSocketPeer
var _was_open := false
var _reconnect_cooldown := 0.0
var _first_seq := {}  # tag -> first seq seen (this connection)
var _last_seq := {}  # tag -> last seq seen (this connection)


func _ready() -> void:
	if FileAccess.file_exists(CONFIG_PATH):
		var cfg := ConfigFile.new()
		if cfg.load(CONFIG_PATH) == OK:
			url = str(cfg.get_value("viewer", "url", DEFAULT_URL))
	_open_socket()


func _process(delta: float) -> void:
	if _reconnect_cooldown > 0.0:
		_reconnect_cooldown -= delta
		if _reconnect_cooldown <= 0.0:
			_open_socket()
		return

	_ws.poll()  # mandatory every frame
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not _was_open:
				_was_open = true
				connection_changed.emit(true)
			while _ws.get_available_packet_count() > 0:
				_handle_packet(_ws.get_packet())
		WebSocketPeer.STATE_CLOSED:
			if _was_open:
				_was_open = false
				reconnects += 1
				_reset_seq_tracking()
				connection_changed.emit(false)
			_reconnect_cooldown = RECONNECT_DELAY
		_:
			pass  # CONNECTING / CLOSING: just keep polling


## Force a (re)connection, optionally redirecting the source first. This is the public test/gate
## seam — the twin-verify binding smoke calls it to point the bus at its seeded sim headlessly.
## Passing `new_url` sets `url` before reopening; a fresh WebSocketPeer is always allocated (a
## CLOSED peer can't be reused). The only supported way for another script to drive a connection.
func reconnect(new_url: String = "") -> void:
	if new_url != "":
		url = new_url
	_open_socket()


func is_up() -> bool:
	return _was_open


func frames_expected() -> int:
	var total := 0
	for tag: String in _first_seq:
		var first: int = _first_seq[tag]
		var last: int = _last_seq[tag]
		total += last - first + 1
	return total


func stats() -> Dictionary:
	var avg := 0.0 if frames_received == 0 else _latency_sum_ms / frames_received
	return {
		"frames_received": frames_received,
		"frames_expected": frames_expected(),
		"drops": drops,
		"reconnects": reconnects,
		"latency_min_ms": 0.0 if frames_received == 0 else snappedf(latency_min_ms, 0.01),
		"latency_avg_ms": snappedf(avg, 0.01),
		"latency_max_ms": snappedf(latency_max_ms, 0.01),
	}


func _open_socket() -> void:
	_ws = WebSocketPeer.new()  # fresh peer per attempt (see gotcha above)
	var err := _ws.connect_to_url(url)
	if err != OK:
		# Malformed URL etc. — stay quiet-but-retrying, no per-attempt spam.
		_reconnect_cooldown = RECONNECT_DELAY


func _handle_packet(pkt: PackedByteArray) -> void:
	var parsed: Variant = JSON.parse_string(pkt.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var data: Dictionary = parsed
	# JSON numbers always parse as float; malformed/missing fields drop the packet.
	if typeof(data.get("tag")) != TYPE_STRING:
		return
	if typeof(data.get("value")) != TYPE_FLOAT or typeof(data.get("seq")) != TYPE_FLOAT:
		return
	if typeof(data.get("sent_ms")) != TYPE_FLOAT:
		return
	var tag: String = data["tag"]
	var value: float = data["value"]
	var seq_number: float = data["seq"]
	var seq := roundi(seq_number)
	var sent_ms: float = data["sent_ms"]
	var recv_ms := Time.get_unix_time_from_system() * MSEC_PER_SEC
	var latency_ms := recv_ms - sent_ms  # same machine, same clock

	frames_received += 1
	latency_min_ms = minf(latency_min_ms, latency_ms)
	latency_max_ms = maxf(latency_max_ms, latency_ms)
	_latency_sum_ms += latency_ms

	if not _first_seq.has(tag):
		_first_seq[tag] = seq
	elif _last_seq.has(tag):
		var last: int = _last_seq[tag]
		if seq > last + 1:
			drops += seq - last - 1
	_last_seq[tag] = seq

	tag_update.emit(tag, value, seq, latency_ms)


func _reset_seq_tracking() -> void:
	_first_seq.clear()
	_last_seq.clear()
