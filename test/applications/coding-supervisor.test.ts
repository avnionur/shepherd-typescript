import assert from "node:assert/strict";
import { test } from "node:test";

import {
    type CodingSupervisorDecision,
    type CodingSupervisorPolicyContext,
    type CodingSupervisorWorkerDefinition,
    DelegationSupervisorError,
    deriveApplicationOwnerId,
    injectChildRunContext,
    inspectChildRun,
    inspectCodingSupervisorRun,
    inspectScope,
    projectChildRunResult,
    type RecordId,
    runCodingSupervisor,
    SQLiteTraceStore,
    WorldCarrierError,
} from "../../src/index.ts";
import { bindingGrant } from "../scope/fork-fixtures.ts";
import { LEAD, rootParent, supervisionProtocol, workerOf } from "./fixtures.ts";
import {
    createSupervisorWorld,
    readParentFile,
    type SupervisorWorld,
    writeCustodyEdit,
} from "./world-adapter-fixture.ts";

const NEXT = "supervisor:next";
const COMMAND = "application:world";

function worldWorkers(world: SupervisorWorld): readonly CodingSupervisorWorkerDefinition[] {
    return ["a", "b"].map((workerId) =>
        workerOf(workerId, writeCustodyEdit, {
            grant: [bindingGrant(world.source)],
            input: { path: "file.txt", text: `${workerId} edit` },
        }),
    );
}

