# Issue #242 provider checkpoint preservation

Base: 0e4a232 (PR #279,13.5.0). Parent235 active; blocker237 closed. Worktree branch:
`codex/phase-14-242-provider-checkpoints`. MINOR additive 13.7.0; fast-forwarded to main70e21d8 (13.6.0) before release generation.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Verified conversation prefix | provider-conversation.test.ts | High | Exact request bytes, context and cache identity after fresh-process restore |
| Reconstructive fallback | provider-conversation.test.ts | High | Existing rebuild and step-boundary replay remain available |
| Failed/cancelled turns | provider-conversation and live-provider tests | High | Failure advances only context, cancellation changes neither prefix nor messages |
| Tool-prefix fidelity | tool-use-loop and tool-dialects tests | High | Preserve actual system/tool/message data at supported provider seams, not a claimed cache hit |
| Provider/configuration binding | Descriptor + live factory settings | High | Refuse incompatible provider, endpoint, output settings, system and snapshot schema before restore |
| Secrets/retention | live-provider-secrets and retention suites | High | No credential configuration in snapshots; context classification, scanner refusal, redacted export |
| Native persistence/import | SQLite canonical record and archive seams | High | Content addressing, integrity before mutation, missing/corrupt snapshots and imported restore |
| Custom provider adapters | Replay checkpoint and branch suites | High | Existing external receipt adapters retain their documented behavior |
| Distribution and all adjacent behavior | Full gate/package tests | High | API/schema/docs/version, focused tests, full verification and desktop build |

Initial design: persistence is an explicit store-bound mode of createProviderConversation because
retaining the system prompt is a new data-retention capability. The existing process-local mode and
rebuild remain valid. Store snapshots are canonical context records, so append-time secret scanning
and redacted-export policy apply; blobs would bypass those policies. Live-provider configuration is
bound without storing credentials or headers. Custom provider configuration identity must be
explicit where the package cannot infer it. Add a read-only receipt validation seam so retained
snapshot incompatibility is detected before branch compensation/restoration. No external model
state, server KV cache, credentialed cache-hit result or provider-side exactly-once claim.

Before implementation: complete issue, current parent and comments read (242 has no comments).
Read current live-provider, coupled-checkpoint and retention contracts; source conversation,
live/program factories, tool-loop bindings and conversation tests. Store/config/replay seam inventory completed; red/green restart regression recorded below.

Operational verification: use `CI=true caffeinate -i pnpm verify` on this macOS host. Issue241
proved native probe timeouts were caused by idle sleep; this command-scoped assertion changes no
persistent power settings and relaxes no checks. Check fresh main before choosing the final version:
a separate Pi provider-settings worktree exists and may advance main concurrently.

## First slice and forward-reader safety

- Baseline provider conversation, credential exclusion and tool-loop suites:10/10 passed.
- Fresh-process control proves memory receipts fail without reconstruction. New retained-mode test
  was red before implementation (checkpointStore unsupported); it now restores exact wire body and
  chained context across separate processes. Existing conversation tests remain unchanged:5/5 pass.
- Store-bound snapshots use canonical context records and strict provider/configuration/context
  matching. Custom providers require a declared configurationId; configured live factories supply
  a credential-free configuration digest. Public retain/read helpers preserve native message/tool
  blocks for custom adapters. Native tool-prefix production-seam proof passes in separate processes and after native import.
- Actual13.5 binary forward-reader probe reproduced a safety gap with ordinaryv1 replay checkpoint
  metadata: it invoked the real compensator once, deleted rowa, then failed to restore the unknown
  durable receipt. Probe: /private/tmp/shepherd-242-legacy-probe.ts; fixture:
  /private/tmp/shepherd-242-legacy-SySMIM. This unpublished form must not ship.
- Full schema inspection established that the existing replay checkpoint/restore v1 schema already
  defines an extensible semantic evidence map. The smaller final contract uses a mandatory
  snapshot_record_id reference to the separately versioned provider snapshot plus a causal citation.
  Old replay inspectors reject the extra causal/evidence shape before compensation; current readers
  validate it and require receipt validation. No existing v1 schema or record bytes are rewritten.
  This supersedes the initially considered separate checkpoint/restore v2 forms.
- Store-aware validateReceipt preflight already runs after exact request-replay checks and before
  request publication/compensation. Require it for retained-snapshot checkpoint references, validate
  content references in checkpoint inspection, and revalidate receipt/configuration on restore.


## Redaction boundary correction

The actual13.5 exporter treated an unknown snapshot schema as general data and included the unique
system prompt in its redacted archive. Snapshots now use the already supported supervision-context
record envelope, with a versioned provider-checkpoint payload in data, a private content-derived
channel and the adapter as producer. Old exporters already redact the entire context body,
including after native import. The existing context-data quota (65,536 canonical UTF-8 bytes)
remains authoritative; snapshots refuse oversized prefixes rather than truncate or widen an
unrelated security limit. Native exports remain sensitive complete backups. Negative and N-1 redaction verification now pass.


## Final slice evidence

- Seven new suites, 14 tests: restart/import exact request bytes and context; native tool-use/result,
  definitions and system at the actual tool-loop/live-transport seam; incompatible provider settings
  before real compensation; credential rotation; snapshot identity/schema/owner corruption refusal;
  canonical bounds and scanner refusal; pending turns, failure context and cancellation. Both
  independent spec and standards reviewers reran the original 13 successfully with no actionable findings.
- Retained snapshot test also scans all fixture files after close for the configured credential;
  native export excludes it, and current redacted exports omit the system prompt.
- Repeatable N-1 fixture: `node test/fixtures/provider-checkpoint-legacy-reader.ts
  /private/tmp/shepherd-typescript-241/dist` using the verified13.5.0 binary. Reopen and native import
  both refuse before compensation, preserve external rowa and produce redacted exports without
  system content. Recorded fixture: `shepherd-provider-checkpoint-legacy-b4NiyX` in the host tempdir.
- Early `pnpm build`, `pnpm typecheck`, and `pnpm test:package-cli` passed, including installed
  declaration/browser boundaries. Version13.7.0 sync, generated schema/API/SBOM/inventory and six
  explicitly additive API classifications are prepared. No dependency or lockfile delta in this slice.
- Focused coverage reaches100% lines/branches/functions in all new provider runtime modules and
  conversation integration. An initial broader focused run was refused on loopback EPERM by the
  sandbox; it is being rerun with approved access. The approved broader run passed 164 tests with one intentional live-provider skip.


## Delivery verification

- Final `PATH=/Users/avnionur/.nvm/versions/node/v24.17.0/bin:$PATH CI=true caffeinate -i pnpm verify`
  passed: 1,418 tests, 1,416 passed, two intentional skips, zero failures, 100% lines/branches/functions;
  protocol, evaluation, SBOM, API, inventory, compatibility, lint, typecheck and installed-package
  gates passed. Log: `/private/tmp/shepherd-242-verify-final.log`.
- First full run failed two stale provider-v3 equality expectations and uncovered refusal branches.
  Expectations now pin the additive v4 contract; an additional forged-evidence test exercises the
  refusal paths. No assertion was removed/weakened and no threshold or timeout changed.
- The two skips remain the credentialed live-provider probe and unsupported telemetry-input fuzzer.
  No platform-specific runtime code was added; native/file/persistence evidence is from this macOS
  host. No credentialed cache, external proof, Windows or additional live-provider claim.
- Preservation skill re-read before completion. Every high-risk matrix row is covered by the tests
  above, unchanged adjacent suites, installed-package validation or the repeatable actual old-binary drill.
