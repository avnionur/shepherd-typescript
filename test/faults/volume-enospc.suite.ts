// Opt-in real-volume ENOSPC suite: `pnpm test:faults:volume`. It is not part of `pnpm test`
// (the file does not end in `.test.ts`) because it mounts a disk image. On macOS it creates an
// HFS+ disk image of the configured size with the commands in `faults.diskFull.volume.macos`,
// attaches it at a private mount point without privileges, fills it through the store, and always
// detaches it and removes the image.
// On Linux, as root with loop devices (a privileged container), it formats a sparse image of the
// same size and loop-mounts it with the commands in `faults.diskFull.volume.linux`, runs the same
// workload, and always unmounts it (which releases the loop device) and removes the image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { backupTraceStore, SQLiteTraceStore, type StoreAppendRequest } from "../../src/index.ts";
import {
    appendRequestFor,
    blobContentFor,
    blobIdOf,
    faultSeeds,
    faultSettings,
    inspectHealth,
} from "./workload.ts";

const settings = faultSettings.diskFull.volume;
const [seed = 0] = faultSeeds();

const macos = settings.macos;
const linux = settings.linux;
const volumeBytes = settings.sizeMegabytes * 1_048_576;

function commandSucceeds(command: readonly string[]): boolean {
    const [executable, ...args] = command;
    try {
        execFileSync(executable as string, args, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/** A mounted, size-limited volume and how to release it. */
type Volume = { readonly mountPoint: string; readonly release: () => void };

/** Platform variant: why it cannot run here (or false), and how to mount a volume under `root`. */
type VolumeVariant = {
    readonly mount: (root: string) => Volume;
    readonly skip: false | string;
};

function run(command: readonly string[], ...operands: readonly string[]): void {
    const [executable, ...args] = command;
    execFileSync(executable as string, [...args, ...operands], {
        stdio: ["ignore", "ignore", "pipe"],
    });
}

const macosVariant: VolumeVariant = {
    mount(root) {
        const image = path.join(root, macos.imageFileName);
        const mountPoint = path.join(root, "mount");
        mkdirSync(mountPoint);
        run(macos.create, `${settings.sizeMegabytes}m`, image);
        run(macos.attach, mountPoint, image);
        return {
            mountPoint,
            release() {
                try {
                    run(macos.detach, mountPoint);
                } catch {
                    run(macos.forceDetach, mountPoint);
                }
            },
        };
    },
    get skip() {
        const missing = macos.probes.filter((probe) => !commandSucceeds(probe));
        return missing.length === 0
            ? false
            : `needs ${missing.map(([command]) => command).join(", ")} on macOS`;
    },
};

function linuxSkipReason(): false | string {
    if (process.getuid?.() !== 0) {
        return "needs root to loop-mount an image on Linux (run in a privileged container)";
    }
    if (!existsSync(linux.loopControlDevice)) {
        return `needs loop devices (${linux.loopControlDevice} is missing; run privileged)`;
    }
    const missing = linux.probes.filter((probe) => !commandSucceeds(probe));
    return missing.length === 0
        ? false
        : `needs ${missing.map(([command]) => command).join(", ")} on Linux`;
}

const linuxVariant: VolumeVariant = {
    mount(root) {
        const image = path.join(root, linux.imageFileName);
        const mountPoint = path.join(root, "mount");
        mkdirSync(mountPoint);
        writeFileSync(image, new Uint8Array(0));
        truncateSync(image, volumeBytes);
        run(linux.makeFileSystem, image);
        run(linux.mount, image, mountPoint);
        return {
            mountPoint,
            release() {
                try {
                    run(linux.unmount, mountPoint);
                } catch {
                    run(linux.forceUnmount, mountPoint);
                }
            },
        };
    },
    get skip() {
        return linuxSkipReason();
    },
};

function selectVariant(): VolumeVariant {
    if (process.platform === "darwin") return macosVariant;
    if (process.platform === "linux") return linuxVariant;
    return {
        mount() {
            throw new Error("unreachable: the suite is skipped on this platform");
        },
        skip: `needs macOS hdiutil or Linux loop devices (platform ${process.platform})`,
    };
}

const variant = selectVariant();

function describeError(error: unknown): string {
    const failure = error as Error & { code?: unknown; errcode?: unknown; reason?: unknown };
    return `${failure.constructor.name}(${[failure.code, failure.errcode, failure.reason]
        .filter((part) => part !== undefined)
        .join("/")})`;
}

/** A failure the store reports when the volume is full: SQLITE_FULL, ENOSPC, or a wrapped one. */
function isSpaceFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const failure = error as Error & { cause?: unknown; code?: unknown; errcode?: unknown };
    return (
        failure.code === "ENOSPC" ||
        (failure.code === "ERR_SQLITE_ERROR" &&
            (failure.errcode === 13 || (Number(failure.errcode) & 0xff) === 10)) ||
        (failure.cause !== undefined && isSpaceFailure(failure.cause))
    );
}

function bulkyAppend(index: number): StoreAppendRequest {
    const request = appendRequestFor(seed, "volume", index);
    const [group] = request.batch.groups;
    return {
        append_intent_id: request.append_intent_id,
        batch: {
            groups: [
                {
                    owner_id: group?.owner_id as string,
                    records: Array.from({ length: 4 }, (_, position) => ({
                        body: { index, padding: "v".repeat(65_536), position },
                        mode: "capture" as const,
                        schema_ref: "example.fault.v1",
                        witness_ref: group?.records[0]?.witness_ref as string,
                    })),
                },
            ],
        },
    };
}

test("a store on a full volume fails typed, keeps its state, and recovers when space returns", {
    skip: variant.skip,
    timeout: faultSettings.testTimeoutMilliseconds,
}, async (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-enospc-"));
    let volume: Volume | undefined;
    context.after(() => {
        volume?.release();
        rmSync(root, { force: true, recursive: true });
    });
    volume = variant.mount(root);
    const { mountPoint } = volume;

    // Ballast released later to return space to the volume.
    const ballast = path.join(mountPoint, "ballast.bin");
    writeFileSync(ballast, new Uint8Array(Math.floor(volumeBytes / 4)));
    const databasePath = path.join(mountPoint, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    context.after(() => store.close());
    const outcomes: string[] = [];

    // Fill the volume through the store until an append fails. Blob writes can fail first while
    // appends still commit into write-ahead-log space SQLite already allocated (observed on ext4),
    // so filling stops only once the append path itself hits the full volume. Every failure on
    // the way must be typed and leave no partial state; the first failure of each kind is
    // retried once space returns.
    let index = 0;
    const failures: { readonly kind: "append" | "blob"; readonly index: number }[] = [];
    while (!failures.some(({ kind }) => kind === "append")) {
        const kind = index % 2 === 0 ? "append" : "blob";
        const before = store.exportTrace().length;
        try {
            if (kind === "append") store.append(bulkyAppend(index));
            else store.putBlob(blobContentFor(seed, "volume", index));
        } catch (error) {
            assert.ok(isSpaceFailure(error), `${kind} failed untyped: ${describeError(error)}`);
            assert.equal(store.exportTrace().length, before);
            if (kind === "blob") {
                assert.equal(
                    store.readBlob(blobIdOf(blobContentFor(seed, "volume", index))),
                    undefined,
                );
            }
            outcomes.push(`fill ${kind} #${index}: ${describeError(error)}`);
            failures.push({ index, kind });
        }
        index += 1;
    }
    assert.deepEqual(inspectHealth(store).issues, []);

    // While full: every mutating operation fails typed and leaves no partial state.
    const pending = bulkyAppend(index);
    assert.throws(
        () => store.append(pending),
        (error) => {
            outcomes.push(`append while full: ${describeError(error)}`);
            return isSpaceFailure(error);
        },
    );
    assert.equal(store.diagnoseAppend(pending.append_intent_id).status, "retry_safe");
    const pendingBlob = blobContentFor(seed, "volume-pending", 0);
    try {
        store.putBlob(pendingBlob);
        outcomes.push("putBlob while full: fit");
    } catch (error) {
        assert.ok(isSpaceFailure(error), describeError(error));
        assert.equal(store.readBlob(blobIdOf(pendingBlob)), undefined);
        outcomes.push(`putBlob while full: ${describeError(error)}`);
    }
    const backupDestination = path.join(mountPoint, "backup");
    await assert.rejects(backupTraceStore(store, { destination: backupDestination }), (error) => {
        outcomes.push(`backup while full: ${describeError(error)}`);
        return error instanceof Error;
    });
    assert.equal(existsSync(path.join(backupDestination, "manifest.json")), false);
    try {
        store.maintain({ mode: "vacuum" });
        outcomes.push("vacuum while full: completed");
    } catch (error) {
        assert.ok(isSpaceFailure(error), describeError(error));
        outcomes.push(`vacuum while full: ${describeError(error)}`);
    }
    assert.deepEqual(inspectHealth(store).issues, []);

    // Space returns: every retry succeeds and the store stays clean.
    rmSync(ballast);
    rmSync(backupDestination, { force: true, recursive: true });
    store.append(pending);
    assert.equal(store.diagnoseAppend(pending.append_intent_id).status, "committed");
    assert.equal(store.putBlob(pendingBlob).blob_id, blobIdOf(pendingBlob));
    const firstOfEachKind = failures.filter(
        (failure, position) => failures.findIndex(({ kind }) => kind === failure.kind) === position,
    );
    for (const failure of firstOfEachKind) {
        if (failure.kind === "append") store.append(bulkyAppend(failure.index));
        else store.putBlob(blobContentFor(seed, "volume", failure.index));
    }
    store.collectBlobOrphans({ mode: "delete" });
    assert.deepEqual(inspectHealth(store).issues, []);
    store.exportTrace();
    context.diagnostic(`ENOSPC outcomes: ${outcomes.join("; ")}`);
});
