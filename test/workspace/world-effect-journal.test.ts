import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import {
    captureGrantedTaskWorldDurably,
    captureTaskWorldDurably,
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createRetainedWorldRunner,
    executeTask,
    grantTaskRepositories,
    inspectTaskWorldEffects,
    RETAINED_WORLD_MAX_TEXT_BYTES,
    type RetainedWorldCapability,
    type SemanticRecord,
    SQLiteTraceStore,
    TraceStoreError,
    validateEffectCorrelation,
    WORLD_EFFECT_PHASES,
} from "../../src/index.ts";
import { createWorldEffectFixture } from "./world-effect-fixtures.ts";

test("world capabilities retain overwritten operations even when the final changeset is empty", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    const { workspaceRoot } = fixture;
    using store = new SQLiteTraceStore(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "history-runner",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("value.txt", "A");
            await runnerContext.world.writeText("value.txt", "B");
            assert.equal(await runnerContext.world.readText("value.txt"), "B");
            await runnerContext.world.writeText("value.txt", "original");
            return executeTask(runnerContext.execution);
        },
    });
    const result = await captureTaskWorldDurably({ ...fixture.options, runner, store });
    assert.deepEqual(result.changeset.changed_paths, []);
    assert.equal(
        await readFile(path.join(workspaceRoot, "source", "value.txt"), "utf8"),
        "original",
    );
    const operations = store
        .readOwner("run:history")
        .filter(({ body }) => body.world_effect_version !== undefined);
    assert.ok(
        operations.length > 0,
        "intermediate operations must have durable evidence independently of final changesets",
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addKeyword("x-shepherd-max-utf8-bytes");
    const validate = ajv.compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/world-effect-journal-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    for (const record of operations) {
        assert.equal(validate(record.body), true, JSON.stringify(validate.errors));
        assert.equal(validate({ ...record.body, extra: true }), false);
        assert.equal(validate({ ...record.body, world_effect_version: 0 }), false);
    }
    const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
    assert.equal(evidence.status, "settled");
    assert.equal(evidence.recovery_status, "committed");
    assert.equal(evidence.authority?.binding_id, fixture.options.binding.binding_id);
    assert.equal(evidence.authority?.custody_id, result.output.custody_id);
    assert.deepEqual(
        evidence.operations.map((operation) => operation.index),
        [0, 1, 2, 3],
    );
    assert.deepEqual(
        evidence.operations.map((operation) => operation.intent.kind),
        [
            "retained_world.write_text",
            "retained_world.write_text",
            "retained_world.read_text",
            "retained_world.write_text",
        ],
    );
    const digests = evidence.operations.map((operation) => {
        const payload = operation.intent.payload as SemanticRecord;
        return payload.content === null ? null : (payload.content as SemanticRecord).digest;
    });
    assert.deepEqual(digests, [
        "sha256:559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd",
        "sha256:df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c",
        null,
        "sha256:0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5",
    ]);
    const readOutcome = evidence.operations[2]?.outcome;
    assert.ok(readOutcome?.result.ok);
    assert.equal(
        ((readOutcome.result.value as SemanticRecord).result as SemanticRecord).digest,
        "sha256:df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c",
    );
    const prefix = store.readOwnerPrefix(
        result.ledger.cut.target_owner_id,
        result.ledger.cut.through_owner_ordinal,
    );
    for (const operation of evidence.operations) {
        assert.ok(operation.outcome);
        validateEffectCorrelation(operation.intent, operation.outcome);
        assert.ok(operation.admission_record_id);
        assert.ok(operation.outcome_record_id);
        assert.ok(prefix.visible_records_by_id[operation.intent_record_id]);
        assert.ok(prefix.visible_records_by_id[operation.outcome_record_id]);
    }
    using readonly = new SQLiteTraceStore(fixture.storePath, { readOnly: true });
    assert.deepEqual(inspectTaskWorldEffects(readonly, fixture.options.execution.runId), evidence);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectTaskWorldEffects(imported, fixture.options.execution.runId), evidence);
});

