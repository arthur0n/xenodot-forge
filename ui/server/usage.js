// Aggregate token usage from session NDJSON logs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseJSON } from "../lib/json.js";
import { LOG_DIR } from "./config.js";

/** @typedef {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} TokenUsage */
/** @typedef {{ message?: { usage?: TokenUsage } }} LogLine */

/**
 * @param {string} file
 * @returns {{ input: number, output: number, cacheCreate: number, cacheRead: number }}
 */
function parseSession(file) {
  let input = 0,
    output = 0,
    cacheCreate = 0,
    cacheRead = 0;
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const obj = /** @type {LogLine} */ (parseJSON(line));
        const u = obj.message?.usage;
        if (!u) continue;
        input += u.input_tokens ?? 0;
        output += u.output_tokens ?? 0;
        cacheCreate += u.cache_creation_input_tokens ?? 0;
        cacheRead += u.cache_read_input_tokens ?? 0;
      } catch {}
    }
  } catch {}
  return { input, output, cacheCreate, cacheRead };
}

/**
 * @returns {{
 *   sessionCount: number,
 *   totalCount: number,
 *   totals: { input: number, output: number, cacheCreate: number, cacheRead: number },
 *   hitRate: number,
 *   topSessions: { name: string, input: number, output: number, cacheCreate: number, cacheRead: number, total: number }[]
 * }}
 */
export function computeUsage() {
  /** @type {string[]} */
  let files;
  try {
    files = readdirSync(LOG_DIR).filter((f) => f.endsWith(".ndjson"));
  } catch {
    return {
      sessionCount: 0,
      totalCount: 0,
      totals: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      hitRate: 0,
      topSessions: [],
    };
  }

  /** @type {{ name: string, input: number, output: number, cacheCreate: number, cacheRead: number, total: number }[]} */
  const sessions = [];
  for (const f of files) {
    const s = parseSession(path.join(LOG_DIR, f));
    const total = s.input + s.output + s.cacheCreate + s.cacheRead;
    if (total > 0) {
      sessions.push({ name: f.replace(/^session-/, "").replace(/\.ndjson$/, ""), ...s, total });
    }
  }

  const totals = sessions.reduce(
    (acc, s) => ({
      input: acc.input + s.input,
      output: acc.output + s.output,
      cacheCreate: acc.cacheCreate + s.cacheCreate,
      cacheRead: acc.cacheRead + s.cacheRead,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  );

  const hitRate =
    totals.cacheCreate + totals.cacheRead > 0
      ? Math.round((100 * totals.cacheRead) / (totals.cacheRead + totals.cacheCreate))
      : 0;

  sessions.sort((a, b) => b.total - a.total);

  return {
    sessionCount: sessions.length,
    totalCount: files.length,
    totals,
    hitRate,
    topSessions: sessions.slice(0, 10),
  };
}
