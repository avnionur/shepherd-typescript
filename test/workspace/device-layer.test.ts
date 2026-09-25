import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
    checkDeviceLayerConformance,
    createCloneDeviceLayerAdapter,
    createContainerDeviceLayerAdapter,
    createCopyDeviceLayerAdapter,
    createDeviceLayerAdapters,
    type DeviceLayerAdapter,
    type DeviceLayerDevice,
    DeviceLayerError,
    type DeviceLayerOpenContext,
    openDeviceLayerWorld,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { renderOverlayStackOptions } from "../../src/workspace/carrier-backends.ts";
import {
    digestOf,
    layerName,
    overlayMaxLayers,
    readWorldPath,
} from "../../src/workspace/device-layer.ts";
import {
    parseContainerFileList,
    renderContainerTemplate,
} from "../../src/workspace/device-layer-container.ts";

type ConformanceConfiguration = {
    readonly optInAdapters: readonly string[];
    readonly optInEnvironmentVariable: string;
    readonly requiredAdaptersEnvironmentVariable: string;
    readonly separator: string;
};

const config = workspaceProtocolConfig.deviceLayers;
const errors = config.errors;
const conformance = JSON.parse(
    readFileSync(
        new URL("../../config/device-layer-conformance.config.json", import.meta.url),
        "utf8",
    ),
) as ConformanceConfiguration;
const listed = (variable: string) =>
    (process.env[variable] ?? "").split(conformance.separator).filter((name) => name.length > 0);
const requiredAdapters = listed(conformance.requiredAdaptersEnvironmentVariable);
const optedIn = listed(conformance.optInEnvironmentVariable);
const hostRoot = await mkdtemp(path.join(tmpdir(), "shepherd-device-layer-"));
after(() => rm(hostRoot, { force: true, recursive: true }));

for (const adapter of createDeviceLayerAdapters()) {
    const optIn = conformance.optInAdapters.includes(adapter.name);
    const enabled =
        !optIn || optedIn.includes(adapter.name) || requiredAdapters.includes(adapter.name);
    test(`${adapter.name} device-layer adapter passes the conformance kit where available`, async (context) => {
        const scratch = await mkdtemp(path.join(hostRoot, "probe-"));
        const probe = await adapter.probe({ root: scratch });
        await rm(scratch, { force: true, recursive: true });
        if (!probe.available || !enabled) {
            assert.equal(
                requiredAdapters.includes(adapter.name),
                false,
                `${adapter.name} is required`,
            );
            context.diagnostic(
                probe.available
                    ? `opt in with ${conformance.optInEnvironmentVariable}=${adapter.name}`
                    : `unavailable: ${probe.reason}`,
            );
            return;
        }
        const report = await checkDeviceLayerConformance(adapter, { root: hostRoot });
        assert.deepEqual(
            report.cases.filter((entry) => !entry.passed),
            [],
        );
        assert.equal(report.passed, true);
        assert.equal(report.adapter, adapter.name);
        assert.equal(report.cases.length, 5);
    });
}

test("a pluggable in-memory adapter passes the same conformance kit", async () => {
    const report = await checkDeviceLayerConformance(memoryAdapter(), { root: hostRoot });
    assert.deepEqual(
        report.cases.filter((entry) => !entry.passed),
        [],
    );
});

test("the conformance kit reports every failing case without throwing", async () => {
    const broken = memoryAdapter({
        device: { revert: async () => undefined },
        probe: async () => {
            throw "probe failed";
        },
    });
    const stale = await checkDeviceLayerConformance(
        memoryAdapter({ device: { revert: async () => undefined } }),
        { root: hostRoot },
    );
    assert.equal(stale.cases[0]?.passed, true);
    assert.equal(stale.cases[2]?.passed, false);
    assert.match(stale.cases[2]?.error as string, /Expected values to be strictly deep-equal/u);
    const report = await checkDeviceLayerConformance(broken, { root: hostRoot });
    assert.equal(report.passed, false);
    const failed = report.cases.filter((entry) => !entry.passed);
    assert.equal(failed[0]?.error, "probe failed");
    assert.ok(failed.length >= 3);
    assert.ok(failed.every((entry) => typeof entry.error === "string"));
    await assert.rejects(
        checkDeviceLayerConformance(broken, null as never),
        (error: unknown) => error instanceof TypeError,
    );
    assert.equal(
        readdirSync(hostRoot).some((name) => name.startsWith(config.deviceDirectoryPrefix)),
        false,
    );
});

