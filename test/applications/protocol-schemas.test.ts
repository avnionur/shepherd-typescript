import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ApplicationProtocolError,
    type CodingSupervisorPolicy,
    deriveApplicationOwnerId,
    inspectCodingSupervisorRun,
    inspectCounterfactualOptimization,
    inspectTreeRlRun,
    JSONSchemaValidationError,
    readApplicationProtocol,
    runCodingSupervisor,
    runCounterfactualOptimization,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    counterfactualDefinition,
    counterfactualProtocolWith,
    labelMetric,
    optimizerOptions,
    providerEdit,
    reflection,
    scriptedProposer,
} from "./counterfactual-fixtures.ts";
import {
    acceptAfterObserve,
    LEAD,
    outputPaths,
    rawSupervisionProtocol,
    rootParent,
    scripted,
    workerOf,
} from "./fixtures.ts";
import { recordRoots, treeRlDefinition, treeRlOptions } from "./tree-rl-fixtures.ts";

type RawSurface = { readonly content: unknown; readonly id: string };

/** Copies a raw protocol replacing the content of the surface with `id`. */
function withSurface(
    raw: Record<string, unknown>,
    id: string,
    mutate: (content: Record<string, unknown>) => unknown,
): Record<string, unknown> {
    const copy = structuredClone(raw);
    const surfaces = copy.surfaces as RawSurface[];
    const index = surfaces.findIndex((surface) => surface.id === id);
    assert.notEqual(index, -1, `surface ${id} exists`);
    const surface = surfaces[index] as RawSurface;
    surfaces[index] = {
        ...surface,
        content: mutate(structuredClone(surface.content) as Record<string, unknown>),
    };
    return copy;
}

function supervisionOptions(
    commandId: string,
    policy: CodingSupervisorPolicy,
    protocol: Record<string, unknown>,
) {
    return {
        changedPaths: outputPaths,
        commandId,
        parent: rootParent(),
        policy,
        protocol: readApplicationProtocol(protocol),
        supervisorId: LEAD,
        workers: [workerOf("a"), workerOf("b")],
    };
}

test("schema surfaces outside the supported JSON Schema subset are refused before any record", () => {
    for (const content of [
        "not a schema",
        { type: "object", format: "email" },
        { $ref: "#/$defs/action" },
        { type: "decimal" },
        { properties: { kind: { $schema: "https://json-schema.org/draft/2020-12/schema" } } },
    ]) {
        assert.throws(
            () =>
                readApplicationProtocol(
                    withSurface(rawSupervisionProtocol(), "supervision.action.v1", () => content),
                ),
            (error: unknown) =>
                error instanceof ApplicationProtocolError && error.cause instanceof TypeError,
        );
    }
    // Every repository schema surface compiles.
    assert.equal(readApplicationProtocol(rawSupervisionProtocol()).kind, "coding_supervisor");
    assert.equal(
        readApplicationProtocol(counterfactualDefinition).kind,
        "counterfactual_optimization",
    );
});

test("policy decisions are validated against the pinned action schema surface", async () => {
    using store = new SQLiteTraceStore();
    const narrowed = withSurface(rawSupervisionProtocol(), "supervision.action.v1", (content) => {
        const properties = content.properties as Record<string, unknown>;
        return { ...content, properties: { ...properties, kind: { enum: ["observe", "accept"] } } };
    });
    const commandId = "application:schema:action";
    const policy = scripted([{ kind: "discard_restart", reason: "retry", worker_id: "a" }], "a");
    await assert.rejects(
        runCodingSupervisor(store, supervisionOptions(commandId, policy, narrowed)),
        (error: unknown) =>
            error instanceof JSONSchemaValidationError &&
            error.code === "SCHEMA_VALIDATION_FAILED" &&
            /^policy decision of round 1 violates schema surface supervision\.action\.v1: /u.test(
                error.message,
            ) &&
            error.issues.length === 1 &&
            error.issues[0]?.path === "$.kind" &&
            error.issues[0]?.keyword === "enum" &&
            error.issues[0]?.schemaPath === "#/properties/kind/enum",
    );
    assert.equal(policy.contexts.length, 1);
    // The refused decision was never applied or retained.
    assert.equal(
        inspectCodingSupervisorRun(store, deriveApplicationOwnerId(commandId)).decisions.length,
        0,
    );
    // Decisions the narrowed schema admits run to completion under it.
    const admitted = await runCodingSupervisor(
        store,
        supervisionOptions("application:schema:admitted", acceptAfterObserve("a"), narrowed),
    );
    assert.equal(admitted.inspection.decisions.length, 2);
});

