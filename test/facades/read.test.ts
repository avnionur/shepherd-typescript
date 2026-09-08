import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cut, RetainedRecord, Slice } from "../../src/facades/read.ts";
import * as read from "../../src/facades/read.ts";
import type {
    Cut as StoreCut,
    RetainedRecord as StoreRecord,
    Slice as StoreSlice,
} from "../../src/facades/trace.ts";

type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

test("read facade exposes no runtime values and preserves trace data types", () => {
    const identities: [
        Equal<Cut, StoreCut>,
        Equal<RetainedRecord, StoreRecord>,
        Equal<Slice, StoreSlice>,
    ] = [true, true, true];
    assert.deepEqual(identities, [true, true, true]);
    assert.deepEqual(Object.keys(read), []);
});
