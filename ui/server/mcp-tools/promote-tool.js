// Promote tool: files a request to promote a game-local capability (a tool, skill,
// or agent) into the framework plugin so every game gets it. Like the task tool it
// does NOT pause — it records the request in the deterministic promotions manifest
// (promotions-store.js), broadcasts the new list to the UI (where the user
// approves/rejects), and returns immediately. The actual file move happens later,
// out of band, via `npm run promote -- --pending`. Authoring stays game-local by
// default; this is how the deliberate, human-gated globalization gets TRACKED
// instead of living in the conversation.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addPromotion, summarize } from "../features/promotions/promotions-store.js";

/** @param {(obj: import("../../lib/types.js").OutMsg) => void} send */
export function makePromoteTool(send) {
  return tool(
    "promote",
    "Request that a game-local capability be promoted into the framework plugin (so " +
      "EVERY game gets it). Use when a tool/skill/agent the project authored locally has " +
      "proven broadly useful, not specific to this game. It does NOT move files or pause " +
      "the session — it records the request on the promotions board for the user to " +
      "approve/reject; on approval the user runs `npm run promote -- --pending`. Default " +
      "to keeping things local; promote deliberately.",
    {
      kind: z.enum(["tools", "skills", "agents"]).describe("What kind of capability to promote."),
      name: z
        .string()
        .describe(
          "Its name as it lives game-local: a tools/ filename (e.g. profile_frame.gd), a " +
            ".claude/skills/<name> dir, or a .claude/agents/<name>(.md).",
        ),
      reason: z
        .string()
        .optional()
        .describe("One line: why this is broadly useful beyond this game (the user reads it)."),
      // Internal: the requesting agent, set by the server (canUseTool) — do not set it yourself.
      _by: z.string().optional().describe("internal — server-set; ignore"),
    },
    async (input) => {
      // canUseTool stamps `_by` for foreground callers; a backgrounded sub-agent is granted
      // by the allow-subagent-ui-control hook (which bypasses canUseTool), so `_by` is absent
      // here — attribute it to "background" (the bridge's own label).
      const list = addPromotion(
        { kind: input.kind, name: input.name, reason: input.reason, by: input._by ?? "background" },
        new Date().toISOString(),
      );
      send({ type: "promotions", items: list });
      return {
        content: [
          {
            type: "text",
            text:
              `Filed a promotion request for ${input.kind}/${input.name}. ${summarize(list)} ` +
              "The user approves/rejects it on the board; on approval they run `npm run promote -- --pending`.",
          },
        ],
      };
    },
  );
}
