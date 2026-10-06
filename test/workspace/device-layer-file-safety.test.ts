import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    assertDeviceMarker,
    assertRetainedDeviceMounts,
    assertRetainedDeviceTreeBoundary,
    deviceDirectoryIdentity,
    ensureDeviceWrapper,
    publishDeviceTree,
    readDevicePayloadIdentity,
    retainedDeviceFilePath,
    retainedDeviceTreeIdentity,
} from "../../src/workspace/retained-device-files.ts";
import { temporaryDirectory } from "../replay/fixtures.ts";

const config = workspaceProtocolConfig.deviceLayers.retained;

test("ownership receipts refuse altered owners, malformed identities, unsafe modes and lost payloads", async (context) => {
    const directory = await temporaryDirectory(context, "device-receipts");
    const marker = { owner: "test-owner" };
    const source = path.join(directory, "source");
    fs.mkdirSync(source, { mode: config.directoryMode });
    fs.writeFileSync(path.join(source, "note"), "source");
    const target = path.join(directory, "wrapper");
    const tree = publishDeviceTree(
        target,
        marker,
        source,
        retainedDeviceTreeIdentity(source),
        config.adapters.copy,
    );
    const ownership = path.join(target, config.ownershipFilename);
    const receipt = path.join(target, config.payloadIdentityFilename);
    const original = fs.readFileSync(receipt);
    fs.chmodSync(ownership, 0o644);
    assert.throws(() => assertDeviceMarker(target, marker), /unsafe/u);
    fs.chmodSync(ownership, config.fileMode);
    assert.throws(() => assertDeviceMarker(target, { owner: "wrong" }), /differs/u);
    fs.chmodSync(receipt, 0o644);
    assert.throws(() => readDevicePayloadIdentity(target, marker), /unsafe/u);
    fs.chmodSync(receipt, config.fileMode);
    for (const payload of [
        { owner: { owner: "wrong" }, payload_identity: tree.payload_identity },
        { owner: marker, payload_identity: { device: "invalid", inode: "1" } },
        { owner: marker, payload_identity: { device: "1", inode: false } },
        { owner: marker, payload_identity: { device: "1", inode: "invalid" } },
    ]) {
        fs.writeFileSync(receipt, JSON.stringify(payload));
        assert.throws(() => readDevicePayloadIdentity(target, marker), /identity|malformed/u);
    }
    fs.writeFileSync(receipt, original);
    assert.throws(
        () => readDevicePayloadIdentity(target, marker, { device: "0", inode: "0" }),
        /identity changed/u,
    );
    fs.renameSync(path.join(target, config.treeDirectory), path.join(directory, "held"));
    assert.deepEqual(
        readDevicePayloadIdentity(target, marker, tree.payload_identity, true),
        tree.payload_identity,
    );
    assert.throws(
        () => publishDeviceTree(target, marker, source, tree.content_id!, config.adapters.copy),
        /disappeared/u,
    );
    fs.writeFileSync(path.join(target, "unrelated"), "preserve");
    assert.throws(
        () => publishDeviceTree(target, marker, source, tree.content_id!, config.adapters.copy),
        /unowned/u,
    );
    assert.equal(fs.readFileSync(path.join(target, "unrelated"), "utf8"), "preserve");
    assert.throws(() => deviceDirectoryIdentity(ownership), /not locally owned/u);
});

test("capture detects source drift and publication corruption instead of committing changed bytes", async (context) => {
    const directory = await temporaryDirectory(context, "device-publication-drift");
    const source = path.join(directory, "source");
    fs.mkdirSync(source, { mode: config.directoryMode });
    const note = path.join(source, "note");
    fs.writeFileSync(note, "original");
    const content = retainedDeviceTreeIdentity(source);
    fs.writeFileSync(note, "changed");
    assert.throws(
        () =>
            publishDeviceTree(
                path.join(directory, "first"),
                {},
                source,
                content,
                config.adapters.copy,
            ),
        /source changed/u,
    );
    fs.writeFileSync(note, "original");
    const original = fs.writeFileSync;
    const injected = context.mock.method(
        fs,
        "writeFileSync",
        (...args: Parameters<typeof original>) => {
            original(...args);
            if (Buffer.isBuffer(args[1]) && args[1].toString() === "original")
                original(args[0], "corrupted");
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(
            () =>
                publishDeviceTree(
                    path.join(directory, "second"),
                    {},
                    source,
                    content,
                    config.adapters.copy,
                ),
            /verification/u,
        );
    } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
    }
    assert.equal(fs.readFileSync(note, "utf8"), "original");
});

