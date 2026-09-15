import { deepFreeze } from "./config-value-readers.ts";

/** Immutable human-facing command topology contract implemented by CLI v1. */
export const CLI_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifacts: {
        commandReference: "docs/generated/cli-reference.md",
        jsonOutputSchema: "spec/schemas/cli-output-v1.schema.json",
        quickstartDemo: "examples/quickstart.mjs",
    },
    compatibilityVersion: "shepherd.cli.v1",
    defaults: {
        bindingName: "workspace",
        bindingRoot: ".",
        quickstartDemoName: "quickstart",
        taskRegistryPath: "tasks.sqlite",
        traceStorePath: "trace.sqlite",
        workspacePath: ".",
    },
    executableName: "shepherd-ts",
    executablePath: "dist/src/cli/main.js",
    exitCodes: {
        failure: 1,
        success: 0,
        unavailable: 3,
        usage: 2,
    },
    handlerRoles: {
        doctor: "doctor",
        runApply: "run-apply",
        runChangeset: "run-changeset",
        runDiscard: "run-discard",
        runList: "run-list",
        runOutputCitations: "run-output-citations",
        runOutputs: "run-outputs",
        runPublishRetainedWorkspaceOutput: "run-publish-retained-workspace-output",
        runRecoveryRecords: "run-recovery-records",
        runRelease: "run-release",
        runRepair: "run-repair",
        runSelect: "run-select",
        runShow: "run-show",
        runTrace: "run-trace",
        runTraceRevision: "run-trace-revision",
        runVcsCore: "run-vcscore",
        taskList: "task-list",
        taskResolve: "task-resolve",
        taskShow: "task-show",
        demoWrite: "demo-write",
        unsupportedPackageInit: "unsupported-package-init",
        unsupportedStart: "unsupported-start",
        unsupportedTaskRegister: "unsupported-task-register",
        workspaceInit: "workspace-init",
    },
    helpAliases: ["--help", "-h"],
    groups: [
        { commands: [], handler: "workspace-init", name: "init" },
        { commands: [], handler: "doctor", name: "doctor" },
        {
            commands: [
                { handler: "run-list", name: "list" },
                { handler: "run-show", name: "show" },
                { handler: "run-changeset", name: "changeset" },
                { handler: "run-trace", name: "trace" },
                { handler: "run-trace-revision", name: "trace-revision" },
                { handler: "run-output-citations", name: "output-citations" },
                { handler: "run-outputs", name: "outputs" },
                { handler: "run-vcscore", name: "vcscore" },
                {
                    handler: "run-publish-retained-workspace-output",
                    name: "publish-retained-workspace-output",
                },
                { handler: "run-recovery-records", name: "recovery-records" },
                { handler: "run-select", name: "select" },
                { handler: "run-apply", name: "apply" },
                { handler: "run-release", name: "release" },
                { handler: "run-discard", name: "discard" },
                { handler: "run-repair", name: "repair" },
                { handler: "unsupported-start", name: "start" },
            ],
            handler: null,
            name: "run",
        },
        {
            commands: [
                { handler: "task-list", name: "list" },
                { handler: "task-show", name: "show" },
                { handler: "task-resolve", name: "resolve" },
                { handler: "unsupported-task-register", name: "register" },
            ],
            handler: null,
            name: "task",
        },
        {
            commands: [{ handler: "demo-write", name: "write" }],
            handler: null,
            name: "demo",
        },
        {
            commands: [{ handler: "unsupported-package-init", name: "init" }],
            handler: null,
            name: "package",
        },
    ],
    limits: {
        defaultPageSize: 25,
        defaultRetainedReadBytes: 65_536,
        maxArgumentBytes: 4_096,
        maxArguments: 64,
        maxOutputBytes: 1_048_576,
        maxPageSize: 100,
        maxRetainedReadBytes: 1_048_576,
    },
    machineOutput: {
        compatibilityVersion: "shepherd.cli.json.v1",
        errorCodes: {
            failure: "CLI_FAILURE",
            unavailable: "CLI_UNAVAILABLE",
            usage: "CLI_USAGE",
        },
        maxCanonicalBytes: 1_048_576,
        resultShapes: {
            doctor: [
                [
                    "native_jail",
                    "node_version",
                    "protocol",
                    "task_registry",
                    "trace_store",
                    "workspace",
                ],
            ],
            "run-apply": [["settlement"]],
            "run-changeset": [["changeset"], ["changeset_read"]],
            "run-discard": [["settlement"]],
            "run-list": [["runs"]],
            "run-output-citations": [["output_citation"], ["output_citations"]],
            "run-outputs": [["output"], ["outputs"]],
            "run-publish-retained-workspace-output": [["publication"]],
            "run-recovery-records": [["recovery_record"], ["recovery_records"]],
            "run-release": [["settlement"]],
            "run-repair": [["repair_receipt"]],
            "run-select": [["settlement"]],
            "run-show": [["run"]],
            "run-trace": [["trace_revision"], ["trace_revisions"]],
            "run-trace-revision": [["trace_revision"], ["trace_revisions"]],
            "run-vcscore": [["vcscore"]],
            "task-list": [["tasks"]],
            "task-resolve": [["task"]],
            "task-show": [["task"]],
            "demo-write": [["demo"]],
            "unsupported-package-init": [],
            "unsupported-start": [],
            "unsupported-task-register": [],
            "workspace-init": [["adoption", "format"]],
        },
        schemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/cli-output-v1.schema.json",
        unavailableRemedies: {
            "unsupported-package-init": "packageInit",
            "unsupported-start": "fencedStart",
            "unsupported-task-register": "taskRegister",
        },
        version: 1,
    },
    messages: {
        changesetBinary: "retained changeset path is not UTF-8 text",
        changesetPathUnavailable: "retained changeset path is unavailable",
        changesetUnavailable: "retained changeset evidence is unavailable",
        demoNameUsage: "demo write requires exactly one configured demo name",
        publicationExactRun: "retained-output publication requires an exact run identity",
        publicationUnavailable:
            "retained-output citation repair requires managed recovery authority",
        quickstartUnavailable: "quickstart demo artifact is unavailable",
    },
    options: {
        adopt: "adopt",
        bindingName: "binding-name",
        bindingRoot: "binding-root",
        command: "command",
        initializeGit: "initialize-git",
        json: "json",
        limit: "limit",
        maxBytes: "max-bytes",
        noInitializeGit: "no-initialize-git",
        offset: "offset",
        registry: "registry",
        read: "read",
        store: "store",
        workspace: "workspace",
    },
    remedies: {
        fencedStart: "run start is fenced; use the public task execution APIs",
        packageInit: "package init requires the reproducible extension scaffold capability",
        taskRegister:
            "task register does not execute dynamic source modules; register through the public descriptor API",
    },
    version: 1,
} as const);

/**
 * Immutable compatibility contract implemented by kernel ABI v0 through store schema v5.
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

/** Immutable schema-v6 store extension for consume-once retained-output settlement. */
export const KERNEL_ABI_V0_STORE_V6_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_CONTRACT.store,
    migrations: [
        ...KERNEL_ABI_V0_CONTRACT.store.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 6,
        },
    ],
    schemaVersion: 6,
} as const);

/** Immutable schema-v7 store extension reserving closed retained-world effect-journal columns. */
export const KERNEL_ABI_V0_STORE_V7_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V6_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V6_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 7,
        },
    ],
    schemaVersion: 7,
} as const);

/** Immutable schema-v8 store extension for orphaned-operation bookkeeping. */
export const KERNEL_ABI_V0_STORE_V8_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V7_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V7_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 8,
        },
    ],
    schemaVersion: 8,
} as const);

/** Immutable schema-v9 store extension for durable scope registrations and writer claims. */
export const KERNEL_ABI_V0_STORE_V9_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V8_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V8_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 9,
        },
    ],
    schemaVersion: 9,
} as const);

/** Immutable durable trace-subscription cursor table implemented by store schema v10. */
export const KERNEL_ABI_V0_STORE_V10_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V9_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V9_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 10,
        },
    ],
    schemaVersion: 10,
} as const);

/** Immutable supervised-dispatch registration and decision-lease table implemented by store schema v11. */
export const KERNEL_ABI_V0_STORE_V11_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V10_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V10_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 11,
        },
    ],
    schemaVersion: 11,
} as const);

/** Immutable replay session registration and writer-lease table implemented by store schema v12. */
export const KERNEL_ABI_V0_STORE_V12_CONTRACT = deepFreeze({
    ...KERNEL_ABI_V0_STORE_V11_CONTRACT,
    migrations: [
        ...KERNEL_ABI_V0_STORE_V11_CONTRACT.migrations,
        {
            firstOwnerOrdinal: 0,
            lastOwnerOrdinal: 9_007_199_254_740_990,
            version: 12,
        },
    ],
    schemaVersion: 12,
} as const);

