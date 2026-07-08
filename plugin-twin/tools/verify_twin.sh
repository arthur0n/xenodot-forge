#!/bin/bash
# tools/verify_twin.sh — the twin builder's deterministic gate (skill: twin-verify):
# the shared static floor (tools/lib/checks.sh — the SAME library validate.sh composes,
# materialized into the project from the base xenodot plugin) + the twin-specific checks:
# GlobalId join coverage, data-binding smoke, frame-budget bench.
#
# STATUS: static floor + join-coverage gate are LIVE. The frame-budget gate runs opt-in
# (TWIN_BENCH=1, needs a real display) and SKIPs loudly otherwise; binding-smoke is Phase 3
# scope and SKIPs loudly until its fixtures exist (a SKIP is not a pass — see the skill).
#
# Usage (from the project root or anywhere):
#   tools/verify_twin.sh                              # runs main scene
#   tools/verify_twin.sh path/to/scene.tscn           # runs given scene
# Exit 0 = gate passed ("verify-twin: OK").
set -u
# Resolve the script dir BEFORE cd, so sourcing is robust however the script was invoked.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1
PATH="$HOME/.local/bin:$PATH"

# Label the shared checks' output as this gate's.
XENO_GATE="verify-twin"
# shellcheck source=lib/checks.sh
source "$SCRIPT_DIR/lib/checks.sh"
xeno_resolve_engine || exit 1

SCENE_ARG="${1:-}"
SCENE_RES=""
[ -n "$SCENE_ARG" ] && SCENE_RES="res://$SCENE_ARG"

# --- static floor (shared with the base plugin's validate.sh — no drift) ----------------------
check_format || exit 1
check_lint || exit 1
check_warnings_config || exit 1
check_parse || exit 1
check_props || exit 1
check_scene_errors || exit 1
check_smoke "$SCENE_RES" || exit 1

# --- twin checks (skill: twin-verify) ----------------------------------------------------------

# GlobalId join coverage — headless join gate (tools/check_twin_join.gd). Output contract:
#   JOIN: <matched>/<total> (<pct>%)   then   JOIN-GATE: OK|FAIL (min <pct>%)
# Pair source precedence: TWIN_MODEL + TWIN_SIDECAR env → auto-discovery (newest .glb under
# models/ and x-shared-assets/ with a sibling <base>_props.json or <base>.props.json).
# Threshold: TWIN_JOIN_MIN (ratio, default 0.95).
_twin_discover_pair() {
	local found glb base cand
	found="$(find -L models x-shared-assets -name '*.glb' -type f 2>/dev/null)"
	[ -z "$found" ] && return 1
	while IFS= read -r glb; do
		base="${glb%.glb}"
		for cand in "${base}_props.json" "${base}.props.json"; do
			if [ -f "$cand" ]; then
				TWIN_MODEL="$glb"
				TWIN_SIDECAR="$cand"
				return 0
			fi
		done
	done < <(echo "$found" | xargs ls -t 2>/dev/null)
	return 1
}
if [ -z "${TWIN_MODEL:-}" ] || [ -z "${TWIN_SIDECAR:-}" ]; then
	_twin_discover_pair || true
fi
if [ -n "${TWIN_MODEL:-}" ] && [ -n "${TWIN_SIDECAR:-}" ]; then
	if ! "$GODOT" --headless --path . --script "$SCRIPT_DIR/check_twin_join.gd" -- \
		"--scene=$TWIN_MODEL" "--sidecar=$TWIN_SIDECAR" "--min=${TWIN_JOIN_MIN:-0.95}"; then
		echo "$XENO_GATE: FAIL join-coverage — see JOIN/MISS_SAMPLE lines above"
		exit 1
	fi
	echo "$XENO_GATE: PASS join-coverage ($TWIN_MODEL vs $TWIN_SIDECAR)"
else
	echo "$XENO_GATE: SKIP join-coverage — no model+sidecar pair found (a SKIP is not a pass)."
	echo "  Looked for the newest .glb under models/ and x-shared-assets/ with a sibling"
	echo "  <base>_props.json or <base>.props.json. Point the gate at a pair explicitly:"
	echo "    TWIN_MODEL=models/foo.glb TWIN_SIDECAR=models/foo_props.json tools/verify_twin.sh"
fi

