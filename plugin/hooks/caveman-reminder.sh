#!/usr/bin/env bash
# PreToolUse(*) caveman refresher — re-inject the terse-output rule before EVERY
# sub-agent tool call. The `caveman` skill is preloaded into every agent's context,
# but preloaded text is reference, not a live constraint: over a long, tool-heavy
# turn the model drifts back to verbose narration. Re-injecting on each tool call
# refreshes the rule so it can't decay.
#
# Scoped to sub-agents ONLY via `agent_id` (BaseHookInput field present only inside
# an AgentTool worker, absent on the main thread). The main orchestrator session is
# never nudged — it is not a caveman context.
#
# Emits a PreToolUse additionalContext payload (non-blocking); for the main thread it
# exits silently so nothing is injected.
payload="$(cat)"
agent_id="$(printf '%s' "$payload" | jq -r '.agent_id // empty' 2>/dev/null)"
[ -z "$agent_id" ] && exit 0

ctx="caveman mode active: terse output. Compress ALL prose you emit — INCLUDING running commentary between tool calls and mid-task status, not just final reports. Drop articles/filler/pleasantries; fragments OK. Code, errors and identifiers stay exact. Full prose ONLY for mcp__ui__form field labels/descriptions and destructive-action warnings."

jq -cn --arg c "$ctx" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$c}}'
exit 0