/** Immutable bounded orphaned-operation diagnosis and repair contract implemented by v1. */
export const ORPHAN_REPAIR_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifacts: {
        commandSchema: "spec/schemas/orphan-repair-command-v1.schema.json",
        diagnosisSchema: "spec/schemas/orphan-operation-diagnosis-v1.schema.json",
        receiptSchema: "spec/schemas/orphan-repair-receipt-v1.schema.json",
    },
    blockers: {
        liveSession: "live_session",
        providerStarted: "provider_call_started",
        scopeOwned: "scope_owned",
    },
    compatibilityVersion: "shepherd.orphan-operation-repair.v1",
    errors: {
        blockedCode: "ORPHAN_REPAIR_BLOCKED",
        blockedMessage: "orphaned operation repair is blocked by retained safety evidence",
        commandConflictCode: "ORPHAN_REPAIR_COMMAND_CONFLICT",
        commandConflictMessage: "orphan repair command identity already names different content",
        corruptCode: "ORPHAN_REPAIR_CORRUPT",
        corruptMessage: "orphaned operation bookkeeping is corrupt",
        staleCode: "ORPHAN_REPAIR_STALE_BASIS",
        staleMessage: "orphan repair basis is stale or incomplete; diagnose again",
        unsupportedCode: "ORPHAN_REPAIR_UNSUPPORTED_VERSION",
        unsupportedMessage: "orphan repair evidence uses an unsupported version",
    },
    identity: {
        algorithm: "sha256",
        commandAppendIntentPrefix: "orphan-repair-command:",
        commandOwnerPrefix: "orphan-repair:",
        diagnosisPrefix: "orphan-diagnosis:sha256:",
        hexLength: 64,
        receiptAppendIntentPrefix: "orphan-repair-receipt:",
        receiptPrefix: "orphan-repair-receipt:sha256:",
    },
    limits: {
        defaultPageSize: 50,
        maxCanonicalBytes: 1_048_576,
        maxCauseBytes: 4_096,
        maxIdentifierBytes: 512,
        maxOperations: 100,
        maxPageSize: 100,
    },
    schemas: {
        commandId:
            "https://avnionur.github.io/shepherd-typescript/schemas/orphan-repair-command-v1.schema.json",
        diagnosisId:
            "https://avnionur.github.io/shepherd-typescript/schemas/orphan-operation-diagnosis-v1.schema.json",
        receiptId:
            "https://avnionur.github.io/shepherd-typescript/schemas/orphan-repair-receipt-v1.schema.json",
    },
    statuses: {
        preRun: {
            declined: "declined",
            repaired: "repaired",
        },
        session: {
            dead: "dead",
            live: "live",
        },
    },
    traceSchemas: {
        command: "shepherd.orphan-repair.command.v1",
        receipt: "shepherd.orphan-repair.receipt.v1",
    },
    versions: {
        command: 1,
        diagnosis: 1,
        operation: 1,
        receipt: 1,
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

/** Immutable bounded output/trace/recovery evidence projection implemented by v1. */
export const EVIDENCE_RECORD_PROJECTION_V1_CONTRACT = deepFreeze({
    artifacts: {
        outputCitationSchema: "spec/schemas/output-citation-entry-v1.schema.json",
        recoveryRecordSchema: "spec/schemas/recovery-record-entry-v1.schema.json",
        traceRevisionSchema: "spec/schemas/trace-revision-entry-v1.schema.json",
    },
    compatibilityVersion: "shepherd.output-trace-recovery.v1",
    defaultPageSize: 50,
    errors: {
        ambiguousCode: "LEDGER_SELECTOR_AMBIGUOUS",
        ambiguousMessage: "evidence selector is ambiguous",
        notFoundCode: "LEDGER_SELECTOR_NOT_FOUND",
        notFoundMessage: "evidence selector was not found",
    },
    latestSelector: "@latest",
    maxCanonicalEntryBytes: 67_108_864,
    maxPageSize: 100,
    maxSelectorBytes: 512,
    outputIdJsonPath: "$.output_id",
    schemas: {
        outputCitationId:
            "https://avnionur.github.io/shepherd-typescript/schemas/output-citation-entry-v1.schema.json",
        recoveryRecordId:
            "https://avnionur.github.io/shepherd-typescript/schemas/recovery-record-entry-v1.schema.json",
        traceRevisionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/trace-revision-entry-v1.schema.json",
    },
    version: 1,
} as const);

/** Immutable bounded task/run ledger read projection implemented by projection v1. */
export const TASK_RUN_LEDGER_PROJECTION_V1_CONTRACT = deepFreeze({
    artifacts: {
        runEntrySchema: "spec/schemas/run-ledger-entry-v1.schema.json",
        taskEntrySchema: "spec/schemas/task-ledger-entry-v1.schema.json",
    },
    compatibilityVersion: "shepherd.task-run-ledgers.v1",
    defaultPageSize: 50,
    errors: {
        ambiguousCode: "LEDGER_SELECTOR_AMBIGUOUS",
        ambiguousMessage: "ledger selector is ambiguous",
        notFoundCode: "LEDGER_SELECTOR_NOT_FOUND",
        notFoundMessage: "ledger selector was not found",
    },
    latestSelector: "@latest",
    maxCanonicalEntryBytes: 67_108_864,
    maxPageSize: 100,
    maxSelectorBytes: 512,
    schemas: {
        runEntryId:
            "https://avnionur.github.io/shepherd-typescript/schemas/run-ledger-entry-v1.schema.json",
        taskEntryId:
            "https://avnionur.github.io/shepherd-typescript/schemas/task-ledger-entry-v1.schema.json",
    },
    taskVersionSeparator: "@",
    version: 1,
} as const);

/** Immutable provider-neutral contract implemented by provider protocol v1. */
export const PROVIDER_PROTOCOL_V1_CONTRACT = deepFreeze({
    kinds: ["static", "program"],
    program: {
        capabilities: {
            streaming: false,
            structuredOutput: true,
            tools: false,
        },
        kind: "program",
    },
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
        valueSchema: "spec/schemas/task-value-v1.schema.json",
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
        valueId: "https://avnionur.github.io/shepherd-typescript/schemas/task-value-v1.schema.json",
    },
    taskIdPrefix: "task:sha256:",
} as const);

