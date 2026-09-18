import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
} from "../../src/applications/records.ts";
import {
    readTreeRlBatchBody,
    readTreeRlOpenedBody,
    readTreeRlRolloutBody,
} from "../../src/applications/tree-rl-records.ts";
import * as applications from "../../src/facades/applications.ts";
import * as root from "../../src/index.ts";
import {
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
    APPLICATION_TREE_RL_PHASES,
    APPLICATION_TREE_RL_ROLLOUT_STATUSES,
    ApplicationBudgetError,
    ApplicationEvidenceError,
    createStaticProvider,
    deriveApplicationOwnerId,
    inspectTreeRlRun,
    type ModelProvider,
    type ModelRequest,
    type RecordBody,
    type RecordId,
    runTreeRlRollouts,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    APPLICATIONS_PROTOCOL_V3_CONTRACT,
    APPLICATIONS_PROTOCOL_V4_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    providerFactory,
    recordSource,
    rewardOf,
    treeRlOptions,
    treeRlProtocolWithBudgets,
} from "./tree-rl-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;
const traceSchema = applicationsProtocolConfig.traceSchemas.treeRlRollout;

function bodyOf(store: SQLiteTraceStore, recordId: RecordId | null | undefined): RecordBody {
    return store.readRecord(recordId as RecordId)?.body as RecordBody;
}

test("applications protocol v4 appends the Tree-RL vocabulary to v3 and refuses drift", () => {
    for (const key of [
        "kinds",
        "supervision",
        "cro",
        "compression",
        "identity",
        "limits",
        "errors",
    ] as const) {
        assert.deepEqual(
            APPLICATIONS_PROTOCOL_V4_CONTRACT[key],
            APPLICATIONS_PROTOCOL_V3_CONTRACT[key],
        );
    }
    assert.equal(
        APPLICATIONS_PROTOCOL_V4_CONTRACT.artifacts.compressionSchema,
        APPLICATIONS_PROTOCOL_V3_CONTRACT.artifacts.compressionSchema,
    );
    assert.equal(
        APPLICATIONS_PROTOCOL_V4_CONTRACT.traceSchemas.treeRlRollout,
        "shepherd.application.tree_rl_rollout.v1",
    );
    assert.deepEqual(applicationsProtocolConfig.treeRl, APPLICATIONS_PROTOCOL_V4_CONTRACT.treeRl);
    assert.equal(APPLICATIONS_PROTOCOL_V4_CONTRACT.treeRl.artifactRoles.batch, "training_batch");
    assert.deepEqual(APPLICATION_TREE_RL_PHASES, ["opened", "rollout", "batch"]);
    assert.deepEqual(APPLICATION_TREE_RL_ROLLOUT_STATUSES, ["completed", "failed"]);
    assert.deepEqual(APPLICATION_TREE_RL_BASELINE_KINDS, ["single_rollout"]);
    assert.deepEqual(APPLICATION_TREE_RL_BATCH_FORMATS, ["jsonl_v1"]);
    const mutations: readonly ((treeRl: Record<string, unknown>) => void)[] = [
        (treeRl) => {
            treeRl.artifactRoles = {
                ...(treeRl.artifactRoles as object),
                rollout: "training_batch",
            };
        },
        (treeRl) => {
            treeRl.baselineKinds = ["single_rollout", "other"];
        },
        (treeRl) => {
            treeRl.batchFormats = [];
        },
        (treeRl) => {
            treeRl.budgetKeys = {
                branches: "same",
                forkPoints: "same",
                minDependents: "a",
                providerCalls: "b",
            };
        },
        (treeRl) => {
            treeRl.phases = ["opened", "rollout"];
        },
        (treeRl) => {
            treeRl.reasons = {
                diverged: "same",
                interrupted: "same",
                notFinished: "a",
                rewardFailed: "b",
            };
        },
        (treeRl) => {
            treeRl.rolloutStatuses = ["completed"];
        },
        (treeRl) => {
            treeRl.surfaceRoles = { batch: "same", rollout: "same" };
        },
        (treeRl) => {
            delete treeRl.phases;
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config.applications?.treeRl as Record<string, unknown>);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
    const missing = structuredClone(validConfig);
    delete (missing.applications as Record<string, unknown>).treeRl;
    assert.throws(() => parseProtocolConfig(missing), TypeError);
    const drifted = structuredClone(validConfig);
    (drifted.applications?.treeRl as Record<string, unknown>).batchFormats = ["jsonl_v2"];
    assert.throws(
        () => parseProtocolConfig(drifted),
        (error: unknown) =>
            error instanceof TypeError && /new applications protocol/u.test(error.message),
    );
});

test("the applications facade exposes the Tree-RL adapter as the root does", () => {
    for (const name of [
        "APPLICATION_TREE_RL_BASELINE_KINDS",
        "APPLICATION_TREE_RL_BATCH_FORMATS",
        "APPLICATION_TREE_RL_PHASES",
        "APPLICATION_TREE_RL_ROLLOUT_STATUSES",
        "computeTreeRlAdvantages",
        "exportTreeRlTrainingBatch",
        "inspectTreeRlRun",
        "runTreeRlRollouts",
        "selectTreeRlForkPoints",
    ] as const) {
        const facade = new Map(Object.entries(applications));
        const rooted = new Map(Object.entries(root));
        assert.ok(facade.get(name) !== undefined, name);
        assert.equal(facade.get(name), rooted.get(name), name);
    }
});

/** Bodies of every record shape a run retains, keyed by shape. */
async function recordShapes(): Promise<Record<string, RecordBody>> {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:shapes", sourceSessionId, {
            baselines: ["single_rollout"],
            reward: rewardOf({ ...{ "0:3": 1, "0:5": 3, "1:3": 4, "1:5": 8, "2:3": 0 } }),
        }),
    );
    return {
        batch: bodyOf(store, inspection.batch?.record_id),
        completed: bodyOf(store, inspection.rollouts[0]?.record?.record_id),
        failed: bodyOf(store, inspection.rollouts[5]?.record?.record_id),
        opened: bodyOf(store, inspection.opened_record_id),
    };
}

