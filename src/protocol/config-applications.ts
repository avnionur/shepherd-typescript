import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

type ApplicationsConfig = ProtocolConfig["applications"];

const ARTIFACT_KEYS = [
    "compressionSchema",
    "croCandidateSchema",
    "evaluationSchema",
    "manifestSchema",
    "runtimeSupervisionSchema",
    "supervisionSchema",
    "treeRlRolloutSchema",
] as const;
const SCHEMA_KEYS = [
    "compressionId",
    "croCandidateId",
    "evaluationId",
    "manifestId",
    "runtimeSupervisionId",
    "supervisionId",
    "treeRlRolloutId",
] as const;
const TRACE_SCHEMA_KEYS = [
    "compression",
    "croCandidate",
    "manifest",
    "runtimeSupervision",
    "supervision",
    "treeRlRollout",
] as const;
const ERROR_KEYS = [
    "budgetCode",
    "budgetMessage",
    "evidenceCode",
    "evidenceMessage",
    "protocolCode",
    "protocolMessage",
    "verificationCode",
    "verificationMessage",
] as const;
const IDENTITY_KEYS = [
    "applicationIdPrefix",
    "artifactIdPrefix",
    "candidateIdPrefix",
    "commandAppendIntentKind",
    "cutIdPrefix",
    "digestAlgorithm",
    "forkPointIdPrefix",
    "manifestIdPrefix",
    "protocolIdPrefix",
    "reportIdPrefix",
    "rolloutIdPrefix",
] as const;
const LIMIT_KEYS = [
    "maxArtifacts",
    "maxBestOfN",
    "maxBranches",
    "maxCandidates",
    "maxDatasetItems",
    "maxForkPoints",
    "maxPromptBytes",
    "maxReasonLength",
    "maxRollouts",
    "maxRounds",
    "maxSchemaBytes",
    "maxSeeds",
    "maxSurfaces",
    "maxTickIntervalMilliseconds",
    "maxTicks",
    "maxToolBytes",
    "maxWorkers",
    "minWorkers",
] as const;
const ARTIFACT_ROLE_KEYS = [
    "decision",
    "worker",
    "worldDiscard",
    "worldFork",
    "worldMerge",
] as const;
const SURFACE_ROLE_KEYS = ["action", "observation"] as const;
const RUNTIME_ARTIFACT_ROLE_KEYS = [
    "settlement",
    "worldDiscard",
    "worldFork",
    "workerStream",
] as const;
const RUNTIME_BUDGET_KEYS = [
    "featureCharacters",
    "guidanceWords",
    "providerCalls",
    "reasonWords",
    "tickInterval",
    "ticks",
    "toolCallSummaryBytes",
    "trailingToolCalls",
    "turnsPerWorker",
] as const;
const REASON_KEYS = ["notAccepted"] as const;
const CRO_ARTIFACT_ROLE_KEYS = ["baseline", "candidate", "proposal", "selection"] as const;
const CRO_BUDGET_KEYS = [
    "candidates",
    "iterations",
    "proposalAttempts",
    "proposals",
    "providerCalls",
    "reflectionMechanisms",
] as const;
const CRO_THRESHOLD_KEYS = [
    "audaciousPrior",
    "duplicateSimilarity",
    "improveThreshold",
    "maxScoreDrop",
    "minPromotionScore",
    "minScoreLift",
    "promoteDevEpsilon",
] as const;
const CRO_PROPOSER_LIMIT_KEYS = [
    "defaultMaxTurns",
    "maxExcerptLength",
    "maxGrepMatches",
    "maxPatternLength",
    "maxTraceSteps",
] as const;
const CRO_PROPOSER_OPERATION_KEYS = [
    "grepTraces",
    "inspectCandidates",
    "proposeCandidate",
    "readTrace",
] as const;
const CRO_REFLECTION_FIELD_KEYS = [
    "findings",
    "hypotheses",
    "mechanism",
    "parent",
    "prior",
] as const;
const CRO_SURFACE_ROLE_KEYS = ["handoff", "proposer", "reflection"] as const;
const COMPRESSION_ARTIFACT_ROLE_KEYS = [
    "candidate",
    "compressed",
    "compressor",
    "control",
    "outcome",
    "restoration",
    "rewind",
    "source",
    "verifier",
] as const;
const COMPRESSION_BUDGET_KEYS = ["bestOfN", "providerCalls"] as const;
const COMPRESSION_CHILD_FIELD_KEYS = ["input", "output"] as const;
const COMPRESSION_REASON_KEYS = ["noForkPoint", "notAdmissible", "restoreUnavailable"] as const;
const COMPRESSION_SURFACE_ROLE_KEYS = ["compression", "compressor", "verifier"] as const;
const TREE_RL_ARTIFACT_ROLE_KEYS = ["baselineBatch", "batch", "root", "rollout"] as const;
const TREE_RL_BUDGET_KEYS = ["branches", "groupSize", "providerCalls"] as const;
const TREE_RL_LIMIT_KEYS = [
    "defaultConcurrency",
    "maxConcurrency",
    "maxGroupSize",
    "maxPrompts",
] as const;
const TREE_RL_REASON_KEYS = [
    "dependencySelection",
    "diverged",
    "interrupted",
    "notFinished",
    "rewardFailed",
] as const;
const TREE_RL_SURFACE_ROLE_KEYS = ["batch", "forkProposal", "forkSelector", "rollout"] as const;
const EVALUATION_LIMIT_KEYS = ["maxExperiments", "maxLimitationLength", "maxLimitations"] as const;

