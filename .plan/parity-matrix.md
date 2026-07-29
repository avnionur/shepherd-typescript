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
| Bodyless task contract | shipped via retained run | core | P0 | static provider end-to-end test |
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
| Typed effect records | shipped | core | P0 | canonical serialization vectors |
| Intent/outcome correlation | trace machinery | explicit | P0 | ordering and uniqueness properties |
| Immutable append stream | shipped | core | P0 | mutation/refusal and digest tests |
| In-process handlers | shipped but narrowly documented | core | P1 | handler law suite |
| Non-perturbing observation | limited public surface | explicit | P2 | identical worker trace with/without observer |
| Pre-materialization interception | not productized | explicit | P2 | deny/replace/timeout race suite |
| Custom effect families | architectural | explicit | P2 | registry and unknown-record round trip |
| Reversible tier | partial world behavior | explicit | P1 | rollback fixture |
| Compensable tier | not public product surface | explicit | P2 | idempotent compensation fixture |
| Irreversible tier | auditable | explicit | P1 | no false rollback claims |

## Runs, traces, and kernel

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Durable run ledger | shipped | required | P0 | restart persistence tests |
| Success/failure/exhausted/cancelled outcomes | documented | required | P0 | exhaustive state fixtures |
| Artifacts and usage | documented | required | P1 | persistence and export fixtures |
| Content-addressed record identity | vNext reference | explicit sharing | P0 | canonical hash vectors |
| Atomic append batches | vNext reference | required | P0 | crash/fault injection |
| Idempotent append intent | vNext reference | required | P0 | retry conflict tests |
| Owner/cut/slice addressing | vNext reference | graph access | P1 | projection fixtures |
| Trace query and materialization | shipped | core | P1 | CLI/API golden output |
| Live trace subscription | not public complete | explicit | P2 | backpressure/reconnect tests |
| Arbitrary rewind | not public API | explicit | P2 | byte-equivalence tests |
| Suffix replay | deferred | explicit | P2 | deterministic and provider-cache tests |
| Export/import | upstream package exists | useful | P1 | ATIF/JSONL round trips |

## Worlds, scopes, and settlement

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Workspace initialization/adoption | shipped | substrate | P0 | empty/Git/worktree fixtures |
| Named disjoint bindings | shipped | scope binding | P0 | overlap refusal tests |
| Retained world output | shipped | compatible | P0 | working tree remains unchanged |
| Read-only changeset | shipped | required | P0 | file/mode/delete/symlink fixtures |
| `select` fast-forward settlement | shipped | merge analogue | P0 | moved-basis refusal tests |
| `apply` path-disjoint three-way settlement | shipped | merge analogue | P1 | overlap matrix |
| `release` | shipped | scope handoff analogue | P1 | custody transition fixtures |
| `discard` | shipped | core | P0 | parent/worktree equivalence |
| Consume-once settlement | shipped | required | P0 | concurrent CAS tests |
| Scope `emit/fork/merge/discard` | lower layers/current work | core | P2 | algebraic law suite |
| Nested/concurrent scopes | future/current lower layer | explicit | P2 | isolation and race suite |
| Agent + environment atomic fork | research substrate | explicit | P2 | coupled checkpoint fixture |
| Process checkpoint/resume | research substrate | explicit | P2 | platform-gated continuation suite |
| Storage sharing by divergent suffix | research substrate | explicit | P2 | disk scaling benchmark |

## Permissions, placement, and safety

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Runtime permission descriptors | shipped | required | P0 | schema and API tests |
| `ReadOnly`/`ReadWrite` per binding | shipped | required | P0 | matrix tests |
| Whole-run permission ceiling | shipped | useful | P1 | attenuation property |
| Deny by default | shipped | required | P0 | undeclared write refusal |
| Advisory placement | shipped | useful | P0 | honest metadata tests |
| Auto placement | shipped | useful | P0 | resolution matrix |
| Jail placement fails closed | shipped | safety critical | P1 | unsupported/jail-failure tests |
| macOS Seatbelt | shipped | platform | P1 | macOS CI |
| Linux Landlock/container jail | shipped | platform | P1 | privileged Linux CI |
| Windows/WSL policy | WSL advised | platform | P1 | documented detection tests |
| Capability attenuation/delegation | not complete | meta-agent need | P2 | no-amplification property |
| Irreversible-effect approval gate | research direction | safety need | P2 | interception tests |

## Providers and higher-order behavior

| Capability | Upstream 0.3 | Paper/vNext | Priority | Planned proof |
| --- | --- | --- | --- | --- |
| Deterministic/static provider | shipped | testing need | P0 | offline golden tests |
| Claude CLI provider | shipped path | examples | P1 | opt-in integration test |
| Codex provider | claimed by project materials | examples | P1 | opt-in integration test |
| OpenRouter/provider adapter | claimed via Claude path | examples | P2 | contract test |
| Provider-neutral event model | architectural | core | P0 | fake-provider TCK |
| Provider prompt/cache identity | research | replay need | P2 | prefix identity tests |
| Cancellation and budgets | run model | required | P1 | race and exhaustion tests |
| Runtime supervisor | not public productized | case study | P2 | two-worker conflict scenario |
| Inject/steer | experimental/case study | case study | P2 | ordered-context mutation test |
| Handoff/redirect | experimental/case study | case study | P2 | ownership transition test |
| Discard/revert worker | experimental/case study | case study | P2 | restart-from-clean-fork test |
| Counterfactual replay optimizer | experiment | case study | P3 | reproducible small benchmark |
| Tree-RL fork integration | experiment | case study | P3 | adapter and synthetic rollout test |

## CLI

| Command family | Priority | Compatibility requirement |
| --- | --- | --- |
| `init` | P0 | backend/adopt selection and no silent Git-history mutation |
| `doctor` | P0 | human and stable JSON output |
| `run list/show/trace/changeset` | P0 | selectors for reads; stable machine output |
| `run select/discard` | P0 | exact IDs and consume-once behavior |
| `run apply/release` | P1 | exact IDs and documented settlement semantics |
| `run outputs/output-citations/vcscore` | P1 | protocol-versioned JSON |
| `run repair` | P1 | idempotent recovery |
| `task list/register/resolve/show` | P1 | artifact lock and grant display |
| `demo write` | P1 | checked-in, tested examples |
| `package init` | P2 | reproducible extension scaffold |
| fenced `run start` compatibility | P3 | disabled by default |

## Parity reporting rules

- A feature is not marked complete from unit tests alone; its TypeScript conformance row must pass
  through the production public seam.
- Platform features may be complete only for named platforms.
- Provider features are reported independently per provider.
- Paper parity must never be inferred from `0.3.0` API parity.
- Experimental use cases may depend on the complete substrate without being
  required for the stable core package.
