extends SceneTree
## tools/check_playback.gd — the playback DETERMINISM gate (skills: twin-playback, twin-verify).
##
## Proves the recorded-stream player is reproducible: the SAME twin-recording driven through the
## SAME scripted transport (load → seek → play → pause) emits the SAME (tag|value|seq) sequence,
## every run. It drives the SHIPPED runtime — the real DataBus autoload seam (core/data_bus.gd)
## and the real player (core/playback.gd) — never a reimplementation, and reads them through their
## PUBLIC surfaces only (DataBus.set_mode/inject-via-tag_update/stats; Playback.load_recording/
## seek/play/pause/position_ms/duration_ms/is_playing).
##
## Why NOT the full viewer shell (main.tscn), unlike smoke_binding.gd: main.gd auto-starts its OWN
## Playback node when it sees `--recording=` (a user arg this gate must pass) or viewer.cfg [twin]
## recording=. Two players driving one DataBus would interleave injections and corrupt the very
## sequence this gate hashes. So the gate owns the SOLE player instance and subscribes to the real
## DataBus autoload directly — that autoload IS the consumer seam, present shell or no shell.
##
## DETERMINISM CONTRACT (the whole point — cross-ref core/playback.gd's "Determinism contract"):
## What the hash covers is the EMITTED STATE — the (tag|value|seq) frames consumers see — and that
## is ORDER-EXACT: seek snapshots emit in header-tag order, and play emits due frames in file order,
## so the sequence reproduces at ANY frame rate, cold cache or warm. That is the STRONG guarantee,
## and it is what Phase-4's exit criterion asks for (same fixture + same seeks → identical
## emitted-state hash). The hash deliberately does NOT fold in the clock POSITION at the bounded
## pause: that value is frame-exact only under a pinned delta, and even then a first-ever (cold)
## engine run does an asset-import pass that shifts it — so hashing it would false-FAIL a
## cold-vs-warm leg. Emitted-frame order carries no such fragility.
##
## Still run under `--headless --fixed-fps <N>`: it honours playback.gd's determinism contract (the
## clock is pure accumulated `delta * speed`; --fixed-fps pins every delta to 1/N so the run is
## bounded and the printed positions are frame-exact for diagnostics), and it keeps a stray
## real-time hiccup from ballooning the process-frame budget. The emitted-frame hash does not depend
## on it — which is precisely why the two-leg comparison is robust. verify_twin.sh passes
## PLAYBACK_FIXED_FPS; a direct run should too.
##
## Synthesized fixtures ONLY: the gate hashes fixtures built by tools/sim/record.js fixture mode
## (byte-reproducible per --seed/--seconds/--hz — see recording.js / stream.js). A LIVE capture
## carries seed:-1 and a non-zero-based seq (the source counts while the recorder is away), so it is
## observation, not a reproducible input — never feed one to a determinism gate.
##
## Usage:
##   $GODOT --headless --fixed-fps <N> --path . --script tools/check_playback.gd -- \
##       --recording=<fixture.ndjson> [--seek=<t_ms>[,<t_ms>…]] [--out=<emitted.txt>]
##
## Asserts (each prints a line; a final verdict + exit 0/1):
##   - snapshot correctness per seek — the frames the player injects on seek(T) EQUAL an INDEPENDENT
##     recomputation (last frame with t_ms<=T per tag, header order) parsed here without touching
##     recording.gd's own snapshot code (a genuine cross-check of the player, not a tautology);
##   - monotonic emission during play — seq never goes backwards while draining a play window;
##   - transport honesty — frames_injected>0 while frames_received==0 (playback drove the frames; no
##     live frame leaked in — the amber-PLAYBACK source is the ONLY source);
##   - end-of-recording pause — play to the end auto-pauses AT the duration (no auto-loop).
##
## Emitted sequence (hashed, and written verbatim to --out): one canonical line per received frame,
## `tag|value|seq`, in arrival order — nothing else, so --out reproduces PLAYBACK-HASH exactly.
##
## Output contract (machine-parseable):
##   PLAYBACK-HASH: <hex> (<algo> over <n> frame(s))
##   PLAYBACK-GATE: OK|FAIL — <reason>
## Two runs whose PLAYBACK-HASH lines are IDENTICAL is what verify_twin.sh gates on.

