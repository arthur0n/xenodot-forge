#!/bin/bash
# tools/lib/checks.sh — composable, exit-coded gate checks.
#
# This is the deterministic SPINE of the verify story: one function per thing the harness can
# check, each printing a single `<gate>: PASS|FAIL|SKIP <step>` line and returning 0 (pass/skip)
# or 1 (fail). Both gates compose the SAME functions, so there is one definition and no drift:
#   • tools/validate.sh   — the builder's floor   (format → lint → parse → scenes → smoke → bots)
#   • tools/playgrade.sh  — the evaluator's rubric (the floor + render-health + the play_* bots)
#
# Generic — NO game-specific paths live here. Source from a script whose cwd is the game project
# root (where project.godot lives); set XENO_GATE to label the output (default "validate").
#
#   source "$(dirname "$0")/lib/checks.sh"
#   xeno_resolve_engine || exit 1
#   check_format && check_lint && check_parse && check_props \
#     && check_scene_errors && check_smoke "$SCENE_RES" && check_smoke_bots || exit 1

# Guard against double-sourcing (validate.sh and a check helper could both pull it in).
[ -n "${XENO_CHECKS_SH:-}" ] && return 0
XENO_CHECKS_SH=1

# Output prefix — set by the composing gate. "validate" keeps the historical output format.
: "${XENO_GATE:=validate}"

# Benign at-exit teardown noise — NOT real errors. Shared by every check that greps engine stderr,
# so the exclusion list lives in exactly one place.
XENO_BENIGN='ObjectDB instances leaked|resources still in use at exit'
XENO_BENIGN="$XENO_BENIGN|RID allocations of type .* were leaked at exit"
XENO_BENIGN="$XENO_BENIGN|Pages in use exist at exit|Leaked instance dependency"

# --- helpers ----------------------------------------------------------------------------------

# Resolve the engine binary into $GODOT and export it. Godot and its compatible forks (Redot,
# Blazium) share the same CLI, so any runs these checks unchanged. Idempotent: honours an existing
# $GODOT. Order: $GODOT → a binary on PATH → common install paths → fail with guidance.
xeno_resolve_engine() {
	if [ -n "${GODOT:-}" ]; then
		export GODOT
		return 0
	fi
	local name p
	for name in godot redot blazium; do
		if command -v "$name" >/dev/null 2>&1; then
			GODOT="$(command -v "$name")"
			export GODOT
			return 0
		fi
	done
	for p in \
		/Applications/Godot.app/Contents/MacOS/Godot \
		/Applications/Redot.app/Contents/MacOS/Redot \
		/Applications/Blazium.app/Contents/MacOS/Blazium \
		/usr/local/bin/godot /usr/bin/godot; do
		if [ -x "$p" ]; then
			GODOT="$p"
			export GODOT
			return 0
		fi
	done
	echo "$XENO_GATE: FAIL setup — no engine binary found."
	echo "  Set GODOT to your engine executable, e.g.:"
	echo "    GODOT=/Applications/Godot.app/Contents/MacOS/Godot $XENO_GATE.sh"
	echo "  Godot, Redot and Blazium all work — they share the same CLI."
	return 1
}

# Source files, skipping the engine cache, addons, and framework state.
xeno_gd_files() {
	find . -name '*.gd' -not -path './.godot/*' -not -path './addons/*' -not -path './.xenodot/*' | sed 's|^\./||'
}
xeno_scene_files() {
	find . -name '*.tscn' -not -path './.godot/*' -not -path './addons/*' | sed 's|^\./||'
}

_xeno_pass() { echo "$XENO_GATE: PASS $1"; }
_xeno_fail() {
	echo "$XENO_GATE: FAIL $1"
	return 1
}

# --- checks -----------------------------------------------------------------------------------

# Static: gdformat in --check mode. Fails listing files that need formatting.
check_format() {
	local files
	files=$(xeno_gd_files)
	[ -z "$files" ] && {
		_xeno_pass "format (no .gd files)"
		return 0
	}
	# shellcheck disable=SC2086
	if ! gdformat --check $files; then
		_xeno_fail "format — run: gdformat <file> on the files listed above"
		return 1
	fi
	_xeno_pass format
}

# Static: gdlint.
check_lint() {
	local files
	files=$(xeno_gd_files)
	[ -z "$files" ] && {
		_xeno_pass "lint (no .gd files)"
		return 0
	}
	# shellcheck disable=SC2086
	if ! gdlint $files; then
		_xeno_fail lint
		return 1
	fi
	_xeno_pass lint
}

