/** Hash algorithms permitted for content-addressed protocol identities. */
export const SECURE_HASH_ALGORITHMS = ["sha256", "sha384", "sha512"] as const;

/** SQLite journal modes permitted by the trace-store durability contract. */
export const STORE_JOURNAL_MODES = ["WAL"] as const;

/** SQLite synchronization levels permitted by the trace-store durability contract. */
export const STORE_SYNCHRONOUS_LEVELS = ["FULL"] as const;

/** SQLite transaction modes permitted for serialized append planning. */
export const STORE_TRANSACTION_MODES = ["IMMEDIATE"] as const;

/** Ordered effect-handler selection policies supported by this runtime. */
export const EFFECT_HANDLER_SELECTIONS = ["last_matching"] as const;

/** Unhandled effect policies supported by this runtime. */
export const EFFECT_UNHANDLED_POLICIES = ["throw"] as const;

/** Provider kinds implemented by the current provider protocol. */
export const PROVIDER_KINDS = ["static"] as const;

/** One immutable historical trace-store migration contract. */
export type StoreMigrationConfig = {
    readonly firstOwnerOrdinal: number;
    readonly lastOwnerOrdinal: number;
    readonly version: number;
};

/** Readonly sequence containing at least one value. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/** Validated content-addressed blob-store configuration. */
export type BlobProtocolConfig = {
    /** Closed orphan-maintenance operation names. */
    readonly collectionModes: readonly string[];
    /** Non-destructive orphan-maintenance default. */
    readonly defaultCollectionMode: string;
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    readonly directorySuffix: string;
    readonly fanoutCharacters: number;
    readonly fsync: true;
    readonly hexLength: number;
    readonly idPrefix: string;
    readonly receiptVersion: number;
    /** Prefix reserved for unpublished temporary filesystem objects. */
    readonly temporaryFilePrefix: string;
};

/** Validated trace-store protocol configuration. */
export type StoreProtocolConfig = {
    readonly appendIntentDigestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    readonly blobs: BlobProtocolConfig;
    readonly busyTimeoutMilliseconds: number;
    readonly defensive: true;
    readonly foreignKeys: true;
    readonly journalMode: (typeof STORE_JOURNAL_MODES)[number];
    readonly migrations: NonEmptyReadonlyArray<StoreMigrationConfig>;
    readonly schemaVersion: number;
    readonly synchronous: (typeof STORE_SYNCHRONOUS_LEVELS)[number];
    readonly transactionMode: (typeof STORE_TRANSACTION_MODES)[number];
};

/** Validated kernel protocol configuration. */
export type KernelProtocolConfig = {
    readonly abiVersion: string;
    readonly append: {
        readonly firstOwnerOrdinal: number;
        readonly lastOwnerOrdinal: number;
    };
    readonly artifacts: {
        readonly appendBatchDraftSchema: string;
        readonly recordBodySchema: string;
        readonly recordEnvelopeSchema: string;
        readonly recordValues: string;
        readonly recordViewSchema: string;
        readonly traceArchiveSchema: string;
    };
    readonly canonicalVersion: string;
    readonly interchange: {
        readonly blobEncoding: "base64";
        readonly format: string;
        readonly formatVersion: number;
    };
    readonly queries: {
        readonly closurePolicies: readonly string[];
        readonly cutAppendIntentPrefix: string;
        readonly cutSchemaRef: string;
        readonly defaultClosurePolicy: string;
        readonly defaultModeFilter: string;
        readonly defaultVisibilityProfile: string;
        readonly modeFilters: readonly string[];
        readonly visibilityProfiles: readonly string[];
        readonly witnessSchemaRef: string;
    };
    readonly recordKind: string;
    readonly recordModes: readonly string[];
    readonly rootWitness: {
        readonly body: Readonly<Record<string, unknown>>;
        readonly mode: string;
        readonly schemaRef: string;
        readonly witnessRef: string;
    };
    readonly schemas: {
        readonly appendBatchDraftId: string;
        readonly dialect: string;
        readonly recordBodyId: string;
        readonly recordEnvelopeId: string;
        readonly recordViewId: string;
        readonly traceArchiveId: string;
    };
    readonly store: StoreProtocolConfig;
};

