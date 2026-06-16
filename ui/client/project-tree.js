// Left workbench panes, scanned live from /api/state. The primary surfaces
// (Tasks, Promote) own their own modules and render reactively into always-present
// containers; this module owns the tab controller plus the project panes: Design
// (design docs only), and the lower-priority Agents / Skills / Tokens.
import { $, $$, el, fillComposer, appendToComposer } from "./dom.js";
import { fetchJSON } from "../lib/json.js";
import { view } from "./state.js";
import { paint, agentLabel, agentInitial } from "./agents.js";

const TAB_KEY = "xenodot-side-tab";

/** Every selectable tab. Anything stale (e.g. a removed "sources" tab) coerces
 * back to the default working surface. */
const TABS = new Set(["tasks", "promote", "assets", "agents", "skills", "tokens"]);
/** Tabs that render into the project pane (vs. their own reactive pane). */
const PROJECT_TABS = new Set(["assets", "agents", "skills", "tokens"]);

/** @type {import("../lib/types.js").ProjectState | null} */
let state = null;

let activeTab = (() => {
  try {
    const saved = localStorage.getItem(TAB_KEY) ?? "tasks";
    return TABS.has(saved) ? saved : "tasks";
  } catch {
    return "tasks";
  }
})();

/** Starter prompts for the "+ new …" buttons — scope-first, per the
 * framework's interview-before-build loop. */
const NEW_PROMPTS = {
  agents:
    "create a new agent for this project: interview me about its purpose, " +
    "when it should run, and which tools it needs — then write .claude/agents/<name>.md",
  skills:
    "create a new skill for this project: interview me about the procedure " +
    "it encodes and its verification gate — then write .claude/skills/<name>/SKILL.md",
};

/** The Design pane: just the project's design docs, flat — the one project-file
 * group that's actually worked from here. Each row adds itself to the composer.
 * @param {HTMLElement} tree @param {import("../lib/types.js").ProjectState} s */
function renderDesign(tree, s) {
  if (!s.designDocs.length) {
    tree.append(el("div", "tree-empty", "no design docs yet"));
    return;
  }
  s.designDocs.forEach((d) => {
    const item = el("div", "tree-item");
    item.append(el("span", "tree-item-path", d.path), el("span", "desc", `— ${d.title}`));
    const btn = el("button", "tree-add-btn", "+");
    btn.title = "Add to chat";
    btn.onclick = (e) => {
      e.stopPropagation();
      appendToComposer(`@${d.path}`);
    };
    item.append(btn);
    tree.append(item);
  });
}

/** @param {string} tab @param {string} label @returns {HTMLElement} */
function newItemBtn(tab, label) {
  const btn = el("button", "new-item-btn", `+ ${label}`);
  btn.onclick = () => {
    fillComposer(tab === "agents" ? NEW_PROMPTS.agents : NEW_PROMPTS.skills);
  };
  return btn;
}

/** The Agents pane: the project's cast, each Xenodot shown by its identity sigil
 * and branded name (so the roster reads like the running strip and activity log
 * — one agent, one color, everywhere). The literal id the SDK routes on (and the
 * model) trail as the dim caption. @param {HTMLElement} tree @param {import("../lib/types.js").ProjectState} s */
function renderAgents(tree, s) {
  if (!s.agents.length) tree.append(el("div", "tree-empty", "none yet"));
  s.agents.forEach((a) => {
    const item = paint(el("div", "tree-item agent-item"), a.name);
    item.append(
      el("span", "agent-avatar", agentInitial(a.name)),
      el("span", "agent-item-name", agentLabel(a.name)),
      el("span", "desc", a.model ? `${a.name} · ${a.model}` : a.name),
    );
    tree.append(item);
  });
  tree.append(newItemBtn("agents", "new agent"));
}

/** @param {HTMLElement} tree @param {import("../lib/types.js").ProjectState} s */
function renderSkills(tree, s) {
  if (!s.skills.length) tree.append(el("div", "tree-empty", "none yet"));
  s.skills.forEach((f) => {
    tree.append(el("div", "tree-item", f));
  });
  tree.append(newItemBtn("skills", "new skill"));
}

/** Format a token count as a compact string (e.g. 65.5M, 594K).
 * @param {number} n @returns {string} */
function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** A key→value row for the tokens tab.
 * @param {string} key @param {string} val @param {string} [extraCls] @returns {HTMLElement} */
function tokensKv(key, val, extraCls) {
  const row = el("div", "tokens-kv" + (extraCls ? " " + extraCls : ""));
  row.append(el("span", "tokens-kv-key", key), el("span", "tokens-kv-val", val));
  return row;
}

/** Fetch and render token usage stats into the tokens tab.
 * @param {HTMLElement} tree */