# Static: assert the strict warnings-as-errors contract is actually CONFIGURED. check_parse below
# greps --check-only output for "WARNING" — but the engine only EMITS those warnings when
# project.godot's [debug] block escalates them (gdscript/warnings/*=2). If that block is missing or
# weakened, check_parse silently no-ops and the ENTIRE strict contract (untyped, unsafe_*, shadowed)
# ships green and invisible (e.g. SHADOWED_GLOBAL_IDENTIFIER on `range`/`sign` reached runtime). This
# guards the gate's own precondition: shadowed_global_identifier=2 is the sentinel for the whole
# block (the starter ships ~20 escalations together). Restore the block from starter/project.godot.
check_warnings_config() {
	if [ ! -f project.godot ]; then
		_xeno_fail "warnings-config — no project.godot found"
		return 1
	fi
	if ! grep -qE '^gdscript/warnings/shadowed_global_identifier[[:space:]]*=[[:space:]]*2' project.godot; then
		echo "  project.godot is missing the [debug] warnings-as-errors block (sentinel"
		echo "  'gdscript/warnings/shadowed_global_identifier=2' absent). The strict GDScript"
		echo "  contract is OFF — untyped/unsafe/shadowed warnings will ship green. Restore the"
		echo "  block from starter/project.godot (godot-project-conventions)."
		_xeno_fail warnings-config
		return 1
	fi
	_xeno_pass warnings-config
}

# Parse + analyzer warnings (project.godot [debug] escalates warnings to errors). --import first
# rebuilds the global class cache so new class_name scripts resolve.
#
# Working-tree guard: headless --import can rewrite project.godot (strips settings it deems
# editor-only on a cold cache) and re-serialise .tscn files (adds uid= lines). Snapshot the tracked
# source from the WORKING TREE immediately before --import and restore after, so the gate stays
# read-only from git's perspective while preserving any uncommitted builder edits.
check_parse() {
	local files import_tmp tscn f dir
	files=$(xeno_gd_files)
	import_tmp="$(mktemp -d)"
	cp project.godot "$import_tmp/project.godot" 2>/dev/null
	tscn=$(git ls-files '*.tscn' 2>/dev/null)
	for f in $tscn; do
		dir="$import_tmp/$(dirname "$f")"
		mkdir -p "$dir"
		cp "$f" "$dir/$(basename "$f")"
	done
	_xeno_restore_import() {
		cp "$import_tmp/project.godot" project.godot 2>/dev/null
		for f in $tscn; do
			cp "$import_tmp/$(dirname "$f")/$(basename "$f")" "$f" 2>/dev/null
		done
	}
	if ! "$GODOT" --headless --path . --import >/dev/null 2>&1; then
		_xeno_restore_import
		rm -rf "$import_tmp"
		_xeno_fail "import — godot --import failed; run it manually to see the errors"
		return 1
	fi
	_xeno_restore_import
	rm -rf "$import_tmp"

	local out status
	for f in $files; do
		out=$("$GODOT" --headless --path . --check-only --script "res://$f" 2>&1)
		status=$?
		if [ $status -ne 0 ] || echo "$out" | grep -qE "SCRIPT ERROR|Parse Error|WARNING"; then
			echo "$out"
			_xeno_fail "parse — $f"
			return 1
		fi
	done
	_xeno_pass parse
}

# Scene property validation (godot-verify layer 1) — catches silently-dropped invalid properties.
check_props() {
	if ! "$GODOT" --headless --path . --script tools/verify_scene.gd; then
		_xeno_fail scenes
		return 1
	fi
	_xeno_pass scenes
}

# Static: a TYPED node-reference @export assigned a NodePath in a hand-authored .tscn. A
# `@export var hp: PlayerHealth` set as `hp = NodePath("../PlayerHealth")` does NOT resolve — it
# stays null at runtime with NO error: green validate, dead feature (it once severed Slice-4
# contact damage). Only an UNTYPED `@export var hp: NodePath` (or `: Node`) auto-resolves a .tscn
# NodePath. Catch: any property assigned `= NodePath(...)` in a .tscn whose script declares it
# `@export var <p>: <T>` with <T> a concrete class (not NodePath/Node/Array) is the trap. Fix:
# type the export `NodePath` (or `Node`) and `get_node()` it in `_ready()`, or assign the node by
# reference in the editor. Engine-free static text check; no game-specific paths.
check_typed_export_nodepath() {
	local exports gd tscn prop type fails=0
	# Map every concretely-typed export → its type ("<prop>=<Type>"), one pass over the scripts.
	exports="$(
		for gd in $(xeno_gd_files); do
			grep -oE '@export[[:space:]]+var[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]*:[[:space:]]*[A-Za-z_][A-Za-z0-9_]*' "$gd" 2>/dev/null
		done | sed -E 's/.*var[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*:[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)/\1=\2/' | sort -u
	)"
	for tscn in $(xeno_scene_files); do
		while IFS= read -r prop; do
			[ -z "$prop" ] && continue
			type="$(printf '%s\n' "$exports" | awk -F= -v p="$prop" '$1 == p { print $2; exit }')"
			[ -z "$type" ] && continue                          # not a typed export → fine
			case "$type" in NodePath | Node | Array) continue ;; esac # untyped escape hatches resolve
			echo "  $tscn: '$prop = NodePath(...)' but its export is typed ': $type' — resolves to null at runtime (use ': NodePath' or ': Node' + get_node() in _ready(), or assign the node by reference)"
			fails=1
		done < <(grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*NodePath\(' "$tscn" 2>/dev/null | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*).*/\1/')
	done
	[ "$fails" -eq 1 ] && {
		_xeno_fail typed_export_nodepath
		return 1
	}
	_xeno_pass typed_export_nodepath
}