const PlaybackScript := preload("res://core/playback.gd")
const DataBusScript := preload("res://core/data_bus.gd")

## Digest over the emitted (tag|value|seq) blob. String.sha256_text() implements SHA-256; naming
## the algorithm keeps the printed PLAYBACK-HASH self-describing and makes a future digest swap a
## one-line, labelled change.
const HASH_ALGORITHM := "sha256"

## Canonical emitted-line field separator. A pipe never occurs in an IFC-GlobalId tag (base64 IFC
## alphabet 0-9A-Za-z_$) nor in a float/int str(), so it can't collide with field data — the line
## tag|value|seq splits back unambiguously.
const FIELD_SEP := "|"

## Line separator inside the hashed blob (and the --out file): one canonical frame per line.
const LINE_SEP := "\n"

## Fraction of the recording to play before an explicit mid-stream pause(), then resume to the end.
## 0.5 (halfway) exercises BOTH a caller pause() mid-timeline AND the end-of-recording auto-pause in
## one run. It does not affect the hash (the window + resume drain every frame in file order either
## way — order-exact); it only picks WHERE the pause()/is_playing() assertion is taken.
const PLAY_WINDOW_FRACTION := 0.5

## Hard ceiling on process-frame awaits while draining a play window — a safety bound so a stalled
## clock FAILs the gate instead of hanging it. 100000 frames is ~28 min at 60 fps, orders of
## magnitude past traversing any bounded fixture at the gate's fixed-fps; hitting it means the clock
## never advanced (a real bug), never normal play.
const MAX_PROCESS_FRAMES := 100000

var recording_path := ""
var seeks: Array[int] = []
var out_path := ""

# The captured emission: one canonical "tag|value|seq" per DataBus.tag_update, in arrival order.
var _emitted: Array[String] = []


# One recorded frame, decoded by THIS gate's own parser (deliberately independent of recording.gd
# so the snapshot cross-check isn't circular). JSON numbers parse as float; t_ms/seq round once.
class PFrame:
	var t_ms: int
	var tag: String
	var value: float
	var seq: int


# A fixture parsed independently: header tag order + all frames in file order.
class ParsedFixture:
	var order: Array[String] = []
	var frames: Array[PFrame] = []


func _init() -> void:
	_run()


func _run() -> void:
	_parse_args()
	if recording_path == "":
		_verdict(false, "no --recording=<fixture.ndjson> given")
		return
	await process_frame  # let the DataBus autoload finish _ready before we take it over

	var bus := root.get_node_or_null("DataBus") as DataBusScript
	if bus == null:
		_verdict(false, "no DataBus autoload at /root/DataBus — not a twin viewer project")
		return
	# Public seam: enter playback mode NOW so the live socket is closed and no live frame can
	# interleave with injected ones (load_recording does this too, but doing it up front makes the
	# no-leak guarantee independent of load timing).
	bus.set_mode(DataBusScript.MODE_PLAYBACK)
	bus.tag_update.connect(_on_tag_update)

	var player := PlaybackScript.new()
	player.name = "Playback"
	root.add_child(player)  # _ready resolves its /root/DataBus handle
	await process_frame

	if not player.load_recording(recording_path):
		_verdict(
			false, "load_recording('%s') failed — parser rejected the fixture" % recording_path
		)
		return

	var fixture := _parse_fixture(recording_path)
	if fixture.frames.is_empty():
		_verdict(false, "independent parse of '%s' yielded no frames" % recording_path)
		return

	if not await _run_checks(player, bus, fixture):
		return

	_verdict(
		true, "%d frame(s) over %d seek(s) + full play-through" % [_emitted.size(), seeks.size()]
	)


# The three assertion phases in order — each already prints its own FAIL verdict, so this only
# threads the short-circuit. Split out of _run so _run stays under the return-count cap.
func _run_checks(player: PlaybackScript, bus: DataBusScript, fixture: ParsedFixture) -> bool:
	if not _check_seeks(player, fixture):
		return false
	if not await _check_play_through(player):
		return false
	if not _check_transport(bus):
		return false
	return true


func _on_tag_update(tag: String, value: float, seq: int, _latency_ms: float) -> void:
	_emitted.append(_canon(tag, value, seq))


