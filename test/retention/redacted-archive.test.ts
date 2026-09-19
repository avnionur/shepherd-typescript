import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import {
    exportRedactedTraceArchive,
    RedactedTraceArchiveError,
    SQLiteTraceStore,
    verifyRedactedTraceArchive,
} from "../../src/index.ts";
import { decodeTraceArchive } from "../../src/interchange/decode.ts";
import { CLEAN_TEXT, SECRET_SAMPLES, singleRecordRequest } from "./fixtures.ts";

type Archive = Record<string, unknown> & {
    records: Record<string, unknown>[];
    record_views: Record<string, unknown>[];
    cuts: Record<string, unknown>[];
    blobs: Record<string, unknown>[];
    append_intents: Record<string, unknown>[];
};

const MEMORY_SCHEMA = "retention.test.memory.v1";
const GENERAL_SCHEMA = "retention.test.event.v1";
const options = { schemaDataClasses: { [MEMORY_SCHEMA]: "memory-adapter" as const } };
const config = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as {
    readonly supervision: { readonly traceSchemas: { readonly context: string } };
    readonly replay: { readonly traceSchemas: { readonly checkpoint: string } };
};
const secret = SECRET_SAMPLES["github-token"] as string;
const pem = SECRET_SAMPLES["pem-private-key"] as string;

function populatedStore(): SQLiteTraceStore {
    const store = new SQLiteTraceStore();
    const clean = store.append(
        singleRecordRequest("intent:clean", "owner:general", GENERAL_SCHEMA, { text: CLEAN_TEXT }),
    );
    store.append(
        singleRecordRequest("intent:leak", "owner:general", GENERAL_SCHEMA, { token: secret }),
    );
    store.append(
        singleRecordRequest(
            "intent:context",
            "owner:context",
            config.supervision.traceSchemas.context,
            {
                note: CLEAN_TEXT,
            },
        ),
    );
    store.append(
        singleRecordRequest(
            "intent:context-secret",
            "owner:context",
            config.supervision.traceSchemas.context,
            {
                key: pem,
            },
        ),
    );
    store.append(
        singleRecordRequest("intent:memory", "owner:memory", MEMORY_SCHEMA, { memory: secret }),
    );
    store.append(
        singleRecordRequest(
            "intent:checkpoint",
            "owner:checkpoint",
            config.replay.traceSchemas.checkpoint,
            {
                world: CLEAN_TEXT,
            },
        ),
    );
    store.putBlob(new TextEncoder().encode(`blob ${secret}`));
    store.publishCut({
        cut_id: "cut:general",
        target_owner_id: "owner:general",
        through_record_id: clean.record_ids[0] as string,
    });
    return store;
}

function mutate(archiveJson: string, change: (archive: Archive) => void): string {
    const archive = JSON.parse(archiveJson) as Archive;
    change(archive);
    return JSON.stringify(archive);
}

function recordBySchema(archive: Archive, schemaRef: string, index = 0): Record<string, unknown> {
    return archive.records.filter(
        (record) => (record.envelope as { schema_ref: string }).schema_ref === schemaRef,
    )[index] as Record<string, unknown>;
}

