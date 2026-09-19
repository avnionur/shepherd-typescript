import assert from "node:assert/strict";

import {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
    validateRecordBody,
    validateRecordEnvelope,
} from "../../../src/index.ts";
import { recordIdConfig } from "../../../src/protocol/config.ts";
import type { RecordBody } from "../../../src/record/types.ts";
import { decodeAppendReceipt, encodeAppendReceipt } from "../../../src/store/codec.ts";
import type { FuzzInput, FuzzTarget } from "../harness.ts";
import { archiveSeeds } from "./seeds.ts";

// U+2028 and an astral character, built from code points so formatting keeps them visible.
const UNICODE_SEED = String.fromCodePoint(0x2028, 0x1f600);

/** Asserts that canonical JSON re-encodes to itself. */
export function assertCanonicalStable(json: string): void {
    assert.equal(canonicalizeRecord(JSON.parse(json) as SemanticRecord), json);
}

function inputValue(input: FuzzInput): unknown {
    return input.kind === "value" ? input.value : JSON.parse(input.text);
}

const bodySeeds = (): readonly FuzzInput[] => [
    ...archiveSeeds().records.map(({ body }) => ({ kind: "value" as const, value: body })),
    { kind: "value", value: { empty: {}, list: [], number: -0.25, unicode: UNICODE_SEED } },
];

const canonicalize: FuzzTarget = {
    name: "canonicalizeRecord",
    prepare: async () => ({
        execute: (input) => canonicalizeRecord(inputValue(input) as SemanticRecord),
        seeds: bodySeeds(),
        verifyAccepted: (result) => assertCanonicalStable(result as string),
    }),
};

const recordId: FuzzTarget = {
    name: "createRecordId",
    prepare: async () => ({
        execute: (input) => {
            const value = inputValue(input) as SemanticRecord;
            return { canonical: canonicalizeRecord(value), id: createRecordId(value) };
        },
        seeds: bodySeeds(),
        verifyAccepted: (result) => {
            const { canonical, id } = result as { canonical: string; id: string };
            assert.match(
                id,
                new RegExp(`^${recordIdConfig.prefix}[0-9a-f]{${recordIdConfig.hexLength}}$`, "u"),
            );
            assert.equal(createRecordId(JSON.parse(canonical) as SemanticRecord), id);
        },
    }),
};

const recordBody: FuzzTarget = {
    name: "validateRecordBody",
    prepare: async () => ({
        execute: (input) => {
            const value = inputValue(input);
            validateRecordBody(value);
            return value;
        },
        seeds: bodySeeds(),
        verifyAccepted: (result) =>
            assertCanonicalStable(canonicalizeRecord(result as SemanticRecord)),
    }),
};

const recordEnvelope: FuzzTarget = {
    name: "validateRecordEnvelope",
    prepare: async () => ({
        execute: (input) => {
            const pair = inputValue(input) as { body?: unknown; envelope?: unknown } | null;
            const body = pair?.body;
            validateRecordEnvelope(pair?.envelope, body as RecordBody);
            return pair;
        },
        seeds: archiveSeeds().records.map((record) => ({ kind: "value", value: record })),
        verifyAccepted: (result) => {
            const { body, envelope } = result as { body: RecordBody; envelope: SemanticRecord };
            assertCanonicalStable(canonicalizeRecord(envelope));
            // An accepted envelope names the identity of its canonical semantic input.
            assert.equal(envelope.record_id, envelope.digest);
            validateRecordEnvelope(JSON.parse(canonicalizeRecord(envelope)), body);
        },
    }),
};

const appendReceipt: FuzzTarget = {
    name: "decodeAppendReceipt",
    prepare: async () => {
        const receipts = archiveSeeds().receipts;
        return {
            execute: (input) => {
                const text = (input as { text: string }).text;
                // The lookup key is the intent the receipt text claims, when it still parses.
                let expected = (receipts.find(({ json }) => text === json) ?? receipts[0])
                    ?.id as string;
                try {
                    const claimed = (JSON.parse(text) as { append_intent_id?: unknown })
                        .append_intent_id;
                    if (typeof claimed === "string") expected = claimed;
                } catch {
                    // Unparseable text keeps the seed identity; decode must still refuse it.
                }
                return encodeAppendReceipt(decodeAppendReceipt(text, expected));
            },
            seeds: receipts.map(({ json }) => ({ kind: "text", text: json })),
            verifyAccepted: (result) => {
                const encoded = result as string;
                assertCanonicalStable(encoded);
                const id = (JSON.parse(encoded) as { append_intent_id: string }).append_intent_id;
                assert.equal(encodeAppendReceipt(decodeAppendReceipt(encoded, id)), encoded);
            },
        };
    },
};

/** Canonical encoding, record identity, record validation, and append-receipt targets. */
export const RECORD_TARGETS: readonly FuzzTarget[] = [
    canonicalize,
    recordId,
    recordBody,
    recordEnvelope,
    appendReceipt,
];
