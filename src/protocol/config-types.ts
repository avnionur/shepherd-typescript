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
    /** Authenticated read-only world-changeset inspection configuration. */
    readonly changesetInspection: {
        /** Default number of canonical changes returned by one page. */
        readonly defaultPageSize: number;
        /** Default byte bound for text previews. */
        readonly defaultPreviewBytes: number;
        /** Default line bound for text previews. */
        readonly defaultPreviewLines: number;
        /** Default byte bound for retained content reads. */
        readonly defaultReadBytes: number;
        /** Configured text-preview decoding label. */
        readonly encoding: string;
        /** Git-aware external commit-citation node discriminant. */
        readonly gitlinkEntryKind: string;
        /** Canonical Git index mode for Gitlinks. */
        readonly gitlinkMode: string;
        /** Maximum number of canonical changes returned by one page. */
        readonly maxPageSize: number;
        /** Maximum byte bound for text previews. */
        readonly maxPreviewBytes: number;
        /** Maximum line bound for text previews. */
        readonly maxPreviewLines: number;
        /** Maximum byte bound for retained content reads. */
        readonly maxReadBytes: number;
        /** Maximum exact-content source/target pairs considered for derived moves. */
        readonly maxDerivedMoveCandidates: number;
        /** Maximum concurrent retained-evidence verification operations. */
        readonly maxVerificationConcurrency: number;
        /** Closed derived move/copy classifications. */
        readonly moveKinds: readonly string[];
        /** Closed text-preview classifications. */
        readonly previewClassifications: readonly string[];
        /** Canonical Git index mode for symbolic links. */
        readonly symlinkMode: string;
        /** Public changeset-inspection protocol version. */
        readonly version: number;
    };
    /** Exact consume-once retained-output settlement configuration. */
    readonly settlement: {
        /** Closed settlement command vocabulary. */
        readonly actions: readonly string[];
        /** Path-disjoint retained-world application protocol. */
        readonly application: {
            /** Generated application artifact destinations. */
            readonly artifacts: {
                readonly conflictSchema: string;
                readonly planSchema: string;
                readonly receiptSchema: string;
            };
            /** Whether portable path comparison folds case. */
            readonly caseFold: boolean;
            /** Compatibility namespace included in application evidence. */
            readonly compatibilityVersion: string;
            /** Prefix for content-addressed conflict evidence. */
            readonly conflictIdPrefix: string;
            /** Closed application conflict classifications. */
            readonly conflictKinds: readonly string[];
            /** Public conflict-evidence protocol version. */
            readonly conflictVersion: number;
            /** Stable application conflict error contract. */
            readonly errors: {
                readonly conflictCode: string;
                readonly conflictMessage: string;
            };
            /** Maximum conflict pairs retained in one refusal. */
            readonly maxConflicts: number;
            /** Unicode normalization form used for portable path comparison. */
            readonly normalizationForm: string;
            /** Prefix for content-addressed application plans. */
            readonly planIdPrefix: string;
            /** Public application-plan protocol version. */
            readonly planVersion: number;
            /** Semantic roles for successful application planning. */
            readonly reasonRoles: {
                readonly disjoint: string;
                readonly unmoved: string;
            };
            /** Closed application-plan reason vocabulary. */
            readonly reasons: readonly string[];
            /** Public application-receipt protocol version. */
            readonly receiptVersion: number;
            /** Published application schema identifiers. */
            readonly schemas: {
                readonly conflictId: string;
                readonly planId: string;
                readonly receiptId: string;
            };
            /** Closed application-plan status vocabulary. */
            readonly statuses: readonly string[];
        };
        /** Prefix for idempotent settlement-citation append intents. */
        readonly citationAppendIntentPrefix: string;
        /** Prefix for immutable settlement-citation cuts. */
        readonly citationCutIdPrefix: string;
        /** Published JSON Schema identity for settlement citations. */
        readonly citationSchemaId: string;
        /** Repository-relative generated settlement-citation schema path. */
        readonly citationSchemaPath: string;
        /** Closed settlement-citation record version. */
        readonly citationVersion: number;
        /** Stable settlement validation and conflict errors. */
        readonly errors: {
            /** Conflicting decision error code. */
            readonly conflictCode: string;
            /** Conflicting decision default message. */
            readonly conflictMessage: string;
            /** Invalid exact-request error code. */
            readonly invalidCode: string;
            /** Invalid exact-request default message. */
            readonly invalidMessage: string;
        };
        /** Prefix for content-addressed settlement operations. */
        readonly operationIdPrefix: string;
        /** Closed settlement-operation codec version. */
        readonly operationVersion: number;
        /** Closed settlement-receipt codec version. */
        readonly receiptVersion: number;
        /** Receipt-only retained-world release protocol. */
        readonly release: {
            /** Generated release artifact destinations. */
            readonly artifacts: {
                readonly receiptSchema: string;
            };
            /** Compatibility namespace governing release evidence. */
            readonly compatibilityVersion: string;
            /** Public release-receipt protocol version. */
            readonly receiptVersion: number;
            /** Published release-receipt schema identifier. */
            readonly schemaId: string;
        };
        /** Prefix for content-addressed exact settlement requests. */
        readonly requestIdPrefix: string;
        /** Ordered durable settlement state vocabulary. */
        readonly states: readonly string[];
        /** Public settlement protocol version. */
        readonly version: number;
    };
    /** Journaled retained-world selection publication configuration. */
    readonly selectionPublication: {
        /** Closed publication atomicity classifications. */
        readonly atomicityKinds: readonly string[];
        /** Closed carrier descriptor format. */
        readonly descriptorFormat: string;
        /** Stable selection publication errors. */
        readonly errors: {
            /** Basis-movement error code. */
            readonly basisMovedCode: string;
            /** Basis-movement default message. */
            readonly basisMovedMessage: string;
            /** Partial-publication recovery error code. */
            readonly recoveryRequiredCode: string;
            /** Partial-publication recovery default message. */
            readonly recoveryRequiredMessage: string;
            /** Unsupported-filesystem error code. */
            readonly unsupportedCode: string;
            /** Unsupported-filesystem default message. */
            readonly unsupportedMessage: string;
        };
        /** Maximum canonical bytes in one selection plan. */
        readonly maxPlanBytes: number;
        /** Maximum canonical bytes in one terminal publication receipt. */
        readonly maxReceiptBytes: number;
        /** Maximum canonical bytes in one dependency-ordered schedule. */
        readonly maxScheduleBytes: number;
        /** Maximum canonical bytes in one path-step receipt. */
        readonly maxStepBytes: number;
        /** Maximum ordered path effects in one publication. */
        readonly maxSteps: number;
        /** Closed plan descriptor filename. */
        readonly planFile: string;
        /** Prefix for content-addressed publication plans. */
        readonly planIdPrefix: string;
        /** Closed selection-plan codec version. */
        readonly planVersion: number;
        /** Closed terminal publication descriptor filename. */
        readonly publicationFile: string;
        /** Prefix for content-addressed terminal publication receipts. */
        readonly publicationIdPrefix: string;
        /** Closed terminal publication-receipt codec version. */
        readonly publicationVersion: number;
        /** Protected carrier publication collection directory. */
        readonly publicationsDirectory: string;
        /** Language-neutral publication schema identity. */
        readonly schemaId: string;
        /** Generated publication schema repository path. */
        readonly schemaPath: string;
        /** Closed dependency schedule descriptor filename. */
        readonly scheduleFile: string;
        /** Prefix for content-addressed dependency schedules. */
        readonly scheduleIdPrefix: string;
        /** Closed publication schedule classifications. */
        readonly scheduleKinds: readonly string[];
        /** Closed dependency-schedule codec version. */
        readonly scheduleVersion: number;
        /** Prefix for dependency-scheduled terminal publication receipts. */
        readonly scheduledPublicationIdPrefix: string;
        /** Closed dependency-scheduled terminal receipt codec version. */
        readonly scheduledPublicationVersion: number;
        /** Prefix for dependency-scheduled path-step receipts. */
        readonly scheduledStepIdPrefix: string;
        /** Closed dependency-scheduled path-step codec version. */
        readonly scheduledStepVersion: number;
        /** Protected carrier selection-staging directory. */
        readonly stagingDirectory: string;
        /** Prefix for content-addressed staging identities. */
        readonly stagingIdPrefix: string;
        /** Prefix for content-addressed path-step receipts. */
        readonly stepIdPrefix: string;
        /** Closed path-step completion statuses. */
        readonly stepStatuses: readonly string[];
        /** Protected ordered step-receipt directory. */
        readonly stepsDirectory: string;
        /** Closed path-step receipt codec version. */
        readonly stepVersion: number;
        /** Workspace protocol version owning selection publication. */
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
    /** Repository-aware workspace binding protocol configuration. */
    readonly repositoryBindings: {
        /** Stable repository-binding validation errors. */
        readonly errors: {
            readonly invalidRepositoryCode: string;
            readonly invalidRepositoryMessage: string;
        };
        /** Protected per-resource Git identity receipt directory. */
        readonly identityDirectory: string;
        /** Canonical identity domain for repository binding resources. */
        readonly identityKind: string;
        /** Public repository resource discriminant. */
        readonly resourceType: string;
        /** Public repository-binding protocol version. */
        readonly version: number;
    };
    /** Explicit repository task-grant and whole-run ceiling configuration. */
    readonly repositoryGrants: {
        /** Public task-grant artifact protocol version. */
        readonly artifactVersion: number;
        /** Generated language-neutral repository-grant artifacts. */
        readonly artifacts: {
            /** Repository grant-plan schema destination. */
            readonly grantPlanSchema: string;
            /** Repository task-grant artifact-lock schema destination. */
            readonly taskGrantArtifactLockSchema: string;
            /** Repository task-grant artifact schema destination. */
            readonly taskGrantArtifactSchema: string;
        };
        /** Closed authority-atom vocabulary. */
        readonly atoms: readonly string[];
        /** Compatibility namespace included in repository task-grant identity. */
        readonly compatibilityVersion: string;
        /** Enforcement classification truthfully provided by the current runtime seam. */
        readonly enforcement: string;
        /** Capture-journal version written by unplaced granted execution. */
        readonly journalVersion: number;
        /** Capture-journal versions carrying repository grant-plan evidence. */
        readonly journalVersions: readonly number[];
        /** Capability operations mapped to configured required authority atoms. */
        readonly operations: {
            /** Authority atom required by retained-world text reads. */
            readonly readText: string;
            /** Authority atom required by retained-world text writes. */
            readonly writeText: string;
        };
        /** Prefix for content-addressed admitted grant-plan identities. */
        readonly planIdPrefix: string;
        /** Public admitted grant-plan protocol version. */
        readonly planVersion: number;
        /** Closed whole-binding profiles and their authority atoms. */
        readonly profiles: readonly {
            /** Canonically ordered authority atoms supplied by the profile. */
            readonly atoms: readonly string[];
            /** Stable public profile name. */
            readonly name: string;
        }[];
        /** Published repository-grant schema identifiers. */
        readonly schemas: {
            /** Absolute repository grant-plan schema identifier. */
            readonly grantPlanId: string;
            /** Absolute repository task-grant artifact schema identifier. */
            readonly taskGrantArtifactId: string;
            /** Absolute repository task-grant lock schema identifier. */
            readonly taskGrantArtifactLockId: string;
        };
        /** Prefix for content-addressed task-grant identities. */
        readonly taskGrantIdPrefix: string;
    };
    /** Placement request, platform classification, and honest resolution configuration. */
    readonly placements: {
        /** Public placement artifact protocol version. */
        readonly artifactVersion: number;
        /** Generated language-neutral placement artifact destinations. */
        readonly artifacts: {
            /** Placement platform-evidence schema destination. */
            readonly platformEvidenceSchema: string;
            /** Placement-resolution schema destination. */
            readonly resolutionSchema: string;
        };
        /** Compatibility namespace included in placement identity. */
        readonly compatibilityVersion: string;
        /** Actual enforcement classification of every currently supported resolution. */
        readonly enforcement: string;
        /** Capture-journal version written by placed granted execution. */
        readonly journalVersion: number;
        /** Capture-journal versions carrying placement-resolution evidence. */
        readonly journalVersions: readonly number[];
        /** Native syscall-jail backend and probe protocol. */
        readonly nativeJails: {
            /** Generated native-jail artifact destinations. */
            readonly artifacts: {
                readonly backendSchema: string;
                readonly commandSchema: string;
                readonly planSchema: string;
                readonly probeSchema: string;
                readonly processSchema: string;
                readonly resolutionSchema: string;
            };
            /** Configured native backends selected by classified host evidence. */
            readonly backends: readonly {
                /** Execution environments on which the backend may be probed. */
                readonly environments: readonly string[];
                /** Absolute launcher executable, or `null` for a package helper. */
                readonly executable: string | null;
                /** Classified platform family governed by the backend. */
                readonly family: string;
                /** Stable backend name. */
                readonly name: string;
                /** Node platform spellings on which the backend may be probed. */
                readonly nodePlatforms: readonly string[];
                /** Structured profile argument, or `null` for a package helper. */
                readonly profileArgument: string | null;
            }[];
            /** Compatibility namespace included in native-jail evidence. */
            readonly compatibilityVersion: string;
            /** Structured compiler arguments for the package Landlock helper. */
            readonly compilerArguments: readonly string[];
            /** Absolute compiler candidates for the package Landlock helper. */
            readonly compilerExecutables: readonly string[];
            /** Structured compiler argument introducing the output path. */
            readonly compilerOutputArgument: string;
            /** Prefix for content-addressed native command identities. */
            readonly commandIdPrefix: string;
            /** Public structured native command protocol version. */
            readonly commandVersion: number;
            /** Prefix for content-addressed backend-descriptor identities. */
            readonly descriptorIdPrefix: string;
            /** Public backend-descriptor protocol version. */
            readonly descriptorVersion: number;
            /** Actual native enforcement classification. */
            readonly enforcement: string;
            /** Capture-journal version written by native jailed execution. */
            readonly journalVersion: number;
            /** Capture-journal versions carrying native-jail resolution evidence. */
            readonly journalVersions: readonly number[];
            /** Maximum aggregate UTF-8 bytes across native command arguments. */
            readonly maxArgumentBytes: number;
            /** Maximum structured native command argument count. */
            readonly maxArguments: number;
            /** Maximum structured native command environment entry count. */
            readonly maxEnvironmentEntries: number;
            /** Maximum aggregate UTF-8 bytes across environment names and values. */
            readonly maxEnvironmentValueBytes: number;
            /** Maximum captured bytes per native process output stream. */
            readonly maxOutputBytes: number;
            /** Maximum configured native command duration. */
            readonly maxTimeoutMilliseconds: number;
            /** Prefix for content-addressed confinement-plan identities. */
            readonly planIdPrefix: string;
            /** Public native confinement-plan protocol version. */
            readonly planVersion: number;
            /** Configured semantic roles for successful jail placement. */
            readonly placementReasonRoles: {
                readonly auto: string;
                readonly explicit: string;
            };
            /** Closed successful native-jail placement reasons. */
            readonly placementReasons: readonly string[];
            /** Configured successful native-jail resolution status. */
            readonly placementStatus: string;
            /** Public native-jail placement-resolution protocol version. */
            readonly placementVersion: number;
            /** Prefix for content-addressed backend-probe identities. */
            readonly probeIdPrefix: string;
            /** Configured semantic roles for probe outcomes. */
            readonly probeReasonRoles: {
                readonly deniedWriteFailed: string;
                readonly executableUnavailable: string;
                readonly helperCompilerUnavailable: string;
                readonly helperIntegrityFailed: string;
                readonly grantedWriteFailed: string;
                readonly platformUnsupported: string;
                readonly probeError: string;
                readonly succeeded: string;
            };
            /** Closed backend-probe reason vocabulary. */
            readonly probeReasons: readonly string[];
            /** Closed backend-probe status vocabulary. */
            readonly probeStatuses: readonly string[];
            /** Public backend-probe protocol version. */
            readonly probeVersion: number;
            /** Native judged-process lifecycle and receipt protocol. */
            readonly process: {
                /** Signal used for fail-closed process-group termination. */
                readonly killSignal: string;
                /** Prefix for content-addressed launch-intent identities. */
                readonly launchIdPrefix: string;
                /** Bounded process-group quiescence probe attempts. */
                readonly quiescenceAttempts: number;
                /** Delay between process-group quiescence probes. */
                readonly quiescenceDelayMilliseconds: number;
                /** Closed quiescence classification vocabulary. */
                readonly quiescenceStatuses: readonly string[];
                /** Configured semantic roles for quiescence results. */
                readonly quiescenceStatusRoles: {
                    readonly proven: string;
                    readonly uncertain: string;
                };
                /** Prefix for content-addressed launch-receipt identities. */
                readonly receiptIdPrefix: string;
                /** Public launch-receipt protocol version. */
                readonly receiptVersion: number;
                /** Prefix for content-addressed native process-start evidence. */
                readonly startIdPrefix: string;
                /** Configured semantic roles for terminal process results. */
                readonly statusRoles: {
                    readonly cancelled: string;
                    readonly exited: string;
                    readonly launchFailed: string;
                    readonly outputLimit: string;
                    readonly quiescenceUncertain: string;
                    readonly timedOut: string;
                };
                /** Closed terminal native-process status vocabulary. */
                readonly statuses: readonly string[];
            };
            /** Prefix for content-addressed native-jail placement resolutions. */
            readonly resolutionIdPrefix: string;
            /** Effective placement supplied by native-jail execution. */
            readonly resolvedPlacement: string;
            /** Published native-jail schema identifiers. */
            readonly schemas: {
                readonly backendId: string;
                readonly commandId: string;
                readonly planId: string;
                readonly probeId: string;
                readonly processId: string;
                readonly resolutionId: string;
            };
            /** Prefix for private native-probe temporary directories. */
            readonly temporaryDirectoryPrefix: string;
        };
        /** Deterministic platform-classification policy. */
        readonly platform: {
            /** Closed execution-environment classifications. */
            readonly environments: readonly string[];
            /** Prefix for content-addressed platform-evidence identities. */
            readonly evidenceIdPrefix: string;
            /** Closed platform-family classifications. */
            readonly families: readonly string[];
            /** Environment classification for ordinary native hosts. */
            readonly nativeEnvironment: string;
            /** Supported Node platform spellings and their families. */
            readonly nodePlatforms: readonly {
                /** Configured platform family. */
                readonly family: string;
                /** Exact Node platform spelling. */
                readonly name: string;
            }[];
            /** Environment classification for unsupported hosts. */
            readonly unsupportedEnvironment: string;
            /** Family classification for unsupported hosts. */
            readonly unsupportedFamily: string;
            /** Public platform-evidence protocol version. */
            readonly version: number;
            /** Environment classification for Windows Subsystem for Linux. */
            readonly wslEnvironment: string;
            /** Environment-variable names that provide WSL evidence. */
            readonly wslEnvironmentVariables: readonly string[];
            /** Platform family assigned to WSL. */
            readonly wslFamily: string;
            /** Node platform spelling on which WSL detection applies. */
            readonly wslNodePlatform: string;
            /** Case-insensitive OS-release pattern providing WSL evidence. */
            readonly wslReleasePattern: string;
        };
        /** Closed placement-resolution reason vocabulary. */
        readonly reasons: readonly string[];
        /** Closed requested-placement vocabulary. */
        readonly requests: readonly string[];
        /** Prefix for content-addressed placement-resolution identities. */
        readonly resolutionIdPrefix: string;
        /** Closed effective-placement vocabulary implemented by this protocol. */
        readonly resolvedPlacements: readonly string[];
        /** Total configured request-resolution rules. */
        readonly rules: readonly {
            /** Stable resolution reason. */
            readonly reason: string;
            /** Requested placement governed by this rule. */
            readonly request: string;
            /** Effective placement, or `null` for a fail-closed unsupported request. */
            readonly resolved: string | null;
            /** Public resolved/refused status for this rule. */
            readonly status: string;
            /** Whether the request may produce resolution evidence. */
            readonly supported: boolean;
        }[];
        /** Published placement schema identifiers. */
        readonly schemas: {
            /** Absolute platform-evidence schema identifier. */
            readonly platformEvidenceId: string;
            /** Absolute placement-resolution schema identifier. */
            readonly resolutionId: string;
        };
        /** Closed placement resolution/refusal status vocabulary. */
        readonly statuses: readonly string[];
    };
    /** Cross-platform retained-custody conformance policy. */
    readonly platformConformance: {
        /** Portable path case-collision policy. */
        readonly caseCollisionPolicy: string;
        /** Stable deterministic fault classifications and injection phases. */
        readonly faults: {
            /** Closed fault names with stable public error contracts. */
            readonly classifications: readonly {
                /** Stable machine-readable error code. */
                readonly code: string;
                /** Stable default diagnostic. */
                readonly message: string;
                /** Fault classification name. */
                readonly name: string;
            }[];
            /** Classification used when portable custody cannot preserve detected metadata. */
            readonly metadataClassification: string;
            /** Closed injection phases with required recovery behavior. */
            readonly phases: readonly {
                /** Stable custody boundary name. */
                readonly name: string;
                /** Required recovery classification. */
                readonly recovery: string;
            }[];
            /** Classification used when host semantics cannot satisfy portable custody. */
            readonly platformClassification: string;
        };
        /** Git-specific platform policy. */
        readonly git: {
            /** Policy for worktree placeholders created with `core.symlinks=false`. */
            readonly coreSymlinksFalse: string;
            /** Policy for Gitlink evidence outside canonical copy-world identity. */
            readonly gitlinks: string;
            /** Policy for sparse-index evidence. */
            readonly sparseIndex: string;
        };
        /** Unsupported filesystem-metadata handling policy. */
        readonly metadataPolicy: string;
        /** Placeholder replaced with the inspected path in metadata probe arguments. */
        readonly metadataPathToken: string;
        /** Maximum output bytes accepted from one metadata probe. */
        readonly metadataProbeMaxBytes: number;
        /** Maximum execution time accepted from one metadata probe. */
        readonly metadataProbeTimeoutMs: number;
        /** Configured host metadata probes. */
        readonly metadataProbes: readonly {
            /** Ordered executable arguments containing the configured path token. */
            readonly arguments: readonly string[];
            /** Probe executable. */
            readonly executable: string;
            /** Metadata kind detected by a matching probe. */
            readonly kind: string;
            /** Regular expression matched against standard output. */
            readonly matchPattern: string;
            /** Regular-expression flags. */
            readonly patternFlags: string;
            /** Node host platform for this probe. */
            readonly platform: string;
            /** Whether paths containing line breaks must be probed outside a batched invocation. */
            readonly separateLineBreakPaths: boolean;
            /** Ordered non-following arguments used for symbolic-link paths. */
            readonly symlinkArguments: readonly string[];
        }[];
        /** Portable file and directory mode policy. */
        readonly modePolicy: string;
        /** Correctness gate for optimized carrier parity claims. */
        readonly optimizedCarrierParity: string;
        /** Host platforms with an explicit custody policy. */
        readonly supportedPlatforms: readonly string[];
        /** Symbolic-link retention policy. */
        readonly symlinkPolicy: string;
        /** Filesystem metadata rejected before publication. */
        readonly unsupportedMetadata: readonly string[];
        /** Public platform-conformance contract version. */
        readonly version: number;
    };
    /** Generic protected workspace-path validation policy. */
    readonly protectedPaths: {
        /** Separators introducing filesystem alternate-name forms. */
        readonly alternateNameSeparators: readonly string[];
        /** Whether comparisons use deterministic Unicode case folding. */
        readonly caseFold: boolean;
        /** Stable protected-path error code. */
        readonly errorCode: string;
        /** Stable protected-path default message. */
        readonly errorMessage: string;
        /** Unicode normalization form applied before comparison. */
        readonly normalizationForm: "NFC" | "NFD" | "NFKC" | "NFKD";
        /** Workspace-relative protected path roots. */
        readonly roots: readonly string[];
        /** Trailing characters ignored by alternate-name filesystems. */
        readonly trailingCharacters: readonly string[];
        /** Public protected-path validation contract version. */
        readonly version: number;
    };
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
        /** Canonical identity domain for deterministic task-world custody. */
        readonly custodyIdentityKind: string;
        /** Ordered durable pre-terminal capture-journal phases. */
        readonly journalPhases: readonly string[];
        /** Closed exact capture-journal schema/version pairs accepted by recovery readers. */
        readonly journalReaders: readonly {
            /** Exact immutable journal schema identity. */
            readonly schemaId: string;
            /** Exact journal body version governed by the schema identity. */
            readonly version: number;
        }[];
        /** Capture-journal version written by ordinary ungranted execution. */
        readonly ordinaryJournalVersion: number;
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
