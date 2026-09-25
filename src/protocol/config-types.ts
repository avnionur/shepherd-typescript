/** Hash algorithms permitted for content-addressed protocol identities. */
export const SECURE_HASH_ALGORITHMS = ["sha256", "sha384", "sha512"] as const;

/** SQLite journal modes permitted by the trace-store durability contract. */
export const STORE_JOURNAL_MODES = ["WAL"] as const;

/** SQLite rollback-journal modes that leave a closed backup database as one self-contained file. */
export const BACKUP_JOURNAL_MODES = ["DELETE", "TRUNCATE", "PERSIST"] as const;

/** SQLite synchronization levels permitted by the trace-store durability contract. */
export const STORE_SYNCHRONOUS_LEVELS = ["FULL"] as const;

/** SQLite transaction modes permitted for serialized append planning. */
export const STORE_TRANSACTION_MODES = ["IMMEDIATE"] as const;

/** Store maintenance operations implemented by `SQLiteTraceStore.maintain`. */
export const STORE_MAINTENANCE_OPERATIONS = [
    "inspect",
    "checkpoint",
    "optimize",
    "vacuum",
] as const;

/** SQLite WAL checkpoint modes permitted for store maintenance. */
export const STORE_WAL_CHECKPOINT_MODES = ["PASSIVE", "FULL", "RESTART", "TRUNCATE"] as const;

/** Ordered effect-handler selection policies supported by this runtime. */
export const EFFECT_HANDLER_SELECTIONS = ["last_matching"] as const;

/** Unhandled effect policies supported by this runtime. */
export const EFFECT_UNHANDLED_POLICIES = ["throw"] as const;

/** Live provider wire dialects implemented by the current provider protocol. */
export const LIVE_PROVIDER_DIALECTS = ["anthropic_messages", "openai_chat_completions"] as const;

/** Substrate operations a configured meta-agent tool can be bound to. */
export const META_AGENT_TOOL_OPERATIONS = [
    "observe",
    "fork",
    "discard",
    "rewind",
    "replay",
    "read_trace",
    "diff",
] as const;

/** Validated configured CLI command descriptor. */
export type CliCommandConfig = {
    readonly handler: string;
    readonly name: string;
};

/** Validated configured CLI top-level group or command descriptor. */
export type CliGroupConfig = {
    readonly commands: readonly CliCommandConfig[];
    readonly handler: string | null;
    readonly name: string;
};

/** Validated human-facing CLI topology and resource policy. */
export type CliProtocolConfig = {
    readonly artifacts: {
        readonly commandReference: string;
        readonly jsonOutputSchema: string;
        readonly quickstartDemo: string;
    };
    /**
     * Option keys (from `options`) each handler role accepts, split into flags and value options;
     * handlers parse argv only through this table, so it is the per-command option surface.
     */
    readonly commandOptions: Readonly<
        Record<
            string,
            {
                readonly flags: readonly (keyof CliProtocolConfig["options"])[];
                readonly values: readonly (keyof CliProtocolConfig["options"])[];
            }
        >
    >;
    readonly compatibilityVersion: string;
    readonly defaults: {
        readonly bindingName: string;
        readonly bindingRoot: string;
        readonly quickstartDemoName: string;
        readonly taskRegistryPath: string;
        readonly traceStorePath: string;
        readonly workspacePath: string;
    };
    readonly executableName: string;
    readonly executablePath: string;
    readonly exitCodes: {
        readonly failure: number;
        readonly success: number;
        readonly unavailable: number;
        readonly usage: number;
    };
    readonly handlerRoles: {
        readonly doctor: string;
        readonly runApply: string;
        readonly runChangeset: string;
        readonly runDiscard: string;
        readonly runList: string;
        readonly runOutputCitations: string;
        readonly runOutputs: string;
        readonly runPublishRetainedWorkspaceOutput: string;
        readonly runRecoveryRecords: string;
        readonly runRelease: string;
        readonly runRepair: string;
        readonly runSelect: string;
        readonly runShow: string;
        readonly runTrace: string;
        readonly runTraceRevision: string;
        readonly runVcsCore: string;
        readonly replayDiff: string;
        readonly replayLog: string;
        readonly replayShow: string;
        readonly scopeList: string;
        readonly scopeShow: string;
        readonly storeBackup: string;
        readonly storeExport: string;
        readonly storeImport: string;
        readonly storeMaintain: string;
        readonly storeRestore: string;
        readonly storeVerify: string;
        readonly taskList: string;
        readonly taskResolve: string;
        readonly taskShow: string;
        readonly demoWrite: string;
        readonly unsupportedPackageInit: string;
        readonly unsupportedStart: string;
        readonly unsupportedTaskRegister: string;
        readonly workspaceInit: string;
    };
    readonly helpAliases: readonly string[];
    readonly groups: readonly CliGroupConfig[];
    readonly limits: {
        readonly defaultPageSize: number;
        readonly defaultRetainedReadBytes: number;
        readonly maxArgumentBytes: number;
        readonly maxArguments: number;
        readonly maxOutputBytes: number;
        readonly maxPageSize: number;
        readonly maxRetainedReadBytes: number;
    };
    readonly machineOutput: {
        readonly compatibilityVersion: string;
        readonly errorCodes: {
            readonly failure: string;
            readonly unavailable: string;
            readonly usage: string;
        };
        readonly maxCanonicalBytes: number;
        readonly resultShapes: Readonly<Record<string, readonly (readonly string[])[]>>;
        readonly schemaId: string;
        readonly unavailableRemedies: Readonly<Record<string, keyof CliProtocolConfig["remedies"]>>;
        readonly version: number;
    };
    readonly messages: {
        readonly changesetBinary: string;
        readonly changesetPathUnavailable: string;
        readonly changesetUnavailable: string;
        readonly demoNameUsage: string;
        readonly publicationExactRun: string;
        readonly publicationUnavailable: string;
        readonly quickstartUnavailable: string;
        readonly replayDiffUsage: string;
        readonly scopeUnavailable: string;
    };
    readonly options: {
        readonly adopt: string;
        readonly backup: string;
        readonly bindingName: string;
        readonly bindingRoot: string;
        readonly command: string;
        readonly initializeGit: string;
        readonly input: string;
        readonly json: string;
        readonly limit: string;
        readonly manifest: string;
        readonly maxBytes: string;
        readonly mode: string;
        readonly noInitializeGit: string;
        readonly offset: string;
        readonly output: string;
        readonly redacted: string;
        readonly registry: string;
        readonly read: string;
        readonly store: string;
        readonly workspace: string;
    };
    readonly remedies: {
        readonly fencedStart: string;
        readonly packageInit: string;
        readonly taskRegister: string;
    };
    readonly version: number;
};

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
    readonly maintenance: StoreMaintenanceProtocolConfig;
    readonly migrations: NonEmptyReadonlyArray<StoreMigrationConfig>;
    readonly schemaVersion: number;
    readonly synchronous: (typeof STORE_SYNCHRONOUS_LEVELS)[number];
    readonly transactionMode: (typeof STORE_TRANSACTION_MODES)[number];
};

/** Validated semantics-preserving trace-store maintenance configuration. */
export type StoreMaintenanceProtocolConfig = {
    /** Non-mutating maintenance default. */
    readonly defaultMode: (typeof STORE_MAINTENANCE_OPERATIONS)[number];
    /** Enabled maintenance operations, a subset of the implemented operations. */
    readonly modes: readonly (typeof STORE_MAINTENANCE_OPERATIONS)[number][];
    /** Maximum `quick_check` issues retained in one report. */
    readonly quickCheckMaxIssues: number;
    /** WAL checkpoint mode applied by checkpoint and after vacuum. */
    readonly walCheckpointMode: (typeof STORE_WAL_CHECKPOINT_MODES)[number];
    /** Suffix SQLite appends to the database path for its write-ahead log. */
    readonly walFileSuffix: string;
};

/**
 * Validated operational bounds on native and redacted trace-archive input. They are not part of
 * the archive format identity. Referenced by the shipped `KernelProtocolConfig` declaration.
 */
export type TraceArchiveLimitsConfig = {
    /** Maximum archived append intents. */
    readonly maxAppendIntents: number;
    /** Maximum UTF-8 byte length of archive text, checked before parsing. */
    readonly maxArchiveBytes: number;
    /** Maximum declared total of decoded blob bytes, checked before decoding. */
    readonly maxBlobBytes: number;
    /** Maximum archived blobs. */
    readonly maxBlobs: number;
    /** Maximum archived cuts. */
    readonly maxCuts: number;
    /** Maximum JSON array and object nesting depth, checked before parsing. */
    readonly maxNestingDepth: number;
    /** Maximum archived owner views. */
    readonly maxRecordViews: number;
    /** Maximum archived records. */
    readonly maxRecords: number;
};

/**
 * Validated nesting bounds of the canonical value domain (`kernel.canonicalization`). They make
 * canonical acceptance independent of the call-site stack depth and JIT state. Referenced by the shipped
 * `KernelProtocolConfig` declaration.
 */
export type CanonicalizationConfig = {
    /**
     * Additional nesting levels reserved for kernel framing (record identity input, append batch
     * digest, native and redacted archives) around values already bounded by `maxNestingDepth`.
     */
    readonly framingDepth: number;
    /**
     * Maximum array and object nesting depth of one canonical value, counting the outermost
     * container as level one; checked before descending into a deeper container.
     */
    readonly maxNestingDepth: number;
};

