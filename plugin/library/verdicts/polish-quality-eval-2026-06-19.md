# Verdict — Hermes "polish & quality layer" findings (2026-06-19)

Scope: Hermes recommendations to stand up a quality + polish layer (quality-gate layering, review
layer, four new skills, Godot 4.6 perf follow-ups) for DiceOfFate (Godot 4.6.3 stable, Forward+,
composition-dominant FPS POC). Researcher = skill-researcher. NOT a GodotPrompter library adoption
— these are framework/skill/agent recommendations. Verdict is per-recommendation. Decision gated on
user (board question filed). Companion deliverable: `design/polish_quality_plan.md`.

## Facts verified against Godot 4.6.3 stable (this machine: /Applications/Godot.app)

- **No `ubershader` ProjectSetting in 4.6.** Probed `ProjectSettings.get_property_list()` headless →
  zero `ubershader` keys. Ubershader in Forward+ is engine-internal (specialization constants), not a
  user toggle. Hermes "enable ubershader in project.godot" = FALSE for 4.6.
  Real settings that exist: `rendering/shader_compiler/shader_cache/{enabled,compress,
use_zstd_compression,strip_debug}` + `rendering/rendering_device/pipeline_cache/enable`.
- **`--headless` → no RenderingDevice.** Probed: `RenderingServer.get_rendering_device() == null`,
  `pipeline_compilations == 0` after 5 frames. Headless = dummy renderer. ⇒ L2 smoke asserting
  GAMEPLAY LOGIC works headless; L2 asserting RENDER/DRAW/PIPELINE does NOT — needs a real window.
  (Hermes flagged this risk; CONFIRMED — split L2 accordingly.)
- **GdUnit4 not installed** (only `addons/JehenoSimpleFPSWeaponSystem`). Adoption = new addon dep.
- **VFX warm-up already implements the Hidden-Node prewarm trick.** `entities/vfx/vfx_router.gd`
  `_warmup_vfx()` spawns every effect once at `Vector3(0,-9999,0)` on ready. ⇒ a
  `godot-shader-precompile` skill would FORMALIZE shipped code, not add capability.
- Existing repo infra proving the L2 pattern works headless on 4.6: `tools/verify_enemy_ai.gd`,
  `tools/test_combat_integration.gd` (SceneTree scripts driving seams + asserting), and
  `tools/verify_render_action.gd` (opens a REAL window for render capture). `validate.sh` already
  runs a headless `verify_scene.gd` + a `--quit-after` smoke run.

## Per-recommendation verdict

### 1. Quality-gate layering (L0→L1→L2→L3)

**ADOPT the layering; ADOPT L2-via-own-scripts; REJECT GdUnit4 as the L2 path.**

- L0 (validate.sh) + L3 (F5 gates) already exist.
- L2 missing — fill it with our OWN SceneTree smoke scripts (pattern already proven by
  verify_enemy_ai.gd / test_combat_integration.gd), NOT GdUnit4. Same logic-assert capability, zero
  new dependency, matches "formalize on demand". GdUnit4's render-dependent SceneRunner asserts are
  exactly what headless can't do here (fact 2).
- Split L2: logic smoke = headless/CI (validate.sh step); render/perf = windowed (verify_render_action).
- New game-local skill `godot-runtime-smoke` (= initiative 1, HIGHEST ROI).
- Park GdUnit4: revisit if smoke-script count > ~6-8 and fixtures/reporting hurt.

### 2. Review layer — reconcile Hermes vs user steer

**ADOPT BOTH: baseline checklist (always) + per-task deep reviewer (Codex when available, else
Claude-isolated). New game-local `code-reviewer` AGENT + a checklist convention doc.**

- Hermes: "Codex as standing gate, no third model." User: Codex NOT always available, wants BOTH a
  lightweight gate AND a dedicated reviewer chosen per-task. ⇒ keep both.
- Baseline = orchestration convention (a rubric doc: convention conflicts, duck-type seam intact,
  typed, validate.sh green, no autoload, no Transform3D-ban break). NOT an agent.
- Deep = a real agent: fresh isolated session, diff-only input, structured rubric, routes to Codex
  when present else runs as a Claude pass. Needs its own session+prompt ⇒ warrants an AGENT, not a
  one-liner. Cost: baseline ~free; deep = per-invocation latency/tokens, gated to when asked.

### 3. Four proposed new skills

| Skill                                                   | Verdict                                                    | Reason                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `godot-runtime-smoke`                                   | **ADOPT NOW**                                              | Highest-ROI. GdUnit4-free SceneTree smoke templates + seam checklist. Game-local first.                                                                                        |
| `godot-shader-precompile`                               | **DEFER / fold as reference**                              | Only formalizes shipped warm-up (fact 4) + shader_cache config (rec 4). No new capability. Capture as a section later, not a standalone framework skill now.                   |
| `godot-weapon-game-feel` + `godot-fps-polish-checklist` | **MERGE → ONE merged game-feel/polish skill, ADOPT LATER** | 4 skills too many (Hermes agreed). Feel categories + re-runnable checklist = one artifact. Lower correctness-leverage (L3/human) than L1/L2 — sequence after them. Game-local. |

Highest-ROI of the four: **godot-runtime-smoke**. Merge the two game-feel ones. Reject standalone
shader-precompile.

### 4. Godot 4.6 perf follow-ups (godot-dev code/config, NOT skills)

| Item                                                    | Verdict                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `rendering/shader_compiler/shader_cache/enabled` on     | **adopt now** — real lever (NOT ubershader; fact 1). Verify current, enable if off.                          |
| `rendering/rendering_device/pipeline_cache/enable` on   | **adopt now** — persists pipelines across runs.                                                              |
| Share `ParticleProcessMaterial` across same-look VFX    | **adopt now** — fewer permutations → fewer first-spawn hitches. Audit the 5 VFX scenes.                      |
| Draw pipeline-compilations monitor == 0 at steady state | **adopt now BUT windowed** — impossible headless (fact 2); fold into verify_render_action's real-window run. |
| #116228 re-spirv regression workaround                  | **defer/verify** — confirm it affects 4.6.3 before patching a maybe-fixed bug.                               |

These are godot-dev tasks, distinct from skills.

## Net

- Author after approval: skill `godot-runtime-smoke` (game-local), agent `code-reviewer`
  (game-local), convention `design/review_checklist.md`. All adopt-now.
- Adopt LATER: a merged game-feel/polish skill (game-local, not yet built), after L2+review land.
- Reject/park: GdUnit4 (revisit on scale), standalone `godot-shader-precompile` (fold as reference).
- Reject outright: "enable ubershader" (no such setting in 4.6) — replaced by shader_cache +
  pipeline_cache config + the shipped warm-up.
- godot-dev config tasks: shader_cache + pipeline_cache on, share ParticleProcessMaterials, windowed
  pipeline-monitor check. Defer #116228 until confirmed.

## First slice (highest ROI) after approval

`godot-runtime-smoke` skill + `tools/smoke_combat.gd` + validate.sh wiring: boot firing_yard.tscn,
`weapon.try_fire()`, assert fire-signal arity + enemy `died` payload + recoil state changed. Reuses
the proven `test_combat_integration.gd` pattern; converts the most regression-prone seam (combat
contract — touched by 6 recent commits) from F5-only to every-commit. No new dependency.
