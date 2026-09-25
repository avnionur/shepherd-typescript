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
    readTreeRlRootBody,
    resolveTreeRlForkTurn,
    standardizeTreeRlGroup,
    treeRlTurnBounds,
} from "../../src/applications/tree-rl-records.ts";
import * as applications from "../../src/facades/applications.ts";
import * as root from "../../src/index.ts";
import {
    APPLICATION_TREE_RL_ACTION_SEGMENTS,
    APPLICATION_TREE_RL_BASELINE_KINDS,
    APPLICATION_TREE_RL_BATCH_FORMATS,
    APPLICATION_TREE_RL_LIMITS,
    APPLICATION_TREE_RL_MEMBER_KINDS,
    APPLICATION_TREE_RL_NORMALIZATIONS,
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
    APPLICATIONS_PROTOCOL_V7_CONTRACT,
    APPLICATIONS_PROTOCOL_V8_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    fixedSelector,
    providerFactory,
    recordRoots,
    recordSource,
    rewardOf,
    treeRlOptions,
    treeRlProtocolWithBudgets,
} from "./tree-rl-fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, Record<string, Record<string, unknown>>>;
const traceSchema = applicationsProtocolConfig.traceSchemas.treeRlRollout;
const TOOL_CALL = { arguments: { command: "ls" }, name: "bash" };

function bodyOf(store: SQLiteTraceStore, recordId: RecordId | null | undefined): RecordBody {
    return store.readRecord(recordId as RecordId)?.body as RecordBody;
}

