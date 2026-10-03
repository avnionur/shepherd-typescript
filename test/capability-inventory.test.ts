import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import inventoryConfiguration from "../config/capability-inventory.config.json" with {
    type: "json",
};

import {
    checkCapabilityInventory,
    generateCapabilityInventory,
} from "../tooling/capability-inventory.ts";

test("capability inventory rejects a stale claim rather than accepting existing evidence links", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "capability-inventory-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const configuration = structuredClone(inventoryConfiguration);
    const configurationPath = path.join(directory, "inventory.json");
    assert.ok(configuration.rows[0]);
    configuration.rows[0].dimensions.api = "Unsupported: deliberately stale claim";
    await writeFile(configurationPath, JSON.stringify(configuration));
    await assert.rejects(checkCapabilityInventory({ configurationPath }), /inventory is stale/u);
});

test("capability inventory matches reviewed claims and rejects lost evidence and exports", async (context) => {
    await checkCapabilityInventory();
    const directory = await mkdtemp(path.join(tmpdir(), "capability-inventory-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const original = structuredClone(inventoryConfiguration);
    const configurationPath = path.join(directory, "inventory.json");
    for (const [mutate, expected] of [
        [
            (value: typeof original) => {
                assert.ok(value.rows[0]?.exports[0]);
                value.rows[0].exports[0].symbol = "missingPublicCapability";
            },
            /missing public export/u,
        ],
        [
            (value: typeof original) => {
                assert.ok(value.rows[0]?.evidence[0]);
                value.rows[0].evidence[0].sha256 = "0".repeat(64);
            },
            /evidence changed/u,
        ],
        [
            (value: typeof original) => {
                assert.ok(value.rows[0]);
                value.rows[0].dimensions.recovery = "";
            },
            /dimensions/u,
        ],
        [
            (value: typeof original) => {
                assert.ok(value.rows[0]);
                value.rows[0].evidence = [];
            },
            /evidence must not be empty/u,
        ],
        [
            (value: typeof original) => {
                value.artifact = "D:\\outside\\inventory.md";
            },
            /path must remain inside/u,
        ],
        [
            (value: typeof original) => {
                value.artifact = "../escaped-inventory.md";
            },
            /path must remain inside/u,
        ],
    ] as const) {
        const configuration = structuredClone(original);
        mutate(configuration);
        await writeFile(configurationPath, JSON.stringify(configuration));
        await assert.rejects(generateCapabilityInventory({ configurationPath }), expected);
    }
});
