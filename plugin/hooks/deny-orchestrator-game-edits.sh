#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit) DENY — the orchestrator must NEVER
# implement (orchestrator.md: "Never write game code, scenes, or shaders"). The prose
# rule gets ignored under pressure (e.g. "act directly while I test" misread as "edit
# files yourself"); this enforces it deterministically. Exact mirror of
# allow-game-edits.sh, which GRANTS these same edits to sub-agents — together: builders
# edit game content, the orchestrator routes it and never touches it.
#
# Scope (deliberately narrow):
#   * Orchestrator ONLY — gated on `agent_id` (absent on the main thread, present inside
#     an AgentTool worker). Sub-agents fall straight through to allow-game-edits.sh.
#   * GAME content ONLY — Godot file types + the game source dirs. Everything else
#     (`.claude/` authoring, `.xenodot/`, `library/` notes) falls through to the normal
#     permission layer so the orchestrator keeps its legit config/library writes.
#
# Reads the PreToolUse payload on stdin; emits a deny decision (exit 0) only on a match,
# otherwise exits silently so the normal permission layer decides.
payload="$(cat)"

# Sub-agent? Not the orchestrator — builders are allowed (allow-game-edits.sh grants them).
agent_id="$(printf '%s' "$payload" | jq -r '.agent_id // empty' 2>/dev/null)"
[ -n "$agent_id" ] && exit 0

# Target path (file_path for Edit/Write/MultiEdit, notebook_path for NotebookEdit).
fp="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)"
[ -z "$fp" ] && exit 0

# Deny GAME content only; config/library/task writes pass through. Matches both
# relative paths (orchestrator cwd is the game project) and absolute paths.
case "$fp" in
  *.gd | *.tscn | *.tres | *.gdshader | *.godot \
    | */entities/* | */scripts/* | */levels/* | */resources/* | */scenes/* | */shaders/* \
    | entities/* | scripts/* | levels/* | resources/* | scenes/* | shaders/*) ;;
  *) exit 0 ;;
esac

jq -cn '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"xenodot: the orchestrator never implements — route this game edit to a builder (xenodot:godot-dev or the domain specialist). See orchestrator.md."}}'
exit 0
