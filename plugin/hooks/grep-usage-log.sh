#!/usr/bin/env bash
# PreToolUse(Bash|Grep) grep-usage logger — OBSERVE-ONLY, NON-BLOCKING. Records which named
# sub-agent reached for raw search (the Grep TOOL, or grep/rg/ag/ack via Bash) instead of the
# `graphify` knowledge-graph skill. The point is data-driven rollout: spot the agents that lean
# on raw search so we know who should get `graphify` next (scope it into their frontmatter, the
# same way bug-triage got it). NEVER blocks, denies, or rewrites — appends one JSON row, exit 0.
#
# Scoped to sub-agents via `agent_id` (absent on the orchestrator/main thread → skip). The agent
# NAME is `agent_type` — it matches the agent's frontmatter `name:` (e.g. godot-weapons-abilities) and is
# populated inside a sub-agent (Claude Code hook input). Logged as "" if a build doesn't supply
# it; the fallback is a SubagentStart agent_id→name map, but agent_type covers current builds.
#
# Log: logs/grep-usage.log (JSONL) under the framework dir. One row per search. Roll it up with:
#   jq -s 'group_by(.agent)|map({agent:.[0].agent, n:length,
#          grep_tool:(map(select(.kind=="grep-tool"))|length),
#          bash_grep:(map(select(.kind=="bash-grep"))|length)})|sort_by(-.n)' logs/grep-usage.log
payload="$(cat)"

# Sub-agents only — agent_id is absent on the main/orchestrator thread.
agent_id="$(printf '%s' "$payload" | jq -r '.agent_id // empty' 2>/dev/null)"
[ -z "$agent_id" ] && exit 0

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
agent_type="$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null)"
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"

kind=""
query=""
case "$tool" in
  Grep)
    kind="grep-tool"
    query="$(printf '%s' "$payload" | jq -r '.tool_input.pattern // empty' 2>/dev/null)"
    ;;
  Bash)
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    [ -z "$cmd" ] && exit 0
    # First meaningful token, unwrapping an `rtk` prefix (so `rtk grep …` counts as grep).
    first="$(printf '%s' "$cmd" | awk '{print $1; exit}')"
    [ "$first" = "rtk" ] && first="$(printf '%s' "$cmd" | awk '{print $2; exit}')"
    case "$first" in
      grep|egrep|fgrep|rg|ag|ack|ripgrep) kind="bash-grep" ;;
      *) exit 0 ;; # non-search Bash — not what we're measuring
    esac
    query="$(printf '%s' "$cmd" | tr '\n' ' ' | cut -c1-100)"
    ;;
  *) exit 0 ;;
esac

ts="$(date +%Y-%m-%dT%H:%M:%S%z 2>/dev/null || echo "")"
log_dir="${XENODOT_PLUGIN%/plugin}/logs"
[ -n "${XENODOT_PLUGIN:-}" ] || log_dir="${TMPDIR:-/tmp}"
{
  mkdir -p "$log_dir" 2>/dev/null &&
    jq -cn \
      --arg ts "$ts" --arg s "$session_id" --arg aid "$agent_id" --arg at "$agent_type" \
      --arg k "$kind" --arg q "$query" \
      '{ts:$ts, session_id:$s, agent_id:$aid, agent:$at, kind:$k, query:$q}' \
      >>"$log_dir/grep-usage.log"
} 2>/dev/null

exit 0
