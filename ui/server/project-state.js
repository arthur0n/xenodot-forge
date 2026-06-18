// Live project inventory — scanned on every /api/state request so it never
// drifts from what's actually on disk.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  PROJECT_DIR,
  PROJECT_FOUND,
  ENGINE,
  FRAMEWORK_PLUGIN_DIR,
  hermesPublicConfig,
  codexPublicConfig,
} from "./config.js";

/**
 * @param {string} dir
 * @param {string[]} exts
 * @param {string[]} [out]
 * @param {string} [base]
 * @returns {string[]}
 */
function walk(dir, exts, out = [], base = dir) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out, base);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(path.relative(base, full));
  }
  return out;
}

/** @param {string} file @returns {string} */
function firstHeading(file) {
  try {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith("# "));
    return line ? line.slice(2).trim() : path.basename(file);
  } catch {
    return path.basename(file);
  }
}

/** Collect agents (name + model) across dirs; earlier dirs win on name clash (plugin first,
 * then the game's own unpromoted agents). @param {string[]} dirs */
function collectAgents(dirs) {
  /** @type {Map<string, { name: string, model: string | null }>} */
  const seen = new Map();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith(".md")) continue;
      const name = f.replace(/\.md$/, "");
      if (seen.has(name)) continue;
      let model = null;
      try {
        model = readFileSync(path.join(d, f), "utf8").match(/^model:\s*(\S+)/m)?.[1] ?? null;
      } catch {
        /* unreadable — leave model null */
      }
      seen.set(name, { name, model });
    }
  }
  return [...seen.values()];
}

/** Collect skill folder names across dirs (deduped, plugin first). @param {string[]} dirs */
function collectSkills(dirs) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) seen.add(e.name);
  }
  return [...seen];
}

/** @returns {import("../lib/types.js").ProjectState} */
export function projectState() {
  const dir = PROJECT_DIR;
  let name = path.basename(dir);
  try {
    const match = readFileSync(path.join(dir, ENGINE.projectFile), "utf8").match(
      /config\/name="([^"]+)"/,
    );
    if (match?.[1]) name = match[1];
  } catch {}
  return {
    name,
    dir,
    // false → PROJECT_DIR has no project.godot; the UI shows a setup banner
    // instead of empty panels (see loadState in project-tree.js).
    found: PROJECT_FOUND,
    designDocs: walk(path.join(dir, "design"), [".md"], [], dir)
      .filter((f) => !f.endsWith("README.md"))
      .map((f) => ({ path: f, title: firstHeading(path.join(dir, f)) })),
    // Addon research catalog (written by addon-researcher) — the verdict line
    // makes adopt/reject visible from the sidebar without opening docs.
    library: walk(path.join(dir, "library"), [".md"], [], dir)
      .filter((f) => !f.endsWith("README.md"))
      .map((f) => {
        const full = path.join(dir, f);
        let verdict = null;
        try {
          verdict =
            readFileSync(full, "utf8")
              .match(/^\*\*Verdict\*\*\s*[—-]\s*(.+)$/m)?.[1]
              ?.trim() ?? null;
        } catch {}
        return { path: f, title: firstHeading(full), verdict };
      }),
    scenes: walk(dir, [".tscn"], [], dir),
    scripts: walk(dir, [".gd"], [], dir),
    // Capabilities come from the xenodot plugin (the framework source); a game may also
    // carry its own unpromoted agents/skills in .claude/. Show both, plugin first.
    agents: collectAgents([
      path.join(FRAMEWORK_PLUGIN_DIR, "agents"),
      path.join(dir, ".claude", "agents"),
    ]),
    skills: collectSkills([
      path.join(FRAMEWORK_PLUGIN_DIR, "skills"),
      path.join(dir, ".claude", "skills"),
    ]),
    // External Hermes researcher config for the settings panel — key-free (hasKey only).
    hermes: hermesPublicConfig(),
    // Optional Codex reviewer config for the settings panel — secret-free (enabled + vendored).
    codex: codexPublicConfig(),
  };
}
