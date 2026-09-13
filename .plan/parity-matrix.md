# Compatibility and Parity Matrix

Legend:

- **P0**: required for the first useful release;
- **P1**: required for complete shipped `0.3.0` compatibility;
- **P2**: required for substrate and paper parity;
- **P3**: maturity, ecosystem, or advanced research feature.

“Complete” means the row has conformance fixtures and passes through the TypeScript public seam
and any applicable pinned upstream-oracle comparison.

## Core semantic surface

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Typed task declaration | shipped | core | P0 | compile-time tests plus runtime descriptor fixtures |
| Bodyless task contract | shipped via retained run | core | P0 | offline static-provider execution and terminal public-seam tests implemented; durable run retention follows |
| Bodied deterministic task | shipped | core | P0 | success/failure/cancel fixtures |
| Doc/instruction is behavioral identity | shipped | core | P0 | task digest changes when instruction changes |
| Runtime input/output validation | partial surface | core | P0 | schema failure fixtures |
| Task registration/version resolution | shipped | supporting | P1 | exact and short-ref resolution tests |
| Task as argument/value | deferred | core | P2 | supervisor composition suite |
| Runtime task synthesis/rewrite | deferred | core | P2 | signed descriptor and replay tests |
| Returned resource handles | deferred | implied | P2 | authority-preserving handle fixtures |
| Typed value projection | deferred | implied | P2 | provenance-tagged projection tests |

## Effects

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Typed effect records | shipped | core | P0 | canonical v1 serialization fixture implemented |
| Intent/outcome correlation | trace machinery | explicit | P0 | exact content-bound correlation implemented; stream ordering follows |
| Immutable append stream | shipped | core | P0 | mutation/refusal and digest tests |
| In-process handlers | shipped but narrowly documented | core | P1 | immutable exact-kind stack implemented; dynamic scope laws follow |
| Non-perturbing observation | limited public surface | explicit | P2 | identical worker trace with/without observer |
| Pre-materialization interception | not productized | explicit | P2 | deny/replace/timeout race suite |
| Custom effect families | architectural | explicit | P2 | registry and unknown-record round trip |
| Reversible tier | partial world behavior | explicit | P1 | rollback fixture |
| Compensable tier | not public product surface | explicit | P2 | idempotent compensation fixture |
| Irreversible tier | auditable | explicit | P1 | no false rollback claims |

## Runs, traces, and kernel

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Durable run ledger | shipped | required | P0 | public bounded task/run list/show projections and exact/unique-prefix/canonical-latest read selectors now compose lifecycle, ordered artifacts, verified blob receipts, usage, outcome, cut, settlements, task-world/grant/placement/jail evidence, reopen/import, deterministic replay, exact recovery, command-authorized creation resume and cut repair, cross-connection claims, lease takeover, stale-writer fencing, waiting/suspension inspection, and exact-ID mutation authority |
| Success/failure/exhausted/cancelled outcomes | documented | required | P0 | versioned closed records and exhaustive state fixtures implemented |
| Artifacts and usage | documented | required | P1 | executor-assigned artifacts and aggregate usage persist in the run ledger and native export with exact restart reconstruction implemented |
| Content-addressed record identity | vNext reference | explicit sharing | P0 | canonical hash vectors |
| Atomic append batches | vNext reference | required | P0 | crash/fault injection |
| Idempotent append intent | vNext reference | required | P0 | retry conflict tests |
| Owner/cut/slice addressing | vNext reference | graph access | P1 | projection fixtures |
| Trace query and materialization | shipped | core | P1 | public bounded output-citation, published-cut trace-revision, and durable recovery-record list/show selectors now expose exact owner paths, causality, witnesses, command effects, cut-bounded outputs/settlements, native import, and fresh-process reconstruction; upstream event verbs and CLI golden output remain |
| Orphaned operation diagnosis and repair | shipped | required | P1 | public bounded diagnosis plus externally proven session death, exact idempotent command/basis authority, atomic bookkeeping-only receipts, live/provider/scope refusal, fail-soft pre-run reclaim, reopen/import audit evidence, concurrent/interrupted retry convergence, and stable CLI human/JSON presentation implemented |
| Live trace subscription | not public complete | explicit | P2 | backpressure/reconnect tests |
| Arbitrary rewind | not public API | explicit | P2 | byte-equivalence tests |
| Suffix replay | deferred | explicit | P2 | deterministic and provider-cache tests |
| Export/import | upstream package exists | useful | P1 | native archive v1 round trips implemented; ATIF follows runtime records |