# The "third data-driven half" (godot-data-driven-composition): an @export authored + read but
# never ASSIGNED on the live node in the shipped .tscn is a dead feature behind a green gate.
# The game declares its wiring contract in design/export-wiring.tsv — one
# "<scene.tscn> <NodePath> <field>" per line ("#" comments allowed); no/empty file = SKIP
# (a fresh game has no contract yet, same convention as the bot fleet).
check_export_assigned() {
	local wiring="design/export-wiring.tsv" lines scene s np f fails=0 count=0
	[ -f "$wiring" ] || {
		_xeno_pass "export-assigned (no $wiring)"
		return 0
	}
	lines=$(grep -vE '^[[:space:]]*(#|$)' "$wiring")
	[ -z "$lines" ] && {
		_xeno_pass "export-assigned (empty $wiring)"
		return 0
	}
	# A malformed row would silently drop a contract entry — fail loudly instead.
	while read -r s np f; do
		if [ -z "$np" ] || [ -z "$f" ]; then
			echo "  $wiring: malformed line (need '<scene> <NodePath> <field>'): $s $np $f"
			_xeno_fail "export-assigned — malformed wiring line"
			return 1
		fi
	done <<<"$lines"
	# One checker run per scene, with all its (NodePath, field) pairs.
	for scene in $(echo "$lines" | awk '{print $1}' | sort -u); do
		local args=""
		while read -r s np f; do
			[ "$s" = "$scene" ] && args="$args $np $f"
		done <<<"$lines"
		count=$((count + 1))
		# shellcheck disable=SC2086 # args is a flat NodePath/field pair list, split intended
		if ! "$GODOT" --headless --path . --script tools/check_scene_export_assigned.gd -- "$scene" $args; then
			fails=$((fails + 1))
		fi
	done
	[ "$fails" -gt 0 ] && {
		_xeno_fail "export-assigned — $fails scene(s) with unwired exports"
		return 1
	}
	_xeno_pass "export-assigned ($count scene(s))"
}

# Per-scene headless error capture (godot-verify layer 2b) — loads every .tscn and fails on any
# non-benign engine ERROR / name-clash line. Standalone tools/smoke_scene_errors.sh is a thin
# wrapper over this.
check_scene_errors() {
	local scenes scene log log_dir errors fail_count=0
	scenes=$(xeno_scene_files)
	[ -z "$scenes" ] && {
		_xeno_pass "scene-errors (no .tscn files)"
		return 0
	}
	log_dir="${TMPDIR:-/tmp}/xeno_scene_errors_logs"
	mkdir -p "$log_dir"
	for scene in $scenes; do
		log="$log_dir/$(echo "$scene" | tr '/' '_').log"
		"$GODOT" --headless --path . --log-file "$log" \
			--script tools/verify_scene.gd -- "$scene" >/dev/null 2>&1
		errors=""
		if [ -f "$log" ]; then
			errors=$(grep -vE "$XENO_BENIGN" "$log" | grep -E "^(ERROR|SCRIPT ERROR):|name clashes")
		fi
		if [ -n "$errors" ]; then
			echo "$XENO_GATE: FAIL scene-errors — $scene"
			echo "$errors"
			grep -vE "$XENO_BENIGN" "$log" \
				| grep -E -A 20 "^(ERROR|SCRIPT ERROR):" \
				| grep -E "^(ERROR|SCRIPT ERROR):|at: |GDScript backtrace|[[:space:]]+at"
			fail_count=$((fail_count + 1))
		fi
	done
	if [ "$fail_count" -gt 0 ]; then
		_xeno_fail "scene-errors — $fail_count scene(s) had errors"
		return 1
	fi
	_xeno_pass scene-errors
}

