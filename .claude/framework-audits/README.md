# Framework audit ledger — how it works

The self-audit ledger is **JSON-sourced**. Edit **`LEDGER.json`**; the readable `LEDGER.md` and the
visual `ledger.html` are **generated** — never hand-edit them.

## Files

- **`LEDGER.json`** — the SOURCE OF TRUTH. The only file you edit. A `findings[]` array + meta.
- **`LEDGER.md`** — generated readable view (committed; good for git diffs). Rebuilt from the JSON.
- **`ledger.html`** — generated visual dashboard (gitignored; open in a browser). Rebuilt from the JSON.
- **`harvested-sessions.txt`** — `/harvest-sessions` coverage sidecar (unchanged).

## Regenerate the views

```bash
npm run ledger        # LEDGER.json → LEDGER.md + ledger.html
```

The pre-commit hook also runs this and stages `LEDGER.md`, so the committed view always tracks the JSON.

## Editing `LEDGER.json`

- **Add a finding** → push an object to `findings[]`:
  ```json
  {
    "id": "D8-slug",
    "dim": "D8",
    "bucket": 4,
    "verdict": "fix-now",
    "status": "open",
    "finding": "one line: the problem + the proposed fix"
  }
  ```
- **Apply / resolve a finding** → **DELETE its object** (git + the commit message are the fix record;
  never stamp `done`). Dedup by `id`. Keep only `open`/`later` rows + `skip` tombstones.

## Schema

| field     | meaning                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| `id`      | stable `<Dn>-<slug>` — the fix commands target findings by this id                                |
| `dim`     | `D1`..`D9` (see `dimensions` in the JSON)                                                         |
| `bucket`  | `3` no-brainer · `4` improvement · `5` later · `6` skip                                           |
| `verdict` | `fix-now` (3/4) · `later` (5) · `skip` (6)                                                        |
| `status`  | `open` · `skip`                                                                                   |
| `finding` | one line — problem + proposed fix (plain text; pipes/newlines are safe now, unlike the old table) |

Meta keys: `lastAudit`, `parking[]`, `dimensions`, `buckets`, `verdicts`.

## Who edits it

`/framework-audit`, `/framework-feedback`, `/harvest-sessions` **append** findings;
`/framework-audit-fix` and the `framework-nobrainer-fixer` agent **remove** them.
All operate on `LEDGER.json`, then regenerate the views.
