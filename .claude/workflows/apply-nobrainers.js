// Apply framework-audit NO-BRAINERS — the automated arm of the self-improvement loop.
//
//   /framework-audit  →  fills the LEDGER (findings, bucketed)
//        │
//        ▼
//   apply-nobrainers (THIS)  →  scan bucket-3 open ids  →  for each, one-by-one:
//        │                        cheap Sonnet `framework-nobrainer-fixer` applies + verifies + prunes
//        ▼
//   human reviews the batch diff  →  one commit  →  /framework-audit-fix for the judgment-heavy 4/5
//
// WHY sequential (a plain for-await, not parallel/pipeline): every applier edits the SAME
// LEDGER.md (and each runs `npm run validate`), so concurrent runs would race the file and the
// gate. "One by one" is the correct shape here, and it keeps each validate attributable to one id.
//
// This NEVER commits — it leaves the batch staged so a human eyeballs the diff first. Bucket 4/5/6
// are out of scope by design: the agent's own guardrail refuses them and reports ESCALATE, so even
// if a non-no-brainer slips into the id list it is deferred to the human, not mis-applied.
//
// Run when ready (workflows need explicit opt-in). Optional `args`: an explicit id array to apply
// instead of auto-scanning (e.g. args: ["D8-verify-crossref","D6-symptom-route-triplication"]).

export const meta = {
  name: "apply-nobrainers",
  description:
    "Apply the framework-audit ledger's bucket-3 no-brainers one-by-one via the Sonnet framework-nobrainer-fixer agent; verify + prune each; leave the batch staged for one human commit.",
  whenToUse:
    "After /framework-audit fills the ledger, to auto-clear the mechanical no-brainers before hand-picking the judgment-heavy fixes.",
  phases: [
    { title: "Scan", detail: "read the ledger, list bucket-3 fix-now open ids" },
    { title: "Apply", detail: "one Sonnet applier per id, sequentially: fix → verify → prune" },
  ],
};

const IDS_SCHEMA = {
  type: "object",
  properties: {
    ids: {
      type: "array",
      items: { type: "string" },
      description: "finding ids whose bucket is 3, verdict fix-now, status open — in ledger order",
    },
  },
  required: ["ids"],
  additionalProperties: false,
};

phase("Scan");
// args override: a caller-supplied id list skips the scan (still guardrailed per-agent).
let ids = Array.isArray(args) && args.length ? args : null;
if (!ids) {
  const scan = await agent(
    "Read `.claude/framework-audits/LEDGER.md`. Return ONLY the finding ids whose bucket column is " +
      "`3` AND verdict is `fix-now` AND status is `open`. Do not include bucket 4/5/6, later, skip, " +
      "or already-resolved rows. Preserve ledger order. Use the Grep tool or full-path rg, never bash grep.",
    { schema: IDS_SCHEMA, phase: "Scan", label: "scan:no-brainers" },
  );
  ids = scan?.ids ?? [];
}
log(`${ids.length} no-brainer(s) to apply: ${ids.join(", ") || "(none)"}`);

phase("Apply");
const results = [];
for (const id of ids) {
  // Sequential on purpose — shared LEDGER.md + per-id validate. Each agent self-guards to bucket-3.
  const report = await agent(`Apply the framework-audit no-brainer with id: ${id}`, {
    agentType: "framework-nobrainer-fixer",
    model: "sonnet",
    phase: "Apply",
    label: `fix:${id}`,
  });
  results.push({ id, report });
}

log(`done — review the staged diff, then commit once (git holds the fix record).`);
return results;
