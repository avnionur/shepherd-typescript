# Application manifests and protocol identity

Implementation: [`src/applications/manifest.ts`](../src/applications/manifest.ts),
[`src/applications/records.ts`](../src/applications/records.ts),
[`src/applications/errors.ts`](../src/applications/errors.ts), and
[`src/store/application-records.ts`](../src/store/application-records.ts). Public entry point:
[`src/facades/applications.ts`](../src/facades/applications.ts) (`./applications`), with root
exports from [`src/index.ts`](../src/index.ts). Configuration: the `applications` section of
[`protocol.config.json`](../protocol.config.json) (see
[protocol configuration](./protocol-configuration.md)). Generated schema:
[`application-manifest-v1.schema.json`](../spec/schemas/application-manifest-v1.schema.json).
Tests: [`application-manifest.test.ts`](../test/applications/application-manifest.test.ts). Design
constraints: [research applications contract](../.plan/research-applications-contract.md).

## Protocol definitions

An application protocol definition pins everything a run depends on besides the store. It is a
plain data object of exactly these keys:

| Key | Meaning |
| --- | --- |
| `kind` | A configured application kind (`APPLICATION_KINDS`) |
| `protocolVersion` | Caller version text, retained verbatim |
| `surfaces` | Ordered `{ id, kind, role, content }` entries; `kind` is `prompt`, `schema`, or `tool`; identities are distinct |
| `budgets` | Non-negative integer budgets by non-empty metric name; the application interprets the keys |
| `seeds` | Distinct safe integers, in declared order |
| `dataset` | `{ id, revision, items }` with distinct item identities |

`readApplicationProtocol(value)` validates an untrusted definition and returns its canonical frozen
form. It refuses unknown keys, unknown kinds and surface kinds, duplicate surface identities,
non-integer budgets and seeds, and anything over `APPLICATION_LIMITS` (`maxSurfaces`, `maxSeeds`,
`maxDatasetItems`, and the per-kind canonical byte bounds `maxPromptBytes`, `maxSchemaBytes`, and
`maxToolBytes`). Every refusal is `ApplicationProtocolError` (`APPLICATION_PROTOCOL_INVALID`) with
the validation failure as its in-memory cause.

`applicationProtocolId(definition)` is the digest of the canonical definition under the configured
`application-protocol:sha256:` prefix. A run under a different definition, including a different
`protocolVersion`, is a different protocol.

Experiment definitions live in repository configuration, never in `src/`: the Appendix E
supervision protocol is [`config/research-applications.config.json`](../config/research-applications.config.json),
read by the tests. The runtime reads only the definition the caller passes.

## Application identity and reserved owner paths

`deriveApplicationOwnerId(commandId)` derives the application identity
(`application:sha256:` over the caller's globally idempotent command identity). The identity is the
application's reserved owner path. General appends and cut publication onto an owner path with the
application prefix are refused by the trace store; only application command transactions write
there, each comparing the exact owner head before appending.

## Manifests

`createApplicationManifest({ applicationId, protocol, artifacts, costs })` builds the canonical
manifest of one run:

| Field | Meaning |
| --- | --- |
| `manifest_id` | `application-manifest:sha256:` over the manifest body without this field |
| `manifest_version`, `compatibility_version` | Configured `APPLICATION_MANIFEST_VERSION` and `APPLICATION_COMPATIBILITY_VERSION` |
| `kind`, `application_id`, `protocol_id`, `protocol_version` | The run's kind, identity, and protocol identity |
| `surfaces` | `{ id, kind, role, digest }` per protocol surface; content is cited by digest, never embedded |
| `budgets`, `seeds`, `dataset` | Retained verbatim from the protocol |
| `artifacts` | `{ artifact_id, role, digest, record_id, cut_id }`; `artifact_id` is `application-artifact:sha256:` over the citation, `digest` covers the artifact's canonical content |
| `costs` | Measured `provider_calls`, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `cost_usd` |

`cost_usd` is null when any observed usage reported no cost, including a live replay provider call
that failed before a response and so retained no usage. Costs are folded from observed usage,
never estimated. The same protocol, artifacts, and costs always yield the same manifest identity,
so seeded runs over the same inputs produce identical manifest digests.

`validateApplicationManifest(value)` validates an untrusted document and re-derives the manifest
identity and every artifact identity; a mismatch or malformed document is
`ApplicationEvidenceError` (`APPLICATION_EVIDENCE_INVALID`).

## Retention and inspection

`retainApplicationManifest(store, { manifest })` retains one `shepherd.application.manifest.v1`
record on the application owner path and publishes the terminal application cut through it in the
same transaction. Every cited artifact record must already be retained and becomes a causal parent
after the current application head. Repeating the command with the same manifest returns the
retained receipt; an owner path that already retains a different manifest, an unretained cited
record, or a moved head is `ApplicationEvidenceError`.

`inspectApplicationManifest(store, applicationId)` reads the retained manifest without mutation and
validates that exactly one manifest record exists, that it names the owner path, and that the
terminal cut runs through it. Inspection returns identical results on the writing store, a reopened
or read-only store, and a store that imported the trace archive.

## Errors

| Class | Code | Raised when |
| --- | --- | --- |
| `ApplicationProtocolError` | `APPLICATION_PROTOCOL_INVALID` | A definition is malformed, lacks a surface or budget the application needs, or differs from the retained one |
| `ApplicationBudgetError` | `APPLICATION_BUDGET_EXCEEDED` | A call would exceed a protocol budget or bound, such as the [Tree-RL](./tree-rl-rollouts.md) fork-point, branch, and rollout limits; nothing is written by the refusal |
| `ApplicationEvidenceError` | `APPLICATION_EVIDENCE_INVALID` | Retained or supplied evidence is absent, malformed, or inconsistent |
| `ApplicationVerificationError` | `APPLICATION_VERIFICATION_FAILED` | A verifier or evaluator threw or returned a malformed verdict, as in the [counterfactual optimizer](./counterfactual-optimization.md) and [trajectory compression](./trajectory-compression.md) |

All four extend `TraceStoreError` and are classified by `isPublicError`. Option shape errors remain
`TypeError`.

The [coding supervisor](./coding-supervisor.md) is the first application that retains a manifest;
the [counterfactual optimizer](./counterfactual-optimization.md) is the second,
[trajectory compression](./trajectory-compression.md) is the third, and the
[Tree-RL adapter](./tree-rl-rollouts.md) is the fourth. [Application evaluation](./application-evaluation.md)
cites each run's manifest, protocol identity, seeds, dataset, and measured costs in its report.