## Worlds, scopes, and settlement

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Workspace initialization/adoption | shipped | substrate | P0 | protected initialization, Git-history preservation, and TypeScript-owned empty/Git/worktree baseline identity implemented; retained custody and pinned dirty-worktree oracle parity follow the carrier slices |
| Named disjoint bindings | shipped | scope binding | P0 | canonical directory authorities plus protocol-v20 exact Git repository resource identity, disjoint multi-repository custody, linked/common-repository refusal, nested/submodule boundary tests, and protocol-v21 exact grant admission implemented |
| Retained world output | shipped | compatible | P0 | working tree remains unchanged |
| Read-only changeset | shipped | required | P0 | file/mode/delete/symlink fixtures |
| `select` fast-forward settlement | shipped | merge analogue | P0 | moved-basis refusal tests |
| `apply` path-disjoint three-way settlement | shipped | merge analogue | P1 | public equal/prefix/portable-alias overlap refusal, structural merge, Git-state preservation, consume-once, interruption, concurrency, and fresh-process recovery implemented |
| `release` | shipped | scope handoff analogue | P1 | public receipt-only settlement, parent-drift/current-basis witnesses, preserved readable custody, consume-once conflicts, Git-state preservation, interruption, concurrency, and fresh-process recovery implemented |
| `discard` | shipped | core | P0 | parent/worktree equivalence |
| Consume-once settlement | shipped | required | P0 | concurrent CAS tests |
| Scope `emit/fork/merge/discard` | shipped | core | P2 | durable registration, fenced emission, reference-copy fork, consume-once three-way merge and subtree discard with receipt recovery, and a seeded reference-model law suite on copy, clone, and overlay carriers implemented (Phase 6 exit audit) |
| Nested/concurrent scopes | shipped | explicit | P2 | nested attenuation, atomic multi-scope claims, bounded parallel nested scheduling with deterministic settlement, recovery ownership classification, and cross-connection merge/discard race tests implemented |
| Agent + environment atomic fork | research substrate | explicit | P2 | coupled checkpoint fixture |
| Process checkpoint/resume | research substrate | explicit | P2 | platform-gated continuation suite |
| Storage sharing by divergent suffix | research substrate | explicit | P2 | disk scaling benchmark |

### Phase 3 L1-alpha result

The P0 retained-world rows above pass through public TypeScript seams: isolated capture keeps the
user tree unchanged, canonical inspection covers file/mode/symlink changes, selection refuses
moved bases, consume-once admission has one winner, discard preserves the parent, and selection or
discard converges after restart. The reproducible evidence is recorded in
[`phase-3-exit-audit.md`](./phase-3-exit-audit.md).

`L1-alpha` does not mark the entire upstream column complete. Explicit grant identity, advisory
capability checks, advisory/auto placement reporting, authenticated native filesystem-write jails,
path-disjoint `apply`, receipt-only `release`, public orphaned-operation repair, and configured
human CLI groups, stable JSON/reference artifacts, and the installed-package offline quickstart
are implemented, while remaining documented CLI views stay assigned to Phase 4. Platform completion is limited
to probed macOS Seatbelt and Linux/WSL Landlock; no optimized carrier, AppContainer, or native-
Windows jail claim is made.

## Permissions, placement, and safety

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Runtime permission descriptors | shipped | required | P0 | protocol-v21 companion artifacts and independent canonical fixture implemented |
| `ReadOnly`/`ReadWrite` per binding | shipped | required | P0 | exact-resource admission and advisory capability matrix implemented |
| Whole-run permission ceiling | shipped | useful | P1 | configured atom intersection and non-amplification property implemented |
| Deny by default | shipped | required | P0 | missing/extra resources and read-only writes fail closed at advisory and native public seams |
| Advisory placement | shipped | useful | P0 | protocol-v22 requested/resolved/actual evidence and placed capture/recovery implemented |
| Auto placement | shipped | useful | P0 | visible advisory fallback; native auto requires an authenticated successful probe |
| Jail placement fails closed | shipped | safety critical | P1 | probe/helper/profile/launch/interruption refusal fixtures implemented |
| macOS Seatbelt | shipped | platform | P1 | real local syscall-denial, read-only, alias, process, and recovery suite implemented |
| Linux Landlock/container jail | shipped | platform | P1 | package helper and Linux-gated real denial suite implemented; capable Linux host required |
| Windows/WSL policy | WSL advised | platform | P1 | native Windows unsupported; WSL uses Landlock only when its Linux probe and denial suite pass |
| Capability attenuation/delegation | not complete | meta-agent need | P2 | no-amplification property |
| Irreversible-effect approval gate | research direction | safety need | P2 | interception tests |

