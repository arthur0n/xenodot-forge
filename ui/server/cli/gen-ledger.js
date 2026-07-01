// gen-ledger.js — render the framework-audit ledger from its JSON source of truth into two
// GENERATED views: a readable LEDGER.md (git browsing + diffs) and a visual ledger.html (open
// in a browser). LEDGER.json is the ONLY hand/agent-edited file — the audit commands and the
// framework-nobrainer-fixer append/remove finding objects there; these two views regenerate.
// Bare-node (no deps), wired into `npm run ledger` + the pre-commit hook. Mirrors gen-skill-scope.js.
//
//   node ui/server/cli/gen-ledger.js     # rewrites LEDGER.md + ledger.html from LEDGER.json

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJSON } from "../../lib/json.js";

const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.claude/framework-audits",
);

/** @param {unknown} s */
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

const BUCKETS = [
  { n: 3, title: "no-brainers", sub: "fix-now · mechanical (framework-nobrainer-fixer)" },
  { n: 4, title: "improvements", sub: "fix-now · needs judgment (/framework-audit-fix)" },
  { n: 5, title: "later", sub: "system / parked" },
  { n: 6, title: "skip", sub: "tombstones — recorded so they are not re-filed" },
];
// Per-dimension hue for the color chips (D1..D9 around the wheel).
/** @type {Record<string, number>} */
const DIM_HUE = { D1: 0, D2: 28, D3: 50, D4: 120, D5: 160, D6: 190, D7: 220, D8: 265, D9: 312 };

/** @typedef {{ id: string, dim: string, bucket: number, verdict: string, status: string, finding: string }} Finding */
/** @typedef {{ lastAudit?: string, parking?: string[], dimensions?: Record<string, string>, buckets?: Record<string, string>, findings?: Finding[] }} Ledger */

const data = /** @type {Ledger} */ (parseJSON(readFileSync(path.join(DIR, "LEDGER.json"), "utf8")));
const findings = data.findings ?? [];
const inBucket = (/** @type {number} */ n) => findings.filter((f) => f.bucket === n);
const count = (/** @type {(f: Finding) => boolean} */ pred) => findings.filter(pred).length;
const openFix = count((f) => f.status === "open" && f.verdict === "fix-now");
const later = count((f) => f.verdict === "later");
const skip = count((f) => f.verdict === "skip");

// ---- LEDGER.md (readable, NON-padded — no wide pipe tables) --------------------------------
const md = [];
md.push("<!-- GENERATED from LEDGER.json by `npm run ledger` — DO NOT EDIT; edit LEDGER.json. -->");
md.push("");
md.push("# Framework audit ledger");
md.push("");
md.push(`**open (fix-now): ${openFix} · later: ${later} · skip: ${skip}**`);
md.push("");
md.push(`_Last audit:_ ${data.lastAudit ?? "—"}`);
md.push("");
md.push(
  "> Source of truth is **`LEDGER.json`** — edit that, then `npm run ledger` (pre-commit also regenerates). " +
    "This file + `ledger.html` are generated views. Applied findings are DELETED (git is the fix record), never stamped.",
);
for (const b of BUCKETS) {
  const rows = inBucket(b.n);
  md.push("");
  md.push(`## Bucket ${b.n} — ${b.title} (${rows.length}) · ${b.sub}`);
  if (!rows.length) {
    md.push("");
    md.push("_none_");
    continue;
  }
  md.push("");
  for (const f of rows) md.push(`- **${f.id}** · \`${f.dim}\` · _${f.status}_ — ${f.finding}`);
}
if (Array.isArray(data.parking) && data.parking.length) {
  md.push("");
  md.push("## Parking — dimension ideas (unactioned)");
  md.push("");
  for (const p of data.parking) md.push(`- ${p}`);
}
writeFileSync(path.join(DIR, "LEDGER.md"), md.join("\n") + "\n");

// ---- ledger.html (self-contained visual dashboard) ----------------------------------------
const dimChip = (/** @type {string} */ dim) => {
  const h = DIM_HUE[dim] ?? 0;
  return `<span class="dim" style="--h:${h}" title="${esc(data.dimensions?.[dim] ?? "")}">${esc(dim)}</span>`;
};
const card = (/** @type {Finding} */ f) =>
  `<article class="f v-${esc(f.verdict)}">
     <header>${dimChip(f.dim)}<code>${esc(f.id)}</code><span class="st">${esc(f.status)}</span></header>
     <p>${esc(f.finding)}</p>
   </article>`;