# Data-binding smoke — seeded sim + bounded viewer run + state asserts (twin-bind-data fixture).
if [ -f "tools/smoke_binding.gd" ] && [ -f "sim/server.js" ]; then
	node sim/server.js --seed 42 &
	SIM_PID=$!
	SMOKE_RC=0
	"$GODOT" --headless --path . -s tools/smoke_binding.gd || SMOKE_RC=1
	kill "$SIM_PID" 2>/dev/null
	if [ "$SMOKE_RC" -ne 0 ]; then
		echo "$XENO_GATE: FAIL binding-smoke — see BIND-SMOKE lines above"
		exit 1
	fi
	echo "$XENO_GATE: PASS binding-smoke"
else
	echo "$XENO_GATE: SKIP binding-smoke — Phase 3 scope (data-binding lands then; needs"
	echo "  tools/smoke_binding.gd + sim/server.js — a SKIP is not a pass)"
fi

# Frame-budget bench — the gate never fabricates an fps number: it needs a REAL window
# (frames-drawn methodology, see bench_scene.gd / twin-optimize). Budget source precedence:
#   1. TWIN_FRAME_BUDGET_MS env   2. viewer.cfg  [twin]  frame_budget_ms=<ms>
# Agent/CI context is headless by default, so the bench is OPT-IN: set TWIN_BENCH=1 from a
# session with a real display; otherwise this SKIPs loudly with the exact windowed command.
_twin_budget_ms() {
	if [ -n "${TWIN_FRAME_BUDGET_MS:-}" ]; then
		echo "$TWIN_FRAME_BUDGET_MS"
		return 0
	fi
	[ -f viewer.cfg ] || return 1
	awk -F= '
		/^\[/ { sect = $0 }
		sect == "[twin]" && $1 ~ /^[ \t]*frame_budget_ms[ \t]*$/ { gsub(/[ \t]/, "", $2); v = $2 }
		END { if (v != "") print v; else exit 1 }
	' viewer.cfg
}
BUDGET_MS="$(_twin_budget_ms)" || BUDGET_MS=""
if [ -z "$BUDGET_MS" ]; then
	echo "$XENO_GATE: SKIP frame-budget — no budget stated (a SKIP is not a pass; an architect"
	echo "  finding, not a green light). Set TWIN_FRAME_BUDGET_MS=<ms> or add to viewer.cfg:"
	echo "    [twin]"
	echo "    frame_budget_ms=16.7"
elif [ "${TWIN_BENCH:-}" != "1" ]; then
	echo "$XENO_GATE: SKIP frame-budget — windowed bench not run (agent/headless context;"
	echo "  a SKIP is not a pass). From a session with a REAL display run:"
	echo "    TWIN_BENCH=1 tools/verify_twin.sh${SCENE_ARG:+ $SCENE_ARG}"
	echo "  or bench directly:"
	echo "    $GODOT --path . -s tools/bench_scene.gd -- ${SCENE_ARG:-<scene.tscn>} --out .xenodot/bench/bench.json"
else
	BENCH_OUT="$("$GODOT" --path . -s tools/bench_scene.gd -- ${SCENE_ARG:+"$SCENE_ARG"} 2>&1)"
	echo "$BENCH_OUT"
	if echo "$BENCH_OUT" | grep -q "^BENCH: SKIP"; then
		echo "$XENO_GATE: SKIP frame-budget — bench SKIPped (headless renderer; a SKIP is not a pass)"
	else
		FRAME_MS="$(echo "$BENCH_OUT" | sed -nE 's/^BENCH: \{.*"frame_ms":([0-9.]+).*/\1/p' | tail -1)"
		if [ -z "$FRAME_MS" ]; then
			echo "$XENO_GATE: FAIL frame-budget — bench produced no BENCH row (see output above)"
			exit 1
		fi
		if awk -v f="$FRAME_MS" -v b="$BUDGET_MS" 'BEGIN { exit !(f <= b) }'; then
			echo "$XENO_GATE: PASS frame-budget (frame_ms=$FRAME_MS <= budget ${BUDGET_MS}ms)"
		else
			echo "$XENO_GATE: FAIL frame-budget (frame_ms=$FRAME_MS > budget ${BUDGET_MS}ms)"
			exit 1
		fi
	fi
fi

echo "verify-twin: OK"
