# Shepherd Phase 15 conformance snapshot

Date: 2026-07-22  
Runtime: native TypeScript/Electron; no Python Shepherd service  
Managed build profile: guarded `workspace`

This is the dated evidence claim that accompanied the implementation. Audit it against current source and the known gaps in [Shepherd port acceptance boundary](shepherd-port-acceptance.md); a listed test is evidence of exercised behavior, not proof that every normative gate passes.

## Completion matrix

| Capability | Claimed Cognia implementation | Falsifiable evidence |
| --- | --- | --- |
| Typed tasks, values, projection, ambient delivery | `packages/shepherd/src/task/` | task registry, execution, and typed projection tests |
| Durable child tasks and exactly-once delivery | child model/store/runtime | child storage and task runtime tests |
| Intent-before-outcome effects and policy | effect broker and desktop wrappers | effect broker, desktop tool effects, settlement effects |
| Scope/binding attenuation | scope manager and binding laws | scope manager and kernel reducer tests |
| Transactional trace/content state | SQLite/content adapter, recovery, archive | transaction, recovery, effect, candidate storage tests |
| Workspace placement and retained candidates | guarded worktree adapter | workspace placement, retained candidate, candidate retention |
| Process-isolated/coupled contracts | pure ports/resolver/checkpoint laws | placement/coupled tests; no desktop backend advertised |
| Consume-once settlement | preview/prepare/execute/inspect/journal/cleanup | settlement coordinator/storage/workspace tests |
| Replay modes and public engine | planner, validator, executor, branch API | replay planner/validator/executor/API/storage tests |
| Meta-agents and CRO | admission, supervisor, counterfactual replay/optimizer | meta and counterfactual suites |
| Context checkpoint integration | immutable Context Engine snapshot references | cross-phase/checkpoint integration tests |
| Experimental build packs | dual gate, typed hold/compare/preview/settle | build pack/service/tool/runtime migration tests |
| Electron observability/control | redacted trace/recovery/approval/settlement bridge and fail-closed replay state | desktop observability/control and Shepherd UI tests |

## Advertised guarantees

- A retained worktree isolates destination writes until settlement.
- Repository trust, file scope, structured verification, credential-environment denial, execution-configuration approval, typed completion, exact preview, and user confirmation are intended to fail closed.
- Select refuses dirty user content on candidate paths; retained verification profiles rerun against the composed destination.
- Provider, tool, and settlement boundaries record intent before outcome.
- Trace projections are paginated and redact payload authority and host paths.
- Replay control requires `coupled` and remains unavailable instead of downgrading to workspace restoration semantics.
- Non-opted-in packs retain existing behavior and do not create a managed runtime merely because an agent is a coding agent.

## Explicit non-claims

- Workspace is not process, network, credential, or agent-state isolation.
- Git worktrees are not coupled checkpoints.
- Live provider calls and external effects are not reversible.
- Test evidence is not formal verification.
- No macOS, Linux, Windows, container, or VM hard-isolation backend was advertised.

## Rollout boundary

The experimental frontend and backend packs were the only managed-build rollout cohort. Hard profiles remain fail-closed until a separately approved backend and platform prerequisites pass conformance. This snapshot adds no Docker, container, native-isolation, or elevated-installation dependency.

## Recorded verification evidence

- Focused Shepherd, build-pack, cross-phase, and Electron UI suites: 57 files and 216 tests passed.
- Strict typecheck passed across all 15 workspace projects.
- Desktop production build passed for main, preload, and renderer.
- Repository-wide suite passed 587 files and 4,825 tests with 10 todo.
- Whitespace validation passed.

## Audit caveat

The same-date independent review found that some negative paths were not covered: blocked typed completion eligibility, initially failed verification evidence, same-version authority cache invalidation, generic supervisor shell authority, encryption at rest, complete trace slice/diff operations, release materialization, and representative benchmark workloads. Preserve these as open verification questions until current runtime source and negative tests close them.
