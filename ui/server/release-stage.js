// Stage a release into the in-progress commit: bump package.json to the next
// sub-version and record the tag for post-commit to create. Called by the
// interactive pre-commit prompt (and `npm run release -- <type>`).
//
// Usage: node ui/server/release-stage.js <feat|fix|chore|refactor>
// Unknown/empty type is a no-op (exit 0) so it never blocks a commit.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseJSON } from "../lib/json.js";
import { RELEASE_TYPES, latestTag, nextTag, tagToPkgVersion } from "./version.js";

const type = (process.argv[2] ?? "").trim().toLowerCase();
if (!RELEASE_TYPES.has(type)) {
  console.warn(`release: unknown type "${type}" (use feat|fix|chore|refactor) — skipping.`);
  process.exit(0);
}

const lastTag = latestTag();
const tag = nextTag(lastTag, type);
const pkgVersion = tagToPkgVersion(tag);

// game-config/ is VENDORED from the game project's own repo — its agents/skills
// are the game's work, not framework features. Flag changes at release time so
// they're attributed to the game repo, not listed as framework changes.
try {
  const changed = execFileSync("git", ["diff", "--name-only", lastTag, "--", "game-config"], {
    encoding: "utf8",
  }).trim();
  if (changed) {
    const n = changed.split("\n").filter(Boolean).length;
    console.log(
      `release: ⚠ ${n} game-config/ file(s) changed since ${lastTag} — vendored from the`,
    );
    console.log("         game repo (github.com/Coghatch-ai/diceofate). Attribute those there;");
    console.log("         do NOT list them as framework changes in the release notes.");
  }
} catch {}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const pkgPath = path.join(repoRoot, "package.json");
const pkg = /** @type {{ version?: string }} */ (parseJSON(readFileSync(pkgPath, "utf8")));
pkg.version = pkgVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
execFileSync("git", ["add", pkgPath], { stdio: "ignore" });

const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim();
writeFileSync(path.join(gitDir, "XENODOT_RELEASE"), tag + "\n");

console.log(
  `release: ${type} → ${tag} (package.json ${pkgVersion}); tag created after this commit.`,
);
