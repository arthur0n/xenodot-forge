// The in-process "ui" MCP server: the UI-facing SDK tools (forms, tasks, assets, asks,
// promotions, Hermes, autonomous, set-skill) the orchestrator and agents call. Built fresh per
// session because each tool closes over session-scoped senders/queues. Lives here, not inline in
// session.js, so that file stays under its line cap and the tool list has one obvious home.
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { makeFormTool } from "./form-tool.js";
import { makeTaskTool } from "./task-tool.js";
import { makeAssetTool } from "./asset-tool.js";
import { makeAskTool } from "./ask-tool.js";
import { makePromoteTool } from "./promote-tool.js";
import { makeHermesTool, makeHermesFeedbackTool } from "./hermes-tool.js";
import { makeAutonomousTool } from "./autonomous-tool.js";
import { makeCompactTool } from "./compact-tool.js";
import { makeSetSkillTool } from "./set-skill-tool.js";

/**
 * Build the in-process "ui" MCP server for one session. Deps are the session-scoped closures the
 * individual tools need (the message sender, the form waiter/queue, the inbox push, the
 * check-loop disarm) — passed in so this stays free of session lifecycle.
 * @param {{
 *   waitFor: Parameters<typeof makeFormTool>[0],
 *   formAgentQueue: Parameters<typeof makeFormTool>[1],
 *   send: Parameters<typeof makeTaskTool>[0],
 *   hermesPush: Parameters<typeof makeHermesTool>[1],
 *   compactPush: Parameters<typeof makeCompactTool>[1],
 *   disarm: Parameters<typeof makeAutonomousTool>[1],
 * }} deps
 */
export function buildUiServer({ waitFor, formAgentQueue, send, hermesPush, compactPush, disarm }) {
  return createSdkMcpServer({
    name: "ui",
    version: "0.1.0",
    tools: [
      makeFormTool(waitFor, formAgentQueue),
      makeTaskTool(send),
      makeAssetTool(send),
      makeAskTool(send),
      makePromoteTool(send),
      makeHermesTool(send, hermesPush),
      makeHermesFeedbackTool(send),
      makeAutonomousTool(send, disarm),
      makeCompactTool(send, compactPush),
      makeSetSkillTool(),
    ],
  });
}
