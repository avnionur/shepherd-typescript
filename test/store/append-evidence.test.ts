import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOT_WITNESS_ID, SQLiteTraceStore, type StoreAppendRequest } from "../../src/index.ts";

const request: StoreAppendRequest = {
    append_intent_id: "intent:evidence",
    batch: {
        groups: [
            {
                owner_id: "run:evidence",
                records: [
                    {
                        body: { value: 1 },
                        mode: "capture",
                        schema_ref: "example.value.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            },
        ],
    },
};

test("non-text owner paths and cited record identities are refused with path-level errors", () => {
    using store = new SQLiteTraceStore();
    const [group] = request.batch.groups;
    const [record] = group?.records ?? [];
    for (const invalid of [
        { ...request, batch: { groups: [{ ...group, owner_id: 7 }] } },
        {
            ...request,
            batch: { groups: [{ ...group, records: [{ ...record, witness_ref: 7 }] }] },
        },
    ]) {
        assert.throws(
            () => store.append(invalid as never),
            (error: unknown) =>
                error instanceof TypeError &&
                /(owner_id|witness_ref) must be a (non-empty )?string/u.test(error.message),
        );
    }
    assert.equal(store.readOwner("run:evidence").length, 0);
});