test("every retained Tree-RL record and batch line conforms to the generated schema", async () => {
    const shapes = await recordShapes();
    const document = JSON.parse(
        readFileSync(
            new URL(
                `../../${applicationsProtocolConfig.artifacts.treeRlRolloutSchema}`,
                import.meta.url,
            ),
            "utf8",
        ),
    ) as AnySchemaObject;
    const validator = new Ajv2020({ strict: true, strictTypes: false });
    const validate = validator.compile(document);
    for (const [shape, body] of Object.entries(shapes)) {
        assert.equal(validate(body), true, `${shape}: ${validator.errorsText(validate.errors)}`);
        assert.equal(validate({ ...body, extra: true }), false, shape);
    }
    assert.equal(validate({ ...shapes.completed, reward: null }), false);
    assert.equal(validate({ ...shapes.failed, status: "completed" }), false);
    const line = new Ajv2020({ strict: true, strictTypes: false }).compile({
        ...document,
        $ref: "#/$defs/batchLine",
        oneOf: undefined,
    } as AnySchemaObject);
    using store = new SQLiteTraceStore();
    const { batch } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:lines", await recordSource(store)),
    );
    for (const entry of batch.lines) {
        assert.equal(line(entry), true);
    }
    assert.equal(line({ ...batch.lines[0], extra: 1 }), false);
});

test("the Tree-RL record codecs refuse every inconsistent retained body", async () => {
    const shapes = await recordShapes();
    const opened = shapes.opened as RecordBody & { fork_points: RecordBody[]; seeds: number[] };
    const completed = shapes.completed as RecordBody & { fork_point: RecordBody };
    const failed = shapes.failed as RecordBody;
    const batch = shapes.batch as RecordBody & { baseline: RecordBody };
    assert.equal(readTreeRlOpenedBody(opened).fork_points.length, 3);
    assert.equal(readTreeRlRolloutBody(completed).status, "completed");
    assert.equal(readTreeRlRolloutBody(failed).status, "failed");
    assert.equal(readTreeRlBatchBody(batch).baseline?.kind, "single_rollout");
    const [firstPoint, secondPoint] = opened.fork_points;
    const openedMutations: readonly RecordBody[] = [
        { ...opened, kind: "trajectory_compression" },
        { ...opened, phase: "rollout" },
        { ...opened, baselines: ["single_rollout", "single_rollout"] },
        { ...opened, fork_points: [] },
        { ...opened, fork_points: [secondPoint as RecordBody, firstPoint as RecordBody] },
        {
            ...opened,
            fork_points: [
                { ...(firstPoint as RecordBody), prefix_id: (secondPoint as RecordBody).prefix_id },
            ],
        },
        { ...opened, fork_points: [{ ...(secondPoint as RecordBody), prefix_id: null }] },
        {
            ...opened,
            fork_points: Array.from({ length: 33 }, (_, index) => ({
                dependents: 0,
                prefix_id: index === 0 ? null : (secondPoint as RecordBody).prefix_id,
                step_index: index,
            })),
        },
        { ...opened, seeds: [] },
        { ...opened, seeds: [1, 1] },
        { ...opened, seeds: [1.5] },
        { ...opened, seeds: Array.from({ length: 17 }, (_, index) => index) },
        {
            ...opened,
            fork_points: Array.from({ length: 5 }, (_, index) => ({
                dependents: 0,
                prefix_id: index === 0 ? null : (secondPoint as RecordBody).prefix_id,
                step_index: index,
            })),
            seeds: Array.from({ length: 16 }, (_, index) => index),
        },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(
            () => readTreeRlOpenedBody(body),
            ApplicationEvidenceError,
            JSON.stringify(body).slice(0, 80),
        );
    }
    const rolloutMutations: readonly RecordBody[] = [
        { ...completed, phase: "batch" },
        { ...completed, status: "running" },
        { ...completed, branch: 16 },
        { ...completed, seed: 1.5 },
        { ...completed, failure: failed.failure as RecordBody },
        { ...completed, reward: null },
        { ...failed, reward: 1 },
        { ...failed, reward: "1" },
        { ...failed, failure: { code: "OTHER", reason: "x" } },
        { ...completed, fork_point: { ...completed.fork_point, step_index: 1 } },
        { ...completed, rollout_id: "tree-rl-rollout:sha256:bad" },
    ];
    for (const body of rolloutMutations) {
        assert.throws(() => readTreeRlRolloutBody(body), ApplicationEvidenceError);
    }
    const batchMutations: readonly RecordBody[] = [
        { ...batch, phase: "rollout" },
        { ...batch, format: "jsonl_v2" },
        { ...batch, line_count: 65 },
        { ...batch, baseline: { ...batch.baseline, kind: "full_replay" } },
        { ...batch, baseline: { ...batch.baseline, format: "csv" } },
        { ...batch, batch_digest: "sha256:bad" },
    ];
    for (const body of batchMutations) {
        assert.throws(() => readTreeRlBatchBody(body), ApplicationEvidenceError);
    }
});