/** Immutable task delegation, child run handle, and delegated authority contract implemented by delegation v1. */
export const DELEGATION_PROTOCOL_V1_CONTRACT = deepFreeze({
    approvalVerdicts: ["approved", "rejected"],
    artifacts: {
        approvalSchema: "spec/schemas/delegation-approval-v1.schema.json",
        completionSchema: "spec/schemas/delegation-completion-v1.schema.json",
        contextSchema: "spec/schemas/delegation-context-v1.schema.json",
        decisionSchema: "spec/schemas/delegation-decision-v1.schema.json",
        handoffSchema: "spec/schemas/delegation-handoff-v1.schema.json",
        openedSchema: "spec/schemas/delegation-opened-v1.schema.json",
    },
    compatibilityVersion: "shepherd.delegation.v1",
    contextPhases: ["injected", "consumed"],
    decisionKinds: ["accepted", "discarded"],
    errors: {
        approvalRequiredCode: "DELEGATION_APPROVAL_REQUIRED",
        approvalRequiredMessage: "child run task value requires approval before execution",
        authorityCode: "DELEGATION_AUTHORITY_EXCEEDED",
        authorityMessage: "delegated grant or budget exceeds the parent authority",
        commandConflictCode: "DELEGATION_COMMAND_CONFLICT",
        commandConflictMessage: "delegation command identity already names different content",
        evidenceCode: "DELEGATION_EVIDENCE_INVALID",
        evidenceMessage: "delegation evidence is absent, malformed, or inconsistent",
        headConflictCode: "DELEGATION_HEAD_CONFLICT",
        headConflictMessage: "child run handle head moved since the command was admitted",
        statusCode: "DELEGATION_STATUS_CONFLICT",
        statusMessage: "child run handle status does not admit the command",
        supervisorCode: "DELEGATION_SUPERVISOR_MISMATCH",
        supervisorMessage: "command names a supervisor that does not own the child run handle",
    },
    executionKinds: ["provider", "program"],
    identity: {
        childRunIdPrefix: "delegation-run:sha256:",
        commandAppendIntentKind: "delegation_command",
        handleIdPrefix: "delegation:sha256:",
        originCutIdPrefix: "delegation-origin:sha256:",
        outputDigestKind: "delegation_output",
        requestDigestKind: "delegation_request",
        retryCutIdPrefix: "delegation-retry:sha256:",
    },
    limits: {
        maxCitedRecords: 32,
        maxInjections: 64,
        maxNestingDepth: 16,
        maxReasonLength: 1024,
        maxSupervisorIdLength: 256,
        maxTreeEntries: 256,
    },
    parentKinds: ["root", "handle"],
    provenanceKinds: ["declared", "revised", "synthesized"],
    recordVersion: 1,
    revisionFields: ["instruction", "input_schema", "output_schema", "task_version"],
    schemas: {
        approvalId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-approval-v1.schema.json",
        completionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-completion-v1.schema.json",
        contextId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-context-v1.schema.json",
        decisionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-decision-v1.schema.json",
        handoffId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-handoff-v1.schema.json",
        openedId:
            "https://avnionur.github.io/shepherd-typescript/schemas/delegation-opened-v1.schema.json",
    },
    statuses: [
        "ready",
        "running",
        "settling",
        "approval_pending",
        "rejected",
        "accepted",
        "discarded",
    ],
    traceSchemas: {
        approval: "shepherd.delegation.approval.v1",
        completion: "shepherd.delegation.completion.v1",
        context: "shepherd.delegation.context.v1",
        decision: "shepherd.delegation.decision.v1",
        handoff: "shepherd.delegation.handoff.v1",
        opened: "shepherd.delegation.opened.v1",
    },
    treeRootKinds: ["handle", "supervisor"],
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

/** Immutable durable isolated-scope registration and emission contract implemented by v1. */
export const SCOPE_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifacts: {
        childRegisteredSchema: "spec/schemas/scope-child-registered-v1.schema.json",
        emissionSchema: "spec/schemas/scope-emission-v1.schema.json",
        registrationSchema: "spec/schemas/scope-registration-v1.schema.json",
    },
    authority: {
        atoms: ["read", "write"],
        resourceKinds: ["repository_binding"],
    },
    commandKinds: ["register_root", "register_child", "emit"],
    compatibilityVersion: "shepherd.scope.v1",
    errors: {
        authorityCode: "SCOPE_AUTHORITY_REFUSED",
        authorityMessage:
            "scope authority request cites unknown resources or exceeds parent or ceiling authority",
        evidenceCode: "SCOPE_EVIDENCE_INVALID",
        evidenceMessage: "scope evidence is absent, malformed, or inconsistent",
        headConflictCode: "SCOPE_HEAD_CONFLICT",
        headConflictMessage: "scope command expected head is not the current scope head",
        writerConflictCode: "SCOPE_WRITER_CONFLICT",
        writerConflictMessage: "scope writer claim is held by another unexpired caller",
        writerFencedCode: "SCOPE_WRITER_FENCED",
        writerFencedMessage: "scope writer claim is released, expired, superseded, or unknown",
    },
    evidenceKinds: ["registration", "origin_cut", "child_registered", "emission"],
    identity: {
        originCutIdPrefix: "scope-origin:",
        scopeIdPrefix: "scope:sha256:",
    },
    kinds: ["root", "child"],
    limits: {
        maxCitedRecords: 64,
        maxDataCanonicalBytes: 65_536,
        maxResources: 64,
    },
    recordVersion: 1,
    schemas: {
        childRegisteredId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-child-registered-v1.schema.json",
        emissionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-emission-v1.schema.json",
        registrationId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-registration-v1.schema.json",
    },
    states: ["open", "merged", "discarded"],
    traceSchemas: {
        childRegistered: "shepherd.scope.child_registered.v1",
        emission: "shepherd.scope.emission.v1",
        registration: "shepherd.scope.registration.v1",
    },
    worldCapabilities: ["trace_only"],
    writerClaimLeaseMilliseconds: 30_000,
} as const);

/** Immutable reference-copy fork, checkpoint, and multi-writer extension implemented by scope v2. */
export const SCOPE_PROTOCOL_V2_CONTRACT = deepFreeze({
    ...SCOPE_PROTOCOL_V1_CONTRACT,
    artifacts: {
        ...SCOPE_PROTOCOL_V1_CONTRACT.artifacts,
        forkSchema: "spec/schemas/scope-fork-v1.schema.json",
    },
    authority: {
        ...SCOPE_PROTOCOL_V1_CONTRACT.authority,
        resourceKinds: ["repository_binding", "workspace_binding"],
    },
    checkpoint: {
        constituentKinds: [
            "trace_cut",
            "execution",
            "binding",
            "world",
            "grants",
            "child_frontier",
            "budget",
            "provider_session",
            "process",
            "irreversible_effects",
        ],
        evidenceStatuses: ["verified", "reconstructive", "not_applicable", "unavailable"],
        version: 1,
    },
    commandKinds: ["register_root", "register_child", "emit", "fork"],
    evidenceKinds: [
        "registration",
        "origin_cut",
        "child_registered",
        "emission",
        "fork_prepared",
        "fork_completed",
    ],
    forkPhases: ["prepared", "completed"],
    identity: {
        ...SCOPE_PROTOCOL_V1_CONTRACT.identity,
        custodyIdentityKind: "scope-fork-custody",
    },
    schemas: {
        ...SCOPE_PROTOCOL_V1_CONTRACT.schemas,
        forkId: "https://avnionur.github.io/shepherd-typescript/schemas/scope-fork-v1.schema.json",
    },
    traceSchemas: {
        ...SCOPE_PROTOCOL_V1_CONTRACT.traceSchemas,
        fork: "shepherd.scope.fork.v1",
    },
    worldCapabilities: ["trace_only", "reference_copy"],
} as const);

/** Immutable consume-once merge and discard extension implemented by scope v3. */
export const SCOPE_PROTOCOL_V3_CONTRACT = deepFreeze({
    ...SCOPE_PROTOCOL_V2_CONTRACT,
    artifacts: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.artifacts,
        childMergedSchema: "spec/schemas/scope-child-merged-v1.schema.json",
        discardSchema: "spec/schemas/scope-discard-v1.schema.json",
        mergeSchema: "spec/schemas/scope-merge-v1.schema.json",
    },
    commandKinds: ["register_root", "register_child", "emit", "fork", "merge", "discard"],
    discardPhases: ["decided", "cleaned"],
    errors: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.errors,
        mergeConflictCode: "SCOPE_MERGE_CONFLICT",
        mergeConflictMessage: "scope merge child and current parent changes overlap",
        quiescenceCode: "SCOPE_NOT_QUIESCENT",
        quiescenceMessage:
            "scope operation requires quiescent scopes without live descendants, pending commands, or unreleased writers",
        terminalConflictCode: "SCOPE_TERMINAL_CONFLICT",
        terminalConflictMessage: "scope is not open or already retains another terminal decision",
    },
    evidenceKinds: [
        ...SCOPE_PROTOCOL_V2_CONTRACT.evidenceKinds,
        "merge_cut",
        "merge_prepared",
        "merge_completed",
        "child_merged",
        "discard_decided",
        "discard_cleaned",
    ],
    identity: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.identity,
        mergeCustodyIdentityKind: "scope-merge-application-custody",
        mergeCutIdPrefix: "scope-merge:",
    },
    limits: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.limits,
        maxContributions: 1_024,
        maxDiscardScopes: 256,
    },
    mergePhases: ["prepared", "completed"],
    schemas: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.schemas,
        childMergedId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-child-merged-v1.schema.json",
        discardId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-discard-v1.schema.json",
        mergeId:
            "https://avnionur.github.io/shepherd-typescript/schemas/scope-merge-v1.schema.json",
    },
    traceSchemas: {
        ...SCOPE_PROTOCOL_V2_CONTRACT.traceSchemas,
        childMerged: "shepherd.scope.child_merged.v1",
        discard: "shepherd.scope.discard.v1",
        merge: "shepherd.scope.merge.v1",
    },
} as const);

/** Immutable spawn/adopt/abandon/publish vocabulary mapping extension implemented by scope v4. */
export const SCOPE_PROTOCOL_V4_CONTRACT = deepFreeze({
    ...SCOPE_PROTOCOL_V3_CONTRACT,
    vocabulary: {
        statuses: ["pending", "completed"],
        terms: ["spawn", "adopt", "abandon", "publish"],
        version: 1,
    },
} as const);

/** Immutable scheduling, recovery, and orphan-classification extension implemented by scope v5. */
export const SCOPE_PROTOCOL_V5_CONTRACT = deepFreeze({
    ...SCOPE_PROTOCOL_V4_CONTRACT,
    recovery: {
        classifications: [
            "terminal",
            "cleanup_pending",
            "merge_pending",
            "fork_pending",
            "writer_expired",
            "writer_held",
            "idle",
        ],
        resumeKinds: ["fork", "merge", "discard", "claim"],
    },
    scheduling: {
        commandSuffixes: {
            create: "create",
            discard: "discard",
            emit: "emit",
            merge: "merge",
            writer: "writer",
        },
        decisions: ["merge", "discard"],
        maxDepth: 16,
        maxNodes: 256,
        maxParallel: 64,
        outcomes: ["merged", "discarded", "conflicted", "failed"],
        pathSeparator: "/",
    },
} as const);

