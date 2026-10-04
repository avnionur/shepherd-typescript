# Issue #241 reconciliation preservation

Base: 4e41ddd (PR #277), rebased from e794508 (PR #276). Parent235 active; blocker240 closed. Isolated branch
codex/phase-14-241-compensation-reconciliation. MINOR 13.5.0: additive operator recovery APIs and optional inspection metadata.

| Capability | Existing evidence | Risk | Required verification |
| --- | --- | --- | --- |
| Failed/uncertain compensation recovery | compensation and ownership suites | High | Explicit audited retry/verified-completion/accepted-unresolved; no forged handler result |
| Operator authorization | New public boundary | High | Package-created authority with application authorization; clone/denial/change refusal before writes |
| Active attempt fencing | #240 atomic admission/outcome | High | Resolution and admission serialize; active holders block decisions; stale basis conflicts |
| Command identity | Existing globally keyed append intents | High | Exact repeated command replays; different actor/target/disposition/evidence refuses |
| Uncertain materialization | Replay admission/failed-step and dispatch evidence | High | Exact evidence identity, no invented success, no silent external execution |
| Residual risk | Scope/run/replay inspection | High | Accepted-unresolved stays visible and never becomes compensated; reopen/import retain audit |
| Trigger semantics | discard/rewind/replay/explicit compensation | High | Authorized dispositions honored, ordinary order/keys/results unchanged |
| Store/protocol/distribution | Full gates | High | Concurrent processes, fresh process, malformed evidence, immutable audit schema, package/build/docs |

Design boundary: operator authorization is supplied by the trusted host application and bound to
an immutable exact decision; merely passing an actor string is insufficient. Verification of
external completion is a separate explicit host-policy check. Audit dispositions never fabricate
a successful EffectOutcome or invoke external work implicitly. Retry authorizes a later safe
retry; uncertain materialization does not become a successful materialization through a retry
record. Accepted-unresolved carries residual risk. Resolution uses a separate append-only audit
path, preserving existing compensation record bytes and outcome classifications.

Preflight read the full issue, parent, linked contracts, compensation/ownership resolver and
scope/replay/durable inspection paths. Focused regression and independent runtime reviews passed;
full host verification passed.

## Implementation contract

- Separate canonical audit paths keyed by original effect evidence, with a second command-owner
  occurrence for global command idempotence and a mandatory third occurrence on the compensation
  owner to fence older archive readers. Schema15 adds a reader boundary without a new table: current audit heads come from
  canonical owner paths; writes compare source/compensation/audit heads and active leases inside
  the same SQLite transaction used by compensation admission.
- Trusted host authority handles bind actor and policy identity to authorization and independent
  external-completion verification callbacks. Replays reauthorize the same request but never
  repeat external work or re-run completion verification. Changed request fields conflict.
- Existing compensation statuses and handler outcomes remain factual. Optional reconciliation
  metadata explains why a failed/pending compensation is no longer automatically retried after
  accepted-unresolved or externally-verified completion. Retry records authorize later existing
  safe retry paths; they never turn uncertain materialization into a successful outcome.
- Resolve successful/failed replay steps, pending replay admission identity and supervised
  admission/resolution evidence. Recorded replay copies normalize to original evidence. Unknown
  pending replay intent payloads stay unavailable; hashes are not fabricated into full intents.
- Optional residual-risk lists on run/replay/scope inspections are computed from retained causal
  citations and execution-associated scopes, and appear only when risk exists. New read helpers
  depend on low-level audit codecs, not recursive runtime inspection, to avoid dependency cycles.
- Current audit metadata is a read projection and does not rewrite original outcomes, terminal
  cuts or reference-proof evidence. Imported audit records are retained assertions under the
  existing trusted-import boundary, not a fresh authorization grant or cross-store lease.

## Safety findings resolved during review

- Global audit scans originally capped every store at 1,024 targets, including unrelated completed
  incidents. The public isolation regression first reproduced refusal of an unrelated execution.
  The reader now traverses relevant causal evidence and pages execution-associated scopes, bounding
  actual unresolved output. Tests retain 1,025 resolved audits, 1,025 associated scopes, and 1,025
  accepted incidents; exact incident resolution remains available when aggregate views exceed limits.
- A real 13.3.0 binary originally ignored accepted-unresolved decisions on separate audit paths:
  one handler invocation deleted the real fixture row. Store schema15 now refuses that writer.
  Mandatory compensation-owner guards also make the old reader refuse imported native archives.
  Checked-in repeatable drill: `node test/fixtures/reconciliation-legacy-reader.ts <legacy-dist>`.
  Legacy build: e794508639902d64f350e4621fb5cf2cc0b8e701 /13.3.0. Node24.17.0/macOS arm64:
  both refusals pass, zero legacy handler calls, original row retained.

## Verification evidence

- Public source/authority/trigger tests preserve failed outcomes, verify external SQLite state,
  prove retry alone does no work, and retain accepted risk through discard/rewind/run/scope/import.
- Separate-process tests cover equal/different competing commands, changed-request conflicts,
  real SIGKILL before/after publication and after uncertain materialization, and fresh-process replay.
- Malformed evidence tests refuse missing guards, source/command citations, malformed configuration,
  copied authority, denied policy, missing evidence, stale bases and overflowing decision histories.
- Existing compensation/ownership tests plus new reconciliation tests: initial focused31/31 passed.
  Additional source-normalization, negative-evidence and N-1 binary drills pass.
- Standards and Spec independent runtime reviews report zero remaining actionable findings.
- Dependency/lockfile diff: none. Store migration15 is marker-only; the populated fixture15 export
  digest matches fixture14, preserving historical records and operational table rows.
- Final combined-main `CI=true caffeinate -i pnpm verify`: 1,402 passed, two intentional skips,
  zero failures, 100% lines/branches/functions, installed-package declarations, examples and CLI
  passed. Final version synchronization and `pnpm build:desktop` passed.

No new live-provider, remote-host, Linux-native, Windows or proof-backed result is claimed.
Imported audits remain host assertions; separate stores do not share invocation ownership.

Before integration with PR #277, `CI=true pnpm verify` passed end-to-end: 1,401 passed,
two intentional skips, zero failures, 100% line/branch/function coverage and packaged CLI checks.
Log: `/private/tmp/shepherd-241-verify-complete.log`. A shipped configuration type was initially
stripped by an internal annotation; package validation exposed it, and corrected declarations now
compile in the installed package. Final combined-main verification passed.

## Final delivery review

- Full final log: `/private/tmp/shepherd-241-verify-awake.log` (exit 0).
- Earlier integrated parallel and serial attempts hit native metadata `ETIMEDOUT` after macOS idle
  sleep. Power logs matched the long stalls; both isolated serial failures then passed in seconds.
  A temporary command-scoped `caffeinate -i` assertion kept the host awake for the successful full
  gate. No test, timeout, threshold, permanent power setting or native check was weakened.
- Intentional skips remain the opt-in live-provider cache experiment and the non-applicable
  telemetry-input fuzzer (there is no telemetry decoder). Neither is evidence for this capability.
- Standards: zero actionable findings. Spec: zero actionable findings. Capabilities: every high-risk
  row has production-seam tests or the repeatable actual 13.3 reader drill. Final integration review
  confirmed preservation of PR #277's Pi examples, guide, package inclusion and 13.4 changelog.
- The root checkout's unrelated work was not modified. #242 is the next unblocked P1 issue.
