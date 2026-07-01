# Stealth Enemy AI — Vision, Hearing, FSM, Architecture

**Request** — Before building stealth enemy AI (vision cone, hearing, patrol, aggro/de-aggro), evaluate buy-vs-build for each component and settle the architecture approach (node-FSM vs utility vs GOAP vs neural/ML).

**Verdict** — ADOPT VisionCone3D for vision; BUILD hearing + FSM ourselves; use node-FSM architecture.

---

## Part 1 — Buy-vs-Build

### Candidates

| Component          | Addon                                   | Source                                                     | License        | Godot                             | Language      | Last activity     | Notes                                                                                                                     |
| ------------------ | --------------------------------------- | ---------------------------------------------------------- | -------------- | --------------------------------- | ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Vision / FOV       | VisionCone3D                            | https://github.com/Tattomoosa/VisionCone3D                 | MIT            | 4.3+ (dedicated branch), 4.4 main | GDScript 100% | Apr 2025 (v0.3.0) | 3D only; exports `range`, `angle`, `collision_mask`, `collision_environment_mask`; signals `body_sighted` / `body_hidden` |
| Vision / FOV       | godot-vision-cone (d-bucur)             | https://github.com/d-bucur/godot-vision-cone               | MIT/Apache-2.0 | 4.x all                           | GDScript 100% | 2025              | **2D only** — disqualified                                                                                                |
| Hearing / Stimulus | godot-perception (kylecorry31)          | https://github.com/kylecorry31/godot-perception            | MIT            | Unknown                           | GDScript      | Archived Mar 2026 | WIP, 1 star, 0 docs, archived — disqualified                                                                              |
| Hearing / Stimulus | (none found)                            | —                                                          | —              | —                                 | —             | —                 | No viable GDScript Godot-4 hearing/stimulus addon exists                                                                  |
| FSM                | HexagonNico/FiniteStateMachine          | https://codeberg.org/HexagonNico/FiniteStateMachine        | MIT            | 4.5 (Sep 2025)                    | GDScript 100% | Sep 2025          | Thin: `StateMachine` node + abstract `StateMachineState`; uses `process_mode` toggle for state activation                 |
| FSM                | godot-addons/godot-finite-state-machine | https://github.com/godot-addons/godot-finite-state-machine | MIT            | 4.x                               | GDScript      | 2023              | Less maintained; similar thin approach                                                                                    |

---

### VisionCone3D — ADOPT

Extends `Area3D`. The `VisionCone3D` node exposes `@export var range`, `@export_range(0,150) var angle`, `collision_mask`, `collision_environment_mask`, and `vision_test_mode` — all tunable from the Inspector, matching data-driven convention. Internal raycasts handle LOS; signals `body_sighted(body)` and `body_hidden(body)` are the integration seam. No autoload, no C++, no prebuilt binary needed. MIT. Active (v0.3.0 April 2025, Godot 4.3 branch explicit). Fits composition-over-autoloads: drop a `VisionCone3D` child onto the enemy node, set collision layers, wire signals up.

**Caveat:** cone points along -Z of the node; enemy must rotate the child node to face forward (or parent the cone to a head bone). Range, angle, hearing radius, and all tuning must still live in the `EnemyArchetype` resource — the VisionCone3D node reads `@export` set by the enemy's `_ready` from its archetype, not hardcoded.

**Install:** tag `v0.3.0` (commit TBD by godot-dev), target `addons/tattomoosa.vision_cone_3d/`, enable plugin in Project Settings. godot-dev task: install from tag, wire `body_sighted`/`body_hidden` signals to FSM.

---

### Hearing — BUILD

No qualifying addon. Hearing is a trivial `Area3D` radius check + a noise-event bus: game code emits `noise_event(origin: Vector3, radius: float)` (signal on a lightweight singleton or via groups), enemy's `HearingArea3D` catches it if `origin.distance_to(global_position) <= hearing_radius`. ~30 lines of GDScript. Hearing radius lives in `EnemyArchetype.hearing_radius: float`. Build it.

---

### FSM — BUILD (use HexagonNico as reference only)

HexagonNico's FSM is clean (3 files, 74 + 124 lines, no autoloads, pure GDScript) but too thin to adopt without modification: it uses `CanvasItem` for debug-draw (won't work in 3D), the `@abstract` keyword requires Godot 4.4+, and state transitions are entirely manual (caller sets `state_machine.current_state = $NewState`). The pattern it implements — `StateMachine` node + child `StateMachineState` nodes + `process_mode` toggle — IS the native Godot node-FSM pattern the framework already mandates. Build the same pattern from scratch in ~60 lines; it costs nothing and avoids the 4.4 abstract-keyword floor.

States needed: `PatrolState`, `AlertState`, `AggroState`, `SearchState`. Each is a child node of `EnemyFSM`; transition logic lives in each state's `_process` reading from the shared `EnemyArchetype` resource.

