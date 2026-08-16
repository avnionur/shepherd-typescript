import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { canonicalizeRecord, type SemanticRecord } from "../../src/canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
    RETAINED_WORLD_SETTLEMENT_STATES,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    WORLD_CHANGE_OPERATIONS,
    WORLD_ENTRY_KINDS,
} from "../../src/protocol/values.generated.ts";
import { encodeRetainedWorldSettlementOperation } from "../../src/store/retained-world-settlement-codec.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../../src/store/types.ts";
import {
    decodeScheduledSelectionPublicationReceipt,
    decodeScheduledSelectionPublicationStep,
    decodeSelectionPublicationPlan,
    decodeSelectionPublicationReceipt,
    decodeSelectionPublicationSchedule,
    decodeSelectionPublicationStep,
    encodeScheduledSelectionPublicationReceipt,
    encodeScheduledSelectionPublicationStep,
    encodeSelectionPublicationPlan,
    encodeSelectionPublicationReceipt,
    encodeSelectionPublicationSchedule,
    encodeSelectionPublicationStep,
    type ScheduledSelectionPublicationStepEncoding,
} from "../../src/workspace/selection-publication-codec.ts";
import type {
    WorldChangeNode,
    WorldChangeset,
    WorldPathChange,
} from "../../src/workspace/types.ts";

const [SELECT_ACTION, DISCARD_ACTION] = RETAINED_WORLD_SETTLEMENT_ACTIONS;
const [PREPARED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;
const [ADD, DELETE, MODIFY, REPLACE] = WORLD_CHANGE_OPERATIONS;
const [DIRECTORY, FILE, SYMLINK] = WORLD_ENTRY_KINDS;

test("selection publication codecs bind an exact ordered plan and terminal receipt", () => {
    const fixture = createFixture();
    const plan = encodeSelectionPublicationPlan(
        fixture.operation,
        fixture.changeset,
        fixture.baseContentId,
        fixture.headContentId,
    );
    assert.deepEqual(
        decodeSelectionPublicationPlan(
            plan.json,
            fixture.operation,
            fixture.changeset,
            fixture.baseContentId,
            fixture.headContentId,
        ),
        plan,
    );
    assert.equal(Object.isFrozen(plan.value), true);
    assert.equal(Object.isFrozen(plan.value.changes), true);
    assert.match(plan.id, digestPattern(workspaceProtocolConfig.selectionPublication.planIdPrefix));
    assert.match(
        plan.staging_id,
        digestPattern(workspaceProtocolConfig.selectionPublication.stagingIdPrefix),
    );

    const first = encodeSelectionPublicationStep(plan, null);
    const second = encodeSelectionPublicationStep(plan, first);
    assert.equal(first.value.ordinal, 0);
    assert.equal(second.value.ordinal, 1);
    assert.deepEqual(decodeSelectionPublicationStep(first.json, plan, null), first);
    assert.deepEqual(decodeSelectionPublicationStep(second.json, plan, first), second);
    assert.match(
        second.id,
        digestPattern(workspaceProtocolConfig.selectionPublication.stepIdPrefix),
    );

    const receipt = encodeSelectionPublicationReceipt(plan, second, "basis:after");
    assert.deepEqual(
        decodeSelectionPublicationReceipt(receipt.json, plan, second, "basis:after"),
        receipt,
    );
    assert.equal(receipt.value.final_step_id, second.id);
    assert.match(
        receipt.id,
        digestPattern(workspaceProtocolConfig.selectionPublication.publicationIdPrefix),
    );
    assert.throws(() => encodeSelectionPublicationStep(plan, second), TypeError);
    assert.throws(() => encodeSelectionPublicationReceipt(plan, first, "basis:after"), TypeError);
    assert.throws(() => encodeSelectionPublicationReceipt(plan, null, "basis:after"), TypeError);
    assert.throws(() => encodeSelectionPublicationReceipt(plan, second, ""), TypeError);
    assert.throws(() => decodeSelectionPublicationStep(`${first.json} `, plan, null), TypeError);
    assert.throws(
        () => decodeSelectionPublicationReceipt(`${receipt.json} `, plan, second, "basis:after"),
        TypeError,
    );
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                fixture.operation,
                fixture.changeset,
                "basis:wrong",
                fixture.headContentId,
            ),
        TypeError,
    );
});

