import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type BlobStoreBackend,
    checkBlobStoreBackendConformance,
    checkStorageCoordinatorConformance,
    createFilesystemBlobStoreBackend,
    createMemoryBlobStoreBackend,
    createMemoryStorageCoordinator,
    createSQLiteStorageCoordinator,
    type StorageConformanceReport,
    type StorageCoordinator,
} from "../../src/facades/operations.ts";

const blobLawNames = [
    "declares-durability",
    "put-get-round-trip",
    "put-idempotent",
    "put-refuses-digest-mismatch",
    "put-never-replaces",
    "copies-are-isolated",
    "absent-object",
    "list-ordered-paged",
    "list-bounds",
    "delete-idempotent",
    "malformed-identifiers",
];

const coordinatorLawNames = [
    "declares-durability",
    "ref-create-and-read",
    "ref-generations-monotonic",
    "ref-conflict-unchanged",
    "ref-concurrent-single-winner",
    "lease-exclusive",
    "lease-reacquire-by-holder",
    "lease-expiry-takeover-fences",
    "lease-renew",
    "lease-release",
    "fenced-swap",
    "malformed-requests",
];

async function temporaryRoot(context: { after(fn: () => Promise<void>): void }): Promise<string> {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "shepherd-storage-test-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

function assertPassed(report: StorageConformanceReport, names: readonly string[]): void {
    assert.deepEqual(
        report.laws.filter(({ passed }) => !passed),
        [],
    );
    assert.deepEqual(
        report.laws.map(({ law }) => law),
        names,
    );
    assert.equal(report.passed, true);
    assert.equal(Object.isFrozen(report), true);
}

function failedLaws(report: StorageConformanceReport): readonly string[] {
    return report.laws.filter(({ passed }) => !passed).map(({ law }) => law);
}

test("reference blob-store backends pass every conformance law", async (context) => {
    const memory = await checkBlobStoreBackendConformance(createMemoryBlobStoreBackend);
    assertPassed(memory, blobLawNames);
    assert.equal(memory.durability, "volatile");

    const root = await temporaryRoot(context);
    let instance = 0;
    const filesystem = await checkBlobStoreBackendConformance(() => {
        instance += 1;
        return createFilesystemBlobStoreBackend(path.join(root, `backend-${instance}`));
    });
    assertPassed(filesystem, blobLawNames);
    assert.equal(filesystem.durability, "durable");
});

test("reference storage coordinators pass every conformance law", async (context) => {
    const memory = await checkStorageCoordinatorConformance(createMemoryStorageCoordinator);
    assertPassed(memory, coordinatorLawNames);
    assert.equal(memory.durability, "volatile");

    const root = await temporaryRoot(context);
    let instance = 0;
    const sqlite = await checkStorageCoordinatorConformance(() => {
        instance += 1;
        return createSQLiteStorageCoordinator(path.join(root, `coordinator-${instance}.sqlite`));
    });
    assertPassed(sqlite, coordinatorLawNames);
    assert.equal(sqlite.durability, "durable");

    const inMemory = await checkStorageCoordinatorConformance(() =>
        createSQLiteStorageCoordinator(":memory:"),
    );
    assertPassed(inMemory, coordinatorLawNames);
    assert.equal(inMemory.durability, "volatile");
});

test("blob-store kit detects a backend that replaces objects and skips verification", async () => {
    const replacing = (): BlobStoreBackend => {
        const inner = createMemoryBlobStoreBackend();
        const objects = new Map<string, Uint8Array>();
        return {
            ...inner,
            async get(blobId) {
                return objects.get(blobId);
            },
            async has(blobId) {
                return objects.has(blobId);
            },
            async put(blobId, content) {
                const created = !objects.has(blobId);
                objects.set(blobId, content);
                return { blobId, byteLength: content.byteLength, created };
            },
        };
    };
    const report = await checkBlobStoreBackendConformance(replacing);
    assert.equal(report.passed, false);
    assert.deepEqual(failedLaws(report), [
        "put-idempotent",
        "put-refuses-digest-mismatch",
        "put-never-replaces",
        "copies-are-isolated",
        "list-ordered-paged",
        "delete-idempotent",
        "malformed-identifiers",
    ]);
    const mismatch = report.laws.find(({ law }) => law === "put-refuses-digest-mismatch");
    assert.match(mismatch?.failure ?? "", /must refuse bytes/u);
});

test("blob-store kit detects unordered listing and an undeclared durability", async () => {
    const unordered = (): BlobStoreBackend => {
        const inner = createMemoryBlobStoreBackend();
        return {
            ...inner,
            durability: "replicated" as never,
            async list(options) {
                const page = await inner.list(options);
                const blobIds = [...page.blobIds].reverse();
                const [last] = blobIds;
                return last === undefined ? { blobIds } : { blobIds, next: last };
            },
        };
    };
    const report = await checkBlobStoreBackendConformance(unordered);
    assert.deepEqual(failedLaws(report), ["declares-durability", "list-ordered-paged"]);
});

test("coordinator kit detects ignored generations, shared leases, and ignored fences", async () => {
    const broken = (): StorageCoordinator => {
        const inner = createMemoryStorageCoordinator();
        return {
            ...inner,
            async acquireLease(key, owner, ttl, now) {
                const result = await inner.acquireLease(key, owner, ttl, now);
                return { lease: { ...result.lease, owner }, status: "acquired" };
            },
            async compareAndSwapRef(name, _expected, value) {
                // Last writer wins: retry against whatever generation is current.
                for (;;) {
                    const current = await inner.readRef(name);
                    const result = await inner.compareAndSwapRef(
                        name,
                        current?.generation ?? 0,
                        value,
                    );
                    if (result.status === "swapped") {
                        return result;
                    }
                }
            },
        };
    };
    const report = await checkStorageCoordinatorConformance(broken);
    assert.deepEqual(failedLaws(report), [
        "ref-conflict-unchanged",
        "ref-concurrent-single-winner",
        "lease-exclusive",
        "lease-expiry-takeover-fences",
        "fenced-swap",
        "malformed-requests",
    ]);
});

test("conformance kits report factory failures, non-error throws, and close failures", async () => {
    let calls = 0;
    const report = await checkStorageCoordinatorConformance(() => {
        calls += 1;
        throw new Error("factory unavailable");
    });
    assert.equal(report.passed, false);
    assert.equal(report.durability, undefined);
    assert.equal(calls, report.laws.length);
    assert.ok(report.laws.every(({ failure }) => failure === "factory unavailable"));

    const throwing = await checkBlobStoreBackendConformance(async () => ({
        ...createMemoryBlobStoreBackend(),
        close() {
            throw "close refused";
        },
    }));
    assert.equal(throwing.passed, false);
    assert.equal(throwing.durability, "volatile");
    assert.ok(throwing.laws.every(({ failure }) => failure === "close refused"));
});
