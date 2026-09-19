import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
    classifyTraceSchema,
    RETENTION_DATA_CLASSES,
    RETENTION_EXPORT_DISPOSITIONS,
    readRetentionPolicy,
    SECRET_SCANNING_MODES,
} from "../../src/index.ts";
import { retentionProtocolConfig } from "../../src/protocol/config.ts";

const rawConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function collectFamilies(
    value: unknown,
    familyKeys: readonly string[],
    prefix: string,
): readonly { readonly path: string; readonly values: readonly string[] }[] {
    if (value === null || typeof value !== "object") {
        return [];
    }
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        const nested = collectFamilies(child, familyKeys, path);
        if (familyKeys.includes(key) && child !== null && typeof child === "object") {
            return [{ path, values: collectStrings(child) }, ...nested];
        }
        return nested;
    });
}

function collectStrings(value: unknown): readonly string[] {
    if (typeof value === "string") {
        return [value];
    }
    return Object.values(value as object).flatMap(collectStrings);
}

test("every configured trace schema family has a data class (gate)", () => {
    const families = collectFamilies(rawConfig, retentionProtocolConfig.familyKeys, "");
    assert.ok(families.length > 0);
    const mapped = new Set(retentionProtocolConfig.schemaFamilies.map(({ path }) => path));
    for (const family of families) {
        assert.ok(mapped.has(family.path), `${family.path} has no retention mapping`);
        for (const schemaRef of family.values) {
            assert.ok(
                RETENTION_DATA_CLASSES.includes(
                    retentionProtocolConfig.schemaDataClasses[schemaRef] as never,
                ),
                `${family.path} schema ${schemaRef} has no data class`,
            );
        }
    }
    const traceSchemas = families.filter(({ path }) => path.endsWith(".traceSchemas"));
    assert.ok(traceSchemas.length > 0);
    for (const { values } of traceSchemas) {
        for (const schemaRef of values) {
            assert.notEqual(retentionProtocolConfig.schemaDataClasses[schemaRef], undefined);
            assert.equal(
                classifyTraceSchema(schemaRef).data_class,
                retentionProtocolConfig.schemaDataClasses[schemaRef],
            );
        }
    }
});

test("classification prefers configured families, then caller classes, then the default", () => {
    const policy = readRetentionPolicy();
    const contextSchema = (rawConfig.supervision as { traceSchemas: { context: string } })
        .traceSchemas.context;
    const defaultClass = policy.data_classes.find(
        ({ data_class }) => data_class === policy.default_data_class,
    );
    assert.equal(classifyTraceSchema(contextSchema).data_class, "context");
    assert.equal(
        classifyTraceSchema(contextSchema, { schemaDataClasses: { [contextSchema]: "context" } })
            .data_class,
        "context",
    );
    assert.deepEqual(
        classifyTraceSchema("caller.memory.v1", {
            schemaDataClasses: { "caller.memory.v1": "memory-adapter" },
        }),
        {
            data_class: "memory-adapter",
            disposition: retentionProtocolConfig.exportDispositions["memory-adapter"],
        },
    );
    assert.deepEqual(classifyTraceSchema("caller.unclassified.v1"), defaultClass);
});

test("classification rejects malformed schema identifiers and options", () => {
    const contextSchema = (rawConfig.supervision as { traceSchemas: { context: string } })
        .traceSchemas.context;
    for (const invalid of [
        () => classifyTraceSchema(""),
        () => classifyTraceSchema(1 as never),
        () => classifyTraceSchema("x", null as never),
        () => classifyTraceSchema("x", [] as never),
        () => classifyTraceSchema("x", { extra: true } as never),
        () => classifyTraceSchema("x", { schemaDataClasses: null as never }),
        () => classifyTraceSchema("x", { schemaDataClasses: [] as never }),
        () => classifyTraceSchema("x", { schemaDataClasses: { "": "general" } }),
        () => classifyTraceSchema("x", { schemaDataClasses: { x: "unknown" as never } }),
        () => classifyTraceSchema("x", { schemaDataClasses: { [contextSchema]: "general" } }),
    ]) {
        assert.throws(invalid, TypeError);
    }
});

test("the retention policy summary is frozen and matches generated vocabularies", () => {
    const policy = readRetentionPolicy();
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.data_classes[0]), true);
    assert.deepEqual(
        policy.data_classes.map(({ data_class }) => data_class),
        [...RETENTION_DATA_CLASSES],
    );
    for (const { disposition } of policy.data_classes) {
        assert.ok(RETENTION_EXPORT_DISPOSITIONS.includes(disposition));
    }
    assert.deepEqual(policy.scanning_modes, [...SECRET_SCANNING_MODES]);
    assert.equal(policy.default_scanning_mode, SECRET_SCANNING_MODES[0]);
    assert.equal(JSON.stringify(policy).includes("pattern"), false);
});
