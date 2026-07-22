// ui/server/cli/research-loop.js — human-curated Hermes research → verify-tasks.
//
// A STANDALONE, weekly (via `hermes cron`) loop that researches the REAL, OPEN GitHub issues
// YOU have tagged `research`. The human decides what is worth researching by opening/labeling
// an issue — nothing is auto-scraped from ledgers or backlogs. For each open `research` issue,
// Hermes investigates (advisory: root cause / options + a "better way of working"), the full
// findings go to a PRIVATE local digest, and a SHORT pointer comment + `needs-verify` label go
// on the issue (no AI essay in the public thread). It is deliberately NOT a "Godot news" feed —
// every prompt is anchored to the issue you actually filed.
//
// GUARDRAIL (unchanged from the forge's advisory model): Hermes is invoked ONLY as
// `hermes -z "<prompt>" -t web,search` — no terminal/file/code toolsets — so it returns text
// and never touches the repo. Every `gh` action is done by THIS script (which has the
// credentials), never by Hermes. A human verifies findings and decides what lands.
//
// Usage:
//   node ui/server/cli/research-loop.js               # all repos, dedup-gated
//   node ui/server/cli/research-loop.js --dry-run     # list issues + prompts; no gh/Hermes calls
//   node ui/server/cli/research-loop.js --repo owner/name
//   node ui/server/cli/research-loop.js --once <number|owner/name#number>   # one issue, ignore gate
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { FRAMEWORK_DIR } from "../core/config.js";
import { parseJSON } from "../../lib/json.js";

// --- Tunables (named; no bare literals) -----------------------------------------
/** Don't re-research an unchanged issue until this many days pass — stops weekly spam. */
const RERESEARCH_DAYS = 14;
/** The ONLY toolsets Hermes gets — read-only research surface. Adding terminal/file/code here
 * would break the advisory guardrail, so it is a single constant reviewed in one place. */
const HERMES_TOOLSETS = "web,search";
/** Repos scanned for `research`-labeled open issues (game + framework). */
const GAME_REPO = "arthur0n/pain";
const FORGE_REPO = "arthur0n/xenodot-forge";
const REPOS = [GAME_REPO, FORGE_REPO];
/** Labels: the human-applied trigger + the "a human still has to check this" signal. */
const RESEARCH_LABEL = "research";
const VERIFY_LABEL = "needs-verify";
const VERIFY_LABEL_COLOR = "5319e7"; // gh label color (hex, no leading #)
const VERIFY_LABEL_DESC = "Hermes researched this; awaiting human verification";
/** Time math, decomposed so each factor is self-documenting. */
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;
/** Hermes research runs can be long and verbose. */
const HERMES_TIMEOUT_MINUTES = 15;
const HERMES_TIMEOUT_MS = HERMES_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const HERMES_MAX_OUTPUT_MIB = 16;
const HERMES_MAX_OUTPUT_BYTES = HERMES_MAX_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB;
/** Max issues fetched per repo in one pass. */
const ISSUE_LIST_LIMIT = 50;

// --- Paths ----------------------------------------------------------------------
const STATE_DIR = path.join(FRAMEWORK_DIR, ".claude", "research-loop");
const STATE_FILE = path.join(STATE_DIR, "state.json");

/**
 * @typedef {{
 *   id: string,
 *   repo: string,
 *   issueNum: number,
 *   title: string,
 *   context: string,
 *   hash: string,
 * }} Item
 */

// --- CLI args -------------------------------------------------------------------
const argv = process.argv.slice(2);

/** Read `--name value` or `--name=value`; undefined if absent. @param {string} name */
function flagValue(name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next && !next.startsWith("--") ? next : undefined;
}

const DRY_RUN = argv.includes("--dry-run");
const REPO_FILTER = flagValue("--repo"); // limit to one repo
const ONCE = flagValue("--once"); // an issue number or `owner/name#number`; bypasses the dedup gate