# Smoke run (godot-verify layer 2) — boot the main scene (or $1 as a res:// scene) 3 frames; any
# non-benign ERROR/WARNING line = failure.
check_smoke() {
	local scene_res="${1:-}" smoke
	smoke=$("$GODOT" --headless --path . ${scene_res:+"$scene_res"} --quit-after 3 2>&1 \
		| grep -E "SCRIPT ERROR|ERROR|WARNING" | grep -Ev "$XENO_BENIGN")
	if [ -n "$smoke" ]; then
		echo "$smoke"
		_xeno_fail smoke
		return 1
	fi
	_xeno_pass smoke
}

# Render health (godot-verify layer 3) — boots the scene WITH a display and fails when the output
# is a flat color (valid scene, renders nothing: camera pointing away, no current camera, missing
# sky/lights). Binary check, so it gates immediately (the thresholds discipline: binary gates now,
# numeric bands calibrate first). Headless environments SKIP — Godot renders blank without a
# display, and a blank-frame FAIL there would be a false red; a SKIP must never fake a windowed
# PASS. XENO_RENDER=off forces the SKIP explicitly.
check_render() {
	local scene_res="${1:-}"
	if [ "${XENO_RENDER:-}" = "off" ]; then
		echo "$XENO_GATE: SKIP render (XENO_RENDER=off)"
		return 0
	fi
	case "$(uname -s)" in
	Linux)
		if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
			echo "$XENO_GATE: SKIP render (no display)"
			return 0
		fi
		;;
	esac
	if ! "$GODOT" --path . --resolution 640x360 -s tools/verify_render.gd ${scene_res:+-- "$scene_res"}; then
		_xeno_fail render
		return 1
	fi
	_xeno_pass render
}

# Run a fleet of game-authored runtime bots: tools/<prefix>_*.gd. Each is a SceneTree script that
# drives logic/input and asserts via exit code (0 pass, non-0 fail). nullglob-guarded so a game
# with NO bots SKIPs cleanly (a fresh `forge new` game has none yet).
#   smoke_*.gd — the builder's own seam tests (run in the floor gate)
#   play_*.gd  — the evaluator's adversarial playthroughs (run by playgrade)
run_gd_bots() {
	local prefix="$1" label="${2:-$1}" bot count=0 fail_count=0 status
	local _bots_glob="${XENO_BOTS_GLOB:-}"
	# No nullglob/shopt: with no match the loop runs once with the literal glob, which `-e`
	# rejects — so a game with zero bots SKIPs (works under any bash, no shell-option state).
	# Run EVERY bot: one failure records a fail but must not abort the rest (a single failing
	# bot used to mask every later bot). Guard the invocation so its non-zero exit can't kill
	# the loop under `set -e`.
	for bot in tools/"${prefix}"_*.gd; do
		[ -e "$bot" ] || continue
		if [ -n "$_bots_glob" ]; then
			local base
			base="$(basename "$bot")"
			case "$base" in
			$_bots_glob) ;;
			*) continue ;;
			esac
		fi
		count=$((count + 1))
		"$GODOT" --headless --path . --script "$bot"
		status=$?
		if [ "$status" -ne 0 ]; then
			_xeno_fail "${label}-bots — $bot"
			fail_count=$((fail_count + 1))
		fi
	done
	if [ "$count" -eq 0 ]; then
		echo "$XENO_GATE: SKIP ${label}-bots — none present"
		return 0
	fi
	if [ "$fail_count" -gt 0 ]; then
		return 1
	fi
	_xeno_pass "${label}-bots ($count)"
}

# The builder's own seam-test bots (godot-verify layer 2.5).
check_smoke_bots() { run_gd_bots smoke; }
# The evaluator's adversarial playthrough bots (driven by playgrade).
check_play_bots() { run_gd_bots play; }

# Optional: a game's own tools/check_nav_bake.gd (asserts a NavigationRegion3D's baked mesh has
# polygons > 0 at _ready()). Guards a known Godot 4.6 landmine where the editor bake ships an empty
# NavigationMesh. SKIPs cleanly if the game hasn't authored that checker — not every game uses nav.
check_navmesh_baked() {
	if [ ! -f tools/check_nav_bake.gd ]; then
		echo "$XENO_GATE: SKIP navmesh-baked — tools/check_nav_bake.gd not present"
		return 0
	fi
	if ! "$GODOT" --headless --path . -s tools/check_nav_bake.gd; then
		_xeno_fail navmesh-baked
		return 1
	fi
	_xeno_pass navmesh-baked
}
