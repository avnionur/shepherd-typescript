import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    canonicalizeRecord,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    createWorldChangeset,
    initializeWorkspace,
    RETAINED_WORLD_SETTLEMENT_VERSION,
    WorkspaceProtectedPathError,
    WorldCarrierError,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { RETAINED_WORLD_SETTLEMENT_STATES } from "../../src/protocol/values.generated.ts";
import { encodeRetainedWorldSettlementOperation } from "../../src/store/retained-world-settlement-codec.ts";
import type {
    RetainedWorldSettlementAdmission,
    RetainedWorldSettlementRequest,
} from "../../src/store/types.ts";
import {
    createReferenceCopyCarrier as createInternalCarrier,
    stageReferenceCopySelection,
} from "../../src/workspace/reference-copy-carrier.ts";
import {
    encodeSelectionPublicationPlan,
    encodeSelectionPublicationSchedule,
} from "../../src/workspace/selection-publication-codec.ts";

const [PREPARED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;

test("reference carrier stages exact selection evidence from immutable head custody", async (context) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-selection-staging-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "message.txt"), "before\n");
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const base = await carrier.snapshot(binding);
    const custody = await carrier.fork(base.revision_id);
    await writeFile(path.join(custody.path, "message.txt"), "after\n");
    await mkdir(path.join(custody.path, "nested"));
    await writeFile(path.join(custody.path, "nested", "new.txt"), "new\n");
    const head = await carrier.captureCustody(custody.custody_id);
    const changeset = await createWorldChangeset({
        baseRevision: base,
        carrier,
        headRevision: head,
    });
    const request = Object.freeze({
        action: "select",
        base_revision_id: base.revision_id,
        binding_id: binding.binding_id,
        capture_record_id: "record:capture",
        changeset_id: changeset.changeset_id,
        command_id: "command:select",
        custody_id: custody.custody_id,
        execution_cut_id: "cut:execution",
        head_revision_id: head.revision_id,
        output_id: "output:retained",
        run_id: "run:retained",
        settlement_version: RETAINED_WORLD_SETTLEMENT_VERSION,
        user_basis_before: base.content_id,
    }) satisfies RetainedWorldSettlementRequest;
    const admission = Object.freeze({
        action: request.action,
        command_id: request.command_id,
        output_id: request.output_id,
        request,
        request_id: "request:select",
        state: PREPARED_STATE,
    }) satisfies RetainedWorldSettlementAdmission;
    const operation = encodeRetainedWorldSettlementOperation(admission);
    const plan = encodeSelectionPublicationPlan(
        operation,
        changeset,
        base.content_id,
        head.content_id,
    );
    const schedule = encodeSelectionPublicationSchedule(plan);
    const definition = { changeset, operation, plan, schedule };
    const staging = stageReferenceCopySelection(carrier, definition);

    assert.equal(await readFile(path.join(staging.staging_path, "message.txt"), "utf8"), "after\n");
    assert.equal(
        await readFile(path.join(staging.staging_path, "nested", "new.txt"), "utf8"),
        "new\n",
    );
    assert.equal(await readFile(path.join(sourceRoot, "message.txt"), "utf8"), "before\n");
    assert.equal(staging.plan_id, plan.id);
    assert.equal(staging.schedule_id, schedule.id);
    assert.equal(staging.staging_id, plan.staging_id);
    assert.equal(Object.isFrozen(staging), true);

    const reopened = createInternalCarrier({ workspaceRoot });
    assert.deepEqual(stageReferenceCopySelection(reopened, definition), staging);
    const stepsRoot = path.join(
        path.dirname(staging.staging_path),
        workspaceProtocolConfig.selectionPublication.stepsDirectory,
    );
    await rm(stepsRoot, { recursive: true });
    const stagingRoot = path.dirname(staging.staging_path);
    await chmod(stagingRoot, 0o500);
    try {
        assert.throws(() => stageReferenceCopySelection(reopened, definition), WorldCarrierError);
    } finally {
        await chmod(stagingRoot, 0o700);
    }
    assert.deepEqual(stageReferenceCopySelection(reopened, definition), staging);
    assert.deepEqual(await readdir(stepsRoot), []);
    const genericStaging = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.stagingDirectory,
    );
    assert.deepEqual(await readdir(genericStaging), []);

    for (const invalidPlan of [
        { ...plan, id: `${plan.id}0` },
        { ...plan, digest: `${plan.digest}0` },
        { ...plan, staging_id: `${plan.staging_id}0` },
        { ...plan, value: { ...plan.value, output_id: "output:wrong" } },
        { ...plan, json: "{}" },
    ]) {
        assert.throws(
            () => stageReferenceCopySelection(reopened, { ...definition, plan: invalidPlan }),
            WorldCarrierError,
        );
    }
    for (const invalidSchedule of [
        { ...schedule, id: `${schedule.id}0` },
        { ...schedule, digest: `${schedule.digest}0` },
        { ...schedule, value: { ...schedule.value, plan_id: "plan:wrong" } },
    ]) {
        assert.throws(
            () =>
                stageReferenceCopySelection(reopened, {
                    ...definition,
                    schedule: invalidSchedule,
                }),
            WorldCarrierError,
        );
    }

    const firstChange = changeset.changes[0];
    assert.ok(firstChange);
    const protectedPath = workspaceProtocolConfig.controlDirectory.toUpperCase();
    const protectedChanges = Object.freeze([
        Object.freeze({ ...firstChange, path: protectedPath }),
    ]);
    const protectedSemantic = {
        base_revision_id: changeset.base_revision_id,
        binding_id: changeset.binding_id,
        changes: protectedChanges,
        head_revision_id: changeset.head_revision_id,
        schema_version: changeset.schema_version,
    };
    const protectedChangesetId = `${workspaceProtocolConfig.changesets.idPrefix}${createHash(
        workspaceProtocolConfig.digestAlgorithm,
    )
        .update(canonicalizeRecord(protectedSemantic))
        .digest("hex")}`;
    const protectedChangeset = Object.freeze({
        ...protectedSemantic,
        changed_paths: Object.freeze([protectedPath]),
        changeset_id: protectedChangesetId,
    });
    const protectedRequest = Object.freeze({
        ...request,
        changeset_id: protectedChangesetId,
    });
    const protectedAdmission = Object.freeze({
        ...admission,
        request: protectedRequest,
    });
    const protectedOperation = encodeRetainedWorldSettlementOperation(protectedAdmission);
    const protectedPlan = encodeSelectionPublicationPlan(
        protectedOperation,
        protectedChangeset,
        base.content_id,
        head.content_id,
    );
    const protectedSchedule = encodeSelectionPublicationSchedule(protectedPlan);
    assert.throws(
        () =>
            stageReferenceCopySelection(reopened, {
                changeset: protectedChangeset,
                operation: protectedOperation,
                plan: protectedPlan,
                schedule: protectedSchedule,
            }),
        WorkspaceProtectedPathError,
    );
    assert.deepEqual(await readdir(genericStaging), []);

    await writeFile(path.join(staging.staging_path, "message.txt"), "corrupt\n");
    assert.throws(() => stageReferenceCopySelection(reopened, definition), WorldCarrierError);
    assert.throws(() => stageReferenceCopySelection({ ...carrier }, definition), TypeError);
    assert.equal(await readFile(path.join(sourceRoot, "message.txt"), "utf8"), "before\n");
    assert.deepEqual(await readdir(genericStaging), []);
});