/** Validated kernel protocol configuration. */
export type KernelProtocolConfig = {
    readonly abiVersion: string;
    readonly append: {
        readonly firstOwnerOrdinal: number;
        readonly lastOwnerOrdinal: number;
    };
    readonly canonicalization: CanonicalizationConfig;
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
        readonly limits: TraceArchiveLimitsConfig;
        /** Operational import staging, excluded from the archive format identity. */
        readonly staging: {
            /**
             * Name prefix of the owner-only directory an import validates in, created beside the
             * target store's blob directory.
             */
            readonly directoryPrefix: string;
        };
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

/** Versioned bounded orphaned-operation diagnosis and repair configuration. */
export type OrphanRepairProtocolConfig = {
    /** Generated language-neutral evidence schema destinations. */
    readonly artifacts: {
        readonly commandSchema: string;
        readonly diagnosisSchema: string;
        readonly receiptSchema: string;
    };
    /** Stable blocker codes derived from retained operation evidence. */
    readonly blockers: {
        readonly liveSession: string;
        readonly providerStarted: string;
        readonly scopeOwned: string;
    };
    /** Compatibility namespace for orphan bookkeeping and repair evidence. */
    readonly compatibilityVersion: string;
    /** Wire versions for each evidence contract. */
    readonly versions: {
        readonly command: number;
        readonly diagnosis: number;
        readonly operation: number;
        readonly receipt: number;
    };
    /** Digest and identity domains for exact basis, command, and receipt evidence. */
    readonly identity: {
        readonly algorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
        readonly commandAppendIntentPrefix: string;
        readonly commandOwnerPrefix: string;
        readonly diagnosisPrefix: string;
        readonly hexLength: number;
        readonly receiptAppendIntentPrefix: string;
        readonly receiptPrefix: string;
    };
    /** Resource limits applied to inputs, pages, and canonical evidence. */
    readonly limits: {
        readonly defaultPageSize: number;
        readonly maxCanonicalBytes: number;
        readonly maxCauseBytes: number;
        readonly maxIdentifierBytes: number;
        readonly maxOperations: number;
        readonly maxPageSize: number;
    };
    /** Published language-neutral evidence schema identifiers. */
    readonly schemas: {
        readonly commandId: string;
        readonly diagnosisId: string;
        readonly receiptId: string;
    };
    /** Closed public status discriminants used by diagnosis and fail-soft reclaim. */
    readonly statuses: {
        readonly preRun: {
            readonly declined: string;
            readonly repaired: string;
        };
        readonly session: {
            readonly dead: string;
            readonly live: string;
        };
    };
    /** Canonical trace record schemas used for repair audit evidence. */
    readonly traceSchemas: {
        readonly command: string;
        readonly receipt: string;
    };
    /** Stable public error codes and remediation messages. */
    readonly errors: {
        readonly blockedCode: string;
        readonly blockedMessage: string;
        readonly commandConflictCode: string;
        readonly commandConflictMessage: string;
        readonly corruptCode: string;
        readonly corruptMessage: string;
        readonly staleCode: string;
        readonly staleMessage: string;
        readonly unsupportedCode: string;
        readonly unsupportedMessage: string;
    };
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

/** Configured bounded output-citation, trace-revision, and recovery-record contract. */
export type EvidenceRecordProjectionConfig = {
    /** Generated language-neutral projection schemas. */
    readonly artifacts: {
        readonly outputCitationSchema: string;
        readonly recoveryRecordSchema: string;
        readonly traceRevisionSchema: string;
    };
    /** Compatibility namespace for disposable evidence projections. */
    readonly compatibilityVersion: string;
    /** Default bounded list page size. */
    readonly defaultPageSize: number;
    /** Stable selector error codes and generic messages. */
    readonly errors: {
        readonly ambiguousCode: string;
        readonly ambiguousMessage: string;
        readonly notFoundCode: string;
        readonly notFoundMessage: string;
    };
    /** Configured read-only latest-selector token. */
    readonly latestSelector: string;
    /** Maximum canonical JSON bytes for one projected entry. */
    readonly maxCanonicalEntryBytes: number;
    /** Maximum requested or selector candidate count. */
    readonly maxPageSize: number;
    /** Maximum UTF-8 bytes accepted for one selector. */
    readonly maxSelectorBytes: number;
    /** SQLite JSON path selecting exact retained output identity. */
    readonly outputIdJsonPath: string;
    /** Published projection schema identifiers. */
    readonly schemas: {
        readonly outputCitationId: string;
        readonly recoveryRecordId: string;
        readonly traceRevisionId: string;
    };
    /** Public disposable evidence projection version. */
    readonly version: number;
};

/** Configured bounded task/run ledger read projection and selector contract. */
export type TaskRunLedgerProjectionConfig = {
    /** Generated language-neutral projection schemas. */
    readonly artifacts: {
        readonly runEntrySchema: string;
        readonly taskEntrySchema: string;
    };
    /** Compatibility namespace for disposable ledger projections. */
    readonly compatibilityVersion: string;
    /** Default bounded list page size. */
    readonly defaultPageSize: number;
    /** Stable selector error codes and generic messages. */
    readonly errors: {
        readonly ambiguousCode: string;
        readonly ambiguousMessage: string;
        readonly notFoundCode: string;
        readonly notFoundMessage: string;
    };
    /** Configured read-only latest-selector token. */
    readonly latestSelector: string;
    /** Maximum canonical JSON bytes for one projected entry. */
    readonly maxCanonicalEntryBytes: number;
    /** Maximum requested result count for one list call. */
    readonly maxPageSize: number;
    /** Maximum UTF-8 bytes accepted for one selector. */
    readonly maxSelectorBytes: number;
    /** Published projection schema identifiers. */
    readonly schemas: {
        readonly runEntryId: string;
        readonly taskEntryId: string;
    };
    /** Separator between exact task identity and logical version. */
    readonly taskVersionSeparator: string;
    /** Public disposable projection version. */
    readonly version: number;
};

/** Validated disposable projection configuration. */
export type ProjectionProtocolConfig = {
    readonly evidenceRecords: EvidenceRecordProjectionConfig;
    readonly executionHistory: ExecutionHistoryProjectionConfig;
    readonly taskRunLedgers: TaskRunLedgerProjectionConfig;
};

/** Validated provider capability declaration. */
export type ProviderCapabilitiesConfig = {
    /** Whether the provider exposes streaming responses. */
    readonly streaming: boolean;
    /** Whether the provider returns structured values. */
    readonly structuredOutput: boolean;
    /** Whether the provider can invoke tools. */
    readonly tools: boolean;
};

/** Validated configuration of one live provider kind. */
export type LiveProviderKindConfig = {
    /** Prompt-cache breakpoint marker placed on the last cacheable prefix block, or null. */
    readonly cacheControl: Readonly<Record<string, unknown>> | null;
    /** Capabilities declared by every provider of this kind. */
    readonly capabilities: ProviderCapabilitiesConfig;
    /** Provider stop reasons that mark a complete response. */
    readonly completeStopReasons: readonly string[];
    /** Credential source and request header. */
    readonly credential: {
        /** Environment variable read when the caller supplies no credential. */
        readonly environmentVariable: string;
        /** Request header carrying the credential. */
        readonly header: string;
        /** Authorization scheme prefixed to the credential, or null for the bare credential. */
        readonly scheme: string | null;
    };
    /** Implemented wire dialect. */
    readonly dialect: (typeof LIVE_PROVIDER_DIALECTS)[number];
    /** Default absolute request endpoint. */
    readonly endpoint: string;
    /** Static request headers. */
    readonly headers: Readonly<Record<string, string>>;
    /** Default maximum output tokens per request. */
    readonly maxOutputTokens: number;
    /** Request body field carrying the output-token limit. */
    readonly maxTokensField: string;
    /** Named structured-output format, or null when the dialect needs no name. */
    readonly outputFormat: {
        /** Schema name sent with the output format. */
        readonly name: string;
        /** Whether the provider must enforce the schema strictly. */
        readonly strict: boolean;
    } | null;
    /** Tool-use wire settings of this kind. */
    readonly toolUse: {
        /** Request body field carrying the tool definitions. */
        readonly requestField: string;
        /** Provider stop reasons that mark a complete turn requesting tool calls. */
        readonly stopReasons: readonly string[];
    };
};

/** Validated configuration of one meta-agent catalog tool. */
export type MetaAgentToolConfig = {
    /** Description sent to the model with the tool definition. */
    readonly description: string;
    /** Exact effect kind of every intent this tool's calls become. */
    readonly effectKind: string;
    /** Canonical JSON Schema of the tool input. */
    readonly inputSchema: Readonly<Record<string, unknown>>;
    /** Tool name the model calls. */
    readonly name: string;
    /** Substrate operation the tool is bound to. */
    readonly operation: (typeof META_AGENT_TOOL_OPERATIONS)[number];
    /** Declared reversibility tier of the tool's intents. */
    readonly reversibility: string;
};

/** Validated tool-use loop, turn encoding, and meta-agent catalog configuration. */
export type ProviderToolsConfig = {
    /** Multi-turn tool-use loop bounds and vocabularies. */
    readonly loop: {
        /** Turn bound used when a loop declares none. */
        readonly defaultMaxTurns: number;
        /** Tool-call dispositions ordered materialized, denied, invalid, failed. */
        readonly dispositions: readonly string[];
        /** Prefix of every runtime-derived tool-call effect identity. */
        readonly effectIdPrefix: string;
        /** Maximum UTF-8 bytes of one tool result sent back to the model. */
        readonly maxResultBytes: number;
        /** Largest turn bound a loop may declare. */
        readonly maxTurns: number;
        /** Loop result statuses ordered completed then turn limit. */
        readonly statuses: readonly string[];
        /** Marker appended to a truncated tool result. */
        readonly truncationMarker: string;
    };
    /** Substrate-native meta-agent tool catalog. */
    readonly metaAgent: {
        /** Prefix of every substrate command identity derived from a tool-call effect identity. */
        readonly commandIdPrefix: string;
        /** Meta-agent tool result bounds. */
        readonly limits: {
            /** Maximum steps summarized by one observe call. */
            readonly maxObservedSteps: number;
            /** Maximum records returned by one read-trace call. */
            readonly maxTraceRecords: number;
        };
        /** Catalog tools, one per operation. */
        readonly tools: readonly MetaAgentToolConfig[];
    };
    /** Encoding of one tool-use turn as a replayable provider request. */
    readonly turn: {
        /** Instruction marking an encoded tool-use turn request. */
        readonly instruction: string;
        /** Output JSON Schema of an encoded tool-use turn response. */
        readonly outputSchema: Readonly<Record<string, unknown>>;
    };
};

/** Validated provider-neutral, deterministic, program, and live provider configuration. */
export type ProviderProtocolConfig = {
    /** Provider conversation identity prefixes. */
    readonly conversation: {
        /** Prefix of a provider conversation's declared cache identity. */
        readonly cacheIdentityPrefix: string;
        /** Prefix of a provider conversation checkpoint receipt. */
        readonly receiptIdPrefix: string;
    };
    /** Closed provider-kind vocabulary. */
    readonly kinds: readonly string[];
    /** Live provider adapters, errors, limits, and redaction. */
    readonly live: {
        /** Stable live-provider error codes and messages. */
        readonly errors: {
            /** Missing-credential error code. */
            readonly credentialCode: string;
            /** Missing-credential error message. */
            readonly credentialMessage: string;
            /** Non-success HTTP status error code. */
            readonly httpCode: string;
            /** Non-success HTTP status error message. */
            readonly httpMessage: string;
            /** Malformed or incomplete response error code. */
            readonly responseCode: string;
            /** Malformed or incomplete response error message. */
            readonly responseMessage: string;
            /** Transport failure error code. */
            readonly transportCode: string;
            /** Transport failure error message. */
            readonly transportMessage: string;
        };
        /** Configured live provider kinds by kind name. */
        readonly kinds: Readonly<Record<string, LiveProviderKindConfig>>;
        /** Live-provider bounds. */
        readonly limits: {
            /** Maximum UTF-8 bytes of provider error detail kept in an error message. */
            readonly maxErrorDetailBytes: number;
        };
        /** Replacement text for a credential found in provider error detail. */
        readonly redaction: string;
    };
    /** Provider-neutral message model. */
    readonly messages: {
        /** Content block types ordered text, tool use, then tool result. */
        readonly contentTypes: readonly string[];
        /** Field names of a rendered provider request message. */
        readonly rendering: {
            /** Field carrying the canonical input. */
            readonly input: string;
            /** Field carrying the behavioral instruction. */
            readonly instruction: string;
            /** Field carrying the output JSON Schema. */
            readonly outputSchema: string;
        };
        /** Message roles ordered user then assistant. */
        readonly roles: readonly string[];
    };
    /** Caller-program provider contract used by program-serviced child runs. */
    readonly program: {
        /** Capabilities declared by every program provider. */
        readonly capabilities: ProviderCapabilitiesConfig;
        /** Capabilities declared by every program conversation provider. */
        readonly conversationCapabilities: ProviderCapabilitiesConfig;
        /** Configured provider-kind discriminant. */
        readonly kind: string;
    };
    /** Deterministic static-provider contract. */
    readonly static: {
        /** Capabilities declared by every static provider. */
        readonly capabilities: ProviderCapabilitiesConfig;
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
        readonly kind: string;
    };
    /** Tool-use loop, turn encoding, and meta-agent tool catalog. */
    readonly tools: ProviderToolsConfig;
};

/** Validated durable replay session, coupled checkpoint, rewind, and replay configuration. */
export type ReplayProtocolConfig = {
    /** Generated language-neutral replay record artifacts. */
    readonly artifacts: {
        /** Repository-relative effect admission record schema destination. */
        readonly admissionSchema: string;
        /** Repository-relative checkpoint record schema destination. */
        readonly checkpointSchema: string;
        /** Repository-relative branch restore record schema destination. */
        readonly restoreSchema: string;
        /** Repository-relative session record schema destination. */
        readonly sessionSchema: string;
        /** Repository-relative step record schema destination. */
        readonly stepSchema: string;
        /** Repository-relative terminal record schema destination. */
        readonly terminalSchema: string;
    };
    /** Disposition of the source session when a branch opens. */
    readonly branch: {
        /** Disposition a branch uses when it declares none. */
        readonly defaultSourceDisposition: string;
        /**
         * Source dispositions ordered compensate (the branch abandons the source's suffix and
         * compensates its successful compensable effects), then retain (the source stays retained
         * as a live alternative and nothing is compensated).
         */
        readonly sourceDispositions: readonly string[];
    };
    /** Provider cache evidence vocabulary. */
    readonly cache: {
        /** Cache statuses ordered hit, then not observed. */
        readonly statuses: readonly string[];
    };
    /** Declarable replay change dimensions ordered task, provider, handlers. */
    readonly changes: readonly string[];
    /** Coupled checkpoint vocabulary. */
    readonly checkpoint: {
        /** Automatic step-boundary checkpoint policies. */
        readonly automatic: {
            /** Policy a session uses when it declares none. */
            readonly defaultPolicy: {
                /** Interval of the every-N-steps policy, otherwise null. */
                readonly interval: number | null;
                /** Configured policy kind. */
                readonly kind: string;
            };
            /** Policy kinds ordered none, provider step, effect step, every N steps. */
            readonly policies: readonly string[];
        };
        /** Classifications ordered atomic, reconstructive, unavailable. */
        readonly classifications: readonly string[];
        /** Constituent kinds ordered trace cut, world, provider session, process, irreversible effects. */
        readonly constituentKinds: readonly string[];
        /** Evidence statuses ordered verified, reconstructive, not applicable, unavailable. */
        readonly evidenceStatuses: readonly string[];
        /** Stable reasons retained for unavailable constituents. */
        readonly reasons: {
            /** A provider-session or process adapter threw. */
            readonly adapterFailure: string;
            /** A step boundary without checkpoint names a session with worlds or processes. */
            readonly boundaryWithoutCheckpoint: string;
            /** A process image exceeds the configured bound. */
            readonly processImageBound: string;
            /** A provider-session adapter holds a different context prefix identity. */
            readonly providerPrefixMismatch: string;
            /** A bound world cannot be captured. */
            readonly worldCapture: string;
        };
    };
    /** Compatibility namespace governing replay evidence. */
    readonly compatibilityVersion: string;
    /** Divergence analysis vocabulary. */
    readonly divergence: {
        /** Divergence causes ordered root, propagated, unexplained. */
        readonly causes: readonly string[];
        /** Maximum number of sessions one N-way diff compares. */
        readonly maxSessions: number;
        /** First-regression search strategies ordered bisect, linear. */
        readonly regressionStrategies: readonly string[];
        /** Alignment statuses ordered identical, diverged, source only, replay only. */
        readonly statuses: readonly string[];
    };
    /** Effect step vocabulary and replay approval policy. */
    readonly effects: {
        /** Reversibility tiers that require policy approval in a branch suffix. */
        readonly approvalRequiredTiers: readonly string[];
        /** Dispositions ordered materialized, materialization failed, refused. */
        readonly dispositions: readonly string[];
        /** Stable refusal reasons. */
        readonly reasons: {
            /** No replay policy was supplied. */
            readonly missingPolicy: string;
            /** The replay policy threw or returned a malformed verdict. */
            readonly policyFailure: string;
        };
    };
    /** Stable public error codes and messages. */
    readonly errors: {
        /** Unavailable replay target code. */
        readonly checkpointUnavailableCode: string;
        /** Unavailable replay target message. */
        readonly checkpointUnavailableMessage: string;
        /** Unsupported replay evidence version code. */
        readonly compatibilityCode: string;
        /** Unsupported replay evidence version message. */
        readonly compatibilityMessage: string;
        /** Refused suffix effect code. */
        readonly effectRefusedCode: string;
        /** Refused suffix effect message. */
        readonly effectRefusedMessage: string;
        /** Invalid replay evidence code. */
        readonly evidenceCode: string;
        /** Invalid replay evidence message. */
        readonly evidenceMessage: string;
        /** Non-terminal session code. */
        readonly interruptedCode: string;
        /** Non-terminal session message. */
        readonly interruptedMessage: string;
        /** Held session lease code. */
        readonly leaseConflictCode: string;
        /** Held session lease message. */
        readonly leaseConflictMessage: string;
        /** Fenced session lease code. */
        readonly leaseFencedCode: string;
        /** Fenced session lease message. */
        readonly leaseFencedMessage: string;
        /** Uncertain effect materialization code. */
        readonly materializationUncertainCode: string;
        /** Uncertain effect materialization message. */
        readonly materializationUncertainMessage: string;
        /** Prefix mismatch code. */
        readonly prefixMismatchCode: string;
        /** Prefix mismatch message. */
        readonly prefixMismatchMessage: string;
        /** Failed restoration code. */
        readonly restoreCode: string;
        /** Failed restoration message. */
        readonly restoreMessage: string;
        /** Failed provider or effect step code. */
        readonly stepFailureCode: string;
        /** Failed provider or effect step message. */
        readonly stepFailureMessage: string;
    };
    /** Deterministic identity derivation. */
    readonly identity: {
        /** Prefix of checkpoint identities. */
        readonly checkpointIdPrefix: string;
        /** Canonical key naming replay command append intents. */
        readonly commandAppendIntentKind: string;
        /** Prefix of chained provider context prefix identities. */
        readonly contextPrefixIdPrefix: string;
        /** Prefix of published replay cut identities. */
        readonly cutIdPrefix: string;
        /** Prefix of irreversible-effect frontier identities. */
        readonly frontierIdPrefix: string;
        /** Prefix of chained session prefix identities. */
        readonly prefixIdPrefix: string;
        /** Prefix of provider prompt identities. */
        readonly promptIdPrefix: string;
        /** Prefix of provider response output identities. */
        readonly responseIdPrefix: string;
        /** Prefix of replay session owner identities. */
        readonly sessionIdPrefix: string;
        /** Prefix of step identities. */
        readonly stepIdPrefix: string;
    };
    /** Session writer lease timing. */
    readonly lease: {
        /** Lease duration granted to a session writer. */
        readonly leaseMilliseconds: number;
        /** Interval after which a running writer renews its lease. */
        readonly renewalMilliseconds: number;
    };
    /** Resource bounds for replay evidence. */
    readonly limits: {
        /** Maximum declared dependencies of one step. */
        readonly maxDependencies: number;
        /** Maximum UTF-8 bytes of a retained program error message. */
        readonly maxErrorMessageBytes: number;
        /** Maximum bytes of one retained process image. */
        readonly maxProcessImageBytes: number;
        /** Maximum processes bound to one session. */
        readonly maxProcesses: number;
        /** Maximum UTF-8 bytes of a retained reason. */
        readonly maxReasonBytes: number;
        /** Maximum steps of one session. */
        readonly maxSteps: number;
        /** Maximum manifest entries of one world image. */
        readonly maxWorldEntries: number;
        /** Maximum worlds bound to one session. */
        readonly maxWorlds: number;
    };
    /** Session modes ordered root, rewind, replay. */
    readonly modes: readonly string[];
    /** Process checkpoint backend configuration. */
    readonly processes: {
        /** Backend kinds ordered cooperative, then transparent. */
        readonly backends: readonly string[];
        /** Structured cooperative process protocol. */
        readonly cooperative: {
            /** Maximum bytes of one protocol line. */
            readonly maxLineBytes: number;
            /** Protocol message type names. */
            readonly messageTypes: {
                /** Checkpoint request type. */
                readonly checkpoint: string;
                /** Child failure response type. */
                readonly error: string;
                /** Checkpoint image response type. */
                readonly image: string;
                /** Application request type. */
                readonly request: string;
                /** Application response type. */
                readonly response: string;
                /** Restore request type. */
                readonly restore: string;
                /** Restore acknowledgement type. */
                readonly restored: string;
            };
            /** Cooperative protocol version sent with every request. */
            readonly protocolVersion: number;
            /** Reason retained when the cooperative process cannot be started. */
            readonly spawnFailedReason: string;
            /** Maximum wait for one protocol response. */
            readonly timeoutMilliseconds: number;
        };
        /** Transparent CRIU probe configuration. */
        readonly transparent: {
            /** Reason retained when the probe passes but capture is unsupported. */
            readonly captureUnsupportedReason: string;
            /** Arguments of the host capability check. */
            readonly checkArguments: readonly string[];
            /** Reason prefix retained when the host check fails. */
            readonly checkFailedReason: string;
            /** Executable probed for transparent checkpoints. */
            readonly executable: string;
            /** Reason retained when the executable cannot be started. */
            readonly executableUnavailableReason: string;
            /** Reason retained on unsupported platforms. */
            readonly platformUnsupportedReason: string;
            /** Node platforms on which the probe runs. */
            readonly platforms: readonly string[];
            /** Maximum wait for the host check. */
            readonly probeTimeoutMilliseconds: number;
        };
    };
    /** Replay record version. */
    readonly recordVersion: number;
    /** Session recovery vocabulary. */
    readonly recovery: {
        /** Classifications ordered terminal, running, interrupted, materialization uncertain. */
        readonly classifications: readonly string[];
    };
    /** Stable JSON Schema identifiers. */
    readonly schemas: {
        /** Admission record schema identifier. */
        readonly admissionId: string;
        /** Checkpoint record schema identifier. */
        readonly checkpointId: string;
        /** Restore record schema identifier. */
        readonly restoreId: string;
        /** Session record schema identifier. */
        readonly sessionId: string;
        /** Step record schema identifier. */
        readonly stepId: string;
        /** Terminal record schema identifier. */
        readonly terminalId: string;
    };
    /** Step vocabulary. */
    readonly steps: {
        /** Step kinds ordered provider, then effect. */
        readonly kinds: readonly string[];
        /** Step sources ordered live, then recorded. */
        readonly sources: readonly string[];
    };
    /** Terminal vocabulary. */
    readonly terminal: {
        /** Statuses ordered finished, failed, cancelled, rewound. */
        readonly statuses: readonly string[];
    };
    /** Retained record schema references. */
    readonly traceSchemas: {
        /** Admission record schema reference. */
        readonly admission: string;
        /** Checkpoint record schema reference. */
        readonly checkpoint: string;
        /** Restore record schema reference. */
        readonly restore: string;
        /** Session record schema reference. */
        readonly session: string;
        /** Step record schema reference. */
        readonly step: string;
        /** Terminal record schema reference. */
        readonly terminal: string;
    };
};

/** Validated live subscription, supervised interception, approval, and context configuration. */
export type SupervisionProtocolConfig = {
    /** Human approval gate vocabulary and bounded waits. */
    readonly approval: {
        /** Approval wait used when a dispatch declares none. */
        readonly defaultWaitMilliseconds: number;
        /** Gates ordered interceptor pause, then irreversible frontier. */
        readonly gates: readonly string[];
        /** Maximum approval wait a dispatch may declare. */
        readonly maxWaitMilliseconds: number;
        /** Approval record phases ordered requested, then resolved. */
        readonly phases: readonly string[];
        /** Delay between retained-verdict checks while waiting. */
        readonly pollIntervalMilliseconds: number;
        /** Effect reversibility tiers that require an approved verdict before admission. */
        readonly requiredTiers: readonly string[];
        /** Verdicts ordered approved, rejected, expired. */
        readonly verdicts: readonly string[];
    };
    /** Generated language-neutral supervision record artifacts. */
    readonly artifacts: {
        /** Repository-relative admission record schema destination. */
        readonly admissionSchema: string;
        /** Repository-relative approval record schema destination. */
        readonly approvalSchema: string;
        /** Repository-relative context injection record schema destination. */
        readonly contextSchema: string;
        /** Repository-relative subscription cursor schema destination. */
        readonly cursorSchema: string;
        /** Repository-relative interception decision record schema destination. */
        readonly decisionSchema: string;
        /** Repository-relative dispatch record schema destination. */
        readonly dispatchSchema: string;
        /** Repository-relative resolution record schema destination. */
        readonly resolutionSchema: string;
    };
    /** Compatibility namespace governing supervision evidence. */
    readonly compatibilityVersion: string;
    /** Stable public error codes and messages. */
    readonly errors: {
        /** Missing or mismatched pending approval code. */
        readonly approvalConflictCode: string;
        /** Missing or mismatched pending approval message. */
        readonly approvalConflictMessage: string;
        /** Invalid subscription cursor code. */
        readonly cursorConflictCode: string;
        /** Invalid subscription cursor message. */
        readonly cursorConflictMessage: string;
        /** Invalid supervision evidence code. */
        readonly evidenceCode: string;
        /** Invalid supervision evidence message. */
        readonly evidenceMessage: string;
        /** Held decision lease code. */
        readonly leaseConflictCode: string;
        /** Held decision lease message. */
        readonly leaseConflictMessage: string;
        /** Fenced decision lease code. */
        readonly leaseFencedCode: string;
        /** Fenced decision lease message. */
        readonly leaseFencedMessage: string;
        /** Uncertain materialization code. */
        readonly materializationUncertainCode: string;
        /** Uncertain materialization message. */
        readonly materializationUncertainMessage: string;
        /** Subscription overflow code. */
        readonly overflowCode: string;
        /** Subscription overflow message. */
        readonly overflowMessage: string;
    };
    /** Deterministic identity derivation. */
    readonly identity: {
        /** Canonical key naming supervision command append intents. */
        readonly commandAppendIntentKind: string;
        /** Prefix of context channel owner identities. */
        readonly contextChannelIdPrefix: string;
        /** Prefix of subscription cursor identities. */
        readonly cursorIdPrefix: string;
        /** Prefix of supervised dispatch owner identities. */
        readonly dispatchIdPrefix: string;
    };
    /** Interceptor decision vocabulary, ordering bounds, leases, and timeout policy. */
    readonly interception: {
        /** Decision lease duration granted to a dispatcher. */
        readonly decisionLeaseMilliseconds: number;
        /** Decision sources ordered interceptor, timeout, failure. */
        readonly decisionSources: readonly string[];
        /** Decisions ordered allow, deny, replace, pause. */
        readonly decisions: readonly string[];
        /** Reversibility tiers for which fail-open is always replaced by fail-closed. */
        readonly failOpenForbiddenTiers: readonly string[];
        /** Interval at which a waiting dispatcher renews its decision lease. */
        readonly leaseRenewalMilliseconds: number;
        /** Maximum interceptors per dispatch. */
        readonly maxInterceptors: number;
        /** Maximum interceptor timeout. */
        readonly maxTimeoutMilliseconds: number;
        /** Timeout policies ordered fail open, then fail closed. */
        readonly timeoutPolicies: readonly string[];
    };
    /** Resource bounds for supervision evidence. */
    readonly limits: {
        /** Maximum records cited by one dispatch or context injection. */
        readonly maxCitedRecords: number;
        /** Maximum canonical bytes of injected context data. */
        readonly maxDataCanonicalBytes: number;
        /** Maximum UTF-8 bytes of a retained reason. */
        readonly maxReasonBytes: number;
    };
    /** Supervision record version. */
    readonly recordVersion: number;
    /** Restart classification vocabulary. */
    readonly recovery: {
        /** Classifications ordered resolved, uncertain, resolution, approval, decision pending. */
        readonly classifications: readonly string[];
    };
    /** Terminal dispatch vocabulary. */
    readonly resolution: {
        /** Dispositions ordered materialized, failed, denied, rejected, cancelled. */
        readonly dispositions: readonly string[];
    };
    /** Stable JSON Schema identifiers. */
    readonly schemas: {
        /** Admission record schema identifier. */
        readonly admissionId: string;
        /** Approval record schema identifier. */
        readonly approvalId: string;
        /** Context injection record schema identifier. */
        readonly contextId: string;
        /** Subscription cursor schema identifier. */
        readonly cursorId: string;
        /** Decision record schema identifier. */
        readonly decisionId: string;
        /** Dispatch record schema identifier. */
        readonly dispatchId: string;
        /** Resolution record schema identifier. */
        readonly resolutionId: string;
    };
    /** Cursor subscription bounds and vocabulary. */
    readonly subscriptions: {
        /** Canonical cursor version. */
        readonly cursorVersion: number;
        /** Buffer capacity used when a subscription declares none. */
        readonly defaultBufferCapacity: number;
        /** Maximum buffer capacity. */
        readonly maxBufferCapacity: number;
        /** Maximum owner paths selected by one subscription. */
        readonly maxOwners: number;
        /** Overflow policies ordered backpressure, then fail. */
        readonly overflowPolicies: readonly string[];
        /** Delay between store reads while no new record is retained. */
        readonly pollIntervalMilliseconds: number;
        /** Start positions ordered origin, then head. */
        readonly startPositions: readonly string[];
    };
    /** Retained record schema references. */
    readonly traceSchemas: {
        /** Admission record schema reference. */
        readonly admission: string;
        /** Approval record schema reference. */
        readonly approval: string;
        /** Context injection record schema reference. */
        readonly context: string;
        /** Decision record schema reference. */
        readonly decision: string;
        /** Dispatch record schema reference. */
        readonly dispatch: string;
        /** Resolution record schema reference. */
        readonly resolution: string;
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
        /** Repository-relative task value schema destination. */
        readonly valueSchema: string;
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
        /** Absolute task value schema identifier, also the `schema.task()` document reference. */
        readonly valueId: string;
    };
    /** Prefix used for stable logical task identifiers. */
    readonly taskIdPrefix: string;
};

/** Configured effect compensation protocol: records, vocabularies, identity, errors, and bounds. */
export type EffectCompensationProtocolConfig = {
    /** Generated language-neutral compensation schema destination. */
    readonly artifacts: {
        /** Repository-relative compensation record schema destination. */
        readonly recordSchema: string;
    };
    /** Compatibility namespace retained on every compensation record. */
    readonly compatibilityVersion: string;
    /** Reversibility tiers whose materialized effects are compensated. */
    readonly compensableTiers: readonly string[];
    /** Stable codes and messages of compensation failures. */
    readonly errors: {
        /** Concurrent-advance code. */
        readonly conflictCode: string;
        /** Concurrent-advance message. */
        readonly conflictMessage: string;
        /** Invalid-evidence code. */
        readonly evidenceCode: string;
        /** Invalid-evidence message. */
        readonly evidenceMessage: string;
        /** Failed-compensation code. */
        readonly failedCode: string;
        /** Failed-compensation message. */
        readonly failedMessage: string;
        /** Missing-handler code. */
        readonly handlerNotFoundCode: string;
        /** Missing-handler message. */
        readonly handlerNotFoundMessage: string;
    };
    /** Materialization evidence kinds: a replay effect step, then a supervised dispatch. */
    readonly evidenceKinds: readonly string[];
    /** Identity derivation settings. */
    readonly identity: {
        /** Append-intent derivation namespace. */
        readonly appendIntentKind: string;
        /** Prefix of compensation identities, which are also their owner paths. */
        readonly compensationIdPrefix: string;
    };
    /** Operational bounds. */
    readonly limits: {
        /** Maximum compensable effects one trigger may compensate. */
        readonly maxEffectsPerTrigger: number;
    };
    /** Outcome statuses: compensated, then failed. */
    readonly outcomes: readonly string[];
    /** Record phases: intent, attempt, then outcome. */
    readonly phases: readonly string[];
    /** Compensation record wire version. */
    readonly recordVersion: number;
    /** Absolute compensation record schema identifier. */
    readonly schemaId: string;
    /** Derived statuses: pending, uncertain, failed, then compensated. */
    readonly statuses: readonly string[];
    /** Trace schema reference of compensation records. */
    readonly traceSchema: string;
    /** Trigger kinds: scope discard, replay rewind, replay replay, then explicit command. */
    readonly triggers: readonly string[];
};

/** Validated effect intent, outcome, identity, compensation, and schema configuration. */
export type EffectProtocolConfig = {
    /** Generated language-neutral effect schema destinations. */
    readonly artifacts: {
        /** Repository-relative effect intent schema destination. */
        readonly intentSchema: string;
        /** Repository-relative effect outcome schema destination. */
        readonly outcomeSchema: string;
    };
    /** Compensation of materialized compensable effects on discard, rewind, and replay. */
    readonly compensation: EffectCompensationProtocolConfig;
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
    /** Proof envelopes attached to run, replay, and delegated child-run inspections. */
    readonly inspection: {
        /** Profile emitted for publication controls outside the base theorem surface. */
        readonly extensionProfile: string;
        /** Carrier-metadata import of non-runtime claims, exposed only as claimed. */
        readonly importedClaim: {
            /** Run-artifact metadata key carrying one imported envelope claim. */
            readonly metadataKey: string;
            /** Stable reasons for refusing to surface an imported claim. */
            readonly rejections: {
                /** More than one retained artifact carries a claim. */
                readonly ambiguous: string;
                /** The claim does not cite a configured proof-evidence identity. */
                readonly evidenceRef: string;
                /** The claim is not an exact configured claim object. */
                readonly malformed: string;
                /** The claim does not cite the configured reference validator. */
                readonly provenance: string;
                /** The claim names only runtime-only strength or profile. */
                readonly runtime: string;
            };
        };
        /** Optional lowering of static replay sessions into Core-A reference records. */
        readonly lowering: {
            /** Replay effect dispositions admitted by the lowering. */
            readonly eligibleDispositions: readonly string[];
            /** Replay session modes admitted by the lowering. */
            readonly eligibleModes: readonly string[];
            /** Replay step kinds admitted by the lowering. */
            readonly eligibleStepKinds: readonly string[];
            /** Replay terminal statuses admitted by the lowering. */
            readonly eligibleTerminalStatuses: readonly string[];
            /** Stable reasons reported when a session is not eligible. */
            readonly ineligibility: {
                /** A step has an effect disposition outside the admitted set. */
                readonly disposition: string;
                /** The session mode is outside the admitted set. */
                readonly mode: string;
                /** A step kind is outside the admitted set. */
                readonly stepKind: string;
                /** The session is not terminal with an admitted status. */
                readonly terminal: string;
            };
            /** Prefix of trace-local identities derived by the lowering. */
            readonly localRefPrefix: string;
            /** Stable lowering version reported in envelope metadata. */
            readonly schemaVersion: string;
        };
        /** Publication-control vocabulary and its runtime evidence sources. */
        readonly publicationControls: {
            /** Control reported for a delegated child run with retained handoffs. */
            readonly delegationHandoff: string;
            /** Closed publication-control vocabulary in reporting order. */
            readonly kinds: readonly string[];
            /** Control reported for each branch replay mode. */
            readonly replayModes: Readonly<Record<string, string>>;
            /** Control reported for a run with retained-world settlement citations. */
            readonly retainedWorldSettlement: string;
        };
        /** Stable envelope reasons for runtime-only and publication-control envelopes. */
        readonly reasons: {
            /** Default production runtime evidence reason. */
            readonly productionRuntime: string;
            /** Publication-control extension reason. */
            readonly publicationControl: string;
        };
    };
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

/** Validated durable isolated-scope registration and fenced emission configuration. */
export type ScopeProtocolConfig = {
    /** Generated language-neutral scope record artifacts. */
    readonly artifacts: {
        /** Repository-relative parent-side child-merge integration schema destination. */
        readonly childMergedSchema: string;
        /** Repository-relative parent-side child-registration schema destination. */
        readonly childRegisteredSchema: string;
        /** Repository-relative scope discard journal schema destination. */
        readonly discardSchema: string;
        /** Repository-relative scope-local emission schema destination. */
        readonly emissionSchema: string;
        /** Repository-relative scope fork journal schema destination. */
        readonly forkSchema: string;
        /** Repository-relative scope merge journal schema destination. */
        readonly mergeSchema: string;
        /** Repository-relative scope registration schema destination. */
        readonly registrationSchema: string;
    };
    /** Closed scope checkpoint descriptor vocabulary. */
    readonly checkpoint: {
        /** Ordered constituent kinds classified by every scope checkpoint. */
        readonly constituentKinds: readonly string[];
        /** Evidence statuses ordered verified, reconstructive, not applicable, unavailable. */
        readonly evidenceStatuses: readonly string[];
        /** Branch start classifications derived from checkpoint evidence. */
        readonly startClassifications: {
            /** Start classification of each supported carrier capture kind. */
            readonly captureKinds: Readonly<Record<string, string>>;
            /** Classifications ordered atomic snapshot, quiescent verified copy, reconstructed. */
            readonly values: readonly string[];
        };
        /** Wire version for scope checkpoint descriptors. */
        readonly version: number;
    };
    /** Closed scope authority vocabulary attenuated per exact resource identity. */
    readonly authority: {
        /** Closed ordered authority atoms shared with repository grants. */
        readonly atoms: readonly string[];
        /** Closed resource kinds that scope authority may cite. */
        readonly resourceKinds: readonly string[];
    };
    /** Closed scope command kinds ordered root registration, child registration, emission, fork, merge, discard. */
    readonly commandKinds: readonly string[];
    /** Compatibility namespace governing scope record evidence. */
    readonly compatibilityVersion: string;
    /** Closed discard journal phases ordered decided then cleaned. */
    readonly discardPhases: readonly string[];
    /** Stable scope error codes and descriptions. */
    readonly errors: {
        /** Stable code for refused authority requests. */
        readonly authorityCode: string;
        /** Stable description for refused authority requests. */
        readonly authorityMessage: string;
        /** Stable code for absent, malformed, or inconsistent scope evidence. */
        readonly evidenceCode: string;
        /** Stable description for absent, malformed, or inconsistent scope evidence. */
        readonly evidenceMessage: string;
        /** Stable code for a stale expected scope head. */
        readonly headConflictCode: string;
        /** Stable description for a stale expected scope head. */
        readonly headConflictMessage: string;
        /** Stable code for overlapping child and current-parent merge changes. */
        readonly mergeConflictCode: string;
        /** Stable description for overlapping child and current-parent merge changes. */
        readonly mergeConflictMessage: string;
        /** Stable code for a scope operation refused because affected scopes are not quiescent. */
        readonly quiescenceCode: string;
        /** Stable description for a scope operation refused because affected scopes are not quiescent. */
        readonly quiescenceMessage: string;
        /** Stable code for a scope that is not open or retains another terminal decision. */
        readonly terminalConflictCode: string;
        /** Stable description for a scope that is not open or retains another terminal decision. */
        readonly terminalConflictMessage: string;
        /** Stable code for a writer claim held by another caller. */
        readonly writerConflictCode: string;
        /** Stable description for a writer claim held by another caller. */
        readonly writerConflictMessage: string;
        /** Stable code for a released, expired, superseded, or unknown writer fence. */
        readonly writerFencedCode: string;
        /** Stable description for a released, expired, superseded, or unknown writer fence. */
        readonly writerFencedMessage: string;
    };
    /** Closed ordered vocabulary classifying retained scope-local history entries. */
    readonly evidenceKinds: readonly string[];
    /** Closed fork journal phases ordered prepared then completed. */
    readonly forkPhases: readonly string[];
    /** Content-addressed scope identity domains. */
    readonly identity: {
        /** Deterministic custody identity kind derived for one scope fork. */
        readonly custodyIdentityKind: string;
        /** Deterministic protected application custody identity kind derived for one merge. */
        readonly mergeCustodyIdentityKind: string;
        /** Deterministic merge child-cut identity prefix. */
        readonly mergeCutIdPrefix: string;
        /** Deterministic fork-origin cut identity prefix. */
        readonly originCutIdPrefix: string;
        /** Content-addressed scope identity prefix. */
        readonly scopeIdPrefix: string;
    };
    /** Closed scope kinds ordered root then child. */
    readonly kinds: readonly string[];
    /** Resource bounds for scope commands. */
    readonly limits: {
        /** Maximum retained records one emission may cite. */
        readonly maxCitedRecords: number;
        /** Maximum selected-history contributions one merge may integrate. */
        readonly maxContributions: number;
        /** Maximum canonical JSON bytes for one emitted application-data value. */
        readonly maxDataCanonicalBytes: number;
        /** Maximum scopes one discard may seal. */
        readonly maxDiscardScopes: number;
        /** Maximum exact resources in one scope authority surface. */
        readonly maxResources: number;
    };
    /** Closed merge journal phases ordered prepared then completed. */
    readonly mergePhases: readonly string[];
    /** Wire version for canonical scope records. */
    readonly recordVersion: number;
    /** Closed restart-recovery and orphan classification vocabulary. */
    readonly recovery: {
        /** Classifications in precedence order. */
        readonly classifications: readonly string[];
        /** Resume actions ordered fork, merge, discard, claim. */
        readonly resumeKinds: readonly string[];
    };
    /** Parallel and nested scope scheduling vocabulary and bounds. */
    readonly scheduling: {
        /** Deterministic command identity suffixes per scheduled step. */
        readonly commandSuffixes: {
            /** Child creation command suffix. */
            readonly create: string;
            /** Child discard command suffix. */
            readonly discard: string;
            /** Scheduled emission command segment. */
            readonly emit: string;
            /** Child merge command suffix. */
            readonly merge: string;
            /** Child writer claim identity suffix. */
            readonly writer: string;
        };
        /** Settlement decisions ordered merge then discard. */
        readonly decisions: readonly string[];
        /** Maximum nesting depth of one scheduled tree. */
        readonly maxDepth: number;
        /** Maximum scheduled nodes in one tree. */
        readonly maxNodes: number;
        /** Maximum sibling subtrees run concurrently. */
        readonly maxParallel: number;
        /** Node outcomes ordered merged, discarded, conflicted, failed. */
        readonly outcomes: readonly string[];
        /** Separator joining node keys into deterministic paths. */
        readonly pathSeparator: string;
    };
    /** Absolute JSON Schema identifiers for scope records. */
    readonly schemas: {
        /** Parent-side child-merge integration schema identifier. */
        readonly childMergedId: string;
        /** Parent-side child-registration schema identifier. */
        readonly childRegisteredId: string;
        /** Scope discard journal schema identifier. */
        readonly discardId: string;
        /** Scope-local emission schema identifier. */
        readonly emissionId: string;
        /** Scope fork journal schema identifier. */
        readonly forkId: string;
        /** Scope merge journal schema identifier. */
        readonly mergeId: string;
        /** Scope registration schema identifier. */
        readonly registrationId: string;
    };
    /** Closed branch-lifecycle states ordered open, merged, discarded. */
    readonly states: readonly string[];
    /** Trace record schema references retained for scope evidence. */
    readonly traceSchemas: {
        /** Parent-owned child-merge integration record schema. */
        readonly childMerged: string;
        /** Parent-owned child-registration control record schema. */
        readonly childRegistered: string;
        /** Scope discard journal record schema. */
        readonly discard: string;
        /** Scope-local application-data emission record schema. */
        readonly emission: string;
        /** Scope fork journal record schema. */
        readonly fork: string;
        /** Scope merge journal record schema. */
        readonly merge: string;
        /** Scope registration record schema. */
        readonly registration: string;
    };
    /** Closed spawn/adopt/abandon/publish vocabulary mapped onto scope evidence. */
    readonly vocabulary: {
        /** Mapping statuses ordered pending then completed. */
        readonly statuses: readonly string[];
        /** Mapped terms ordered spawn, adopt, abandon, publish. */
        readonly terms: readonly string[];
        /** Wire version of the vocabulary projection. */
        readonly version: number;
    };
    /** Closed world-capability vocabulary ordered trace-only then reference copy. */
    readonly worldCapabilities: readonly string[];
    /** Duration granted to a scope writer claim before expiry-based takeover. */
    readonly writerClaimLeaseMilliseconds: number;
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
    /** Optimized world-carrier backend selection, availability, and conformance policy. */
    readonly carrierBackends: {
        /** Closed selectable carrier backend vocabulary. */
        readonly backends: readonly string[];
        /** Reflink/clonefile backend settings. */
        readonly clone: {
            /** Backend name selecting clone materialization. */
            readonly backend: string;
            /** Native clonefile helper used where Node exposes no forced clone primitive. */
            readonly helper: {
                /** Compiler arguments applied before the output argument. */
                readonly compilerArguments: readonly string[];
                /** Absolute compiler executables tried in order. */
                readonly compilerExecutables: readonly string[];
                /** Compiler output-path argument. */
                readonly compilerOutputArgument: string;
                /** Compiled helper file name inside its private directory. */
                readonly executableName: string;
                /** Node platforms that clone through the compiled helper. */
                readonly platforms: readonly string[];
                /** Helper source file name inside its private directory. */
                readonly sourceName: string;
                /** Private temporary helper directory prefix. */
                readonly temporaryDirectoryPrefix: string;
            };
        };
        /** Maximum captured bytes from one backend command. */
        readonly commandMaxBytes: number;
        /** Maximum milliseconds for one backend command. */
        readonly commandTimeoutMs: number;
        /** Optimized-carrier parity evidence vocabulary. */
        readonly conformance: {
            /** Semantic roles for availability reasons. */
            readonly reasonRoles: {
                readonly available: string;
                readonly helperUnavailable: string;
                readonly mountNotPermitted: string;
                readonly platformUnsupported: string;
                readonly reflinkUnsupported: string;
            };
            /** Closed availability reason vocabulary. */
            readonly reasons: readonly string[];
            /** Semantic roles for parity statuses. */
            readonly statusRoles: {
                readonly conformant: string;
                readonly unavailable: string;
            };
            /** Closed parity status vocabulary. */
            readonly statuses: readonly string[];
        };
        /** Backend used when carrier options omit a backend. */
        readonly defaultBackend: string;
        /** Stable fail-closed availability error contract. */
        readonly errors: {
            readonly unavailableCode: string;
            readonly unavailableMessage: string;
        };
        /** Linux overlay custody backend settings. */
        readonly overlay: {
            /** Backend name selecting overlay custody. */
            readonly backend: string;
            /** Kernel filesystem type reported for owned overlay mounts. */
            readonly filesystemType: string;
            /** Mount command argument template. */
            readonly mountArguments: readonly string[];
            /** Absolute mount executable. */
            readonly mountExecutable: string;
            /** Process mount table consulted to authenticate retained mounts. */
            readonly mountInfoPath: string;
            /** Separator between rendered mount options. */
            readonly mountOptionSeparator: string;
            /** Mount option template naming lower, upper, and work layers. */
            readonly mountOptions: string;
            /** Node platforms on which overlay custody may be attempted. */
            readonly platforms: readonly string[];
            /** Characters refused in layer paths because mount options cannot carry them. */
            readonly reservedPathCharacters: readonly string[];
            /** Template tokens substituted into mount and unmount arguments. */
            readonly tokens: {
                readonly lower: string;
                readonly options: string;
                readonly target: string;
                readonly upper: string;
                readonly work: string;
            };
            /** Unmount command argument template. */
            readonly unmountArguments: readonly string[];
            /** Absolute unmount executable. */
            readonly unmountExecutable: string;
            /** Private upper-layer directory inside one custody root. */
            readonly upperDirectory: string;
            /** Private overlay work directory inside one custody root. */
            readonly workDirectory: string;
        };
        /** Backend selection policy: strict refusal or configured fallback ordering. */
        readonly selection: {
            /** Selection mode used when carrier options omit one. */
            readonly defaultMode: string;
            /** Degradation order tried from the requested backend's position in fallback mode. */
            readonly fallbackOrder: readonly string[];
        };
        /** Workspace protocol version that introduced configured carrier backends. */
        readonly version: number;
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
    /** Layered device-layer adapter, checkpoint, depth, and compaction policy. */
    readonly deviceLayers: DeviceLayersConfig;
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
    /**
     * Hardening applied to every Git subprocess: `-c` overrides placed before the subcommand,
     * inherited environment variables removed by name prefix, then configured variables set.
     * Operational only; not part of the workspace protocol identity.
     */
    readonly gitInvocation: {
        readonly configOverrides: readonly string[];
        readonly environment: Readonly<Record<string, string>>;
        readonly removedEnvironmentPrefixes: readonly string[];
    };
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

/** Validated task delegation, child run handle, and delegated authority configuration. */
export type DelegationProtocolConfig = {
    /** Approval verdicts ordered approved, then rejected. */
    readonly approvalVerdicts: readonly string[];
    /** Generated language-neutral delegation record artifacts. */
    readonly artifacts: {
        /** Repository-relative approval record schema destination. */
        readonly approvalSchema: string;
        /** Repository-relative completion record schema destination. */
        readonly completionSchema: string;
        /** Repository-relative context injection record schema destination. */
        readonly contextSchema: string;
        /** Repository-relative decision record schema destination. */
        readonly decisionSchema: string;
        /** Repository-relative handoff record schema destination. */
        readonly handoffSchema: string;
        /** Repository-relative opened record schema destination. */
        readonly openedSchema: string;
    };
    /** Compatibility namespace governing delegation evidence. */
    readonly compatibilityVersion: string;
    /** Context record phases ordered injected, then consumed. */
    readonly contextPhases: readonly string[];
    /** Terminal decision kinds ordered accepted, then discarded. */
    readonly decisionKinds: readonly string[];
    /** Stable error codes and messages. */
    readonly errors: {
        /** Approval-required code. */
        readonly approvalRequiredCode: string;
        /** Approval-required message. */
        readonly approvalRequiredMessage: string;
        /** Authority amplification code. */
        readonly authorityCode: string;
        /** Authority amplification message. */
        readonly authorityMessage: string;
        /** Command identity conflict code. */
        readonly commandConflictCode: string;
        /** Command identity conflict message. */
        readonly commandConflictMessage: string;
        /** Invalid delegation evidence code. */
        readonly evidenceCode: string;
        /** Invalid delegation evidence message. */
        readonly evidenceMessage: string;
        /** Moved handle head code. */
        readonly headConflictCode: string;
        /** Moved handle head message. */
        readonly headConflictMessage: string;
        /** Inadmissible handle status code. */
        readonly statusCode: string;
        /** Inadmissible handle status message. */
        readonly statusMessage: string;
        /** Supervisor mismatch code. */
        readonly supervisorCode: string;
        /** Supervisor mismatch message. */
        readonly supervisorMessage: string;
    };
    /** Child execution kinds ordered provider, then program. */
    readonly executionKinds: readonly string[];
    /** Deterministic identity derivation. */
    readonly identity: {
        /** Prefix of child run identities derived from a handle. */
        readonly childRunIdPrefix: string;
        /** Canonical key naming delegation command append intents. */
        readonly commandAppendIntentKind: string;
        /** Prefix of child run handle identities and owner paths. */
        readonly handleIdPrefix: string;
        /** Prefix of origin cut identities published through a parent handle head. */
        readonly originCutIdPrefix: string;
        /** Canonical key naming accepted output digests. */
        readonly outputDigestKind: string;
        /** Canonical key naming composed provider request digests. */
        readonly requestDigestKind: string;
        /** Prefix of retry cut identities published through a discarded predecessor head. */
        readonly retryCutIdPrefix: string;
    };
    /** Resource bounds for delegation evidence. */
    readonly limits: {
        /** Maximum records one injection or decision may cite. */
        readonly maxCitedRecords: number;
        /** Maximum context injections retained on one handle. */
        readonly maxInjections: number;
        /** Maximum handle nesting depth below a root declaration. */
        readonly maxNestingDepth: number;
        /** Maximum characters of a retained reason. */
        readonly maxReasonLength: number;
        /** Maximum characters of a supervisor identity. */
        readonly maxSupervisorIdLength: number;
        /** Maximum direct handles one delegation tree projection lists. */
        readonly maxTreeEntries: number;
    };
    /** Parent kinds ordered root, then handle. */
    readonly parentKinds: readonly string[];
    /** Task provenance kinds ordered declared, revised, synthesized. */
    readonly provenanceKinds: readonly string[];
    /** Delegation record version. */
    readonly recordVersion: number;
    /** Task fields a revision may change, in configured order. */
    readonly revisionFields: readonly string[];
    /** Stable JSON Schema identifiers. */
    readonly schemas: {
        /** Approval record schema identifier. */
        readonly approvalId: string;
        /** Completion record schema identifier. */
        readonly completionId: string;
        /** Context injection record schema identifier. */
        readonly contextId: string;
        /** Decision record schema identifier. */
        readonly decisionId: string;
        /** Handoff record schema identifier. */
        readonly handoffId: string;
        /** Opened record schema identifier. */
        readonly openedId: string;
    };
    /** Derived handle statuses ordered ready, running, settling, approval pending, rejected, accepted, discarded. */
    readonly statuses: readonly string[];
    /** Retained record schema references. */
    readonly traceSchemas: {
        /** Approval record schema reference. */
        readonly approval: string;
        /** Completion record schema reference. */
        readonly completion: string;
        /** Context injection record schema reference. */
        readonly context: string;
        /** Decision record schema reference. */
        readonly decision: string;
        /** Handoff record schema reference. */
        readonly handoff: string;
        /** Opened record schema reference. */
        readonly opened: string;
    };
    /** Delegation tree projection root kinds ordered handle, then supervisor. */
    readonly treeRootKinds: readonly string[];
};

/** Validated research application manifest, protocol identity, and supervisor configuration. */
export type ApplicationsProtocolConfig = {
    /** Generated language-neutral application record artifacts. */
    readonly artifacts: {
        /** Repository-relative trajectory compression record schema destination. */
        readonly compressionSchema: string;
        /** Repository-relative counterfactual candidate record schema destination. */
        readonly croCandidateSchema: string;
        /** Repository-relative evaluation report schema destination. */
        readonly evaluationSchema: string;
        /** Repository-relative manifest record schema destination. */
        readonly manifestSchema: string;
        /** Repository-relative runtime supervision record schema destination. */
        readonly runtimeSupervisionSchema: string;
        /** Repository-relative supervision record schema destination. */
        readonly supervisionSchema: string;
        /** Repository-relative Tree-RL rollout record schema destination. */
        readonly treeRlRolloutSchema: string;
    };
    /** Compatibility namespace governing application evidence. */
    readonly compatibilityVersion: string;
    /** Trajectory compression vocabulary appended by applications protocol v3. */
    readonly compression: {
        /** Manifest artifact roles cited by trajectory compression. */
        readonly artifactRoles: {
            /** Role of one candidate's terminal record. */
            readonly candidate: string;
            /** Role of the suffix replayed under the hint. */
            readonly compressed: string;
            /** Role of the delegated compressor child. */
            readonly compressor: string;
            /** Role of one seeded best-of-N control rerun. */
            readonly control: string;
            /** Role of the aggregate outcome record. */
            readonly outcome: string;
            /** Role of the original suffix re-run after a rejected compression. */
            readonly restoration: string;
            /** Role of the rewind that restored the fork point. */
            readonly rewind: string;
            /** Role of the recorded source trajectory. */
            readonly source: string;
            /** Role of one delegated verifier child. */
            readonly verifier: string;
        };
        /** Comparison baseline kinds; the first keeps the whole trajectory. */
        readonly baselineKinds: readonly string[];
        /** Protocol budget keys trajectory compression consults. */
        readonly budgetKeys: {
            /** Budget key naming the number of seeded best-of-N control reruns. */
            readonly bestOfN: string;
            /** Budget key bounding live provider calls and child starts across the run. */
            readonly providerCalls: string;
        };
        /** Candidate kinds ordered compression, then best-of-N control. */
        readonly candidateKinds: readonly string[];
        /** Candidate statuses ordered proposed, rewound, settled, rejected. */
        readonly candidateStatuses: readonly string[];
        /** Canonical JSON text fields of the delegated compressor and verifier tasks. */
        readonly childFields: {
            /** Task input field carrying the canonical evidence text. */
            readonly input: string;
            /** Task output field carrying the canonical proposal or verdict text. */
            readonly output: string;
        };
        /**
         * Fork-step policies ordered clamp, then reject: `clamp` moves a proposed step index outside
         * `[0, n - 1]` of an `n`-step source to the nearest bound and retains the clamp as evidence;
         * `reject` refuses the proposal and rejects the candidate.
         */
        readonly forkStepPolicies: readonly string[];
        /** Selected fork-step policy applied to every out-of-range proposal; one of the policies. */
        readonly forkStepPolicy: string;
        /** Compression outcomes ordered pruned, no prune, restored. */
        readonly outcomes: readonly string[];
        /** Compression record phases ordered opened, candidate, outcome. */
        readonly phases: readonly string[];
        /** Retained reasons trajectory compression writes. */
        readonly reasons: {
            /** Reason retained when the compressor proposes no fork point. */
            readonly noForkPoint: string;
            /** Reason retained when the compressed session is not strictly shorter and finished. */
            readonly notAdmissible: string;
            /** Reason retained when a fork point has an unavailable restore constituent. */
            readonly restoreUnavailable: string;
        };
        /** Surface roles the compression protocol must declare. */
        readonly surfaceRoles: {
            /** Role of the fork-point and hint schema. */
            readonly compression: string;
            /** Role of the compressor prompt. */
            readonly compressor: string;
            /** Role of the verifier prompt. */
            readonly verifier: string;
        };
        /** Verifier verdicts ordered accepted, then rejected. */
        readonly verdicts: readonly string[];
    };
    /**
     * Counterfactual replay optimizer vocabulary appended by applications protocol v2 and replaced
     * by applications protocol v9 to follow paper Appendix F.1 Algorithm 1.
     */
    readonly cro: {
        /** Manifest artifact roles cited by the optimizer. */
        readonly artifactRoles: {
            /** Role of the opened record retaining every per-example baseline session. */
            readonly baseline: string;
            /** Role of one candidate's outcome record, which cites its example sessions. */
            readonly candidate: string;
            /** Role of one proposer iteration record, which cites its proposer sessions. */
            readonly proposal: string;
            /** Role of the terminal selection record. */
            readonly selection: string;
        };
        /** Comparison baseline kinds; the first re-runs the whole workflow per branch. */
        readonly baselineKinds: readonly string[];
        /** Integer protocol budget keys the optimizer consults. */
        readonly budgetKeys: {
            /** Budget key bounding the total candidate count over every iteration. */
            readonly candidates: string;
            /** Budget key naming the proposer iteration count N. */
            readonly iterations: string;
            /** Budget key bounding proposer attempts per iteration, including repairs. */
            readonly proposalAttempts: string;
            /** Budget key bounding the edits k one proposal may carry. */
            readonly proposals: string;
            /** Budget key bounding live provider calls across every session the run opens. */
            readonly providerCalls: string;
            /** Budget key naming the verbalized-sampling floor of enumerated mechanisms. */
            readonly reflectionMechanisms: string;
        };
        /** Candidate outcome statuses ordered archived, evaluated, promoted, rejected. */
        readonly candidateStatuses: readonly string[];
        /**
         * Declared candidate edit scopes ordered request, then downstream: a request edit changes the
         * edited step's own request and replays from the boundary before the edited step; a
         * downstream edit changes only how later steps consume it and replays from the boundary
         * before the first dependent.
         */
        readonly editScopes: readonly string[];
        /** Example result roles ordered fix, guard, dev, train. */
        readonly exampleRoles: readonly string[];
        /** Record phases ordered opened, proposal, candidate, selection. */
        readonly phases: readonly string[];
        /** Provider-backed proposer tool loop. */
        readonly proposer: {
            /** Prefix of every proposer tool's effect kind; the tool name completes it. */
            readonly effectKindPrefix: string;
            /** Proposer bounds. */
            readonly limits: {
                /** Default tool-loop turn bound. */
                readonly defaultMaxTurns: number;
                /** Maximum characters of one grep match excerpt. */
                readonly maxExcerptLength: number;
                /** Maximum grep matches returned per call. */
                readonly maxGrepMatches: number;
                /** Maximum grep pattern length. */
                readonly maxPatternLength: number;
                /** Maximum step summaries one trace read returns. */
                readonly maxTraceSteps: number;
            };
            /** Tool names of the proposer operations. */
            readonly operations: {
                /** Regex search across one candidate's example traces. */
                readonly grepTraces: string;
                /** Read the candidate pool. */
                readonly inspectCandidates: string;
                /** Propose one edit with its fix and guard sets. */
                readonly proposeCandidate: string;
                /** Read one candidate's trace on one example. */
                readonly readTrace: string;
            };
            /** Program identity of every proposer tool-loop session. */
            readonly programId: string;
        };
        /** Reflection contract field names and the near-duplicate explanation phrase. */
        readonly reflection: {
            /** Case-folded phrase a near-duplicate explanation must contain. */
            readonly differsByPhrase: string;
            /** Reflection and edit field names the contract reads. */
            readonly fields: {
                /** Reflection field listing findings that cite prior candidates. */
                readonly findings: string;
                /** Reflection field enumerating considered mechanisms with priors. */
                readonly hypotheses: string;
                /** Hypothesis field naming a mechanism. */
                readonly mechanism: string;
                /** Reflection field naming the parent, or null for the baseline. */
                readonly parent: string;
                /** Hypothesis field carrying a prior. */
                readonly prior: string;
            };
        };
        /** Example splits ordered train, then dev. */
        readonly splits: readonly string[];
        /** Surface roles the optimizer protocol must declare. */
        readonly surfaceRoles: {
            /** Role of the handoff manifest schema. */
            readonly handoff: string;
            /** Role of the proposer prompt and tools. */
            readonly proposer: string;
            /** Role of the reflection schema. */
            readonly reflection: string;
        };
        /** Fractional protocol threshold keys the optimizer consults. */
        readonly thresholdKeys: {
            /** Prior ceiling at least one selected edit must fall strictly below. */
            readonly audaciousPrior: string;
            /** Jaccard token similarity at which a mechanism is a near-duplicate. */
            readonly duplicateSimilarity: string;
            /** Fraction of fix examples that must score strictly above the parent. */
            readonly improveThreshold: string;
            /** Largest score drop a guard example may show against the parent. */
            readonly maxScoreDrop: string;
            /** Minimum dev score a promoted candidate reaches. */
            readonly minPromotionScore: string;
            /** Minimum mean score lift over the parent on the fix and guard union. */
            readonly minScoreLift: string;
            /** Dev score distance from the current promoted candidate within which to promote. */
            readonly promoteDevEpsilon: string;
        };
    };
    /** Stable error codes and messages. */
    readonly errors: {
        /** Exceeded protocol budget code. */
        readonly budgetCode: string;
        /** Exceeded protocol budget message. */
        readonly budgetMessage: string;
        /** Invalid application evidence code. */
        readonly evidenceCode: string;
        /** Invalid application evidence message. */
        readonly evidenceMessage: string;
        /** Malformed or mismatched protocol definition code. */
        readonly protocolCode: string;
        /** Malformed or mismatched protocol definition message. */
        readonly protocolMessage: string;
        /** Verifier rejection code. */
        readonly verificationCode: string;
        /** Verifier rejection message. */
        readonly verificationMessage: string;
    };
    /** Evaluation report vocabulary appended by applications protocol v5. */
    readonly evaluation: {
        /** Evaluation definition bounds. */
        readonly limits: {
            /** Maximum experiments one evaluation definition declares. */
            readonly maxExperiments: number;
            /** Maximum characters of one published limitation. */
            readonly maxLimitationLength: number;
            /** Maximum limitations one evaluation definition declares. */
            readonly maxLimitations: number;
        };
        /** Measured metrics ordered cost, provider calls, input tokens, output tokens, steps, success. */
        readonly metrics: readonly string[];
        /** Evaluation report version. */
        readonly reportVersion: number;
        /** Coding supervisor comparison baseline kinds; the first runs one worker without a policy. */
        readonly supervisionBaselineKinds: readonly string[];
    };
    /** Deterministic identity derivation. */
    readonly identity: {
        /** Prefix of application identities and reserved owner paths. */
        readonly applicationIdPrefix: string;
        /** Prefix of artifact citation identities. */
        readonly artifactIdPrefix: string;
        /** Prefix of counterfactual candidate identities. */
        readonly candidateIdPrefix: string;
        /** Canonical key naming application command append intents. */
        readonly commandAppendIntentKind: string;
        /** Prefix of terminal application cut identities. */
        readonly cutIdPrefix: string;
        /** Secure hash algorithm behind every application digest. */
        readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
        /** Prefix of compression fork-point identities. */
        readonly forkPointIdPrefix: string;
        /** Prefix of manifest identities. */
        readonly manifestIdPrefix: string;
        /** Prefix of protocol definition identities. */
        readonly protocolIdPrefix: string;
        /** Prefix of evaluation report identities. */
        readonly reportIdPrefix: string;
        /** Prefix of Tree-RL rollout identities. */
        readonly rolloutIdPrefix: string;
    };
    /** Application kinds ordered coding supervisor, counterfactual optimization, trajectory compression, Tree-RL. */
    readonly kinds: readonly string[];
    /** Resource bounds for application evidence. */
    readonly limits: {
        /** Maximum artifact citations one manifest carries. */
        readonly maxArtifacts: number;
        /** Maximum best-of-N control candidates. */
        readonly maxBestOfN: number;
        /** Maximum rollout branches per fork point. */
        readonly maxBranches: number;
        /** Maximum counterfactual candidates per run. */
        readonly maxCandidates: number;
        /** Maximum dataset items one protocol selects. */
        readonly maxDatasetItems: number;
        /** Maximum fork points per run. */
        readonly maxForkPoints: number;
        /** Maximum UTF-8 bytes of one prompt surface. */
        readonly maxPromptBytes: number;
        /** Maximum characters of a retained reason. */
        readonly maxReasonLength: number;
        /** Maximum rollouts per run. */
        readonly maxRollouts: number;
        /** Maximum supervisor observation rounds per run. */
        readonly maxRounds: number;
        /** Maximum canonical bytes of one schema surface. */
        readonly maxSchemaBytes: number;
        /** Maximum seeds one protocol declares. */
        readonly maxSeeds: number;
        /** Maximum surfaces one protocol declares. */
        readonly maxSurfaces: number;
        /** Maximum runtime supervisor tick interval in milliseconds. */
        readonly maxTickIntervalMilliseconds: number;
        /** Maximum runtime supervisor ticks per run. */
        readonly maxTicks: number;
        /** Maximum canonical bytes of one tool surface. */
        readonly maxToolBytes: number;
        /** Maximum supervised workers per run. */
        readonly maxWorkers: number;
        /** Minimum supervised workers per run. */
        readonly minWorkers: number;
    };
    /** Manifest record version. */
    readonly manifestVersion: number;
    /** Protocol surface kinds ordered prompt, schema, tool. */
    readonly protocolSurfaces: readonly string[];
    /** Application record version. */
    readonly recordVersion: number;
    /**
     * Concurrent runtime supervisor vocabulary appended by applications protocol v10: paper
     * Section 5.1 and Appendix E per-tick batched decisions over concurrently running workers.
     */
    readonly runtimeSupervision: {
        /** Appendix E decision actions ordered none, inject, handoff, discard. */
        readonly actions: readonly string[];
        /** Manifest artifact roles cited by the runtime supervisor. */
        readonly artifactRoles: {
            /** Role of the retained settlement record. */
            readonly settlement: string;
            /** Role of a world discard receipt retained at settlement. */
            readonly worldDiscard: string;
            /** Role of the final world fork receipt of one worker. */
            readonly worldFork: string;
            /** Role of one worker stream head. */
            readonly workerStream: string;
        };
        /** Worker attempt causes ordered start, handoff, discard. */
        readonly attemptCauses: readonly string[];
        /** Worker attempt statuses ordered running, completed, turn limit, failed, aborted. */
        readonly attemptStatuses: readonly string[];
        /** Protocol budget keys the runtime supervisor consults. */
        readonly budgetKeys: {
            /** Budget key bounding the feature characters shown per agent. */
            readonly featureCharacters: string;
            /** Budget key bounding guidance words per decision. */
            readonly guidanceWords: string;
            /** Budget key bounding worker model turns plus policy consultations. */
            readonly providerCalls: string;
            /** Budget key bounding reason words per decision. */
            readonly reasonWords: string;
            /** Budget key naming the tick cadence in milliseconds. */
            readonly tickInterval: string;
            /** Budget key bounding ticks per run. */
            readonly ticks: string;
            /** Budget key bounding the canonical bytes of one tool-call summary. */
            readonly toolCallSummaryBytes: string;
            /** Budget key naming the trailing tool-call summaries shown per agent. */
            readonly trailingToolCalls: string;
            /** Budget key bounding model turns per worker attempt. */
            readonly turnsPerWorker: string;
        };
        /** Separator joining several pending guidance texts delivered at one turn boundary. */
        readonly guidanceSeparator: string;
        /** Record phases ordered opened, tick, settled, attempt, turn, completed. */
        readonly phases: readonly string[];
        /** Surface roles the runtime supervisor protocol must declare. */
        readonly surfaceRoles: {
            /** Role of the system prompt and decision schema. */
            readonly action: string;
            /** Role of the snapshot prompt and schema. */
            readonly observation: string;
        };
        /** Tool input keys searched, in order, for the primary target of a tool-call summary. */
        readonly targetInputKeys: readonly string[];
        /** Marker appended to truncated snapshot text. */
        readonly truncationMarker: string;
    };
    /** Stable JSON Schema identifiers. */
    readonly schemas: {
        /** Trajectory compression record schema identifier. */
        readonly compressionId: string;
        /** Counterfactual candidate record schema identifier. */
        readonly croCandidateId: string;
        /** Evaluation report schema identifier. */
        readonly evaluationId: string;
        /** Manifest record schema identifier. */
        readonly manifestId: string;
        /** Runtime supervision record schema identifier. */
        readonly runtimeSupervisionId: string;
        /** Supervision record schema identifier. */
        readonly supervisionId: string;
        /** Tree-RL rollout record schema identifier. */
        readonly treeRlRolloutId: string;
    };
    /** Coding supervisor vocabulary. */
    readonly supervision: {
        /** Manifest artifact roles cited by the supervisor. */
        readonly artifactRoles: {
            /** Role of a retained supervision decision record. */
            readonly decision: string;
            /** Role of one worker attempt and its cut. */
            readonly worker: string;
            /** Role of a world discard receipt. */
            readonly worldDiscard: string;
            /** Role of a world fork receipt. */
            readonly worldFork: string;
            /** Role of a world merge receipt. */
            readonly worldMerge: string;
        };
        /** Protocol budget keys the supervisor consults. */
        readonly budgetKeys: {
            /** Budget key bounding total worker starts. */
            readonly providerCalls: string;
            /** Budget key bounding observation rounds. */
            readonly rounds: string;
            /** Run budget metric mapped to the protocol budget key bounding each worker. */
            readonly worker: Readonly<Record<string, string>>;
        };
        /** Conflict classifications ordered none, then path overlap. */
        readonly conflictKinds: readonly string[];
        /** Supervision record phases ordered opened, then decision. */
        readonly phases: readonly string[];
        /** Policy decision kinds ordered observe, inject, handoff, discard/restart, accept. */
        readonly policyKinds: readonly string[];
        /** Retained reasons the supervisor writes. */
        readonly reasons: {
            /** Discard reason retained on every worker the accept decision did not select. */
            readonly notAccepted: string;
        };
        /** Surface roles the coding supervisor protocol must declare. */
        readonly surfaceRoles: {
            /** Role of the action prompt and schema. */
            readonly action: string;
            /** Role of the observation prompt and schema. */
            readonly observation: string;
        };
        /** Worker lineage statuses ordered running, accepted, discarded, restarted, handed off. */
        readonly workerStatuses: readonly string[];
    };
    /** Retained record schema references. */
    readonly traceSchemas: {
        /** Trajectory compression record schema reference. */
        readonly compression: string;
        /** Counterfactual optimizer record schema reference. */
        readonly croCandidate: string;
        /** Manifest record schema reference. */
        readonly manifest: string;
        /** Runtime supervision record schema reference. */
        readonly runtimeSupervision: string;
        /** Supervision record schema reference. */
        readonly supervision: string;
        /** Tree-RL rollout record schema reference. */
        readonly treeRlRollout: string;
    };
    /**
     * Tree-RL adapter vocabulary appended by applications protocol v4 and aligned with Algorithm 2
     * of the paper by applications protocol v8.
     */
    readonly treeRl: {
        /** Per-action advantage segments ordered prefix, suffix, then flat (baseline). */
        readonly actionSegments: readonly string[];
        /** Algorithm 2 advantage normalization. */
        readonly advantage: {
            /** Positive constant added to the group standard deviation before dividing. */
            readonly epsilon: number;
            /** Default normalization, one of `normalizations`. */
            readonly normalization: string;
            /** Normalizations ordered none (raw centered) then per-group standardization. */
            readonly normalizations: readonly string[];
            /** Standard deviation estimator, one of `stdEstimators`. */
            readonly stdEstimator: string;
            /** Standard deviation estimators ordered population then sample. */
            readonly stdEstimators: readonly string[];
        };
        /** Manifest artifact roles cited by the Tree-RL adapter. */
        readonly artifactRoles: {
            /** Role of the flat GRPO baseline batch. */
            readonly baselineBatch: string;
            /** Role of the training batch. */
            readonly batch: string;
            /** Role of one graded root record. */
            readonly root: string;
            /** Role of one rollout record. */
            readonly rollout: string;
        };
        /** Comparison baseline kinds; the first is flat GRPO over the roots only. */
        readonly baselineKinds: readonly string[];
        /** Training batch formats; the first is the canonical per-action JSON lines format. */
        readonly batchFormats: readonly string[];
        /** Protocol budget keys the Tree-RL adapter consults. */
        readonly budgetKeys: {
            /** Budget key naming the branch count K per root. */
            readonly branches: string;
            /** Budget key naming the root count G per prompt. */
            readonly groupSize: string;
            /** Budget key bounding live provider calls across every rollout session. */
            readonly providerCalls: string;
        };
        /** Admissible fork-turn range `[first, T - trailing]` over a root of `T` turns. */
        readonly forkTurn: {
            /** First admissible one-based fork turn. */
            readonly first: number;
            /** Turns kept after the last admissible fork turn. */
            readonly trailing: number;
        };
        /** Tree-RL batch and concurrency bounds. */
        readonly limits: {
            /** Concurrent root gradings and branch rollouts when the caller names none. */
            readonly defaultConcurrency: number;
            /** Largest admissible concurrency. */
            readonly maxConcurrency: number;
            /** Largest admissible root count G per prompt. */
            readonly maxGroupSize: number;
            /** Largest admissible prompt count B per batch. */
            readonly maxPrompts: number;
        };
        /** Tree member kinds ordered root then branch. */
        readonly memberKinds: readonly string[];
        /** Tree-RL record phases ordered opened, root, rollout, batch. */
        readonly phases: readonly string[];
        /** Retained reasons the Tree-RL adapter writes. */
        readonly reasons: {
            /** Reason the dependency fork selector gives for its proposal. */
            readonly dependencySelection: string;
            /** Reason retained when a rollout diverged before its fork point or without explanation. */
            readonly diverged: string;
            /** Reason retained when a rollout session was left non-terminal by a dead writer. */
            readonly interrupted: string;
            /** Reason retained when a rollout session did not finish. */
            readonly notFinished: string;
            /** Reason retained when the reward function threw or returned a non-finite reward. */
            readonly rewardFailed: string;
        };
        /** Rollout statuses ordered completed, then failed. */
        readonly rolloutStatuses: readonly string[];
        /** Surface roles of a Tree-RL protocol. */
        readonly surfaceRoles: {
            /** Role of the training batch line schema (required). */
            readonly batch: string;
            /** Role of the meta-agent fork proposal schema (meta-agent selector only). */
            readonly forkProposal: string;
            /** Role of the meta-agent fork selection prompt (meta-agent selector only). */
            readonly forkSelector: string;
            /** Role of the rollout policy prompt (required). */
            readonly rollout: string;
        };
    };
};

/** One configured pattern-based secret detector. */
export type SecretClassConfig = {
    /** Regular-expression flags; always includes Unicode mode. */
    readonly flags: string;
    /** Stable secret-class name reported instead of matched text. */
    readonly name: string;
    /** Regular-expression source matched against strings and object keys. */
    readonly pattern: string;
};

/** One configured mapping from a protocol schema family (or single schema) to a data class. */
export type SchemaFamilyConfig = {
    /** Configured data class applied to every schema identifier under the path. */
    readonly dataClass: string;
    /** Dot-separated protocol configuration path of a schema family or single schema. */
    readonly path: string;
};

/** Versioned secret-scanning, data-class, redacted-export, and store-file configuration. */
export type RetentionProtocolConfig = {
    /** Generated redacted-archive and retention-report schema destinations. */
    readonly artifacts: {
        readonly redactedArchiveSchema: string;
        readonly reportSchema: string;
    };
    /** Compatibility namespace for retention evidence. */
    readonly compatibilityVersion: string;
    /** Closed data-class vocabulary. */
    readonly dataClasses: readonly string[];
    /** Data class applied to schema identifiers no configured family names. */
    readonly defaultDataClass: string;
    /** Digest algorithm for finding and body digests. */
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    /** Prefix identifying the digest algorithm. */
    readonly digestPrefix: string;
    /** Closed export-disposition vocabulary. */
    readonly dispositions: readonly string[];
    /** Export disposition of every configured data class. */
    readonly exportDispositions: Readonly<Record<string, string>>;
    /** Protocol configuration keys whose objects are schema families requiring a mapping. */
    readonly familyKeys: readonly string[];
    /** Resource bounds for findings and report entries. */
    readonly limits: {
        readonly maxFindings: number;
        readonly maxReportedRecords: number;
    };
    /** Redacted archive wire identity. */
    readonly redactedArchive: {
        readonly format: string;
        readonly formatVersion: number;
    };
    /** Retention report wire identity. */
    readonly report: {
        readonly format: string;
        readonly formatVersion: number;
    };
    /** Store append scanning modes and the default. */
    readonly scanning: {
        readonly defaultMode: string;
        /**
         * Prefix of secret-finding digests, which are keyed with a random per-process key so a
         * reported digest cannot confirm a guessed secret.
         */
        readonly findingDigestPrefix: string;
        readonly modes: readonly string[];
    };
    /** Resolved data class of every configured schema identifier. */
    readonly schemaDataClasses: Readonly<Record<string, string>>;
    /** Configured schema-family mappings. */
    readonly schemaFamilies: readonly SchemaFamilyConfig[];
    /** Published schema identifiers. */
    readonly schemas: {
        readonly redactedArchiveId: string;
        readonly reportId: string;
    };
    /** Configured secret detectors in configuration order. */
    readonly secretClasses: readonly SecretClassConfig[];
    /** Owner-only mode applied to SQLite database files and their sidecars. */
    readonly storeFiles: {
        /** Numeric permission bits parsed from the configured octal string. */
        readonly mode: number;
        /** Sidecar file suffixes tightened beside a database file. */
        readonly sidecarSuffixes: readonly string[];
    };
};

/** Versioned remote-storage interface, reference-adapter, and conformance configuration. */
export type StorageProtocolConfig = {
    /** Blob-store backend listing bounds. */
    readonly blobs: {
        /** Page size used when a list request names no limit. */
        readonly defaultListLimit: number;
        /** Largest page size a list request may name. */
        readonly maxListLimit: number;
    };
    /** Compatibility namespace for storage interfaces. */
    readonly compatibilityVersion: string;
    /** SQLite durability and migration contract of the reference storage coordinator. */
    readonly coordinator: {
        /** Time SQLite waits for a competing coordinator writer. */
        readonly busyTimeoutMilliseconds: number;
        /** Whether SQLite defensive mode is enabled. */
        readonly defensive: true;
        /** Whether SQLite foreign-key enforcement is enabled. */
        readonly foreignKeys: true;
        /** Configured durable SQLite journal mode. */
        readonly journalMode: (typeof STORE_JOURNAL_MODES)[number];
        /** Contiguous implemented coordinator migration versions. */
        readonly migrations: NonEmptyReadonlyArray<number>;
        /** Latest supported coordinator schema version. */
        readonly schemaVersion: number;
        /** Configured durable SQLite synchronization level. */
        readonly synchronous: (typeof STORE_SYNCHRONOUS_LEVELS)[number];
        /** Transaction mode used to serialize reference swaps and lease changes. */
        readonly transactionMode: (typeof STORE_TRANSACTION_MODES)[number];
    };
    /** Closed durability vocabulary a backend or coordinator declares. */
    readonly durabilities: readonly string[];
    /** Lease owner and time-to-live bounds. */
    readonly leases: {
        /** Longest accepted lease-owner identity. */
        readonly maxOwnerLength: number;
        /** Longest accepted lease time-to-live. */
        readonly maxTtlMilliseconds: number;
        /** Shortest accepted lease time-to-live. */
        readonly minTtlMilliseconds: number;
    };
    /** Grammar shared by reference names and lease keys. */
    readonly names: {
        /** Longest accepted name. */
        readonly maxLength: number;
        /** Unicode-mode regular-expression source every name must match. */
        readonly pattern: string;
    };
    /** Reference value bounds. */
    readonly refs: {
        /** Longest accepted reference value. */
        readonly maxValueLength: number;
    };
    /** Closed result-status vocabularies. */
    readonly statuses: {
        /** Lease statuses: acquired, held, renewed, released, fenced. */
        readonly lease: readonly string[];
        /** Reference swap statuses: swapped, conflict, fenced. */
        readonly refSwap: readonly string[];
    };
};

/** Versioned trace-store backup, verification, and restore configuration. */
export type BackupProtocolConfig = {
    /** Generated backup-manifest schema destination. */
    readonly artifacts: {
        readonly manifestSchema: string;
    };
    /** Where backed-up blob bytes live: the backup directory or a caller-supplied backend. */
    readonly blobLocations: readonly string[];
    /** Compatibility namespace for backup evidence. */
    readonly compatibilityVersion: string;
    /**
     * Rollback-journal mode a backup database copy is switched to after the online copy, so the
     * copy is one self-contained file without write-ahead-log sidecars.
     */
    readonly databaseJournalMode: (typeof BACKUP_JOURNAL_MODES)[number];
    /** Hash algorithm for database, export, blob-list, and manifest digests. */
    readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
    /** Digest prefix naming the configured algorithm. */
    readonly digestPrefix: string;
    /** Numeric owner-only permission bits of backup and staging directories. */
    readonly directoryMode: number;
    /** Closed classification vocabulary of refused or failed backup operations. */
    readonly failureReasons: readonly string[];
    /** File names inside a backup directory and restore staging names. */
    readonly layout: {
        /** Blob directory inside a backup whose blobs live in the backup directory. */
        readonly blobDirectory: string;
        /** Database copy inside a backup directory. */
        readonly database: string;
        /** Manifest written last; its presence marks a complete backup. */
        readonly manifest: string;
        /** Prefix of a restore staging directory created beside the target. */
        readonly stagingPrefix: string;
        /** Suffix of a manifest written before its atomic rename. */
        readonly temporarySuffix: string;
    };
    /** Backup resource bounds. */
    readonly limits: {
        /** Largest manifest a verifier reads. */
        readonly maxManifestBytes: number;
        /** SQLite pages copied per online-backup step. */
        readonly pagesPerStep: number;
    };
    /** Manifest wire identity. */
    readonly manifest: {
        readonly format: string;
        readonly formatVersion: number;
    };
    /** Published schema identifiers. */
    readonly schemas: {
        readonly manifestId: string;
    };
};

/** Versioned non-canonical OpenTelemetry-compatible telemetry configuration. */
export type ObservabilityProtocolConfig = {
    /** Generated telemetry-batch schema destination. */
    readonly artifacts: {
        readonly batchSchema: string;
    };
    /** Attribute-key prefix of every Shepherd-defined telemetry attribute. */
    readonly attributeNamespace: string;
    /** Telemetry batch wire identity. */
    readonly batch: {
        readonly format: string;
        readonly formatVersion: number;
    };
    /** Record-body export vocabulary. */
    readonly bodies: {
        /** Exporter body mode used when the caller supplies none. */
        readonly defaultMode: string;
        /** Closed vocabulary describing how one record body was handled. */
        readonly handlings: readonly string[];
        /** Closed vocabulary of exporter body modes. */
        readonly modes: readonly string[];
    };
    /** Compatibility namespace, also reported as the instrumentation-scope version. */
    readonly compatibilityVersion: string;
    /** Deterministic trace and span identifier derivation. */
    readonly ids: {
        /** Hash algorithm whose hex digest prefix becomes an identifier. */
        readonly digestAlgorithm: (typeof SECURE_HASH_ALGORITHMS)[number];
        /** Domain separator hashed before a record identity to derive a span identifier. */
        readonly spanDomain: string;
        /** Domain separator hashed before an owner path to derive a trace identifier. */
        readonly traceDomain: string;
    };
    /** Instrumentation-scope name of every exported scope. */
    readonly instrumentationScopeName: string;
    /** Export resource bounds. */
    readonly limits: {
        /** Records per batch when the caller supplies no bound. */
        readonly defaultRecordsPerBatch: number;
        /** Largest canonical body, in UTF-8 bytes, exported as a log-record body. */
        readonly maxBodyBytes: number;
        /** Largest accepted records-per-batch bound. */
        readonly maxRecordsPerBatch: number;
    };
    /** OTLP wire constants of the targeted opentelemetry-proto release. */
    readonly otlp: {
        /** OTLP `SeverityNumber` of every exported log record. */
        readonly logSeverityNumber: number;
        /** Severity text of every exported log record. */
        readonly logSeverityText: string;
        /** Targeted opentelemetry-proto release. */
        readonly protoVersion: string;
        /** OTLP `SpanKind` of every exported run span. */
        readonly spanKind: number;
        /** OTLP `Status.StatusCode` values keyed by configured terminal status. */
        readonly statusCodes: Readonly<Record<string, number>>;
    };
    /** String resource attributes of every exported resource. */
    readonly resourceAttributes: Readonly<Record<string, string>>;
    /** Run lifecycle records that open and close one run span. */
    readonly runSpans: {
        /** Span name. */
        readonly name: string;
        /** Schema identifiers that start a run span. */
        readonly startSchemaRefs: readonly string[];
        /** Schema identifiers that end a run span, mapped to their configured status. */
        readonly terminalSchemaRefs: Readonly<Record<string, string>>;
    };
    /** Published schema identifiers. */
    readonly schemas: {
        readonly batchId: string;
    };
    /** Semantic-conventions release named by exported schema URLs. */
    readonly semanticConventions: {
        readonly schemaUrlPrefix: string;
        readonly version: string;
    };
};

/** Complete validated language-neutral protocol configuration. */
export type ProtocolConfig = {
    readonly applications: ApplicationsProtocolConfig;
    readonly backup: BackupProtocolConfig;
    readonly observability: ObservabilityProtocolConfig;
    readonly cli: CliProtocolConfig;
    readonly delegation: DelegationProtocolConfig;
    readonly effects: EffectProtocolConfig;
    readonly formalAssurance: FormalAssuranceProtocolConfig;
    readonly kernel: KernelProtocolConfig;
    readonly orphanRepair: OrphanRepairProtocolConfig;
    readonly projections: ProjectionProtocolConfig;
    readonly providers: ProviderProtocolConfig;
    readonly recordId: RecordIdConfig;
    readonly replay: ReplayProtocolConfig;
    readonly retention: RetentionProtocolConfig;
    readonly runs: RunProtocolConfig;
    readonly scopes: ScopeProtocolConfig;
    readonly storage: StorageProtocolConfig;
    readonly supervision: SupervisionProtocolConfig;
    readonly tasks: TaskProtocolConfig;
    readonly workspaces: WorkspaceProtocolConfig;
};

/** Validated workspace protocol v27 device-layer configuration. */
export type DeviceLayersConfig = {
    /** Built-in adapter names by role. */
    readonly adapters: {
        readonly clone: string;
        readonly container: string;
        readonly copy: string;
        readonly overlay: string;
    };
    /** Checkpoint name carried by the seeded base layer of every new world. */
    readonly baseCheckpointName: string;
    /** Regular expression every checkpoint name must match. */
    readonly checkpointNamePattern: string;
    /** Maximum captured bytes from one adapter command. */
    readonly commandMaxBytes: number;
    /** Maximum milliseconds for one adapter command. */
    readonly commandTimeoutMs: number;
    /** Conformance-kit workload: checkpoints frozen under a small depth bound. */
    readonly conformance: {
        /** Checkpoints the depth case freezes; enough to force at least one compaction. */
        readonly checkpoints: number;
        /** Depth bound applied by the depth case. */
        readonly maxDepth: number;
        /** Compaction retention applied by the depth case. */
        readonly retainNewest: number;
    };
    /** Reference container adapter driven through a container CLI. */
    readonly container: {
        /** Container CLI argument templates by operation. */
        readonly arguments: {
            readonly commit: readonly string[];
            readonly copyIn: readonly string[];
            readonly create: readonly string[];
            readonly exec: readonly string[];
            readonly export: readonly string[];
            readonly import: readonly string[];
            readonly inspectImage: readonly string[];
            readonly probe: readonly string[];
            readonly removeContainer: readonly string[];
            readonly removeImage: readonly string[];
            readonly run: readonly string[];
        };
        /** In-container command templates appended to the exec arguments. */
        readonly commands: {
            readonly list: readonly string[];
            readonly prepare: readonly string[];
            readonly read: readonly string[];
            readonly remove: readonly string[];
            readonly write: readonly string[];
        };
        /** Container CLI executable resolved through `PATH`. */
        readonly executable: string;
        /** Local base image; the adapter never pulls. */
        readonly image: string;
        /** Lowercase image repository receiving frozen layers. */
        readonly imageRepository: string;
        /** Container label key naming the owning device. */
        readonly labelKey: string;
        /** Pattern parsing one list-command output line into digest and relative path. */
        readonly listLinePattern: string;
        /** Maximum image layers any frozen image may carry. */
        readonly maxImageLayers: number;
        /** Template tokens substituted into arguments and commands. */
        readonly tokens: {
            readonly container: string;
            readonly image: string;
            readonly label: string;
            readonly path: string;
            readonly source: string;
            readonly world: string;
        };
        /** Absolute world directory inside the container. */
        readonly worldPath: string;
    };
    /** Frozen-layer depth bound and compaction retention. */
    readonly depth: {
        /** Maximum frozen layers, the base included, in one world's stack. */
        readonly maxDepth: number;
        /** Newest frozen layers kept separate when compaction flattens the rest. */
        readonly retainNewest: number;
    };
    /** Prefix of the private per-device directory created under the caller root. */
    readonly deviceDirectoryPrefix: string;
    /** Private directory names inside one device root. */
    readonly directories: {
        readonly compaction: string;
        readonly layers: string;
        readonly upper: string;
        readonly work: string;
        readonly world: string;
    };
    /** Stable public device-layer error contract. */
    readonly errors: {
        readonly checkpointInvalidCode: string;
        readonly checkpointInvalidMessage: string;
        readonly checkpointRetiredCode: string;
        readonly checkpointRetiredMessage: string;
        readonly checkpointUnknownCode: string;
        readonly checkpointUnknownMessage: string;
        readonly closedCode: string;
        readonly closedMessage: string;
        readonly operationCode: string;
        readonly operationMessage: string;
        readonly pathCode: string;
        readonly pathMessage: string;
        readonly unavailableCode: string;
        readonly unavailableMessage: string;
    };
    /** Fixed decimal width of engine-assigned layer identifiers. */
    readonly layerNameWidth: number;
    /** Maximum UTF-8 bytes of one world-relative path. */
    readonly maxPathBytes: number;
    /** Stacked overlay settings layered on the carrier overlay command policy. */
    readonly overlay: {
        /** Separator between lower directories, topmost first. */
        readonly lowerSeparator: string;
        /** Maximum rendered mount-option bytes; bounds the mountable stack. */
        readonly maxMountOptionBytes: number;
        /** Read-only mount option template used to flatten frozen layers. */
        readonly readOnlyMountOptions: string;
    };
    /** Availability reasons owned by the device layer. */
    readonly reasons: {
        readonly available: string;
        readonly containerDaemonUnavailable: string;
        readonly containerExecutableUnavailable: string;
        readonly containerImageUnavailable: string;
    };
    /** Adapter selection policy. */
    readonly selection: {
        /** Adapter requested when options omit one. */
        readonly defaultAdapter: string;
        /** Selection mode used when options omit one. */
        readonly defaultMode: string;
        /** Degradation order tried from the requested adapter's position in fallback mode. */
        readonly fallbackOrder: readonly string[];
        /** Selection mode names by role. */
        readonly modes: { readonly fallback: string; readonly strict: string };
    };
    /** Workspace protocol version that introduced device layers. */
    readonly version: number;
};