/**
 * Validates configured research application manifest, protocol identity, and supervisor values.
 *
 * @param value - Untrusted `applications` configuration section.
 * @returns The validated applications configuration.
 * @throws {TypeError} If any field is missing, malformed, or inconsistent.
 */
export function readApplicationsConfig(value: unknown): ApplicationsConfig {
    const applications = readObject(
        value,
        [
            "artifacts",
            "compatibilityVersion",
            "compression",
            "cro",
            "errors",
            "evaluation",
            "identity",
            "kinds",
            "limits",
            "manifestVersion",
            "protocolSurfaces",
            "recordVersion",
            "runtimeSupervision",
            "schemas",
            "supervision",
            "traceSchemas",
            "treeRl",
        ],
        "applications",
    );
    const traceSchemas = readRecord(
        applications.traceSchemas,
        TRACE_SCHEMA_KEYS,
        "applications.traceSchemas",
        readNonEmptyString,
    );
    if (new Set(Object.values(traceSchemas)).size !== TRACE_SCHEMA_KEYS.length) {
        throw new TypeError("applications.traceSchemas must be distinct");
    }
    const identity = readRecord(
        applications.identity,
        IDENTITY_KEYS,
        "applications.identity",
        readNonEmptyString,
    );
    if (new Set(Object.values(identity)).size !== IDENTITY_KEYS.length) {
        throw new TypeError("applications.identity values must be distinct");
    }
    const limits = readRecord(
        applications.limits,
        LIMIT_KEYS,
        "applications.limits",
        readPositiveInteger,
    );
    if (limits.minWorkers > limits.maxWorkers) {
        throw new TypeError("applications.limits.minWorkers must not exceed maxWorkers");
    }
    return {
        artifacts: readRecord(
            applications.artifacts,
            ARTIFACT_KEYS,
            "applications.artifacts",
            readNonEmptyString,
        ),
        compatibilityVersion: readNonEmptyString(
            applications.compatibilityVersion,
            "applications.compatibilityVersion",
        ),
        compression: readCompression(applications.compression),
        cro: readCro(applications.cro),
        errors: readRecord(
            applications.errors,
            ERROR_KEYS,
            "applications.errors",
            readNonEmptyString,
        ),
        evaluation: readEvaluation(applications.evaluation),
        identity: {
            ...identity,
            digestAlgorithm: readEnum(
                identity.digestAlgorithm,
                SECURE_HASH_ALGORITHMS,
                "applications.identity.digestAlgorithm",
            ),
        },
        kinds: readVocabulary(applications.kinds, "applications.kinds", 4),
        limits,
        manifestVersion: readPositiveInteger(
            applications.manifestVersion,
            "applications.manifestVersion",
        ),
        protocolSurfaces: readVocabulary(
            applications.protocolSurfaces,
            "applications.protocolSurfaces",
            3,
        ),
        recordVersion: readPositiveInteger(
            applications.recordVersion,
            "applications.recordVersion",
        ),
        runtimeSupervision: readRuntimeSupervision(applications.runtimeSupervision),
        schemas: readRecord(
            applications.schemas,
            SCHEMA_KEYS,
            "applications.schemas",
            readAbsoluteUrl,
        ),
        supervision: readSupervision(applications.supervision),
        traceSchemas,
        treeRl: readTreeRl(applications.treeRl),
    };
}

