import { deepFreeze } from "./config-value-readers.ts";

/**
 * Immutable compatibility contract implemented by kernel ABI v0 and store schema v3.
 *
 * These values define historical identities. They are intentionally code constants:
 * changing the active protocol requires adding a new ABI or migration contract.
 */
export const KERNEL_ABI_V0_CONTRACT = deepFreeze({
    abiVersion: "shepherd.kernel.abi.v0",
    appendIntentDigestAlgorithm: "sha256",
    artifacts: {
        appendBatchDraftSchema: "spec/schemas/append-batch-draft-v0.schema.json",
        recordBodySchema: "spec/schemas/record-body-v0.schema.json",
        recordEnvelopeSchema: "spec/schemas/record-envelope-v0.schema.json",
        recordValues: "src/protocol/values.generated.ts",
        recordViewSchema: "spec/schemas/record-view-v0.schema.json",
        traceArchiveSchema: "spec/schemas/trace-archive-v1.schema.json",
    },
    canonicalVersion: "shepherd.kernel.canonical.v2",
    interchange: {
        blobEncoding: "base64",
        format: "shepherd.trace.archive",
        formatVersion: 1,
    },
    queries: {
        closurePolicies: ["include_external_anchors", "visible_only"],
        cutAppendIntentPrefix: "cut:",
        cutSchemaRef: "kernel.cut.owner-prefix.v1",
        defaultClosurePolicy: "include_external_anchors",
        defaultModeFilter: "both",
        defaultVisibilityProfile: "payload",
        modeFilters: ["both", "captures_only", "declarations_only"],
        visibilityProfiles: ["payload", "shape_only", "full_internal"],
        witnessSchemaRef: "kernel.witness.v1",
    },
    recordId: {
        algorithm: "sha256",
        hexLength: 64,
        prefix: "sha256:",
    },
    recordKind: "record",
    recordModes: ["capture", "declaration"],
    rootWitness: {
        body: {
            active_binding_refs: [],
            actor_ref: "kernel:root",
            authority_refs: [],
            containment: "full",
            provenance_policy_refs: [],
            semantic_environment_refs: [],
            substrate_ref: "kernel",
            visibility_policy_refs: [],
        },
        mode: "capture",
        schemaRef: "kernel.witness.root.v1",
        witnessRef: "",
    },
    schemas: {
        appendBatchDraftId:
            "https://avnionur.github.io/shepherd-typescript/schemas/append-batch-draft-v0.schema.json",
        dialect: "https://json-schema.org/draft/2020-12/schema",
        recordBodyId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-body-v0.schema.json",
        recordEnvelopeId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-envelope-v0.schema.json",
        recordViewId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-view-v0.schema.json",
        traceArchiveId:
            "https://avnionur.github.io/shepherd-typescript/schemas/trace-archive-v1.schema.json",
    },
    store: {
        blobs: {
            collectionModes: ["inspect", "delete"],
            defaultCollectionMode: "inspect",
            digestAlgorithm: "sha256",
            directorySuffix: ".blobs",
            fanoutCharacters: 2,
            fsync: true,
            hexLength: 64,
            idPrefix: "sha256:",
            receiptVersion: 1,
            temporaryFilePrefix: ".tmp-",
        },
        migrations: [
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 1,
            },
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 2,
            },
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 3,
            },
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 4,
            },
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 5,
            },
        ],
        schemaVersion: 5,
    },
} as const);

/** Immutable execution-history projection contract implemented by schema-library v1. */
export const EXECUTION_HISTORY_PROJECTION_V1_CONTRACT = deepFreeze({
    activeRelationKinds: ["spawned", "adopted"],
    executionSchemas: {
        completed: "shepherd2.execution.completed.v1",
        created: "shepherd2.execution.created.v1",
        failed: "shepherd2.execution.failed.v1",
        started: "shepherd2.execution.started.v1",
    },
    modeRequirement: "both",
    payloadVisibilityProfiles: ["payload", "full_internal"],
    publishedRecordSchemaRef: "shepherd2.runtime.published_fact.v1",
    relationKinds: ["spawned", "adopted", "abandoned"],
    relationSchemaRef: "shepherd2.execution_relation.created.v1",
} as const);