test("a lost admission acknowledgement stays inspectable and blocks further physical work", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    const [, , admittedPhase] = WORLD_EFFECT_PHASES;
    class LostAdmissionAcknowledgement extends SQLiteTraceStore {
        override appendDurableExecutionTerminal(
            ...args: Parameters<SQLiteTraceStore["appendDurableExecutionTerminal"]>
        ): ReturnType<SQLiteTraceStore["appendDurableExecutionTerminal"]> {
            const result = super.appendDurableExecutionTerminal(...args);
            if (
                args[3].batch.groups.some((group) =>
                    group.records.some(
                        (record) =>
                            record.body.world_effect_version !== undefined &&
                            record.body.phase === admittedPhase,
                    ),
                )
            ) {
                throw new Error("lost admission acknowledgement");
            }
            return result;
        }
    }
    using store = new LostAdmissionAcknowledgement(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "lost-admission",
        run: async (runnerContext) => {
            await assert.rejects(runnerContext.world.writeText("value.txt", "must not appear"));
            await assert.rejects(runnerContext.world.writeText("value.txt", "also forbidden"));
            return executeTask(runnerContext.execution);
        },
    });
    await assert.rejects(
        captureTaskWorldDurably({ ...fixture.options, runner, store }),
        TraceStoreError,
    );
    using reopened = new SQLiteTraceStore(fixture.storePath, { readOnly: true });
    const effects = inspectTaskWorldEffects(reopened, fixture.options.execution.runId);
    assert.equal(effects.status, "uncertain");
    assert.equal(effects.recovery_status, "started");
    assert.equal(effects.operations.length, 1);
    assert.ok(effects.operations[0]?.admission_record_id);
    assert.equal(effects.operations[0]?.outcome, null);
    const custodyId = effects.authority?.custody_id;
    assert.ok(custodyId);
    assert.equal(
        await readFile(
            path.join((await fixture.options.carrier.openCustody(custodyId)).path, "value.txt"),
            "utf8",
        ),
        "original",
    );
    assert.equal(await readFile(path.join(fixture.sourceRoot, "value.txt"), "utf8"), "original");
});

test("refusals and filesystem failures are recorded without retaining plaintext content", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    const secret = `sk-proj-${"a".repeat(48)}`;
    using store = new SQLiteTraceStore(fixture.storePath, { secretScanning: "refuse" });
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "redacted-history",
        run: async (runnerContext) => {
            await assert.rejects(runnerContext.world.writeText("../escape.txt", secret), TypeError);
            await assert.rejects(runnerContext.world.readText("missing.txt"), TypeError);
            await assert.rejects(
                runnerContext.world.writeText(
                    "value.txt",
                    "x".repeat(RETAINED_WORLD_MAX_TEXT_BYTES + 1),
                ),
                TypeError,
            );
            await assert.rejects(runnerContext.world.writeText("value.txt", "\uD800"), TypeError);
            await assert.rejects(runnerContext.world.readText(1 as never), TypeError);
            await runnerContext.world.writeText("value.txt", secret);
            assert.equal(await runnerContext.world.readText("value.txt"), secret);
            await runnerContext.world.writeText("value.txt", "original");
            return executeTask(runnerContext.execution);
        },
    });
    const result = await captureTaskWorldDurably({ ...fixture.options, runner, store });
    assert.deepEqual(result.changeset.changed_paths, []);
    const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
    assert.deepEqual(
        evidence.operations.map((operation) => {
            const outcome = operation.outcome;
            assert.ok(outcome);
            return (
                outcome.result.ok
                    ? (outcome.result.value as SemanticRecord)
                    : (outcome.result.error as SemanticRecord)
            ).status;
        }),
        [
            "refused",
            "failed",
            "refused",
            "refused",
            "refused",
            "succeeded",
            "succeeded",
            "succeeded",
        ],
    );
    assert.ok(
        evidence.operations
            .slice(0, 5)
            .every((operation) => operation.admission_record_id === null),
    );
    const oversizedOperation = evidence.operations[2];
    assert.ok(oversizedOperation);
    const oversized = (oversizedOperation.intent.payload as SemanticRecord)
        .content as SemanticRecord;
    assert.equal(oversized.within_bound, false);
    assert.equal(oversized.digest, null);
    assert.equal(store.exportTrace().includes(secret), false);
    assert.equal(JSON.stringify(evidence).includes("../escape.txt"), false);
    assert.equal(await readFile(path.join(fixture.sourceRoot, "value.txt"), "utf8"), "original");
});

