#!/bin/bash
# tools/verify_twin.sh — the twin builder's deterministic gate (skill: twin-verify):
# the shared static floor (tools/lib/checks.sh — the SAME library validate.sh composes,
# materialized into the project from the base xenodot plugin) + the twin-specific checks:
# GlobalId join coverage, data-binding smoke, frame-budget bench.
#
# STATUS: static floor, join-coverage, and data-binding smoke gates are LIVE. The binding smoke
# drives the real viewer shell headless (seeded sim → DataBus → binding → node albedo moves; MMI
# instance-colour is windowed-only). The frame-budget gate runs opt-in (TWIN_BENCH=1, needs a real
# display) and SKIPs loudly otherwise (a SKIP is not a pass — see the skill).
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
	local glb base cand
	# Newest-first .glb enumeration, null-safe: BIM exports routinely carry spaces
	# ("Duplex Apartment.glb"), so we pass names via -print0/xargs -0 (never word-split) and
	# order by mtime. macOS stat: `-f '%m %N'` (mtime<space>name); Linux: `stat -c '%Y %n'`.
	# Newest .glb with a sibling <base>_props.json or <base>.props.json wins (behavior unchanged).
	while IFS= read -r glb; do
		[ -n "$glb" ] || continue
		base="${glb%.glb}"
		for cand in "${base}_props.json" "${base}.props.json"; do
			if [ -f "$cand" ]; then
				TWIN_MODEL="$glb"
				TWIN_SIDECAR="$cand"
				return 0
			fi
		done
	done < <(
		find -L models x-shared-assets -name '*.glb' -type f -print0 2>/dev/null \
			| xargs -0 stat -f '%m %N' 2>/dev/null | sort -rn | cut -d' ' -f2-
	)
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
# It drives the REAL viewer shell (main.tscn: DataBus autoload + main.gd's BindingMap) headless via
# tools/smoke_binding.gd, asserting: DataBus up + frames>0 + drops==0, every binding resolved, and
# >=1 NODE target's albedo actually MOVING (MMI instance-colour is windowed-only under the headless
# dummy renderer — asserted as wiring + flagged MMI-SMOKE: WINDOWED-ONLY, never failed here).
#
# Binding-map source precedence (must match the map the viewer actually loads):
#   1. TWIN_BINDING_MAP env   2. viewer.cfg [twin] binding_map=   3. default binding_map.json
# The sim is seeded (seed 42, deterministic) on TWIN_SIM_PORT (default 8899). The port is chosen
# deterministically and we fail loudly if it is already busy (override with TWIN_SIM_PORT). The sim
# is ALWAYS reaped — an EXIT trap plus an explicit kill + pkill (a bare `kill $!` leaves orphans if
# node re-execs), so no stream server survives the gate.
_twin_binding_map() {
	if [ -n "${TWIN_BINDING_MAP:-}" ]; then
		echo "$TWIN_BINDING_MAP"
		return 0
	fi
	if [ -f viewer.cfg ]; then
		local m
		m="$(awk -F= '
			/^\[/ { sect = $0 }
			sect == "[twin]" && $1 ~ /^[ \t]*binding_map[ \t]*$/ { gsub(/[ \t"]/, "", $2); v = $2 }
			END { if (v != "") print v }
		' viewer.cfg)"
		if [ -n "$m" ]; then
			echo "$m"
			return 0
		fi
	fi
	echo "binding_map.json"
}
# The gate runs its OWN sim on 8899 — deliberately NOT the sim default 8765 (plugin-twin/tools/sim/
# server.js DEFAULT_PORT, which the viewer's core/data_bus.gd DEFAULT_URL also targets). Using a
# different port means this gate never collides with a sim a developer is already running on 8765
# during authoring. Override with TWIN_SIM_PORT=<free port> if 8899 is taken.
TWIN_SIM_PORT="${TWIN_SIM_PORT:-8899}"
# Deterministic-fixture pins (see the twin-bind-data / twin-verify skills):
#   TWIN_SIM_SEED — any fixed integer replays bit-for-bit; 42 is the conventional arbitrary seed and
#     matches sim/server.js DEFAULT_SEED, so the smoke's expectations don't depend on that default.
#   TWIN_SIM_HZ   — MUST equal smoke_binding.gd STREAM_HZ and sim/server.js DEFAULT_HZ: the smoke
#     converts --frames=N to seconds as N/STREAM_HZ, so changing one without the others desyncs it.
TWIN_SIM_SEED=42
TWIN_SIM_HZ=10
if [ ! -f "tools/smoke_binding.gd" ] || [ ! -f "tools/sim/server.js" ]; then
	_miss=""
	[ -f "tools/smoke_binding.gd" ] || _miss="$_miss tools/smoke_binding.gd"
	[ -f "tools/sim/server.js" ] || _miss="$_miss tools/sim/server.js"
	echo "$XENO_GATE: SKIP binding-smoke — missing:$_miss (a SKIP is not a pass)"
else
	BIND_MAP="$(_twin_binding_map)"
	if [ ! -f "$BIND_MAP" ]; then
		echo "$XENO_GATE: SKIP binding-smoke — no binding map at '$BIND_MAP' (source precedence:"
		echo "  TWIN_BINDING_MAP env → viewer.cfg [twin] binding_map= → binding_map.json). A SKIP is"
		echo "  not a pass — author the map (twin-bind-data) or point TWIN_BINDING_MAP at it."
	elif (exec 3<>"/dev/tcp/localhost/$TWIN_SIM_PORT") 2>/dev/null; then
		exec 3>&- 3<&- 2>/dev/null || true
		echo "$XENO_GATE: FAIL binding-smoke — port $TWIN_SIM_PORT is busy; the sim needs it free."
		echo "  Free it or re-run with TWIN_SIM_PORT=<free port> tools/verify_twin.sh"
		exit 1
	else
		node tools/sim/server.js --seed "$TWIN_SIM_SEED" --port "$TWIN_SIM_PORT" \
			--hz "$TWIN_SIM_HZ" --map "$BIND_MAP" &
		SIM_PID=$!
		# ALWAYS reap the sim, even on an unexpected exit between here and the explicit kill.
		trap 'kill "$SIM_PID" 2>/dev/null; pkill -f "tools/sim/server.js" 2>/dev/null' EXIT
		sleep 0.4
		SMOKE_RC=0
		"$GODOT" --headless --path . --script tools/smoke_binding.gd -- \
			"--map=$BIND_MAP" "--url=ws://localhost:$TWIN_SIM_PORT" || SMOKE_RC=1
		kill "$SIM_PID" 2>/dev/null
		pkill -f "tools/sim/server.js" 2>/dev/null
		trap - EXIT
		if [ "$SMOKE_RC" -ne 0 ]; then
			echo "$XENO_GATE: FAIL binding-smoke — see BIND-SMOKE lines above"
			exit 1
		fi
		echo "$XENO_GATE: PASS binding-smoke ($BIND_MAP @ seed $TWIN_SIM_SEED, ws://localhost:$TWIN_SIM_PORT)"
	fi
fi

# Hint-group assertion — only when TWIN_MODEL is an OPTIMIZED scene (.tscn/.scn) with a sibling
# <base>_hints.json (the hints file that produced it). Asserts the optimized scene actually carries
# a node in each group the hints' used keys materialise (no_instance → twin_no_instance, occluder →
# twin_occluder). The simplest honest check that the optimizer's hint pass landed; silent no-op when
# TWIN_MODEL is a raw model or no sibling hints file exists (the common case).
if [ -f "tools/smoke_binding.gd" ] && [ -n "${TWIN_MODEL:-}" ]; then
	case "$TWIN_MODEL" in
	*.tscn | *.scn)
		HINTS_SIB="${TWIN_MODEL%.*}_hints.json"
		if [ -f "$HINTS_SIB" ]; then
			HINTS_RC=0
			"$GODOT" --headless --path . --script tools/smoke_binding.gd -- \
				--mode=hints "--scene=$TWIN_MODEL" "--hints=$HINTS_SIB" || HINTS_RC=1
			if [ "$HINTS_RC" -ne 0 ]; then
				echo "$XENO_GATE: FAIL binding-hints — see HINTS-SMOKE line above"
				exit 1
			fi
			echo "$XENO_GATE: PASS binding-hints ($TWIN_MODEL vs $HINTS_SIB)"
		fi
		;;
	esac
fi

# Playback determinism — the recorded-stream player is reproducible (skill: twin-playback). Drives
# tools/check_playback.gd headless: load a synthesized fixture, seek, play, pause, and hash the
# emitted (tag|value|seq) sequence; two runs of the SAME fixture+seeks MUST print the SAME
# PLAYBACK-HASH — that IS the determinism gate.
#
# SYNTHESIZED FIXTURES ONLY: fixture mode (node tools/sim/record.js, no network) is byte-reproducible
# per (--seed,--seconds,--hz) — see sim/recording.js. Byte-reproducibility is the FOUNDATION here: a
# LIVE capture carries seed:-1 and a non-zero-based seq (the source counts while the recorder is
# away), so it is observation, not a reproducible input, and could never anchor a determinism check.
#
# --fixed-fps is REQUIRED: check_playback's emitted-frame hash is order-exact (reproduces at any
# frame rate), but the flag honours playback.gd's clock contract and bounds the run — see that
# script's header. PLAYBACK_FIXED_FPS: 60, the conventional real-time rate; any fixed value works.
PLAYBACK_FIXED_FPS=60
# Seconds of stream to synthesize. 3 s = 30 ticks at TWIN_SIM_HZ (10) — enough for two interior
# seeks plus a play window, small enough to keep two headless legs fast. Seed/hz REUSE the sim pins
# (TWIN_SIM_SEED/TWIN_SIM_HZ = sim/stream.js DEFAULT_SEED/DEFAULT_HZ set above), so the gate's
# fixture is the exact stream a live viewer would see.
PLAYBACK_SECONDS=3
_pb_miss=""
command -v node >/dev/null 2>&1 || _pb_miss="$_pb_miss node"
[ -f tools/sim/record.js ] || _pb_miss="$_pb_miss tools/sim/record.js"
[ -f tools/check_playback.gd ] || _pb_miss="$_pb_miss tools/check_playback.gd"
[ -f core/playback.gd ] || _pb_miss="$_pb_miss core/playback.gd"
if [ -n "$_pb_miss" ]; then
	echo "$XENO_GATE: SKIP playback-determinism — missing:$_pb_miss (a SKIP is not a pass)"
else
	PB_FIXTURE=".xenodot/tmp/playback-fixture.ndjson"
	mkdir -p "$(dirname "$PB_FIXTURE")"
	# ALWAYS remove the synthesized fixture, even on an unexpected exit before the explicit rm below
	# (mirrors the binding-smoke sim reaping — no tmp artifact survives the gate).
	trap 'rm -f "$PB_FIXTURE" 2>/dev/null' EXIT
	PB_SYNTH="$(node tools/sim/record.js --out "$PB_FIXTURE" --seconds "$PLAYBACK_SECONDS" \
		--seed "$TWIN_SIM_SEED" --hz "$TWIN_SIM_HZ" 2>&1)"
	if [ $? -ne 0 ] || [ ! -f "$PB_FIXTURE" ]; then
		echo "$PB_SYNTH"
		echo "$XENO_GATE: FAIL playback-determinism — fixture synthesis failed (record.js)"
		exit 1
	fi
	# Two interior seeks derived from the fixture's own duration (record.js prints duration_ms).
	PB_DUR="$(echo "$PB_SYNTH" | sed -nE 's/.*duration_ms=([0-9]+).*/\1/p')"
	PB_SEEKS="$(awk -v d="${PB_DUR:-0}" 'BEGIN { printf "%d,%d", d/3, (2*d)/3 }')"
	# Run the gate TWICE; the two PLAYBACK-HASH lines being IDENTICAL is the determinism assertion.
	PB_LOG_A="$("$GODOT" --headless --fixed-fps "$PLAYBACK_FIXED_FPS" --path . \
		--script tools/check_playback.gd -- "--recording=$PWD/$PB_FIXTURE" "--seek=$PB_SEEKS" 2>&1)"
	PB_RC_A=$?
	PB_LOG_B="$("$GODOT" --headless --fixed-fps "$PLAYBACK_FIXED_FPS" --path . \
		--script tools/check_playback.gd -- "--recording=$PWD/$PB_FIXTURE" "--seek=$PB_SEEKS" 2>&1)"
	PB_RC_B=$?
	PB_HASH_A="$(echo "$PB_LOG_A" | grep '^PLAYBACK-HASH:')"
	PB_HASH_B="$(echo "$PB_LOG_B" | grep '^PLAYBACK-HASH:')"
	if [ "$PB_RC_A" -ne 0 ] || [ "$PB_RC_B" -ne 0 ]; then
		echo "$PB_LOG_A" | grep -E '^PLAYBACK-(HASH|GATE)'
		echo "$PB_LOG_B" | grep -E '^PLAYBACK-(HASH|GATE)'
		echo "$XENO_GATE: FAIL playback-determinism — a leg's gate failed (see PLAYBACK-GATE above)"
		exit 1
	fi
	if [ "$PB_HASH_A" != "$PB_HASH_B" ]; then
		echo "  leg A: $PB_HASH_A"
		echo "  leg B: $PB_HASH_B"
		echo "$XENO_GATE: FAIL playback-determinism — same fixture+seeks produced different hashes"
		exit 1
	fi
	rm -f "$PB_FIXTURE"
	trap - EXIT
	echo "$XENO_GATE: PASS playback-determinism ($PB_HASH_A, seeks=$PB_SEEKS, --fixed-fps $PLAYBACK_FIXED_FPS)"
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