test("snapshot scans bound regular files and refuse a file changed between lstat and open", async (context) => {
    const directory = await temporaryDirectory(context, "device-scan-safety");
    const note = path.join(directory, "note");
    fs.writeFileSync(note, "original");
    const descriptor = fs.openSync(note, "r+");
    fs.ftruncateSync(descriptor, config.limits.maxFileBytes + 1);
    fs.closeSync(descriptor);
    assert.throws(() => retainedDeviceTreeIdentity(directory), /byte bound/u);
    fs.writeFileSync(note, "original");
    const original = fs.openSync;
    let changed = false;
    const injected = context.mock.method(fs, "openSync", (...args: Parameters<typeof original>) => {
        if (args[0] === note && !changed) {
            changed = true;
            fs.renameSync(note, path.join(directory, "held"));
            fs.writeFileSync(note, "different-size");
        }
        return original(...args);
    });
    syncBuiltinESMExports();
    try {
        assert.throws(() => retainedDeviceTreeIdentity(directory), /changed during scan/u);
    } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
    }
    const wrapper = path.join(directory, "wrapper");
    ensureDeviceWrapper(wrapper, {});
    assert.deepEqual(ensureDeviceWrapper(wrapper, {}), deviceDirectoryIdentity(wrapper));
});

test("bounded traversal refuses too many entries and device changes at the filesystem seam", async (context) => {
    const directory = await temporaryDirectory(context, "device-traversal-boundaries");
    const child = path.join(directory, "link");
    fs.symlinkSync("absent", child);
    const originalRead = fs.readdirSync;
    const repeated = context.mock.method(fs, "readdirSync", (target: fs.PathLike) =>
        target === directory
            ? Array.from({ length: config.limits.maxEntries + 1 }, () => "link")
            : originalRead(target),
    );
    syncBuiltinESMExports();
    try {
        assert.throws(() => retainedDeviceTreeIdentity(directory), /entry bound/u);
        assert.throws(() => assertRetainedDeviceTreeBoundary(directory), /entry bound/u);
    } finally {
        repeated.mock.restore();
        syncBuiltinESMExports();
    }
    const originalStat = fs.lstatSync;
    const changed = context.mock.method(
        fs,
        "lstatSync",
        (target: fs.PathLike, options?: fs.StatOptions) => {
            const result = originalStat(target, options);
            if (result === undefined) return result;
            return target === child
                ? new Proxy(result, {
                      get: (value, key) =>
                          key === "dev"
                              ? Number(value.dev) + 1
                              : key === "isSymbolicLink"
                                ? () => false
                                : Reflect.get(value, key),
                  })
                : result;
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(() => retainedDeviceFilePath(directory, "link"), /filesystem boundary/u);
        assert.throws(() => assertRetainedDeviceTreeBoundary(directory), /filesystem boundary/u);
    } finally {
        changed.mock.restore();
        syncBuiltinESMExports();
    }
});

test("missing host identity and mount-table dispatch fail closed", async (context) => {
    const directory = await temporaryDirectory(context, "device-platform-policy");
    const uid = Object.getOwnPropertyDescriptor(process, "getuid");
    assert.ok(uid);
    Object.defineProperty(process, "getuid", { value: undefined, configurable: true });
    try {
        assert.throws(() => deviceDirectoryIdentity(directory), /not locally owned/u);
    } finally {
        Object.defineProperty(process, "getuid", uid);
    }
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    assert.ok(platform);
    const overlay = workspaceProtocolConfig.carrierBackends.overlay;
    const original = fs.readFileSync;
    const injected = context.mock.method(
        fs,
        "readFileSync",
        (...args: Parameters<typeof original>) =>
            args[0] === overlay.mountInfoPath
                ? `1 0 0:1 / ${directory} rw - ext4 /dev/root rw\n`
                : original(...args),
    );
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", { value: overlay.platforms[0], configurable: true });
    try {
        assert.throws(() => assertRetainedDeviceMounts(directory), /foreign mount/u);
    } finally {
        Object.defineProperty(process, "platform", platform);
        injected.mock.restore();
        syncBuiltinESMExports();
    }
});

test("scan detects truncation after descriptor verification and redoes incomplete owned copies", async (context) => {
    const directory = await temporaryDirectory(context, "device-short-read");
    const seed = path.join(directory, "seed");
    fs.mkdirSync(seed, { mode: config.directoryMode });
    const note = path.join(seed, "note");
    fs.writeFileSync(note, "original");
    const original = fs.readFileSync;
    const injected = context.mock.method(
        fs,
        "readFileSync",
        (...args: Parameters<typeof original>) => {
            if (typeof args[0] === "number") fs.truncateSync(note, 0);
            return original(...args);
        },
    );
    syncBuiltinESMExports();
    try {
        assert.throws(() => retainedDeviceTreeIdentity(seed), /length changed/u);
    } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
    }
    fs.writeFileSync(note, "original");
    const content = retainedDeviceTreeIdentity(seed);
    const target = path.join(directory, "wrapper");
    publishDeviceTree(target, {}, seed, content, config.adapters.copy);
    fs.writeFileSync(path.join(target, config.treeDirectory, "note"), "partial");
    publishDeviceTree(target, {}, seed, content, config.adapters.copy);
    assert.equal(
        fs.readFileSync(path.join(target, config.treeDirectory, "note"), "utf8"),
        "original",
    );
});