test("two workers editing one bound resource are supervised through inject, restart, handoff, and accept", async (context) => {
    const world = await createSupervisorWorld(context, "supervisor");
    const { store } = world;
    const contexts: CodingSupervisorPolicyContext[] = [];
    const policy = (policyContext: CodingSupervisorPolicyContext): CodingSupervisorDecision => {
        contexts.push(policyContext);
        const [a] = policyContext.observations;
        const decisions: readonly CodingSupervisorDecision[] = [
            {
                cited_record_ids: [(a as { readonly head_record_id: RecordId }).head_record_id],
                data: { hint: "keep the greeting short" },
                kind: "inject",
                worker_id: "a",
            },
            { kind: "discard_restart", reason: "b conflicts with a", worker_id: "b" },
            { kind: "handoff", reason: null, successor_supervisor_id: NEXT, worker_id: "b" },
            { kind: "accept", worker_id: "b" },
        ];
        return decisions[policyContext.round - 1] as CodingSupervisorDecision;
    };
    const options = {
        clock: () => 2_000,
        commandId: COMMAND,
        parent: rootParent({ ceiling: [bindingGrant(world.source)] }),
        policy,
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers: worldWorkers(world),
        world: world.adapter,
    };
    const { inspection, manifest } = await runCodingSupervisor(store, options);
    const applicationId = deriveApplicationOwnerId(COMMAND);
    assert.equal(manifest.application_id, applicationId);
    assert.equal(inspection.world, true);
    assert.match(inspection.cut_id as string, /^application-cut:sha256:[0-9a-f]{64}$/u);
    assert.equal(inspection.manifest?.manifest_id, manifest.manifest_id);
    assert.deepEqual(
        inspection.decisions.map((decision) => [
            decision.round,
            decision.decision.kind,
            decision.conflict.kind,
        ]),
        [
            [1, "inject", "none"],
            [2, "discard_restart", "path_overlap"],
            [3, "handoff", "path_overlap"],
            [4, "accept", "path_overlap"],
        ],
    );
    assert.equal(contexts.length, 4);
    // Round 1: both workers are ready in forked custody with nothing changed yet.
    const [first, second, third, fourth] = inspection.decisions;
    assert.deepEqual(
        first?.observations.map((observation) => [
            observation.worker_id,
            observation.attempt,
            observation.status,
            observation.worker_status,
            observation.changed_paths,
            observation.completion_status,
        ]),
        [
            ["a", 1, "ready", "running", [], null],
            ["b", 1, "ready", "running", [], null],
        ],
    );
    assert.ok(first?.observations.every((observation) => observation.custody_id !== null));
    assert.deepEqual(first?.conflict, { kind: "none", paths: [], worker_ids: [] });
    // The injection was consumed before worker a started: the consumption record lists exactly it
    // and the program saw one context entry.
    const injection = (
        (first as NonNullable<typeof first>).evidence as { readonly injection_record_id: RecordId }
    ).injection_record_id;
    const aHandle = inspection.workers[0]?.attempts[0]?.inspection;
    assert.deepEqual(aHandle?.consumed_context?.consumed_record_ids, [injection]);
    assert.equal(aHandle?.injections[0]?.consumed, true);
    assert.deepEqual(aHandle?.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: { path: "file.txt", text: "a edit|prior:source|context:1" },
    });
    // Round 2: both workers changed the same path, so the conflict is a path overlap.
    assert.deepEqual(second?.conflict, {
        kind: "path_overlap",
        paths: ["file.txt"],
        worker_ids: ["a", "b"],
    });
    assert.deepEqual(
        second?.observations.map((observation) => [
            observation.worker_id,
            observation.changed_paths,
            observation.completion_status,
        ]),
        [
            ["a", ["file.txt"], "finished"],
            ["b", ["file.txt"], "finished"],
        ],
    );
    const restart = second?.evidence as {
        readonly decision_record_id: RecordId;
        readonly discard_receipt_id: string;
        readonly fork_receipt_id: string;
        readonly retry_cut_id: string;
        readonly successor_handle_id: string;
    };
    assert.match(restart.retry_cut_id, /^delegation-retry:sha256:/u);
    assert.notEqual(restart.discard_receipt_id, null);
    assert.notEqual(restart.fork_receipt_id, null);
    const bLineage = inspection.workers[1];
    assert.deepEqual(
        bLineage?.attempts.map((attempt) => [attempt.attempt, attempt.status]),
        [
            [1, "restarted"],
            [2, "accepted"],
        ],
    );
    assert.equal(bLineage?.attempts[1]?.handle_id, restart.successor_handle_id);
    assert.equal(
        bLineage?.attempts[1]?.inspection.predecessor?.decision_record_id,
        restart.decision_record_id,
    );
    // The restarted worker started from a clean fork: it found the origin content, not its own
    // discarded edit, and its discarded custody is gone.
    assert.deepEqual(bLineage?.attempts[1]?.inspection.child?.outcome?.outcome.outcome, {
        status: "finished",
        value: { path: "file.txt", text: "b edit|prior:source|context:0" },
    });
    const discardedCustody = second?.observations[1]?.custody_id as string;
    await assert.rejects(world.carrier.openCustody(discardedCustody), WorldCarrierError);
    const successorCustody = third?.observations[1]?.custody_id as string;
    assert.notEqual(successorCustody, discardedCustody);
    // Round 3: the handoff moved b to the successor; the application then names the successor and
    // former-supervisor commands are refused by the delegation seam.
    assert.deepEqual(
        fourth?.observations.map((observation) => [
            observation.worker_id,
            observation.supervisor_id,
            observation.worker_status,
        ]),
        [
            ["a", LEAD, "running"],
            ["b", NEXT, "handed_off"],
        ],
    );
    const accepted = bLineage?.attempts[1]?.inspection;
    assert.equal(accepted?.supervisor_id, NEXT);
    assert.equal(accepted?.decision?.supervisor_id, NEXT);
    assert.equal(accepted?.status, "accepted");
    assert.equal(inspection.workers[0]?.attempts[0]?.status, "discarded");
    assert.equal(
        inspection.workers[0]?.attempts[0]?.inspection.decision?.reason,
        "worker was not accepted by the coding supervisor",
    );
    const acceptEvidence = fourth?.evidence as {
        readonly discarded: readonly {
            readonly worker_id: string;
            readonly discard_receipt_id: string;
        }[];
        readonly merge_receipt_id: string;
    };
    assert.deepEqual(
        acceptEvidence.discarded.map((worker) => worker.worker_id),
        ["a"],
    );
    assert.notEqual(acceptEvidence.merge_receipt_id, null);
    // The accepted custody was merged into the parent world and every other scope is discarded.
    assert.equal(await readParentFile(world, "file.txt"), "b edit\n");
    const children = inspectScope(store, world.parent.scope_id)?.children ?? [];
    assert.deepEqual(children.map((scopeId) => inspectScope(store, scopeId)?.state).sort(), [
        "discarded",
        "discarded",
        "merged",
    ]);
    assert.equal(projectChildRunResult(store, accepted?.handle_id as string).value !== null, true);
    // The manifest cites every worker attempt, decision, fork, discard, and merge by identity.
    assert.deepEqual(manifest.artifacts.map((artifact) => artifact.role).sort(), [
        "decision",
        "decision",
        "decision",
        "decision",
        "worker",
        "worker",
        "worker",
        "world_discard",
        "world_discard",
        "world_fork",
        "world_fork",
        "world_fork",
        "world_merge",
    ]);
    assert.equal(manifest.costs.provider_calls, 3);
    assert.equal(manifest.costs.cost_usd, null);
    assert.equal(manifest.protocol_id, inspection.protocol_id);
    // Inspection is identical on the live, read-only reopened, and imported stores, and repeating
    // the command returns the retained manifest without consulting the policy again.
    using readOnly = new SQLiteTraceStore(world.databasePath, { readOnly: true });
    assert.deepEqual(inspectCodingSupervisorRun(readOnly, applicationId), inspection);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectCodingSupervisorRun(imported, applicationId), inspection);
    const repeated = await runCodingSupervisor(store, {
        ...options,
        policy: () => {
            throw new Error("the policy must not run again");
        },
    });
    assert.deepEqual(repeated.manifest, manifest);
    assert.deepEqual(repeated.inspection, inspection);
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [inspection.opened_record_id],
                commandId: "inject:former",
                data: { late: true },
                handle: { ...world } as never,
                supervisorId: LEAD,
            }),
        TypeError,
    );
    assert.equal(inspectChildRun(store, accepted?.handle_id as string).supervisor_id, NEXT);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("former-supervisor commands on a handed-off worker are refused by the delegation seam", async (context) => {
    const world = await createSupervisorWorld(context, "handoff");
    const { store } = world;
    let handle: unknown = null;
    const policy = (policyContext: CodingSupervisorPolicyContext): CodingSupervisorDecision => {
        if (policyContext.round === 1) {
            return {
                kind: "handoff",
                reason: "second opinion",
                successor_supervisor_id: NEXT,
                worker_id: "a",
            };
        }
        return { kind: "accept", worker_id: "a" };
    };
    const workers = worldWorkers(world).map((worker) =>
        worker.workerId === "a"
            ? {
                  ...worker,
                  program: (programContext: Parameters<typeof writeCustodyEdit>[0]) => {
                      handle = programContext.handle;
                      return writeCustodyEdit(programContext);
                  },
              }
            : worker,
    );
    const { inspection } = await runCodingSupervisor(store, {
        clock: () => 2_000,
        commandId: "application:handoff",
        parent: rootParent({ ceiling: [bindingGrant(world.source)] }),
        policy,
        protocol: supervisionProtocol(),
        supervisorId: LEAD,
        workers,
        world: world.adapter,
    });
    assert.equal(inspection.decisions[0]?.decision.kind, "handoff");
    assert.equal(
        (inspection.decisions[0]?.decision as { readonly reason?: string } | undefined)?.reason,
        "second opinion",
    );
    assert.equal(inspection.workers[0]?.attempts[0]?.inspection.handoffs[0]?.successor_id, NEXT);
    assert.equal(inspection.workers[0]?.attempts[0]?.status, "accepted");
    assert.throws(
        () =>
            injectChildRunContext(store, {
                citedRecordIds: [inspection.opened_record_id],
                commandId: "inject:former",
                data: { late: true },
                handle: handle as never,
                supervisorId: LEAD,
            }),
        DelegationSupervisorError,
    );
    assert.equal(await readParentFile(world, "file.txt"), "a edit\n");
});
