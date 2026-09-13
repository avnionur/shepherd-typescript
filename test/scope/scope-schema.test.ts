import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject, type ValidateFunction } from "ajv/dist/2020.js";

import {
    discardScope,
    emitScopeRecord,
    forkScope,
    mergeScope,
    registerChildScope,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    SCOPE_PROTOCOL_V1_CONTRACT,
    SCOPE_PROTOCOL_V2_CONTRACT,
    SCOPE_PROTOCOL_V3_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { registerAndClaim, resource, temporaryDatabasePath } from "./fixtures.ts";
import { bindingGrant, createForkWorkspace } from "./fork-fixtures.ts";
import { createNestedWorld, forkChild, headOf, writeCustody } from "./merge-fixtures.ts";

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

test("scope protocol configuration matches v3 and preserves every v1 and v2 value", () => {
    const config = JSON.parse(
        readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    const parsed = parseProtocolConfig(structuredClone(config));
    assert.deepEqual(parsed.scopes, SCOPE_PROTOCOL_V3_CONTRACT);
    // Later versions only append vocabulary; every earlier value keeps its position and meaning.
    const appended = new Set(["commandKinds", "evidenceKinds", "worldCapabilities"]);
    const merged = new Set([
        "artifacts",
        "errors",
        "identity",
        "limits",
        "schemas",
        "traceSchemas",
    ]);
    const current = SCOPE_PROTOCOL_V3_CONTRACT as unknown as Record<string, unknown>;
    for (const previousContract of [SCOPE_PROTOCOL_V1_CONTRACT, SCOPE_PROTOCOL_V2_CONTRACT]) {
        for (const [key, value] of Object.entries(previousContract)) {
            if (appended.has(key)) {
                const previous = value as readonly string[];
                assert.deepEqual(
                    (current[key] as readonly string[]).slice(0, previous.length),
                    previous,
                );
            } else if (merged.has(key)) {
                assert.deepEqual(
                    { ...(current[key] as object), ...(value as object) },
                    current[key],
                );
            } else if (key === "authority") {
                assert.deepEqual(
                    SCOPE_PROTOCOL_V3_CONTRACT.authority.atoms,
                    previousContract.authority.atoms,
                );
                assert.deepEqual(
                    SCOPE_PROTOCOL_V3_CONTRACT.authority.resourceKinds.slice(
                        0,
                        previousContract.authority.resourceKinds.length,
                    ),
                    previousContract.authority.resourceKinds,
                );
            } else {
                assert.deepEqual(current[key], value, key);
            }
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

test("published merge and discard schemas accept retained journal records and reject malformed copies", async (context) => {
    const world = await createNestedWorld(context, "schema-terminal");
    const { carrier, child, childWriter, parent, parentWriter, store } = world;
    await writeCustody(world, child.world.custody_id, "child.txt", "child\n");
    const merged = await mergeScope(store, {
        carrier,
        child: childWriter,
        commandId: "scope-command:schema-merge",
        expectedChildHeadRecordId: headOf(store, child.scope_id),
        expectedParentHeadRecordId: headOf(store, parent.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
    });
    const sibling = await forkChild(world, parent, parentWriter, "scope-command:schema-sibling");
    const discarded = await discardScope(store, {
        carrier,
        commandId: "scope-command:schema-discard",
        expectedHeadRecordId: headOf(store, sibling.scope_id),
        nowMilliseconds: 1_700,
        parent: parentWriter,
        scopeId: sibling.scope_id,
    });
    const body = (recordId: string | null) =>
        store.readRecord(recordId as string)?.body as Record<string, unknown>;
    const prepared = body(merged.prepared_record_id);
    const sealed = body(merged.completed_record_id);
    const integration = body(merged.child_merged_record_id);
    const decided = body(discarded.decided_record_id);
    const cleaned = body(discarded.cleanup.cleaned_record_id);
    const validateMerge = compile("scope-merge-v1.schema.json");
    const validateChildMerged = compile("scope-child-merged-v1.schema.json");
    const validateDiscard = compile("scope-discard-v1.schema.json");
    assert.equal(validateMerge(prepared), true, errors(validateMerge));
    assert.equal(validateMerge(sealed), true, errors(validateMerge));
    assert.equal(validateChildMerged(integration), true, errors(validateChildMerged));
    assert.equal(validateDiscard(decided), true, errors(validateDiscard));
    assert.equal(validateDiscard(cleaned), true, errors(validateDiscard));
    const plan = prepared.world as Record<string, unknown>;
    for (const invalid of [
        { ...prepared, extra: true },
        { ...prepared, merge_cut_id: "scope-origin:bad" },
        { ...prepared, world: { ...plan, merged_revision_id: "bad" } },
        { ...prepared, contributions: [{ owner_id: child.scope_id, owner_ordinal: -1 }] },
        { ...sealed, phase: "prepared" },
    ]) {
        assert.equal(validateMerge(invalid), false);
    }
    for (const invalid of [
        { ...integration, publication_revision_id: "bad" },
        { ...integration, child_cut_id: "scope-origin:bad" },
    ]) {
        assert.equal(validateChildMerged(invalid), false);
    }
    for (const invalid of [
        { ...decided, sealed_scope_ids: ["scope:bad"] },
        { ...decided, custody_ids: ["world-custody:bad"] },
        { ...cleaned, phase: "decided" },
    ]) {
        assert.equal(validateDiscard(invalid), false);
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
