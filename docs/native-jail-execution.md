# Native jail execution

Implementation: [`src/workspace/native-jail.ts`](../src/workspace/native-jail.ts). Public types:
[`src/workspace/native-jail-types.ts`](../src/workspace/native-jail-types.ts). Persisted evidence
decoder: [`src/protocol/native-jail-evidence.ts`](../src/protocol/native-jail-evidence.ts).
Execution integration:
[`src/workspace/task-world-execution.ts`](../src/workspace/task-world-execution.ts). Tests:
[`test/workspace/native-jail.test.ts`](../test/workspace/native-jail.test.ts) and
[`test/workspace/native-jail-schema-contract.test.ts`](../test/workspace/native-jail-schema-contract.test.ts).

Workspace protocol v23 adds authenticated local native-jail adapters without changing placement
v1 or task-world journal v1-v3 identities. `inspectLocalNativeJailBackend()` selects only a backend
configured for the inspected Node platform/environment and returns content-addressed available or
unavailable evidence. Availability requires a real canary profile that permits a write beneath the
declared writable root and denies a sibling write. Executable presence alone is insufficient.

| Host | Backend | Support rule |
| --- | --- | --- |
| native macOS | Seatbelt | `/usr/bin/sandbox-exec` must install the profile and pass the real allow/deny probe |
| native Linux | Landlock | a configured C compiler, Landlock-capable kernel, helper integrity, and the real denial probe must pass |
| WSL | Landlock | supported only when the Linux Node platform, WSL environment classification, helper build, kernel probe, and denial test all pass |
| native Windows | none | explicitly unavailable; no AppContainer claim |
| other platforms | none | explicitly unavailable |

The Landlock adapter compiles a small package-owned helper from fixed source using structured
compiler arguments. The probe retains the exact helper executable digest. Each launch recompiles
the helper in a private temporary directory and requires the digest to match before retaining
launch authority or starting the judged command. A missing compiler, blocked syscall, incompatible
headers/kernel, or digest mismatch fails closed.

## Admission and placement

`createNativeJailRunner()` accepts an authenticated successful probe, a canonical absolute
executable, literal arguments, an explicit environment, output bounds, timeout, and runner ID.
It never creates a shell and does not inherit ambient environment variables. A copied probe or
runner handle is rejected. `NativeJailUnavailableError` carries the exact unavailable probe reason
before runner/provider execution.

`createNativeJailPlacementResolution()` binds `jail` or `auto` to the exact local probe, backend,
command, output/timeout bounds, runner, repository grant plan, task artifact, run, and capture. `auto` can resolve to
native `jail` only through this authenticated successful-probe path. When no native runner can be
admitted, the unchanged placement-v1 `auto` resolver remains the visible advisory fallback.

```ts
const probe = await inspectLocalNativeJailBackend();
const runner = createNativeJailRunner({
    command: {
        executable: "/absolute/path/to/judged-command",
        arguments: ["--structured", "argument"],
        environment: [{ name: "LANG", value: "C" }],
    },
    maxOutputBytes: 65536,
    probe,
    runnerId: "runner:native:1",
    timeoutMilliseconds: 30000,
});
const nativeJailResolution = createNativeJailPlacementResolution({
    captureId: "capture:review:1",
    placement: "jail",
    platform: probe.platform,
    repositoryGrantPlan,
    runId: "run:review:1",
    runner,
});
const result = await captureJailedGrantedTaskWorldDurably({
    ...grantedCaptureOptions,
    nativeJailResolution,
    runner,
});
```

## Grant lowering and native boundary

The confinement plan is created only after exact isolated custody exists. If the selected
repository grant contains effective `write`, the single canonical custody root is writable. A
read-only effective grant produces no writable root. Seatbelt lowers this to deny-all file writes
plus one allow-subpath rule per writable root. Landlock installs write-related path-beneath rules
before `exec`; an empty ruleset denies every managed write. Canonical roots and native path
resolution deny sibling, ungranted, read-only, and symlink-alias escape writes.

The complete confinement plan and profile digest are retained in the launch intent before process
start. Seatbelt receives the profile as a literal argument, not a writable file. Landlock applies
its rules inside the package helper before replacing itself with the judged executable. The judged
process therefore cannot edit the profile/helper through its granted custody root.

## Process evidence and recovery

The launcher retains an intent before spawn, start evidence after the OS reports a PID, and one
terminal receipt after output settlement and process-group quiescence. Receipts classify ordinary
exit, cancellation, timeout, output-limit termination, launch failure, and uncertain quiescence.
Standard output/error are bounded, base64-encoded, and byte-counted. The process is created as a
separate process group; cancellation, timeout, output overflow, and post-exit cleanup use the
configured kill signal. Capture/provider execution continues only for exit code zero with proven
quiescence.

Native attempts use world-capture journal v4/version 12. The prepared transition retains the exact
native resolution beside the unchanged repository grant plan and nullable placement-v1 fields.
Process records use the generated native-process v1 schema. Ordinary, unplaced-granted, and
advisory-placed writers remain v1/9, v2/10, and v3/11 respectively.

Recovery reconstructs and rehashes the complete backend, probe, command, resolution, confinement
plan, process, grant, task, runner, run, and capture evidence. A committed result reopens in the
same or a fresh process without relaunch. Once launch intent exists, missing terminal process
evidence is treated as uncertain external work and is never retried automatically, even if the
caller believes the old process ended.

## Threat boundary

The jail enforces filesystem write placement for the judged command and descendants. It is not a
VM, container, secret broker, network sandbox, or read-isolation boundary. Landlock in this slice
governs filesystem writes only. The Seatbelt profile also leaves reads and network behavior at the
host default. Provider/model execution occurs in the parent only after the judged filesystem
command succeeds and becomes quiescent. Simultaneous multi-binding custody, native Windows,
AppContainer, remote/cloud placement, and hostile same-user replacement of the running host remain
outside this contract.