/** Validated record-identifier configuration. */
export type RecordIdConfig = {
    readonly algorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    readonly hexLength: number;
    readonly prefix: string;
};

/** Configured execution-history projection contract. */
export type ExecutionHistoryProjectionConfig = {
    readonly activeRelationKinds: readonly string[];
    readonly executionSchemas: {
        readonly completed: string;
        readonly created: string;
        readonly failed: string;
        readonly started: string;
    };
    readonly modeRequirement: string;
    readonly payloadVisibilityProfiles: NonEmptyReadonlyArray<string>;
    readonly publishedRecordSchemaRef: string;
    readonly relationKinds: readonly string[];
    readonly relationSchemaRef: string;
};

/** Validated disposable projection configuration. */
export type ProjectionProtocolConfig = {
    readonly executionHistory: ExecutionHistoryProjectionConfig;
};

/** Validated provider-neutral and deterministic-provider configuration. */
export type ProviderProtocolConfig = {
    /** Closed provider-kind vocabulary. */
    readonly kinds: readonly string[];
    /** Deterministic static-provider contract. */
    readonly static: {
        /** Capabilities declared by every static provider. */
        readonly capabilities: {
            /** Whether the provider exposes streaming responses. */
            readonly streaming: boolean;
            /** Whether the provider returns structured values. */
            readonly structuredOutput: boolean;
            /** Whether the provider can invoke tools. */
            readonly tools: boolean;
        };
        /** Stable typed-error codes and messages. */
        readonly errors: {
            /** Cassette-exhaustion error code. */
            readonly exhaustedCode: string;
            /** Cassette-exhaustion error message. */
            readonly exhaustedMessage: string;
            /** Request-mismatch error code. */
            readonly mismatchCode: string;
            /** Request-mismatch error message. */
            readonly mismatchMessage: string;
        };
        /** Configured provider-kind discriminant. */
        readonly kind: (typeof PROVIDER_KINDS)[number];
    };
};

/** Validated task descriptor and artifact-lock protocol configuration. */
export type TaskProtocolConfig = {
    /** Wire version for exact task artifact locks. */
    readonly artifactLockVersion: number;
    /** Generated language-neutral task artifacts. */
    readonly artifacts: {
        /** Repository-relative task artifact-lock schema destination. */
        readonly artifactLockSchema: string;
        /** Repository-relative task descriptor schema destination. */
        readonly descriptorSchema: string;
    };
    /** Compatibility namespace included in task identity. */
    readonly compatibilityVersion: string;
    /** Wire version for canonical task descriptors. */
    readonly descriptorVersion: number;
    /** Hash algorithm used for task and schema identities. */
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    /** Prefix used for task artifact and schema digests. */
    readonly digestPrefix: string;
    /** Exact lowercase hexadecimal digest length. */
    readonly hexLength: number;
    /** SQLite durability and migration contract for task registration. */
    readonly registry: {
        /** Time SQLite waits for a competing registry writer. */
        readonly busyTimeoutMilliseconds: number;
        /** Default registry database target. */
        readonly defaultDatabasePath: string;
        /** Whether SQLite defensive mode is enabled. */
        readonly defensive: true;
        /** Whether SQLite foreign-key enforcement is enabled. */
        readonly foreignKeys: true;
        /** Configured durable SQLite journal mode. */
        readonly journalMode: (typeof STORE_JOURNAL_MODES)[number];
        /** Contiguous implemented registry migration versions. */
        readonly migrations: NonEmptyReadonlyArray<number>;
        /** Latest supported task-registry schema version. */
        readonly schemaVersion: number;
        /** Configured durable SQLite synchronization level. */
        readonly synchronous: (typeof STORE_SYNCHRONOUS_LEVELS)[number];
        /** Transaction mode used to serialize registrations. */
        readonly transactionMode: (typeof STORE_TRANSACTION_MODES)[number];
    };
    /** Published task schema identifiers. */
    readonly schemas: {
        /** Absolute task artifact-lock schema identifier. */
        readonly artifactLockId: string;
        /** Absolute task descriptor schema identifier. */
        readonly descriptorId: string;
    };
    /** Prefix used for stable logical task identifiers. */
    readonly taskIdPrefix: string;
};

