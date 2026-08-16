import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    readlink,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    createWorldChangeset,
    initializeWorkspace,
    RETAINED_WORLD_SETTLEMENT_VERSION,
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
    publishReferenceCopySelection,
    stageReferenceCopySelection,
} from "../../src/workspace/reference-copy-carrier.ts";
import {
    encodeScheduledSelectionPublicationStep,
    encodeSelectionPublicationPlan,
    encodeSelectionPublicationSchedule,
} from "../../src/workspace/selection-publication-codec.ts";

const [PREPARED_STATE] = RETAINED_WORLD_SETTLEMENT_STATES;

test("reference carrier publishes and reopens an exact scheduled selection", async (context) => {
    const fixture = await createFixture(context);
    const receipt = await publishReferenceCopySelection(fixture.carrier, fixture.publication);

    assert.equal(await readFile(path.join(fixture.sourceRoot, "a.txt"), "utf8"), "after-a\n");
    assert.equal(await readFile(path.join(fixture.sourceRoot, "b.txt"), "utf8"), "after-b\n");
    await assert.rejects(readFile(path.join(fixture.sourceRoot, "delete.txt"), "utf8"));
    await assert.rejects(readFile(path.join(fixture.sourceRoot, "old", "child.txt"), "utf8"));
    assert.equal(
        await readFile(path.join(fixture.sourceRoot, "new", "child.txt"), "utf8"),
        "new\n",
    );
    assert.equal(await readlink(path.join(fixture.sourceRoot, "link")), "b.txt");
    assert.equal(receipt.value.user_basis_after, fixture.head.content_id);
    assert.equal(Object.isFrozen(receipt), true);

    const reopened = createInternalCarrier({ workspaceRoot: fixture.workspaceRoot });
    assert.deepEqual(await publishReferenceCopySelection(reopened, fixture.publication), receipt);
    await assert.rejects(
        publishReferenceCopySelection(reopened, {
            ...fixture.publication,
            observeUserBasis: async () => "basis:unexpected",
        }),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.recoveryRequiredCode,
    );
    await writeFile(path.join(fixture.sourceRoot, "b.txt"), "moved-after-publication\n");
    await assert.rejects(
        publishReferenceCopySelection(reopened, fixture.publication),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.recoveryRequiredCode,
    );
    assert.deepEqual(
        await readdir(
            path.join(
                fixture.workspaceRoot,
                workspaceProtocolConfig.controlDirectory,
                workspaceProtocolConfig.carrier.carrierDirectory,
                workspaceProtocolConfig.carrier.stagingDirectory,
            ),
        ),
        [],
    );
});

test("reference carrier recovers an exact prefix and refuses a third state", async (context) => {
    const fixture = await createFixture(context);
    const first = encodeScheduledSelectionPublicationStep(fixture.plan, fixture.schedule, null);
    assert.equal(first.value.change.path, "a.txt");
    await writeFile(path.join(fixture.sourceRoot, first.value.change.path), "after-a\n");
    await chmod(path.join(fixture.sourceRoot, first.value.change.path), 0o600);
    const staging = stageReferenceCopySelection(fixture.carrier, fixture.publication);
    const stepsRoot = path.join(
        path.dirname(staging.staging_path),
        workspaceProtocolConfig.selectionPublication.stepsDirectory,
    );
    await writeFile(
        path.join(
            stepsRoot,
            first.id.slice(
                workspaceProtocolConfig.selectionPublication.scheduledStepIdPrefix.length,
            ),
        ),
        `${JSON.stringify(first.value)}\n`,
    );
    await writeFile(path.join(fixture.sourceRoot, "b.txt"), "third-state\n");

    await assert.rejects(
        publishReferenceCopySelection(fixture.carrier, fixture.publication),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.recoveryRequiredCode,
    );
    assert.equal(await readFile(path.join(fixture.sourceRoot, "b.txt"), "utf8"), "third-state\n");

    await writeFile(path.join(fixture.sourceRoot, "b.txt"), "before-b\n");
    await unlink(path.join(fixture.sourceRoot, "b.txt"));
    execFileSync("mkfifo", [path.join(fixture.sourceRoot, "b.txt")]);
    await assert.rejects(
        publishReferenceCopySelection(fixture.carrier, fixture.publication),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.unsupportedCode,
    );
    await unlink(path.join(fixture.sourceRoot, "b.txt"));
    await writeFile(path.join(fixture.sourceRoot, "b.txt"), "before-b\n");
    await rm(path.join(fixture.sourceRoot, "old"), { recursive: true });
    await writeFile(path.join(fixture.sourceRoot, "old"), "not-a-directory\n");
    await assert.rejects(
        publishReferenceCopySelection(fixture.carrier, fixture.publication),
        WorldCarrierError,
    );
    await unlink(path.join(fixture.sourceRoot, "old"));
    await mkdir(path.join(fixture.sourceRoot, "old"));
    await writeFile(path.join(fixture.sourceRoot, "old", "child.txt"), "old\n");
    const receipt = await publishReferenceCopySelection(fixture.carrier, fixture.publication);
    assert.equal(receipt.value.final_step_id === null, false);
    assert.equal(await readFile(path.join(fixture.sourceRoot, "b.txt"), "utf8"), "after-b\n");
});