test("cancellation records an unmaterialized refusal and preserves the already-written partial world", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    const controller = new AbortController();
    using store = new SQLiteTraceStore(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "cancelled-history",
        run: async (runnerContext) => {
            await runnerContext.world.writeText("value.txt", "partial");
            controller.abort("operator cancellation");
            await assert.rejects(
                runnerContext.world.writeText("value.txt", "forbidden"),
                TypeError,
            );
            return executeTask(runnerContext.execution);
        },
    });
    const result = await captureTaskWorldDurably({
        ...fixture.options,
        execution: { ...fixture.options.execution, signal: controller.signal },
        runner,
        store,
    });
    assert.equal(result.execution.outcome.outcome.status, "cancelled");
    const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
    const outcome = evidence.operations[1]?.outcome;
    assert.ok(outcome && !outcome.result.ok);
    assert.deepEqual(outcome.result.error, { status: "cancelled" });
    assert.equal(evidence.operations[1]?.admission_record_id, null);
    assert.equal(
        await readFile(
            path.join(
                (await fixture.options.carrier.openRevision(result.output.head_revision_id)).path,
                "value.txt",
            ),
            "utf8",
        ),
        "partial",
    );
    assert.equal(await readFile(path.join(fixture.sourceRoot, "value.txt"), "utf8"), "original");
    assert.equal(JSON.stringify(evidence).includes("operator cancellation"), false);
});

test("grant denials retain exact resource evidence and stale capabilities cannot append after settlement", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    execFileSync("git", ["init", "--quiet"], { cwd: fixture.sourceRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: fixture.sourceRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture.sourceRoot });
    execFileSync("git", ["add", "value.txt"], { cwd: fixture.sourceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: fixture.sourceRoot });
    const binding = createGitRepositoryBindings({
        workspaceRoot: fixture.workspaceRoot,
        bindings: [{ name: "source", root: "source" }],
    }).bindings[0];
    assert.ok(binding);
    const granted = grantTaskRepositories({
        task: fixture.options.execution.task,
        grants: [{ binding: "source", profile: "read-write" }],
    });
    const repositoryGrantPlan = createGitRepositoryGrantPlan({
        task: granted,
        bindings: [binding],
        authorityCeiling: "read-only",
    });
    const baseRevision = await fixture.options.carrier.snapshot(binding);
    using store = new SQLiteTraceStore(fixture.storePath);
    let leaked: RetainedWorldCapability | undefined;
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "grant-history",
        run: async (runnerContext) => {
            leaked = runnerContext.world;
            assert.equal(await runnerContext.world.readText("value.txt"), "original");
            await assert.rejects(
                runnerContext.world.writeText("value.txt", "amplified"),
                /does not grant write/u,
            );
            await assert.rejects(runnerContext.world.readText(".git/config"), TypeError);
            return executeTask(runnerContext.execution);
        },
    });
    const result = await captureGrantedTaskWorldDurably({
        ...fixture.options,
        binding,
        baseRevision,
        repositoryGrantPlan,
        runner,
        store,
    });
    assert.deepEqual(result.changeset.changed_paths, []);
    const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
    assert.equal(evidence.authority?.grant_plan_id, repositoryGrantPlan.plan_id);
    assert.equal(evidence.authority?.resource_id, binding.resource_id);
    assert.deepEqual(evidence.authority?.authority, ["read"]);
    assert.ok(
        evidence.operations
            .slice(1)
            .every(
                (operation) =>
                    operation.admission_record_id === null &&
                    operation.outcome?.result.ok === false,
            ),
    );
    assert.ok(leaked);
    const before = store.exportTrace();
    await assert.rejects(leaked.writeText("value.txt", "stale"), TypeError);
    assert.equal(store.exportTrace(), before);
    const record = store.readRecord(evidence.authority_record_id as string);
    assert.ok(record);
    assert.throws(
        () =>
            store.append({
                append_intent_id: "forged-world-operation",
                batch: {
                    groups: [
                        {
                            owner_id: "forged-owner",
                            records: [
                                {
                                    body: record.body,
                                    caused_by_record_ids: record.envelope.caused_by_record_ids,
                                    mode: record.envelope.mode,
                                    schema_ref: record.envelope.schema_ref,
                                    witness_ref: record.envelope.witness_ref,
                                },
                            ],
                        },
                    ],
                },
            }),
        /require invocation authority/u,
    );
    assert.equal(store.exportTrace(), before);
});

