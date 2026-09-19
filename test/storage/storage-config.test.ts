import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { STORAGE_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    STORAGE_DURABILITIES,
    STORAGE_LEASE_STATUSES,
    STORAGE_REF_SWAP_STATUSES,
} from "../../src/protocol/values.generated.ts";

type Section = Record<string, unknown> & {
    blobs: Record<string, unknown>;
    coordinator: Record<string, unknown>;
    leases: Record<string, unknown>;
    names: Record<string, unknown>;
    statuses: Record<string, unknown>;
};

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function assertRejected(mutate: (storage: Section) => void, message: RegExp): void {
    const config = structuredClone(validConfig);
    mutate(config.storage as Section);
    assert.throws(
        () => parseProtocolConfig(config),
        (error: unknown) => {
            assert.ok(error instanceof TypeError);
            assert.match(error.message, message);
            return true;
        },
    );
}

test("storage configuration parses, freezes, and matches generated vocabularies", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.equal(Object.isFrozen(parsed.storage.coordinator.migrations), true);
    assert.deepEqual(parsed.storage.durabilities, STORAGE_DURABILITIES);
    assert.deepEqual(parsed.storage.statuses.lease, STORAGE_LEASE_STATUSES);
    assert.deepEqual(parsed.storage.statuses.refSwap, STORAGE_REF_SWAP_STATUSES);
    assert.equal(
        parsed.storage.compatibilityVersion,
        STORAGE_PROTOCOL_V1_CONTRACT.compatibilityVersion,
    );
});

test("storage configuration rejects inconsistent bounds, grammars, and migrations", () => {
    assertRejected((storage) => {
        storage.blobs.defaultListLimit = (storage.blobs.maxListLimit as number) + 1;
    }, /defaultListLimit must not exceed/u);
    assertRejected((storage) => {
        storage.leases.minTtlMilliseconds = (storage.leases.maxTtlMilliseconds as number) + 1;
    }, /minTtlMilliseconds must not exceed/u);
    assertRejected((storage) => {
        storage.names.pattern = "^[a-$";
    }, /valid regular expression/u);
    assertRejected((storage) => {
        storage.names.pattern = "[a-z]+";
    }, /anchored/u);
    assertRejected((storage) => {
        storage.names.pattern = "^[a-z]*$";
    }, /empty string/u);
    assertRejected((storage) => {
        storage.coordinator.migrations = [];
    }, /contiguous/u);
    assertRejected((storage) => {
        storage.coordinator.migrations = [2];
    }, /contiguous/u);
    assertRejected((storage) => {
        storage.coordinator.schemaVersion = 2;
    }, /latest migration/u);
    assertRejected((storage) => {
        storage.coordinator.journalMode = "DELETE";
    }, /storage\.coordinator\.journalMode/u);
    assertRejected((storage) => {
        storage.coordinator.defensive = false;
    }, /storage\.coordinator\.defensive/u);
    assertRejected((storage) => {
        storage.extra = true;
    }, /storage must contain exactly/u);
});

test("storage vocabularies are pinned by the storage v1 contract", () => {
    assertRejected((storage) => {
        storage.statuses.lease = ["acquired", "held", "renewed", "released", "revoked"];
    }, /storage vocabularies require a new storage protocol/u);
    assertRejected((storage) => {
        storage.durabilities = ["durable"];
    }, /storage vocabularies require a new storage protocol/u);
    assert.equal(Object.isFrozen(STORAGE_PROTOCOL_V1_CONTRACT), true);
});
