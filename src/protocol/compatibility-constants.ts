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

/** Immutable Appendix B executable reference and proof-envelope contract. */
export const FORMAL_ASSURANCE_V1_CONTRACT = deepFreeze({
    proofEnvelope: {
        digestAlgorithm: "sha256",
        evidenceRefPrefix: "proof-evidence:sha256:",
        excludedRuntimeSurfaces: [
            "arbitrary_control_flow",
            "provider_sdk_behavior",
            "model_outputs",
            "prompt_cache_state",
            "shell_commands",
            "filesystem_mutation_correctness",
            "sandbox_implementations",
            "carrier_storage",
            "scheduling",
            "cancellation",
            "retries",
            "recovery",
            "multi_branch_replay",
        ],
        hexLength: 64,
        profiles: ["runtime_only", "reference_core_a", "core0", "core_a", "core0h", "extension"],
        programRefPrefix: "program:sha256:",
        referenceValidatedProfile: "reference_core_a",
        referenceValidatedStrength: "reference_validated",
        runtimeOnlyProfile: "runtime_only",
        runtimeOnlyStrength: "runtime_only",
        schemaVersion: "shepherd_kernel_v3_reference.proof-envelope.v1",
        strengths: [
            "runtime_only",
            "reference_validated",
            "forward_simulation",
            "semantic_adequacy",
        ],
        traceRefPrefixes: {
            completed: "trace:sha256:",
            prefix: "trace-prefix:sha256:",
        },
        validationOperations: {
            completed: "validate_core_a_trace",
            prefix: "validate_core_a_trace_prefix",
        },
        validator: "shepherd-kernel-v3-reference.proof-envelope.v1",
    },
    referenceMachine: {
        actionKinds: ["return", "abort"],
        closureReasons: ["abandoned", "skipped_by_outer_abort"],
        continuationDispositions: ["completed", "aborted"],
        pathPrefix: "path:",
        profileVersion: "shepherd.kernel-v3-reference.core-a.v1",
        recordTypes: {
            capture: "EffectCapture",
            continuationResume: "ContinuationResume",
            declaration: "EffectDeclaration",
            resumeReturn: "ResumeReturn",
            resumptionHandle: "ResumptionHandle",
            selection: "HandlerSelection",
            selectionClosed: "SelectionClosed",
        },
        resumptionSourceRecordType: "ResumptionHandle",
        rootBranchRef: "branch:root",
    },
    strongEvidence: {
        core0hSidecar: {
            contentRefPrefix: "core0h-sidecar:sha256:",
            handlerRefPrefix: "handler:sha256:",
            phaseRefPrefix: "handler-phase:sha256:",
            schemaVersion: "shepherd.kernel-v3-core0h-sidecar.v1",
            trustedManifestRefs: [],
            validator: "shepherd-kernel-v3-reference.core0h-sidecar.v1",
        },
        lowering: {
            contentRefPrefix: "proof-lowering:sha256:",
            oracle: {
                path: "shepherd/packages/kernel-v3-reference/tests/golden_cases.py",
                repository: "https://github.com/shepherd-agents/shepherd",
                revision: "d45074e0099d9ccafeed4a233702ad68ff8a2fa6",
            },
            schemaVersion: "shepherd.kernel-v3-static-lowering.v1",
            sourceRefPrefix: "source:sha256:",
            trustedManifestRefs: [
                "proof-lowering:sha256:c160daf16228e78c4143f82c56eca660125131a942b540a92ecab2ac5ba37c15",
                "proof-lowering:sha256:fe4b89b5867cf0fcb2607c9b8822be0da455678d10b0641e0ecf2862b19cf111",
                "proof-lowering:sha256:18519bdcd9962eb9c375c1b1d99336d34aa034fd2ae9232bdf7f677af62fdbe3",
            ],
            validator: "shepherd-kernel-v3-reference.static-lowering.v1",
        },
        profileClaims: [
            {
                assumptions: [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                ],
                forbiddenActionKinds: ["abort"],
                profile: "core0",
                requiredCaptureActionKind: null,
                requiresCore0hSidecar: false,
                strength: "semantic_adequacy",
                theoremIds: [
                    "source_eval_to_machine",
                    "core0_machine_eval_to_source",
                    "trace_monotonic",
                ],
            },
            {
                assumptions: [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                    "single_direct_abort_capture",
                ],
                forbiddenActionKinds: [],
                profile: "core_a",
                requiredCaptureActionKind: "abort",
                requiresCore0hSidecar: false,
                strength: "semantic_adequacy",
                theoremIds: [
                    "source_eval_to_machine",
                    "coreA_machine_eval_to_source",
                    "trace_monotonic",
                ],
            },
            {
                assumptions: [
                    "static_source_fragment",
                    "generated_trace_exact",
                    "lean_fragment_assumptions",
                    "deterministic_two_phase_handlers",
                ],
                forbiddenActionKinds: ["abort"],
                profile: "core0h",
                requiredCaptureActionKind: null,
                requiresCore0hSidecar: true,
                strength: "forward_simulation",
                theoremIds: ["core0h_source_eval_to_machine", "core0h_trace_monotonic"],
            },
        ],
        theoremArtifact: {
            authority: "shepherd-kernel-v3-proof-artifact.v1",
            buildGate: "make verify-proof-envelope-claim",
            extensionTheoremIds: ["vcscore_run_record_sound"],
            metadataRef:
                "proof-artifact:sha256:36d1bed0b6e9bc280691d7a27fad334ef7ec44ef45f82bbab62fe720dc837eb2",
            metadataRefPrefix: "proof-artifact:sha256:",
            revision: "arxiv:2605.10913v3",
            schemaVersion: "shepherd.kernel-v3-proof-artifact.v1",
            theoremIds: [
                "source_eval_to_machine",
                "core0_machine_eval_to_source",
                "coreA_machine_eval_to_source",
                "core0h_source_eval_to_machine",
                "trace_monotonic",
                "core0h_trace_monotonic",
                "single_child_branch_replay_sound",
            ],
        },
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

/** Immutable workspace initialization and adoption contract implemented by protocol v1. */
export const WORKSPACE_PROTOCOL_V1_CONTRACT = deepFreeze({
    adoptionModes: ["none", "git-head", "worktree"],
    controlDirectory: ".vcscore",
    defaultAdoptionMode: "worktree",
    defaultInitializeGit: true,
    digestAlgorithm: "sha256",
    errors: {
        conflictCode: "WORKSPACE_INITIALIZATION_CONFLICT",
        conflictMessage: "workspace is already initialized with different options",
        controlCode: "WORKSPACE_CONTROL_ERROR",
        controlMessage: "workspace control metadata is invalid",
    },
    format: "shepherd.workspace-control",
    formatVersion: 1,
    gitExecutable: "git",
    gitHeadRefPrefix: "git-head:",
    gitMetadataName: ".git",
    hexLength: 64,
    manifestFile: "workspace.json",
    worktreeRefPrefix: "worktree:sha256:",
} as const);

/** Immutable canonical-binding extension implemented by workspace protocol v2. */
export const WORKSPACE_PROTOCOL_V2_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V1_CONTRACT,
    bindingErrors: {
        authorityEscapeCode: "WORKSPACE_BINDING_AUTHORITY_ESCAPE",
        authorityEscapeMessage: "workspace binding root escapes workspace authority",
        duplicateNameCode: "WORKSPACE_BINDING_DUPLICATE_NAME",
        duplicateNameMessage: "workspace binding names must be unique",
        invalidNameCode: "WORKSPACE_BINDING_INVALID_NAME",
        invalidNameMessage: "workspace binding name is invalid",
        invalidRootCode: "WORKSPACE_BINDING_INVALID_ROOT",
        invalidRootMessage: "workspace binding root is unavailable or unsafe",
        rootOverlapCode: "WORKSPACE_BINDING_ROOT_OVERLAP",
        rootOverlapMessage: "workspace binding roots must be disjoint",
    },
    bindingIdentityKind: "workspace-binding",
    bindingVersion: 2,
} as const);

/** Immutable reference copy-carrier extension implemented by workspace protocol v3. */
export const WORKSPACE_PROTOCOL_V3_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V2_CONTRACT,
    carrier: {
        backendKind: "copy",
        blobIdPrefix: "blob:sha256:",
        carrierDirectory: "worlds",
        captureKind: "verified-copy",
        custodiesDirectory: "custodies",
        custodyDescriptorFile: "custody.json",
        custodyIdPrefix: "world-custody:",
        descriptorFormat: "shepherd.copy-world",
        descriptorVersion: 1,
        discardDescriptorSuffix: ".discarded.json",
        discardStatus: "discarded",
        discardedDirectory: "discarded",
        entryKinds: ["directory", "file", "symlink"],
        errors: {
            conflictCode: "WORLD_CARRIER_CONFLICT",
            conflictMessage: "world carrier identity conflicts with retained custody",
            controlCode: "WORLD_CARRIER_ERROR",
            controlMessage: "world carrier evidence is unavailable or invalid",
            unsupportedCode: "WORLD_CARRIER_UNSUPPORTED_ENTRY",
            unsupportedMessage: "world carrier source contains unsupported filesystem semantics",
        },
        manifestVersion: 1,
        revisionsDirectory: "revisions",
        revisionDescriptorFile: "revision.json",
        revisionIdPrefix: "world-revision:sha256:",
        stagingDirectory: "staging",
        worldContentIdPrefix: "world-content:sha256:",
        worldDirectory: "world",
    },
} as const);

