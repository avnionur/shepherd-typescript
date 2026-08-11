# Agent Runtime Architecture Integration

Status: adopted planning interpretation

Source reviewed: [Agent Runtime Architecture](./Agent-Runtime-Architecture.md)

## Disposition

The study's central thesis is adopted: an agent is a reusable behavioral definition and a run is a
durable, observable execution. The implementation plan remains capability-gated and the existing
versioned record protocol remains normative.

The study is not a protocol specification. Its illustrative `Agent`, `RunEvent`, `EventStore`,
provider, tool, scheduler, memory, and package interfaces are not public contracts until they are
specified, versioned, and covered by conformance fixtures.

## Canonical mapping

| Study term | Plan/protocol meaning |
| --- | --- |
| Event or trace event | A semantic record body plus envelope and owner view in the canonical record graph. |
| Event sequence | A derived display or delivery sequence; owner-local ordinals and causal references define protocol ordering. |
| Event timestamp | Non-semantic observation metadata; it cannot affect record identity. |
| Event store | The trace kernel and its adapters; projections are disposable and never a second authority. |
| Tool call | An effect intent/outcome correlated by exact content-bound identifiers and dispatched through an effect handler. |
| Run state | A versioned lifecycle projection produced from canonical records, not mutable flags. |
| Checkpoint | A coupled descriptor referencing a trace cut, world receipt, and optional provider/process receipt. |

## Required planning constraints

1. The canonical record graph is the sole runtime-history authority. Logs, observer delivery,
   materialized state, metrics, and timestamps are projections.
2. A trace proves recorded runtime decisions, not external or provider state by assertion. Carrier,
   provider, and effect receipts establish their own evidence.
3. A tool is an effect-handler adapter. The runtime must not add a parallel tool-event protocol.
4. The lifecycle has one normative state machine. Control-plane statuses such as waiting and
   suspended must be specified as states or transitions in that machine, not as a competing model.
5. A process may invoke a provider or effect only with a durable first-writer claim or a valid,
   fenced lease. Control commands require stable idempotency identities.
6. A checkpoint must identify which constituents are verified. Missing provider or process state
   yields reconstructive or unavailable replay, never an atomic-resume claim.
7. Long-term memory is an optional, redacted, policy-governed adapter. It is neither canonical run
   state nor an implicit source of replay input.

The proposed detailed lifecycle, safe-boundary, continuation-evidence, and command contract is in
[`normative-run-lifecycle.md`](./normative-run-lifecycle.md). It remains planning material until its
versioned record schemas, projection, and public-seam conformance tests ship.

## Document remediation before normative use

The study needs an editorial pass before it can serve as normative documentation:

- remove the Turkish continuation prose and generated code-fence `id` attributes;
- repair section numbering (`6.1`/`6.2`, and the “continued” headings);
- replace generic `unknown`-based interfaces with links to versioned protocol contracts or label
  them explicitly as pseudocode;
- remove or reconcile the proposed `@runtime/*` package layout with the repository's actual public
  package layout;
- cite the pinned upstream and paper evidence for claims presented as Shepherd core behavior.

## Verification matrix

| Capability | Existing evidence | Change risk | Required verification |
| --- | --- | --- |
| Planning authority mapping | Canonical-record and architecture documentation | Medium | Link and terminology review; protocol conformance remains unchanged. |
| Fenced invocation control | Durable execution recovery, stale-lease fencing, and idempotent command-bound recovery tests | High | Cross-connection first-writer race, stale-lease fencing, command replay/conflict, and recovery tests. |
| Coupled checkpoints | Scope/replay phases already require carrier and provider evidence | High | Verified constituent, reconstructive fallback, and unavailable-state fixtures. |
| Projection-only subscriptions | Existing record/projection separation | Medium | Passive-observer trace-equivalence, cursor replay, overflow, and reconnect tests. |

## Roadmap consequences

The roadmap now carries the implementation gates for durable control, evidence authority,
checkpoints, and subscription semantics. It deliberately does not schedule a distributed scheduler,
long-term memory system, MCP integration, or a new package split: those remain optional extensions
until a user-facing requirement and a versioned contract justify them.
