# Retained device-layer worlds

Normative from 13.8.0, issue [#243](https://github.com/avnionur/shepherd-typescript/issues/243).
Public entry: root and [`./workspace`](../src/facades/workspace.ts). Implementation:
[`retained-device-layer.ts`](../src/workspace/retained-device-layer.ts),
[physical ownership](../src/workspace/retained-device-physical.ts),
[durable filesystem receipts](../src/workspace/retained-device-files.ts), and
[store serialization](../src/store/device-layer-journals.ts). Protocol: workspace v29,
`workspaces.deviceLayers.retained` in [`protocol.config.json`](../protocol.config.json),
with the [lifecycle v1 schema](../spec/schemas/device-layer-lifecycle-v1.schema.json).

## Create and reopen

```ts
import {
    openRetainedDeviceLayerWorld,
    reopenRetainedDeviceLayerWorld,
} from "@avnionur/shepherd-typescript/workspace";
import { SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";

using store = new SQLiteTraceStore("trace.sqlite");
const world = await openRetainedDeviceLayerWorld(store, {
    commandId: "create-worker-world",
    root: existingPrivateParent,
    adapter: "copy",
    seed: existingSeedDirectory,
});
await world.writeFile("notes.txt", Buffer.from("first"));
const checkpoint = await world.checkpoint({ commandId: "capture-first", name: "first" });
// checkpoint.recordId is durable completion evidence; contentId identifies the frozen manifest.
const deviceId = world.deviceId;
await world.close(); // Detach this handle; retain the world.

// In another process, reopen the original database file and use the retained deviceId.
const reopened = await reopenRetainedDeviceLayerWorld(store, { deviceId });
await reopened.restore({ commandId: "restore-first", name: "first" });
await reopened.cleanup({ commandId: "cleanup-worker-world" });
```

Creation and handle operations require a writable, file-backed local trace store and an existing
caller-owned parent directory. Use inspection for a read-only store.
The resource root has a fresh private name; a conflicting creation command, overlapping seed,
unknown directory, unsupported adapter or unsafe ownership refuses. `close` only detaches this
retained handle. The existing [scratch API](./device-layers.md), `openDeviceLayerWorld`, keeps its
process-scoped behavior, custom adapters, fallback selection and destructive `close` unchanged.

`deriveRetainedDeviceLayerId(commandId)` lets the caller retain the device selector before creation,
including for diagnosis when creation is interrupted before returning a handle.

Checkpoint and restore commands return their exact completion record and writable generation.
Named layer views include manifest content identities. A content identity is a digest over file
bytes, paths, directories, portable permission bits and symlink targets, not a trace-record reference.
Equal file trees have equal content identities regardless of copy versus clone materialization.
The original checkpoint naming, discard/reuse, depth bound and compaction retirement rules apply.

## Journal and recovery

Every lifecycle command records a complete normalized request, backend/configuration identity,
prior state, named layers, retired names, writable generation and deterministic operation plan.
The record graph preserves the following phases:

| Phase | Durable fact | Recovery action |
| --- | --- | --- |
| `prepared` | Exact source content and target plan admitted | Verify ownership, finish verified copy/clone stages and publish the new state |
| `published` | New state is durable; old resources are named as garbage | Verify and finish only that garbage list |
| `completed` | Publication and physical cleanup finished | Return retained command evidence without repeating the operation |

Physical stages run synchronously under SQLite's `IMMEDIATE` write lock with an exact journal-head
check. They do not use an expiring lease to infer that a paused filesystem writer is dead. Process
death releases SQLite's lock; the previously committed phase remains available for diagnosis.
On macOS, a native clone helper may finish after its parent dies. No-replace file creation and
unreused resource-root/layer names keep a late helper from overwriting a committed snapshot or
targeting a recreated world. Recovery still verifies the captured bytes.
A stale handle refuses after another handle advances the journal. Reusing a command with different
input refuses, and a repeated completed checkpoint/restore command returns its original result.

```ts
import {
    inspectRetainedDeviceLayerWorld,
    recoverRetainedDeviceLayerWorld,
} from "@avnionur/shepherd-typescript/workspace";

const diagnosis = inspectRetainedDeviceLayerWorld(store, { deviceId });
if (diagnosis.status === "pending") {
    await recoverRetainedDeviceLayerWorld(store, {
        deviceId,
        commandId: "recover-interrupted-transition",
        expectedHeadRecordId: diagnosis.headRecordId,
    });
}
```

Inspection is read-only, including on a read-only store. It reports the configured `ready`,
`pending`, `cleaned` or `unavailable` status, exact head, generation, names and an unavailability
reason. Malformed or contradictory canonical journals throw. Recovery records the exact admitted
basis and revalidates it under the write lock before touching resources. Missing or inconsistent
ownership evidence stays fenced; the API does not adopt or recursively erase unknown paths.

Restore publishes a new writable directory before deleting the old generation. Read `world.path`
again after restore; it belongs to the handle's generation. Direct path writers must quiesce before
checkpoint, restore, recovery or cleanup. File writes are ordinary mutable filesystem operations;
this lifecycle journal is not a per-file effect journal or a guarantee about an unacknowledged write.
A checkpoint verifies the resulting quiescent tree. There is no process-memory checkpoint.

## Ownership and interruption boundaries

Store schema 16 adds local device registrations. Their authority is bound to the physical database
file; native trace imports, database copies and restored backup files do not inherit authority over
the source world's live paths. They retain inspectable canonical facts. Reopen/recovery requires the
original database file and verified roots; there is no automatic cross-store adoption or fencing.
Older runtimes refuse the newer store schema. Keep a pre-upgrade backup for downgrade.

Both wrapper and payload directories have device/inode identities, with owner-private durable
receipts published before file copying. Replacing either directory refuses even when replacement
bytes match. Garbage payloads are removed before their identity receipts and wrapper markers, so
partial deletion can resume without adopting a replacement. Symlink traversal, hard-linked snapshot
files, special entries, foreign mounts, changed frozen bytes and unexpected wrapper entries refuse.
Linux mount-table checks also refuse same-filesystem bind mounts. The library never unmounts a
foreign mount as a recovery shortcut.

An interruption before a new directory has a complete ownership receipt is classified unavailable;
it is not silently adopted. If an incomplete capture's source changed, recovery refuses. A completed,
verified staged tree can be published from its retained receipt. These checks assume cooperative
quiescence and a local filesystem honoring SQLite locking; they are not a sandbox or protection
against concurrent namespace tampering by processes able to modify the trusted resource ancestors.

## Supported backends and limits

The first durable implementations are the copy reference and clone on a filesystem whose native
clone probe succeeds. Both retain full verified snapshots. Seed capture uses copy so that a seed may
live on another filesystem; later clone materialization stays inside the owned resource root.
Clone never silently falls back to copying checkpoints. Overlay, container and custom durable
adapters are refused; their scratch implementations remain available. Windows ownership recovery,
remote sandboxes and additional host/filesystem combinations are not claimed by this evidence.

Configured bounds are 65,536 tree entries, 256 MiB per file, 1 GiB aggregate file bytes per captured
tree, and 16 KiB per ownership receipt. Oversized or unsupported captures refuse without truncation.
Snapshots are verified scans, and lifecycle stages hold the store write lock, so capture costs grow
with tree size and can delay other store writers. No constant-time durable checkpoint result is claimed.

Resource files contain complete user data and remain after `close`. Explicit cleanup removes only
verified owned resources and retains immutable journal history, including paths and content digests.
Native trace export includes the journal, not the external device files or local ownership rows.
Backup/rotation policy must account for those files separately. Trace secret scanning does not scan
external world-file bytes. Cleanup is not secure erasure or deletion of prior backups.

Ordinary scope fork and replay checkpoints do not use this new lifecycle yet; that composition is
tracked in [#244](https://github.com/avnionur/shepherd-typescript/issues/244).

## Verification

- [Fresh-process reopen](../test/workspace/device-layer-recovery.test.ts) and its
  [executable example](../test/fixtures/device-layer-recovery-process.ts).
- [SIGKILL during freeze, restore, compaction and cleanup](../test/workspace/device-layer-kill.test.ts):
  copy and actual clone on the recorded macOS/APFS host; unavailable clone hosts exercise refusal.
- [Late native helper](../test/workspace/device-layer-late-helper.test.ts): delayed real helper calls
  cannot overwrite a committed snapshot or target a recreated world after parent death.
- [Authority and replacements](../test/workspace/device-layer-authority.test.ts),
  [pending staging replacement](../test/workspace/device-layer-pending.test.ts), and
  [journal contradiction/corruption](../test/workspace/device-layer-journal.test.ts).
- [Durability fault injection](../test/workspace/device-layer-durability-faults.test.ts) checks every
  filesystem sync boundary in creation, restore and cleanup; missing receipts remain unavailable.
  [Admission faults](../test/workspace/device-layer-admission-faults.test.ts) cover recovery retries
  and command conflicts before physical work.
- [Previous-runtime drill](../test/fixtures/device-layer-legacy-reader.ts): build commit `edf6d14`
  (13.7.0) separately, then run `node test/fixtures/device-layer-legacy-reader.ts /path/to/old/dist`.
  It verifies schema refusal, archive round trips without resource adoption, and schema15 upgrade.
- [Installed consumer drill](../test/fixtures/device-layer-installed-consumer.ts) runs capture and
  restore in separate processes through an archive-installed package's public workspace/trace
  exports. Pass the isolated consumer directory, package name, then `capture` or `restore`.
- [Mount policy](../test/workspace/device-layer-mount-policy.test.ts) plus the actual isolated Linux
  [bind-mount drill](../test/fixtures/device-layer-mount-refusal.ts), run with mount capability and
  a read-only repository mount. It verifies that restore/cleanup leave unrelated mounted bytes intact.
- The [preservation matrix](../.plan/243-device-recovery-preservation.md) records exact commands,
  host evidence, review fixes and final gate results. Additional platform results remain explicit.
