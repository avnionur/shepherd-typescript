import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalizeRecord, createRecordId, type SemanticRecord } from "../src/index.ts";

test("canonicalizeRecord sorts object keys recursively", () => {
    const record: SemanticRecord = {
        z: "last",
        nested: {
            b: null,
            a: true,
        },
        a: 1,
    };

    assert.equal(canonicalizeRecord(record), '{"a":1,"nested":{"a":true,"b":null},"z":"last"}');
});

test("canonicalizeRecord omits undefined object properties", () => {
    assert.equal(canonicalizeRecord({ present: true, omitted: undefined }), '{"present":true}');
});

test("canonicalizeRecord preserves array order", () => {
    assert.equal(canonicalizeRecord({ values: [3, 1, 2] }), '{"values":[3,1,2]}');
});

test("canonicalizeRecord rejects non-data array shapes", () => {
    assert.throws(
        () =>
            canonicalizeRecord({
                values: new Array(1) as SemanticRecord["values"],
            }),
        /sparse array/,
    );

    let getterCalled = false;
    const accessorArray = [1];
    Object.defineProperty(accessorArray, "0", {
        enumerable: true,
        get: () => {
            getterCalled = true;
            return 1;
        },
    });
    assert.throws(() => canonicalizeRecord({ values: accessorArray }), /accessor array element/);
    assert.equal(getterCalled, false);

    const symbolArray = [1];
    Object.defineProperty(symbolArray, Symbol("hidden"), { value: true });
    assert.throws(() => canonicalizeRecord({ values: symbolArray }), /symbol properties/);

    const customArray = [1];
    Object.defineProperty(customArray, "metadata", { value: true });
    assert.throws(() => canonicalizeRecord({ values: customArray }), /custom properties/);
});

test("canonicalizeRecord encodes negative zero as zero", () => {
    assert.equal(canonicalizeRecord({ value: -0 }), '{"value":0}');
});

test("canonicalizeRecord follows ECMAScript number and UTF-16 key serialization", () => {
    assert.equal(
        canonicalizeRecord({
            values: [1e-7, 1e-6, 1e21, Number("333333333.33333329")],
        }),
        '{"values":[1e-7,0.000001,1e+21,333333333.3333333]}',
    );
    assert.equal(canonicalizeRecord({ "\uE000": 1, "😀": 2 }), '{"😀":2,"":1}');
});

test("canonicalizeRecord rejects lone Unicode surrogates", () => {
    assert.equal(canonicalizeRecord({ value: "😀" }), '{"value":"😀"}');
    assert.throws(() => canonicalizeRecord({ value: "\uD800" }), /valid Unicode/);
    assert.throws(() => canonicalizeRecord({ "\uDC00": true }), /valid Unicode/);
});

test("canonicalizeRecord preserves keys that are special on object prototypes", () => {
    const record = Object.create(null) as Record<string, string>;
    Object.defineProperty(record, "__proto__", {
        enumerable: true,
        value: "semantic value",
    });

    assert.equal(canonicalizeRecord(record), '{"__proto__":"semantic value"}');
});

test("canonicalizeRecord does not mutate its input", () => {
    const nested = { z: 1, a: 2 };
    const record: SemanticRecord = { nested };

    canonicalizeRecord(record);

    assert.deepEqual(Object.keys(nested), ["z", "a"]);
});

test("canonicalizeRecord rejects values that JSON cannot represent canonically", () => {
    assert.throws(() => canonicalizeRecord({ value: Number.POSITIVE_INFINITY }), /finite number/);
    assert.throws(
        () =>
            canonicalizeRecord({
                values: [undefined] as unknown as SemanticRecord["values"],
            }),
        /undefined array element/,
    );
    assert.throws(
        () => canonicalizeRecord({ value: new Date() } as unknown as SemanticRecord),
        /plain objects/,
    );

    const symbolRecord = { value: true } as Record<PropertyKey, boolean>;
    symbolRecord[Symbol("hidden")] = true;
    assert.throws(() => canonicalizeRecord(symbolRecord as SemanticRecord), /symbol properties/);

    const accessorRecord = Object.defineProperty({}, "value", {
        enumerable: true,
        get: () => true,
    });
    assert.throws(() => canonicalizeRecord(accessorRecord as SemanticRecord), /accessor property/);

    let descriptorReads = 0;
    const unstableRecord = new Proxy(
        { value: true },
        {
            getOwnPropertyDescriptor(target, property) {
                descriptorReads += 1;
                return descriptorReads > 1
                    ? undefined
                    : Reflect.getOwnPropertyDescriptor(target, property);
            },
        },
    );
    assert.throws(() => canonicalizeRecord(unstableRecord), /changed during canonicalization/);
});

test("canonicalizeRecord rejects cyclic records", () => {
    const record: Record<string, SemanticRecord> = {};
    record.self = record;

    assert.throws(() => canonicalizeRecord(record), /cyclic record/);

    const array: unknown[] = [];
    array.push(array);
    assert.throws(
        () => canonicalizeRecord({ array } as unknown as SemanticRecord),
        /cyclic record/,
    );
});

test("createRecordId returns a stable prefixed SHA-256 digest", () => {
    assert.equal(
        createRecordId({ a: 1 }),
        "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    );
    assert.equal(createRecordId({ b: 2, a: 1 }), createRecordId({ a: 1, b: 2 }));
});