test("strict and fallback selection record which adapter was used", async () => {
    const unavailable: DeviceLayerAdapter = {
        name: "absent",
        open: async () => assert.fail("unavailable adapters are never opened"),
        probe: async () => ({ available: false, detail: "absent host", reason: "absent-reason" }),
    };
    const memory = memoryAdapter();
    const adapters = [unavailable, memory];
    await assert.rejects(
        openDeviceLayerWorld({ adapter: "absent", adapters, root: hostRoot }),
        (error: unknown) =>
            error instanceof DeviceLayerError &&
            error.code === errors.unavailableCode &&
            error.message.includes("absent: absent-reason"),
    );
    const fallback = await openDeviceLayerWorld({
        adapter: "absent",
        adapters,
        fallbackOrder: ["absent", "memory"],
        root: hostRoot,
        selection: "fallback",
    });
    assert.deepEqual(fallback.selection, {
        attempts: [
            { adapter: "absent", available: false, reason: "absent-reason" },
            { adapter: "memory", available: true, reason: config.reasons.available },
        ],
        mode: "fallback",
        requested: "absent",
        used: "memory",
    });
    assert.equal(fallback.adapter, "memory");
    for (const file of ["b.txt", "a.txt", "c.txt"])
        await fallback.writeFile(file, Buffer.from(file));
    assert.deepEqual(
        (await fallback.listFiles()).map((entry) => entry.path),
        ["a.txt", "b.txt", "c.txt"],
    );
    await fallback.close();
    // A requested adapter outside the order is tried first, then the whole order.
    const outside = await openDeviceLayerWorld({
        adapter: "absent",
        adapters,
        fallbackOrder: ["memory"],
        root: hostRoot,
        selection: "fallback",
    });
    assert.equal(outside.selection.used, "memory");
    await outside.close();
    await assert.rejects(
        openDeviceLayerWorld({ adapter: "missing", adapters, root: hostRoot }),
        TypeError,
    );
    const defaults = await openDeviceLayerWorld({ root: hostRoot });
    assert.deepEqual(
        [defaults.selection.mode, defaults.selection.requested, defaults.adapter],
        [config.selection.defaultMode, config.selection.defaultAdapter, config.adapters.copy],
    );
    assert.deepEqual(defaults.depth, config.depth);
    assert.equal(typeof defaults.path, "string");
    assert.deepEqual(await defaults.listFiles(), []);
    await defaults.close();
});

test("device-layer world options are exact", async () => {
    const adapters = [memoryAdapter()];
    const file = path.join(hostRoot, "not-a-directory");
    await writeFile(file, "");
    const invalid: unknown[] = [
        null,
        [],
        { adapters },
        { adapters, root: path.join(hostRoot, "missing") },
        { adapters, root: file },
        { adapters, root: hostRoot, seed: 1 },
        { adapters: "memory", root: hostRoot },
        { adapters: [{ name: "memory" }], root: hostRoot },
        { adapters: [memoryAdapter(), memoryAdapter()], root: hostRoot },
        { adapters, root: hostRoot, selection: "other" },
        { adapters, fallbackOrder: "memory", root: hostRoot },
        { adapters, depth: { maxDepth: 0 }, root: hostRoot },
        { adapters, depth: { maxDepth: 1.5 }, root: hostRoot },
        { adapters, depth: { maxDepth: config.depth.maxDepth + 1 }, root: hostRoot },
        { adapters, depth: { retainNewest: 0 }, root: hostRoot },
    ];
    for (const options of invalid) {
        await assert.rejects(
            openDeviceLayerWorld({ adapter: "memory", ...(options as object) } as never),
            TypeError,
        );
    }
    await assert.rejects(openDeviceLayerWorld(null as never), TypeError);
});

