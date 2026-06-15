// Project sidebar — tabbed: Assets | Agents | Skills, scanned live from
// /api/state. Assets is the file tree rooted at the project folder; Agents
// and Skills list what exists and offer a "+ new …" starter that pre-fills
// the composer (the designer interview takes it from there).
import { $, $$, el, fillComposer, appendToComposer } from "./dom.js";
import { fetchJSON, parseJSON } from "../lib/json.js";
import { view } from "./state.js";
import { paint, agentLabel, agentInitial } from "./agents.js";

const COLLAPSE_KEY = "xenodot-collapsed";
const TAB_KEY = "xenodot-side-tab";

/** @type {Record<string, boolean>} */
const collapsed = (() => {
  try {
    return /** @type {Record<string, boolean>} */ (
      parseJSON(localStorage.getItem(COLLAPSE_KEY) ?? "{}")
    );
  } catch {
    return {};
  }
})();

const persistCollapsed = () => {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
  } catch {}
};

/** @type {import("../lib/types.js").ProjectState | null} */
let state = null;

let activeTab = (() => {
  try {
    return localStorage.getItem(TAB_KEY) ?? "assets";
  } catch {
    return "assets";
  }
})();

/** Free, no-signup-friendly asset generators shown in the "Get Assets" tab.
 * Edit freely — `note` is the at-a-glance caption, surfaced on hover too.
 * @type {{ name: string, url: string, note: string }[]} */
const GENERATORS = [
  { name: "Pixler", url: "https://pixler.dev/", note: "free · ~15 gen/day · PNG" },
  { name: "Seele AI", url: "https://www.seeles.ai/", note: "free tier · pixel art" },
];

/** Asset specs to hand off to a generator — the shape the asset-advisor agent
 * produces. One labelled space per thing: prompt, size, alpha, tileable, where.
 * @type {{ name: string, prompt: string, size: string, alpha: string,
 *   tileable: string, generators: string[] }[]} */
const ASSET_SPECS = [
  {
    name: "Bedsheet fabric texture",
    prompt:
      "pixel-art bedsheet fabric texture, top-down flat view, warm cream/off-white " +
      "linen weave with subtle wrinkle lines, 32×32 px, no transparent background " +
      "(solid), no outline glow, SNES 16-bit style, muted warm palette",
    size: "32×32 px",
    alpha: "No — solid background",
    tileable: "No — single surface",
    generators: ["Pixler", "Seele AI"],
  },
];

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

/**
 * A collapsible group of items, persisted by label.
 * @template T
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {T[]} items
 * @param {(it: T) => HTMLElement} render
 */
function group(parent, label, items, render) {
  const g = el("div", "tree-group");
  if (collapsed[label] ?? true) g.classList.add("collapsed"); // collapsed by default
  const head = el("div", "tree-group-head");
  head.append(el("span", "chev", "▾"), ` ${label} `, el("span", "count", String(items.length)));
  head.onclick = () => {
    g.classList.toggle("collapsed");
    collapsed[label] = g.classList.contains("collapsed");
    persistCollapsed();
  };
  g.append(head);
  if (!items.length) g.append(el("div", "tree-empty", "none yet"));
  else
    items.forEach((it) => {
      g.append(render(it));
    });
  parent.append(g);
}

/** @param {import("../lib/types.js").LibraryEntry} d @returns {HTMLElement} */
function libraryItem(d) {
  const item = el("div", "tree-item");
  if (d.verdict) {
    const v = d.verdict.toLowerCase();
    const dot = el("span", "verdict-dot", "●");
    dot.style.color = v.startsWith("adopted")
      ? "var(--green)"
      : v.startsWith("rejected")
        ? "var(--red)"
        : "var(--amber)";
    dot.title = d.verdict;
    item.append(dot, " ");
  }
  item.append(d.title + " ", el("span", "desc", `— ${d.verdict ?? "researching…"}`));
  return item;
}

/** The Assets tab: project root first, groups nested inside it.
 * @param {HTMLElement} tree @param {import("../lib/types.js").ProjectState} s */
function renderAssets(tree, s) {
  const ROOT = "__root";
  const root = el("div", "tree-root");
  if (collapsed[ROOT] === true) root.classList.add("collapsed"); // expanded by default
  const head = el("div", "tree-root-head");
  head.append(el("span", "chev", "▾"), el("span", "tree-root-name", s.name + "/"));
  head.onclick = () => {
    root.classList.toggle("collapsed");
    collapsed[ROOT] = root.classList.contains("collapsed");
    persistCollapsed();
  };
  const nest = el("div", "tree-nest");
  group(nest, "Design docs", s.designDocs, (d) => {
    const item = el("div", "tree-item");
    item.append(el("span", "tree-item-path", d.path), el("span", "desc", `— ${d.title}`));
    const btn = el("button", "tree-add-btn", "+");
    btn.title = "Add to chat";
    btn.onclick = (e) => {
      e.stopPropagation();
      appendToComposer(`@${d.path}`);
    };
    item.append(btn);
    return item;
  });
  group(nest, "Addon library", s.library ?? [], libraryItem);
  group(nest, "Scenes", s.scenes, (f) => el("div", "tree-item", f));
  group(nest, "Scripts", s.scripts, (f) => el("div", "tree-item", f));
  root.append(head, nest);
  tree.append(root);
}