/** Immutable checkpoint start-classification extension implemented by scope v6. */
export const SCOPE_PROTOCOL_V6_CONTRACT = deepFreeze({
    ...SCOPE_PROTOCOL_V5_CONTRACT,
    checkpoint: {
        ...SCOPE_PROTOCOL_V5_CONTRACT.checkpoint,
        startClassifications: {
            captureKinds: { "verified-copy": "quiescent_verified_copy" },
            values: ["atomic_snapshot", "quiescent_verified_copy", "reconstructed"],
        },
    },
} as const);

/** Immutable replay session, coupled checkpoint, rewind, replay, and analysis contract implemented by replay v1. */
export const REPLAY_PROTOCOL_V1_CONTRACT = deepFreeze({
    artifacts: {
        admissionSchema: "spec/schemas/replay-admission-v1.schema.json",
        checkpointSchema: "spec/schemas/replay-checkpoint-v1.schema.json",
        restoreSchema: "spec/schemas/replay-restore-v1.schema.json",
        sessionSchema: "spec/schemas/replay-session-v1.schema.json",
        stepSchema: "spec/schemas/replay-step-v1.schema.json",
        terminalSchema: "spec/schemas/replay-terminal-v1.schema.json",
    },
    cache: {
        statuses: ["hit", "not_observed"],
    },
    changes: ["task", "provider", "handlers"],
    checkpoint: {
        classifications: ["atomic", "reconstructive", "unavailable"],
        constituentKinds: [
            "trace_cut",
            "world",
            "provider_session",
            "process",
            "irreversible_effects",
        ],
        evidenceStatuses: ["verified", "reconstructive", "not_applicable", "unavailable"],
        reasons: {
            adapterFailure: "checkpoint adapter failed",
            boundaryWithoutCheckpoint: "step boundary has no retained checkpoint",
            processImageBound: "process image exceeds the configured bound",
            providerPrefixMismatch: "provider session holds a different context prefix",
            worldCapture: "world capture failed",
        },
    },
    compatibilityVersion: "shepherd.replay.v1",
    divergence: {
        causes: ["root", "propagated", "unexplained"],
        statuses: ["identical", "diverged", "source_only", "replay_only"],
    },
    effects: {
        approvalRequiredTiers: ["irreversible"],
        dispositions: ["materialized", "materialization_failed", "refused"],
        reasons: {
            missingPolicy: "no replay policy approves this effect",
            policyFailure: "replay policy failed",
        },
    },
    errors: {
        checkpointUnavailableCode: "REPLAY_CHECKPOINT_UNAVAILABLE",
        checkpointUnavailableMessage:
            "replay target has unavailable constituents and cannot be restored",
        compatibilityCode: "REPLAY_COMPATIBILITY_UNSUPPORTED",
        compatibilityMessage: "replay evidence uses an unsupported compatibility or record version",
        effectRefusedCode: "REPLAY_EFFECT_REFUSED",
        effectRefusedMessage: "replay suffix effect requires policy approval that was not granted",
        evidenceCode: "REPLAY_EVIDENCE_INVALID",
        evidenceMessage: "replay evidence is absent, malformed, or inconsistent",
        interruptedCode: "REPLAY_SESSION_INTERRUPTED",
        interruptedMessage:
            "replay session is not terminal and is never resumed in place; replay from a checkpoint or step boundary",
        leaseConflictCode: "REPLAY_LEASE_CONFLICT",
        leaseConflictMessage: "replay session lease is held by another unexpired writer",
        leaseFencedCode: "REPLAY_LEASE_FENCED",
        leaseFencedMessage: "replay session lease is released, expired, superseded, or unknown",
        materializationUncertainCode: "REPLAY_MATERIALIZATION_UNCERTAIN",
        materializationUncertainMessage:
            "replay effect was admitted without a retained step; manual recovery is required",
        prefixMismatchCode: "REPLAY_PREFIX_MISMATCH",
        prefixMismatchMessage: "replayed prefix differs from the recorded prefix",
        restoreCode: "REPLAY_RESTORE_FAILED",
        restoreMessage: "replay restoration target or constituent failed verification",
        stepFailureCode: "REPLAY_STEP_FAILED",
        stepFailureMessage: "replay session step failed",
    },
    identity: {
        checkpointIdPrefix: "replay-checkpoint:sha256:",
        commandAppendIntentKind: "replay_command",
        contextPrefixIdPrefix: "replay-context:sha256:",
        cutIdPrefix: "replay-cut:sha256:",
        frontierIdPrefix: "replay-frontier:sha256:",
        prefixIdPrefix: "replay-prefix:sha256:",
        promptIdPrefix: "replay-prompt:sha256:",
        responseIdPrefix: "replay-response:sha256:",
        sessionIdPrefix: "replay-session:sha256:",
        stepIdPrefix: "replay-step:sha256:",
    },
    lease: {
        leaseMilliseconds: 30_000,
        renewalMilliseconds: 10_000,
    },
    limits: {
        maxDependencies: 64,
        maxErrorMessageBytes: 4096,
        maxProcessImageBytes: 16_777_216,
        maxProcesses: 8,
        maxReasonBytes: 4096,
        maxSteps: 4096,
        maxWorldEntries: 65_536,
        maxWorlds: 16,
    },
    modes: ["root", "rewind", "replay"],
    processes: {
        backends: ["cooperative", "transparent"],
        cooperative: {
            maxLineBytes: 22_369_824,
            messageTypes: {
                checkpoint: "checkpoint",
                error: "error",
                image: "image",
                request: "request",
                response: "response",
                restore: "restore",
                restored: "restored",
            },
            protocolVersion: 1,
            spawnFailedReason: "cooperative process could not be started",
            timeoutMilliseconds: 30_000,
        },
        transparent: {
            captureUnsupportedReason:
                "transparent process image capture is not supported by replay protocol v1",
            checkArguments: ["check"],
            checkFailedReason: "criu check failed",
            executable: "criu",
            executableUnavailableReason: "criu executable is unavailable",
            platformUnsupportedReason:
                "transparent process checkpointing is unsupported on this platform",
            platforms: ["linux"],
            probeTimeoutMilliseconds: 30_000,
        },
    },
    recordVersion: 1,
    recovery: {
        classifications: ["terminal", "running", "interrupted", "materialization_uncertain"],
    },
    schemas: {
        admissionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/replay-admission-v1.schema.json",
        checkpointId:
            "https://avnionur.github.io/shepherd-typescript/schemas/replay-checkpoint-v1.schema.json",
        restoreId:
            "https://avnionur.github.io/shepherd-typescript/schemas/replay-restore-v1.schema.json",
        sessionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/replay-session-v1.schema.json",
        stepId: "https://avnionur.github.io/shepherd-typescript/schemas/replay-step-v1.schema.json",
        terminalId:
            "https://avnionur.github.io/shepherd-typescript/schemas/replay-terminal-v1.schema.json",
    },
    steps: {
        kinds: ["provider", "effect"],
        sources: ["live", "recorded"],
    },
    terminal: {
        statuses: ["finished", "failed", "cancelled", "rewound"],
    },
    traceSchemas: {
        admission: "shepherd.replay.admission.v1",
        checkpoint: "shepherd.replay.checkpoint.v1",
        restore: "shepherd.replay.restore.v1",
        session: "shepherd.replay.session.v1",
        step: "shepherd.replay.step.v1",
        terminal: "shepherd.replay.terminal.v1",
    },
} as const);