## Providers and higher-order behavior

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Deterministic/static provider | shipped | testing need | P0 | exact offline cassette provider plus transient and restart-safe durable executor public-seam fixtures implemented |
| Claude CLI provider | shipped path | examples | P1 | opt-in integration test |
| Codex provider | claimed by project materials | examples | P1 | opt-in integration test |
| OpenRouter/provider adapter | claimed via Claude path | examples | P2 | contract test |
| Provider-neutral event model | architectural | core | P0 | request/response, ordered artifact definition, descriptor, and executor normalization contracts implemented; streaming event normalization remains |
| Provider prompt/cache identity | research | replay need | P2 | prefix identity tests |
| Cancellation and budgets | run model | required | P1 | configured counter/duration controls and executor terminal integration implemented; effect accounting follows |
| Runtime supervisor | not public productized | case study | P2 | two-worker conflict scenario |
| Inject/steer | experimental/case study | case study | P2 | ordered-context mutation test |
| Handoff/redirect | experimental/case study | case study | P2 | ownership transition test |
| Discard/revert worker | experimental/case study | case study | P2 | restart-from-clean-fork test |
| Counterfactual replay optimizer | experiment | case study | P3 | reproducible small benchmark |
| Trajectory compression | experiment | case study | P3 | fork-point/hint schema, verifier gate, and best-of-N control |
| Tree-RL fork integration | experiment | case study | P3 | adapter and synthetic rollout test |

## Formal assurance and claim boundaries

| Capability | Upstream/paper surface | Priority | Planned proof |
| --- | --- | --- | --- |
| Executable typed-effect trace machine | paper Appendix B reference core | P2 | configured Core-A lifecycle machine and pinned upstream Core-0/Core-A public-seam vectors implemented |
| Proof-envelope profiles and strengths | paper Appendix B | P2 | configured reference, Core-0, Core-A, and Core-0H claims implemented with exact strength gates |
| Static-fragment lowering evidence | paper Appendix B | P2 | allowlisted Core-0/Core-A/Core-0H manifests bind exact upstream generator repository, path, revision, case, program, and trace |
| Core-0H sidecar validation | paper Appendix B | P2 | content-addressed two-phase-handler validation implemented; activation remains disabled because the pinned upstream publishes no trusted sidecar |
| Pinned theorem-artifact metadata | paper Appendix B | P2 | exact paper revision, authority, theorem-name, and external build-gate metadata drift checks implemented; the Lean build is not local |
| Fail-closed claim classification | paper Appendix B | P2 | live prefixes and missing, malformed, unsupported, stale, or untrusted strong evidence remain reference-only after reference validation |
| Runtime/formal non-claim boundary | paper Appendix B | P2 | public frozen envelopes report configured excluded production surfaces; strong imported claims do not imply production-runtime verification |

## Paper experiments and reporting

| Capability | Paper surface | Priority | Planned proof |
| --- | --- | --- | --- |
| Runtime-supervision protocol fidelity | Appendix E | P3 | versioned observation/action schemas, prompts, tools, budgets, and seeds |
| CRO protocol fidelity | Appendix F | P3 | proposer tools, lineage, targeted-eval, handoff, cost, and result artifacts |
| TypeScript-owned performance report | §4 and Appendix C | P3 | raw, reproducible platform/backend benchmarks without inherited claims |
| Paper limitation reporting | Appendix A.1 | P3 | supervisor cost, proof-of-existence, and replay-coupling disclosures |
| Paper future-work register | Appendix A.2 | P3 | interpretability, continual learning, post-training, and safety rows remain classified |

## CLI

| Command family | Priority | Compatibility requirement |
| --- | --- | --- |
| `init` | P0 | configured protected initialization implemented; no silent Git-history mutation |
| `doctor` | P0 | bounded human diagnostics and stable closed JSON implemented |
| `run list/show/trace/trace-revision/changeset` | P0 | configured run/trace reads, distinct trace-revision spelling, authenticated bounded changeset summary/content, and stable machine output implemented |
| `run select/discard` | P0 | exact IDs and consume-once CLI delegation implemented |
| `run apply/release` | P1 | exact IDs and documented settlement CLI delegation implemented |
| `run outputs/output-citations/vcscore` | P1 | validated retained products, raw output citations, native vcs-core evidence, and protocol JSON implemented |
| `run publish-retained-workspace-output` | P1 | exact committed native citation verification implemented; raw missing-cut repair fails closed without managed recovery authority |
| `run repair` | P1 | exact globally idempotent CLI recovery implemented |
| `task list/register/resolve/show` | P1 | list/resolve/show implemented; dynamic source registration fails closed |
| `demo write` | P1 | checked-in `quickstart` fixture and installed-package execution implemented |
| `package init` | P2 | configured honest refusal; reproducible scaffold follows |
| fenced `run start` compatibility | P3 | configured and disabled by default |

## Parity reporting rules

- A feature is not marked complete from unit tests alone; its TypeScript conformance row must pass
  through the production public seam.
- Platform features may be complete only for named platforms.
- Provider features are reported independently per provider.
- Paper parity must never be inferred from `0.3.0` API parity.
- Experimental use cases may depend on the complete substrate without being
  required for the stable core package.