test("inspection refuses forged, late, reordered, or inconsistent Tree-RL records", async () => {
    using store = new SQLiteTraceStore();
    const sourceSessionId = await recordSource(store);
    const commandId = "application:tree-rl:forged";
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions(commandId, sourceSessionId),
    );
    const applicationId = deriveApplicationOwnerId(commandId);
    const archive = store.exportTrace();
    const forge = (
        target: SQLiteTraceStore,
        owner: string,
        step: string,
        body: RecordBody,
        schema = traceSchema,
        causes?: readonly RecordId[],
    ) => {
        const head = target.readOwner(owner).at(-1)?.envelope.record_id ?? null;
        const appended = target.appendApplicationRecord(
            owner,
            head,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(owner, step),
                owner,
                body,
                schema,
                causes ?? (head === null ? [] : [head]),
            ),
            null,
        );
        assert.equal(appended.status, "appended");
    };
    const refuses = (target: SQLiteTraceStore, owner: string, pattern: RegExp) =>
        assert.throws(
            () => inspectTreeRlRun(target, owner),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError && pattern.test(error.message),
        );
    // A record after the terminal cut.
    forge(store, applicationId, "late", bodyOf(store, inspection.rollouts[0]?.record?.record_id));
    refuses(store, applicationId, /terminal cut/u);
    // Partial runs forged with out-of-order, foreign, inconsistent, or unsupported records.
    const partial = new SQLiteTraceStore();
    partial.importTrace(archive);
    const partialCommand = "application:tree-rl:forged:partial";
    const partialId = deriveApplicationOwnerId(partialCommand);
    const opened = bodyOf(store, inspection.opened_record_id);
    const rolloutBodies = inspection.rollouts.map((entry) =>
        bodyOf(store, entry.record?.record_id),
    );
    const batchBody = bodyOf(store, inspection.batch?.record_id);
    const retarget = (body: RecordBody) => ({ ...body, application_id: partialId });
    const scenarios: readonly [
        string,
        readonly [RecordBody, (string | undefined)?, boolean?][],
        RegExp,
    ][] = [
        ["opened-foreign", [[opened]], /another application/u],
        [
            "opened-schema",
            [
                [
                    { ...opened, application_id: partialId, command_id: partialCommand },
                    applicationsProtocolConfig.traceSchemas.supervision,
                ],
            ],
            /unexpected schema/u,
        ],
        [
            "rollout-order",
            [
                [{ ...opened, application_id: partialId, command_id: partialCommand }],
                [retarget(rolloutBodies[1] as RecordBody)],
            ],
            /out of order/u,
        ],
        [
            "rollout-head",
            [
                [{ ...opened, application_id: partialId, command_id: partialCommand }],
                [retarget(rolloutBodies[0] as RecordBody), undefined, true],
            ],
            /does not follow the application head/u,
        ],
        [
            "batch-early",
            [
                [{ ...opened, application_id: partialId, command_id: partialCommand }],
                [retarget(batchBody)],
            ],
            /re-derive/u,
        ],
        [
            "unsupported",
            [
                [{ ...opened, application_id: partialId, command_id: partialCommand }],
                [{ forged: true }, applicationsProtocolConfig.traceSchemas.supervision],
            ],
            /unexpected schema/u,
        ],
        [
            "manifest-early",
            [
                [{ ...opened, application_id: partialId, command_id: partialCommand }],
                [
                    {
                        ...(inspection.manifest as unknown as RecordBody),
                        application_id: partialId,
                    },
                    applicationsProtocolConfig.traceSchemas.manifest,
                ],
            ],
            /manifest/u,
        ],
    ];
    for (const [label, records, pattern] of scenarios) {
        const forged = new SQLiteTraceStore();
        forged.importTrace(archive);
        for (const [index, [body, schema, wrongCause]] of records.entries()) {
            forge(
                forged,
                partialId,
                `${label}:${index}`,
                body,
                schema,
                wrongCause === true ? [inspection.opened_record_id] : undefined,
            );
        }
        refuses(forged, partialId, pattern);
        forged.close();
    }
    partial.close();
    refuses(store, deriveApplicationOwnerId("absent"), /not retained/u);
    // A forged opened record whose selection differs from the source is refused on rerun.
    const reselected = new SQLiteTraceStore();
    reselected.importTrace(archive);
    const rerunCommand = "application:tree-rl:forged:selection";
    const rerunId = deriveApplicationOwnerId(rerunCommand);
    forge(reselected, rerunId, "opened", {
        ...opened,
        application_id: rerunId,
        command_id: rerunCommand,
        fork_points: (opened.fork_points as RecordBody[]).slice(0, 2),
    });
    await assert.rejects(
        runTreeRlRollouts(reselected, treeRlOptions(rerunCommand, sourceSessionId)),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError &&
            /fork-point selection/u.test(error.message),
    );
    reselected.close();
});