/** Immutable live subscription, supervised interception, approval, and context contract implemented by supervision v1. */
export const SUPERVISION_PROTOCOL_V1_CONTRACT = deepFreeze({
    approval: {
        defaultWaitMilliseconds: 300_000,
        gates: ["interceptor_pause", "irreversible_frontier"],
        maxWaitMilliseconds: 3_600_000,
        phases: ["requested", "resolved"],
        pollIntervalMilliseconds: 10,
        requiredTiers: ["irreversible"],
        verdicts: ["approved", "rejected", "expired"],
    },
    artifacts: {
        admissionSchema: "spec/schemas/supervision-admission-v1.schema.json",
        approvalSchema: "spec/schemas/supervision-approval-v1.schema.json",
        contextSchema: "spec/schemas/supervision-context-v1.schema.json",
        cursorSchema: "spec/schemas/supervision-cursor-v1.schema.json",
        decisionSchema: "spec/schemas/supervision-decision-v1.schema.json",
        dispatchSchema: "spec/schemas/supervision-dispatch-v1.schema.json",
        resolutionSchema: "spec/schemas/supervision-resolution-v1.schema.json",
    },
    compatibilityVersion: "shepherd.supervision.v1",
    errors: {
        approvalConflictCode: "SUPERVISION_APPROVAL_CONFLICT",
        approvalConflictMessage: "supervised dispatch has no matching pending approval request",
        cursorConflictCode: "SUPERVISION_CURSOR_CONFLICT",
        cursorConflictMessage:
            "subscription cursor regresses, passes delivered records, or names different owners",
        evidenceCode: "SUPERVISION_EVIDENCE_INVALID",
        evidenceMessage: "supervision evidence is absent, malformed, or inconsistent",
        leaseConflictCode: "SUPERVISION_LEASE_CONFLICT",
        leaseConflictMessage:
            "supervised dispatch decision lease is held by another unexpired dispatcher",
        leaseFencedCode: "SUPERVISION_LEASE_FENCED",
        leaseFencedMessage:
            "supervised dispatch decision lease is released, expired, superseded, or unknown",
        materializationUncertainCode: "SUPERVISION_MATERIALIZATION_UNCERTAIN",
        materializationUncertainMessage:
            "supervised effect was admitted without a retained resolution; manual recovery is required",
        overflowCode: "SUPERVISION_SUBSCRIPTION_OVERFLOW",
        overflowMessage: "subscription lag exceeds its declared overflow bound",
    },
    identity: {
        commandAppendIntentKind: "supervision_command",
        contextChannelIdPrefix: "supervision-context:sha256:",
        cursorIdPrefix: "supervision-cursor:sha256:",
        dispatchIdPrefix: "supervision-dispatch:sha256:",
    },
    interception: {
        decisionLeaseMilliseconds: 30_000,
        decisionSources: ["interceptor", "timeout", "failure"],
        decisions: ["allow", "deny", "replace", "pause"],
        failOpenForbiddenTiers: ["irreversible"],
        leaseRenewalMilliseconds: 10_000,
        maxInterceptors: 16,
        maxTimeoutMilliseconds: 3_600_000,
        timeoutPolicies: ["fail_open", "fail_closed"],
    },
    limits: {
        maxCitedRecords: 64,
        maxDataCanonicalBytes: 65_536,
        maxReasonBytes: 4096,
    },
    recordVersion: 1,
    recovery: {
        classifications: [
            "resolved",
            "materialization_uncertain",
            "resolution_pending",
            "approval_pending",
            "decision_pending",
        ],
    },
    resolution: {
        dispositions: ["materialized", "materialization_failed", "denied", "rejected", "cancelled"],
    },
    schemas: {
        admissionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-admission-v1.schema.json",
        approvalId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-approval-v1.schema.json",
        contextId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-context-v1.schema.json",
        cursorId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-cursor-v1.schema.json",
        decisionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-decision-v1.schema.json",
        dispatchId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-dispatch-v1.schema.json",
        resolutionId:
            "https://avnionur.github.io/shepherd-typescript/schemas/supervision-resolution-v1.schema.json",
    },
    subscriptions: {
        cursorVersion: 1,
        defaultBufferCapacity: 64,
        maxBufferCapacity: 4096,
        maxOwners: 64,
        overflowPolicies: ["backpressure", "fail"],
        pollIntervalMilliseconds: 10,
        startPositions: ["origin", "head"],
    },
    traceSchemas: {
        admission: "shepherd.supervision.admission.v1",
        approval: "shepherd.supervision.approval.v1",
        context: "shepherd.supervision.context.v1",
        decision: "shepherd.supervision.decision.v1",
        dispatch: "shepherd.supervision.dispatch.v1",
        resolution: "shepherd.supervision.resolution.v1",
    },
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

/** Immutable durable task-world capture extension implemented by workspace protocol v8. */
export const WORKSPACE_PROTOCOL_V8_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V7_CONTRACT,
    worldTaskCapture: {
        captureSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-v1.schema.json",
        captureSchemaPath: "spec/schemas/world-capture-v1.schema.json",
        maxCaptureIdBytes: 256,
        maxTextBytes: 16_777_216,
        outputIdPrefix: "world-output:sha256:",
        statuses: ["retained"],
        version: 8,
    },
} as const);

/** Immutable capture-journal extension implemented by workspace protocol v9. */
export const WORKSPACE_PROTOCOL_V9_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V8_CONTRACT,
    worldTaskCapture: {
        ...WORKSPACE_PROTOCOL_V8_CONTRACT.worldTaskCapture,
        journalPhases: ["prepared", "forked", "executing", "captured"],
        journalSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v1.schema.json",
        journalSchemaPath: "spec/schemas/world-capture-journal-v1.schema.json",
        journalVersion: 9,
    },
} as const);

/** Immutable deterministic task-world recovery extension implemented by workspace protocol v10. */
export const WORKSPACE_PROTOCOL_V10_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V9_CONTRACT,
    worldTaskCapture: {
        ...WORKSPACE_PROTOCOL_V9_CONTRACT.worldTaskCapture,
        custodyIdentityKind: "task-world-custody",
    },
} as const);

/** Immutable read-only changeset-inspection extension implemented by workspace protocol v11. */
export const WORKSPACE_PROTOCOL_V11_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V10_CONTRACT,
    changesetInspection: {
        defaultPageSize: 100,
        defaultPreviewBytes: 65_536,
        defaultPreviewLines: 200,
        defaultReadBytes: 65_536,
        encoding: "utf-8",
        gitlinkEntryKind: "gitlink",
        gitlinkMode: "160000",
        maxPageSize: 1_000,
        maxPreviewBytes: 1_048_576,
        maxPreviewLines: 1_000,
        maxReadBytes: 1_048_576,
        maxDerivedMoveCandidates: 10_000,
        maxVerificationConcurrency: 2,
        moveKinds: ["rename", "copy"],
        previewClassifications: ["text", "binary"],
        symlinkMode: "120000",
        version: 11,
    },
} as const);

/** Immutable exact settlement-admission extension implemented by workspace protocol v12. */
export const WORKSPACE_PROTOCOL_V12_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V11_CONTRACT,
    settlement: {
        actions: ["select", "discard"],
        errors: {
            conflictCode: "RETAINED_WORLD_SETTLEMENT_CONFLICT",
            conflictMessage: "retained world settlement conflicts with an existing decision",
            invalidCode: "RETAINED_WORLD_SETTLEMENT_INVALID",
            invalidMessage: "retained world settlement request is invalid or inconsistent",
        },
        requestIdPrefix: "world-settlement:sha256:",
        states: ["prepared", "applying", "selected", "discarded"],
        version: 12,
    },
} as const);

/** Immutable settlement operation/receipt codec extension implemented by workspace protocol v13. */
export const WORKSPACE_PROTOCOL_V13_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V12_CONTRACT,
    settlement: {
        ...WORKSPACE_PROTOCOL_V12_CONTRACT.settlement,
        operationIdPrefix: "world-settlement-operation:sha256:",
        operationVersion: 1,
        receiptVersion: 1,
        version: 12,
    },
} as const);

/** Immutable journaled selection-publication extension implemented by workspace protocol v14. */
export const WORKSPACE_PROTOCOL_V14_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V13_CONTRACT,
    selectionPublication: {
        atomicityKinds: ["journaled-path-set"],
        descriptorFormat: "shepherd.retained-world-selection-publication",
        errors: {
            basisMovedCode: "RETAINED_WORLD_SELECTION_BASIS_MOVED",
            basisMovedMessage: "retained world selection basis moved before publication",
            recoveryRequiredCode: "RETAINED_WORLD_SELECTION_RECOVERY_REQUIRED",
            recoveryRequiredMessage: "retained world selection requires exact recovery",
            unsupportedCode: "RETAINED_WORLD_SELECTION_UNSUPPORTED",
            unsupportedMessage: "retained world selection is unsupported by this filesystem",
        },
        maxPlanBytes: 2_097_152,
        maxReceiptBytes: 65_536,
        maxStepBytes: 131_072,
        maxSteps: 100_000,
        planFile: "plan.json",
        planIdPrefix: "world-selection-plan:sha256:",
        planVersion: 1,
        publicationFile: "published.json",
        publicationIdPrefix: "world-selection-publication:sha256:",
        publicationVersion: 1,
        publicationsDirectory: "selection-publications",
        schemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-selection-publication-v1.schema.json",
        schemaPath: "spec/schemas/retained-world-selection-publication-v1.schema.json",
        stagingDirectory: "selection-staging",
        stagingIdPrefix: "world-selection-staging:sha256:",
        stepIdPrefix: "world-selection-step:sha256:",
        stepStatuses: ["applied"],
        stepsDirectory: "steps",
        stepVersion: 1,
        version: 14,
    },
} as const);

