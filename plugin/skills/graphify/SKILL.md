---
name: graphify
agents: [orchestrator, bug-triage]
domain: universal
description: Query the game's knowledge graph for codebase / architecture / file-relationship questions — when graphify-out/graph.json exists, treat the question as a graphify query FIRST. Thin wrapper over the installed graphify CLI (query / path / explain / update); the graph lives in the game's graphify-out/.
---

# graphify — query the game's knowledge graph

Thin wrapper over the **`graphify` CLI** (the engine). The game's graph lives in
`graphify-out/` in the game dir (cwd): `graph.json`, `GRAPH_REPORT.md`.

## When to use

Any codebase / architecture / "how does X work / what connects to Y / where does Z live"
question about THIS game. Prefer the graph over raw grep — it returns a scoped subgraph.

## Fast path (graph exists)

If `graphify-out/graph.json` exists, treat the question as a query FIRST — do NOT rebuild:

```bash
graphify query "<natural-language question>"   # BFS/DFS traversal, scoped answer
graphify path "NODE_A" "NODE_B"                 # how two things relate
graphify explain "NODE"                         # plain-language node summary
```

For broad navigation read `GRAPH_REPORT.md` instead of browsing source.

## Build / refresh

- **No graph yet** → `graphify .` (from the game dir) builds one. Code is AST-extracted
  (free); semantic extraction of docs/non-code costs tokens — say so before a large build.
- **Refresh after changes** → `graphify update .` (AST-only, free). Auto-refresh is **opt-in**:
  the framework's PostToolUse hook can run this for you after every edit, but it's OFF by
  default. Enable it per game with `touch graphify-out/.autoupdate` (graphify-out/ is
  gitignored, so it's a per-developer choice) or globally via `export XENODOT_GRAPHIFY_AUTOUPDATE=1`.
  Until then, refresh by hand after big changes.

## Defer to the CLI

Deep work — exports (`graphify export …`, `--obsidian`), URL ingest (`graphify add <url>`),
re-cluster (`graphify cluster-only`) — use the CLI's own subcommands; don't reimplement here.

## Dependency

Needs the `graphify` CLI (`graphifyy`). If missing → `uv tool install graphifyy`
(or `pipx install graphifyy`). `npm run doctor` flags its presence.

## Honesty

The graph reflects the last build/update — it may be stale or incomplete (e.g. GDScript may
have limited AST coverage). Say when an answer is graph-derived and possibly stale; never
invent nodes or edges that the query didn't return.