test("redacted export keeps identities, applies dispositions, and never carries secrets", () => {
    using store = populatedStore();
    const redacted = exportRedactedTraceArchive(store, options);
    for (const value of [secret, pem, "blob "]) {
        assert.equal(redacted.includes(value), false);
    }
    const archive = JSON.parse(redacted) as Archive;
    const native = decodeTraceArchive(store.exportTrace());
    assert.deepEqual(
        archive.records.map((record) => (record.envelope as { record_id: string }).record_id),
        native.records.map(({ envelope }) => envelope.record_id),
    );
    assert.deepEqual(
        archive.blobs,
        native.blobs.map(({ blob_id, byte_length }) => ({ blob_id, byte_length })),
    );
    assert.equal(archive.cuts.length, 1);
    const summary = verifyRedactedTraceArchive(redacted, options);
    assert.deepEqual(summary, {
        blob_count: 1,
        cut_count: 1,
        included_record_count: 4,
        omitted_body_count: 1,
        record_count: 8,
        record_view_count: 7,
        redacted_record_count: 3,
        secret_record_count: 2,
    });
    assert.equal(Object.isFrozen(summary), true);

    const leaked = recordBySchema(archive, GENERAL_SCHEMA, 0);
    const general = [
        recordBySchema(archive, GENERAL_SCHEMA, 0),
        recordBySchema(archive, GENERAL_SCHEMA, 1),
    ];
    const forced = general.find((record) => record.disposition === "redact") as Record<
        string,
        unknown
    >;
    assert.ok(leaked);
    assert.deepEqual((forced.body as { secret_classes: string[] }).secret_classes, [
        "github-token",
    ]);
    assert.equal(forced.data_class, "general");
    const memory = recordBySchema(archive, MEMORY_SCHEMA);
    assert.deepEqual(memory.body, {
        body_digest: null,
        data_class: "memory-adapter",
        redacted: true,
        secret_classes: [],
    });
    const contextRecords = [0, 1].map((index) =>
        recordBySchema(archive, config.supervision.traceSchemas.context, index),
    );
    assert.ok(contextRecords.every((record) => record.disposition === "redact"));
    assert.deepEqual(
        contextRecords
            .map((record) => (record.body as { secret_classes: string[] }).secret_classes)
            .sort(),
        [[], ["pem-private-key"]],
    );
    assert.equal(
        recordBySchema(archive, config.replay.traceSchemas.checkpoint).disposition,
        "include",
    );
    assert.equal(exportRedactedTraceArchive(store, options), redacted);
});