/** Validated effect intent, outcome, identity, and schema configuration. */
export type EffectProtocolConfig = {
    /** Generated language-neutral effect schema destinations. */
    readonly artifacts: {
        /** Repository-relative effect intent schema destination. */
        readonly intentSchema: string;
        /** Repository-relative effect outcome schema destination. */
        readonly outcomeSchema: string;
    };
    /** Hash algorithm used to bind an outcome to its complete intent. */
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    /** Prefix applied to canonical intent digests. */
    readonly digestPrefix: string;
    /** Exact lowercase hexadecimal digest length. */
    readonly hexLength: number;
    /** Runtime policies for deterministic handler selection and missing handlers. */
    readonly handlers: {
        /** Configured deterministic handler precedence rule. */
        readonly selection: (typeof EFFECT_HANDLER_SELECTIONS)[number];
        /** Configured behavior when no exact handler matches. */
        readonly unhandled: (typeof EFFECT_UNHANDLED_POLICIES)[number];
    };
    /** Wire version for canonical effect intents. */
    readonly intentVersion: number;
    /** Wire version for canonical effect outcomes. */
    readonly outcomeVersion: number;
    /** Configured wire discriminants for the two effect phases. */
    readonly phases: {
        /** Wire value identifying an intent record. */
        readonly intent: string;
        /** Wire value identifying an outcome record. */
        readonly outcome: string;
    };
    /** Closed reversibility vocabulary ordered from strongest to weakest undo support. */
    readonly reversibilityTiers: readonly string[];
    /** Published effect schema identifiers. */
    readonly schemas: {
        /** Absolute effect intent schema identifier. */
        readonly intentId: string;
        /** Absolute effect outcome schema identifier. */
        readonly outcomeId: string;
    };
};