test("selection publication codecs support an empty reconstructive plan", () => {
    const fixture = createFixture([]);
    const plan = encodeSelectionPublicationPlan(
        fixture.operation,
        fixture.changeset,
        fixture.baseContentId,
        fixture.headContentId,
    );
    const receipt = encodeSelectionPublicationReceipt(
        plan,
        null,
        fixture.request.user_basis_before,
    );
    assert.equal(receipt.value.final_step_id, null);
    assert.throws(() => encodeSelectionPublicationStep(plan, null), TypeError);
    assert.throws(
        () =>
            encodeSelectionPublicationReceipt(
                plan,
                createFixture().steps[1] ?? null,
                fixture.request.user_basis_before,
            ),
        TypeError,
    );
});

test("selection schedules order construction parents first and removed directories last", () => {
    const fixture = createFixture(dependencyChanges());
    const schedule = encodeSelectionPublicationSchedule(fixture.plan);
    assert.deepEqual(schedule.value.change_ordinals, [2, 0, 1, 3, 4, 6, 5, 7, 8, 9]);
    assert.equal(Object.isFrozen(schedule.value), true);
    assert.equal(Object.isFrozen(schedule.value.change_ordinals), true);
    assert.match(
        schedule.id,
        digestPattern(workspaceProtocolConfig.selectionPublication.scheduleIdPrefix),
    );
    assert.deepEqual(decodeSelectionPublicationSchedule(schedule.json, fixture.plan), schedule);
    assert.throws(
        () => decodeSelectionPublicationSchedule(`${schedule.json} `, fixture.plan),
        TypeError,
    );

    const second = createFixture(dependencyChanges(), SELECT_ACTION, "command:other");
    assert.throws(() => decodeSelectionPublicationSchedule(schedule.json, second.plan), TypeError);
});

test("selection schedules preserve canonical order for unrelated paths and empty plans", () => {
    const ordinary = createFixture();
    assert.deepEqual(
        encodeSelectionPublicationSchedule(ordinary.plan).value.change_ordinals,
        [0, 1],
    );
    const empty = createFixture([]);
    assert.deepEqual(encodeSelectionPublicationSchedule(empty.plan).value.change_ordinals, []);
});

