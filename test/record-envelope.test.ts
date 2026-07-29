import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    createRecordEnvelope,
    KERNEL_ABI_VERSION,
    KERNEL_CANONICAL_VERSION,
    type RecordBody,
    type RecordEnvelopeDraft,
    type RecordMode,
    validateRecordBody,
    validateRecordEnvelope,
} from "../src/index.ts";

type Fixture = {
    readonly abi_version: string;
    readonly canonical_version: string;
    readonly records: readonly FixtureRecord[];
};

type FixtureRecord = {
    readonly name: string;
    readonly digest: string;
    readonly input: {
        readonly body: RecordBody;
        readonly caused_by: readonly string[];
        readonly kind: string;
        readonly mode: RecordMode;
        readonly schema_ref: string;
        readonly witness: string;
    };
};

const fixtureUrl = new URL("./fixtures/kernel-record-envelope-v0.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as Fixture;

test("record protocol versions match the shared fixture", () => {
    assert.equal(KERNEL_ABI_VERSION, fixture.abi_version);
    assert.equal(KERNEL_CANONICAL_VERSION, fixture.canonical_version);
});

test("createRecordEnvelope matches the pinned cross-language vectors", () => {
    for (const vector of fixture.records) {
        const envelope = createRecordEnvelope({
            body: vector.input.body,
            caused_by_record_ids: vector.input.caused_by,
            mode: vector.input.mode,
            schema_ref: vector.input.schema_ref,
            witness_ref: vector.input.witness,
        });

        assert.deepEqual(
            envelope,
            {
                record_id: vector.digest,
                digest: vector.digest,
                schema_ref: vector.input.schema_ref,
                mode: vector.input.mode,
                witness_ref: vector.input.witness,
                caused_by_record_ids: vector.input.caused_by,
            },
            vector.name,
        );
    }
});

test("record validators accept valid bodies and envelopes", () => {
    const body: unknown = { nested: { value: true }, values: [1, null, "three"] };
    validateRecordBody(body);

    const envelope = createRecordEnvelope({
        body,
        mode: "capture",
        schema_ref: "example.record.v1",
        witness_ref: fixture.records[1]?.input.witness ?? "",
    });

    validateRecordEnvelope(envelope, body);
});

test("validateRecordBody rejects non-record and non-canonical values", () => {
    assert.throws(() => validateRecordBody(null), /plain object/);
    assert.throws(() => validateRecordBody("record"), /plain object/);
    assert.throws(() => validateRecordBody([]), /plain object/);
    assert.throws(() => validateRecordBody(new Date()), /plain objects/);
});

test("createRecordEnvelope rejects malformed semantic fields", () => {
    const ordinaryWitness = fixture.records[1]?.input.witness;
    assert.ok(ordinaryWitness);
    const draft: RecordEnvelopeDraft = {
        body: {},
        mode: "capture",
        schema_ref: "example.record.v1",
        witness_ref: ordinaryWitness,
    };

    assert.throws(
        () => createRecordEnvelope({ ...draft, schema_ref: 1 as unknown as string }),
        /schema_ref/,
    );
    assert.throws(() => createRecordEnvelope({ ...draft, schema_ref: "" }), /schema_ref/);
    assert.throws(
        () => createRecordEnvelope({ ...draft, mode: 1 as unknown as RecordMode }),
        /mode/,
    );
    assert.throws(
        () =>
            createRecordEnvelope({
                ...draft,
                mode: "observed" as RecordMode,
            }),
        /mode/,
    );
    assert.throws(
        () => createRecordEnvelope({ ...draft, witness_ref: "md5:value" }),
        /witness_ref/,
    );
    assert.throws(
        () => createRecordEnvelope({ ...draft, witness_ref: "sha256:abcd" }),
        /witness_ref/,
    );
    assert.throws(
        () =>
            createRecordEnvelope({
                ...draft,
                witness_ref: `sha256:${"G".repeat(64)}`,
            }),
        /witness_ref/,
    );
    assert.throws(
        () =>
            createRecordEnvelope({
                ...draft,
                caused_by_record_ids: ["invalid"],
            }),
        /caused_by_record_ids/,
    );
    assert.throws(
        () =>
            createRecordEnvelope({
                ...draft,
                caused_by_record_ids: "parent" as unknown as readonly string[],
            }),
        /array/,
    );
});

test("createRecordEnvelope enforces the configured root witness", () => {
    const root = fixture.records[0];
    const ordinaryWitness = fixture.records[1]?.input.witness;
    assert.ok(root);
    assert.ok(ordinaryWitness);
    const rootDraft: RecordEnvelopeDraft = {
        body: root.input.body,
        caused_by_record_ids: [],
        mode: root.input.mode,
        schema_ref: root.input.schema_ref,
        witness_ref: "",
    };

    assert.throws(
        () => createRecordEnvelope({ ...rootDraft, schema_ref: "example.record.v1" }),
        /reserved/,
    );
    assert.throws(
        () => createRecordEnvelope({ ...rootDraft, mode: "declaration" }),
        /root witness mode/,
    );
    assert.throws(
        () =>
            createRecordEnvelope({
                ...rootDraft,
                caused_by_record_ids: [`sha256:${"1".repeat(64)}`],
            }),
        /causal parents/,
    );
    assert.throws(
        () => createRecordEnvelope({ ...rootDraft, body: { actor_ref: "kernel:not-root" } }),
        /root witness body/,
    );
    assert.throws(
        () => createRecordEnvelope({ ...rootDraft, witness_ref: ordinaryWitness }),
        /empty witness_ref/,
    );
});

test("validateRecordEnvelope rejects invalid shapes and identities", () => {
    const ordinaryWitness = fixture.records[1]?.input.witness;
    assert.ok(ordinaryWitness);
    const body: RecordBody = { value: 1 };
    const envelope = createRecordEnvelope({
        body,
        mode: "capture",
        schema_ref: "example.record.v1",
        witness_ref: ordinaryWitness,
    });

    assert.throws(() => validateRecordEnvelope(null, body), /plain object/);
    assert.throws(() => validateRecordEnvelope("envelope", body), /plain object/);
    assert.throws(() => validateRecordEnvelope([], body), /plain object/);
    assert.throws(() => validateRecordEnvelope({}, body), /exactly/);
    assert.throws(() => validateRecordEnvelope({ ...envelope, extra: true }, body), /exactly/);
    assert.throws(() => validateRecordEnvelope({ ...envelope, extra: undefined }, body), /exactly/);
    assert.throws(
        () => validateRecordEnvelope({ ...envelope, schema_ref: "" }, body),
        /schema_ref/,
    );
    assert.throws(() => validateRecordEnvelope({ ...envelope, mode: "observed" }, body), /mode/);
    assert.throws(
        () => validateRecordEnvelope({ ...envelope, witness_ref: 1 }, body),
        /witness_ref/,
    );
    assert.throws(
        () => validateRecordEnvelope({ ...envelope, caused_by_record_ids: "parent" }, body),
        /array/,
    );
    assert.throws(
        () => validateRecordEnvelope({ ...envelope, caused_by_record_ids: ["invalid"] }, body),
        /caused_by_record_ids/,
    );
    assert.throws(
        () => validateRecordEnvelope({ ...envelope, record_id: "invalid" }, body),
        /record_id/,
    );
    assert.throws(() => validateRecordEnvelope({ ...envelope, digest: "invalid" }, body), /digest/);
    assert.throws(
        () =>
            validateRecordEnvelope(
                {
                    ...envelope,
                    record_id: `sha256:${"0".repeat(64)}`,
                    digest: `sha256:${"0".repeat(64)}`,
                },
                body,
            ),
        /identity/,
    );
});