test("the depth policy must leave room for a checkpoint on the opened device", async () => {
    let closed = 0;
    const countClose = async () => {
        closed += 1;
    };
    const shallow = memoryAdapter({ device: { close: countClose }, maxLayers: 2 });
    const options = { adapter: "memory", adapters: [shallow], root: hostRoot };
    await assert.rejects(openDeviceLayerWorld(options), TypeError);
    await assert.rejects(
        openDeviceLayerWorld({
            ...options,
            adapters: [memoryAdapter({ device: { close: countClose } })],
            depth: { maxDepth: 4, retainNewest: 3 },
        }),
        TypeError,
    );
    assert.equal(closed, 2);
    const limited = await openDeviceLayerWorld({
        ...options,
        adapters: [memoryAdapter({ maxLayers: 6 })],
    });
    assert.deepEqual(limited.depth, { maxDepth: 6, retainNewest: config.depth.retainNewest });
    await limited.close();
    const clamped = await openDeviceLayerWorld({
        ...options,
        adapters: [memoryAdapter({ maxLayers: 3 })],
    });
    assert.deepEqual(clamped.depth, { maxDepth: 3, retainNewest: 1 });
    await clamped.close();
    assert.deepEqual(await readdir(hostRoot), ["not-a-directory"]);
});

test("adapter failures surface as device-layer errors and poison only mutations", async () => {
    const opening = (error: unknown) =>
        memoryAdapter({
            open: async () => {
                throw error;
            },
        });
    await assert.rejects(
        openDeviceLayerWorld({
            adapter: "memory",
            adapters: [opening(new Error("boom"))],
            root: hostRoot,
        }),
        (error: unknown) =>
            error instanceof DeviceLayerError &&
            error.code === errors.operationCode &&
            error.message.includes("open: boom") &&
            error.cause instanceof Error,
    );
    const refusal = new DeviceLayerError(errors.pathCode, "refused");
    await assert.rejects(
        openDeviceLayerWorld({ adapter: "memory", adapters: [opening(refusal)], root: hostRoot }),
        (error: unknown) => error === refusal,
    );

    let closed = 0;
    const failing = memoryAdapter({
        device: {
            close: async () => {
                closed += 1;
                throw new Error("close failed");
            },
            freeze: async () => {
                throw "freeze failed";
            },
            readFile: async () => {
                throw new Error("read failed");
            },
        },
    });
    const world = await openDeviceLayerWorld({
        adapter: "memory",
        adapters: [failing],
        root: hostRoot,
    });
    await assert.rejects(world.readFile("a.txt"), (error: unknown) =>
        codeOf(error, errors.operationCode, "read: read failed"),
    );
    await world.writeFile("a.txt", Buffer.from("a"));
    await assert.rejects(world.writeFile("a.txt", "text" as never), TypeError);
    await assert.rejects(world.checkpoint(1 as never), (error: unknown) =>
        codeOf(error, errors.checkpointInvalidCode, "1"),
    );
    await assert.rejects(world.restore(2 as never), (error: unknown) =>
        codeOf(error, errors.checkpointUnknownCode, "2"),
    );
    await assert.rejects(world.checkpoint("one"), (error: unknown) =>
        codeOf(error, errors.operationCode, "checkpoint: freeze failed"),
    );
    assert.equal(closed, 1);
    await assert.rejects(world.listFiles(), (error: unknown) =>
        codeOf(error, errors.closedCode, ""),
    );
    await world.close();
    assert.equal(closed, 1);
    assert.equal(readdirSync(hostRoot).includes(world.deviceId), false);

    const reverting = memoryAdapter({
        device: {
            close: async () => {
                throw new Error("close failed");
            },
            revert: async () => {
                throw new Error("revert failed");
            },
        },
    });
    const second = await openDeviceLayerWorld({
        adapter: "memory",
        adapters: [reverting],
        root: hostRoot,
    });
    await assert.rejects(second.restore(config.baseCheckpointName), (error: unknown) =>
        codeOf(error, errors.operationCode, "restore: revert failed"),
    );
    await assert.rejects(second.readFile("a.txt"), (error: unknown) =>
        codeOf(error, errors.closedCode, ""),
    );

    const closing = memoryAdapter({
        device: {
            close: async () => {
                throw new Error("close failed");
            },
        },
    });
    const third = await openDeviceLayerWorld({
        adapter: "memory",
        adapters: [closing],
        root: hostRoot,
    });
    await assert.rejects(third.close(), /close failed/u);
    await third.close();
    assert.equal(readdirSync(hostRoot).includes(third.deviceId), false);
});