test("fenced admission and lost outcome acknowledgements never permit another unlogged operation", async (context) => {
    for (const failure of ["fenced-admission", "lost-outcome"] as const) {
        const fixture = await createWorldEffectFixture(context);
        const [, , admittedPhase, outcomePhase] = WORLD_EFFECT_PHASES;
        class PublicationFaultStore extends SQLiteTraceStore {
            override appendDurableExecutionTerminal(
                ...args: Parameters<SQLiteTraceStore["appendDurableExecutionTerminal"]>
            ): ReturnType<SQLiteTraceStore["appendDurableExecutionTerminal"]> {
                const phases = args[3].batch.groups.flatMap((group) =>
                    group.records
                        .filter((record) => record.body.world_effect_version !== undefined)
                        .map((record) => record.body.phase),
                );
                if (failure === "fenced-admission" && phases.includes(admittedPhase))
                    return { status: "fenced" };
                const retained = super.appendDurableExecutionTerminal(...args);
                if (failure === "lost-outcome" && phases.includes(outcomePhase))
                    throw new Error("lost outcome acknowledgement");
                return retained;
            }
        }
        using store = new PublicationFaultStore(fixture.storePath);
        const runner = createRetainedWorldRunner({
            enforcement: "advisory",
            runnerId: "publication-fault",
            run: async (execution) => {
                await assert.rejects(
                    execution.world.writeText("value.txt", "changed"),
                    TraceStoreError,
                );
                await assert.rejects(
                    execution.world.writeText("value.txt", "forbidden"),
                    TraceStoreError,
                );
                return executeTask(execution.execution);
            },
        });
        await assert.rejects(
            captureTaskWorldDurably({ ...fixture.options, runner, store }),
            TraceStoreError,
        );
        const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
        assert.equal(evidence.operations.length, 1);
        assert.equal(
            evidence.status,
            failure === "fenced-admission" ? "not_materialized" : "recording",
        );
        assert.equal(evidence.operations[0]?.outcome !== null, failure === "lost-outcome");
        const custodyId = evidence.authority?.custody_id;
        assert.ok(custodyId);
        assert.equal(
            await readFile(
                path.join((await fixture.options.carrier.openCustody(custodyId)).path, "value.txt"),
                "utf8",
            ),
            failure === "fenced-admission" ? "original" : "changed",
        );
    }
});

test("capture refuses a fence lost after the runner completed its recorded operations", async (context) => {
    const fixture = await createWorldEffectFixture(context);
    class LostAfterRunnerStore extends SQLiteTraceStore {
        lost = false;
        override hasDurableExecutionInvocationAuthority(
            ...args: Parameters<SQLiteTraceStore["hasDurableExecutionInvocationAuthority"]>
        ): boolean {
            return !this.lost && super.hasDurableExecutionInvocationAuthority(...args);
        }
    }
    using store = new LostAfterRunnerStore(fixture.storePath);
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        runnerId: "late-fence-loss",
        run: async (execution) => {
            await execution.world.writeText("value.txt", "changed");
            const result = await executeTask(execution.execution);
            store.lost = true;
            return result;
        },
    });
    await assert.rejects(
        captureTaskWorldDurably({ ...fixture.options, runner, store }),
        /capture fence is stale/u,
    );
    const evidence = inspectTaskWorldEffects(store, fixture.options.execution.runId);
    assert.equal(evidence.status, "recording");
    assert.equal(evidence.operations[0]?.status, "settled");
    assert.equal(evidence.recovery_status, "started");
});