function readRuntimeSupervision(value: unknown): ApplicationsConfig["runtimeSupervision"] {
    const path = "applications.runtimeSupervision";
    const runtime = readObject(
        value,
        [
            "actions",
            "artifactRoles",
            "attemptCauses",
            "attemptStatuses",
            "budgetKeys",
            "guidanceSeparator",
            "phases",
            "surfaceRoles",
            "targetInputKeys",
            "truncationMarker",
        ],
        path,
    );
    const surfaceRoles = readDistinctRecord(
        runtime.surfaceRoles,
        SURFACE_ROLE_KEYS,
        `${path}.surfaceRoles`,
    );
    return {
        actions: readVocabulary(runtime.actions, `${path}.actions`, 4),
        artifactRoles: readDistinctRecord(
            runtime.artifactRoles,
            RUNTIME_ARTIFACT_ROLE_KEYS,
            `${path}.artifactRoles`,
        ),
        attemptCauses: readVocabulary(runtime.attemptCauses, `${path}.attemptCauses`, 3),
        attemptStatuses: readVocabulary(runtime.attemptStatuses, `${path}.attemptStatuses`, 5),
        budgetKeys: readDistinctRecord(
            runtime.budgetKeys,
            RUNTIME_BUDGET_KEYS,
            `${path}.budgetKeys`,
        ),
        guidanceSeparator: readNonEmptyString(
            runtime.guidanceSeparator,
            `${path}.guidanceSeparator`,
        ),
        phases: readVocabulary(runtime.phases, `${path}.phases`, 6),
        surfaceRoles,
        targetInputKeys: readUniqueStrings(runtime.targetInputKeys, `${path}.targetInputKeys`),
        truncationMarker: readNonEmptyString(runtime.truncationMarker, `${path}.truncationMarker`),
    };
}

function readSupervision(value: unknown): ApplicationsConfig["supervision"] {
    const supervision = readObject(
        value,
        [
            "artifactRoles",
            "budgetKeys",
            "conflictKinds",
            "phases",
            "policyKinds",
            "reasons",
            "surfaceRoles",
            "workerStatuses",
        ],
        "applications.supervision",
    );
    const artifactRoles = readRecord(
        supervision.artifactRoles,
        ARTIFACT_ROLE_KEYS,
        "applications.supervision.artifactRoles",
        readNonEmptyString,
    );
    if (new Set(Object.values(artifactRoles)).size !== ARTIFACT_ROLE_KEYS.length) {
        throw new TypeError("applications.supervision.artifactRoles must be distinct");
    }
    const surfaceRoles = readRecord(
        supervision.surfaceRoles,
        SURFACE_ROLE_KEYS,
        "applications.supervision.surfaceRoles",
        readNonEmptyString,
    );
    if (surfaceRoles.action === surfaceRoles.observation) {
        throw new TypeError("applications.supervision.surfaceRoles must be distinct");
    }
    const budgetKeys = readObject(
        supervision.budgetKeys,
        ["providerCalls", "rounds", "worker"],
        "applications.supervision.budgetKeys",
    );
    const workerBudgetKeys = readObject(
        budgetKeys.worker,
        [],
        "applications.supervision.budgetKeys.worker",
        true,
    );
    const worker = Object.fromEntries(
        Object.keys(workerBudgetKeys).map((metric) => [
            readNonEmptyString(metric, "applications.supervision.budgetKeys.worker metric"),
            readNonEmptyString(
                workerBudgetKeys[metric],
                `applications.supervision.budgetKeys.worker.${metric}`,
            ),
        ]),
    );
    const providerCalls = readNonEmptyString(
        budgetKeys.providerCalls,
        "applications.supervision.budgetKeys.providerCalls",
    );
    const rounds = readNonEmptyString(
        budgetKeys.rounds,
        "applications.supervision.budgetKeys.rounds",
    );
    const budgetKeyValues = [providerCalls, rounds, ...Object.values(worker)];
    if (new Set(budgetKeyValues).size !== budgetKeyValues.length) {
        throw new TypeError("applications.supervision.budgetKeys must be distinct");
    }
    return {
        artifactRoles,
        budgetKeys: { providerCalls, rounds, worker },
        conflictKinds: readVocabulary(
            supervision.conflictKinds,
            "applications.supervision.conflictKinds",
            2,
        ),
        phases: readVocabulary(supervision.phases, "applications.supervision.phases", 2),
        policyKinds: readVocabulary(
            supervision.policyKinds,
            "applications.supervision.policyKinds",
            5,
        ),
        reasons: readRecord(
            supervision.reasons,
            REASON_KEYS,
            "applications.supervision.reasons",
            readNonEmptyString,
        ),
        surfaceRoles,
        workerStatuses: readVocabulary(
            supervision.workerStatuses,
            "applications.supervision.workerStatuses",
            5,
        ),
    };
}