/** Immutable provider-neutral contract implemented by provider protocol v1. */
export const PROVIDER_PROTOCOL_V1_CONTRACT = deepFreeze({
    kinds: ["static"],
    static: {
        capabilities: {
            streaming: false,
            structuredOutput: true,
            tools: false,
        },
        errors: {
            exhaustedCode: "STATIC_PROVIDER_EXHAUSTED",
            exhaustedMessage: "static provider cassette is exhausted",
            mismatchCode: "STATIC_PROVIDER_REQUEST_MISMATCH",
            mismatchMessage: "static provider request does not match the next exchange",
        },
        kind: "static",
    },
} as const);

/** Immutable task descriptor and artifact-lock contract implemented by task protocol v1. */
export const TASK_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifactLockVersion: 1,
    artifacts: {
        artifactLockSchema: "spec/schemas/task-artifact-lock-v1.schema.json",
        descriptorSchema: "spec/schemas/task-descriptor-v1.schema.json",
    },
    compatibilityVersion: "shepherd.tasks.v1",
    descriptorVersion: 1,
    digestAlgorithm: "sha256",
    digestPrefix: "sha256:",
    hexLength: 64,
    registry: {
        busyTimeoutMilliseconds: 5_000,
        defaultDatabasePath: ":memory:",
        defensive: true,
        foreignKeys: true,
        journalMode: "WAL",
        migrations: [1],
        schemaVersion: 1,
        synchronous: "FULL",
        transactionMode: "IMMEDIATE",
    },
    schemas: {
        artifactLockId:
            "https://avnionur.github.io/shepherd-typescript/schemas/task-artifact-lock-v1.schema.json",
        descriptorId:
            "https://avnionur.github.io/shepherd-typescript/schemas/task-descriptor-v1.schema.json",
    },
    taskIdPrefix: "task:sha256:",
} as const);

/** Immutable effect intent/outcome contract implemented by effect protocol v1. */
export const EFFECT_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifacts: {
        intentSchema: "spec/schemas/effect-intent-v1.schema.json",
        outcomeSchema: "spec/schemas/effect-outcome-v1.schema.json",
    },
    digestAlgorithm: "sha256",
    digestPrefix: "sha256:",
    hexLength: 64,
    handlers: {
        selection: "last_matching",
        unhandled: "throw",
    },
    intentVersion: 1,
    outcomeVersion: 1,
    phases: { intent: "intent", outcome: "outcome" },
    reversibilityTiers: ["reversible", "compensable", "irreversible"],
    schemas: {
        intentId:
            "https://avnionur.github.io/shepherd-typescript/schemas/effect-intent-v1.schema.json",
        outcomeId:
            "https://avnionur.github.io/shepherd-typescript/schemas/effect-outcome-v1.schema.json",
    },
} as const);