/** Validated executable reference-machine and proof-envelope configuration. */
export type FormalAssuranceProtocolConfig = {
    /** Conservative proof-envelope claim vocabulary and content identities. */
    readonly proofEnvelope: {
        /** Hash algorithm used for proof evidence and trace identities. */
        readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
        /** Prefix identifying content-addressed proof evidence. */
        readonly evidenceRefPrefix: string;
        /** Production surfaces explicitly excluded from formal coverage. */
        readonly excludedRuntimeSurfaces: readonly string[];
        /** Exact lowercase hexadecimal digest length. */
        readonly hexLength: number;
        /** Closed proof-profile vocabulary ordered from weakest upward. */
        readonly profiles: readonly string[];
        /** Prefix identifying content-addressed static programs. */
        readonly programRefPrefix: string;
        /** Profile emitted after executable Core-A validation. */
        readonly referenceValidatedProfile: string;
        /** Strength emitted after executable Core-A validation. */
        readonly referenceValidatedStrength: string;
        /** Default profile for evidence outside the reference boundary. */
        readonly runtimeOnlyProfile: string;
        /** Default strength for evidence outside the reference boundary. */
        readonly runtimeOnlyStrength: string;
        /** Stable proof-envelope wire version. */
        readonly schemaVersion: string;
        /** Closed proof-strength vocabulary ordered from weakest upward. */
        readonly strengths: readonly string[];
        /** Prefixes identifying complete and prefix trace digests. */
        readonly traceRefPrefixes: {
            /** Prefix for completed trace identities. */
            readonly completed: string;
            /** Prefix for incomplete trace-prefix identities. */
            readonly prefix: string;
        };
        /** Validator operation names for complete traces and valid live prefixes. */
        readonly validationOperations: {
            /** Operation identifying complete-trace validation. */
            readonly completed: string;
            /** Operation identifying live-prefix validation. */
            readonly prefix: string;
        };
        /** Executable validator authority named by reference envelopes. */
        readonly validator: string;
    };
    /** Single-root Core-A lifecycle vocabulary implemented by the reference machine. */
    readonly referenceMachine: {
        /** Handler answer actions supported by the Core-A boundary. */
        readonly actionKinds: readonly string[];
        /** Selection-closure reasons supported by the Core-A boundary. */
        readonly closureReasons: readonly string[];
        /** Continuation dispositions paired with handler answer actions. */
        readonly continuationDispositions: readonly string[];
        /** Prefix used to derive selected-path identities. */
        readonly pathPrefix: string;
        /** Stable implemented reference-machine profile version. */
        readonly profileVersion: string;
        /** Closed normalized lifecycle record discriminants. */
        readonly recordTypes: {
            /** Handler answer capture record discriminant. */
            readonly capture: string;
            /** Callable continuation-resume record discriminant. */
            readonly continuationResume: string;
            /** Effect declaration record discriminant. */
            readonly declaration: string;
            /** Callable continuation-return record discriminant. */
            readonly resumeReturn: string;
            /** Selected resumption-handle record discriminant. */
            readonly resumptionHandle: string;
            /** Handler-selection record discriminant. */
            readonly selection: string;
            /** Abandoned selected-path closure record discriminant. */
            readonly selectionClosed: string;
        };
        /** Source-record type accepted by callable continuation resumes. */
        readonly resumptionSourceRecordType: string;
        /** Only branch identity admitted by the single-root core. */
        readonly rootBranchRef: string;
    };
    /** Evidence contracts required before executable validation may emit theorem-backed claims. */
    readonly strongEvidence: {
        /** Validator-issued content-addressed Core-0H two-phase sidecar contract. */
        readonly core0hSidecar: {
            /** Prefix identifying a canonical sidecar manifest. */
            readonly contentRefPrefix: string;
            /** Prefix identifying one static handler body. */
            readonly handlerRefPrefix: string;
            /** Prefix identifying one deterministic handler phase. */
            readonly phaseRefPrefix: string;
            /** Stable Core-0H sidecar schema version. */
            readonly schemaVersion: string;
            /** Exact validator-issued sidecar manifests trusted by this release. */
            readonly trustedManifestRefs: readonly string[];
            /** Authority allowed to issue Core-0H sidecars. */
            readonly validator: string;
        };
        /** Static source-to-kernel lowering evidence contract. */
        readonly lowering: {
            /** Prefix identifying one canonical lowering manifest. */
            readonly contentRefPrefix: string;
            /** Pinned upstream generator that proves program and generated-trace agreement. */
            readonly oracle: {
                /** Repository-relative static-source generator path. */
                readonly path: string;
                /** Upstream repository containing the generator. */
                readonly repository: string;
                /** Exact upstream revision containing the generator and vectors. */
                readonly revision: string;
            };
            /** Stable lowering manifest schema version. */
            readonly schemaVersion: string;
            /** Prefix identifying a canonical source fragment. */
            readonly sourceRefPrefix: string;
            /** Exact validator-issued lowering manifests trusted by this release. */
            readonly trustedManifestRefs: readonly string[];
            /** Authority allowed to issue lowering evidence. */
            readonly validator: string;
        };
        /** Strong profile claims and their exact assumptions and theorem surfaces. */
        readonly profileClaims: readonly {
            /** Exact ordered fragment assumptions required by the profile. */
            readonly assumptions: readonly string[];
            /** Handler answer actions forbidden by the profile. */
            readonly forbiddenActionKinds: readonly string[];
            /** Configured proof-envelope profile. */
            readonly profile: string;
            /** Exactly-one capture action required by the profile, otherwise null. */
            readonly requiredCaptureActionKind: string | null;
            /** Whether a matching Core-0H sidecar is mandatory. */
            readonly requiresCore0hSidecar: boolean;
            /** Only proof strength admitted by this profile. */
            readonly strength: string;
            /** Exact ordered theorem identifiers required by this profile. */
            readonly theoremIds: readonly string[];
        }[];
        /** Pinned externally built theorem-surface metadata. */
        readonly theoremArtifact: {
            /** Named theorem-artifact authority. */
            readonly authority: string;
            /** External build command declared to check theorem names and signatures. */
            readonly buildGate: string;
            /** Theorem identifiers reserved for extension claims. */
            readonly extensionTheoremIds: readonly string[];
            /** Content identity of the pinned theorem metadata. */
            readonly metadataRef: string;
            /** Prefix identifying theorem-artifact metadata. */
            readonly metadataRefPrefix: string;
            /** Pinned external artifact revision label. */
            readonly revision: string;
            /** Stable theorem-artifact metadata schema version. */
            readonly schemaVersion: string;
            /** Complete declared base theorem surface. */
            readonly theoremIds: readonly string[];
        };
    };
};

