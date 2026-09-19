// Opt-in real-volume ENOSPC suite: `pnpm test:faults:volume`. It is not part of `pnpm test`
// (the file does not end in `.test.ts`) because it mounts a disk image. On macOS it creates an
// HFS+ disk image of the configured size with `hdiutil`, attaches it at a private mount point
// without privileges, fills it through the store, and always detaches it and removes the image.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function hdiutilAvailable(): boolean {
    if (process.platform !== "darwin") return false;
    try {
        execFileSync("hdiutil", ["help"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

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
    skip: hdiutilAvailable() ? false : "needs macOS hdiutil (Linux loop devices need privileges)",
    timeout: faultSettings.testTimeoutMilliseconds,
}, async (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-enospc-"));
    const image = path.join(root, "volume.dmg");
    const mountPoint = path.join(root, "mount");
    mkdirSync(mountPoint);
    let attached = false;
    context.after(() => {
        if (attached) {
            try {
                execFileSync("hdiutil", ["detach", mountPoint], { stdio: "ignore" });
            } catch {
                execFileSync("hdiutil", ["detach", "-force", mountPoint], { stdio: "ignore" });
            }
        }
        rmSync(root, { force: true, recursive: true });
    });
    execFileSync(
        "hdiutil",
        [
            "create",
            "-size",
            `${settings.sizeMegabytes}m`,
            "-fs",
            "HFS+",
            "-volname",
            "shepherdfault",
            image,
        ],
        { stdio: "ignore" },
    );
    execFileSync(
        "hdiutil",
        ["attach", image, "-mountpoint", mountPoint, "-nobrowse", "-noverify"],
        {
            stdio: "ignore",
        },
    );
    attached = true;

    // Ballast released later to return space to the volume.
    const ballast = path.join(mountPoint, "ballast.bin");
    writeFileSync(ballast, new Uint8Array(Math.floor((settings.sizeMegabytes * 1_048_576) / 4)));
    const databasePath = path.join(mountPoint, "trace.sqlite");
    const store = new SQLiteTraceStore(databasePath);
    context.after(() => store.close());
    const outcomes: string[] = [];

    // Fill the volume through the store until one operation fails.
    let index = 0;
    let firstFailure: { readonly kind: "append" | "blob"; readonly index: number } | undefined;
    while (firstFailure === undefined) {
        const kind = index % 2 === 0 ? "append" : "blob";
        const before = store.exportTrace().length;
        try {
            if (kind === "append") store.append(bulkyAppend(index));
            else store.putBlob(blobContentFor(seed, "volume", index));
        } catch (error) {
            assert.ok(isSpaceFailure(error), `${kind} failed untyped: ${describeError(error)}`);
            assert.equal(store.exportTrace().length, before);
            outcomes.push(`fill ${kind} #${index}: ${describeError(error)}`);
            firstFailure = { index, kind };
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
    if (firstFailure.kind === "append") store.append(bulkyAppend(firstFailure.index));
    else store.putBlob(blobContentFor(seed, "volume", firstFailure.index));
    store.collectBlobOrphans({ mode: "delete" });
    assert.deepEqual(inspectHealth(store).issues, []);
    store.exportTrace();
    context.diagnostic(`ENOSPC outcomes: ${outcomes.join("; ")}`);
});
