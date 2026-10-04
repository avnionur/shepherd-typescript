import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import { reconcileEffect } from "../../src/index.ts";
import { reconciliationFixture } from "./reconciliation-fixtures.ts";

test("the published audit schema accepts retained decisions and rejects false completion claims", async (context) => {
    const { store, request } = await reconciliationFixture(context, "schema");
    const receipt = await reconcileEffect(store, request);
    const { record_id: _recordId, ...body } = receipt;
    const validator = new Ajv2020({ strict: true });
    validator.addKeyword("x-shepherd-max-utf8-bytes");
    const validate = validator.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/effect-reconciliation-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    assert.equal(validate(body), true, JSON.stringify(validate.errors));
    for (const disposition of ["retry", "accepted_unresolved", "externally_verified_completion"]) {
        const candidate = {
            ...body,
            disposition,
            completion_verified: disposition === "externally_verified_completion",
        };
        assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
        assert.equal(
            validate({ ...candidate, completion_verified: !candidate.completion_verified }),
            false,
        );
    }
    for (const changed of [
        { evidence_record_ids: [] },
        { actor_id: "" },
        { target_record_id: "wrong" },
        { record_version: 0 },
        { extra: true },
    ])
        assert.equal(validate({ ...body, ...changed }), false, JSON.stringify(changed));
});
