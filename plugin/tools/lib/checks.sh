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

# Run a fleet of game-authored runtime bots: tools/<prefix>_*.gd. Each is a SceneTree script that
# drives logic/input and asserts via exit code (0 pass, non-0 fail). nullglob-guarded so a game
# with NO bots SKIPs cleanly (a fresh `forge new` game has none yet).
#   smoke_*.gd — the builder's own seam tests (run in the floor gate)
#   play_*.gd  — the evaluator's adversarial playthroughs (run by playgrade)
run_gd_bots() {
	local prefix="$1" label="${2:-$1}" bot count=0
	# No nullglob/shopt: with no match the loop runs once with the literal glob, which `-e`
	# rejects — so a game with zero bots SKIPs (works under any bash, no shell-option state).
	for bot in tools/"${prefix}"_*.gd; do
		[ -e "$bot" ] || continue
		count=$((count + 1))
		if ! "$GODOT" --headless --path . --script "$bot"; then
			_xeno_fail "${label}-bots — $bot"
			return 1
		fi
	done
	if [ "$count" -eq 0 ]; then
		echo "$XENO_GATE: SKIP ${label}-bots — none present"
		return 0
	fi
	_xeno_pass "${label}-bots ($count)"
}

# The builder's own seam-test bots (godot-verify layer 2.5).
check_smoke_bots() { run_gd_bots smoke; }
# The evaluator's adversarial playthrough bots (driven by playgrade).
check_play_bots() { run_gd_bots play; }
