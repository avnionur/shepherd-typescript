import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createRunArtifact, createRunUsage, SQLiteTraceStore } from "../../src/index.ts";

const fixture = JSON.parse(
    readFileSync(new URL("../fixtures/run-artifact-usage-v1.json", import.meta.url), "utf8"),
) as Readonly<Record<string, unknown>>;

test("createRunArtifact preserves ordered text and durable blob artifacts", () => {
    using store = new SQLiteTraceStore();
    const receipt = store.putBlob(Uint8Array.of(0, 1, 2));
    const artifacts = [
        createRunArtifact({
            artifactOrdinal: 0,
            content: { text: "Shepherd records execution as data.", type: "text" },
            kind: "report",
            metadata: { media_type: "text/plain" },
            name: "note.txt",
            runId: "run:write-note:1",
        }),
        createRunArtifact({
            artifactOrdinal: 1,
            content: { receipt, type: "blob" },
            kind: "binary",
            metadata: {},
            name: "bytes.bin",
            runId: "run:write-note:1",
        }),
    ];

    assert.deepEqual(artifacts, fixture.artifacts);
    assert.deepEqual(
        artifacts.map((artifact) => artifact.artifact_ordinal),
        [0, 1],
    );
    for (const artifact of artifacts) {
        assert.equal(Object.isFrozen(artifact), true);
        assert.equal(Object.isFrozen(artifact.content), true);
        assert.equal(Object.isFrozen(artifact.metadata), true);
    }
});

test("createRunUsage records immutable aggregate run totals", () => {
    const usage = createRunUsage({
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 80,
        costUsd: 0.0042,
        inputTokens: 120,
        outputTokens: 30,
        runId: "run:write-note:1",
    });

    assert.deepEqual(usage, fixture.usage);
    assert.equal(Object.isFrozen(usage), true);
});

test("createRunArtifact rejects malformed closed definitions and content", () => {
    const receipt = {
        blob_id: "sha256:ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc",
        byte_length: 3,
    };
    const valid = {
        artifactOrdinal: 0,
        content: { text: "note", type: "text" },
        kind: "report",
        metadata: {},
        name: "note.txt",
        runId: "run:1",
    };
    const invalid = [
        null,
        [],
        Object.assign(Object.create({ inherited: true }), valid),
        { ...valid, extra: true },
        { ...valid, name: undefined },
        { ...valid, runId: "" },
        { ...valid, runId: "\uD800" },
        { ...valid, kind: 1 },
        { ...valid, name: "" },
        { ...valid, artifactOrdinal: -1 },
        { ...valid, artifactOrdinal: 0.5 },
        { ...valid, artifactOrdinal: Number.MAX_SAFE_INTEGER },
        { ...valid, metadata: null },
        { ...valid, metadata: [] },
        { ...valid, metadata: 1 },
        { ...valid, metadata: { invalid: Number.NaN } },
        { ...valid, content: null },
        { ...valid, content: "text" },
        { ...valid, content: [] },
        { ...valid, content: {} },
        { ...valid, content: { type: "archive" } },
        { ...valid, content: { type: "text", text: "\uD800" } },
        { ...valid, content: { type: "text", text: "note", extra: true } },
        { ...valid, content: { type: "blob", receipt: null } },
        { ...valid, content: { type: "blob", receipt: { blob_id: receipt.blob_id } } },
        { ...valid, content: { type: "blob", receipt: { ...receipt, blob_id: "invalid" } } },
        { ...valid, content: { type: "blob", receipt: { ...receipt, byte_length: 0.5 } } },
        { ...valid, content: { type: "blob", receipt: { ...receipt, byte_length: -1 } } },
        {
            ...valid,
            content: {
                type: "blob",
                receipt: { ...receipt, byte_length: Number.MAX_SAFE_INTEGER + 1 },
            },
        },
    ];
    const symbolDefinition = { ...valid, [Symbol("invalid")]: true };
    const missingDefinition = { ...valid } as Partial<typeof valid>;
    delete missingDefinition.name;
    const accessorDefinition = { ...valid };
    Object.defineProperty(accessorDefinition, "kind", { get: () => "report" });
    const accessorContent = { text: "note" };
    Object.defineProperty(accessorContent, "type", { get: () => "text" });
    invalid.push(symbolDefinition, missingDefinition, accessorDefinition, {
        ...valid,
        content: accessorContent,
    });

    for (const value of invalid) {
        assert.throws(
            () => createRunArtifact(value as Parameters<typeof createRunArtifact>[0]),
            TypeError,
        );
    }
});

test("createRunUsage normalizes unavailable cost and rejects malformed totals", () => {
    const valid = {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 1,
        outputTokens: 2,
        runId: "run:1",
    };
    assert.equal(createRunUsage(valid).cost_usd, null);

    for (const value of [
        null,
        [],
        { ...valid, extra: true },
        { ...valid, runId: "" },
        { ...valid, inputTokens: 0.5 },
        { ...valid, inputTokens: Number.MAX_SAFE_INTEGER + 1 },
        { ...valid, outputTokens: -1 },
        { ...valid, cacheCreationInputTokens: "0" },
        { ...valid, cacheReadInputTokens: -1 },
        { ...valid, costUsd: "free" },
        { ...valid, costUsd: Number.POSITIVE_INFINITY },
        { ...valid, costUsd: -0.01 },
    ]) {
        assert.throws(
            () => createRunUsage(value as Parameters<typeof createRunUsage>[0]),
            TypeError,
        );
    }

    const accessor = { ...valid };
    Object.defineProperty(accessor, "costUsd", { get: () => 1 });
    assert.throws(() => createRunUsage(accessor), TypeError);
});