// --- Small process helpers ------------------------------------------------------
/** Run a command, return trimmed stdout. Throws on non-zero. @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: HERMES_MAX_OUTPUT_BYTES,
    timeout: HERMES_TIMEOUT_MS,
  }).trim();
}

/** Run a command, never throw — return {ok, out}. @param {string} cmd @param {string[]} args */
function runSafe(cmd, args) {
  try {
    return { ok: true, out: run(cmd, args) };
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

const sha = (/** @type {string} */ s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const todayISO = () => new Date().toISOString().slice(0, "YYYY-MM-DD".length);

// --- Source: open `research`-labeled GitHub issues ------------------------------
/** Open `research` issues across the given repos. @param {string[]} repos @returns {Item[]} */
function mineResearchIssues(repos) {
  /** @type {Item[]} */
  const items = [];
  for (const repo of repos) {
    const res = runSafe("gh", [
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      RESEARCH_LABEL,
      "--state",
      "open",
      "--json",
      "number,title,body",
      "--limit",
      String(ISSUE_LIST_LIMIT),
    ]);
    if (!res.ok) {
      console.warn(`  ⚠ could not list issues for ${repo}: ${res.out.split("\n")[0]}`);
      continue;
    }
    const rows = /** @type {Array<{ number: number, title: string, body: string }>} */ (
      parseJSON(res.out || "[]")
    );
    for (const r of rows) {
      const body = (r.body ?? "").trim();
      items.push({
        id: `${repo}#${r.number}`,
        repo,
        issueNum: r.number,
        title: r.title,
        context: body,
        hash: sha(`${r.title}\n${body}`),
      });
    }
  }
  return items;
}

// --- Prompt ---------------------------------------------------------------------
/** Project-grounded, advisory research prompt built from the filed issue. @param {Item} item */
function buildPrompt(item) {
  return [
    "You are advising on a Godot-family game-dev project. Below is a REAL issue a human filed on",
    `our project (${item.id}). Anchor everything to THIS issue; do not drift into generic news.`,
    "",
    `Title: ${item.title}`,
    "Body — verbatim; do not assume anything beyond it:",
    '"""',
    item.context || "(no body provided)",
    '"""',
    "",
    "Give findings on two things:",
    "1. Root cause and concrete resolution options, with trade-offs.",
    '2. Is there a BETTER pattern, practice, or tool than our current approach — a "new way of',
    '   working"? Name it, say why it beats what we do now, cite primary sources (URLs / docs /',
    "   versions), and separate what you VERIFIED from what you INFER.",
    "",
    "Rules: advisory only — do NOT propose that you edit our repo, run builds, or write files;",
    "a human decides what lands. Be direct, cite sources, skip filler.",
  ].join("\n");
}

// --- Hermes (advisory; web+search only) -----------------------------------------
/** One-shot Hermes research. Returns the findings text, or null on failure. @param {string} prompt */
function runHermes(prompt) {
  const res = runSafe("hermes", ["-z", prompt, "-t", HERMES_TOOLSETS]);
  if (!res.ok || !res.out) {
    console.warn(`  ⚠ Hermes returned nothing (${res.out.split("\n")[0]})`);
    return null;
  }
  return res.out;
}

// --- GitHub (all repo-touching actions live here, never in Hermes) --------------
/** Ensure the verify label exists in a repo (idempotent). @param {string} repo */
function ensureLabel(repo) {
  runSafe("gh", [
    "label",
    "create",
    VERIFY_LABEL,
    "--repo",
    repo,
    "--color",
    VERIFY_LABEL_COLOR,
    "--description",
    VERIFY_LABEL_DESC,
    "--force",
  ]);
}

/** Post the short pointer comment + verify label (no AI text). @param {Item} item @param {string} digestRel */
function postPointer(item, digestRel) {
  ensureLabel(item.repo);
  const body = `🔬 Hermes advisory research ran ${todayISO()}. Full findings are in the local digest \`${digestRel}\` (kept out of this thread). Awaiting human verify.`;
  run("gh", ["issue", "comment", String(item.issueNum), "--repo", item.repo, "--body", body]);
  runSafe("gh", [
    "issue",
    "edit",
    String(item.issueNum),
    "--repo",
    item.repo,
    "--add-label",
    VERIFY_LABEL,
  ]);
}

// --- State (dedup) --------------------------------------------------------------
/** @typedef {Record<string, { hash: string, researchedAt: string }>} State */

/** @returns {State} */
function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  return /** @type {State} */ (parseJSON(readFileSync(STATE_FILE, "utf8")));
}

/** @param {State} state */
function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** True if the issue is new, edited, or its cooldown elapsed. @param {Item} item @param {State} state */
function shouldResearch(item, state) {
  const prev = state[item.id];
  if (!prev) return true;
  if (prev.hash !== item.hash) return true;
  const ageDays = (Date.now() - Date.parse(prev.researchedAt)) / MS_PER_DAY;
  return ageDays >= RERESEARCH_DAYS;
}

// --- Digest ---------------------------------------------------------------------
const digestPath = () => path.join(STATE_DIR, `digest-${todayISO()}.md`);
const digestRelPath = () => path.relative(FRAMEWORK_DIR, digestPath());

/** Append one issue's full findings to today's digest. @param {Item} item @param {string} findings */
function appendDigest(item, findings) {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = digestPath();
  if (!existsSync(p)) {
    writeFileSync(
      p,
      `# Research digest — ${todayISO()}\n\nAdvisory Hermes findings. Verify before adopting.\n`,
    );
  }
  const section = ["", `## ${item.title}`, `- issue: ${item.id}`, "", findings, "", "---"].join(
    "\n",
  );
  appendFileSync(p, `${section}\n`);
}

/** True if this item matches the --once selector (issue number or full id). @param {Item} item */
function matchesOnce(item) {
  return item.id === ONCE || String(item.issueNum) === ONCE;
}

// --- Main -----------------------------------------------------------------------
async function main() {
  const repos = REPO_FILTER ? [REPO_FILTER] : REPOS;
  let items = mineResearchIssues(repos);
  if (ONCE) items = items.filter(matchesOnce);

  if (items.length === 0) {
    console.log(`No open \`${RESEARCH_LABEL}\` issues to research in: ${repos.join(", ")}.`);
    return;
  }

  const state = loadState();
  let researched = 0;
  let skipped = 0;

  for (const item of items) {
    if (!ONCE && !shouldResearch(item, state)) {
      skipped += 1;
      console.log(`skip  ${item.id} (unchanged, within ${RERESEARCH_DAYS}d)`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`\n--- ${item.id}  ${item.title}`);
      console.log(buildPrompt(item));
      continue;
    }

    console.log(`research  ${item.id} …`);
    const findings = runHermes(buildPrompt(item));
    if (!findings) {
      skipped += 1;
      continue; // leave state untouched so it retries next run
    }
    appendDigest(item, findings);
    postPointer(item, digestRelPath());
    state[item.id] = { hash: item.hash, researchedAt: new Date().toISOString() };
    researched += 1;
    console.log(`  ✓ ${item.id} commented · findings in ${digestRelPath()}`);
  }

  if (DRY_RUN) {
    console.log(`\n(dry-run) ${items.length} issue(s) matched; no gh/Hermes calls made.`);
    return;
  }
  saveState(state);
  console.log(`\nDone: ${researched} researched, ${skipped} skipped. Digest: ${digestRelPath()}`);
}

main().catch((err) => {
  console.error(`research-loop failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