/** Immutable Git-aware custody extension implemented by workspace protocol v4. */
export const WORKSPACE_PROTOCOL_V4_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V3_CONTRACT,
    gitCustody: {
        archiveExecutable: "tar",
        basisIdPrefix: "git-basis:sha256:",
        descriptorFile: "git-output.json",
        descriptorFormat: "shepherd.git-aware-custody",
        descriptorVersion: 1,
        errors: {
            baselineUnavailableCode: "GIT_CUSTODY_BASELINE_UNAVAILABLE",
            baselineUnavailableMessage: "Git custody baseline is unavailable",
            controlCode: "GIT_CUSTODY_ERROR",
            controlMessage: "Git custody evidence is unavailable or invalid",
            movementCode: "GIT_CUSTODY_BASIS_MOVED",
            movementMessage: "Git custody basis moved during capture",
            unsupportedCode: "GIT_CUSTODY_UNSUPPORTED_STATE",
            unsupportedMessage: "Git state is unsupported for retained custody",
        },
        headKinds: ["attached", "unborn", "detached"],
        identityFile: "git-identity.json",
        identityFormat: "shepherd.git-identity",
        indexIdPrefix: "git-index:sha256:",
        indexReceiptFile: "index.bin",
        maxCommandBytes: 67_108_864,
        objectPackFile: "objects.pack",
        objectPackIdPrefix: "git-pack:sha256:",
        objectFormats: ["sha1", "sha256"],
        repositoryIdPrefix: "git-repository:",
        repositoryIdentityFile: "git-repository-id.json",
        repositoryLockAttempts: 500,
        repositoryLockDelayMs: 10,
        repositoryLockPrefix: "shepherd-git-authority-",
        stagingDirectory: "git-staging",
        version: 4,
        worktreeIdPrefix: "git-worktree:",
    },
} as const);