---

## Part 2 — Architecture Verdict

### Comparison

| Approach                      | Solo-dev cost                 | Determinism     | Stealth tuning                  | Godot 4 fit                                             | Verdict     |
| ----------------------------- | ----------------------------- | --------------- | ------------------------------- | ------------------------------------------------------- | ----------- |
| **Node-FSM**                  | Low (1–2 days)                | Full            | Explicit, step-debuggable       | Native pattern, framework mandate                       | RECOMMENDED |
| Utility AI                    | Medium (3–5 days)             | Full            | Good; scores tunable in .tres   | No maintained GDScript-only addon                       | Park        |
| GOAP                          | High (1–2 weeks)              | Full            | Hard to trace why action chosen | No Godot-4 GDScript addon; build from scratch           | Skip        |
| Neural / ML (godot_rl_agents) | Very high (weeks of training) | None by default | Opaque; can't step bug          | Requires Python at train time; ONNX export experimental | Skip        |

### Neural option honest assessment

`godot_rl_agents` (v0.8.2, Feb 2025, MIT, Godot 4 .NET) is real and maintained. A trained ONNX policy can run in-engine without Python at runtime (experimental export). BUT:

- **Training cost for one dev:** define observation space (cone angle, distances, patrol waypoints, noise events), reward function, run hundreds of thousands of steps per enemy type. Expect days of iteration per archetype. Reward shaping for stealth (punish detection, reward patrol completion, handle de-aggro) is non-trivial.
- **Determinism:** learned policies are stochastic by default. Reproducible bugs require fixing the random seed AND saving/restoring exact network state — not the same as setting a breakpoint in `AggroState._process`. Stealth games live or die on determinism: the player must be able to learn the guard's pattern.
- **Debuggability:** when the enemy does something wrong, "the network thought so" is not an answer. Re-training to fix behavior is slow; the FSM equivalent is editing one number in a .tres file.
- **When neural IS worth it:** enemies with emergent squad coordination, adaptive counter-play (enemy "learns" the player's habits across a session), or very large state spaces where an FSM would have 20+ states. None of those apply here.
- **Verdict on neural:** skip for this project. The problem is 4 states, 3 sensors, 2 timers. A neural network is a sledgehammer for a nail.

### Recommended approach: Node-FSM + VisionCone3D + built-in hearing Area3D

```
enemy.gd (CharacterBody3D)
  EnemyArchetype.tres          ← all tuning: fov_angle, fov_range, hearing_radius,
                                  patrol_speed, aggro_speed, alert_timer, deaggro_timer
  VisionCone3D                 ← adopt; exports read/set from archetype in _ready
  HearingArea3D (Area3D)       ← built; radius from archetype.hearing_radius
  NavigationAgent3D            ← native; no addon
  EnemyFSM (StateMachine)      ← build ~60 lines
    PatrolState
    AlertState
    AggroState
    SearchState
```

States transition via `enemy_fsm.current_state = $AggroState`. All timers and thresholds are `archetype.*` reads. New enemy type = new `.tres` file, zero new code.

**Switch to utility AI** if: >3 enemy archetypes need to share the same state code but weight decisions differently (e.g., a "coward" guard vs an "aggressive" guard with the same states but different action scoring). One `EnemyArchetype` weight array replaces per-state branching.

**Switch to GOAP** only if: mission objectives dynamically constrain enemy plan space (e.g., enemy must call backup AND block exit AND maintain patrol). Not anticipated here.

---

## Install (VisionCone3D only)

- Source: https://github.com/Tattomoosa/VisionCone3D/tree/4.3 (or tag v0.3.0 on main if 4.3 branch is merged)
- Target: `addons/tattomoosa.vision_cone_3d/`
- Enable: Project Settings > Plugins > tattomoosa.vision_cone_3d
- godot-dev task: install VisionCone3D from tag v0.3.0, add `VisionCone3D` child to enemy scene, set `vision_test_ignore_bodies = [enemy_body]`, wire `body_sighted` -> FSM aggro trigger, wire `body_hidden` -> FSM lost-sight logic
- Verify: VisionCone3D gizmo visible in 3D editor; `body_sighted` fires when player enters cone + has line of sight

## Later

- **Utility AI (Pennycook/godot-utility-ai):** https://github.com/Pennycook/godot-utility-ai — GDScript, Godot 4, MIT; revisit if >3 enemy archetypes need score-weighted decisions within the same state set.
- **LimboAI:** https://github.com/limbonaut/limboai — C++ GDExtension (GDScript-compatible), behavior trees + HSM, very well maintained; revisit only if FSM state count exceeds ~8 or enemy coordination is needed.
- **godot_rl_agents:** park until squad AI or adaptive behavior is a stated design goal.