# ONE canonical rendering of a frame, used for BOTH the captured emission and the independent
# snapshot recompute, so the two are comparable byte-for-byte. str(float) is a stable repr for a
# given float64 (same parsed value ⇒ same text every run), giving reproducibility AND full-precision
# tamper sensitivity.
func _canon(tag: String, value: float, seq: int) -> String:
	var parts: PackedStringArray = [tag, str(value), str(seq)]
	return FIELD_SEP.join(parts)


# --- assertions --------------------------------------------------------------------------------


func _check_seeks(player: PlaybackScript, fixture: ParsedFixture) -> bool:
	for t: int in seeks:
		var mark := _emitted.size()
		player.seek(t)
		var got := _emitted.slice(mark)
		var want := _expected_snapshot(fixture, t)
		if got != want:
			_verdict(
				false, "seek(%d) snapshot mismatch: got %s expected %s" % [t, str(got), str(want)]
			)
			return false
		print(
			"PLAYBACK seek %d: %d tag(s) — snapshot matches independent recompute" % [t, got.size()]
		)
	return true


func _check_play_through(player: PlaybackScript) -> bool:
	var duration := player.duration_ms()
	var play_start := _emitted.size()
	player.seek(0)  # snapshot at t=0 (captured); rewind for the play window
	player.play()
	var window_target := int(float(duration) * PLAY_WINDOW_FRACTION)
	if not await _drain_until_position(player, window_target):
		_verdict(
			false,
			"clock stalled before the %d ms play window (hit MAX_PROCESS_FRAMES)" % window_target
		)
		return false
	player.pause()
	if player.is_playing():
		_verdict(false, "pause() did not stop the clock")
		return false
	print(
		(
			"PLAYBACK play: paused at %d ms (window target %d ms)"
			% [player.position_ms(), window_target]
		)
	)

	player.play()  # resume: drain every remaining frame in file order, auto-pause at end
	if not await _drain_until_stopped(player):
		_verdict(false, "playback did not auto-pause at end (hit MAX_PROCESS_FRAMES)")
		return false
	if player.position_ms() != duration:
		_verdict(
			false,
			(
				"end-of-recording pause at %d ms, expected duration %d ms"
				% [player.position_ms(), duration]
			)
		)
		return false
	if not _assert_monotonic(play_start):
		return false
	print("PLAYBACK play: reached end, auto-paused at %d ms" % duration)
	return true


func _check_transport(bus: DataBusScript) -> bool:
	var stats := bus.stats()
	var injected: int = stats["frames_injected"]
	var received: int = stats["frames_received"]
	print("PLAYBACK transport: frames_injected=%d frames_received=%d" % [injected, received])
	if injected <= 0:
		_verdict(
			false,
			"frames_injected=%d — playback drove no frames through the DataBus seam" % injected
		)
		return false
	if received != 0:
		_verdict(
			false,
			(
				"frames_received=%d — a live frame leaked in; playback must be the ONLY source"
				% received
			)
		)
		return false
	return true


# Non-decreasing seq across the play phase: frames drain in file order, so seq (== recorder tick)
# never steps backward. A decrease means out-of-order emission — a player bug.
func _assert_monotonic(start: int) -> bool:
	var prev := -1
	for i: int in range(start, _emitted.size()):
		var parts := _emitted[i].split(FIELD_SEP)
		var seq := int(parts[parts.size() - 1])
		if seq < prev:
			_verdict(false, "non-monotonic emission during play: seq %d after %d" % [seq, prev])
			return false
		prev = seq
	return true


# --- independent recompute (no recording.gd) ---------------------------------------------------


# The pinned seek snapshot, recomputed HERE from a fresh parse: for each header tag, in header
# order, the LAST frame with t_ms <= target (frames are file-ordered ascending, so the last match
# wins); a tag with no frame yet contributes nothing. Target is clamped to [0, duration] exactly as
# Playback.seek clamps, so the comparison is apples-to-apples.
func _expected_snapshot(fixture: ParsedFixture, t: int) -> Array[String]:
	var target := clampi(t, 0, _duration_of(fixture))
	var out: Array[String] = []
	for tag: String in fixture.order:
		var best: PFrame = null
		for fr: PFrame in fixture.frames:
			if fr.tag == tag and fr.t_ms <= target:
				best = fr
		if best != null:
			out.append(_canon(best.tag, best.value, best.seq))
	return out