/** Immutable pure changeset-model extension implemented by workspace protocol v5. */
export const WORKSPACE_PROTOCOL_V5_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V4_CONTRACT,
    changesets: {
        errors: {
            invalidCode: "WORLD_CHANGESET_INVALID",
            invalidMessage: "world changeset input is invalid or inconsistent",
            limitCode: "WORLD_CHANGESET_LIMIT_EXCEEDED",
            limitMessage: "world changeset exceeds configured resource limits",
        },
        idPrefix: "world-changeset:sha256:",
        maxAggregateReferencedBytes: 1_073_741_824,
        maxChanges: 100_000,
        maxManifestEntries: 2_000,
        maxManifestRecordBytes: 1_048_576,
        maxPathBytes: 4_096,
        maxRecordBytes: 1_048_576,
        maxSingleBlobBytes: 268_435_456,
        maxSymlinkTargetBytes: 65_536,
        operations: ["add", "delete", "modify", "replace"],
        version: 5,
    },
} as const);

/** Immutable parent-linked custody-capture extension implemented by workspace protocol v6. */
export const WORKSPACE_PROTOCOL_V6_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V5_CONTRACT,
    worldCapture: {
        maxRevisionDepth: 1_024,
        version: 6,
    },
} as const);

/** Immutable authenticated retained-world runner extension implemented by workspace protocol v7. */
export const WORKSPACE_PROTOCOL_V7_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V6_CONTRACT,
    worldExecution: {
        enforcementKinds: ["advisory"],
        maxRunnerIdBytes: 256,
        runnerVersion: 7,
    },
} as const);
