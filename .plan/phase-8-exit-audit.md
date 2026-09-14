# Phase 8 coupled checkpoints, rewind, and replay exit audit

Audit: 2.15.1, 2026-09-14, #161. Delivered on branch `codex/phase-8-1-7-coupled-replay` together
with #155–#160.

Verdict: **complete for the documented scope**. Every roadmap work item and exit criterion maps to
public entry points, normative documentation, and repeatable tests, and both epic exit checkboxes
are supported below. Coordinated multi-resource world checkpoints reassigned from Phase 6 are
delivered. Phase 8 advances L3 (paper programming-model parity) but does not complete it:
task-as-value meta-agents remain Phase 9. No transparent process image and no live provider adapter
is claimed.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-8--coupled-checkpoints-rewind-and-replay) lists
eleven work items and seven exit criteria. [Epic #21](https://github.com/avnionur/shepherd-typescript/issues/21)
groups them into six work checkboxes and two exit checkboxes. Children: contract #155, sessions
#156, checkpoints #157, rewind and replay #158, process backends #159, analysis #160, and this audit
#161, delivered together.

Evidence is local: macOS arm64 (Node 24.17.0, APFS) for the full verification, and a
`node:24-bookworm` Linux arm64 container (Node 24.21.0, OrbStack kernel 7.0.14) for the replay suite
and the transparent probe. With the `acl` and `attr` packages the carrier metadata probes need, the
complete replay suite passes in the container (37 tests, zero skips); without them world captures are
honestly retained as unavailable. Hosted workflows remain disabled at the owner's request.

## Roadmap work items

| Work item (unchanged) | Delivery | Implementation, documentation, and evidence |
| --- | --- | --- |
| Define provider-session and process checkpoint adapter contracts | #155, #157 | `ReplayProviderSessionAdapter`, `ReplayProcessAdapter`, [coupled checkpoints](../docs/coupled-checkpoints.md), [contract](./coupled-replay-contract.md), [checkpoint tests](../test/replay/replay-checkpoint.test.ts) |
| Construct coupled checkpoint descriptors | #157 | `context.checkpoint()`, [checkpoint schema](../spec/schemas/replay-checkpoint-v1.schema.json), one cut and descriptor per boundary under the session fence, coordinated world images of every bound world |
| Record the exact trace cut, world receipt, and provider/process evidence, including unavailable capabilities | #157 | Constituents with receipts, evidence, and configured reasons; unavailable worlds, adapters, images, and probes retained exactly; `classifyReplayCheckpoint` |
| Implement reconstructive replay from deterministic prefixes | #156, #158 | `replayReplaySession` recorded steps served only for exact requests, intents, and dependencies; [rewind and replay](../docs/rewind-and-replay.md), [branch tests](../test/replay/replay-branch.test.ts) |
| Add provider prompt/cache identity and cache-hit evidence | #156 | Runtime-derived prompt, response, prefix, and context prefix identities; adapter cache identity; `hit` only on observed cache reads; [replay sessions](../docs/replay-sessions.md) |
| Implement rewind to a trace cut | #158 | `rewindReplaySession` to a checkpoint cut or a published step-boundary cut; recorded prefix copy; `rewound` terminal |
| Implement suffix replay with changed task/provider/effect handler | #158 | Declared `changes`, replacement task, suffix provider and handler stack; task, provider, and handler replay tests |
| Support process/container checkpoint backend where available | #159 | `createCooperativeProcessAdapter` (available wherever the child can start) and `createTransparentProcessAdapter` (CRIU probe); no container backend |
| Distinguish atomic checkpoint from reconstructed replay in records | #157, #158 | Checkpoint and restore records retain the derived `atomic`, `reconstructive`, or `unavailable` classification; [restore schema](../spec/schemas/replay-restore-v1.schema.json) |
| Enforce irreversible-effect rules during replay | #158 | Recorded prefixes invoke no handler; approval-required suffix effects need a policy approval; refusals retained without admission |
| Add trace divergence and dependency analysis | #160 | `analyzeReplayDivergence`, `analyzeReplayDependencies`, [analysis tests](../test/replay/replay-contract.test.ts) |

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| Restored managed filesystem is byte-equivalent to the recorded cut | Rewind and replay compare full trees (bytes, modes, empty directories, symlinks) of two worlds against the source state at the checkpoint, after the source world was changed; restoration re-captures and compares the content identity; non-empty roots and corrupt manifest blobs are refused before writing | Verified |
| A checkpoint is accepted only when each claimed constituent is verified, otherwise replay is classified as reconstructive or unavailable | `atomic` requires every constituent verified; missing adapters classify reconstructive; unavailable worlds, adapters, images, and probes classify unavailable and refuse rewind; restore re-verifies blobs, cuts, adapters, and process images | Verified |
| Provider/context prefix identity is verified, not assumed | Recorded steps are served only for canonical-equal requests and dependencies; recomputed prefix and context prefix identities must reach the restore evidence; provider-session restores must return the recorded context prefix; mismatches end the branch `failed` with `ReplayPrefixMismatchError` | Verified |
| Only the intended suffix diverges in deterministic tests | Changed-provider replays show identical prefixes, `root` divergence at the changed step, `propagated` divergence only at declared dependents, identical independent suffix steps, and no unexplained divergence; undeclared changes are reported unexplained | Verified |
| Replay never re-materializes an irreversible effect without policy approval | Handlers record no prefix invocation; suffix irreversible effects without a policy, with a refusal, or with a failing or malformed policy are retained `refused` and never reach a handler; approvals retain the approver and re-materialization flag | Verified |
| Unsupported process checkpointing is reported accurately | macOS: platform-unsupported reason; Linux container without CRIU: `criu executable is unavailable`; with CRIU 3.17.1 on OrbStack: `criu check failed: exit 1`; a passing check is reported capture-unsupported; unavailable process constituents refuse restoration | Verified |
| Replay of imported, version-compatible fixtures works | Exported archives imported into pristine stores are inspected, rewound, and replayed with verified identities and byte-equivalent worlds; incompatible record versions raise `ReplayCompatibilityError` | Verified |

Epic exit checkboxes: "Restored worlds and imported compatible fixtures replay with verified
identities" is supported by rows one, two, three, and seven. "Only intended suffixes diverge and
irreversible effects require policy approval" is supported by rows four and five.

## Recovery classification

| Failure | Classification | Recovery |
| --- | --- | --- |
| Writer killed between steps | `interrupted` after lease expiry | Rewind or replay from a retained checkpoint; process test |
| Writer killed after an effect admission | `materialization_uncertain` | `ReplayMaterializationUncertainError`; the handler is never re-invoked; rewind to an earlier checkpoint; process test |
| Writer lease expires while the program waits | Context aborted, `ReplayLeaseFencedError` | No terminal record; the session classifies `interrupted` |
| Restoration fails after the branch opened | `failed` terminal without restore record | Retry with a new branch command |

## Independent review

An independent verifier review of the delivered code found five major and eight minor issues. Two
majors were reproduced by the reviewer. Eleven are fixed with regression tests in
[`replay-review.test.ts`](../test/replay/replay-review.test.ts):

- a branch suffix could re-invoke an effect the source had admitted without a step; such intents are
  now gated like approval-required effects regardless of tier and count as re-materialization;
- the cooperative adapter had no error listener on the child's input, so a child that closed its input
  could crash the host with `EPIPE`; input, child, and write errors now fail the pending request;
- inspection accepted checkpoint constituents with inadmissible statuses or evidence (for example a
  `not_applicable` provider session with a provider), which could misreport `atomic`; per-kind forms
  are now enforced;
- restore records, live suffix approvals, and recorded step content were not bound to the source
  journal; inspection now folds the source and checks restore constituents, prefixes, the approval
  rule, and exact recorded content;
- nested replays used the root task instead of the task in force; tasks are now resolved through the
  branch ancestry;
- a live writer inside a handler was classified uncertain instead of running;
- world images beyond the entry bound could be retained as verified; the bound is now enforced at
  capture;
- the cooperative line bound missed oversized lines that ended in the same chunk;
- untrusted manifests could name protected control paths or untraversable directory modes;
- a cancellation observed after the program returned was recorded as `cancelled`;
- a provider-session adapter swap is now bound to the branch's declared adapter in inspection.

Two findings were not reproduced and are covered by tests instead: durable runs cannot target a replay
session owner because run creation uses the reserved `append` path, and repeating an imported terminal
session command returns its retained receipt.

## Verification (2.15.1)

- `pnpm sync:version`, `pnpm generate:api-reference`, `CI=true pnpm verify`, and `pnpm build:desktop`
  pass on macOS arm64: 669 tests, zero failures, zero skips, 100% configured line, branch, and
  function coverage, protocol artifact and API reference drift checks, and installed package gates.
- The replay suite passes in the `node:24-bookworm` Linux arm64 container with `acl` and `attr`.
- Transparent probe evidence: `criu executable is unavailable` without CRIU and
  `criu check failed: exit 1` with CRIU 3.17.1 on OrbStack kernel 7.0.14.

## Limits

- Session programs must be deterministic functions of their step results; program memory is never
  captured, so every branch re-executes the program.
- Declared dependencies are trusted declarations; analysis cannot prove the absence of undeclared data
  flow.
- No live provider or provider-session adapter ships; verified provider sessions need a
  caller-supplied adapter.
- No transparent process image or container checkpoint is captured; the cooperative backend relies on
  the process's own state serialization.
- Interrupted sessions are never resumed in place, and uncertain effects have no automatic repair.
- World images cover the reference copy carrier's portable manifest; hosts reach traversal limits at
  different sizes, and the entry bound is enforced at verification.
