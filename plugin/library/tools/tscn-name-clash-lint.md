# tscn sibling name clash lint — tool definition

**Problem** — Recurring editor error "An incoming node's name clashes with [node] already in the
scene" surfaces only when a user opens a level and adds/renames/instances a node. `validate.sh`
steps 3–5 (headless load, `verify_scene.gd`, `smoke_scene_errors.sh`) all pass green. The clash
is never caught before the editor reveals it.

**Transport** — CLI (stateless). Pure text parse of `.tscn` files — no engine binary needed.

**Verdict** — Build thin. No MIT tool exists for this. The parse is ~30 lines of Python:
regex-extract every `[node name="X" ... parent="P"]` header, group by `(file, parent_path)`,
assert all sibling names are unique. No dependency beyond `python3` (already on every dev +
CI machine).

**Root cause** — `packed_scene.cpp:instantiate()` emits "An incoming node's name clashes" only
when `Engine::get_singleton()->is_editor_hint()` is true (source: godotengine/godot
`scene/resources/packed_scene.cpp` ~line 1020). Headless runs (`--headless`, `--script`,
`--quit-after`) never set the editor hint → the warning is suppressed → gate stays green.
`smoke_scene_errors.sh` greps for `"name clashes"` in the engine log, but the engine never
emits that string headless → zero hits → PASS. Static parse of the `.tscn` text catches the
identical structural defect before any engine run.

**What to check (two cases):**

1. **Direct sibling clash** — two `[node name="X" ... parent="P"]` lines share the same
   `(file, parent)` key. This is the most common hand-authoring mistake (copy-paste a block,
   forget to rename).
2. **Instanced sub-scene root name collision** — when `[node name="Y" ... instance=ExtResource(...)]`
   is placed under a parent that already has another child named `"Y"` (whether direct or
   instanced). The lint tool catches this too because all node headers, including instanced
   ones, carry an explicit `name=` field in the `.tscn`.

**Interface**

```
tools/lint_tscn_names [<path-glob>]
```

- Default glob: all `*.tscn` under the project root (excluding `.godot/` and `addons/`).
- Per-violation stdout: `CLASH <file>:<line> parent="<P>" name="<N>" (first seen line <L>)`
- Summary: `lint_tscn_names: FAIL — N clash(es) in M file(s)` / `lint_tscn_names: PASS`
- Exit 0 = clean; exit 1 = clashes found.

**Implementation sketch** (the actual build goes in `tools/lint_tscn_names`):

```python
#!/usr/bin/env python3
import re, sys, pathlib, collections

ROOT = pathlib.Path(__file__).parent.parent
TSCN_RE = re.compile(r'\[node name="([^"]+)"[^\]]*parent="([^"]*)"')

globs = sys.argv[1:] or ["**/*.tscn"]
files = []
for g in globs:
    files.extend(p for p in ROOT.glob(g)
                 if ".godot" not in p.parts and "addons" not in p.parts)

clashes = 0
for f in sorted(files):
    seen = {}  # (parent_path, name) -> line_no
    for i, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
        m = TSCN_RE.search(line)
        if not m:
            continue
        name, parent = m.group(1), m.group(2)
        key = (parent, name)
        if key in seen:
            print(f'CLASH {f.relative_to(ROOT)}:{i} parent="{parent}" '
                  f'name="{name}" (first seen line {seen[key]})')
            clashes += 1
        else:
            seen[key] = i

if clashes:
    print(f"lint_tscn_names: FAIL — {clashes} clash(es)")
    sys.exit(1)
print("lint_tscn_names: PASS")
```

**Discovery** — `tools/CAPABILITIES.md` entry (one line, add during build):

```
| `lint_tscn_names` | Static: detect duplicate sibling node names in .tscn files before the editor reveals them | `tools/lint_tscn_names [glob]` | No engine needed; pure Python 3 |
```

`--help` text: `lint_tscn_names [glob] — fail if any .tscn has two sibling nodes with the same name under the same parent.`

**Home** — `tools/lint_tscn_names` (executable Python 3 script, shebang `#!/usr/bin/env python3`).

**Build** — godot-dev/tooling task: write `tools/lint_tscn_names` per the sketch above (chmod +x),
add the step to `validate.sh` between step 4 (scene property validation) and step 4.5
(smoke_scene_errors.sh): `if ! tools/lint_tscn_names; then fail "tscn-name-clash"; fi`,
register in `tools/CAPABILITIES.md`. godot-verify should observe: `validate.sh` exits 1 and
prints `CLASH ... lint_tscn_names: FAIL` when a `.tscn` is hand-edited to contain two sibling
nodes with the same name.

**Consumers** — godot-dev (runs `validate.sh`), godot-verify (observes the gate), any agent
hand-authoring `.tscn` files. Discovery via `tools/forge-facts capabilities` once registered.

**Sources** — `packed_scene.cpp` editor-hint gate:
https://github.com/godotengine/godot/blob/master/scene/resources/packed_scene.cpp ~L1020;
TSCN format spec: https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html
