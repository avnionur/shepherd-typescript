# Shepherd managed coding runtime snapshot

## Architecture

`@cognia/shepherd` is Cognia's single TypeScript authority for tasks, effects, scopes, traces, retained runs and candidates, settlement, replay, and meta-agent decisions. Its kernel has no Electron, React, filesystem, provider-SDK, Python, Docker, or external-service dependency. Desktop adapters provide durable SQLite/content storage, Git placement, provider/tool execution, verification, approvals, and renderer projections.

## Current production profile

At the 2026-07-22 snapshot, the experimental frontend and backend packs opt into `workspace`. A worker runs against a retained Git worktree and cannot change the selected repository before settlement. This profile does not isolate the worker process, network, credentials, or live agent state and cannot restore them. Never describe it as process-isolated or coupled.

The guarded workspace contract requires:

- explicit trust for the exact repository content identity;
- task-derived read/write file scope;
- no generic shell tool for managed workers or supervisors;
- host-registered no-shell verification profiles rather than command strings;
- verification subprocess environments restricted to approved non-secret variables;
- denial of direct network utilities, package installation/mutation, shell interpreters, forged commands, credentials, and undeclared external effects;
- separate approval after executable configuration changes;
- process-tree termination on timeout and bounded output;
- intent-before-outcome recording for model, tool, completion, and settlement boundaries;
- consume-once typed completion that disables later worker effects;
- retained candidates with exact revision-bound preview and separate confirmation;
- post-composition verification plus durable attention-required recovery.

These controls reduce exposure but do not create a security sandbox. Repository-controlled verification code may still use host network availability even when Cognia credentials are removed. Use the workspace profile only for explicitly trusted repository content.

## Host-owned authority

Both pack manifest and application feature flag must opt in. The host derives task, scope, binding, placement, baseline checkpoint, retention, verification profile/command, preview identity, and settlement authority.

A model can request a registered verification profile or settlement action. It cannot supply trusted filesystem roots, executable commands, baseline digests, authority digests, capability handles, or host-held preview objects.

The renderer receives redacted view models only. It may inspect paginated trace records, intent/outcome pairing, actual reversibility, scopes, checkpoints, retained changes, verification, usage/cost, replay history, supervisor decisions, settlement state, and recovery guidance. It must not receive content payload IDs, idempotency keys, repository/worktree paths, credentials, raw supervisor rationale, or authority/capability handles.

## Replay and reversal boundary

Replay modes are explicit: recorded/reused, reexecute, stub, compensate-and-reexecute, or forbid. Live provider calls are recorded effects, not deterministic replay. Workspace settlement is an irreversible managed write with inspectable evidence. External release is unavailable without a separately installed and admitted adapter.

No hard `process-isolated` or `coupled` desktop backend was advertised in this snapshot. Those profiles fail before execution. Do not claim hard isolation or coupled restoration until a backend passes its platform conformance suite. External effects and the host computer are never reversible.

Observability must show the active placement, required `coupled` profile for restoration, and a stable unavailable reason. It must not offer a replay execution action or silently substitute recorded simulation when environment restoration cannot be proved.

## Verification boundary

Use [Shepherd port acceptance boundary](shepherd-port-acceptance.md) for the normative gate list and focused-test evidence map. Required repository gates are strict typecheck, full tests, and desktop production build. A green suite does not override an uncovered negative path or missing placement backend.