function readCro(value: unknown): ApplicationsConfig["cro"] {
    const cro = readObject(
        value,
        [
            "artifactRoles",
            "baselineKinds",
            "budgetKeys",
            "candidateStatuses",
            "editScopes",
            "exampleRoles",
            "phases",
            "proposer",
            "reflection",
            "splits",
            "surfaceRoles",
            "thresholdKeys",
        ],
        "applications.cro",
    );
    const proposer = readObject(
        cro.proposer,
        ["effectKindPrefix", "limits", "operations", "programId"],
        "applications.cro.proposer",
    );
    const reflection = readObject(
        cro.reflection,
        ["differsByPhrase", "fields"],
        "applications.cro.reflection",
    );
    return {
        artifactRoles: readDistinctRecord(
            cro.artifactRoles,
            CRO_ARTIFACT_ROLE_KEYS,
            "applications.cro.artifactRoles",
        ),
        baselineKinds: readVocabulary(cro.baselineKinds, "applications.cro.baselineKinds", 1),
        budgetKeys: readDistinctRecord(
            cro.budgetKeys,
            CRO_BUDGET_KEYS,
            "applications.cro.budgetKeys",
        ),
        candidateStatuses: readVocabulary(
            cro.candidateStatuses,
            "applications.cro.candidateStatuses",
            4,
        ),
        editScopes: readVocabulary(cro.editScopes, "applications.cro.editScopes", 2),
        exampleRoles: readVocabulary(cro.exampleRoles, "applications.cro.exampleRoles", 4),
        phases: readVocabulary(cro.phases, "applications.cro.phases", 4),
        proposer: {
            effectKindPrefix: readNonEmptyString(
                proposer.effectKindPrefix,
                "applications.cro.proposer.effectKindPrefix",
            ),
            limits: readRecord(
                proposer.limits,
                CRO_PROPOSER_LIMIT_KEYS,
                "applications.cro.proposer.limits",
                readPositiveInteger,
            ),
            operations: readDistinctRecord(
                proposer.operations,
                CRO_PROPOSER_OPERATION_KEYS,
                "applications.cro.proposer.operations",
            ),
            programId: readNonEmptyString(
                proposer.programId,
                "applications.cro.proposer.programId",
            ),
        },
        reflection: {
            differsByPhrase: readNonEmptyString(
                reflection.differsByPhrase,
                "applications.cro.reflection.differsByPhrase",
            ),
            fields: readDistinctRecord(
                reflection.fields,
                CRO_REFLECTION_FIELD_KEYS,
                "applications.cro.reflection.fields",
            ),
        },
        splits: readVocabulary(cro.splits, "applications.cro.splits", 2),
        surfaceRoles: readDistinctRecord(
            cro.surfaceRoles,
            CRO_SURFACE_ROLE_KEYS,
            "applications.cro.surfaceRoles",
        ),
        thresholdKeys: readDistinctRecord(
            cro.thresholdKeys,
            CRO_THRESHOLD_KEYS,
            "applications.cro.thresholdKeys",
        ),
    };
}

