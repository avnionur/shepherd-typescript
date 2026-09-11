import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

import { emitScopeRecord, registerChildScope, SQLiteTraceStore } from "../../src/index.ts";
import { SCOPE_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { registerAndClaim, resource, temporaryDatabasePath } from "./fixtures.ts";

test("published scope schemas accept retained records and reject malformed copies", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "schema");
    using store = new SQLiteTraceStore(databasePath);
    const { root, writer } = registerAndClaim(store);
    const child = registerChildScope(store, {
        commandId: "scope-command:child",
        expectedHeadRecordId: root.head.record_id,
        grant: [resource("resource:docs", ["read"])],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    const emitted = emitScopeRecord(store, {
        commandId: "scope-command:emit",
        data: { note: "x", nested: { values: [1, null, true] } },
        expectedHeadRecordId: child.parent_head.record_id,
        nowMilliseconds: 1_500,
        writer,
    });
    const rootBody = store.readRecord(root.registration_record_id)?.body as Record<string, unknown>;
    const childBody = store.readRecord(child.registration_record_id)?.body as Record<
        string,
        unknown
    >;
    const childRegisteredBody = store.readRecord(child.origin.child_registered_record_id)
        ?.body as Record<string, unknown>;
    const emissionBody = store.readRecord(emitted.head.record_id)?.body as Record<string, unknown>;

    const validateRegistration = compile("scope-registration-v1.schema.json");
    const validateChildRegistered = compile("scope-child-registered-v1.schema.json");
    const validateEmission = compile("scope-emission-v1.schema.json");

    assert.equal(validateRegistration(rootBody), true, errors(validateRegistration));
    assert.equal(validateRegistration(childBody), true, errors(validateRegistration));
    assert.equal(
        validateChildRegistered(childRegisteredBody),
        true,
        errors(validateChildRegistered),
    );
    assert.equal(validateEmission(emissionBody), true, errors(validateEmission));

    for (const invalid of [
        { ...rootBody, extra: true },
        { ...rootBody, scope_version: 2 },
        { ...rootBody, compatibility_version: "other" },
        { ...rootBody, kind: "other" },
        { ...rootBody, world_capability: "world" },
        { ...rootBody, scope_id: "scope:bad" },
        { ...rootBody, parent: { scope_id: root.scope_id } },
        {
            ...rootBody,
            authority: {
                ceiling: [],
                effective: [
                    { atoms: ["execute"], resource_id: "r", resource_kind: "repository_binding" },
                ],
            },
        },
        {
            ...rootBody,
            authority: {
                ceiling: [],
                effective: [
                    {
                        atoms: ["read", "read"],
                        resource_id: "r",
                        resource_kind: "repository_binding",
                    },
                ],
            },
        },
        { ...rootBody, execution_id: "" },
    ]) {
        assert.equal(validateRegistration(invalid), false);
    }
    for (const invalid of [
        { ...childRegisteredBody, extra: true },
        { ...childRegisteredBody, origin_cut_id: "cut:other" },
        { ...childRegisteredBody, child_scope_id: "" },
    ]) {
        assert.equal(validateChildRegistered(invalid), false);
    }
    for (const invalid of [
        { ...emissionBody, extra: true },
        { ...emissionBody, data: [] },
        { ...emissionBody, cited_record_ids: ["bad"] },
        {
            ...emissionBody,
            cited_record_ids: [emitted.previous_head_record_id, emitted.previous_head_record_id],
        },
        { ...emissionBody, expected_head_record_id: "" },
    ]) {
        assert.equal(validateEmission(invalid), false);
    }
});

test("scope protocol configuration matches the immutable v1 contract", () => {
    const config = JSON.parse(
        readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const parsed = parseProtocolConfig(structuredClone(config));
    assert.deepEqual(parsed.scopes, SCOPE_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.scopes.authority.atoms), true);
    assert.deepEqual(parsed.scopes.authority.atoms, parsed.workspaces.repositoryGrants.atoms);
});

function compile(name: string): ValidateFunction {
    const validator = new Ajv2020({ strict: true });
    validator.addKeyword("x-shepherd-max-canonical-bytes");
    const schema = JSON.parse(
        readFileSync(new URL(`../../spec/schemas/${name}`, import.meta.url), "utf8"),
    ) as AnySchemaObject;
    assert.equal(validator.validateSchema(schema), true, validator.errorsText());
    return validator.compile(schema);
}

function errors(validate: ValidateFunction): string {
    return new Ajv2020().errorsText(validate.errors);
}
