// Keep the README's "Skills" / "Agents" badges AND FEATURES.md's catalog in sync with
// what the framework actually ships — the xenodot plugin (the single source of truth).
// Counts skill folders and agent files in plugin/, rewrites the badges in README.md and
// the "## Agents (N)" / "## Skills (N)" headings in FEATURES.md, cross-checks every
// backticked name in the FEATURES.md Agents section against plugin/agents/ (both
// directions: ghosts and missing), and re-stages what changed. Wired into
// .husky/pre-commit so none of it can drift. Run manually with: npm run badges
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { FRAMEWORK_DIR, FRAMEWORK_PLUGIN_DIR } from "../core/config.js";

/** @param {string} dir @param {(d: import("node:fs").Dirent) => boolean} keep @returns {number | null} */
function count(dir, keep) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(keep).length;
  } catch {
    return null;
  }
}

/** Replace the count in both the alt text and the shields.io URL for one badge.
 * @param {string} text @param {string} label @param {number} n @returns {string} */
function setBadge(text, label, n) {
  const re = new RegExp(
    `(!\\[${label}: )\\d+(\\]\\(https://img\\.shields\\.io/badge/${label}-)\\d+`,
  );
  return text.replace(re, `$1${n}$2${n}`);
}

/** Rewrite the count in a FEATURES.md section heading, e.g. "## Agents (17)" → "## Agents (20)".
 * @param {string} text @param {string} label @param {number} n @returns {string} */
function setHeadingCount(text, label, n) {
  return text.replace(new RegExp(`^## ${label} \\(\\d+\\)$`, "m"), `## ${label} (${n})`);
}

/** Extract the "## Agents …" section body (heading to the next "## "). @param {string} text
 * @returns {string} */
function agentsSection(text) {
  const match = /^## Agents \(\d+\)\n([\s\S]*?)(?=^## )/m.exec(text);
  return match?.[1] ?? "";
}

const skills = count(path.join(FRAMEWORK_PLUGIN_DIR, "skills"), (d) => d.isDirectory());
const agents = count(
  path.join(FRAMEWORK_PLUGIN_DIR, "agents"),
  (d) => d.isFile() && d.name.endsWith(".md"),
);
if (skills === null || agents === null) {
  console.warn("update-badges: plugin/{skills,agents} not found — skipping.");
  process.exit(0);
}

/** @type {string[]} */
const staged = [];

const readmePath = path.join(FRAMEWORK_DIR, "README.md");
const readmeBefore = readFileSync(readmePath, "utf8");
const readmeAfter = setBadge(setBadge(readmeBefore, "Skills", skills), "Agents", agents);
if (readmeAfter !== readmeBefore) {
  writeFileSync(readmePath, readmeAfter);
  staged.push(readmePath);
}

const featuresPath = path.join(FRAMEWORK_DIR, "FEATURES.md");
const featuresBefore = readFileSync(featuresPath, "utf8");
const featuresAfter = setHeadingCount(
  setHeadingCount(featuresBefore, "Skills", skills),
  "Agents",
  agents,
);
if (featuresAfter !== featuresBefore) {
  writeFileSync(featuresPath, featuresAfter);
  staged.push(featuresPath);
}

// Cross-check the FEATURES.md agent catalog against plugin/agents/ — both directions.
// Only names that exist as agent files may be backticked in the section (ghosts), and
// every agent file must appear in the section (missing).
const agentFiles = readdirSync(path.join(FRAMEWORK_PLUGIN_DIR, "agents"), {
  withFileTypes: true,
})
  .filter((d) => d.isFile() && d.name.endsWith(".md"))
  .map((d) => d.name.replace(/\.md$/, ""));
const listed = new Set(
  [...agentsSection(featuresAfter).matchAll(/`([a-z0-9-]+)`/g)].map((m) => String(m[1])),
);
const ghosts = [...listed].filter(
  (name) => !agentFiles.includes(name) && !name.startsWith("xenodot"),
);
const missing = agentFiles.filter((name) => !listed.has(name));
if (ghosts.length > 0 || missing.length > 0) {
  if (ghosts.length > 0)
    console.error(`update-badges: FEATURES.md lists unknown agents: ${ghosts.join(", ")}`);
  if (missing.length > 0)
    console.error(`update-badges: FEATURES.md is missing agents: ${missing.join(", ")}`);
  process.exit(1);
}

if (staged.length === 0) {
  console.log(`update-badges: already current (Skills: ${skills}, Agents: ${agents}).`);
  process.exit(0);
}

execFileSync("git", ["add", ...staged], { stdio: "ignore" });
console.log(
  `update-badges: ${staged.map((p) => path.basename(p)).join(" + ")} updated → Skills: ${skills}, Agents: ${agents} (re-staged).`,
);