function readCompression(value: unknown): ApplicationsConfig["compression"] {
    const compression = readObject(
        value,
        [
            "artifactRoles",
            "baselineKinds",
            "budgetKeys",
            "candidateKinds",
            "candidateStatuses",
            "childFields",
            "forkStepPolicies",
            "forkStepPolicy",
            "outcomes",
            "phases",
            "reasons",
            "surfaceRoles",
            "verdicts",
        ],
        "applications.compression",
    );
    const forkStepPolicies = readVocabulary(
        compression.forkStepPolicies,
        "applications.compression.forkStepPolicies",
        2,
    );
    return {
        artifactRoles: readDistinctRecord(
            compression.artifactRoles,
            COMPRESSION_ARTIFACT_ROLE_KEYS,
            "applications.compression.artifactRoles",
        ),
        baselineKinds: readVocabulary(
            compression.baselineKinds,
            "applications.compression.baselineKinds",
            1,
        ),
        budgetKeys: readDistinctRecord(
            compression.budgetKeys,
            COMPRESSION_BUDGET_KEYS,
            "applications.compression.budgetKeys",
        ),
        candidateKinds: readVocabulary(
            compression.candidateKinds,
            "applications.compression.candidateKinds",
            2,
        ),
        candidateStatuses: readVocabulary(
            compression.candidateStatuses,
            "applications.compression.candidateStatuses",
            4,
        ),
        childFields: readDistinctRecord(
            compression.childFields,
            COMPRESSION_CHILD_FIELD_KEYS,
            "applications.compression.childFields",
        ),
        forkStepPolicies,
        forkStepPolicy: readEnum(
            compression.forkStepPolicy,
            forkStepPolicies,
            "applications.compression.forkStepPolicy",
        ),
        outcomes: readVocabulary(compression.outcomes, "applications.compression.outcomes", 3),
        phases: readVocabulary(compression.phases, "applications.compression.phases", 3),
        reasons: readRecord(
            compression.reasons,
            COMPRESSION_REASON_KEYS,
            "applications.compression.reasons",
            readNonEmptyString,
        ),
        surfaceRoles: readDistinctRecord(
            compression.surfaceRoles,
            COMPRESSION_SURFACE_ROLE_KEYS,
            "applications.compression.surfaceRoles",
        ),
        verdicts: readVocabulary(compression.verdicts, "applications.compression.verdicts", 2),
    };
}

