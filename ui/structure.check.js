// Structure guard — the domain-folder convention is ENFORCED here, not just documented in
// .claude/CLAUDE.md. `ui/server/` and `ui/client/` must contain only domain subfolders; a new
// module belongs IN a domain (server: core/ (+core/http/), integrations/<name>/,
// features/<domain>/, mcp-tools/, cli/ — client: core/ or features/<domain>/), never loose at
// the top level. Catches the failure mode the reorg can silently regress: a flat file dropped
// back into ui/server/ or ui/client/. Bare-node, no test runner (same style as
// ui/reducer.check.js); wired into `npm run validate`, the pre-commit hook, and CI.
//   node ui/structure.check.js        # exits 1 (and lists offenders) on any violation
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI = path.dirname(fileURLToPath(import.meta.url)); // ui/
// Trees that must stay free of loose top-level code files.
const GUARDED = ["server", "client"];
// Code files only — a top-level README.md or similar doc is fine; a stray module is not.
const CODE = /\.(js|mjs|cjs|ts)$/;

const violations = [];
for (const tree of GUARDED) {
  for (const e of readdirSync(path.join(UI, tree), { withFileTypes: true })) {
    if (e.isFile() && CODE.test(e.name)) violations.push(`ui/${tree}/${e.name}`);
  }
}

if (violations.length) {
  console.error("✗ structure: loose top-level module(s) break the by-domain layout:");
  for (const v of violations) console.error(`    ${v}`);
  console.error(
    "  Move each into a domain folder — server: core/ (+core/http/), integrations/<name>/,",
  );
  console.error(
    "  features/<domain>/, mcp-tools/, cli/ · client: core/ or features/<domain>/. See .claude/CLAUDE.md → Layout.",
  );
  process.exit(1);
}
console.log("ok  ui/server and ui/client hold only domain folders (no stray top-level modules).");
