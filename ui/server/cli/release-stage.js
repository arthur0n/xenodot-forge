// Stage a release into the in-progress commit: bump package.json to the next
// sub-version and record the tag for post-commit to create. Called by the
// interactive pre-commit prompt (and `npm run release -- <type>`).
//
// Usage: node ui/server/cli/release-stage.js <feat|fix|chore|refactor>
// Unknown/empty type is a no-op (exit 0) so it never blocks a commit.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseJSON } from "../../lib/json.js";
import { RELEASE_TYPES, latestTag, nextTag, tagToPkgVersion } from "../core/version.js";

const type = (process.argv[2] ?? "").trim().toLowerCase();
if (!RELEASE_TYPES.has(type)) {
  console.warn(`release: unknown type "${type}" (use feat|fix|chore|refactor) — skipping.`);
  process.exit(0);
}

const lastTag = latestTag();
const tag = nextTag(lastTag, type);
const pkgVersion = tagToPkgVersion(tag);

// The plugin (xenodot-forge/plugin/) is the framework's OWN source of truth now — its
// agents/skills/tools are framework features and changes to them ARE framework changes
// (no longer vendored from a game repo), so they need no special release-note handling.

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const pkgPath = path.join(repoRoot, "package.json");
const pkg = /** @type {{ version?: string }} */ (parseJSON(readFileSync(pkgPath, "utf8")));
pkg.version = pkgVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
execFileSync("git", ["add", pkgPath], { stdio: "ignore" });

// The plugin manifest and marketplace carry the same version — one release train.
for (const rel of ["plugin/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  const manifestPath = path.join(repoRoot, rel);
  const manifest = /** @type {{ version?: string, plugins?: { version?: string }[] }} */ (
    parseJSON(readFileSync(manifestPath, "utf8"))
  );
  if (typeof manifest.version === "string") manifest.version = pkgVersion;
  for (const p of manifest.plugins ?? []) p.version = pkgVersion;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  execFileSync("git", ["add", manifestPath], { stdio: "ignore" });
}

const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim();
writeFileSync(path.join(gitDir, "XENODOT_RELEASE"), tag + "\n");

console.log(
  `release: ${type} → ${tag} (package.json ${pkgVersion}); tag created after this commit.`,
);