/** Immutable dependency-ordered selection-schedule extension implemented by workspace protocol v15. */
export const WORKSPACE_PROTOCOL_V15_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V14_CONTRACT,
    selectionPublication: {
        ...WORKSPACE_PROTOCOL_V14_CONTRACT.selectionPublication,
        maxScheduleBytes: 1_048_576,
        schemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-selection-publication-v2.schema.json",
        schemaPath: "spec/schemas/retained-world-selection-publication-v2.schema.json",
        scheduleFile: "schedule.json",
        scheduleIdPrefix: "world-selection-schedule:sha256:",
        scheduleKinds: ["dependency-ordered-path-set"],
        scheduleVersion: 1,
        version: 15,
    },
} as const);

/** Immutable dependency-scheduled step/receipt extension implemented by workspace protocol v16. */
export const WORKSPACE_PROTOCOL_V16_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V15_CONTRACT,
    selectionPublication: {
        ...WORKSPACE_PROTOCOL_V15_CONTRACT.selectionPublication,
        schemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-selection-publication-v3.schema.json",
        schemaPath: "spec/schemas/retained-world-selection-publication-v3.schema.json",
        scheduledPublicationIdPrefix: "world-selection-scheduled-publication:sha256:",
        scheduledPublicationVersion: 1,
        scheduledStepIdPrefix: "world-selection-scheduled-step:sha256:",
        scheduledStepVersion: 1,
        version: 16,
    },
} as const);

/** Immutable execution-trace settlement-citation extension implemented by workspace protocol v17. */
export const WORKSPACE_PROTOCOL_V17_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V16_CONTRACT,
    settlement: {
        ...WORKSPACE_PROTOCOL_V16_CONTRACT.settlement,
        citationAppendIntentPrefix: "world-settlement-citation-append:",
        citationCutIdPrefix: "world-settlement-citation-cut:",
        citationSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-settlement-citation-v1.schema.json",
        citationSchemaPath: "spec/schemas/retained-world-settlement-citation-v1.schema.json",
        citationVersion: 1,
    },
} as const);

/** Immutable protected control-path policy implemented by workspace protocol v18. */
export const WORKSPACE_PROTOCOL_V18_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V17_CONTRACT,
    protectedPaths: {
        alternateNameSeparators: [":"],
        caseFold: true,
        errorCode: "WORKSPACE_PROTECTED_PATH",
        errorMessage: "workspace path targets protected control metadata",
        normalizationForm: "NFC",
        roots: [".vcscore"],
        trailingCharacters: [" ", "."],
        version: 18,
    },
} as const);

/** Immutable platform and fault-conformance policy implemented by workspace protocol v19. */
export const WORKSPACE_PROTOCOL_V19_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V18_CONTRACT,
    platformConformance: {
        caseCollisionPolicy: "portable-case-fold-rejection",
        faults: {
            classifications: [
                {
                    code: "WORKSPACE_CUSTODY_PERMISSION_DENIED",
                    message: "workspace custody lacks required filesystem permission",
                    name: "permission",
                },
                {
                    code: "WORKSPACE_CUSTODY_CAPACITY_EXHAUSTED",
                    message: "workspace custody storage capacity is exhausted",
                    name: "capacity",
                },
                {
                    code: "WORKSPACE_CUSTODY_CONCURRENT_MUTATION",
                    message: "workspace custody source changed during verification",
                    name: "concurrent-mutation",
                },
                {
                    code: "WORKSPACE_CUSTODY_INTERRUPTED",
                    message: "workspace custody operation was interrupted",
                    name: "interrupted",
                },
                {
                    code: "WORKSPACE_CUSTODY_UNSUPPORTED_METADATA",
                    message: "workspace custody source contains unsupported metadata",
                    name: "unsupported-metadata",
                },
                {
                    code: "WORKSPACE_CUSTODY_PLATFORM_UNSUPPORTED",
                    message: "workspace custody platform semantics are unsupported",
                    name: "platform-unsupported",
                },
                {
                    code: "WORKSPACE_CUSTODY_IO_ERROR",
                    message: "workspace custody filesystem operation failed",
                    name: "io",
                },
            ],
            metadataClassification: "unsupported-metadata",
            phases: [
                { name: "snapshot-source-inspection", recovery: "retry-safe" },
                { name: "snapshot-staging-write", recovery: "retry-safe" },
                { name: "snapshot-source-revalidation", recovery: "retry-safe" },
                { name: "snapshot-publication", recovery: "retry-safe" },
                { name: "snapshot-post-publication", recovery: "reopen-and-verify" },
                { name: "custody-capture-source-inspection", recovery: "retry-safe" },
                { name: "custody-capture-staging-write", recovery: "retry-safe" },
                { name: "custody-capture-source-revalidation", recovery: "retry-safe" },
                { name: "custody-capture-publication", recovery: "retry-safe" },
                { name: "custody-capture-post-publication", recovery: "reopen-and-verify" },
                { name: "custody-discard-cleanup", recovery: "reopen-and-verify" },
                { name: "git-materialization", recovery: "retry-safe" },
                { name: "git-basis-capture", recovery: "retry-safe" },
                { name: "git-basis-revalidation", recovery: "retry-safe" },
                { name: "git-custody-publication", recovery: "retry-safe" },
                { name: "git-post-publication", recovery: "retry-safe" },
                { name: "selection-before-write", recovery: "exact-recovery-required" },
                { name: "selection-after-write", recovery: "exact-recovery-required" },
                { name: "selection-post-publication", recovery: "reopen-and-verify" },
            ],
            platformClassification: "platform-unsupported",
        },
        git: {
            coreSymlinksFalse: "reject-worktree-placeholder",
            gitlinks: "retain-external-commit-citation",
            sparseIndex: "preserve-index-evidence",
        },
        metadataPolicy: "reject-unsupported-before-publication",
        metadataPathToken: "{path}",
        metadataProbeMaxBytes: 1_048_576,
        metadataProbeTimeoutMs: 30_000,
        metadataProbes: [
            {
                arguments: ["{path}"],
                executable: "xattr",
                kind: "resource-fork",
                matchPattern: "^(?:[^\\n:]+: )?com\\.apple\\.ResourceFork$",
                patternFlags: "mu",
                platform: "darwin",
                separateLineBreakPaths: true,
                symlinkArguments: ["-s", "{path}"],
            },
            {
                arguments: ["-lde", "{path}"],
                executable: "ls",
                kind: "acl",
                matchPattern: "^\\s*\\d+:",
                patternFlags: "mu",
                platform: "darwin",
                separateLineBreakPaths: true,
                symlinkArguments: ["-lde", "{path}"],
            },
            {
                arguments: ["{path}"],
                executable: "xattr",
                kind: "extended-attribute",
                matchPattern: "^(?!.*(?:^|: )com\\.apple\\.provenance$).+$",
                patternFlags: "mu",
                platform: "darwin",
                separateLineBreakPaths: true,
                symlinkArguments: ["-s", "{path}"],
            },
            {
                arguments: [
                    "--absolute-names",
                    "--no-dereference",
                    "-d",
                    "-m",
                    "^user\\.",
                    "{path}",
                ],
                executable: "getfattr",
                kind: "extended-attribute",
                matchPattern: "^[^#\\s][^=]*=",
                patternFlags: "mu",
                platform: "linux",
                separateLineBreakPaths: false,
                symlinkArguments: [
                    "--absolute-names",
                    "--no-dereference",
                    "-d",
                    "-m",
                    "^user\\.",
                    "{path}",
                ],
            },
            {
                arguments: ["--absolute-names", "--omit-header", "--physical", "{path}"],
                executable: "getfacl",
                kind: "acl",
                matchPattern: "^(?:default:|mask:|user:[^:]|group:[^:])",
                patternFlags: "mu",
                platform: "linux",
                separateLineBreakPaths: false,
                symlinkArguments: ["--absolute-names", "--omit-header", "--physical", "{path}"],
            },
            {
                arguments: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$args | ForEach-Object { Get-Item -LiteralPath $_ -Stream * -ErrorAction Stop } | Where-Object { $_.Stream -ne ':$DATA' -and $_.Stream -ne '::$DATA' } | ForEach-Object { $_.Stream }",
                    "{path}",
                ],
                executable: "powershell.exe",
                kind: "alternate-data-stream",
                matchPattern: "^.+$",
                patternFlags: "mu",
                platform: "win32",
                separateLineBreakPaths: false,
                symlinkArguments: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$args | ForEach-Object { Get-Item -LiteralPath $_ -Stream * -ErrorAction Stop } | Where-Object { $_.Stream -ne ':$DATA' -and $_.Stream -ne '::$DATA' } | ForEach-Object { $_.Stream }",
                    "{path}",
                ],
            },
            {
                arguments: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$args | ForEach-Object { $acl = Get-Acl -LiteralPath $_; if ($acl.AreAccessRulesProtected -or @($acl.Access | Where-Object { -not $_.IsInherited }).Count -gt 0) { $_ } }",
                    "{path}",
                ],
                executable: "powershell.exe",
                kind: "acl",
                matchPattern: "^.+$",
                patternFlags: "mu",
                platform: "win32",
                separateLineBreakPaths: false,
                symlinkArguments: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$args | ForEach-Object { $acl = Get-Acl -LiteralPath $_; if ($acl.AreAccessRulesProtected -or @($acl.Access | Where-Object { -not $_.IsInherited }).Count -gt 0) { $_ } }",
                    "{path}",
                ],
            },
        ],
        modePolicy: "preserve-portable-low-nine-bits",
        optimizedCarrierParity: "reference-suite-required",
        supportedPlatforms: ["darwin", "linux", "win32"],
        symlinkPolicy: "preserve-relative-target-or-reject",
        unsupportedMetadata: [
            "acl",
            "extended-attribute",
            "resource-fork",
            "alternate-data-stream",
        ],
        version: 19,
    },
} as const);