/** Immutable terminal run-outcome contract implemented by run protocol v1. */
export const RUN_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifactContentTypes: ["text", "blob"],
    artifactVersion: 1,
    artifacts: {
        artifactSchema: "spec/schemas/run-artifact-v1.schema.json",
        continuationDescriptorSchema: "spec/schemas/run-continuation-descriptor-v1.schema.json",
        outcomeSchema: "spec/schemas/run-outcome-v1.schema.json",
        runningLifecycleSchema: "spec/schemas/run-lifecycle-running-v1.schema.json",
        suspendedLifecycleSchema: "spec/schemas/run-lifecycle-suspended-v1.schema.json",
        usageSchema: "spec/schemas/run-usage-v1.schema.json",
        waitingLifecycleSchema: "spec/schemas/run-lifecycle-waiting-v1.schema.json",
    },
    control: {
        budgetMetrics: [
            "turns",
            "effects",
            "duration_milliseconds",
            "input_tokens",
            "output_tokens",
            "cost_usd",
        ],
        cancellationReason: "run cancelled by caller",
        disposalReason: "run control disposed",
        maxTimerDurationMilliseconds: 2_147_483_646,
        reasonTypes: ["budget_exhausted", "cancelled"],
        statuses: ["active", "exhausted", "cancelled"],
    },
    execution: {
        continuationConstituentKinds: ["world", "provider_session", "process", "prerequisite"],
        continuationEvidenceStatuses: ["verified", "not_required", "unavailable"],
        continuationVerifiedStatus: "verified",
        continuationVersion: 1,
        controlCommandKinds: ["recover", "pause", "resume", "cancel"],
        controlCommandSchemaId: "shepherd2.execution.control_command.v1",
        errors: {
            claimFencedCode: "DURABLE_EXECUTION_CLAIM_FENCED",
            claimFencedMessage: "durable execution invocation claim is expired or fenced",
            claimLostCode: "DURABLE_EXECUTION_CLAIM_LOST",
            claimLostMessage: "durable execution invocation claim is held by another caller",
            recoveryAbsentCode: "DURABLE_EXECUTION_ABSENT",
            recoveryAbsentMessage: "durable execution recovery requires retained creation evidence",
            recoveryCommandRequiredCode: "DURABLE_EXECUTION_RECOVERY_COMMAND_REQUIRED",
            recoveryCommandRequiredMessage:
                "incomplete durable execution requires an explicit recovery command",
            costUnavailableMessage: "provider cost is unavailable for a configured cost budget",
            costUnavailableType: "RunCostUnavailableError",
            outputValidationMessage: "provider output does not satisfy the task schema",
            outputValidationType: "TaskOutputValidationError",
            providerFailureMessage: "provider invocation failed",
            providerFailureType: "ProviderInvocationError",
            recoveryStartedCode: "DURABLE_EXECUTION_STARTED",
            recoveryStartedMessage: "durable execution started without terminal evidence",
        },
        invocationClaimAppendStatuses: ["committed", "fenced"],
        invocationClaimLeaseMilliseconds: 30_000,
        invocationClaimStatuses: ["acquired", "lost"],
        lifecycleStatuses: ["created", "running", "waiting", "suspended", "terminal"],
        lifecycleRunningStatus: "running",
        lifecycleSuspendedStatus: "suspended",
        lifecycleTerminalStatus: "terminal",
        lifecycleTerminalTransitions: [
            ["created", "failed"],
            ["created", "exhausted"],
            ["created", "cancelled"],
            ["running", "finished"],
            ["running", "failed"],
            ["running", "exhausted"],
            ["running", "cancelled"],
            ["waiting", "failed"],
            ["waiting", "exhausted"],
            ["waiting", "cancelled"],
            ["suspended", "failed"],
            ["suspended", "exhausted"],
            ["suspended", "cancelled"],
        ],
        lifecycleTransitions: [
            ["created", "running"],
            ["running", "waiting"],
            ["waiting", "running"],
            ["running", "suspended"],
            ["suspended", "running"],
        ],
        lifecycleVersion: 1,
        lifecycleWaitingStatus: "waiting",
        recoveryStatuses: ["absent", "created", "started", "terminal_pending_cut", "committed"],
    },
    firstArtifactOrdinal: 0,
    lastArtifactOrdinal: 9_007_199_254_740_990,
    outcomeVersion: 1,
    schemas: {
        artifactId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-artifact-v1.schema.json",
        continuationDescriptorId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-continuation-descriptor-v1.schema.json",
        outcomeId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-outcome-v1.schema.json",
        runningLifecycleId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-lifecycle-running-v1.schema.json",
        suspendedLifecycleId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-lifecycle-suspended-v1.schema.json",
        usageId: "https://avnionur.github.io/shepherd-typescript/schemas/run-usage-v1.schema.json",
        waitingLifecycleId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-lifecycle-waiting-v1.schema.json",
    },
    terminalStatuses: ["finished", "failed", "exhausted", "cancelled"],
    usageVersion: 1,
} as const);
