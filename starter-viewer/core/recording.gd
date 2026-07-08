# recording.gd — parsed twin-recording data model (pure data, RefCounted): loads +
# validates an NDJSON recording and answers the two time queries playback needs —
# "snapshot at T" and "first frame after T". No clocks, no DataBus, no scene access;
# core/playback.gd owns those. Split out of the player so each file stays small and the
# format contract lives in exactly one place on the viewer side.
#
# File contract (PINNED cross-agent — plugin-twin/tools/sim/recording.js writes this
# exact shape; do not deviate on either side):
#   line 1 (header):  {"version":1,"kind":"twin-recording","hz":<int>,"seed":<int>,
#                      "tags":[{"tag":str,"min":float,"max":float}, ...]}
#   every next line:  {"t_ms":<int>,"tag":str,"value":float,"seq":<int>}
#   frames ordered by t_ms ascending; t_ms is relative to recording start. A live
#   capture carries seed=-1 (recorded, not synthesized) — any int is accepted here.
#
# Validation stance: STRICT. Any malformed line — bad header, non-monotonic t_ms, a tag
# missing from the header table — push_warning's (with the line number) and fails the
# WHOLE load, leaving `loaded == false`. It never crashes the viewer. Rationale: the
# recorder is built against the same pinned contract, so a violation means the file
# cannot be trusted for deterministic playback; half-loading would hide the recorder bug.
extends RefCounted

# Header discriminator pinned in the recording contract (recording.js RECORDING_KIND) —
# rejects an arbitrary NDJSON file that merely happens to parse.
const HEADER_KIND := "twin-recording"

# The only format version this parser understands (recording.js RECORDING_VERSION). A
# future v2 needs explicit migration code here, never a silent best-effort parse.
const SUPPORTED_VERSION := 1

# Sentinel for "header int field absent or non-numeric". Negative and outside every
# contract field's valid space EXCEPT seed (whose own -1 means "live capture"), so it is
# only used where absence must be detected: the version check.
const MISSING_INT := -1


# One recorded frame, decoded. t_ms/seq are ints on the wire; JSON parses all numbers as
# float, so the loader rounds ONCE here and downstream math stays integer-exact.
class Frame:
	var t_ms: int
	var tag: String
	var value: float
	var seq: int


## True after a successful load_file(); every query below returns empty/zero until then.
var loaded := false

## Recorder capture rate from the header (informational — playback derives nothing from it).
var hz := 0

## Recorder sim seed from the header (-1 = live capture, not re-synthesizable). Named
## seed_value to dodge SHADOWED_GLOBAL_IDENTIFIER against the global seed().
var seed_value := 0

## Tags in HEADER order. snapshot_at() emits in this order — a FIXED cross-tag order is
## what keeps seek emission deterministic run-to-run (the Phase-4 gate hashes sequences).
var tag_order: Array[String] = []

## All frames in file order (t_ms ascending — validated at load).
var frames: Array[Frame] = []

## t_ms of the last frame (0 for a frame-less recording).
var duration_ms := 0

var _by_tag := {}  # tag(String) -> Array[Frame]; same Frame objects as `frames`


## Parse + validate the NDJSON recording at `path` (absolute or res://). Returns whether
## the file loaded; on false the state is fully reset (loaded == false) and the reason
## was push_warning'd. Never crashes on malformed input.
func load_file(path: String) -> bool:
	_reset()
	if not FileAccess.file_exists(path):
		push_warning("recording: no file at '%s'" % path)
		return false
	var lines := FileAccess.get_file_as_string(path).split("\n")
	if lines.is_empty() or not _parse_header(lines[0], path):
		_reset()
		return false
	for i in range(1, lines.size()):
		var line := lines[i].strip_edges()
		if line == "":
			continue  # tolerate blank/trailing lines — NDJSON writers end files with \n
		if not _parse_frame_line(line, i + 1, path):
			_reset()
			return false
	loaded = true
	return true


func tag_count() -> int:
	return tag_order.size()


## The pinned seek snapshot: for each header tag, IN HEADER ORDER, the LAST frame with
## t_ms <= `t_ms`; a tag with no frame yet contributes nothing.
func snapshot_at(t_ms: int) -> Array[Frame]:
	var out: Array[Frame] = []
	for tag: String in tag_order:
		var bucket: Array[Frame] = _by_tag[tag]
		var idx := _last_at_or_before(bucket, t_ms)
		if idx >= 0:
			out.append(bucket[idx])
	return out