/** Immutable repository-aware binding extension implemented by workspace protocol v20. */
export const WORKSPACE_PROTOCOL_V20_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V19_CONTRACT,
    repositoryBindings: {
        errors: {
            invalidRepositoryCode: "WORKSPACE_REPOSITORY_BINDING_INVALID",
            invalidRepositoryMessage:
                "workspace repository binding root is not an exact supported Git worktree",
        },
        identityDirectory: "git-bindings",
        identityKind: "workspace-git-repository-binding",
        resourceType: "git-repository",
        version: 1,
    },
} as const);

/** Immutable explicit repository-grant extension implemented by workspace protocol v21. */
export const WORKSPACE_PROTOCOL_V21_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V20_CONTRACT,
    repositoryGrants: {
        artifactVersion: 1,
        artifacts: {
            grantPlanSchema: "spec/schemas/repository-grant-plan-v1.schema.json",
            taskGrantArtifactLockSchema: "spec/schemas/repository-task-grant-lock-v1.schema.json",
            taskGrantArtifactSchema: "spec/schemas/repository-task-grant-v1.schema.json",
        },
        atoms: ["read", "write"],
        compatibilityVersion: "shepherd.workspace.repository-grants.v1",
        enforcement: "advisory",
        operations: {
            readText: "read",
            writeText: "write",
        },
        planIdPrefix: "repository-grant-plan:sha256:",
        planVersion: 1,
        profiles: [
            { atoms: ["read"], name: "read-only" },
            { atoms: ["read", "write"], name: "read-write" },
        ],
        schemas: {
            grantPlanId:
                "https://avnionur.github.io/shepherd-typescript/schemas/repository-grant-plan-v1.schema.json",
            taskGrantArtifactId:
                "https://avnionur.github.io/shepherd-typescript/schemas/repository-task-grant-v1.schema.json",
            taskGrantArtifactLockId:
                "https://avnionur.github.io/shepherd-typescript/schemas/repository-task-grant-lock-v1.schema.json",
        },
        taskGrantIdPrefix: "task-grant:sha256:",
    },
    worldTaskCapture: {
        ...WORKSPACE_PROTOCOL_V20_CONTRACT.worldTaskCapture,
        journalReaders: [
            {
                schemaId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v1.schema.json",
                version: 9,
            },
            {
                schemaId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v2.schema.json",
                version: 10,
            },
        ],
        journalSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v2.schema.json",
        journalSchemaPath: "spec/schemas/world-capture-journal-v2.schema.json",
        journalVersion: 10,
    },
} as const);

/** Immutable placement-resolution extension implemented by workspace protocol v22. */
export const WORKSPACE_PROTOCOL_V22_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V21_CONTRACT,
    repositoryGrants: {
        ...WORKSPACE_PROTOCOL_V21_CONTRACT.repositoryGrants,
        journalVersion: 10,
        journalVersions: [10, 11],
    },
    placements: {
        artifactVersion: 1,
        artifacts: {
            platformEvidenceSchema: "spec/schemas/placement-platform-evidence-v1.schema.json",
            resolutionSchema: "spec/schemas/placement-resolution-v1.schema.json",
        },
        compatibilityVersion: "shepherd.workspace.placements.v1",
        enforcement: "advisory",
        journalVersion: 11,
        journalVersions: [11],
        platform: {
            environments: ["native", "wsl", "unsupported"],
            evidenceIdPrefix: "placement-platform:sha256:",
            families: ["macos", "linux", "windows", "unsupported"],
            nativeEnvironment: "native",
            nodePlatforms: [
                { family: "macos", name: "darwin" },
                { family: "linux", name: "linux" },
                { family: "windows", name: "win32" },
            ],
            unsupportedEnvironment: "unsupported",
            unsupportedFamily: "unsupported",
            version: 1,
            wslEnvironment: "wsl",
            wslEnvironmentVariables: ["WSL_DISTRO_NAME", "WSL_INTEROP"],
            wslFamily: "windows",
            wslNodePlatform: "linux",
            wslReleasePattern: "microsoft",
        },
        reasons: ["requested-advisory", "auto-fallback-unavailable", "explicit-jail-unavailable"],
        requests: ["advisory", "auto", "jail"],
        resolutionIdPrefix: "placement-resolution:sha256:",
        resolvedPlacements: ["advisory"],
        rules: [
            {
                reason: "requested-advisory",
                request: "advisory",
                resolved: "advisory",
                status: "resolved",
                supported: true,
            },
            {
                reason: "auto-fallback-unavailable",
                request: "auto",
                resolved: "advisory",
                status: "resolved",
                supported: true,
            },
            {
                reason: "explicit-jail-unavailable",
                request: "jail",
                resolved: null,
                status: "refused",
                supported: false,
            },
        ],
        schemas: {
            platformEvidenceId:
                "https://avnionur.github.io/shepherd-typescript/schemas/placement-platform-evidence-v1.schema.json",
            resolutionId:
                "https://avnionur.github.io/shepherd-typescript/schemas/placement-resolution-v1.schema.json",
        },
        statuses: ["resolved", "refused"],
    },
    worldTaskCapture: {
        ...WORKSPACE_PROTOCOL_V21_CONTRACT.worldTaskCapture,
        journalReaders: [
            ...WORKSPACE_PROTOCOL_V21_CONTRACT.worldTaskCapture.journalReaders,
            {
                schemaId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v3.schema.json",
                version: 11,
            },
        ],
        journalSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v3.schema.json",
        journalSchemaPath: "spec/schemas/world-capture-journal-v3.schema.json",
        journalVersion: 11,
        ordinaryJournalVersion: 9,
    },
} as const);

