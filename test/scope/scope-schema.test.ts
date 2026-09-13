import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
    emitScopeRecord,
    forkScope,
    registerChildScope,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    SCOPE_PROTOCOL_V1_CONTRACT,
    SCOPE_PROTOCOL_V2_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { registerAndClaim, resource, temporaryDatabasePath } from "./fixtures.ts";
import { bindingGrant, createForkWorkspace } from "./fork-fixtures.ts";

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

test("scope protocol configuration matches v2 and preserves every v1 value", () => {
    const config = JSON.parse(
        readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const parsed = parseProtocolConfig(structuredClone(config));
    assert.deepEqual(parsed.scopes, SCOPE_PROTOCOL_V2_CONTRACT);
    // Version 2 only appends vocabulary; every version 1 value keeps its position and meaning.
    const appended = new Set(["commandKinds", "evidenceKinds", "worldCapabilities"]);
    const merged = new Set(["artifacts", "identity", "schemas", "traceSchemas"]);
    const current = SCOPE_PROTOCOL_V2_CONTRACT as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(SCOPE_PROTOCOL_V1_CONTRACT)) {
        if (appended.has(key)) {
            const previous = value as readonly string[];
            assert.deepEqual(
                (current[key] as readonly string[]).slice(0, previous.length),
                previous,
            );
        } else if (merged.has(key)) {
            assert.deepEqual({ ...(current[key] as object), ...(value as object) }, current[key]);
        } else if (key === "authority") {
            assert.deepEqual(
                SCOPE_PROTOCOL_V2_CONTRACT.authority.atoms,
                SCOPE_PROTOCOL_V1_CONTRACT.authority.atoms,
            );
            assert.deepEqual(
                SCOPE_PROTOCOL_V2_CONTRACT.authority.resourceKinds.slice(0, 1),
                SCOPE_PROTOCOL_V1_CONTRACT.authority.resourceKinds,
            );
        } else {
            assert.deepEqual(current[key], value, key);
        }
    }
    assert.equal(Object.isFrozen(parsed.scopes.authority.atoms), true);
    assert.deepEqual(parsed.scopes.authority.atoms, parsed.workspaces.repositoryGrants.atoms);
});

test("published fork schema accepts retained journal records and rejects malformed copies", async (context) => {
    const workspace = await createForkWorkspace(context, "schema");
    const origin = await workspace.carrier.snapshot(workspace.source);
    const fork = await forkScope(workspace.store, {
        binding: workspace.source,
        carrier: workspace.carrier,
        commandId: "scope-command:schema-fork",
        expectedHeadRecordId: workspace.root.head.record_id,
        grant: [bindingGrant(workspace.source)],
        nowMilliseconds: 1_500,
        originRevisionId: origin.revision_id,
        parent: workspace.rootWriter,
    });
    const prepared = workspace.store.readRecord(fork.prepared_record_id)?.body as Record<
        string,
        unknown
    >;
    const completed = workspace.store.readRecord(fork.completed_record_id)?.body as Record<
        string,
        unknown
    >;
    const validateFork = compile("scope-fork-v1.schema.json");
    assert.equal(validateFork(prepared), true, errors(validateFork));
    assert.equal(validateFork(completed), true, errors(validateFork));
    assert.equal(
        compile("scope-registration-v1.schema.json")(
            workspace.store.readRecord(fork.registration_record_id)?.body,
        ),
        true,
    );
    const checkpoint = completed.checkpoint as { constituents: readonly unknown[] };
    const withConstituents = (constituents: readonly unknown[]) => ({
        ...completed,
        checkpoint: { ...checkpoint, constituents },
    });
    for (const invalid of [
        { ...prepared, extra: true },
        { ...prepared, phase: "completed" },
        { ...prepared, custody_id: "world-custody:bad" },
        { ...prepared, resource_kind: "network" },
        { ...prepared, world_capability: "trace_only" },
        { ...completed, custody_content_id: "" },
        withConstituents(checkpoint.constituents.slice(1)),
        withConstituents([
            { kind: "trace_cut", status: "verified" },
            ...checkpoint.constituents.slice(1),
        ]),
        withConstituents([
            ...checkpoint.constituents.slice(0, 9),
            { kind: "irreversible_effects", status: "unavailable" },
        ]),
    ]) {
        assert.equal(validateFork(invalid), false);
    }
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