func _duration_of(fixture: ParsedFixture) -> int:
	if fixture.frames.is_empty():
		return 0
	return fixture.frames[fixture.frames.size() - 1].t_ms


func _parse_fixture(path: String) -> ParsedFixture:
	var fixture := ParsedFixture.new()
	var text := FileAccess.get_file_as_string(_globalize(path))
	if text == "":
		return fixture
	var lines := text.split("\n")
	if lines.is_empty():
		return fixture
	_parse_header(lines[0], fixture)
	for i: int in range(1, lines.size()):
		var line := lines[i].strip_edges()
		if line == "":
			continue
		var parsed: Variant = JSON.parse_string(line)
		if not (parsed is Dictionary):
			continue
		var row: Dictionary = parsed
		var fr := PFrame.new()
		fr.t_ms = _to_int(row.get("t_ms"))
		fr.tag = str(row.get("tag"))
		fr.value = _to_float(row.get("value"))
		fr.seq = _to_int(row.get("seq"))
		fixture.frames.append(fr)
	return fixture


func _parse_header(line: String, fixture: ParsedFixture) -> void:
	var parsed: Variant = JSON.parse_string(line)
	if not (parsed is Dictionary):
		return
	var header: Dictionary = parsed
	var raw_tags: Variant = header.get("tags")
	if not (raw_tags is Array):
		return
	var tags_list: Array = raw_tags
	for entry: Variant in tags_list:
		if entry is Dictionary:
			var row: Dictionary = entry
			var tag: Variant = row.get("tag")
			if tag is String:
				fixture.order.append(tag)


# --- helpers -----------------------------------------------------------------------------------


func _drain_until_position(player: PlaybackScript, target_ms: int) -> bool:
	var frames := 0
	while player.position_ms() < target_ms and player.is_playing():
		await process_frame
		frames += 1
		if frames >= MAX_PROCESS_FRAMES:
			return false
	return true


func _drain_until_stopped(player: PlaybackScript) -> bool:
	var frames := 0
	while player.is_playing():
		await process_frame
		frames += 1
		if frames >= MAX_PROCESS_FRAMES:
			return false
	return true


func _verdict(ok: bool, reason: String) -> void:
	var blob := LINE_SEP.join(_emitted)
	var digest := blob.sha256_text()
	print("PLAYBACK-HASH: %s (%s over %d frame(s))" % [digest, HASH_ALGORITHM, _emitted.size()])
	if out_path != "":
		_write_out(blob)
	if ok:
		print("PLAYBACK-GATE: OK — ", reason)
		quit(0)
	else:
		print("PLAYBACK-GATE: FAIL — ", reason)
		quit(1)


func _write_out(blob: String) -> void:
	var f := FileAccess.open(_globalize(out_path), FileAccess.WRITE)
	if f == null:
		push_warning("check_playback: cannot write --out '%s'" % out_path)
		return
	f.store_string(blob)
	f.close()


func _parse_args() -> void:
	for a: String in OS.get_cmdline_user_args():
		if a.begins_with("--recording="):
			recording_path = a.substr("--recording=".length())
		elif a.begins_with("--seek="):
			for part: String in a.substr("--seek=".length()).split(",", false):
				seeks.append(int(part))
		elif a.begins_with("--out="):
			out_path = a.substr("--out=".length())


func _globalize(p: String) -> String:
	if p.begins_with("res://") or p.begins_with("user://"):
		return ProjectSettings.globalize_path(p)
	if p.is_absolute_path():
		return p
	return ProjectSettings.globalize_path("res://" + p)


# JSON numbers parse as float; ints are tolerated for hand-written fixtures. Narrowing through a
# typed float local (as recording.gd does) keeps this free of unsafe-Variant warnings.
func _is_number(raw: Variant) -> bool:
	var t := typeof(raw)
	return t == TYPE_FLOAT or t == TYPE_INT


func _to_int(raw: Variant) -> int:
	if not _is_number(raw):
		return 0
	var f: float = raw
	return roundi(f)


func _to_float(raw: Variant) -> float:
	if not _is_number(raw):
		return 0.0
	var f: float = raw
	return f
