#!/bin/bash
# tools/playgrade.sh — the evaluator's deterministic grader (the DETERMINISTIC half of the
# generator-evaluator loop). Composes tools/lib/checks.sh + the game's adversarial play_*.gd bots
# into a 5-criterion rubric and emits a structured playgrade-report.json (per-criterion
# PASS/FAIL/SKIP + an aggregate exit code: 0 iff overall PASS; SKIPs never fail).
#
# The grade is deterministic so the `godot-playtester` agent only does what a script can't:
# author the adversarial play_*.gd bots from the design's Acceptance, then root-cause each FAIL
# into the report's findings. See the godot-playgrade skill for the full rubric contract.
#
# Usage:
#   tools/playgrade.sh --slug <slug> [--design design/<slug>.md] [--scene <scene.tscn>] [--out <path>]
#
# Criteria (v1 coverage in parens; the skill documents how the deferred ones graduate):
#   1 runs-clean           headless  check_scene_errors + check_smoke            (GRADED)
#   2 renders-healthy       windowed  check_render flat-color floor (godot-verify L3)   (GRADED with a display; SKIP headless)
#   3 core-loop-functional  headless  check_play_bots (the authored adversarial bots)  (GRADED)
#   4 data-driven-adherence static    codex-criteria lens, delegated to Codex/agent     (SKIP)
#   5 feel-responsive       headless  latency/continuity asserts inside the play bots   (SKIP → REPORT)
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1
PATH="$HOME/.local/bin:$PATH"
XENO_GATE=playgrade
# shellcheck source=lib/checks.sh
source "$SCRIPT_DIR/lib/checks.sh"
xeno_resolve_engine || exit 1

SLUG="build"
DESIGN=""
SCENE=""
OUT=""
BOTS_GLOB=""
while [ $# -gt 0 ]; do
	case "$1" in
	--slug) SLUG="${2:-build}" && shift 2 ;;
	--design) DESIGN="${2:-}" && shift 2 ;;
	--scene) SCENE="${2:-}" && shift 2 ;;
	--out) OUT="${2:-}" && shift 2 ;;
	--bots-glob) BOTS_GLOB="${2:-}" && shift 2 ;;
	*)
		echo "playgrade: ignoring unknown arg: $1" >&2
		shift
		;;
	esac
done
SCENE_RES=""
[ -n "$SCENE" ] && SCENE_RES="res://$SCENE"
[ -z "$OUT" ] && OUT=".xenodot/playgrade/${SLUG}.json"
[ -n "${BOTS_GLOB:-}" ] && export XENO_BOTS_GLOB="$BOTS_GLOB"
LOG_DIR=".xenodot/playgrade/${SLUG}-logs"
mkdir -p "$(dirname "$OUT")" "$LOG_DIR" || {
	echo "playgrade: FAIL — cannot create $LOG_DIR"
	exit 1
}

# Minimal JSON string escaping (bash param-expansion, no external deps). Dynamic strings here are
# short single-line values (slug, paths, one error line); newlines/tabs collapse to a space.
json_escape() {
	local s="$1"
	s="${s//\\/\\\\}"
	s="${s//\"/\\\"}"
	s="${s//$'\r'/}"
	s="${s//$'\n'/ }"
	s="${s//$'\t'/ }"
	printf '%s' "$s"
}

# Run a check (function or command), tee its output to a log, classify PASS/FAIL/SKIP from
# output + exit code. A check that printed "<gate>: SKIP …" and returned 0 counts as SKIP.
grade() {
	local log="$1"
	shift
	local out rc
	out="$("$@" 2>&1)"
	rc=$?
	printf '%s\n' "$out" >"$log"
	if printf '%s' "$out" | grep -q ": SKIP "; then
		printf 'SKIP'
	elif [ "$rc" -eq 0 ]; then
		printf 'PASS'
	else
		printf 'FAIL'
	fi
}

_crit_runs_clean() { check_scene_errors && check_smoke "$SCENE_RES"; }

echo "playgrade: grading '$SLUG'…"
S_RUNS=$(grade "$LOG_DIR/runs-clean.log" _crit_runs_clean)
S_LOOP=$(grade "$LOG_DIR/core-loop.log" check_play_bots)
# Flat-color floor gates when a display exists; SKIPs headless (never a fake windowed PASS).
S_RENDER=$(grade "$LOG_DIR/render.log" check_render "$SCENE_RES")
# v1-deferred criteria (the skill documents how each graduates to GRADED):
S_DATA=SKIP # static data-driven lens → delegated to Codex / the agent's read pass
S_FEEL=SKIP # latency/continuity → folded into the play_*.gd bots (REPORT in v1)

# Aggregate: FAIL if any GRADED criterion failed; SKIPs never fail.
OVERALL=PASS
[ "$S_RUNS" = FAIL ] && OVERALL=FAIL
[ "$S_LOOP" = FAIL ] && OVERALL=FAIL
[ "$S_RENDER" = FAIL ] && OVERALL=FAIL

first_fail() { grep -E ": FAIL |FAIL —|^ERROR|^SCRIPT ERROR" "$1" 2>/dev/null | head -1; }

crit_json() { # id regime status logfile
	local id="$1" regime="$2" status="$3" log="$4" detail=""
	[ "$status" = FAIL ] && detail="$(json_escape "$(first_fail "$log")")"
	printf '    { "id": "%s", "regime": "%s", "status": "%s", "measured": "n/a", "threshold": "n/a", "evidence": "%s", "detail": "%s" }' \
		"$id" "$regime" "$status" "$(json_escape "$log")" "$detail"
}

# Seed one finding per FAILed graded criterion; the agent fills root_cause/repro/file/line.
FINDINGS=""
add_finding() {
	[ -n "$FINDINGS" ] && FINDINGS="$FINDINGS,"
	FINDINGS="$FINDINGS
    { \"criterion\": \"$1\", \"file\": \"\", \"line\": 0, \"root_cause\": \"\", \"repro\": \"\", \"evidence_log\": \"$(json_escape "$2")\" }"
}
[ "$S_RUNS" = FAIL ] && add_finding runs-clean "$LOG_DIR/runs-clean.log"
[ "$S_RENDER" = FAIL ] && add_finding renders-healthy "$LOG_DIR/render.log"
[ "$S_LOOP" = FAIL ] && add_finding core-loop-functional "$LOG_DIR/core-loop.log"

{
	printf '{\n'
	printf '  "slug": "%s",\n' "$(json_escape "$SLUG")"
	printf '  "design": "%s",\n' "$(json_escape "$DESIGN")"
	printf '  "overall": "%s",\n' "$OVERALL"
	printf '  "criteria": [\n'
	crit_json runs-clean headless "$S_RUNS" "$LOG_DIR/runs-clean.log"
	printf ',\n'
	crit_json renders-healthy windowed "$S_RENDER" "$LOG_DIR/render.log"
	printf ',\n'
	crit_json core-loop-functional headless "$S_LOOP" "$LOG_DIR/core-loop.log"
	printf ',\n'
	crit_json data-driven-adherence static "$S_DATA" "$LOG_DIR/data.log"
	printf ',\n'
	crit_json feel-responsive headless "$S_FEEL" "$LOG_DIR/core-loop.log"
	printf '\n'
	printf '  ],\n'
	printf '  "findings": [%s\n  ]\n' "$FINDINGS"
	printf '}\n'
} >"$OUT"

echo "playgrade: $OVERALL — $SLUG (runs-clean=$S_RUNS render=$S_RENDER core-loop=$S_LOOP; data/feel=SKIP in v1)"
echo "playgrade: report → $OUT"
[ "$OVERALL" = PASS ]