test("world paths are portable and host worlds never traverse symbolic links", async () => {
    for (const invalid of [
        "",
        "/root",
        "a/",
        "a/../b",
        "./a",
        "tab\tname",
        "delete\u007f",
        "x".repeat(config.maxPathBytes + 1),
        5,
    ]) {
        assert.throws(
            () => readWorldPath(invalid),
            (error: unknown) => codeOf(error, errors.pathCode, ""),
        );
    }
    assert.equal(readWorldPath("a/b.c"), "a/b.c");
    assert.equal(layerName(7), "7".padStart(config.layerNameWidth, "0"));

    const outside = await mkdtemp(path.join(hostRoot, "outside-"));
    const seed = await mkdtemp(path.join(hostRoot, "seed-"));
    await writeFile(path.join(seed, "file.txt"), "file");
    await symlink("file.txt", path.join(seed, "link.txt"));
    const world = await openDeviceLayerWorld({
        adapter: config.adapters.copy,
        adapters: [createCopyDeviceLayerAdapter()],
        root: hostRoot,
        seed,
    });
    assert.deepEqual(
        (await world.listFiles()).map((entry) => entry.path),
        ["file.txt"],
    );
    await symlink(outside, path.join(world.path as string, "escape"));
    await assert.rejects(world.writeFile("escape/file.txt", Buffer.from("x")), (error: unknown) =>
        codeOf(error, errors.pathCode, "symbolic link"),
    );
    await world.checkpoint("with-links");
    await world.restore("with-links");
    assert.deepEqual(await readdir(outside), []);
    await world.close();

    execFileSync("mkfifo", [path.join(seed, "fifo")]);
    await assert.rejects(
        openDeviceLayerWorld({
            adapter: config.adapters.copy,
            adapters: [createCopyDeviceLayerAdapter()],
            root: hostRoot,
            seed,
        }),
        (error: unknown) => codeOf(error, errors.operationCode, "unsupported entry"),
    );
    await rm(outside, { recursive: true });
    await rm(seed, { recursive: true });
});

test("clone probes refuse broken scratch directories and overlay depth follows option bytes", async () => {
    await assert.rejects(
        createCloneDeviceLayerAdapter().probe({ root: path.join(hostRoot, "missing", "scratch") }),
        (error: unknown) => !(error instanceof DeviceLayerError),
    );
    const short = overlayMaxLayers("/l", "/t", "/u", "/w");
    assert.equal(short, config.depth.maxDepth);
    const long = `/${"d".repeat(config.overlay.maxMountOptionBytes / 4)}`;
    const limited = overlayMaxLayers(long, "/t", "/u", "/w");
    assert.ok(limited >= 1 && limited < 4);
    assert.equal(
        renderOverlayStackOptions({ lowers: ["/b", "/a"], target: "/t", writable: null }),
        config.overlay.readOnlyMountOptions.replace(
            workspaceProtocolConfig.carrierBackends.overlay.tokens.lower,
            `/b${config.overlay.lowerSeparator}/a`,
        ),
    );
    assert.match(
        renderOverlayStackOptions({
            lowers: ["/b", "/a"],
            target: "/t",
            writable: { upper: "/u", work: "/w" },
        }),
        /\/b:\/a.*\/u.*\/w/u,
    );
});

