# Placement resolution and reporting

Implementation:
[`src/workspace/placement.ts`](../src/workspace/placement.ts) and
[`src/workspace/placement-types.ts`](../src/workspace/placement-types.ts).
Persisted evidence decoder:
[`src/protocol/placement-evidence.ts`](../src/protocol/placement-evidence.ts).
Execution integration:
[`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts).
Public exports: [`src/index.ts`](../src/index.ts). Tests:
[`test/workspace/placement-resolution.test.ts`](../test/workspace/placement-resolution.test.ts),
[`test/workspace/placement-schema-contract.test.ts`](../test/workspace/placement-schema-contract.test.ts),
and [`test/workspace/task-world-placement.test.ts`](../test/workspace/task-world-placement.test.ts).

## Platform evidence

`createPlacementPlatformEvidence()` classifies one explicit execution-environment probe. Its
closed input contains the Node platform spelling, OS release text, and names of present environment
variables. Values of environment variables are never read or retained. The configured WSL marker
names and release pattern distinguish WSL from native Linux.

```ts
const platform = createPlacementPlatformEvidence({
    nodePlatform: "linux",
    osRelease: "5.15.153.1-microsoft-standard-WSL2",
    environmentVariables: ["WSL_DISTRO_NAME", "WSL_INTEROP"],
});
```

`inspectLocalPlacementPlatformEvidence()` supplies the current Node host probe using
`process.platform`, `os.release()`, and environment-variable names. Explicit probe construction is
the injectable classification boundary for deterministic platform fixtures and future remote
placement adapters. The current local placed-execution API accepts only evidence returned by local
inspection; caller-declared synthetic evidence cannot be attached to the in-process runner.

| Node/platform evidence | Family | Environment |
| --- | --- | --- |
| `darwin` | `macos` | `native` |
| `linux`, no WSL evidence | `linux` | `native` |
| `win32` | `windows` | `native` |
| `linux`, configured WSL marker/release | `windows` | `wsl` |
| any other Node spelling | `unsupported` | `unsupported` |

The complete classification is immutable and content addressed. Environment-variable declaration
order does not affect identity. Changed Node platform, OS release, WSL markers, classification, or
protocol version changes `platform_id`.

## Requested and resolved placement

`createGrantedPlacementResolution()` binds a placement request to the exact grant plan, task
artifact, runner, durable run, capture, and platform evidence.

```ts
const placementResolution = createGrantedPlacementResolution({
    captureId: "capture:review:1",
    placement: "auto",
    platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
```

Workspace protocol v22 defines the current resolution table entirely in `protocol.config.json`:

| Requested | Status | Resolved | Actual enforcement | Reason |
| --- | --- | --- | --- | --- |
| `advisory` | `resolved` | `advisory` | `advisory` | `requested-advisory` |
| `auto` | `resolved` | `advisory` | `advisory` | `auto-fallback-unavailable` |
| `jail` | `refused` | none | none | `explicit-jail-unavailable` |

No jail backend is available in this protocol. Therefore `auto` cannot resolve to jail, and
explicit `jail` returns no resolution artifact. Adding a native backend requires a later protocol
version, launcher evidence, platform-gated denial tests, and fail-closed explicit-jail behavior.
`PlacementUnavailableError` exposes the configured refused request, status, reason, and placement
protocol version without fabricating effective-placement evidence.

## Placed granted execution

`capturePlacedGrantedTaskWorldDurably()` and `recoverPlacedGrantedTaskWorldDurably()` are additive
public APIs over Phase 4:2 granted execution. They require an authenticated placement resolution
whose grant plan, runner object, run ID, and capture ID exactly match the execution options.
For the current local runner, the resolution must also derive from locally inspected platform
evidence. Synthetic platform fixtures are classification evidence only, not execution-host claims.

The prepared journal is retained before runner/provider invocation. It contains the complete
placement resolution and `resolution_id` beside the exact repository grant plan. The returned
`PlacedTaskWorldCaptureResult` carries that same placement evidence. Forged handles or changed
request, platform, plan, runner, run, or capture fail before invocation.

Workspace protocol v22 publishes new attempts under
[`world-capture-journal-v3.schema.json`](../spec/schemas/world-capture-journal-v3.schema.json),
journal version 11. Writer selection is part of the public API contract: ordinary capture continues
writing v1/version 9, unplaced granted capture continues writing v2/version 10, and only placed
granted capture writes v3/version 11. Readers bind these schema/version pairs exactly.

Fresh-process recovery reconstructs and rehashes the complete platform and placement descriptors,
authenticates newly created package handles, and requires exact equality with prepared evidence.
Malformed or cross-version evidence fails closed.

## Security boundary

`resolved_placement: "advisory"` means the existing invocation-fenced in-process capability seam.
It is not an OS sandbox. This slice does not create a child process, install Seatbelt or Landlock,
claim syscall denial, prove process quiescence, or expose a simultaneous multi-world callback.
Platform classification reports where an adapter says execution occurs; only a later authenticated
launcher can support a jailed effective placement.

## Conformance boundary

| Contract | Evidence |
| --- | --- |
| macOS/Linux/native-Windows/WSL/unsupported classification | Injected public platform matrix |
| Probe ordering is identity-neutral | Reordered WSL-marker fixture |
| Advisory request is explicit | Resolution fixture |
| Auto fallback is visible | Resolution and placed-capture fixtures |
| Explicit jail fails without evidence | Public resolution rejection |
| Forged placement refused pre-invocation | Placed capture fixture |
| Prepared evidence exists before runner execution | Runner-side journal inspection |
| Changed request/platform recovery refused | Recovery mismatch matrix |
| Exact same-process replay | Committed recovery fixture |
| Exact fresh-process replay | Child-process recovery fixture |
| V1/v2 journals and unplaced execution preserved | Existing task-world/grant suites |

Pinned upstream evidence and TypeScript-owned limits are recorded in
[`../.plan/placement-research.md`](../.plan/placement-research.md).