const section = (/** @type {{ n: number, title: string, sub: string }} */ b) => {
  const rows = inBucket(b.n);
  return `<section class="bucket b${b.n}">
    <h2><span class="bnum">B${b.n}</span> ${esc(b.title)} <span class="bsub">${esc(b.sub)}</span> <span class="cnt">${rows.length}</span></h2>
    <div class="grid">${rows.length ? rows.map(card).join("") : '<p class="empty">— none —</p>'}</div>
  </section>`;
};

const legend = Object.entries(data.dimensions ?? {})
  .map(([d, desc]) => `${dimChip(d)}<span class="ld">${esc(desc)}</span>`)
  .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Framework audit ledger</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:#0e1116; color:#d7dde5; }
  .wrap { max-width:1100px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:19px; margin:0 0 4px; color:#fff; }
  .meta { color:#8b96a5; font-size:12.5px; margin:0 0 2px; }
  .counts { margin:10px 0 20px; display:flex; gap:8px; flex-wrap:wrap; }
  .counts b { background:#1b2230; border:1px solid #2a3446; border-radius:6px; padding:5px 10px; font-weight:600; }
  .counts .open { color:#ffd479; } .counts .later { color:#7fd4ff; } .counts .skip { color:#8b96a5; }
  .legend { display:flex; flex-wrap:wrap; gap:10px 16px; padding:12px 14px; background:#141922; border:1px solid #232c3b; border-radius:8px; margin-bottom:22px; font-size:12px; align-items:center; }
  .legend .ld { color:#93a0b1; margin-left:-4px; }
  .dim { display:inline-block; min-width:26px; text-align:center; font-weight:700; font-size:11px; padding:2px 6px; border-radius:5px; color:hsl(var(--h) 70% 82%); background:hsl(var(--h) 55% 22%); border:1px solid hsl(var(--h) 45% 34%); }
  .bucket { margin-bottom:26px; }
  h2 { font-size:14px; display:flex; align-items:center; gap:10px; border-bottom:1px solid #232c3b; padding-bottom:7px; margin:0 0 12px; color:#eaf0f6; }
  .bnum { font-weight:800; background:#222b3a; border-radius:5px; padding:2px 7px; color:#cdd7e3; }
  .bsub { font-weight:400; color:#7c8798; font-size:11.5px; }
  .cnt { margin-left:auto; background:#1b2230; border:1px solid #2a3446; border-radius:20px; padding:1px 11px; font-size:12px; color:#aeb9c8; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:10px; }
  .f { background:#141922; border:1px solid #232c3b; border-left:3px solid #3a4658; border-radius:8px; padding:11px 13px; }
  .f.v-fix-now { border-left-color:#ffb454; } .f.v-later { border-left-color:#4aa8e0; } .f.v-skip { border-left-color:#4b5666; opacity:.72; }
  .f header { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .f code { font-weight:700; color:#fff; font-size:12.5px; }
  .f .st { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:#8b96a5; }
  .f p { margin:0; color:#c2cbd6; font-size:12.5px; }
  .empty { color:#6b7686; }
  .parking { margin-top:8px; background:#141922; border:1px solid #232c3b; border-radius:8px; padding:12px 16px; }
  .parking h2 { border:0; margin-bottom:8px; }
  .parking li { color:#aeb9c8; margin:3px 0; }
  footer { margin-top:34px; color:#5f6a7a; font-size:11.5px; }
</style></head>
<body><div class="wrap">
  <h1>Framework audit ledger</h1>
  <p class="meta">Source of truth: <code>LEDGER.json</code> · generated by <code>npm run ledger</code> · applied findings are removed (git is the fix record)</p>
  <p class="meta">Last audit: ${esc(data.lastAudit ?? "—")}</p>
  <div class="counts"><b class="open">${openFix} open · fix-now</b><b class="later">${later} later</b><b class="skip">${skip} skip</b></div>
  <div class="legend">${legend}</div>
  ${BUCKETS.map(section).join("\n")}
  ${
    Array.isArray(data.parking) && data.parking.length
      ? `<section class="parking"><h2>Parking — dimension ideas</h2><ul>${data.parking.map((/** @type {string} */ p) => `<li>${esc(p)}</li>`).join("")}</ul></section>`
      : ""
  }
  <footer>${findings.length} findings · regenerate with <code>npm run ledger</code></footer>
</div></body></html>`;
writeFileSync(path.join(DIR, "ledger.html"), html);

console.log(
  `ok  ledger: ${findings.length} findings → LEDGER.md + ledger.html (${openFix} open, ${later} later, ${skip} skip)`,
);
