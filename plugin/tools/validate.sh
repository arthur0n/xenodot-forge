#!/bin/bash
# tools/validate.sh — the project's validate gate (the `pnpm validate` equivalent):
# format + lint + parse(+warnings-as-errors) + scene properties + smoke run.
# Steps 4–5 are godot-verify layers 1–2; layer 3 (render) needs a display and
# stays in the godot-verify skill.
#
# Usage (from the project root or anywhere):
#   tools/validate.sh                              # runs main scene
#   tools/validate.sh levels/open_world.tscn       # runs given scene
# Exit 0 = gate passed ("validate: OK").
set -u
cd "$(dirname "$0")/.." || exit 1

SCENE_ARG="${1:-}"
SCENE_RES=""
if [ -n "$SCENE_ARG" ]; then
	SCENE_RES="res://$SCENE_ARG"
fi

PATH="$HOME/.local/bin:$PATH"

# Resolve the engine binary. Godot and its compatible forks (Redot, Blazium)
# share the same CLI, so any of them runs this gate unchanged. Resolution order:
#   $GODOT override → a binary on PATH (godot/redot/blazium) → common install
#   paths → fail with guidance. Point at a fork by exporting GODOT=/path/to/it.
resolve_engine() {
	if [ -n "${GODOT:-}" ]; then
		printf '%s' "$GODOT"
		return 0
	fi
	for name in godot redot blazium; do
		if command -v "$name" >/dev/null 2>&1; then
			command -v "$name"
			return 0
		fi
	done
	for p in \
		/Applications/Godot.app/Contents/MacOS/Godot \
		/Applications/Redot.app/Contents/MacOS/Redot \
		/Applications/Blazium.app/Contents/MacOS/Blazium \
		/usr/local/bin/godot /usr/bin/godot; do
		if [ -x "$p" ]; then
			printf '%s' "$p"
			return 0
		fi
	done
	return 1
}

if ! GODOT="$(resolve_engine)"; then
	echo "validate: FAIL setup — no engine binary found."
	echo "  Set GODOT to your engine executable, e.g.:"
	echo "    GODOT=/Applications/Godot.app/Contents/MacOS/Godot tools/validate.sh"
	echo "  Godot, Redot and Blazium all work — they share the same CLI."
	exit 1
fi

GD_FILES=$(find . -name '*.gd' -not -path './.godot/*' -not -path './addons/*' | sed 's|^\./||')
if [ -z "$GD_FILES" ]; then
	echo "validate: FAIL setup — no .gd files found"
	exit 1
fi

fail() {
	echo "validate: FAIL $1"
	exit 1
}

# 1. format
# shellcheck disable=SC2086
if ! gdformat --check $GD_FILES; then
	fail "format — run: gdformat <file> on the files listed above"
fi
echo "validate: PASS format"

# 2. lint
# shellcheck disable=SC2086
if ! gdlint $GD_FILES; then
	fail "lint"
fi
echo "validate: PASS lint"

# 3. parse + analyzer warnings (escalated to errors by project.godot [debug]).
# --import first: rebuilds the global class cache so new class_name scripts resolve.
if ! "$GODOT" --headless --path . --import >/dev/null 2>&1; then
	fail "import — godot --import failed; run it manually to see the errors"
fi

for f in $GD_FILES; do
	out=$("$GODOT" --headless --path . --check-only --script "res://$f" 2>&1)
	status=$?
	if [ $status -ne 0 ] || echo "$out" | grep -qE "SCRIPT ERROR|Parse Error|WARNING"; then
		echo "$out"
		fail "parse — $f"
	fi
done
echo "validate: PASS parse"

# 4. scene property validation (godot-verify layer 1)
if ! "$GODOT" --headless --path . --script tools/verify_scene.gd; then
	fail "scenes"
fi
echo "validate: PASS scenes"

# 5. smoke run (godot-verify layer 2) — any ERROR/WARNING line = failure
smoke=$("$GODOT" --headless --path . ${SCENE_RES:+"$SCENE_RES"} --quit-after 3 2>&1 | grep -E "SCRIPT ERROR|ERROR|WARNING" | grep -Ev "ObjectDB instances leaked|resources still in use at exit|RID allocations leaked")
if [ -n "$smoke" ]; then
	echo "$smoke"
	fail "smoke"
fi
echo "validate: PASS smoke"

echo "validate: OK"