test("scheduled publication codecs bind effects to exact dependency order", () => {
    const fixture = createFixture(dependencyChanges());
    const schedule = encodeSelectionPublicationSchedule(fixture.plan);
    const steps: ScheduledSelectionPublicationStepEncoding[] = [];
    let previous = null;
    for (const _ordinal of schedule.value.change_ordinals) {
        const step = encodeScheduledSelectionPublicationStep(fixture.plan, schedule, previous);
        steps.push(step);
        previous = step;
    }
    const first = steps[0];
    const finalStep = steps.at(-1);
    assert.ok(first !== undefined && finalStep !== undefined);
    assert.equal(first.value.operation_ordinal, 0);
    assert.equal(first.value.change_ordinal, 2);
    assert.equal(first.value.change.path, "a/child");
    assert.equal(finalStep.value.operation_ordinal, schedule.value.change_ordinals.length - 1);
    assert.deepEqual(
        decodeScheduledSelectionPublicationStep(first.json, fixture.plan, schedule, null),
        first,
    );
    assert.throws(
        () =>
            decodeScheduledSelectionPublicationStep(`${first.json} `, fixture.plan, schedule, null),
        TypeError,
    );
    const receipt = encodeScheduledSelectionPublicationReceipt(
        fixture.plan,
        schedule,
        finalStep,
        "basis:after",
    );
    assert.deepEqual(
        decodeScheduledSelectionPublicationReceipt(
            receipt.json,
            fixture.plan,
            schedule,
            finalStep,
            "basis:after",
        ),
        receipt,
    );
    assert.equal(receipt.value.schedule_id, schedule.id);
    assert.match(
        first.id,
        digestPattern(workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix),
    );
    assert.match(
        receipt.id,
        digestPattern(workspaceProtocolConfig.selectionPublication.scheduledPublicationIdPrefix),
    );
    assert.throws(
        () => encodeScheduledSelectionPublicationStep(fixture.plan, schedule, finalStep),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationReceipt(
                fixture.plan,
                schedule,
                steps.at(-2) ?? null,
                "basis:after",
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationReceipt(
                fixture.plan,
                schedule,
                {
                    ...finalStep,
                    value: { ...finalStep.value, operation_ordinal: Number.NaN },
                },
                "basis:after",
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationReceipt(
                fixture.plan,
                schedule,
                { ...finalStep, id: first.id },
                "basis:after",
            ),
        TypeError,
    );
    assert.throws(
        () =>
            decodeScheduledSelectionPublicationReceipt(
                `${receipt.json} `,
                fixture.plan,
                schedule,
                finalStep,
                "basis:after",
            ),
        TypeError,
    );
});

test("scheduled publication codecs reject crossed plans and schedules", () => {
    const first = createFixture(dependencyChanges());
    const second = createFixture(dependencyChanges(), SELECT_ACTION, "command:other");
    const firstSchedule = encodeSelectionPublicationSchedule(first.plan);
    const secondSchedule = encodeSelectionPublicationSchedule(second.plan);
    const firstStep = encodeScheduledSelectionPublicationStep(first.plan, firstSchedule, null);
    assert.throws(
        () => encodeScheduledSelectionPublicationStep(second.plan, firstSchedule, null),
        TypeError,
    );
    assert.throws(
        () => encodeScheduledSelectionPublicationStep(second.plan, secondSchedule, firstStep),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationStep(first.plan, firstSchedule, {
                ...firstStep,
                value: {
                    ...firstStep.value,
                    operation_ordinal: firstSchedule.value.change_ordinals.length,
                },
            }),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationStep(
                first.plan,
                {
                    ...firstSchedule,
                    id: secondSchedule.id,
                },
                null,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeScheduledSelectionPublicationReceipt(
                first.plan,
                { ...firstSchedule, digest: secondSchedule.digest },
                null,
                "basis:after",
            ),
        TypeError,
    );

    const empty = createFixture([]);
    const emptySchedule = encodeSelectionPublicationSchedule(empty.plan);
    const receipt = encodeScheduledSelectionPublicationReceipt(
        empty.plan,
        emptySchedule,
        null,
        empty.request.user_basis_before,
    );
    assert.equal(receipt.value.final_step_id, null);
    assert.throws(
        () => encodeScheduledSelectionPublicationStep(empty.plan, emptySchedule, null),
        TypeError,
    );
});

test("selection publication plans reject altered authority and malformed changes", () => {
    const fixture = createFixture();
    assert.throws(
        () =>
            decodeSelectionPublicationPlan(
                `${fixture.plan.json} `,
                fixture.operation,
                fixture.changeset,
                fixture.baseContentId,
                fixture.headContentId,
            ),
        TypeError,
    );
    const discardOperation = createFixture(undefined, DISCARD_ACTION).operation;
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                {
                    ...discardOperation,
                    value: { ...discardOperation.value, action: SELECT_ACTION },
                },
                fixture.changeset,
                fixture.baseContentId,
                fixture.headContentId,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                createFixture(undefined, DISCARD_ACTION).operation,
                fixture.changeset,
                fixture.baseContentId,
                fixture.headContentId,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                fixture.operation,
                fixture.changeset,
                "",
                fixture.headContentId,
            ),
        TypeError,
    );
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                fixture.operation,
                fixture.changeset,
                fixture.baseContentId,
                "",
            ),
        TypeError,
    );

    for (const changeset of [
        { ...fixture.changeset, changeset_id: "changed" },
        { ...fixture.changeset, changed_paths: ["wrong", "two"] },
        { ...fixture.changeset, changed_paths: ["one"] },
        { ...fixture.changeset, schema_version: 0 },
        { ...fixture.changeset, changes: { 0: fixture.changeset.changes[0] } },
        { ...fixture.changeset, changed_paths: { 0: "one", 1: "two" } },
        { ...fixture.changeset, extra: true },
    ]) {
        assert.throws(
            () =>
                encodeSelectionPublicationPlan(
                    fixture.operation,
                    changeset as WorldChangeset,
                    fixture.baseContentId,
                    fixture.headContentId,
                ),
            TypeError,
        );
    }

    const [first, second] = fixture.changeset.changes;
    assert.ok(first !== undefined && second !== undefined);
    for (const changes of [
        [{ ...first, operation: MODIFY }, second],
        [{ ...first, path: "../escape" }, second],
        [second, first],
        [{ ...first, before: null, after: null }, second],
        [{ ...first, after: { ...first.after, content_id: "invalid" } }, second],
        [
            {
                ...first,
                after: {
                    ...first.after,
                    content_id: workspaceProtocolConfig.carrier.blobIdPrefix,
                },
            },
            second,
        ],
        [
            {
                ...first,
                after: {
                    ...first.after,
                    content_id: `${workspaceProtocolConfig.carrier.blobIdPrefix}${"z".repeat(workspaceProtocolConfig.hexLength)}`,
                },
            },
            second,
        ],
        [{ ...first, after: { kind: "unknown", mode: 0 } }, second],
        [{ ...first, after: { ...first.after, extra: true } }, second],
    ]) {
        assert.throws(() => createFixture(changes as WorldPathChange[]), TypeError);
    }
    const alteredSemantic = {
        ...fixture.changeset,
        changes: [
            {
                ...first,
                after: { ...(first.after as object), mode: 493 },
            },
            second,
        ],
    } as WorldChangeset;
    assert.throws(
        () =>
            encodeSelectionPublicationPlan(
                fixture.operation,
                alteredSemantic,
                fixture.baseContentId,
                fixture.headContentId,
            ),
        TypeError,
    );
});

