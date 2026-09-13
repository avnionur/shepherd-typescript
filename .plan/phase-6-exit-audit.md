# Phase 6 scope-algebra exit audit

Audit: 2.7.1, 2026-09-13, #141. Delivered on branch `codex/phase-6-4-9-scope-substrate` together
with #131 and #137–#140.

Verdict: **complete for the documented scope**. Every roadmap exit criterion maps to delivered
public entry points, normative documentation, and repeatable tests, and the three epic exit
checkboxes are supported below. One roadmap work item is delivered for one bound resource per
scope. Coordinated multi-resource checkpoints are reassigned to Phase 8, whose roadmap already owns
coupled checkpoint construction; the reassignment is explained under the work item. Phase exit is
L2 substrate parity for the recorded hosts, not production readiness.

## Scope and evidence boundary

The [roadmap](./implementation-roadmap.md#phase-6--scope-algebra-and-versioned-world-substrate)
lists eleven work items and seven exit criteria. [Epic #19](https://github.com/avnionur/shepherd-typescript/issues/19)
groups them into three exit checkboxes. Children: contract #127 (PR #128), slice A #129 (PR #132),
slice B #130 (PR #136), and #131, #137, #138, #139, #140, and this audit #141, delivered together.

Evidence is local. It comes from macOS arm64 (Node 24.17.0, APFS) and a privileged
`node:24-bookworm` Linux arm64 container (Node 24.21.0) on tmpfs and loopback XFS with
`reflink=1`. Hosted workflows remain disabled at the owner's request. Windows, x86-64 Linux, and
unprivileged overlay mounts are not claimed.

## Roadmap work items

| Work item (unchanged) | Delivery | Implementation, documentation, and evidence |
| --- | --- | --- |
| Scope owner/child records | #129 | [Registration](../docs/scope-registration.md), `registerRootScope`/`registerChildScope`, [registration tests](../test/scope/scope-registration.test.ts) |
| `emit`, `fork`, `merge`, `discard` | #129, #130, #131 | [Emission](../docs/scope-registration.md), [fork](../docs/scope-fork.md), [merge and discard](../docs/scope-merge-discard.md); [merge](../test/scope/scope-merge.test.ts), [discard](../test/scope/scope-discard.test.ts), [recovery](../test/scope/scope-terminal-recovery.test.ts), and [codec](../test/scope/scope-terminal-codec.test.ts) suites |
| `spawn`, `adopt`, `abandon`, `publish` vocabulary mapping | #137 | [Vocabulary mapping](../docs/scope-vocabulary.md), `projectScopeVocabulary`, [vocabulary tests](../test/scope/scope-vocabulary.test.ts); version-1 projections unchanged |
| Nested-scope authority attenuation | #129, #130 | Per-resource parent ∩ request ∩ ceiling, bound to authenticated workspace resources; registration and fork tests |
| Clonefile and Linux overlay carriers | #139 | [Optimized carriers](../docs/optimized-carriers.md), `createReferenceCopyCarrier({ backend })`, [conformance suite](../test/workspace/carrier-conformance.ts), `pnpm test:carriers:linux` |
| Scope-local writer exclusivity | #129, #130 | Fenced single-writer claims, atomic canonical-order `claimScopeWriters`, [writer tests](../test/scope/scope-writer.test.ts) |
| Parallel and nested scope scheduling | #138 | [Scheduling](../docs/scope-scheduling.md), `runScopeTree`, [scheduler tests](../test/scope/scope-tree.test.ts) |
| Child recovery and orphan detection | #130, #131, #138 | Receipt-based fork, merge, and discard recovery; `inspectScopeRecovery` with a single owner and resume command; [recovery classification tests](../test/scope/scope-recovery.test.ts). Structural orphans are impossible by construction, so orphaned workers are detected as expired writer claims |
| Branch checkpoints as a coupled descriptor | #130, #141 | Checkpoint of trace cut, execution, binding, world, grants, child frontier, budget, provider session, process, and irreversible effects, each classified; `classifyScopeCheckpoint` ([start classification](../docs/scope-fork.md#start-classification)). **Delivered for one bound resource per scope**, see below |
| Algebraic/reference-model laws against the copy carrier | #140 | [Law suite](../docs/scope-laws.md) with a [pure reference model](../test/scope/scope-reference-model.ts), run against copy, clone, and overlay |
| Storage scaling benchmark by changed suffix | #139 | `pnpm bench:carriers` with configured bounds; results below |

**Checkpoint reassignment.** A scope fork binds exactly one active resource, following the reviewed
contract: coordinated multi-resource forks need a separately reviewed checkpoint and publication
contract. The Phase 6 exit criteria do not require multi-resource branches. The honest descriptor
and its start classification are complete for the supported single-resource branch. Phase 8
("Coupled checkpoints, rewind, and replay") already owns provider/process checkpoint adapters and
coupled descriptors across constituents. Coordinated multi-resource world checkpoints are moved
there rather than being claimed here.

## Roadmap exit criteria

| Criterion (unchanged) | Evidence | Outcome |
| --- | --- | --- |
| Unmerged siblings are isolated | Fork sibling isolation tests; the law suite compares every open world after every operation on copy, clone, and overlay | Verified |
| Merge/discard results match the reference carrier | The law suite compares states, worlds, ordered selected histories, and refusal classes with the reference model; explicit disjoint-merge commutativity | Verified on copy (macOS, Linux), clone (APFS, XFS), and overlay (XFS) |
| Nested discard leaves ancestors unchanged | Nested subtree discard tests; discard of a parent with merged, discarded, and open descendants; model-checked parent and ancestor worlds and histories | Verified |
| Crash recovery has no ambiguous ownership | Crash tests at every trace and carrier boundary of fork, merge, and discard; scheduler interruption and resume; `inspectScopeRecovery` names exactly one owner and command per scope | Verified |
| A branch can prove whether it started from an atomic checkpoint or a reconstructed state | `classifyScopeCheckpoint` derives atomic snapshot, quiescent verified copy, or reconstructed start and restorability from retained constituents | Verified; every current branch honestly proves a quiescent verified-copy start that is not fully restorable |
| Performance carriers pass the same correctness suite as copy | One shared conformance suite and the law suite run unchanged per backend, with required backends enforced in the Linux run | Verified: macOS 12/12 conformance; Linux tmpfs 12/12; Linux XFS 15/15; laws 9/9 on macOS and 13/13 on XFS |
| Branch storage scales with changed data for supported optimized carriers | Storage benchmark (median of five, MiB, world/changed: 16/1, 16/4, 64/1, 64/4) | Verified: copy ≈ world size; clone 1.01, 3.97, 1.02, 4.06 (APFS) and 1.01, 4.01, 1.04, 4.04 (XFS); overlay 1.00, 4.00, 1.00, 4.00 |

Epic checkboxes: "sibling and nested scope isolation laws pass against the copy carrier" is supported
by rows one to three. "Recovery ownership and checkpoint classification are unambiguous" is supported
by rows four and five. "Optimized carriers pass reference conformance and storage scaling gates" is
supported by rows six and seven.

## Independent review

Independent verifier reviews ran against the delivered code. The slice C review found one major
and six minor issues. All seven are fixed in the scheduling change:

- pending descendant cleanup stranded by a parent merge;
- publication writing before unplanned paths were checked;
- protected application custody leaks;
- forged integrations accepted on imported stores;
- carrier work before terminal refusal;
- an undocumented non-atomic boundary check;
- a missing merge-versus-discard race test.

A second review of vocabulary, scheduling, laws, classification, and carrier integration found two
major recovery-classification defects:

- cleanup ownership pointed at a sealed parent;
- an interrupted discard with no custody was reported terminal.

It also found four minor issues: leaked application custody after a crash following completion,
an untyped error on a changed schedule, a single reported sibling failure, and an undocumented
helper threat model. All six are fixed with tests.

During the carrier work, reviewers rejected an unverifiable macOS clone design, which was replaced by
an integrity-checked `clonefile(2)` helper, and fixed an XFS benchmark flake. The law suite exposed
an overlay teardown defect, now fixed.

## Verification (2.7.1)

- `pnpm sync:version`, `CI=true pnpm verify`, and `pnpm build:desktop` pass; the fresh test count,
  skips, and coverage are recorded in the tracker entry for #141.
- `pnpm test:carriers:linux` passes (conformance on tmpfs and XFS, benchmarks, laws with clone and
  overlay required). `pnpm bench:carriers` passes on macOS APFS.

## Limits

Hosted CI, CodeQL, and Dependency Review remain disabled. The macOS clone backend requires a C
compiler and runs one helper process per cloned file. Overlay requires Linux mount permission.
Under overlay, captured revisions remain full verified copies. Structural path conflicts are
covered by the merge suites rather than the flat-path law model. Live supervision, interception,
provider/process restoration, and multi-resource coordinated checkpoints remain later phases.
Publication remains disabled (`private: true`).