/** Validated terminal run-outcome protocol configuration. */
export type RunProtocolConfig = {
    /** Closed artifact-content representation vocabulary. */
    readonly artifactContentTypes: readonly string[];
    /** Wire version for canonical run artifacts. */
    readonly artifactVersion: number;
    /** Generated language-neutral run artifacts. */
    readonly artifacts: {
        /** Repository-relative run-artifact schema destination. */
        readonly artifactSchema: string;
        /** Repository-relative continuation-descriptor schema destination. */
        readonly continuationDescriptorSchema: string;
        /** Repository-relative run-outcome schema destination. */
        readonly outcomeSchema: string;
        /** Repository-relative running-continuation lifecycle schema destination. */
        readonly runningLifecycleSchema: string;
        /** Repository-relative suspended-lifecycle schema destination. */
        readonly suspendedLifecycleSchema: string;
        /** Repository-relative aggregate run-usage schema destination. */
        readonly usageSchema: string;
        /** Repository-relative waiting-lifecycle schema destination. */
        readonly waitingLifecycleSchema: string;
    };
    /** Runtime run-control vocabulary and timer bounds. */
    readonly control: {
        /** Ordered supported budget metrics and exhaustion precedence. */
        readonly budgetMetrics: readonly string[];
        /** Stable reason used when a caller signal aborts. */
        readonly cancellationReason: string;
        /** Stable reason used when active control is disposed. */
        readonly disposalReason: string;
        /** Largest supported duration timer with room for the over-limit tick. */
        readonly maxTimerDurationMilliseconds: number;
        /** Closed run-control reason vocabulary. */
        readonly reasonTypes: readonly string[];
        /** Closed run-control lifecycle vocabulary. */
        readonly statuses: readonly string[];
    };
    /** Runtime task-execution failure normalization. */
    readonly execution: {
        /** Ordered constituent kinds classified by a continuation descriptor. */
        readonly continuationConstituentKinds: readonly string[];
        /** Ordered continuation evidence statuses from verified to unavailable. */
        readonly continuationEvidenceStatuses: readonly string[];
        /** Continuation evidence status that requires a durable receipt. */
        readonly continuationVerifiedStatus: string;
        /** Wire version for continuation descriptors. */
        readonly continuationVersion: number;
        /** Closed durable control-command vocabulary. */
        readonly controlCommandKinds: readonly string[];
        /** Schema identifying canonical durable control-command records. */
        readonly controlCommandSchemaId: string;
        /** Stable classifications and fallback descriptions for executor failures. */
        readonly errors: {
            /** Stable code for an expired or superseded invocation claim. */
            readonly claimFencedCode: string;
            /** Stable description for an expired or superseded invocation claim. */
            readonly claimFencedMessage: string;
            /** Stable code for losing an in-progress durable invocation claim. */
            readonly claimLostCode: string;
            /** Stable description for losing an in-progress durable invocation claim. */
            readonly claimLostMessage: string;
            /** Stable code for recovery requested without retained creation evidence. */
            readonly recoveryAbsentCode: string;
            /** Stable description for recovery requested without retained creation evidence. */
            readonly recoveryAbsentMessage: string;
            /** Stable code for incomplete evidence requiring explicit recovery authority. */
            readonly recoveryCommandRequiredCode: string;
            /** Stable description for incomplete evidence requiring explicit recovery authority. */
            readonly recoveryCommandRequiredMessage: string;
            /** Failure description used when a configured cost limit cannot be enforced. */
            readonly costUnavailableMessage: string;
            /** Failure classification used when provider cost is unavailable. */
            readonly costUnavailableType: string;
            /** Fallback description used when task output validation fails opaquely. */
            readonly outputValidationMessage: string;
            /** Failure classification used when provider output violates the task schema. */
            readonly outputValidationType: string;
            /** Fallback provider failure description. */
            readonly providerFailureMessage: string;
            /** Fallback provider failure classification. */
            readonly providerFailureType: string;
            /** Stable code for unsafe started-run recovery. */
            readonly recoveryStartedCode: string;
            /** Stable description for unsafe started-run recovery. */
            readonly recoveryStartedMessage: string;
        };
        /** Closed claim-guarded append result vocabulary. */
        readonly invocationClaimAppendStatuses: readonly string[];
        /** Duration granted to a first-writer claim before pre-start reclamation. */
        readonly invocationClaimLeaseMilliseconds: number;
        /** Closed first-writer invocation-claim result vocabulary. */
        readonly invocationClaimStatuses: readonly string[];
        /** Closed normative run-lifecycle vocabulary. */
        readonly lifecycleStatuses: readonly string[];
        /** Lifecycle status identifying active running continuation. */
        readonly lifecycleRunningStatus: string;
        /** Lifecycle status identifying acknowledged control-driven suspension. */
        readonly lifecycleSuspendedStatus: string;
        /** Lifecycle status identifying an immutable terminal outcome. */
        readonly lifecycleTerminalStatus: string;
        /** Allowed source-status and terminal-outcome pairs. */
        readonly lifecycleTerminalTransitions: readonly (readonly [string, string])[];
        /** Allowed non-terminal source and target lifecycle pairs. */
        readonly lifecycleTransitions: readonly (readonly [string, string])[];
        /** Wire version for normative lifecycle evidence. */
        readonly lifecycleVersion: number;
        /** Lifecycle status identifying prerequisite-driven waiting. */
        readonly lifecycleWaitingStatus: string;
        /** Closed durable execution recovery lifecycle. */
        readonly recoveryStatuses: readonly string[];
    };
    /** First valid artifact emission ordinal. */
    readonly firstArtifactOrdinal: number;
    /** Last valid artifact emission ordinal. */
    readonly lastArtifactOrdinal: number;
    /** Wire version for canonical terminal run outcomes. */
    readonly outcomeVersion: number;
    /** Published run schema identifiers. */
    readonly schemas: {
        /** Absolute run-artifact schema identifier. */
        readonly artifactId: string;
        /** Absolute continuation-descriptor schema identifier. */
        readonly continuationDescriptorId: string;
        /** Absolute run-outcome schema identifier. */
        readonly outcomeId: string;
        /** Absolute running-continuation lifecycle schema identifier. */
        readonly runningLifecycleId: string;
        /** Absolute suspended-lifecycle schema identifier. */
        readonly suspendedLifecycleId: string;
        /** Absolute aggregate run-usage schema identifier. */
        readonly usageId: string;
        /** Absolute waiting-lifecycle schema identifier. */
        readonly waitingLifecycleId: string;
    };
    /** Closed terminal status vocabulary. */
    readonly terminalStatuses: readonly string[];
    /** Wire version for canonical aggregate run usage. */
    readonly usageVersion: number;
};

