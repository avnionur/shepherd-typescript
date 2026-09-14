# Coupled Checkpoints

Implementation: [`src/replay/session.ts`](../src/replay/session.ts) (`checkpoint`),
[`src/replay/world-image.ts`](../src/replay/world-image.ts),
[`src/replay/processes.ts`](../src/replay/processes.ts),
[`src/replay/analysis.ts`](../src/replay/analysis.ts) (`classifyReplayCheckpoint`), and the internal
world-image helpers of the [reference copy carrier](../src/workspace/reference-copy-carrier.ts).
Public entry point: [`./replay`](../src/facades/replay.ts). Tests:
[`replay-checkpoint.test.ts`](../test/replay/replay-checkpoint.test.ts) and
[`replay-conformance.test.ts`](../test/replay/replay-conformance.test.ts). Schema:
[`replay-checkpoint-v1`](../spec/schemas/replay-checkpoint-v1.schema.json).

## Descriptor

A program calls `context.checkpoint()` at a step boundary. Under the session fence, one
transaction publishes a trace cut through the current head and appends the checkpoint record citing
the cut publication. Repeating the call at the same boundary returns the retained checkpoint. The
descriptor lists every constituent in configured kind order, then by name:

| Constituent | Verified evidence | Otherwise |
| --- | --- | --- |
| `trace_cut` | Receipt is the published cut identity | Never absent |
| `world` (per bound world) | Receipt is the copy-carrier content identity; evidence names the manifest blob and entry count | `unavailable`: configured world-capture reason plus the carrier error code |
| `provider_session` | The adapter's receipt, only when it reports the session's exact context prefix identity | `reconstructive` without an adapter, `not_applicable` without a provider, `unavailable` with the adapter's reason, the configured prefix-mismatch reason, or the configured adapter-failure reason |
| `process` (per bound process) | Receipt is the verified image blob; evidence records backend and byte length | `unavailable` with the probe reason, the configured image-bound reason, or the configured adapter-failure reason |
| `irreversible_effects` | Receipt is the digest of the materialized approval-tier effects before the boundary | Never absent |

`classifyReplayCheckpoint(checkpoint)` derives `atomic` when every constituent is verified or not
applicable, `reconstructive` when some constituent is reconstructive and none is unavailable, and
`unavailable` otherwise, and groups constituents by status. The retained classification must equal
this derivation. Identifiers alone are never proof: rewind and replay re-verify every verified
constituent before use.

All bound worlds are captured at the same quiescent step boundary under one fence, which is the
coordinated multi-resource checkpoint reassigned from Phase 6. The program's in-memory state is
never captured; `atomic` describes external constituents restored from verified captures, and every
branch still re-executes the program over the verified prefix.

## World images

`worlds: [{ name, root }]` binds managed directories that the session's handlers mutate. A capture
double-scans the directory with the reference copy carrier's traversal and metadata policy, re-reads
every regular file against its manifest entry, stores the bytes and the canonical manifest as
content-addressed trace-store blobs, and rescans; any difference or a tree beyond the configured
entry bound fails the capture. The content
identity equals the copy carrier's identity for the same tree, so file bytes, modes, empty
directories, and relative symlink targets are covered and hard links, special files, escaping links,
unsupported metadata, and protected control names fail closed. Capture uses the carrier's host
metadata probes, so a host without the probe tools retains the world as unavailable. Images live in
the trace store, so they survive native export and import. Restoration re-validates the manifest:
entries must be portable, contained, and consistent, must not name protected control paths, and
directories must keep owner read and search permission so the result can be re-verified.

Inspection admits only these constituent forms: worlds and processes verified with their evidence
shape and declared backend or unavailable; the provider session `not_applicable` without a provider
and adapter, `reconstructive` with a provider but no adapter, and verified or unavailable under the
declared adapter; and a frontier whose evidence lists exactly the frontier steps.

## Provider-session adapters

A `ReplayProviderSessionAdapter` has an `adapterId`, a `checkpoint(context)` returning
`{ status: "verified", receiptId, contextPrefixId }` or `{ status: "unavailable", reason }`, a
`restore(receiptId, context)` returning the restored context prefix identity, and an optional
`cacheIdentity(request, contextPrefixId)`. No live provider adapter ships; without an adapter the
provider session is reconstructive, rebuilt from recorded exchanges.

## Process checkpoint backends

A `ReplayProcessAdapter` declares `processId`, a configured `backend`, `probe()`,
`checkpoint(context)` returning image bytes, and `restore(image, context)`.

`createCooperativeProcessAdapter({ processId, command, args?, cwd?, timeoutMilliseconds? })` starts
the named executable without a shell and speaks newline-delimited JSON. Requests carry the configured
protocol version, a message type, and a correlation number: `checkpoint` is answered by `image` with
canonical base64 state, `restore` by `restored` in a freshly started process, and application
`request` messages by `response`; `error` messages fail the request. Every line is bounded by the
configured size and each response by the timeout, and a process that exits, closes its input, fails,
times out, or sends oversized, malformed, uncorrelated, or unexpected messages is killed and replaced
on the next request without an unhandled error reaching the host. The process captures
its own state, so the backend is cooperative. Session programs must reach such a process through
effect handlers so that recorded prefixes do not repeat its side effects.

`createTransparentProcessAdapter({ processId })` probes CRIU. It reports the configured
platform-unsupported reason off Linux, the executable-unavailable reason when `criu` cannot start,
and the check-failed reason with the exit status when `criu check` fails. Replay protocol v1 captures
no transparent images, so a passing check is still reported unavailable with the capture-unsupported
reason, and `checkpoint` and `restore` always fail. On the recorded Linux host (OrbStack,
`node:24-bookworm`, CRIU 3.17.1) `criu check` fails on kernel feature detection, which the adapter
reports accurately.
