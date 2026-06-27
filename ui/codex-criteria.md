Data-driven adherence — review THIS first, before the general correctness/quality pass.

The project's pillar: behaviour, content, and tuning live in DATA driven by a small generic
system — NOT hardcoded per-instance and NOT magic numbers. Data-driven has TWO halves; flag a
violation of EITHER:

1. **Addressable data.** Every tuning value must live in a named, addressable place — a Resource
   `.tres` field or an `@export` set in the Inspector. A bare literal inside logic is a magic
   number even inside a "data-driven" system. Flag: `lerpf(0.3, 1.8)`, `Vector3(1.3, 0.7, 1.3)`,
   `const _AGENT_HEIGHT = 1.8`, and hand-tuned constants buried in functions.
2. **Code only reads it.** The data must actually drive behaviour. Flag ORPHAN DATA — an
   authored `@export` / `.tres` field that no code reads (e.g. `score_value` set on an enemy but
   never added to the score). This is the worst case: the shape of data-driven with none of the
   effect.

Also flag: a **second parallel system** where an existing one should have been extended (two
run-controllers, two "enemy" definition paths, two score plumbings, duplicated signal contracts).

For each finding, name the data-driven shape it should take — which Resource/field, or which
existing system to extend. Do NOT flag an authored `@export`/`.tres` field as a problem: that is
the GOAL. The problems are literals in logic and fields left unconsumed.
