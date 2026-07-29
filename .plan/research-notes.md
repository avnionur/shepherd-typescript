# Research Notes

Research date: 2026-07-29

Pinned development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

Pinned shipped revision: `v0.3.0` at `a8196d4c453514836d06bd2fece91a03cdc37107`

## Sources reviewed

Primary sources:

- [Project site](https://shepherd-agents.ai/)
- [Project blog](https://shepherd-agents.ai/blog/)
- [Paper abstract](https://arxiv.org/abs/2605.10913)
- [Paper v3 HTML](https://arxiv.org/html/2605.10913v3)
- [Concept documentation](https://docs.shepherd-agents.ai/concepts/)
- [CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [Roadmap](https://docs.shepherd-agents.ai/roadmap/)
- [Pinned upstream repository](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)
- [Pinned Python workspace manifest](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/pyproject.toml)
- [Compatibility baseline and evidence scope](./upstream-baseline.md)

Supporting concept pages:

- [Tasks](https://docs.shepherd-agents.ai/concepts/tasks/)
- [Effects](https://docs.shepherd-agents.ai/concepts/effects/)
- [Permissions](https://docs.shepherd-agents.ai/concepts/permissions/)
- [Placements](https://docs.shepherd-agents.ai/concepts/placements/)
- [Runs](https://docs.shepherd-agents.ai/concepts/runs/)

## What Shepherd is

The paper maps four runtime needs to functional-programming constructs:

| Shepherd primitive | Runtime operation | FP construct |
| --- | --- | --- |
| Task | modify or substitute agent behavior | typed function |
| Effect | observe and intercept execution | algebraic effect |
| Scope | fork agent and environment state | scoped effect handler |
| Trace | revert and replay past state | persistent data structure |

An effect represents an attempted action such as an LLM call, tool call,
filesystem change, or custom boundary action. The paper separates every action
into an intent event and an outcome event, permitting observation or denial
before materialization.

A scope binds sandbox/environment handles, providers, tools, and an effect
cursor. Its fundamental operations are:

- `emit`: append an effect;
- `fork`: create an isolated copy-on-write child;
- `merge`: propagate an accepted child into its parent;
- `discard`: abandon a child without changing the parent.

The execution trace is a persistent commit graph. Shared prefixes are addressed
by content and reused by divergent branches.

## Reversibility model

The paper distinguishes:

- **reversible effects**, such as managed filesystem changes;
- **compensable effects**, such as database operations with a user-provided
  compensation handler;
- **irreversible effects**, such as already-sent email or model calls, which can
  be audited but not truthfully undone.

This distinction must appear in the type system, materialization policy, trace,
and UI. “Revert” means restore managed state and invoke valid compensations; it
does not mean erase external history.

## Shipped `0.3.0` behavior

The versioned docs call Shepherd `0.3.0` a settlement machine.

Shipped:

- typed task declarations and registrations;
- signature-carried repository grants;
- bodyless retained execution through `workspace.run(...)`;
- named, disjoint repository bindings;
- `ReadOnly` and `ReadWrite` profiles;
- `jail`, `advisory`, and `auto` placements;
- macOS Seatbelt and Linux Landlock enforcement for jailed execution;
- retained changesets;
- durable run records and traces;
- consume-once `select`, `apply`, `release`, and `discard`;
- task and run ledgers;
- static/deterministic provider;
- CLI inspection and settlement.

Not shipped in `0.3.0`:

- ambient model delivery for direct bodyless task calls;
- returned world handles;
- typed value projection from captured work;
- durable child runs and result threading;
- task-as-value delegation and meta-agent supervision;
- a public arbitrary replay API.

The implementation plan therefore treats `0.3.0` parity as an intermediate,
testable milestone rather than “full Shepherd.”

## Settlement semantics

The public docs state:

- reading commands may use `--latest` or a unique short ID prefix;
- settlement commands require an exact run identity;
- one settlement consumes the retained output and all other settlement attempts
  must refuse;
- `select` is fast-forward-only;
- `apply` may three-way settle onto an advanced workspace only when changes are
  path-disjoint;
- `apply` is whole-output acceptance, not content synthesis;
- retained content is inspectable before settlement.

These rules are valuable because they are concrete and can become the first
cross-language state-machine fixtures.

## Run model

A run carries:

- an outcome: succeeded with value, failed, exhausted, or cancelled;
- a complete ordered trace of boundary effects;
- artifacts;
- usage/cost data;
- world outputs and their settlement state;
- requested and actual enforcement metadata.

Failure must preserve the record up to failure. A run is not reducible to its
return value.

## Permissions and placements

Permissions are attached to task parameters rather than maintained in a
separate policy file. A bare `GitRepo` is the writable shorthand; an explicit
grant can be modeled as `May<GitRepo, ReadOnly>` or
`May<GitRepo, ReadWrite>`.

The runtime binds named, non-overlapping roots. The current documented scope is
whole-profile per binding; sub-root grants are not part of `0.3.0`.

Placements:

- `jail`: native enforcement; fail closed if unavailable;
- `advisory`: in-process, recorded but not OS-enforced;
- `auto`: prefer jail, visibly fall back to advisory.

The TypeScript API cannot infer runtime permissions from erased generic types.
Task declarations therefore need runtime schemas/metadata in addition to
compile-time generics.

## CLI surface

Documented top-level commands:

- `run`
- `task`
- `demo`
- `doctor`
- `init`
- `package`

The `run` group includes inspection, changesets, outputs, trace views, repair,
and settlement. `run start` is a fenced compatibility entry point rather than
the normal launch path.

The TypeScript implementation should preserve semantic command compatibility,
but use a distinct executable name until project naming and trademark policy are
resolved. A compatibility alias can be added deliberately later.

## Upstream architecture and movement

The upstream Python workspace currently lists packages for core, runtime,
providers, contexts, transform, sandboxes, export, authoring, domain batteries,
tests, and a kernel reference, together with `vcs-core` and `commons-vcs`.

Two upstream facts materially change this plan:

1. The `shepherd/` tree contains a June 2026 re-aim notice: execution,
   containment, carriers, and trace belong in `vcs-core`; Shepherd becomes the
   dialect that composes those mechanisms.
2. `shepherd2` is a reference implementation for `shepherd.kernel.abi.v0`. It
   describes an immutable trace kernel with canonical record vocabulary,
   content-addressed semantic identity (`record_id == digest`), SQLite atomic
   append batches, owner/cut/slice addressing, idempotent append intent, and
   synchronous child operations (`spawn`, `adopt`, `abandon`, `publish`).

The `shepherd2` README also explicitly excludes async scheduling, rich
supervision, provider integration, search, replay, live steering, remote
devices, and real capability delegation. It is a kernel/reference, not the
complete paper system.

This supports a layered TypeScript design:

- a language-neutral trace kernel;
- a world/version-control substrate;
- a Shepherd task/effect dialect;
- optional providers, sandboxes, CLI, and higher-order meta-agent services.

## Performance claims and what they do not prove

The project reports roughly 134–143 ms fork latency across tested images and
roughly 95% prompt-prefix cache reuse in replay scenarios. These results justify
the copy-on-write architecture, but they are not acceptance results for this
implementation.

This project must publish its own benchmarks by:

- operating system and filesystem;
- carrier/backend;
- image/workspace size;
- bytes changed after fork;
- branch count and concurrency;
- provider/cache behavior;
- cold and warm conditions.

Correctness gates precede latency optimization.

## Research-to-product conclusions

1. Implement the settlement loop first; it has the clearest executable
   contract.
2. Freeze a protocol and conformance suite before creating public SDK sugar.
3. Separate trace identity from storage receipts and platform-specific carrier
   details.
4. Make reversibility tiers explicit.
5. Treat live interception as a synchronization protocol, not an event-listener
   convenience.
6. Keep provider/model state and environment state in the same fork descriptor.
7. Report actual enforcement; never market advisory execution as sandboxing.
8. Do not bind the architecture directly to Git CLI output. Git can be a world
   carrier, while the trace has its own typed, canonical semantics.
9. Pin upstream revisions because upstream `main` is actively changing.
10. Preserve attribution and MIT license notices for behavior or code derived
    from upstream.
