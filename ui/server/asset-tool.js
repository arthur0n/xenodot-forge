// Asset-request tool: the agent's typed contract for the human-in-the-loop art
// loop. Where mcp__ui__tasks is a free-form to-do, this enforces the exact shape
// the Get Assets modal expects — name + kind (texture|model) + a tailored brief —
// so the agent can't malform the request. It files a canonical user-owned task
// (title "Asset: <name>", note "[kind] <brief>") through the same tasks-store the
// board reads, broadcasts the new list, and returns immediately (no pause). The
// modal (client/get-assets.js) renders one card per such task; the user supplies
// the file (picker or local path) and the server copies it into assets/.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { applyOp } from "./tasks-store.js";

/** @param {(obj: import("../lib/types.js").OutMsg) => void} send */
export function makeAssetTool(send) {
  return tool(
    "request_asset",
    "Request ONE art asset the pipeline can't author — a texture (PNG) or a sourced low-poly " +
      "model (.glb). Files a user-owned to-do that surfaces in the 🎨 Get Assets modal, where " +
      "the user picks or names a local file; the server copies it into assets/textures/ (PNG) " +
      "or assets/models/ (GLB) and hands a verify+wire task back to you. One asset per call — " +
      "call again for each additional asset. Does NOT pause the session.",
    {
      name: z
        .string()
        .describe(
          'Asset name, e.g. "grass blade" — slugged into the filename and shown on the card',
        ),
      kind: z
        .enum(["texture", "model"])
        .describe("texture → assets/textures/<name>.png; model → assets/models/<name>.glb"),
      prompt: z
        .string()
        .describe(
          "Sourcing brief tailored to THIS asset (never hardcoded): a generation prompt for a " +
            "texture (size, alpha, tileability, style), or a search + footprint spec for a model.",
        ),
    },
    async (input) => {
      const list = applyOp(
        {
          op: "add",
          title: `Asset: ${input.name}`,
          owner: "user",
          note: `[${input.kind}] ${input.prompt}`,
        },
        new Date().toISOString(),
      );
      send({ type: "tasks", tasks: list });
      const open = list.filter((t) => t.owner === "user" && t.status !== "done").length;
      return {
        content: [
          {
            type: "text",
            text:
              `Filed asset request "${input.name}" (${input.kind}); it's now in the Get Assets ` +
              `modal for the user to supply. Open asset requests: ${open}.`,
          },
        ],
      };
    },
  );
}
