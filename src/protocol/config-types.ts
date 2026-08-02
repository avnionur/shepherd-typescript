/** Hash algorithms permitted for content-addressed protocol identities. */
export const SECURE_HASH_ALGORITHMS = ["sha256", "sha384", "sha512"] as const;

/** SQLite journal modes permitted by the trace-store durability contract. */
export const STORE_JOURNAL_MODES = ["WAL"] as const;

/** SQLite synchronization levels permitted by the trace-store durability contract. */
export const STORE_SYNCHRONOUS_LEVELS = ["FULL"] as const;

/** SQLite transaction modes permitted for serialized append planning. */
export const STORE_TRANSACTION_MODES = ["IMMEDIATE"] as const;

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

/** Complete validated language-neutral protocol configuration. */
export type ProtocolConfig = {
    readonly kernel: KernelProtocolConfig;
    readonly projections: ProjectionProtocolConfig;
    readonly recordId: RecordIdConfig;
    readonly tasks: TaskProtocolConfig;
};