test("applications protocol v8 aligns the Tree-RL vocabulary with Algorithm 2 and refuses drift", () => {
    const { treeRl: _v8, ...v8Rest } = APPLICATIONS_PROTOCOL_V8_CONTRACT;
    const { treeRl: _v7, ...v7Rest } = APPLICATIONS_PROTOCOL_V7_CONTRACT;
    assert.deepEqual(v8Rest, v7Rest);
    assert.deepEqual(applicationsProtocolConfig.treeRl, APPLICATIONS_PROTOCOL_V8_CONTRACT.treeRl);
    assert.equal(
        APPLICATIONS_PROTOCOL_V8_CONTRACT.traceSchemas.treeRlRollout,
        "shepherd.application.tree_rl_rollout.v1",
    );
    assert.deepEqual(APPLICATION_TREE_RL_PHASES, ["opened", "root", "rollout", "batch"]);
    assert.deepEqual(APPLICATION_TREE_RL_ROLLOUT_STATUSES, ["completed", "failed"]);
    assert.deepEqual(APPLICATION_TREE_RL_BASELINE_KINDS, ["flat_grpo"]);
    assert.deepEqual(APPLICATION_TREE_RL_BATCH_FORMATS, ["jsonl_v2"]);
    assert.deepEqual(APPLICATION_TREE_RL_MEMBER_KINDS, ["root", "branch"]);
    assert.deepEqual(APPLICATION_TREE_RL_ACTION_SEGMENTS, ["prefix", "suffix", "flat"]);
    assert.deepEqual(APPLICATION_TREE_RL_NORMALIZATIONS, ["none", "group_std"]);
    assert.deepEqual(APPLICATION_TREE_RL_LIMITS, {
        defaultConcurrency: 4,
        maxConcurrency: 16,
        maxGroupSize: 16,
        maxPrompts: 16,
    });
    const mutations: readonly ((treeRl: Record<string, unknown>) => void)[] = [
        (treeRl) => {
            treeRl.artifactRoles = {
                ...(treeRl.artifactRoles as object),
                rollout: "training_batch",
            };
        },
        (treeRl) => {
            treeRl.baselineKinds = ["flat_grpo", "other"];
        },
        (treeRl) => {
            treeRl.batchFormats = [];
        },
        (treeRl) => {
            treeRl.budgetKeys = { branches: "same", groupSize: "same", providerCalls: "b" };
        },
        (treeRl) => {
            treeRl.phases = ["opened", "rollout", "batch"];
        },
        (treeRl) => {
            treeRl.memberKinds = ["root"];
        },
        (treeRl) => {
            treeRl.actionSegments = ["prefix", "suffix"];
        },
        (treeRl) => {
            treeRl.advantage = { ...(treeRl.advantage as object), epsilon: 0 };
        },
        (treeRl) => {
            treeRl.advantage = { ...(treeRl.advantage as object), normalization: "zscore" };
        },
        (treeRl) => {
            treeRl.advantage = { ...(treeRl.advantage as object), stdEstimator: "biased" };
        },
        (treeRl) => {
            treeRl.forkTurn = { first: 0, trailing: 2 };
        },
        (treeRl) => {
            treeRl.limits = { ...(treeRl.limits as object), defaultConcurrency: 17 };
        },
        (treeRl) => {
            treeRl.reasons = {
                ...(treeRl.reasons as object),
                diverged: "same",
                interrupted: "same",
            };
        },
        (treeRl) => {
            treeRl.rolloutStatuses = ["completed"];
        },
        (treeRl) => {
            treeRl.surfaceRoles = {
                batch: "same",
                forkProposal: "a",
                forkSelector: "b",
                rollout: "same",
            };
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
    for (const drift of [
        (treeRl: Record<string, unknown>) => {
            treeRl.batchFormats = ["jsonl_v3"];
        },
        (treeRl: Record<string, unknown>) => {
            treeRl.advantage = { ...(treeRl.advantage as object), stdEstimator: "population" };
        },
    ]) {
        const drifted = structuredClone(validConfig);
        drift(drifted.applications?.treeRl as Record<string, unknown>);
        assert.throws(
            () => parseProtocolConfig(drifted),
            (error: unknown) =>
                error instanceof TypeError && /new applications protocol/u.test(error.message),
        );
    }
});

test("the applications facade exposes the Tree-RL adapter as the root does", () => {
    for (const name of [
        "APPLICATION_TREE_RL_ACTION_SEGMENTS",
        "APPLICATION_TREE_RL_BASELINE_KINDS",
        "APPLICATION_TREE_RL_BATCH_FORMATS",
        "APPLICATION_TREE_RL_LIMITS",
        "APPLICATION_TREE_RL_MEMBER_KINDS",
        "APPLICATION_TREE_RL_NORMALIZATIONS",
        "APPLICATION_TREE_RL_PHASES",
        "APPLICATION_TREE_RL_ROLLOUT_STATUSES",
        "computeTreeRlAdvantages",
        "createDependencyTreeRlForkSelector",
        "createMetaAgentTreeRlForkSelector",
        "exportTreeRlBatchToTrainer",
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

test("fork turns clamp into [1, T - 2] and move to the nearest restorable turn", () => {
    assert.deepEqual(treeRlTurnBounds(8), { first: 1, last: 6 });
    assert.deepEqual(treeRlTurnBounds(2), { first: 1, last: 1 });
    assert.deepEqual(treeRlTurnBounds(1), { first: 1, last: 1 });
    const all = () => true;
    assert.equal(resolveTreeRlForkTurn(9, 8, all), 6);
    assert.equal(resolveTreeRlForkTurn(-3, 8, all), 1);
    assert.equal(resolveTreeRlForkTurn(4, 8, all), 4);
    // Turn 4 is not restorable: 3 and 5 are equally near; the earlier wins.
    assert.equal(
        resolveTreeRlForkTurn(4, 8, (turn) => turn !== 4),
        3,
    );
    assert.equal(
        resolveTreeRlForkTurn(4, 8, (turn) => turn === 6),
        6,
    );
    assert.equal(
        resolveTreeRlForkTurn(4, 8, (turn) => turn === 7),
        null,
    );
    // The dependency selector falls back to the first admissible turn when none is restorable.
    assert.deepEqual(
        root.createDependencyTreeRlForkSelector()({
            root: { steps: [] },
            turn_bounds: { first: 1, last: 1 },
            turns: [{ restorable: false, step_index: 0, turn: 1 }],
        } as never),
        {
            branch_turn: 1,
            reason: "the admissible turn with the most transitive dependents",
            tool_call: null,
        },
    );
});

test("group standardization divides by the configured estimator's standard deviation", () => {
    // Values 1, 3, 5: mean 3, squared deviations 8; sample std 2, population std sqrt(8 / 3).
    assert.deepEqual(standardizeTreeRlGroup([1, 3, null, 5], "none"), [-2, 0, null, 2]);
    assert.deepEqual(standardizeTreeRlGroup([1, 3, 5], "group_std", "sample"), [
        -2 / (2 + 0.000001),
        0,
        2 / (2 + 0.000001),
    ]);
    const population = Math.sqrt(8 / 3) + 0.000001;
    assert.deepEqual(standardizeTreeRlGroup([1, 3, 5], "group_std", "population"), [
        -2 / population,
        0,
        2 / population,
    ]);
    assert.deepEqual(standardizeTreeRlGroup([4], "group_std", "population"), [0]);
});

/** Bodies of every record shape a run retains, keyed by shape. */
async function recordShapes(): Promise<Record<string, RecordBody>> {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const { inspection } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:shapes", labels, {
            baselines: ["flat_grpo"],
            reward: rewardOf(labels, {
                alt: Number.NaN,
                "alt:3": 1,
                base: 1,
                "base:3": 3,
                "base:5": 5,
            }),
            selector: fixedSelector(2, TOOL_CALL),
        }),
    );
    return {
        batch: bodyOf(store, inspection.batch?.record_id),
        completed: bodyOf(store, inspection.rollouts[0]?.record?.record_id),
        failed: bodyOf(store, inspection.rollouts[3]?.record?.record_id),
        failedRoot: bodyOf(store, inspection.roots[1]?.record_id),
        opened: bodyOf(store, inspection.opened_record_id),
        root: bodyOf(store, inspection.roots[0]?.record_id),
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
    assert.equal(validate({ ...shapes.root, status: "failed" }), false);
    const line = new Ajv2020({ strict: true, strictTypes: false }).compile({
        ...document,
        $ref: "#/$defs/batchLine",
        oneOf: undefined,
    } as AnySchemaObject);
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const { batch } = await runTreeRlRollouts(
        store,
        treeRlOptions("application:tree-rl:lines", labels, {
            baselines: ["flat_grpo"],
            selector: fixedSelector(2, TOOL_CALL),
        }),
    );
    for (const entry of [...batch.lines, ...(batch.baseline?.lines ?? [])]) {
        assert.equal(line(entry), true);
    }
    assert.equal(line({ ...batch.lines[0], extra: 1 }), false);
    assert.equal(
        line({
            ...batch.lines[0],
            actions: [{ advantage: 1, segment: "other", step_index: 0, turn: 1 }],
        }),
        false,
    );
});

test("the Tree-RL record codecs refuse every inconsistent retained body", async () => {
    const shapes = await recordShapes();
    const opened = shapes.opened as RecordBody & {
        prompts: { id: string; roots: string[] }[];
        seeds: number[];
    };
    const rootBody = shapes.root as RecordBody & { fork: RecordBody };
    const completed = shapes.completed as RecordBody & { fork_point: RecordBody };
    const failed = shapes.failed as RecordBody;
    const batch = shapes.batch as RecordBody & { baseline: RecordBody };
    assert.equal(readTreeRlOpenedBody(opened).prompts[0]?.roots.length, 2);
    assert.equal(readTreeRlRootBody(rootBody).fork.branch_turn, 2);
    assert.equal(readTreeRlRootBody(shapes.failedRoot as RecordBody).status, "failed");
    assert.equal(readTreeRlRolloutBody(completed).status, "completed");
    assert.equal(readTreeRlRolloutBody(failed).status, "failed");
    assert.equal(readTreeRlBatchBody(batch).baseline?.kind, "flat_grpo");
    const roots = opened.prompts[0]?.roots as string[];
    const openedMutations: readonly RecordBody[] = [
        { ...opened, kind: "trajectory_compression" },
        { ...opened, phase: "rollout" },
        { ...opened, baselines: ["flat_grpo", "flat_grpo"] },
        { ...opened, normalization: "zscore" },
        { ...opened, prompts: [] },
        { ...opened, prompts: [{ id: "task", roots: [roots[0] as string, roots[0] as string] }] },
        {
            ...opened,
            prompts: [
                { id: "a", roots },
                { id: "b", roots: [roots[0] as string] },
            ],
        },
        { ...opened, prompts: [{ id: "task", roots: ["replay-session:sha256:bad"] }] },
        { ...opened, seeds: [] },
        { ...opened, seeds: [1, 1] },
        { ...opened, seeds: [1.5] },
        { ...opened, seeds: Array.from({ length: 17 }, (_, index) => index) },
        { ...opened, application_version: 2 },
    ];
    for (const body of openedMutations) {
        assert.throws(
            () => readTreeRlOpenedBody(body),
            ApplicationEvidenceError,
            JSON.stringify(body).slice(0, 80),
        );
    }
    const fork = rootBody.fork as RecordBody & { fork_point: RecordBody };
    const rootMutations: readonly RecordBody[] = [
        { ...rootBody, phase: "rollout" },
        { ...rootBody, status: "running" },
        { ...rootBody, reward: null },
        { ...rootBody, failure: (shapes.failedRoot as RecordBody).failure as RecordBody },
        { ...rootBody, turns: [] },
        { ...rootBody, turns: [0, 2, 1, 3, 4] },
        { ...rootBody, group_index: -1 },
        { ...rootBody, fork: { ...fork, branch_turn: 0 } },
        { ...rootBody, fork: { ...fork, branch_turn: 4 } },
        { ...rootBody, fork: { ...fork, branch_turn: 3 } },
        { ...rootBody, fork: { ...fork, proposed_turn: 1.5 } },
        { ...rootBody, fork: { ...fork, reason: "" } },
        { ...rootBody, fork: { ...fork, tool_call: { arguments: [], name: "bash" } } },
        { ...rootBody, fork: { ...fork, tool_call: { arguments: {}, name: "" } } },
        {
            ...rootBody,
            fork: {
                ...fork,
                tool_call: { arguments: { command: "x".repeat(16_384) }, name: "bash" },
            },
        },
        { ...rootBody, fork: { ...fork, fork_point: { ...fork.fork_point, prefix_id: null } } },
    ];
    for (const body of rootMutations) {
        assert.throws(
            () => readTreeRlRootBody(body),
            ApplicationEvidenceError,
            JSON.stringify(body).slice(0, 120),
        );
    }
    const rolloutMutations: readonly RecordBody[] = [
        { ...completed, phase: "batch" },
        { ...completed, status: "running" },
        { ...completed, branch: 16 },
        { ...completed, branch_turn: 0 },
        { ...completed, seed: 1.5 },
        { ...completed, seeded: "yes" },
        { ...failed, seeded: true },
        { ...completed, failure: failed.failure as RecordBody },
        { ...completed, reward: null },
        { ...failed, reward: 1 },
        { ...failed, reward: "1" },
        { ...failed, failure: { code: "OTHER", reason: "x" } },
        { ...completed, fork_point: { ...completed.fork_point, step_index: 0 } },
        { ...completed, rollout_id: "tree-rl-rollout:sha256:bad" },
        { ...completed, turns: [1, 1] },
    ];
    for (const body of rolloutMutations) {
        assert.throws(
            () => readTreeRlRolloutBody(body),
            ApplicationEvidenceError,
            JSON.stringify(body).slice(0, 120),
        );
    }
    const batchMutations: readonly RecordBody[] = [
        { ...batch, phase: "rollout" },
        { ...batch, format: "jsonl_v1" },
        { ...batch, line_count: 1000 },
        { ...batch, baseline: { ...batch.baseline, kind: "single_rollout" } },
        { ...batch, baseline: { ...batch.baseline, format: "csv" } },
        { ...batch, batch_digest: "sha256:bad" },
    ];
    for (const body of batchMutations) {
        assert.throws(() => readTreeRlBatchBody(body), ApplicationEvidenceError);
    }
});

test("inspection refuses forged, late, reordered, or inconsistent Tree-RL records", async () => {
    using store = new SQLiteTraceStore();
    const labels = await recordRoots(store);
    const commandId = "application:tree-rl:forged";
    const { inspection } = await runTreeRlRollouts(store, treeRlOptions(commandId, labels));
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
    const partialCommand = "application:tree-rl:forged:partial";
    const partialId = deriveApplicationOwnerId(partialCommand);
    const opened = bodyOf(store, inspection.opened_record_id);
    const retargetedOpened = { ...opened, application_id: partialId, command_id: partialCommand };
    const rootBodies = inspection.roots.map((entry) => bodyOf(store, entry.record_id));
    const rolloutBodies = inspection.rollouts.map((entry) =>
        bodyOf(store, entry.record?.record_id),
    );
    const batchBody = bodyOf(store, inspection.batch?.record_id);
    const retarget = (body: RecordBody) => ({ ...body, application_id: partialId });
    const bothRoots: [RecordBody][] = [
        [retarget(rootBodies[0] as RecordBody)],
        [retarget(rootBodies[1] as RecordBody)],
    ];
    const scenarios: readonly [
        string,
        readonly [RecordBody, (string | undefined)?, boolean?][],
        RegExp,
    ][] = [
        ["opened-foreign", [[opened]], /another application/u],
        [
            "opened-schema",
            [[retargetedOpened, applicationsProtocolConfig.traceSchemas.supervision]],
            /unexpected schema/u,
        ],
        [
            "root-order",
            [[retargetedOpened], [retarget(rootBodies[1] as RecordBody)]],
            /root record is out of order/u,
        ],
        [
            "rollout-before-roots",
            [
                [retargetedOpened],
                [retarget(rootBodies[0] as RecordBody)],
                [retarget(rolloutBodies[0] as RecordBody)],
            ],
            /out of order/u,
        ],
        [
            "rollout-order",
            [[retargetedOpened], ...bothRoots, [retarget(rolloutBodies[1] as RecordBody)]],
            /out of order/u,
        ],
        [
            "rollout-plan",
            [
                [retargetedOpened],
                ...bothRoots,
                [{ ...retarget(rolloutBodies[0] as RecordBody), seeded: true }],
            ],
            /disagrees with its plan/u,
        ],
        [
            "root-head",
            [[retargetedOpened], [retarget(rootBodies[0] as RecordBody), undefined, true]],
            /does not follow the application head/u,
        ],
        [
            "batch-early",
            [[retargetedOpened], [retarget(rootBodies[0] as RecordBody)], [retarget(batchBody)]],
            /re-derive/u,
        ],
        [
            "unsupported",
            [
                [retargetedOpened],
                [{ forged: true }, applicationsProtocolConfig.traceSchemas.supervision],
            ],
            /unexpected schema/u,
        ],
        [
            "manifest-early",
            [
                [retargetedOpened],
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
    refuses(store, deriveApplicationOwnerId("absent"), /not retained/u);
    // A forged opened record naming other prompts is refused on rerun.
    const reselected = new SQLiteTraceStore();
    reselected.importTrace(archive);
    const rerunCommand = "application:tree-rl:forged:prompts";
    const rerunId = deriveApplicationOwnerId(rerunCommand);
    forge(reselected, rerunId, "opened", {
        ...opened,
        application_id: rerunId,
        command_id: rerunCommand,
        prompts: [{ id: "other", roots: [...labels.keys()] }],
    });
    await assert.rejects(
        runTreeRlRollouts(reselected, treeRlOptions(rerunCommand, labels)),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /different prompts/u.test(error.message),
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

test("a rollout that issues more calls than projected makes a later rollout refuse before it opens", async () => {
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
    const labels = new Map<string, string>();
    for (const label of ["base", "alt"]) {
        labels.set(
            await recordSource(store, `root:greedy:${label}`, program, greedyProvider("base")),
            label,
        );
    }
    const commandId = "application:tree-rl:greedy";
    // Projection: fork at turn 1 → 2 calls per rollout, 8 in total; each rollout measures 3.
    await assert.rejects(
        runTreeRlRollouts(
            store,
            treeRlOptions(commandId, labels, {
                concurrency: 1,
                prompts: [{ id: "task", program, roots: [...labels.keys()] }],
                protocol: treeRlProtocolWithBudgets({ maxProviderCalls: 8 }),
                provider: providerFactory(labels, ({ seed }) => greedyProvider(`s${seed}`)),
                reward: () => 1,
            }),
        ),
        (error: unknown) =>
            error instanceof ApplicationBudgetError && /after 9/u.test(error.message),
    );
    const inspection = inspectTreeRlRun(store, deriveApplicationOwnerId(commandId));
    assert.deepEqual(
        inspection.rollouts.map((entry) => entry.record?.cost.provider_calls ?? null),
        [3, 3, 3, null],
    );
    assert.equal(store.listOwnersBySchema("shepherd.replay.session.v1", 16, 0).length, 5);
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
    const labels = await recordRoots(store);
    store.moveAt = 2;
    await assert.rejects(
        runTreeRlRollouts(store, treeRlOptions("application:tree-rl:moved", labels)),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
});