## Index into `frames` of the first frame with t_ms > `t_ms` (frames.size() when none):
## where forward playback resumes after a seek — everything at or before T is already
## covered by the snapshot.
func first_index_after(t_ms: int) -> int:
	var lo := 0
	var hi := frames.size()
	while lo < hi:
		var mid := (lo + hi) >> 1  # bisect midpoint (shift: integer, no int-division warning)
		if frames[mid].t_ms <= t_ms:
			lo = mid + 1
		else:
			hi = mid
	return lo


func _reset() -> void:
	loaded = false
	hz = 0
	seed_value = 0
	tag_order.clear()
	frames.clear()
	_by_tag.clear()
	duration_ms = 0


func _parse_header(line: String, path: String) -> bool:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("recording: '%s' line 1 is not a JSON object header" % path)
		return false
	var header: Dictionary = parsed
	if str(header.get("kind")) != HEADER_KIND:
		push_warning(
			"recording: '%s' kind '%s' != '%s'" % [path, str(header.get("kind")), HEADER_KIND]
		)
		return false
	var version := _to_int(header.get("version"), MISSING_INT)
	if version != SUPPORTED_VERSION:
		push_warning(
			"recording: '%s' version %d unsupported (want %d)" % [path, version, SUPPORTED_VERSION]
		)
		return false
	hz = maxi(_to_int(header.get("hz"), 0), 0)
	seed_value = _to_int(header.get("seed"), 0)
	return _parse_header_tags(header.get("tags"), path)


func _parse_header_tags(raw_tags: Variant, path: String) -> bool:
	if typeof(raw_tags) != TYPE_ARRAY:
		push_warning("recording: '%s' header has no 'tags' array" % path)
		return false
	var tags_list: Array = raw_tags
	for entry: Variant in tags_list:
		if typeof(entry) != TYPE_DICTIONARY:
			push_warning("recording: '%s' header tag entry is not an object" % path)
			return false
		var row: Dictionary = entry
		if typeof(row.get("tag")) != TYPE_STRING:
			push_warning("recording: '%s' header tag entry missing 'tag'" % path)
			return false
		var tag: String = row["tag"]
		tag_order.append(tag)
		_by_tag[tag] = [] as Array[Frame]
	if tag_order.is_empty():
		push_warning("recording: '%s' header lists no tags" % path)
		return false
	return true


func _parse_frame_line(line: String, line_number: int, path: String) -> bool:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("recording: '%s' line %d is not a JSON object" % [path, line_number])
		return false
	var row: Dictionary = parsed
	if typeof(row.get("tag")) != TYPE_STRING:
		push_warning("recording: '%s' line %d has no string 'tag'" % [path, line_number])
		return false
	var tag: String = row["tag"]
	if not _by_tag.has(tag):
		push_warning(
			"recording: '%s' line %d tag '%s' missing from the header" % [path, line_number, tag]
		)
		return false
	if (
		not _is_number(row.get("t_ms"))
		or not _is_number(row.get("value"))
		or not _is_number(row.get("seq"))
	):
		push_warning("recording: '%s' line %d needs numeric t_ms/value/seq" % [path, line_number])
		return false
	var frame := Frame.new()
	frame.t_ms = _to_int(row["t_ms"], 0)
	frame.tag = tag
	var value: float = row["value"]
	frame.value = value
	frame.seq = _to_int(row["seq"], 0)
	# duration_ms doubles as "last t_ms accepted" — with the ascending contract the
	# running last IS the max, and a step backwards is a contract violation.
	if frame.t_ms < duration_ms:
		push_warning(
			(
				"recording: '%s' line %d t_ms %d went backwards (last %d)"
				% [path, line_number, frame.t_ms, duration_ms]
			)
		)
		return false
	duration_ms = frame.t_ms
	frames.append(frame)
	var bucket: Array[Frame] = _by_tag[tag]
	bucket.append(frame)
	return true


# Bisect: index of the last frame in `bucket` with t_ms <= `t_ms`, or -1 when even the
# first frame is later ("no frame yet" in the seek contract).
func _last_at_or_before(bucket: Array[Frame], t_ms: int) -> int:
	var lo := 0
	var hi := bucket.size()
	while lo < hi:
		var mid := (lo + hi) >> 1  # bisect midpoint (shift: integer, no int-division warning)
		if bucket[mid].t_ms <= t_ms:
			lo = mid + 1
		else:
			hi = mid
	return lo - 1


# JSON numbers always parse as float; ints are tolerated for hand-written fixtures.
func _is_number(raw: Variant) -> bool:
	var t := typeof(raw)
	return t == TYPE_FLOAT or t == TYPE_INT


# Round a JSON number to int, or `fallback` when absent/non-numeric.
func _to_int(raw: Variant, fallback: int) -> int:
	if not _is_number(raw):
		return fallback
	var f: float = raw
	return roundi(f)
