import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { workspaceProtocolConfig } from "../protocol/config.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import { digestOf, openDeviceLayerWorld } from "./device-layer.ts";
import type {
    DeviceLayerAdapter,
    DeviceLayerConformanceCase,
    DeviceLayerConformanceReport,
    DeviceLayerWorld,
} from "./device-layer-types.ts";
import { DeviceLayerError } from "./errors.ts";
import type { BackendSelectionMode } from "./types.ts";

const CONFIG = workspaceProtocolConfig.deviceLayers;
const ERRORS = CONFIG.errors;

type WorldState = Readonly<Record<string, string>>;

/**
 * Runs the device-layer conformance kit against one adapter.
 *
 * Every case opens a fresh world through {@link openDeviceLayerWorld} in strict mode, so the
 * adapter is exercised through the same engine that production callers use. The kit covers probe
 * availability, seeding and file operations, path refusal, named checkpoints and restore with
 * discard of newer checkpoints, duplicate and invalid names, deletions that survive freezing, the
 * configured conformance depth bound with compaction and retirement of flattened names, exact
 * restoration of every retained checkpoint after compaction, and close semantics. A case failure
 * is reported, never thrown.
 *
 * @param adapter - Adapter under test; it must be available on this host.
 * @param options - Existing host directory used for seeds and device roots.
 * @returns Report listing every case in order.
 * @throws {TypeError} If options are malformed.
 * @example
 * const report = await checkDeviceLayerConformance(createCopyDeviceLayerAdapter(), { root });
 * assert.equal(report.passed, true);
 */