test("selection publication validation snapshots exact data and rejects invalid node variants", () => {
    const fixture = createFixture();
    const first = fixture.changeset.changes[0] as WorldPathChange;
    const variants: unknown[] = [
        null,
        [],
        Object.assign(Object.create({}), first),
        { ...first, [Symbol("extra")]: true },
        { ...first, after: { kind: DIRECTORY, mode: -1 } },
        { ...first, after: { kind: DIRECTORY, mode: 1.5 } },
        { ...first, after: { byte_length: -1, content_id: blobId("3"), kind: FILE, mode: 420 } },
        { ...first, after: { byte_length: 1.5, content_id: blobId("3"), kind: FILE, mode: 420 } },
        { ...first, after: { byte_length: 1, content_id: blobId("3"), kind: FILE, mode: -1 } },
        { ...first, after: { byte_length: 1, content_id: 1, kind: FILE, mode: 420 } },
        { ...first, after: { kind: SYMLINK, mode: 0, target: "target" } },
        { ...first, after: { kind: SYMLINK, mode: null, target: 1 } },
    ];
    for (const change of variants) {
        assert.throws(() => {
            const malformed = {
                ...fixture.changeset,
                changes: [change, fixture.changeset.changes[1]],
            } as WorldChangeset;
            encodeSelectionPublicationPlan(
                fixture.operation,
                malformed,
                fixture.baseContentId,
                fixture.headContentId,
            );
        }, TypeError);
    }

    let reads = 0;
    const source = first.after as Exclude<WorldPathChange["after"], null>;
    const proxied = new Proxy(
        { ...source },
        {
            getOwnPropertyDescriptor(target, property) {
                const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
                if (property === "kind" && descriptor !== undefined) {
                    reads += 1;
                    return { ...descriptor, value: reads === 1 ? descriptor.value : "unknown" };
                }
                return descriptor;
            },
        },
    );
    const proxiedChangeset = {
        ...fixture.changeset,
        changes: [Object.freeze({ ...first, after: proxied }), fixture.changeset.changes[1]],
    } as WorldChangeset;
    const snapshotPlan = encodeSelectionPublicationPlan(
        fixture.operation,
        proxiedChangeset,
        fixture.baseContentId,
        fixture.headContentId,
    );
    assert.equal(snapshotPlan.value.changes[0]?.after?.kind, FILE);

    const deletion = Object.freeze({
        after: null,
        before: Object.freeze({
            byte_length: 3,
            content_id: blobId("4"),
            kind: FILE,
            mode: 420,
        }),
        operation: WORLD_CHANGE_OPERATIONS[1],
        path: "deleted",
    }) satisfies WorldPathChange;
    assert.equal(createFixture([deletion]).plan.value.changes[0]?.after, null);
});