test("observations the pinned observation schema refuses stop the run before the policy", async () => {
    using store = new SQLiteTraceStore();
    const narrowed = withSurface(
        rawSupervisionProtocol(),
        "supervision.observation.v1",
        (content) => {
            const properties = content.properties as Record<string, unknown>;
            return {
                ...content,
                properties: { ...properties, conflict: { const: "path_overlap" } },
            };
        },
    );
    let consulted = 0;
    await assert.rejects(
        runCodingSupervisor(
            store,
            supervisionOptions(
                "application:schema:observation",
                () => {
                    consulted += 1;
                    return { kind: "observe" };
                },
                narrowed,
            ),
        ),
        (error: unknown) =>
            error instanceof ApplicationProtocolError &&
            /observation of round 1/u.test(error.message) &&
            error.cause instanceof JSONSchemaValidationError &&
            error.cause.issues.some(
                (issue) => issue.path === "$.conflict" && issue.keyword === "const",
            ),
    );
    assert.equal(consulted, 0);
});

const HANDOFF_PROPOSAL = scriptedProposer([
    [
        {
            edits: [providerEdit("promoted", 0, "promoted"), providerEdit("gated", 2, "gated")],
            parent: null,
            reflection: reflection(null),
        },
    ],
]);
const HANDOFF_METRIC = labelMetric({ promoted: { "dev-1": 1, "dev-2": 1, "train-1": 1 } });

test("the counterfactual handoff manifest is derived, validated, and returned", async () => {
    using store = new SQLiteTraceStore();
    const options = optimizerOptions("application:schema:handoff", {
        metric: HANDOFF_METRIC,
        proposer: HANDOFF_PROPOSAL,
    });
    const receipt = await runCounterfactualOptimization(store, options);
    const [promoted, gated] = receipt.inspection.candidates;
    assert.deepEqual(receipt.handoff, {
        candidates: [
            {
                candidate_id: promoted?.candidate_id,
                parent_candidate_id: null,
                status: "promoted",
            },
            { candidate_id: gated?.candidate_id, parent_candidate_id: null, status: "archived" },
        ],
        selected_candidate_id: promoted?.candidate_id,
    });
    assert.equal(Object.isFrozen(receipt.handoff.candidates[0]), true);
    const repeated = await runCounterfactualOptimization(store, options);
    assert.deepEqual(repeated.handoff, receipt.handoff);
});

test("a handoff manifest the pinned handoff schema refuses is a protocol mismatch", async () => {
    using store = new SQLiteTraceStore();
    const nothingSelectable = withSurface(
        counterfactualDefinition,
        "handoff.manifest.v2",
        (content) => {
            const properties = content.properties as Record<string, unknown>;
            return {
                ...content,
                properties: { ...properties, selected_candidate_id: { type: "null" } },
            };
        },
    );
    const commandId = "application:schema:handoff-refused";
    const options = optimizerOptions(commandId, {
        metric: HANDOFF_METRIC,
        proposer: HANDOFF_PROPOSAL,
        protocol: readApplicationProtocol({
            ...nothingSelectable,
            budgets: counterfactualProtocolWith({ iterations: 1 }).budgets,
        }),
    });
    await assert.rejects(
        runCounterfactualOptimization(store, options),
        (error: unknown) =>
            error instanceof ApplicationProtocolError &&
            /handoff manifest/u.test(error.message) &&
            error.cause instanceof JSONSchemaValidationError &&
            error.cause.issues.some(
                (issue) => issue.path === "$.selected_candidate_id" && issue.keyword === "type",
            ),
    );
    // Candidate evidence and the selection are retained; the manifest is not.
    const inspection = inspectCounterfactualOptimization(
        store,
        deriveApplicationOwnerId(commandId),
    );
    assert.equal(inspection.manifest, null);
    assert.equal(inspection.candidates[0]?.status, "promoted");
    assert.notEqual(inspection.selection, null);
});

test("training batch lines the pinned batch schema refuses are a protocol mismatch", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const integerRewards = withSurface(
        treeRlDefinition,
        "tree-rl.batch-line.jsonl_v2",
        (content) => {
            const properties = content.properties as Record<string, unknown>;
            return {
                ...content,
                properties: { ...properties, reward: { type: "integer", maximum: 3 } },
            };
        },
    );
    const commandId = "application:schema:batch";
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, labels, {
                protocol: readApplicationProtocol(integerRewards),
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationProtocolError &&
            /training batch/u.test(error.message) &&
            error.cause instanceof JSONSchemaValidationError &&
            /^training batch line \d+ violates schema surface tree-rl\.batch-line\.jsonl_v2: \$\.reward must be <= 3/u.test(
                error.cause.message,
            ),
    );
    const inspection = inspectTreeRlRun(store, deriveApplicationOwnerId(commandId));
    assert.equal(inspection.batch, null);
    assert.equal(inspection.manifest, null);
});