export async function checkDeviceLayerConformance(
    adapter: DeviceLayerAdapter,
    options: Readonly<{ root: string }>,
): Promise<DeviceLayerConformanceReport> {
    if (typeof options?.root !== "string") {
        throw new TypeError("device-layer conformance root must be a string");
    }
    const root = mkdtempSync(path.join(options.root, CONFIG.deviceDirectoryPrefix));
    const cases: DeviceLayerConformanceCase[] = [];
    const run = async (name: string, body: () => Promise<void>) => {
        try {
            await body();
            cases.push(Object.freeze({ error: null, name, passed: true }));
        } catch (error) {
            cases.push(
                Object.freeze({
                    error: error instanceof Error ? error.message : String(error),
                    name,
                    passed: false,
                }),
            );
        }
    };
    const seed = path.join(root, "seed");
    mkdirSync(path.join(seed, "nested", "deeper"), { recursive: true });
    const seeded: WorldState = {
        "a.txt": "alpha",
        "nested/b.txt": "bravo",
        "nested/deeper/c.txt": "charlie",
    };
    for (const [file, text] of Object.entries(seeded)) writeFileSync(path.join(seed, file), text);
    const open = (depth?: Readonly<{ maxDepth: number; retainNewest: number }>) =>
        openDeviceLayerWorld({
            adapter: adapter.name,
            adapters: [adapter],
            ...(depth === undefined ? {} : { depth }),
            root,
            seed,
            selection: CONFIG.selection.modes.strict as BackendSelectionMode,
        });
    const withWorld = async (
        body: (world: DeviceLayerWorld) => Promise<void>,
        depth?: Readonly<{ maxDepth: number; retainNewest: number }>,
    ) => {
        const world = await open(depth);
        try {
            await body(world);
        } finally {
            await world.close();
        }
    };

    try {
        await run("probe reports the adapter available", async () => {
            const scratch = mkdtempSync(path.join(root, CONFIG.deviceDirectoryPrefix));
            try {
                assert.deepEqual(await adapter.probe({ root: scratch }), { available: true });
            } finally {
                removePathSync(scratch, { force: true, recursive: true });
            }
        });
        await run("seeded files, writes, reads, and removals", () =>
            withWorld(async (world) => {
                assert.equal(world.adapter, adapter.name);
                assert.deepEqual(world.selection.attempts, [
                    { adapter: adapter.name, available: true, reason: CONFIG.reasons.available },
                ]);
                await assertState(world, seeded);
                await world.writeFile("new/file.bin", Buffer.from([0, 1, 2, 255]));
                await world.writeFile("a.txt", Buffer.from("alpha-2"));
                assert.deepEqual(await world.readFile("new/file.bin"), Buffer.from([0, 1, 2, 255]));
                await world.removePath("nested");
                await world.removePath("absent/path");
                const state = await readState(world);
                assert.deepEqual(Object.keys(state), ["a.txt", "new/file.bin"]);
                assert.equal(state["a.txt"], "alpha-2");
                for (const invalid of ["../escape", "/absolute", "a//b", "a/./b", "back\\slash"]) {
                    await assertCode(world.readFile(invalid), ERRORS.pathCode);
                }
            }),
        );
        await run("named checkpoints freeze state and restore discards newer ones", () =>
            withWorld(async (world) => {
                await world.writeFile("x.txt", Buffer.from("one"));
                const first = await world.checkpoint("one");
                assert.deepEqual(
                    [first.checkpoint, first.depth, first.compaction],
                    ["one", 2, null],
                );
                const one = await readState(world);
                await world.writeFile("x.txt", Buffer.from("two"));
                await world.removePath("a.txt");
                await world.writeFile("y.txt", Buffer.from("why"));
                await world.checkpoint("two");
                const two = await readState(world);
                assert.equal("a.txt" in two, false);
                await world.writeFile("scratch.txt", Buffer.from("discarded"));
                await assertCode(world.checkpoint("two"), ERRORS.checkpointInvalidCode);
                await assertCode(world.checkpoint("not a name"), ERRORS.checkpointInvalidCode);
                assert.deepEqual(
                    world.layers().map((layer) => [layer.index, layer.checkpoint]),
                    [
                        [0, CONFIG.baseCheckpointName],
                        [1, "one"],
                        [2, "two"],
                    ],
                );
                const restored = await world.restore("one");
                assert.deepEqual([restored.depth, restored.discarded], [2, ["two"]]);
                await assertState(world, one);
                await assertCode(world.restore("two"), ERRORS.checkpointUnknownCode);
                await world.checkpoint("two");
                await world.restore(CONFIG.baseCheckpointName);
                await assertState(world, seeded);
                assert.equal(world.layers().length, 1);
            }),
        );
        await run("depth bound compacts frozen layers and retires flattened names", () =>
            withWorld(
                async (world) => {
                    const states = new Map<string, WorldState>();
                    const retired: string[] = [];
                    for (let step = 1; step <= CONFIG.conformance.checkpoints; step += 1) {
                        await world.writeFile(`step-${step}.txt`, Buffer.from(`step ${step}`));
                        if (step === 2) await world.removePath("a.txt");
                        const name = `c${step}`;
                        const checkpoint = await world.checkpoint(name);
                        assert.ok(checkpoint.depth <= CONFIG.conformance.maxDepth);
                        assert.equal(world.layers().length, checkpoint.depth);
                        if (checkpoint.compaction !== null) {
                            assert.equal(checkpoint.depth, CONFIG.conformance.retainNewest + 1);
                            assert.equal(world.layers()[0]?.layer, checkpoint.compaction.into);
                            retired.push(...checkpoint.compaction.retired);
                        }
                        states.set(name, await readState(world));
                    }
                    assert.ok(retired.length > 0, "the depth bound never triggered compaction");
                    for (const name of retired) {
                        await assertCode(world.restore(name), ERRORS.checkpointRetiredCode);
                    }
                    for (const layer of [...world.layers()].reverse()) {
                        await world.writeFile("uncommitted.txt", Buffer.from("discarded"));
                        await world.restore(layer.checkpoint);
                        await assertState(world, states.get(layer.checkpoint) as WorldState);
                    }
                    await world.writeFile("after.txt", Buffer.from("after"));
                    await world.checkpoint("after-compaction");
                    assert.equal((await world.readFile("after.txt")).toString(), "after");
                },
                {
                    maxDepth: CONFIG.conformance.maxDepth,
                    retainNewest: CONFIG.conformance.retainNewest,
                },
            ),
        );
        await run("close releases the device and refuses later operations", async () => {
            const world = await open();
            await world.close();
            await world.close();
            await assertCode(world.readFile("a.txt"), ERRORS.closedCode);
            await assertCode(world.checkpoint("late"), ERRORS.closedCode);
            assert.equal(readdirSync(root).includes(world.deviceId), false);
        });
    } finally {
        removePathSync(root, { force: true, recursive: true });
    }
    return Object.freeze({
        adapter: adapter.name,
        cases: Object.freeze(cases),
        passed: cases.every((entry) => entry.passed),
    });
}

async function readState(world: DeviceLayerWorld): Promise<WorldState> {
    const state: Record<string, string> = {};
    for (const entry of await world.listFiles()) {
        const bytes = await world.readFile(entry.path);
        assert.equal(digestOf(bytes), entry.digest, `listed digest differs: ${entry.path}`);
        state[entry.path] = bytes.toString("utf8");
    }
    return state;
}

async function assertState(world: DeviceLayerWorld, expected: WorldState): Promise<void> {
    assert.deepEqual(await readState(world), expected);
}

async function assertCode(operation: Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(
        operation,
        (error: unknown) => error instanceof DeviceLayerError && error.code === code,
    );
}
