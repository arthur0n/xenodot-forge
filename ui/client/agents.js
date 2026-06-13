// Per-agent color. A curated, well-separated palette assigned on first
// appearance (stable per page load), so several agents running at once stay
// visually distinct — the old hue-hash often put different agents on
// near-identical hues. `main` keeps the ember accent.

/** Distinct on-theme hues, spread ~45° apart. @type {string[]} */
const PALETTE = [
  "oklch(0.78 0.13 85)", // amber
  "oklch(0.76 0.13 150)", // green
  "oklch(0.78 0.1 210)", // cyan
  "oklch(0.74 0.12 255)", // blue
  "oklch(0.74 0.13 300)", // violet
  "oklch(0.74 0.15 345)", // magenta
  "oklch(0.71 0.16 25)", // red
  "oklch(0.8 0.15 125)", // lime
];

/** name -> assigned color, in first-seen order. @type {Map<string, string>} */
const assigned = new Map();
let nextIdx = 0;

// Display-name (brand) map: identifier -> what the user sees. Brand first
// ("Xenodot <role>"), so every agent reads as one of our Xenodots. Pure UI
// flavor — the SDK identifiers (subagent_type) and agent filenames stay literal
// so routing keeps working. Only the rendered text changes.
//   main -> Xenodot Hive, addon-researcher -> Xenodot Researcher, etc.
/** @type {Record<string, string>} */
const DISPLAY = {
  main: "Xenodot Hive",
  "game-designer": "Xenodot Designer",
  "level-designer": "Xenodot Level Designer",
  "godot-dev": "Xenodot Developer",
  "godot-refactor": "Xenodot Refactor",
  "addon-researcher": "Xenodot Researcher",
  "transcript-researcher": "Xenodot Transcript",
};

/** @param {string} name @returns {string} */
export function agentLabel(name) {
  if (!name) return name;
  if (DISPLAY[name]) return DISPLAY[name];
  // Fallback for any agent not in the map: brand first, domain prefix dropped.
  const role = name.replace(/^(godot|game|addon|level|transcript)-/, "").replace(/-/g, " ");
  const titled = role.replace(/\b\w/g, (c) => c.toUpperCase());
  return `Xenodot ${titled}`;
}

/** The avatar/initial for an agent: the first word of its display name that
 * isn't "Xenodot" — so "Xenodot Hive" reads "H" and "Xenodot Designer" reads "D".
 * @param {string} name @returns {string} */
export function agentInitial(name) {
  const word = agentLabel(name)
    .split(" ")
    .find((w) => w && w !== "Xenodot");
  return (word ?? agentLabel(name)).charAt(0).toUpperCase();
}

/** @param {string} name @returns {string} */
export function agentColor(name) {
  if (name === "main") return "var(--accent-text)";
  let color = assigned.get(name);
  if (!color) {
    color = PALETTE[nextIdx % PALETTE.length] ?? "var(--accent-text)";
    nextIdx++;
    assigned.set(name, color);
  }
  return color;
}

/** @param {HTMLElement} node @param {string} agent @returns {HTMLElement} */
export function paint(node, agent) {
  node.dataset.agent = agent;
  node.style.setProperty("--agent-color", agentColor(agent));
  return node;
}
