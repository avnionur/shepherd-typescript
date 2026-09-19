import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BACKUP_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    STORE_BACKUP_BLOB_LOCATIONS,
    STORE_BACKUP_FAILURE_REASONS,
} from "../../src/protocol/values.generated.ts";

type Section = Record<string, unknown> & {
    layout: Record<string, unknown>;
    manifest: Record<string, unknown>;
};

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function assertRejected(mutate: (backup: Section) => void, message: RegExp): void {
    const config = structuredClone(validConfig);
    mutate(config.backup as Section);
    assert.throws(
        () => parseProtocolConfig(config),
        (error: unknown) => {
            assert.ok(error instanceof TypeError);
            assert.match(error.message, message);
            return true;
        },
    );
}

test("backup configuration parses, freezes, and matches generated vocabularies", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.equal(Object.isFrozen(parsed.backup.layout), true);
    assert.equal(parsed.backup.directoryMode, 0o700);
    assert.deepEqual(parsed.backup.blobLocations, STORE_BACKUP_BLOB_LOCATIONS);
    assert.deepEqual(parsed.backup.failureReasons, STORE_BACKUP_FAILURE_REASONS);
    assert.equal(
        parsed.backup.compatibilityVersion,
        BACKUP_PROTOCOL_V1_CONTRACT.compatibilityVersion,
    );
    assert.equal(Object.isFrozen(BACKUP_PROTOCOL_V1_CONTRACT), true);
});

test("backup configuration rejects unsafe modes, digests, layouts, and formats", () => {
    assertRejected((backup) => {
        backup.digestPrefix = "sha512:";
    }, /digestPrefix must identify/u);
    // Replication stores and fetches the database under its manifest digest as a blob identifier.
    assertRejected((backup) => {
        backup.digestAlgorithm = "sha512";
        backup.digestPrefix = "sha512:";
    }, /must equal kernel\.store\.blobs\.digestAlgorithm and idPrefix/u);
    // A write-ahead-log backup copy would depend on sidecar files the manifest does not cover.
    assertRejected((backup) => {
        backup.databaseJournalMode = "WAL";
    }, /backup\.databaseJournalMode/u);
    for (const mode of ["0750", "0600", "700", "07000"]) {
        assertRejected((backup) => {
            backup.directoryMode = mode;
        }, /owner-only octal directory mode/u);
    }
    for (const name of ["a/b", ".", "..", "with space"]) {
        assertRejected((backup) => {
            backup.layout.database = name;
        }, /portable path segment/u);
    }
    assertRejected((backup) => {
        backup.layout.manifest = backup.layout.database;
    }, /layout names must be distinct/u);
    assertRejected((backup) => {
        backup.manifest.format = "shepherd.trace.archive";
    }, /must differ from the importable archive format/u);
    assertRejected((backup) => {
        backup.extra = true;
    }, /backup must contain exactly/u);
});

test("backup wire constants are pinned by the backup v1 contract", () => {
    assertRejected((backup) => {
        backup.failureReasons = ["manifest-missing"];
    }, /backup wire constants require a new backup protocol/u);
    assertRejected((backup) => {
        backup.manifest.formatVersion = 2;
    }, /backup wire constants require a new backup protocol/u);
});
