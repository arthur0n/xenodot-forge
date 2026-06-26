// set_skill tool: assign / unassign a FRAMEWORK skill to an agent's index, when the user asks the
// hive to recalibrate ("give godot-ranged-combat the foliage skill"). It edits the framework registry — the
// skill's `agents:` audience tag (source of truth) + the agent's frontmatter `skills:` — so the change
// is real and version-controlled, and it applies on the NEXT session (the SDK loads agent frontmatter
// at session start). Deliberately NOT in the auto-allow set (unlike promote, which only files a
// request): this writes files, so it goes through the normal permission gate — the approval prompt is
// the user's confirmation of the change. Framework agents only; the hive's own skills are fixed.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { applyAssignment } from "../features/skills/agent-skills.js";

export function makeSetSkillTool() {
  return tool(
    "set_skill",
    "Assign or unassign a FRAMEWORK skill to/from an agent's skill index — use ONLY when the user " +
      "explicitly asks to change which skills an agent has (e.g. 'give godot-ranged-combat the foliage " +
      "skill', 'take screen-effects off godot-visuals'). Edits the framework registry (the skill's " +
      "audience tag + the agent's frontmatter) and applies on the NEXT session — tell the user to " +
      "restart. Do NOT use it to load a skill for yourself (use the Skill tool). Framework agents " +
      "only; the hive's own skills are fixed.",
    {
      agent: z
        .string()
        .describe(
          "The framework agent to recalibrate, e.g. godot-ranged-combat, art-director, asset-advisor.",
        ),
      skill: z.string().describe("The framework skill name, e.g. godot-foliage, godot-enemy-ai."),
      on: z.boolean().describe("true = give the agent this skill; false = take it away."),
      // Internal: the requesting agent, set by the server — do not set it yourself.
      _by: z.string().optional().describe("internal — server-set; ignore"),
    },
    async (input) => {
      const r = applyAssignment(input.agent, input.skill, input.on);
      const text =
        "error" in r
          ? `Could not set the skill: ${r.error}`
          : `${input.on ? "Assigned" : "Unassigned"} \`${input.skill}\` ${input.on ? "to" : "from"} ` +
            `\`${input.agent}\`. Its skill index is now: ${r.skills.join(", ")}. ` +
            "Restart the framework to load the change.";
      return { content: [{ type: "text", text }] };
    },
  );
}