test("reference carrier converges concurrent publication and rejects an empty after basis", async (context) => {
    const fixture = await createFixture(context);
    const [first, second] = await Promise.all([
        publishReferenceCopySelection(fixture.carrier, fixture.publication),
        publishReferenceCopySelection(fixture.carrier, fixture.publication),
    ]);
    assert.deepEqual(second, first);

    const emptyFixture = await createFixture(context);
    let observations = 0;
    await assert.rejects(
        publishReferenceCopySelection(emptyFixture.carrier, {
            ...emptyFixture.publication,
            observeUserBasis: async () => {
                observations += 1;
                return observations === 1 ? emptyFixture.plan.value.user_basis_before : "";
            },
        }),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.recoveryRequiredCode,
    );
    const recovered = await publishReferenceCopySelection(
        emptyFixture.carrier,
        emptyFixture.publication,
    );
    assert.equal(recovered.value.user_basis_after, emptyFixture.head.content_id);

    const failedFixture = await createFixture(context);
    let failedObservations = 0;
    const publications = path.join(
        failedFixture.workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.selectionPublication.publicationsDirectory,
    );
    await assert.rejects(
        publishReferenceCopySelection(failedFixture.carrier, {
            ...failedFixture.publication,
            observeUserBasis: async () => {
                const basis = await failedFixture.publication.observeUserBasis();
                failedObservations += 1;
                if (failedObservations === 2) {
                    await rm(publications, { recursive: true });
                    await writeFile(publications, "blocked\n");
                }
                return basis;
            },
        }),
        WorldCarrierError,
    );

    const movedFixture = await createFixture(context);
    await writeFile(path.join(movedFixture.sourceRoot, "a.txt"), "moved-before-publication\n");
    await assert.rejects(
        publishReferenceCopySelection(movedFixture.carrier, movedFixture.publication),
        (error: unknown) =>
            error instanceof WorldCarrierError &&
            error.code === workspaceProtocolConfig.selectionPublication.errors.basisMovedCode,
    );

    const brokenStepFixture = await createFixture(context);
    const brokenStaging = stageReferenceCopySelection(
        brokenStepFixture.carrier,
        brokenStepFixture.publication,
    );
    const brokenSteps = path.join(
        path.dirname(brokenStaging.staging_path),
        workspaceProtocolConfig.selectionPublication.stepsDirectory,
    );
    await assert.rejects(
        publishReferenceCopySelection(brokenStepFixture.carrier, {
            ...brokenStepFixture.publication,
            observeUserBasis: async () => {
                const basis = await brokenStepFixture.publication.observeUserBasis();
                await rm(brokenSteps, { recursive: true });
                await writeFile(brokenSteps, "blocked\n");
                return basis;
            },
        }),
        WorldCarrierError,
    );

    const corruptReceiptFixture = await createFixture(context);
    await publishReferenceCopySelection(
        corruptReceiptFixture.carrier,
        corruptReceiptFixture.publication,
    );
    const corruptStaging = stageReferenceCopySelection(
        corruptReceiptFixture.carrier,
        corruptReceiptFixture.publication,
    );
    await writeFile(
        path.join(
            path.dirname(corruptStaging.staging_path),
            workspaceProtocolConfig.selectionPublication.publicationFile,
        ),
        `${JSON.stringify({ user_basis_after: 1 })}\n`,
    );
    await assert.rejects(
        publishReferenceCopySelection(
            corruptReceiptFixture.carrier,
            corruptReceiptFixture.publication,
        ),
        WorldCarrierError,
    );
});

async function createFixture(context: TestContext) {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-selection-publication-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const sourceRoot = path.join(workspaceRoot, "source");
    await mkdir(sourceRoot);
    await writeFile(path.join(sourceRoot, "a.txt"), "before-a\n");
    await writeFile(path.join(sourceRoot, "b.txt"), "before-b\n");
    await writeFile(path.join(sourceRoot, "delete.txt"), "delete\n");
    await mkdir(path.join(sourceRoot, "old"));
    await writeFile(path.join(sourceRoot, "old", "child.txt"), "old\n");
    await symlink("a.txt", path.join(sourceRoot, "link"));
    await mkdir(path.join(sourceRoot, "mode-dir"));
    await chmod(path.join(sourceRoot, "mode-dir"), 0o755);
    const binding = createWorkspaceBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const base = await carrier.snapshot(binding);
    const custody = await carrier.fork(base.revision_id);
    await writeFile(path.join(custody.path, "a.txt"), "after-a\n");
    await chmod(path.join(custody.path, "a.txt"), 0o600);
    await writeFile(path.join(custody.path, "b.txt"), "after-b\n");
    await unlink(path.join(custody.path, "delete.txt"));
    await rm(path.join(custody.path, "old"), { recursive: true });
    await mkdir(path.join(custody.path, "new"));
    await writeFile(path.join(custody.path, "new", "child.txt"), "new\n");
    await unlink(path.join(custody.path, "link"));
    await symlink("b.txt", path.join(custody.path, "link"));
    await chmod(path.join(custody.path, "mode-dir"), 0o700);
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
    const observeUserBasis = async () => (await carrier.snapshot(binding)).content_id;
    return {
        carrier,
        head,
        plan,
        publication: { changeset, observeUserBasis, operation, plan, schedule },
        schedule,
        sourceRoot,
        workspaceRoot,
    };
}