test("container adapter templates and list output are rendered and parsed exactly", () => {
    const tokens = config.container.tokens;
    assert.deepEqual(
        renderContainerTemplate([`${tokens.container}:${tokens.world}`, tokens.path, "plain"], {
            container: "c1",
            world: "/world",
        }),
        ["c1:/world", tokens.path, "plain"],
    );
    // Substitution is single-pass: a substituted value that contains a token stays literal.
    assert.deepEqual(
        renderContainerTemplate([tokens.path, `${tokens.world}/${tokens.path}`], {
            path: `/world/notes/${tokens.world}.txt`,
            world: "/world",
        }),
        [`/world/notes/${tokens.world}.txt`, `/world//world/notes/${tokens.world}.txt`],
    );
    const hex = "a".repeat(64);
    assert.deepEqual(parseContainerFileList(`${hex}  ./dir/file name.txt\n\n`), [
        {
            digest: `${workspaceProtocolConfig.carrier.blobIdPrefix}${hex}`,
            path: "dir/file name.txt",
        },
    ]);
    assert.throws(
        () => parseContainerFileList("not a digest line\n"),
        (error: unknown) => codeOf(error, errors.operationCode, "unexpected list output"),
    );
    assert.equal(createContainerDeviceLayerAdapter().name, config.adapters.container);
    assert.equal(
        createContainerDeviceLayerAdapter({ image: "other:tag" }).name,
        config.adapters.container,
    );
    assert.throws(() => createContainerDeviceLayerAdapter(null as never), TypeError);
    assert.throws(() => createContainerDeviceLayerAdapter({ image: "" }), TypeError);
    assert.throws(
        () => createContainerDeviceLayerAdapter({ image: "--privileged" }),
        /must not start with "-"/u,
    );
    assert.equal(
        digestOf(Buffer.from("")).startsWith(workspaceProtocolConfig.carrier.blobIdPrefix),
        true,
    );
});

function codeOf(error: unknown, code: string, fragment: string): boolean {
    return (
        error instanceof DeviceLayerError && error.code === code && error.message.includes(fragment)
    );
}

type MemoryAdapterOptions = {
    /** Device method overrides applied after opening. */
    readonly device?: Partial<DeviceLayerDevice>;
    /** Device stack limit. */
    readonly maxLayers?: number;
    /** Replacement open implementation. */
    readonly open?: (context: DeviceLayerOpenContext) => Promise<DeviceLayerDevice>;
    /** Replacement probe implementation. */
    readonly probe?: DeviceLayerAdapter["probe"];
};

/**
 * Creates a pure in-memory adapter implementing the device contract without host storage, used to
 * prove the adapter seam is pluggable and to drive engine failure paths.
 */
function memoryAdapter(options: MemoryAdapterOptions = {}): DeviceLayerAdapter {
    const openMemory = async (context: DeviceLayerOpenContext): Promise<DeviceLayerDevice> => {
        const frozen = new Map<string, Map<string, Buffer>>();
        frozen.set(context.baseLayer, readSeed(context.seed));
        let stack = [context.baseLayer];
        let world = new Map(frozen.get(context.baseLayer));
        const device: DeviceLayerDevice = {
            close: async () => undefined,
            freeze: async ({ compaction, layer }) => {
                frozen.set(layer, new Map(world));
                stack = [...stack, layer];
                if (compaction !== null) {
                    const merged = frozen.get(compaction.layers.at(-1) as string);
                    for (const flattened of compaction.layers) frozen.delete(flattened);
                    frozen.set(compaction.into, merged as Map<string, Buffer>);
                    stack = [compaction.into, ...stack.slice(compaction.layers.length)];
                }
            },
            listFiles: async () =>
                [...world].map(([file, bytes]) => ({ digest: digestOf(bytes), path: file })),
            maxLayers: options.maxLayers ?? 1000,
            path: null,
            readFile: async (file) => {
                const bytes = world.get(file);
                if (bytes === undefined) throw new Error(`absent: ${file}`);
                return Buffer.from(bytes);
            },
            removePath: async (target) => {
                for (const file of [...world.keys()]) {
                    if (file === target || file.startsWith(`${target}/`)) world.delete(file);
                }
            },
            revert: async (kept) => {
                for (const layer of stack.slice(kept.length)) frozen.delete(layer);
                stack = [...kept];
                world = new Map(frozen.get(kept.at(-1) as string));
            },
            writeFile: async (file, bytes) => {
                world.set(file, Buffer.from(bytes));
            },
        };
        return { ...device, ...options.device };
    };
    return {
        name: "memory",
        open: options.open ?? openMemory,
        probe: options.probe ?? (async () => ({ available: true })),
    };
}

function readSeed(seed: string | null): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    const visit = (directory: string, prefix: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(absolute, `${prefix}${entry.name}/`);
            else if (entry.isFile()) files.set(`${prefix}${entry.name}`, readFileSync(absolute));
        }
    };
    if (seed !== null) visit(seed, "");
    return files;
}