function stageOf(request: ModelRequest): string {
    return (request.input as { readonly stage: string }).stage;
}

/** Static-kind provider answering any stage, with an extra reflection stage after the answer. */
function greedyProvider(label: string): ModelProvider {
    const { descriptor } = createStaticProvider({
        descriptor: { id: `provider:greedy:${label}`, model: "fixture-v1" },
        exchanges: [],
    });
    return Object.freeze({
        descriptor,
        invoke: async (request: ModelRequest) => ({
            output: { text: `${label}:${stageOf(request)}` },
            usage: {
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
                costUsd: null,
                inputTokens: 1,
                outputTokens: 1,
            },
        }),
    });
}

test("a rollout that issues more calls than projected makes the next rollout refuse before it opens", async () => {
    using store = new SQLiteTraceStore();
    const request = (stage: string, prior: unknown): ModelRequest => ({
        input: { prior: prior as never, stage },
        instruction: `perform ${stage}`,
        outputSchema: { type: "object" },
    });
    // Rollouts forked at the plan see a non-base plan and reflect once more.
    const program: root.ReplaySessionProgram = async (context) => {
        const plan = await context.invokeProvider(request("plan", null));
        const answer = await context.invokeProvider(request("answer", plan.response.output), {
            dependsOn: [plan.handle],
        });
        if ((plan.response.output as { text: string }).text !== "base:plan") {
            await context.invokeProvider(request("reflect", answer.response.output), {
                dependsOn: [answer.handle],
            });
        }
        return answer.response.output;
    };
    const sourceSessionId = await recordSource(
        store,
        "source:greedy",
        program,
        greedyProvider("base"),
    );
    const commandId = "application:tree-rl:greedy";
    // Projection: fork 0 → 2 calls per branch = 4; measured 3 per branch.
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, sourceSessionId, {
                program,
                protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 4 }),
                provider: providerFactory(({ seed }) => greedyProvider(`s${seed}`)),
                reward: () => 1,
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /after 3/u.test(error.message),
    );
    const inspection = inspectTreeRlRun(store, deriveApplicationOwnerId(commandId));
    assert.equal(inspection.rollouts[0]?.record?.cost.provider_calls, 3);
    assert.equal(inspection.rollouts[0]?.record?.cost.cost_usd, null);
    assert.equal(inspection.rollouts[1]?.record, null);
    assert.deepEqual(store.listOwnersBySchema("shepherd.replay.session.v1", 16, 0).length, 2);
});

/** Store whose Nth application append reports a moved head. */
class MovingStore extends SQLiteTraceStore {
    appends = 0;
    moveAt = 0;

    override appendApplicationRecord(
        ...args: Parameters<SQLiteTraceStore["appendApplicationRecord"]>
    ): ReturnType<SQLiteTraceStore["appendApplicationRecord"]> {
        this.appends += 1;
        if (this.appends === this.moveAt) {
            return { status: "head_moved" } as never;
        }
        return super.appendApplicationRecord(...args);
    }
}

test("a moved application head is refused as invalid evidence", async () => {
    using store = new MovingStore();
    const sourceSessionId = await recordSource(store);
    store.moveAt = 2;
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions("application:tree-rl:moved", sourceSessionId)),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
});
