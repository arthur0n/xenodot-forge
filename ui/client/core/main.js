// Client entry point. Loaded by index.html as <script type="module">; pulls in
// every feature module and performs the cross-cutting top-level wiring. The
// websocket module opens the session as a side effect of being imported.
import { setupResizer, restorePanelWidths, initPanelToggles } from "./resize.js";
import { initStatusbar } from "../features/activity/statusbar.js";
import { initChat } from "../features/chat/chat.js";
import { initRunning } from "../features/activity/running.js";
import { initTasks } from "../features/tasks/tasks.js";
import { initPromotions } from "../features/promotions/promotions.js";
import { initTodos } from "../features/tasks/todos.js";
import { initActivityLog } from "../features/activity/activity-log.js";
import { initApprovalsPill } from "../features/approvals/approvals.js";
import { loadState, initProjectTabs } from "../features/project/project-tree.js";
import { loadSessions } from "../features/sessions/sessions.js";
import { initComposer } from "../features/chat/composer.js";
import { initTranscript } from "../features/sessions/transcript.js";
import { initGetAssets } from "../features/assets/get-assets.js";
import { initDrawLevel } from "../features/level-editor/draw-level.js";
import { initSettings, maybeAutoOpenSkillSetup } from "../features/settings/settings.js";
import { initPaidAgents } from "../features/agents-portal/paid-agents.js";
import { initAutonomous } from "../features/autonomous/autonomous.js";
import { send } from "./websocket.js";
import { $, $input } from "./dom.js";

restorePanelWidths();
initPanelToggles();
setupResizer("resize-sidebar", "--sidebar-w", "left", 180, 420);
setupResizer("resize-activity", "--activity-w", "right", 260, 560);
initStatusbar();
initChat();
initRunning();
initTasks();
initPromotions();
initTodos();
initActivityLog();
initApprovalsPill();
initComposer();
initProjectTabs();
initGetAssets();
initDrawLevel();
initTranscript();
initPaidAgents();
initSettings();
initAutonomous();
void maybeAutoOpenSkillSetup();

$input("mode-select").onchange = () => {
  send({ type: "policy", value: $input("mode-select").value });
};
$("refresh").onclick = () => {
  void loadState();
};
$("new-session").onclick = () => {
  location.href = location.pathname;
};
$("compact-session").onclick = () => {
  send({ type: "compact" });
};

void loadState();
void loadSessions();