function readTreeRl(value: unknown): ApplicationsConfig["treeRl"] {
    const treeRl = readObject(
        value,
        [
            "actionSegments",
            "advantage",
            "artifactRoles",
            "baselineKinds",
            "batchFormats",
            "budgetKeys",
            "forkTurn",
            "limits",
            "memberKinds",
            "phases",
            "reasons",
            "rolloutStatuses",
            "surfaceRoles",
        ],
        "applications.treeRl",
    );
    const advantage = readObject(
        treeRl.advantage,
        ["epsilon", "normalization", "normalizations", "stdEstimator", "stdEstimators"],
        "applications.treeRl.advantage",
    );
    const normalizations = readVocabulary(
        advantage.normalizations,
        "applications.treeRl.advantage.normalizations",
        2,
    );
    const stdEstimators = readVocabulary(
        advantage.stdEstimators,
        "applications.treeRl.advantage.stdEstimators",
        2,
    );
    if (
        typeof advantage.epsilon !== "number" ||
        !Number.isFinite(advantage.epsilon) ||
        advantage.epsilon <= 0
    ) {
        throw new TypeError("applications.treeRl.advantage.epsilon must be a positive number");
    }
    const forkTurn = readRecord(
        treeRl.forkTurn,
        ["first", "trailing"] as const,
        "applications.treeRl.forkTurn",
        readPositiveInteger,
    );
    const limits = readRecord(
        treeRl.limits,
        TREE_RL_LIMIT_KEYS,
        "applications.treeRl.limits",
        readPositiveInteger,
    );
    if (limits.defaultConcurrency > limits.maxConcurrency) {
        throw new TypeError(
            "applications.treeRl.limits.defaultConcurrency must not exceed maxConcurrency",
        );
    }
    return {
        actionSegments: readVocabulary(
            treeRl.actionSegments,
            "applications.treeRl.actionSegments",
            3,
        ),
        advantage: {
            epsilon: advantage.epsilon,
            normalization: readEnum(
                advantage.normalization,
                normalizations,
                "applications.treeRl.advantage.normalization",
            ),
            normalizations,
            stdEstimator: readEnum(
                advantage.stdEstimator,
                stdEstimators,
                "applications.treeRl.advantage.stdEstimator",
            ),
            stdEstimators,
        },
        artifactRoles: readDistinctRecord(
            treeRl.artifactRoles,
            TREE_RL_ARTIFACT_ROLE_KEYS,
            "applications.treeRl.artifactRoles",
        ),
        baselineKinds: readVocabulary(treeRl.baselineKinds, "applications.treeRl.baselineKinds", 1),
        batchFormats: readVocabulary(treeRl.batchFormats, "applications.treeRl.batchFormats", 1),
        budgetKeys: readDistinctRecord(
            treeRl.budgetKeys,
            TREE_RL_BUDGET_KEYS,
            "applications.treeRl.budgetKeys",
        ),
        forkTurn,
        limits,
        memberKinds: readVocabulary(treeRl.memberKinds, "applications.treeRl.memberKinds", 2),
        phases: readVocabulary(treeRl.phases, "applications.treeRl.phases", 4),
        reasons: readDistinctRecord(
            treeRl.reasons,
            TREE_RL_REASON_KEYS,
            "applications.treeRl.reasons",
        ),
        rolloutStatuses: readVocabulary(
            treeRl.rolloutStatuses,
            "applications.treeRl.rolloutStatuses",
            2,
        ),
        surfaceRoles: readDistinctRecord(
            treeRl.surfaceRoles,
            TREE_RL_SURFACE_ROLE_KEYS,
            "applications.treeRl.surfaceRoles",
        ),
    };
}

function readEvaluation(value: unknown): ApplicationsConfig["evaluation"] {
    const evaluation = readObject(
        value,
        ["limits", "metrics", "reportVersion", "supervisionBaselineKinds"],
        "applications.evaluation",
    );
    return {
        limits: readRecord(
            evaluation.limits,
            EVALUATION_LIMIT_KEYS,
            "applications.evaluation.limits",
            readPositiveInteger,
        ),
        metrics: readVocabulary(evaluation.metrics, "applications.evaluation.metrics", 6),
        reportVersion: readPositiveInteger(
            evaluation.reportVersion,
            "applications.evaluation.reportVersion",
        ),
        supervisionBaselineKinds: readVocabulary(
            evaluation.supervisionBaselineKinds,
            "applications.evaluation.supervisionBaselineKinds",
            1,
        ),
    };
}

function readDistinctRecord<const K extends string>(
    value: unknown,
    keys: readonly K[],
    path: string,
): { readonly [Key in K]: string } {
    const record = readRecord(value, keys, path, readNonEmptyString);
    if (new Set(Object.values(record)).size !== keys.length) {
        throw new TypeError(`${path} must be distinct`);
    }
    return record;
}

function readRecord<const K extends string, V>(
    value: unknown,
    keys: readonly K[],
    path: string,
    read: (entry: unknown, entryPath: string) => V,
): { readonly [Key in K]: V } {
    const object = readObject(value, keys, path);
    return Object.fromEntries(keys.map((key) => [key, read(object[key], `${path}.${key}`)])) as {
        readonly [Key in K]: V;
    };
}

function readVocabulary(value: unknown, path: string, length: number): readonly string[] {
    const values = readUniqueStrings(value, path);
    if (values.length !== length) {
        throw new TypeError(`${path} must contain exactly ${length} values`);
    }
    return values;
}