test("redacted archives validate against the generated schema", () => {
    using store = populatedStore();
    const redacted = JSON.parse(exportRedactedTraceArchive(store, options)) as Archive;
    const validator = new Ajv2020({ strict: true });
    for (const name of ["record-body-v0", "record-envelope-v0"]) {
        validator.addSchema(
            JSON.parse(
                readFileSync(
                    new URL(`../../spec/schemas/${name}.schema.json`, import.meta.url),
                    "utf8",
                ),
            ) as AnySchemaObject,
        );
    }
    const validate = validator.compile(
        JSON.parse(
            readFileSync(
                new URL(
                    "../../spec/schemas/redacted-trace-archive-v1.schema.json",
                    import.meta.url,
                ),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validate(redacted), true, validator.errorsText(validate.errors));
    const leaked = structuredClone(redacted);
    (leaked.blobs[0] as Record<string, unknown>).content_base64 = "";
    assert.equal(validate(leaked), false);
    const unmarked = structuredClone(redacted);
    const marker = unmarked.records.find((record) => record.disposition === "redact") as Record<
        string,
        unknown
    >;
    marker.body = { text: CLEAN_TEXT };
    assert.equal(validate(unmarked), false);
});

test("redacted archives are refused by every import path", () => {
    using store = populatedStore();
    const redacted = exportRedactedTraceArchive(store, options);
    using target = new SQLiteTraceStore();
    using refusing = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    for (const importer of [
        () => target.importTrace(redacted),
        () => refusing.importTrace(redacted),
        () => decodeTraceArchive(redacted),
    ]) {
        assert.throws(importer, (error: unknown) => {
            assert.ok(error instanceof RedactedTraceArchiveError);
            assert.ok(error instanceof TypeError);
            assert.equal(error.code, "REDACTED_TRACE_ARCHIVE_ERROR");
            return true;
        });
    }
    assert.equal(target.verifyIntegrity().ok, true);
    assert.equal(target.readOwner("owner:general").length, 0);
    assert.throws(
        () => decodeTraceArchive("null"),
        (error: unknown) => !(error instanceof RedactedTraceArchiveError),
    );
});

test("redacted archive verification rejects malformed or policy-violating archives", () => {
    using store = populatedStore();
    const redacted = exportRedactedTraceArchive(store, options);
    const general = (archive: Archive, disposition: string) =>
        archive.records.find(
            (record) =>
                (record.envelope as { schema_ref: string }).schema_ref === GENERAL_SCHEMA &&
                record.disposition === disposition,
        ) as Record<string, unknown>;
    const context = (archive: Archive) =>
        recordBySchema(archive, config.supervision.traceSchemas.context);
    const memory = (archive: Archive) => recordBySchema(archive, MEMORY_SCHEMA);
    const cases: readonly (string | ((archive: Archive) => void))[] = [
        "not json",
        (archive) => {
            archive.extra = true;
        },
        (archive) => {
            archive.format_version = 2;
        },
        (archive) => {
            archive.records = {} as never;
        },
        (archive) => {
            archive.records.reverse();
        },
        (archive) => {
            (archive.records[0] as Record<string, unknown>).envelope = { record_id: "x" };
        },
        (archive) => {
            const envelope = (archive.records[1] as { envelope: Record<string, unknown> }).envelope;
            envelope.digest = (
                archive.records[0] as { envelope: { record_id: string } }
            ).envelope.record_id;
        },
        (archive) => {
            const envelope = (archive.records[1] as { envelope: Record<string, unknown> }).envelope;
            envelope.witness_ref = "not-a-record";
        },
        (archive) => {
            general(archive, "include").data_class = "context";
        },
        (archive) => {
            (general(archive, "include").body as Record<string, unknown>).text = "changed";
        },
        (archive) => {
            (general(archive, "include").body as Record<string, unknown>).text = secret;
        },
        (archive) => {
            const forced = general(archive, "redact");
            forced.disposition = "include";
            forced.body = { token: secret };
        },
        (archive) => {
            general(archive, "include").disposition = "unknown";
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).secret_classes = [];
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).secret_classes = "x";
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).secret_classes = [
                "unknown",
            ];
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).secret_classes = [
                "github-token",
                "github-token",
            ];
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).secret_classes = [1];
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).redacted = false;
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).data_class = "context";
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).body_digest = null;
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).body_digest = 7;
        },
        (archive) => {
            (general(archive, "redact").body as Record<string, unknown>).body_digest = "sha256:xyz";
        },
        (archive) => {
            general(archive, "redact").body = { token: CLEAN_TEXT };
        },
        (archive) => {
            context(archive).disposition = "include";
        },
        (archive) => {
            context(archive).disposition = "omit-body";
        },
        (archive) => {
            memory(archive).disposition = "redact";
            (memory(archive).body as Record<string, unknown>).body_digest =
                `sha256:${"0".repeat(64)}`;
        },
        (archive) => {
            (memory(archive).body as Record<string, unknown>).body_digest =
                `sha256:${"0".repeat(64)}`;
        },
        (archive) => {
            (memory(archive).body as Record<string, unknown>).secret_classes = ["github-token"];
        },
        (archive) => {
            archive.record_views = {} as never;
        },
        (archive) => {
            (archive.record_views[0] as Record<string, unknown>).owner_ordinal = -1;
        },
        (archive) => {
            (archive.record_views[0] as Record<string, unknown>).record_id =
                `sha256:${"f".repeat(64)}`;
        },
        (archive) => {
            (archive.cuts[0] as Record<string, unknown>).through_record_id =
                `sha256:${"f".repeat(64)}`;
        },
        (archive) => {
            (archive.cuts[0] as Record<string, unknown>).cut_id = "";
        },
        (archive) => {
            (archive.append_intents[0] as Record<string, unknown>).batch_digest = "bad";
        },
        (archive) => {
            (archive.blobs[0] as Record<string, unknown>).blob_id = "bad";
        },
        (archive) => {
            (archive.blobs[0] as Record<string, unknown>).byte_length = -1;
        },
        (archive) => {
            (archive.blobs[0] as Record<string, unknown>).content_base64 = "";
        },
    ];
    for (const [index, change] of cases.entries()) {
        const text = typeof change === "string" ? change : mutate(redacted, change);
        assert.throws(
            () => verifyRedactedTraceArchive(text, options),
            (error: unknown) => {
                assert.ok(error instanceof RedactedTraceArchiveError, `case ${index}`);
                assert.equal(error.message.includes(secret), false);
                return true;
            },
        );
    }
    assert.throws(() => verifyRedactedTraceArchive(1 as never), RedactedTraceArchiveError);
    assert.throws(() => verifyRedactedTraceArchive(redacted), RedactedTraceArchiveError);
    assert.throws(() => verifyRedactedTraceArchive(redacted, { extra: 1 } as never), TypeError);
    assert.throws(() => exportRedactedTraceArchive(store, { extra: 1 } as never), TypeError);
});