test("selection publication codecs enforce configured path, content, and record bounds", () => {
    const fixture = createFixture();
    const first = fixture.changeset.changes[0] as WorldPathChange;
    const second = fixture.changeset.changes[1] as WorldPathChange;
    for (const changes of [
        [
            { ...first, path: "p".repeat(workspaceProtocolConfig.changesets.maxPathBytes + 1) },
            second,
        ],
        [
            {
                ...first,
                after: {
                    byte_length: workspaceProtocolConfig.changesets.maxSingleBlobBytes + 1,
                    content_id: blobId("5"),
                    kind: FILE,
                    mode: 420,
                },
            },
            second,
        ],
        [
            first,
            {
                ...second,
                after: {
                    kind: SYMLINK,
                    mode: null,
                    target: "t".repeat(
                        workspaceProtocolConfig.changesets.maxSymlinkTargetBytes + 1,
                    ),
                },
            },
        ],
    ]) {
        assert.throws(() => createFixture(changes as WorldPathChange[]), TypeError);
    }

    const largeFile = (path: string): WorldPathChange =>
        Object.freeze({
            after: Object.freeze({
                byte_length: workspaceProtocolConfig.changesets.maxSingleBlobBytes,
                content_id: blobId("6"),
                kind: FILE,
                mode: 420,
            }),
            before: Object.freeze({
                byte_length: workspaceProtocolConfig.changesets.maxSingleBlobBytes,
                content_id: blobId("7"),
                kind: FILE,
                mode: 420,
            }),
            operation: MODIFY,
            path,
        });
    assert.throws(() => createFixture([largeFile("a"), largeFile("b"), largeFile("c")]), TypeError);

    assert.throws(
        () =>
            createFixture(
                fixture.changeset.changes,
                SELECT_ACTION,
                "c".repeat(workspaceProtocolConfig.selectionPublication.maxPlanBytes),
            ),
        TypeError,
    );
});

test("selection step prefixes cannot cross plans", () => {
    const firstFixture = createFixture();
    const secondFixture = createFixture(
        firstFixture.changeset.changes,
        SELECT_ACTION,
        "command:other",
    );
    assert.throws(
        () => encodeSelectionPublicationStep(secondFixture.plan, firstFixture.steps[0] ?? null),
        TypeError,
    );
    const firstStep = firstFixture.steps[0];
    assert.ok(firstStep !== undefined);
    assert.throws(
        () =>
            encodeSelectionPublicationStep(firstFixture.plan, {
                ...firstStep,
                value: { ...firstStep.value, status: "unknown" as never },
            }),
        TypeError,
    );
});

test("published selection publication schema accepts every codec record kind", () => {
    const fixture = createFixture();
    const finalStep = fixture.steps.at(-1);
    assert.ok(finalStep !== undefined);
    const receipt = encodeSelectionPublicationReceipt(fixture.plan, finalStep, "basis:after");
    const schedule = encodeSelectionPublicationSchedule(fixture.plan);
    const scheduledSteps: ScheduledSelectionPublicationStepEncoding[] = [];
    let previousScheduled = null;
    for (const _ordinal of schedule.value.change_ordinals) {
        const step = encodeScheduledSelectionPublicationStep(
            fixture.plan,
            schedule,
            previousScheduled,
        );
        scheduledSteps.push(step);
        previousScheduled = step;
    }
    const scheduledReceipt = encodeScheduledSelectionPublicationReceipt(
        fixture.plan,
        schedule,
        scheduledSteps.at(-1) ?? null,
        "basis:after",
    );
    const schema = JSON.parse(
        readFileSync(
            new URL(
                "../../spec/schemas/retained-world-selection-publication-v3.schema.json",
                import.meta.url,
            ),
            "utf8",
        ),
    ) as AnySchemaObject;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    for (const value of [
        fixture.plan.value,
        schedule.value,
        ...scheduledSteps.map((step) => step.value),
        scheduledReceipt.value,
        ...fixture.steps.map((step) => step.value),
        receipt.value,
    ]) {
        assert.equal(validate(value), true, new Ajv2020().errorsText(validate.errors));
    }
    assert.equal(validate({ ...receipt.value, publication_version: 0 }), false);
    assert.equal(validate({ ...fixture.plan.value, extra: true }), false);
});

