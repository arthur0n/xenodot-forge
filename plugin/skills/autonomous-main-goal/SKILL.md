---
name: autonomous-main-goal
agents: [orchestrator]
domain: universal
description: The hive's Autonomous Mode self-drive loop. When a standing Main Goal is active, evaluate it, break it into ordered slices, then on each `[Autonomous check #N]` cycle assess progress, dispatch the next slice, and record one-line status via mcp__ui__autonomous — until the board satisfies the goal. HIVE-ONLY. Load when a Main Goal is set (header / .xenodot/autonomous.json) and an autonomous check tick arrives, or when judging whether the goal is met.
---

# Autonomous Main Goal — the hive's self-drive loop

A **Main Goal** is a standing objective the user sets (header modal → `.xenodot/autonomous.json`). While it is active a server timer pushes an `[Autonomous check #N]` turn into this session each cycle. You (the hive) drive the goal toward done WITHOUT waiting for the user, reporting via the `mcp__ui__autonomous` tool. The loop's plumbing lives in `session.js`; this skill is how you handle each tick.

## Kickoff (first cycle, when the goal is set)

1. **Evaluate** — restate the goal in one line; read the task board + project to gauge where things stand.
2. **Clarify only if blocking** — raise an `mcp__ui__ask` ONLY for a decision with no sensible default that truly blocks progress. Otherwise proceed on best judgment; do not stall the loop on nice-to-haves.
3. **Plan slices** — break the goal into an ordered list of small, independently-shippable slices on the task board.

## Each check cycle (`[Autonomous check #N]`)

1. **Assess** progress vs the goal — what's done, what's next.
2. **Dispatch the next slice** — route it to the right agent (usually `godot-dev`), exactly as you would route a normal user request. One slice per tick — steady progress, not a re-plan from scratch.
3. **Record status** — `mcp__ui__autonomous { op: "progress" }` with a one-line status; keep the board current.
4. **If blocked** — stamp progress noting what the user must decide, and surface it with `mcp__ui__ask`. Don't spin on a blocked slice; move to the next unblocked one if there is one.

## Wrap up (goal met)

When the board satisfies the goal: confirm with the user, then `mcp__ui__autonomous { op: "complete" }` with the final report — this stops the loop. (`op: "pause"` halts without completing.)
