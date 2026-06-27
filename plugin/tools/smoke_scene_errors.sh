#!/bin/bash
# tools/smoke_scene_errors.sh — per-scene headless error capture (godot-verify layer 2b), runnable
# standalone. The LOGIC now lives in check_scene_errors (tools/lib/checks.sh); validate.sh and
# playgrade.sh call that function directly. This thin wrapper exists for running the scene-error
# pass on its own. The gate contract: fail on any non-benign ERROR / name-clash line from a
# headless scene instantiate.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1
XENO_GATE=smoke_scene_errors
# shellcheck source=lib/checks.sh
source "$SCRIPT_DIR/lib/checks.sh"
xeno_resolve_engine || exit 1
check_scene_errors
