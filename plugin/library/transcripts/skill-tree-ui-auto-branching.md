# Skill Tree UI with Auto-Branching Lines — transcript digest

**Source** — `godot-passive-skill-three-visual-scene.md` (raw now in
`transcripts/archive/godot-passive-skill-three-visual-scene.md`). Godot skill-tree UI tutorial
(2D Control + TextureButton + Line2D).
**Why harvested** — about to build a PASSIVE skill ("passive skill three") with a VISUAL/scene
component, alongside the active modifier-stack/upgrade system mid-build
(`design/modifier_stack_system.md`).

**What the video actually teaches** — a purely COSMETIC 2D skill-tree *UI*: a `Control` + ColorRect
background, `TextureButton`-based "skill node" buttons (with a `class_name SkillNode`), a per-node
`Line2D` ("skill branch") that auto-draws to its PARENT node's centre in `_ready`, level tracking via
a `set`/`get` setter on an `int level`, `min(level+1, max_level)` clamp on press, `self_modulate` to
light up an unlocked node, and an unlock GATE (children stay `disabled` until parent reaches
`max_level`). Briefly hand-waves "skill points" and "if dash unlocked then dash" as *project-dependent,
do it yourself*. It teaches NO gameplay effect, NO data model, NO save — it is a menu skin.

**Points**

| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Skill node = `TextureButton` + `Label` counter + child `Line2D`, in a `Control` scene | holds with caveat | gap | We have CanvasLayer UI (`ui/tuning_panel.tscn`, `scripts/objective_hud.tscn`) but no skill-tree scene. Caveat: our game is 3D (GL Compat, iso cam); this UI is screen-space 2D under a CanvasLayer/Control like our existing HUDs — fine, but our 3D look/art-style does not constrain it | useful, but UI-skin only |
| 2 | `Line2D` auto-draws branch to parent node centre in `_ready` (`get_parent() is SkillNode` → add_point self+parent global centre) | holds | gap | Neat layout trick; no equivalent in repo. Pure presentation | nice-to-have for the visual |
| 3 | `level` as `int` with a `set` setter that updates the label + clamps via `min(level+1, max_level)` | holds with caveat | partial → **conflicts in spirit** | Our upgrade levels live on `ActiveModifier.level` clamped to `StatModifier.max_level` in `ModifierStack.add` (Slice 1 built, Slice 2 pending). Putting the canonical level/cap on a UI button DUPLICATES state and violates **data-driven** (CLAUDE.md: tuning lives in `.tres`, code only READS) + **composition-over-autoloads**. Button must DISPLAY stack level, not OWN it | adopt the widget, reject it owning level/cap |
| 4 | Unlock gate: children `disabled` until parent hits `max_level`; root starts enabled | holds | gap | Prereq/gating is a real DESIGN question for passives (none decided). Video's "max out parent" rule is one policy among many | design decision, not a copy-paste |
| 5 | "Skill points": `static var`, decrement on press, refuse at 0 (video calls it project-dependent) | holds with caveat | gap | A currency/economy decision. `static var` shared counter = a global singleton → **conflicts** with CLAUDE.md composition-over-autoloads. If we want points, they belong on a component/resource, not a `static` | design decision; reject the `static` impl |
| 6 | Activating a skill = "if dash unlocked, dash else return" check on the player (hand-waved) | out of scope / partial | partial | This is the ONLY gameplay-wiring sentence, and it is exactly what our modifier-stack already does properly: an unlocked passive = `ModifierStack.add(strategy, source)`; a resolved stat already gates behaviour. Video offers nothing past a bool flag | we already have the real version |
| 7 | `self_modulate` (not `modulate`) to tint only the button texture, not its label children | holds | gap | Correct Godot detail for the widget if we build it | minor correctness note |

**How "passive skill three" maps to the active modifier-stack system**

- A passive skill = a permanent **`StatModifier` `.tres`** (`duration_sec = 0`) added to the player's
  `ModifierStack` via `add(strategy, source)`. The data model, leveling (`ActiveModifier.level`),
  cap (`max_level`), and resolve seam ALREADY EXIST for this (Slice 1 built; Slice 2 wiring pending).
  A passive is a NEW `.tres`, not new code — same as abilities/enemies. **It reuses
  StatModifier/ModifierStack; it does not need a parallel system.**
- The video's "level/cap/unlock on the button" is the SAME state our stack owns. Do NOT duplicate it
  onto the UI. The button reads `level`/`max_level` from the stack and calls `add()` on press.
- The VISUAL/scene part (the tree layout, branch lines, lit/dim states) is a thin presentation layer
  over that data — a `godot-visuals`/UI concern, NOT a VFX/particle concern. It is screen-space 2D
  under a CanvasLayer like our existing HUDs; the 3D iso renderer/art-style does not bound it.

**Recommended next** (gaps to act on now)

- **game-designer** — passive-skill DESIGN decisions the video raises but does not answer: (a) does
  "passive three" grant a flat `StatModifier`, and which `stat`? (b) is there a prerequisite/unlock
  gate (the video's "max the parent" is one option), and (c) is there a skill-point economy at all —
  and if so it must NOT be a `static var` global (composition rule). One brief; these are choices,
  not code.
- **skill-researcher** — a reusable **skill-tree / upgrade-menu UI** technique: a data-driven
  `SkillNode` widget (TextureButton + Line2D auto-branch + lit/dim) that DISPLAYS `ModifierStack`
  level/cap and calls `add()` on click, owning ZERO gameplay state. No `godot-*` skill covers a
  passive-skill/upgrade-tree UI today (we have HUD scenes, not a tree). Worth a search for a prompter
  skill; if none, the technique is small enough to author from this digest. The video's value is the
  Line2D auto-branch + self_modulate widget pattern — strip its state-ownership.

**Later** (valid but not needed for the current build)

- `Line2D` auto-branch-to-parent layout trick — adopt only if/when a multi-node tree UI is scoped;
  a single passive needs no tree.
- Skill-point economy — only if the game wants a points currency; defer to a real economy slice and
  do it via a component/resource, never a `static var`.