/** Immutable native-jail backend probe extension implemented by workspace protocol v23. */
export const WORKSPACE_PROTOCOL_V23_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V22_CONTRACT,
    placements: {
        ...WORKSPACE_PROTOCOL_V22_CONTRACT.placements,
        journalVersions: [11, 12],
        nativeJails: {
            artifacts: {
                backendSchema: "spec/schemas/native-jail-backend-v1.schema.json",
                commandSchema: "spec/schemas/native-jail-command-v1.schema.json",
                planSchema: "spec/schemas/native-jail-plan-v1.schema.json",
                probeSchema: "spec/schemas/native-jail-probe-v1.schema.json",
                processSchema: "spec/schemas/native-jail-process-v1.schema.json",
                resolutionSchema: "spec/schemas/native-jail-resolution-v1.schema.json",
            },
            backends: [
                {
                    environments: ["native"],
                    executable: "/usr/bin/sandbox-exec",
                    family: "macos",
                    name: "seatbelt",
                    nodePlatforms: ["darwin"],
                    profileArgument: "-p",
                },
                {
                    environments: ["native", "wsl"],
                    executable: null,
                    family: "linux",
                    name: "landlock",
                    nodePlatforms: ["linux"],
                    profileArgument: null,
                },
            ],
            compatibilityVersion: "shepherd.workspace.native-jails.v1",
            compilerArguments: ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror"],
            compilerExecutables: ["/usr/bin/cc", "/usr/bin/clang", "/usr/bin/gcc"],
            compilerOutputArgument: "-o",
            commandIdPrefix: "native-jail-command:sha256:",
            commandVersion: 1,
            descriptorIdPrefix: "native-jail-backend:sha256:",
            descriptorVersion: 1,
            enforcement: "native-syscall-deny",
            journalVersion: 12,
            journalVersions: [12],
            maxArgumentBytes: 65_536,
            maxArguments: 256,
            maxEnvironmentEntries: 128,
            maxEnvironmentValueBytes: 16_384,
            maxOutputBytes: 1_048_576,
            maxTimeoutMilliseconds: 3_600_000,
            planIdPrefix: "native-jail-plan:sha256:",
            planVersion: 1,
            placementReasonRoles: {
                auto: "auto-selected-native-jail",
                explicit: "requested-native-jail",
            },
            placementReasons: ["requested-native-jail", "auto-selected-native-jail"],
            placementStatus: "resolved",
            placementVersion: 1,
            probeIdPrefix: "native-jail-probe:sha256:",
            probeReasonRoles: {
                deniedWriteFailed: "native-denial-failed",
                executableUnavailable: "backend-executable-unavailable",
                helperCompilerUnavailable: "helper-compiler-unavailable",
                helperIntegrityFailed: "helper-integrity-failed",
                grantedWriteFailed: "native-write-failed",
                platformUnsupported: "platform-unsupported",
                probeError: "native-probe-error",
                succeeded: "probe-succeeded",
            },
            probeReasons: [
                "probe-succeeded",
                "platform-unsupported",
                "backend-executable-unavailable",
                "helper-compiler-unavailable",
                "helper-integrity-failed",
                "native-denial-failed",
                "native-write-failed",
                "native-probe-error",
            ],
            probeStatuses: ["available", "unavailable"],
            probeVersion: 1,
            process: {
                killSignal: "SIGKILL",
                launchIdPrefix: "native-jail-launch:sha256:",
                quiescenceAttempts: 20,
                quiescenceDelayMilliseconds: 10,
                quiescenceStatuses: ["proven", "uncertain"],
                quiescenceStatusRoles: { proven: "proven", uncertain: "uncertain" },
                receiptIdPrefix: "native-jail-receipt:sha256:",
                receiptVersion: 1,
                startIdPrefix: "native-jail-start:sha256:",
                statusRoles: {
                    cancelled: "cancelled",
                    exited: "exited",
                    launchFailed: "launch-failed",
                    outputLimit: "output-limit",
                    quiescenceUncertain: "quiescence-uncertain",
                    timedOut: "timed-out",
                },
                statuses: [
                    "exited",
                    "cancelled",
                    "timed-out",
                    "output-limit",
                    "launch-failed",
                    "quiescence-uncertain",
                ],
            },
            resolutionIdPrefix: "native-jail-resolution:sha256:",
            resolvedPlacement: "jail",
            schemas: {
                backendId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-backend-v1.schema.json",
                commandId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-command-v1.schema.json",
                planId: "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-plan-v1.schema.json",
                probeId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-probe-v1.schema.json",
                processId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-process-v1.schema.json",
                resolutionId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/native-jail-resolution-v1.schema.json",
            },
            temporaryDirectoryPrefix: "shepherd-native-jail-probe-",
        },
    },
    worldExecution: {
        ...WORKSPACE_PROTOCOL_V22_CONTRACT.worldExecution,
        enforcementKinds: ["advisory", "native-syscall-deny"],
    },
    repositoryGrants: {
        ...WORKSPACE_PROTOCOL_V22_CONTRACT.repositoryGrants,
        journalVersions: [10, 11, 12],
    },
    worldTaskCapture: {
        ...WORKSPACE_PROTOCOL_V22_CONTRACT.worldTaskCapture,
        journalReaders: [
            ...WORKSPACE_PROTOCOL_V22_CONTRACT.worldTaskCapture.journalReaders,
            {
                schemaId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v4.schema.json",
                version: 12,
            },
        ],
        journalSchemaId:
            "https://avnionur.github.io/shepherd-typescript/schemas/world-capture-journal-v4.schema.json",
        journalSchemaPath: "spec/schemas/world-capture-journal-v4.schema.json",
        journalVersion: 12,
    },
} as const);

/** Immutable retained-world apply vocabulary extension implemented by workspace protocol v24. */
export const WORKSPACE_PROTOCOL_V24_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V23_CONTRACT,
    settlement: {
        ...WORKSPACE_PROTOCOL_V23_CONTRACT.settlement,
        actions: ["select", "discard", "apply"],
        application: {
            artifacts: {
                conflictSchema: "spec/schemas/retained-world-application-conflict-v1.schema.json",
                planSchema: "spec/schemas/retained-world-application-plan-v1.schema.json",
                receiptSchema: "spec/schemas/retained-world-application-receipt-v1.schema.json",
            },
            caseFold: true,
            compatibilityVersion: "shepherd.workspace.retained-world-application.v1",
            conflictIdPrefix: "world-application-conflict:sha256:",
            conflictKinds: ["equal-path", "ancestor-descendant", "portable-alias"],
            conflictVersion: 1,
            errors: {
                conflictCode: "RETAINED_WORLD_APPLICATION_CONFLICT",
                conflictMessage: "retained world application changes overlap current user changes",
            },
            maxConflicts: 1_000,
            normalizationForm: "NFC",
            planIdPrefix: "world-application-plan:sha256:",
            planVersion: 1,
            reasonRoles: {
                disjoint: "path-disjoint",
                unmoved: "unmoved-parent",
            },
            reasons: ["unmoved-parent", "path-disjoint"],
            receiptVersion: 1,
            schemas: {
                conflictId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-application-conflict-v1.schema.json",
                planId: "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-application-plan-v1.schema.json",
                receiptId:
                    "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-application-receipt-v1.schema.json",
            },
            statuses: ["planned"],
        },
        states: ["prepared", "applying", "selected", "discarded", "applied"],
    },
} as const);

/** Immutable receipt-only release vocabulary extension implemented by workspace protocol v25. */
export const WORKSPACE_PROTOCOL_V25_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V24_CONTRACT,
    settlement: {
        ...WORKSPACE_PROTOCOL_V24_CONTRACT.settlement,
        actions: ["select", "discard", "apply", "release"],
        release: {
            artifacts: {
                receiptSchema: "spec/schemas/retained-world-release-receipt-v1.schema.json",
            },
            compatibilityVersion: "shepherd.workspace.retained-world-release.v1",
            receiptVersion: 1,
            schemaId:
                "https://avnionur.github.io/shepherd-typescript/schemas/retained-world-release-receipt-v1.schema.json",
        },
        states: ["prepared", "applying", "selected", "discarded", "applied", "released"],
    },
} as const);

/** Immutable optimized carrier-backend extension implemented by workspace protocol v26. */
export const WORKSPACE_PROTOCOL_V26_CONTRACT = deepFreeze({
    ...WORKSPACE_PROTOCOL_V25_CONTRACT,
    carrierBackends: {
        backends: ["copy", "clone", "overlay"],
        clone: {
            backend: "clone",
            helper: {
                compilerArguments: ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror"],
                compilerExecutables: ["/usr/bin/cc", "/usr/bin/clang"],
                compilerOutputArgument: "-o",
                executableName: "shepherd-clone-helper",
                platforms: ["darwin"],
                sourceName: "shepherd-clone-helper.c",
                temporaryDirectoryPrefix: "shepherd-clone-helper-",
            },
        },
        commandMaxBytes: 1048576,
        commandTimeoutMs: 60000,
        conformance: {
            reasonRoles: {
                available: "shared-suite-host",
                helperUnavailable: "clone-helper-unavailable",
                mountNotPermitted: "overlay-mount-not-permitted",
                platformUnsupported: "platform-unsupported",
                reflinkUnsupported: "reflink-unsupported",
            },
            reasons: [
                "shared-suite-host",
                "platform-unsupported",
                "clone-helper-unavailable",
                "reflink-unsupported",
                "overlay-mount-not-permitted",
            ],
            statusRoles: {
                conformant: "conformant",
                unavailable: "unavailable",
            },
            statuses: ["conformant", "unavailable"],
        },
        defaultBackend: "copy",
        errors: {
            unavailableCode: "WORLD_CARRIER_BACKEND_UNAVAILABLE",
            unavailableMessage: "world carrier backend is unavailable on this host",
        },
        overlay: {
            backend: "overlay",
            filesystemType: "overlay",
            mountArguments: ["-t", "overlay", "overlay", "-o", "{options}", "{target}"],
            mountExecutable: "/usr/bin/mount",
            mountInfoPath: "/proc/self/mountinfo",
            mountOptionSeparator: ",",
            mountOptions: "lowerdir={lower},upperdir={upper},workdir={work}",
            platforms: ["linux"],
            reservedPathCharacters: [",", ":", "\\"],
            tokens: {
                lower: "{lower}",
                options: "{options}",
                target: "{target}",
                upper: "{upper}",
                work: "{work}",
            },
            unmountArguments: ["{target}"],
            unmountExecutable: "/usr/bin/umount",
            upperDirectory: "upper",
            workDirectory: "work",
        },
        version: 26,
    },
} as const);
