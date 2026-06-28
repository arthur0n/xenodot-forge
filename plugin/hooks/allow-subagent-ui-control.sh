#!/usr/bin/env bash
# PreToolUse(mcp__ui__tasks|mcp__ui__ask|mcp__ui__promote|mcp__ui__request_asset) grant —
# let a SUB-AGENT use the async, non-blocking UI-control tools without an interactive prompt.
# This is the lever that
# reaches a BACKGROUNDED (headless) sub-agent: it has no interactive approver, so the
# SDK auto-denies any tool not pre-granted (SDKPermissionDeniedMessage, decision
# reason "asyncAgent" — "Permission prompts are not available in this context").
#
# Why a hook and not AUTO_ALLOW_TOOLS: these tools are normally auto-allowed by
# uiControlAllow() INSIDE canUseTool (ui-control.js), which a backgrounded sub-agent
# never reaches. Adding them to the SDK `allowedTools` bare-name list WOULD reach the
# background, but it bypasses canUseTool for ALL callers — wiping uiControlAllow's
# `_by: <agent>` attribution stamp for the FOREGROUND orchestrator too (and the
# in-process MCP tool() handler's `extra` arg carries no reliable caller identity to
# recover it). A PreToolUse hook, by contrast, receives `agent_id`, so we can grant
# ONLY sub-agents and leave the orchestrator on its normal canUseTool path (where it
# still gets stamped `_by: "main"`). Exact sibling of allow-game-edits.sh.
#
# When the hook grants (sub-agent path), canUseTool is skipped so the tool handler sees
# `_by: undefined`; the handlers default it to "background" (the label the bridge +
# surfaceDenial already use). See ask-tool.js / task-tool.js.
#
# Scope (deliberately narrow):
#   * Sub-agents ONLY — gated on `agent_id` (present only inside an AgentTool worker,
#     absent on the main thread; same field allow-game-edits.sh uses). The orchestrator
#     keeps its interactive/canUseTool approval policy untouched.
#   * Only the ASYNC, side-effect-free UI-control tools (they file to the board / task
#     panel and return immediately): mcp__ui__tasks, mcp__ui__ask, mcp__ui__promote,
#     mcp__ui__request_asset. The matcher in hooks.json restricts this hook to those
#     names; the agent_id gate is the real guard. NOT granted here:
#       - mcp__ui__form — FOREGROUND-ONLY. It BLOCKS for a reply a headless worker can't
#         receive. Granting it here would also bypass canUseTool for FOREGROUND sub-agents
#         (e.g. game-designer) and break their blocking interviews, since a PreToolUse hook
#         can't tell a foreground sub-agent from a backgrounded one (no flag in the payload).
#         Backgrounded agents use mcp__ui__ask instead — it posts to the task panel.
#       - mcp__ui__autonomous / mcp__ui__compact — Hive/orchestrator-only control surfaces.
#       - mcp__ui__hermes — a real billable side-effect; stays per-call gated.
#
# Reads the PreToolUse payload on stdin; emits an allow decision (exit 0) only for a
# sub-agent, otherwise exits silently so the normal permission layer decides.
payload="$(cat)"

# Sub-agent only — the main orchestrator is never auto-granted here.
agent_id="$(printf '%s' "$payload" | jq -r '.agent_id // empty' 2>/dev/null)"
[ -z "$agent_id" ] && exit 0

jq -cn '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",permissionDecisionReason:"xenodot: sub-agent async UI-control tool (background-safe grant)"}}'
exit 0