/** Validated workspace initialization and adoption protocol configuration. */
export type WorkspaceProtocolConfig = {
    /** Closed baseline-adoption modes. */
    readonly adoptionModes: readonly string[];
    /** Stable public binding-validation error contract. */
    readonly bindingErrors: {
        /** Workspace-authority escape error code. */
        readonly authorityEscapeCode: string;
        /** Workspace-authority escape default message. */
        readonly authorityEscapeMessage: string;
        /** Duplicate logical-name error code. */
        readonly duplicateNameCode: string;
        /** Duplicate logical-name default message. */
        readonly duplicateNameMessage: string;
        /** Invalid logical-name error code. */
        readonly invalidNameCode: string;
        /** Invalid logical-name default message. */
        readonly invalidNameMessage: string;
        /** Invalid canonical-root error code. */
        readonly invalidRootCode: string;
        /** Invalid canonical-root default message. */
        readonly invalidRootMessage: string;
        /** Overlapping canonical-root error code. */
        readonly rootOverlapCode: string;
        /** Overlapping canonical-root default message. */
        readonly rootOverlapMessage: string;
    };
    /** Canonical identity domain for workspace bindings. */
    readonly bindingIdentityKind: string;
    /** Public canonical-binding protocol version. */
    readonly bindingVersion: number;
    /** Reference copy-carrier protocol configuration. */
    readonly carrier: {
        /** Configured carrier backend discriminant. */
        readonly backendKind: string;
        /** Regular-file blob identifier prefix. */
        readonly blobIdPrefix: string;
        /** Carrier directory beneath workspace control. */
        readonly carrierDirectory: string;
        /** Evidence classification for ordinary verified copy capture. */
        readonly captureKind: string;
        /** Mutable custody collection directory. */
        readonly custodiesDirectory: string;
        /** Closed custody descriptor filename. */
        readonly custodyDescriptorFile: string;
        /** Mutable custody identifier prefix. */
        readonly custodyIdPrefix: string;
        /** Closed descriptor format. */
        readonly descriptorFormat: string;
        /** Closed descriptor version. */
        readonly descriptorVersion: number;
        /** Suffix for exact discard decision descriptors. */
        readonly discardDescriptorSuffix: string;
        /** Closed completed discard decision status. */
        readonly discardStatus: string;
        /** Discard decision collection directory. */
        readonly discardedDirectory: string;
        /** Supported manifest entry discriminants. */
        readonly entryKinds: readonly string[];
        /** Stable carrier error contracts. */
        readonly errors: {
            readonly conflictCode: string;
            readonly conflictMessage: string;
            readonly controlCode: string;
            readonly controlMessage: string;
            readonly unsupportedCode: string;
            readonly unsupportedMessage: string;
        };
        /** Canonical manifest version. */
        readonly manifestVersion: number;
        /** Immutable revision collection directory. */
        readonly revisionsDirectory: string;
        /** Closed revision descriptor filename. */
        readonly revisionDescriptorFile: string;
        /** Immutable revision identifier prefix. */
        readonly revisionIdPrefix: string;
        /** Private publication staging directory. */
        readonly stagingDirectory: string;
        /** World-content identifier prefix. */
        readonly worldContentIdPrefix: string;
        /** Managed tree directory within one receipt. */
        readonly worldDirectory: string;
    };
    /** Pure world-changeset protocol configuration. */
    readonly changesets: {
        readonly errors: {
            readonly invalidCode: string;
            readonly invalidMessage: string;
            readonly limitCode: string;
            readonly limitMessage: string;
        };
        readonly idPrefix: string;
        readonly maxAggregateReferencedBytes: number;
        readonly maxChanges: number;
        readonly maxManifestEntries: number;
        readonly maxManifestRecordBytes: number;
        readonly maxPathBytes: number;
        readonly maxRecordBytes: number;
        readonly maxSingleBlobBytes: number;
        readonly maxSymlinkTargetBytes: number;
        readonly operations: readonly string[];
        readonly version: number;
    };
    /** Workspace-local protected control directory name. */
    readonly controlDirectory: string;
    /** Default baseline-adoption mode. */
    readonly defaultAdoptionMode: string;
    /** Whether initialization creates a Git repository when none contains the workspace. */
    readonly defaultInitializeGit: boolean;
    /** Secure digest algorithm for worktree baseline identity. */
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    /** Stable public workspace error contract. */
    readonly errors: {
        /** Conflicting initialization error code. */
        readonly conflictCode: string;
        /** Conflicting initialization default message. */
        readonly conflictMessage: string;
        /** Invalid control state error code. */
        readonly controlCode: string;
        /** Invalid control state default message. */
        readonly controlMessage: string;
    };
    /** Workspace-control manifest format name. */
    readonly format: string;
    /** Workspace-control manifest format version. */
    readonly formatVersion: number;
    /** Configured Git executable. */
    readonly gitExecutable: string;
    /** Git-aware retained-output custody protocol configuration. */
    readonly gitCustody: {
        readonly archiveExecutable: string;
        readonly basisIdPrefix: string;
        readonly descriptorFile: string;
        readonly descriptorFormat: string;
        readonly descriptorVersion: number;
        readonly errors: {
            readonly baselineUnavailableCode: string;
            readonly baselineUnavailableMessage: string;
            readonly controlCode: string;
            readonly controlMessage: string;
            readonly movementCode: string;
            readonly movementMessage: string;
            readonly unsupportedCode: string;
            readonly unsupportedMessage: string;
        };
        readonly headKinds: readonly string[];
        readonly identityFile: string;
        readonly identityFormat: string;
        readonly indexIdPrefix: string;
        readonly indexReceiptFile: string;
        readonly maxCommandBytes: number;
        readonly objectPackFile: string;
        readonly objectPackIdPrefix: string;
        readonly objectFormats: readonly string[];
        readonly repositoryIdPrefix: string;
        readonly repositoryIdentityFile: string;
        readonly repositoryLockAttempts: number;
        readonly repositoryLockDelayMs: number;
        readonly repositoryLockPrefix: string;
        readonly stagingDirectory: string;
        readonly version: number;
        readonly worktreeIdPrefix: string;
    };
    /** Prefix identifying an adopted Git HEAD baseline. */
    readonly gitHeadRefPrefix: string;
    /** Git administrative entry excluded from worktree content identity. */
    readonly gitMetadataName: string;
    /** Hexadecimal digest length for worktree baseline identity. */
    readonly hexLength: number;
    /** Workspace-control manifest filename. */
    readonly manifestFile: string;
    /** Prefix identifying an adopted worktree baseline. */
    readonly worktreeRefPrefix: string;
    /** Parent-linked task-world capture protocol configuration. */
    readonly worldCapture: {
        /** Maximum verified immutable revision ancestry depth. */
        readonly maxRevisionDepth: number;
        /** Public workspace capture protocol version. */
        readonly version: number;
    };
    /** Authenticated retained-world runner protocol configuration. */
    readonly worldExecution: {
        /** Closed initial enforcement classifications. */
        readonly enforcementKinds: readonly string[];
        /** Maximum UTF-8 byte length of a stable runner identity. */
        readonly maxRunnerIdBytes: number;
        /** Public retained-world runner protocol version. */
        readonly runnerVersion: number;
    };
    /** Durable retained-world task-capture protocol configuration. */
    readonly worldTaskCapture: {
        /** Schema identifier for one retained world-capture record. */
        readonly captureSchemaId: string;
        /** Repository-relative generated capture-schema path. */
        readonly captureSchemaPath: string;
        /** Ordered durable pre-terminal capture-journal phases. */
        readonly journalPhases: readonly string[];
        /** Schema identifier for durable capture-journal records. */
        readonly journalSchemaId: string;
        /** Repository-relative generated journal-schema path. */
        readonly journalSchemaPath: string;
        /** Public capture-journal protocol version. */
        readonly journalVersion: number;
        /** Maximum UTF-8 byte length of one capture correlation identity. */
        readonly maxCaptureIdBytes: number;
        /** Maximum text bytes accepted by one capability operation. */
        readonly maxTextBytes: number;
        /** Content-addressed retained-output identity prefix. */
        readonly outputIdPrefix: string;
        /** Closed retained-output status vocabulary. */
        readonly statuses: readonly string[];
        /** Public durable task-world capture protocol version. */
        readonly version: number;
    };
};

/** Complete validated language-neutral protocol configuration. */
export type ProtocolConfig = {
    readonly effects: EffectProtocolConfig;
    readonly formalAssurance: FormalAssuranceProtocolConfig;
    readonly kernel: KernelProtocolConfig;
    readonly projections: ProjectionProtocolConfig;
    readonly providers: ProviderProtocolConfig;
    readonly recordId: RecordIdConfig;
    readonly runs: RunProtocolConfig;
    readonly tasks: TaskProtocolConfig;
    readonly workspaces: WorkspaceProtocolConfig;
};
