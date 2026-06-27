// Compact tool: the orchestrator's control surface to compact ITS OWN session at a high-level
// goal boundary. Like the user's /compact button (session.js handleControlMessage), it queues a
// `/compact` user-turn into the session inbox — the SDK summarizes the transcript in place and
// sheds the bulk, keeping the SAME session alive (plugin, skills, warm cache, and the durable task
// board all survive). A SEMANTIC trigger (the goal is done) beats a blind token threshold: a
// finished goal is exactly where context is safe to shed — only the outcome matters forward.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** @typedef {(obj: import("../../lib/types.js").OutMsg) => void} Send */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {(msg: SDKUserMessage) => void} Push */

/** Build the compact tool. @param {Send} send @param {Push} push the session inbox.push — queues
 *  the /compact turn for AFTER the current turn settles (so call it as the last action). */
export function makeCompactTool(send, push) {
  return tool(
    "compact",
    "Compact THIS session's context at a high-level task/goal boundary: summarize the history in " +
      "place and shed the bulk, keeping the SAME session alive (plugin, skills, and the task board " +
      "all survive). Call ONLY after the user confirms the overall goal is done AND no background " +
      "work is in flight — and as your LAST action (it takes effect on the next turn). Pass " +
      "`summary` = what to carry forward (the completed goal + open tasks + key decisions); the " +
      "durable task board persists on disk regardless.",
    {
      summary: z
        .string()
        .optional()
        .describe(
          "what the compaction should preserve: the just-completed goal, open board tasks, and key decisions/constraints to remember",
        ),
    },
    async (input) => {
      const focus = (input.summary ?? "").trim();
      push({
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "text", text: focus ? `/compact ${focus}` : "/compact" }],
        },
      });
      send({
        type: "status",
        text: "compacting at goal boundary — summarizing the transcript, keeping the session…",
      });
      return {
        content: [
          {
            type: "text",
            text: "Compaction queued — the next turn summarizes the transcript and sheds the bulk; the task board survives.",
          },
        ],
      };
    },
  );
}
