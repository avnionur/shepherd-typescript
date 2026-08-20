# Phase 3 L1-Alpha Compatibility Status

Evidence audit: [`.plan/phase-3-exit-audit.md`](../.plan/phase-3-exit-audit.md). Public entry point:
[`src/index.ts`](../src/index.ts).

Version `1.36.1` completes the Phase 3 P0 retained-world settlement loop. A task can run against
isolated custody, retain an immutable proposed world, inspect exact changes, and explicitly select
or discard that output through consume-once, restart-safe public coordinators. User files remain
unchanged before selection, moved-basis selection fails closed, concurrent admissions have one
winner, and discard preserves the parent world.

This status is `L1-alpha`, not full L1 or complete Shepherd `0.3.0` parity. The implemented scope
uses the reference copy carrier, Git-aware custody, deterministic offline provider fixtures, and
supported macOS/Linux filesystem behavior. Protected control paths and unsupported host metadata
fail closed with versioned evidence.

Phase 4 has since added explicit runtime grants and honest advisory/auto placement resolution.
Native jail enforcement, `apply`, `release`, CLI compatibility, repair commands, installed-package
consumer fixtures, and the remaining documented `0.3.0` surface remain open. Native Windows policy
is configured and platform-gated, but no final Windows CI lane is claimed while the repository
workflow remains manually disabled.