function createFixture(
    changes: readonly WorldPathChange[] = defaultChanges(),
    action: (typeof RETAINED_WORLD_SETTLEMENT_ACTIONS)[number] = SELECT_ACTION,
    commandId = "command:one",
) {
    const baseRevisionId = "revision:base";
    const bindingId = "binding:one";
    const headRevisionId = "revision:head";
    const semantic = {
        base_revision_id: baseRevisionId,
        binding_id: bindingId,
        changes: changes as unknown as SemanticRecord["changes"],
        head_revision_id: headRevisionId,
        schema_version: workspaceProtocolConfig.changesets.version,
    };
    const changesetId = digestId(workspaceProtocolConfig.changesets.idPrefix, semantic);
    const baseContentId = worldContentId("a");
    const headContentId = worldContentId("b");
    const request = Object.freeze({
        action,
        base_revision_id: baseRevisionId,
        binding_id: bindingId,
        capture_record_id: "record:capture",
        changeset_id: changesetId,
        command_id: commandId,
        custody_id: "custody:one",
        execution_cut_id: "cut:one",
        head_revision_id: headRevisionId,
        output_id: "output:one",
        run_id: "run:one",
        settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
        user_basis_before: baseContentId,
    }) satisfies RetainedWorldSettlementRequest;
    const admission = Object.freeze({
        action,
        command_id: commandId,
        output_id: request.output_id,
        request,
        request_id: "request:one",
        state: PREPARED_STATE,
    }) satisfies RetainedWorldSettlementAdmission;
    const operation = encodeRetainedWorldSettlementOperation(admission);
    const changeset = Object.freeze({
        ...semantic,
        changed_paths: Object.freeze(changes.map((change) => change.path)),
        changes: Object.freeze(changes),
        changeset_id: changesetId,
    }) as WorldChangeset;
    const plan =
        action === SELECT_ACTION
            ? encodeSelectionPublicationPlan(operation, changeset, baseContentId, headContentId)
            : null;
    const steps = [];
    if (plan !== null) {
        let previous = null;
        for (const _change of changes) {
            const step = encodeSelectionPublicationStep(plan, previous);
            steps.push(step);
            previous = step;
        }
    }
    return {
        baseContentId,
        changeset,
        headContentId,
        operation,
        plan: plan as NonNullable<typeof plan>,
        request,
        steps,
    };
}

function defaultChanges(): readonly WorldPathChange[] {
    return Object.freeze([
        Object.freeze({
            after: Object.freeze({
                byte_length: 3,
                content_id: blobId("1"),
                kind: FILE,
                mode: 420,
            }),
            before: null,
            operation: ADD,
            path: "one",
        }),
        Object.freeze({
            after: Object.freeze({ kind: SYMLINK, mode: null, target: "one" }),
            before: Object.freeze({ kind: DIRECTORY, mode: 493 }),
            operation: WORLD_CHANGE_OPERATIONS[3],
            path: "two",
        }),
    ]);
}

function dependencyChanges(): readonly WorldPathChange[] {
    const directory = (): WorldChangeNode => Object.freeze({ kind: DIRECTORY, mode: 493 });
    const file = (character: string): WorldChangeNode =>
        Object.freeze({
            byte_length: 1,
            content_id: blobId(character),
            kind: FILE,
            mode: 420,
        });
    const symlink = (): WorldChangeNode =>
        Object.freeze({ kind: SYMLINK, mode: null, target: "target" });
    return Object.freeze([
        Object.freeze({ after: null, before: directory(), operation: DELETE, path: "a" }),
        Object.freeze({ after: file("2"), before: file("1"), operation: MODIFY, path: "a-b" }),
        Object.freeze({ after: null, before: file("3"), operation: DELETE, path: "a/child" }),
        Object.freeze({ after: directory(), before: null, operation: ADD, path: "b" }),
        Object.freeze({ after: file("4"), before: null, operation: ADD, path: "b/child" }),
        Object.freeze({ after: symlink(), before: directory(), operation: REPLACE, path: "c" }),
        Object.freeze({ after: null, before: file("5"), operation: DELETE, path: "c/child" }),
        Object.freeze({ after: directory(), before: file("6"), operation: REPLACE, path: "d" }),
        Object.freeze({ after: file("7"), before: null, operation: ADD, path: "d/child" }),
        Object.freeze({ after: file("9"), before: file("8"), operation: MODIFY, path: "e" }),
    ]);
}

function blobId(character: string): string {
    return `${workspaceProtocolConfig.carrier.blobIdPrefix}${character.repeat(workspaceProtocolConfig.hexLength)}`;
}

function worldContentId(character: string): string {
    return `${workspaceProtocolConfig.carrier.worldContentIdPrefix}${character.repeat(workspaceProtocolConfig.hexLength)}`;
}

function digestId(prefix: string, value: SemanticRecord): string {
    const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord(value))
        .digest("hex");
    return `${prefix}${digest}`;
}

function digestPattern(prefix: string): RegExp {
    return new RegExp(`^${prefix}[0-9a-f]{${workspaceProtocolConfig.hexLength}}$`, "u");
}
