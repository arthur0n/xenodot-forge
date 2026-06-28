#!/bin/bash
# tools/validate.sh — the builder's deterministic gate (the `pnpm validate` equivalent):
# format → lint → parse(+warnings-as-errors) → scenes → scene-errors → smoke → runtime bots.
#
# Composes the shared check library tools/lib/checks.sh, so validate.sh (the builder's floor) and
# playgrade.sh (the evaluator's rubric) run the EXACT same checks with no drift. This is the
# generic floor: a game adds its own project-specific steps (e.g. a named-clash lint over its own
# scene list) by calling more check_* / its own commands below the marked section.
#
# Usage (from the project root or anywhere):
#   tools/validate.sh                              # runs main scene
#   tools/validate.sh levels/open_world.tscn       # runs given scene
# Exit 0 = gate passed ("validate: OK").
set -u
# Resolve the script dir BEFORE cd, so sourcing is robust however the script was invoked.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1
PATH="$HOME/.local/bin:$PATH"

# shellcheck source=lib/checks.sh
source "$SCRIPT_DIR/lib/checks.sh"
xeno_resolve_engine || exit 1

SCENE_ARG="${1:-}"
SCENE_RES=""
[ -n "$SCENE_ARG" ] && SCENE_RES="res://$SCENE_ARG"

# --- generic floor (shared by every game) -----------------------------------------------------
check_format || exit 1
check_lint || exit 1
check_warnings_config || exit 1
check_parse || exit 1
check_props || exit 1
check_typed_export_nodepath || exit 1
check_scene_errors || exit 1
check_smoke "$SCENE_RES" || exit 1
check_smoke_bots || exit 1

# --- game-specific checks (add yours below; keep them out of the plugin template) --------------

echo "validate: OK"