async function renderTokens(tree) {
  tree.append(el("div", "tree-empty", "loading…"));
  /** @type {{ sessionCount: number, totalCount: number, totals: { input: number, output: number, cacheCreate: number, cacheRead: number }, hitRate: number, topSessions: { name: string, input: number, output: number, cacheCreate: number, cacheRead: number, total: number }[] }} */
  let data;
  try {
    data = /** @type {any} */ (await fetchJSON("/api/usage"));
  } catch {
    tree.replaceChildren(el("div", "tree-empty", "failed to load"));
    return;
  }
  tree.replaceChildren();

  const wrap = el("div", "tokens-tab");

  // Refresh button
  const refresh = el("button", "tokens-refresh", "↺ refresh");
  refresh.onclick = () => {
    tree.replaceChildren();
    void renderTokens(tree);
  };
  wrap.append(refresh);

  // Cache hit rate — prominent
  wrap.append(tokensKv("cache hit rate", `${data.hitRate}%`, "tokens-hit"));
  wrap.append(el("hr", "tokens-divider"));

  // Token breakdown
  wrap.append(tokensKv("input", fmtTokens(data.totals.input)));
  wrap.append(tokensKv("output", fmtTokens(data.totals.output)));
  wrap.append(tokensKv("cache write", fmtTokens(data.totals.cacheCreate)));
  wrap.append(tokensKv("cache read", fmtTokens(data.totals.cacheRead)));
  wrap.append(el("hr", "tokens-divider"));
  wrap.append(tokensKv("sessions", `${data.sessionCount} / ${data.totalCount}`));

  // Top sessions
  if (data.topSessions.length) {
    wrap.append(el("hr", "tokens-divider"));
    wrap.append(el("div", "tokens-section-head", "top sessions"));
    data.topSessions.forEach((s) => {
      const item = el("div", "tokens-session");
      const parts = s.name.match(/(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
      const label = parts ? `${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}` : s.name.slice(0, 16);
      item.append(el("span", "tokens-session-name", label));
      item.append(
        el(
          "span",
          "tokens-session-meta",
          `out ${fmtTokens(s.output)} · cR ${fmtTokens(s.cacheRead)}`,
        ),
      );
      wrap.append(item);
    });
  }

  tree.append(wrap);
}

/** Show exactly one workbench pane; the other two are dropped from layout.
 * @param {string} id */
function showPane(id) {
  for (const p of ["tasks-pane", "promotions-pane", "project-pane"]) {
    const node = $(p);
    if (node) node.hidden = p !== id;
  }
}

/** Set a secondary-tab count caption (Agents / Skills).
 * @param {string} tab @param {number} n */
function setSubCount(tab, n) {
  const c = document.querySelector(`.wb-subtab[data-tab="${tab}"] .count`);
  if (c) c.textContent = n ? String(n) : "";
}

/** Reflect the active tab + project counts, swap the visible pane, and (for the
 * project pane) render the chosen project view. Tasks/Promote panes render
 * themselves reactively, so here we only reveal them. */
function renderTab() {
  $$(".wb-tabs [data-tab]").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === activeTab);
  });

  if (state) {
    const design = $("design-tabcount");
    if (design) design.textContent = state.designDocs.length ? String(state.designDocs.length) : "";
    setSubCount("agents", state.agents.length);
    setSubCount("skills", state.skills.length);
  }

  if (!PROJECT_TABS.has(activeTab)) {
    showPane(activeTab === "promote" ? "promotions-pane" : "tasks-pane");
    return;
  }

  showPane("project-pane");
  const tree = $("project-tree");
  tree.replaceChildren();
  if (activeTab === "tokens") {
    void renderTokens(tree);
    return;
  }
  if (!state) return;
  if (activeTab === "agents") renderAgents(tree, state);
  else if (activeTab === "skills") renderSkills(tree, state);
  else renderDesign(tree, state);
}

/** Wire the workbench tab buttons (once, from main.js). */
export function initProjectTabs() {
  $$(".wb-tabs [data-tab]").forEach((t) => {
    t.addEventListener("click", () => {
      activeTab = t.dataset.tab ?? "tasks";
      try {
        localStorage.setItem(TAB_KEY, activeTab);
      } catch {}
      renderTab();
    });
  });
  renderTab();
}

export async function loadState() {
  const s = /** @type {import("../lib/types.js").ProjectState} */ (await fetchJSON("/api/state"));
  state = s;
  view.projectDir = s.dir;
  $("proj-name").textContent = s.found ? s.name : "no project";
  $("proj-path").textContent = s.dir.replace(/^\/Users\/[^/]+/, "~");
  renderBanner(s);
  renderTab();
}

/** When the target folder has no Godot project, explain how to point the
 * framework at one instead of showing silently-empty panels. The framework
 * only reads the project — it stays in your own repo, wherever it lives.
 * @param {import("../lib/types.js").ProjectState} s */
function renderBanner(s) {
  const banner = $("project-banner");
  if (s.found) {
    banner.style.display = "none";
    return;
  }
  banner.replaceChildren();
  banner.append(el("strong", undefined, "No Godot project here yet."));
  banner.append(el("div", "banner-path", `Looking in: ${s.dir.replace(/^\/Users\/[^/]+/, "~")}`));
  banner.append(
    el(
      "div",
      undefined,
      "Point the framework at your game (it only reads it — your project stays in its own repo):",
    ),
  );
  const code = el("div", "banner-code");
  code.append(el("div", undefined, "npm run setup -- /path/to/your/game"));
  code.append(el("div", undefined, "# then restart, or one-off: npm start /path/to/your/game"));
  banner.append(code);
  banner.style.display = "";
}
