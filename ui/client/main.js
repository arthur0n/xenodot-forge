// Client entry point. Loaded by index.html as <script type="module">; pulls in
// every feature module and performs the cross-cutting top-level wiring. The
// websocket module opens the session as a side effect of being imported.
import { setupResizer, restorePanelWidths, initPanelToggles } from "./resize.js";
import { initStatusbar } from "./statusbar.js";
import { initChat } from "./chat.js";
import { initRunning } from "./running.js";
import { initTasks } from "./tasks.js";
import { initPromotions } from "./promotions.js";
import { initTodos } from "./todos.js";
import { initActivityLog } from "./activity-log.js";
import { initApprovalsPill } from "./approvals.js";
import { loadState, initProjectTabs } from "./project-tree.js";
import { loadSessions } from "./sessions.js";
import { initComposer } from "./composer.js";
import { initTranscript } from "./transcript.js";
import { initGetAssets } from "./get-assets.js";
import { initDrawLevel } from "./draw-level.js";
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
