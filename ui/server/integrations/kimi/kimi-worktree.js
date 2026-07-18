// Kimi worktree helper — the isolation layer for the external Kimi coder. Every Kimi task
// gets a FRESH `git worktree` of the game repo under the framework's gitignored
// `.xenodot-run/kimi/<taskId>/`, so Kimi never touches the tree the Hive and the Xenodots
// share (their concurrent-edit races are a managed trade-off; an autonomous third-party
// coder in the same tree would not be). The deliverable is the worktree's diff — merging
// it into the real tree is ALWAYS a separate human/Hive-gated step.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { FRAMEWORK_DIR, PROJECT_DIR } from "../../core/config.js";

/** Where Kimi worktrees live (gitignored, machine-local). */
export const KIMI_RUN_DIR = path.join(FRAMEWORK_DIR, ".xenodot-run", "kimi");

/** Generous cap for local git plumbing (worktree add on a large repo). */
const GIT_TIMEOUT_MS = 60_000;
/** Cap the diff we deliver into the session (a huge diff means "open the worktree"). */
const DIFF_MAX_CHARS = 30_000;

/** Run git against the game repo. @param {string[]} argv @param {string} [cwd]
 * @returns {{ ok: boolean, out: string }} */
function git(argv, cwd = PROJECT_DIR) {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  const out = (r.status === 0 ? r.stdout : r.stderr || r.stdout || "").trim();
  return { ok: r.status === 0, out };
}

/** Create a fresh worktree (+ branch `kimi/<taskId>`) of the game repo for one Kimi task.
 * @param {string} taskId @returns {{ dir: string, branch: string } | { error: string }} */
export function createKimiWorktree(taskId) {
  if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
    return {
      error: `the game project is not a git repo (${PROJECT_DIR}) — Kimi needs one to work in an isolated worktree`,
    };
  }
  mkdirSync(KIMI_RUN_DIR, { recursive: true });
  const dir = path.join(KIMI_RUN_DIR, taskId);
  const branch = `kimi/${taskId}`;
  const add = git(["worktree", "add", "-b", branch, dir]);
  if (!add.ok) return { error: `git worktree add failed: ${add.out.slice(0, 300)}` };
  return { dir, branch };
}

/** The worktree's full diff vs its base (staged-or-not, incl. untracked files via -N),
 * capped for in-session delivery. @param {string} dir @returns {string} */
export function worktreeDiff(dir) {
  // Intent-to-add makes brand-new files visible to `git diff` without committing.
  git(["add", "-N", "."], dir);
  const diff = git(["diff"], dir);
  if (!diff.ok) return "";
  return diff.out.length > DIFF_MAX_CHARS
    ? diff.out.slice(0, DIFF_MAX_CHARS) + `\n… (diff truncated — open the worktree for the rest)`
    : diff.out;
}

/** Remove one task's worktree + its branch. Safe on a half-created state; keeps the
 * worktree when `keep` (the default) so the human can open/merge it — pass keep:false
 * only for aborted runs with nothing of value. @param {string} taskId
 * @param {{ keep?: boolean }} [opts] */
export function reapKimiWorktree(taskId, { keep = true } = {}) {
  const dir = path.join(KIMI_RUN_DIR, taskId);
  if (keep || !existsSync(dir)) return;
  git(["worktree", "remove", "--force", dir]);
  git(["branch", "-D", `kimi/${taskId}`]);
}

/** Startup sweep: prune git's records of worktrees whose directories are gone (crash
 * leftovers). Deliberately does NOT delete surviving worktree dirs — they may hold an
 * unreviewed diff; humans clean those via `git worktree remove`. */
export function sweepKimiWorktrees() {
  if (!existsSync(KIMI_RUN_DIR)) return 0;
  git(["worktree", "prune"]);
  return readdirSync(KIMI_RUN_DIR).length;
}