/** @param {string} tab @param {string} label @returns {HTMLElement} */
function newItemBtn(tab, label) {
  const btn = el("button", "new-item-btn", `+ ${label}`);
  btn.onclick = () => {
    fillComposer(tab === "agents" ? NEW_PROMPTS.agents : NEW_PROMPTS.skills);
  };
  return btn;
}

/** The Agents tab: the project's cast, each Xenodot shown by its identity sigil
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

/** One labelled "key — value" line inside an asset card.
 * @param {string} k @param {string} v @returns {HTMLElement} */
function specRow(k, v) {
  const row = el("div", "asset-spec");
  row.append(el("span", "asset-spec-k", k), el("span", "asset-spec-v", v));
  return row;
}

/** A link chip pointing at a generator, by name.
 * @param {string} name @returns {HTMLElement | null} */
function genLink(name) {
  const g = GENERATORS.find((x) => x.name === name);
  if (!g) return null;
  const a = el("a", "asset-gen", g.name);
  a.setAttribute("href", g.url);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
  a.title = g.note;
  return a;
}

/** A single asset spec card — a space for each thing.
 * @param {(typeof ASSET_SPECS)[number]} a @returns {HTMLElement} */
function assetCard(a) {
  const card = el("div", "asset-card");
  card.append(el("div", "asset-card-head", a.name));

  card.append(el("div", "asset-field-label", "Prompt"));
  const prompt = el("div", "asset-prompt");
  prompt.append(el("div", "asset-prompt-text", a.prompt));
  const copy = el("button", "asset-copy", "copy");
  copy.onclick = () => {
    void navigator.clipboard?.writeText(a.prompt);
    copy.textContent = "copied";
    setTimeout(() => {
      copy.textContent = "copy";
    }, 1200);
  };
  prompt.append(copy);
  card.append(prompt);

  const specs = el("div", "asset-specs");
  specs.append(specRow("Size", a.size), specRow("Alpha", a.alpha), specRow("Tileable", a.tileable));
  card.append(specs);

  card.append(el("div", "asset-field-label", "Generator"));
  const gens = el("div", "asset-gens");
  a.generators.forEach((name) => {
    const link = genLink(name);
    if (link) gens.append(link);
  });
  card.append(gens);
  return card;
}

/** The "Get Assets" tab: a generators directory, then one spec card per asset
 * to hand off — each with a copy-able prompt and labelled size/alpha/tileable.
 * @param {HTMLElement} tree */
function renderSources(tree) {
  tree.append(
    el(
      "div",
      "sources-intro",
      "Generate each in a free tool, then drop the file into the project.",
    ),
  );

  tree.append(el("div", "asset-field-label", "Generators · no signup"));
  const dir = el("div", "gen-list");
  GENERATORS.forEach((g) => {
    const a = el("a", "gen-link", g.name);
    a.setAttribute("href", g.url);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.append(el("span", "gen-note", g.note));
    dir.append(a);
  });
  tree.append(dir);

  if (!ASSET_SPECS.length) {
    tree.append(el("div", "tree-empty", "no asset specs yet"));
    return;
  }
  ASSET_SPECS.forEach((a) => {
    tree.append(assetCard(a));
  });
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

/** Re-render the active tab panel from the cached state. */
function renderTab() {
  const counts = state
    ? {
        assets: state.designDocs.length + state.scenes.length + state.scripts.length,
        agents: state.agents.length,
        skills: state.skills.length,
        sources: ASSET_SPECS.length,
      }
    : null;
  $$(".side-tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === activeTab);
    const count = t.querySelector(".count");
    if (count && counts)
      count.textContent = String(counts[/** @type {keyof typeof counts} */ (t.dataset.tab)] ?? "");
  });
  const tree = $("project-tree");
  tree.replaceChildren();
  if (activeTab === "tokens") {
    void renderTokens(tree);
    return;
  }
  if (!state) return;
  if (activeTab === "agents") renderAgents(tree, state);
  else if (activeTab === "skills") renderSkills(tree, state);
  else if (activeTab === "sources") renderSources(tree);
  else renderAssets(tree, state);
}

/** Wire the Assets | Agents | Skills tab buttons (once, from main.js). */
export function initProjectTabs() {
  $$(".side-tab").forEach((t) => {
    t.addEventListener("click", () => {
      activeTab = t.dataset.tab ?? "assets";
      try {
        localStorage.setItem(TAB_KEY, activeTab);
      } catch {}
      renderTab();
    });
  });
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
