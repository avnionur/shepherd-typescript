import assert from "node:assert/strict";
import { test } from "node:test";

import { serializeJsonText } from "../src/canonical/json-text.ts";

/** Small deterministic PRNG (mulberry32) so a failing case reproduces from its seed. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

const STRINGS = [
    "",
    "a",
    'q"uote',
    "back\\slash",
    "line\nbreak",
    String.fromCharCode(0, 0x1f),
    "é😀",
    String.fromCharCode(0x2028, 0xd800),
];
const NUMBERS = [0, -0, 1, -1.5, 1e21, 1e-7, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY];
const KEYS = ["a", "b", "", "0", "10", "2", "__proto__x", 'k"ey', "é"];

function scalar(next: () => number): unknown {
    const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
    switch (Math.floor(next() * 7)) {
        case 0:
            return pick(STRINGS);
        case 1:
            return pick(NUMBERS);
        case 2:
            return next() < 0.5;
        case 3:
            return null;
        case 4:
            return undefined;
        case 5:
            return next() < 0.5 ? () => 1 : Symbol("s");
        default:
            return Math.floor(next() * 1_000_000) - 500_000;
    }
}

/** Builds a random tree shaped like telemetry batches: nested plain objects and arrays. */
function tree(next: () => number, depth: number): unknown {
    if (depth === 0 || next() < 0.3) return scalar(next);
    const size = Math.floor(next() * 5);
    if (next() < 0.5) {
        return Array.from({ length: size }, () => tree(next, depth - 1));
    }
    const record: Record<string, unknown> = {};
    for (let index = 0; index < size; index += 1) {
        record[KEYS[Math.floor(next() * KEYS.length)] as string] = tree(next, depth - 1);
    }
    return record;
}

test("serializeJsonText is byte-identical to JSON.stringify on random plain JSON data", () => {
    let compared = 0;
    for (let seed = 1; seed <= 5_000; seed += 1) {
        const next = random(seed);
        const value = next() < 0.5 ? tree(next, 6) : [tree(next, 6)];
        const expected = JSON.stringify(value);
        if (expected === undefined) continue;
        assert.equal(serializeJsonText(value), expected, `seed ${seed}`);
        compared += 1;
    }
    assert.ok(compared > 4_000);
});

test("serializeJsonText matches JSON.stringify on omission, ordering, and scalar edge cases", () => {
    const shared = { x: 1 };
    for (const value of [
        { c: undefined, b: [undefined, () => 1, Symbol("s")], a: "x" },
        { 2: "two", b: "b", 1: "one", a: "a" },
        { only: undefined },
        [],
        {},
        "str",
        -0,
        Number.NaN,
        null,
        true,
        [shared, shared, { shared }],
        Object.assign(Object.create(null) as object, { z: 1, y: [2] }),
    ]) {
        assert.equal(serializeJsonText(value), JSON.stringify(value));
    }
});

test("serializeJsonText refuses what JSON.stringify refuses", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = { back: cyclic };
    const cyclicArray: unknown[] = [];
    cyclicArray.push([cyclicArray]);
    for (const value of [cyclic, cyclicArray]) {
        assert.throws(() => JSON.stringify(value), TypeError);
        assert.throws(() => serializeJsonText(value), /contains a cycle/u);
    }
    assert.throws(() => serializeJsonText({ a: 1n }), TypeError);
    for (const root of [undefined, () => 1, Symbol("s")]) {
        assert.equal(JSON.stringify(root), undefined);
        assert.throws(
            () => serializeJsonText(root),
            /root must be an array, object, or JSON scalar/u,
        );
    }
});

test("serializeJsonText serializes nesting far beyond the native JSON.stringify stack", () => {
    const depth = 200_000;
    let value: unknown = "leaf";
    for (let level = 0; level < depth; level += 1) {
        value = level % 2 === 0 ? { a: value } : [value];
    }
    assert.throws(() => JSON.stringify(value), RangeError);
    const pairs = depth / 2;
    assert.equal(serializeJsonText(value), `${'[{"a":'.repeat(pairs)}"leaf"${"}]".repeat(pairs)}`);
});
