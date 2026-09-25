import type { SemanticValue } from "../canonical/canonical-record.ts";
import type {
    APPLICATION_KINDS,
    APPLICATION_PROTOCOL_SURFACES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { CutId } from "../store/types.ts";

/** Configured application kind. */
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

/** Configured protocol surface kind: prompt, schema, or tool. */
export type ApplicationProtocolSurfaceKind = (typeof APPLICATION_PROTOCOL_SURFACES)[number];

/** One versioned prompt, schema, or tool the application protocol pins. */
export type ApplicationProtocolSurface = {
    /** Canonical surface content: prompt text, JSON Schema document, or tool declaration. */
    readonly content: SemanticValue;
    /** Stable surface identity, unique within the protocol definition. */
    readonly id: string;
    /** Configured surface kind. */
    readonly kind: ApplicationProtocolSurfaceKind;
    /** Declared role, such as observation or action, the application resolves surfaces by. */
    readonly role: string;
};

/** Dataset selection an application run names: the dataset, its revision, and the items used. */
export type ApplicationDatasetSelection = {
    /** Dataset identity. */
    readonly id: string;
    /** Distinct item identities selected from the dataset. */
    readonly items: readonly string[];
    /** Dataset revision. */
    readonly revision: string;
};

/** Complete pinned protocol of one application run: surfaces, budgets, seeds, and dataset. */
export type ApplicationProtocolDefinition = {
    /** Integer budgets by metric name; the application interprets the configured keys. */
    readonly budgets: Readonly<Record<string, number>>;
    /** Dataset selection the run operates on. */
    readonly dataset: ApplicationDatasetSelection;
    /** Application kind the protocol drives. */
    readonly kind: ApplicationKind;
    /** Caller protocol version, retained verbatim. */
    readonly protocolVersion: string;
    /** Distinct seeds the run draws determinism from, in declared order. */
    readonly seeds: readonly number[];
    /** Ordered surfaces with distinct identities. */
    readonly surfaces: readonly ApplicationProtocolSurface[];
    /**
     * Optional finite thresholds by metric name, such as fractional gate and promotion thresholds;
     * the application interprets the configured keys. Omitted when the protocol declares none.
     */
    readonly thresholds?: Readonly<Record<string, number>>;
};

/** Step reuse of one application session, such as one counterfactual proposer session. */
export type ApplicationComputationReuse = {
    /** Steps executed live. */
    readonly live_steps: number;
    /** Steps served from a recorded journal. */
    readonly recorded_steps: number;
    /** `recorded_steps / (recorded_steps + live_steps)`, or null when both are zero. */
    readonly reuse_ratio: number | null;
    /** Zero-based session index. */
    readonly session_index: number;
};

/** One protocol surface cited by digest inside a manifest; content is never embedded. */
export type ApplicationManifestSurface = {
    /** Digest of the canonical surface content. */
    readonly digest: string;
    /** Surface identity. */
    readonly id: string;
    /** Surface kind. */
    readonly kind: ApplicationProtocolSurfaceKind;
    /** Declared role. */
    readonly role: string;
};

/** One produced artifact cited by identity, never by content. */
export type ApplicationArtifactCitation = {
    /** Citation identity derived from the role, digest, record, and cut. */
    readonly artifact_id: string;
    /** Published cut fixing the artifact, or null. */
    readonly cut_id: string | null;
    /** Digest of the artifact's canonical content. */
    readonly digest: string;
    /** Retained record carrying the artifact, or null. */
    readonly record_id: RecordId | null;
    /** Role the artifact plays in the run, such as a worker cut or a decision record. */
    readonly role: string;
};

/** Source of one artifact citation: the canonical content and the evidence it lives in. */
export type ApplicationArtifactSource = {
    /** Canonical content the digest is taken over. */
    readonly content: SemanticValue;
    /** Published cut fixing the artifact, or null. */
    readonly cut_id: string | null;
    /** Retained record carrying the artifact, or null. */
    readonly record_id: RecordId | null;
    /** Role the artifact plays in the run. */
    readonly role: string;
};

/** Measured provider cost of one application run; never estimated. */
export type ApplicationCostSummary = {
    /** Tokens written into provider caches. */
    readonly cache_creation_input_tokens: number;
    /** Tokens read from provider caches. */
    readonly cache_read_input_tokens: number;
    /** Aggregate cost in US dollars, or null when any observed usage reported no cost. */
    readonly cost_usd: number | null;
    /** Input tokens consumed. */
    readonly input_tokens: number;
    /** Output tokens produced. */
    readonly output_tokens: number;
    /** Provider invocations observed. */
    readonly provider_calls: number;
};

/** Canonical, digest-bearing manifest of one application run. */
export type ApplicationManifest = {
    /** Application identity and reserved owner path derived from the command identity. */
    readonly application_id: string;
    /** Produced artifacts cited by identity. */
    readonly artifacts: readonly ApplicationArtifactCitation[];
    /** Protocol budgets, retained verbatim. */
    readonly budgets: Readonly<Record<string, number>>;
    /** Application evidence compatibility namespace. */
    readonly compatibility_version: string;
    /** Measured costs folded from every observed usage. */
    readonly costs: ApplicationCostSummary;
    /** Dataset selection, retained verbatim. */
    readonly dataset: ApplicationDatasetSelection;
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Manifest identity: the digest of the manifest body without this field. */
    readonly manifest_id: string;
    /** Configured manifest version. */
    readonly manifest_version: number;
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Caller protocol version. */
    readonly protocol_version: string;
    /** Protocol seeds, retained verbatim. */
    readonly seeds: readonly number[];
    /** Protocol surfaces cited by digest. */
    readonly surfaces: readonly ApplicationManifestSurface[];
    /** Protocol thresholds, retained verbatim; present only when the protocol declares them. */
    readonly thresholds?: Readonly<Record<string, number>>;
    /** Per-session computation reuse; present only when the application measures it. */
    readonly computation_reuse?: readonly ApplicationComputationReuse[];
};

/** Closed options for {@link createApplicationManifest}. */
export type CreateApplicationManifestOptions = {
    /** Application identity derived by {@link deriveApplicationOwnerId}. */
    readonly applicationId: string;
    /** Produced artifacts with their canonical content and evidence locations. */
    readonly artifacts: readonly ApplicationArtifactSource[];
    /** Optional per-session computation reuse retained in the manifest. */
    readonly computationReuse?: readonly ApplicationComputationReuse[];
    /** Measured costs. */
    readonly costs: ApplicationCostSummary;
    /** Validated protocol definition the run executed. */
    readonly protocol: ApplicationProtocolDefinition;
};

/** Closed options for {@link retainApplicationManifest}. */
export type RetainApplicationManifestOptions = {
    /** Manifest to retain on its application owner path. */
    readonly manifest: ApplicationManifest;
};

/** Result of {@link retainApplicationManifest}. */
export type ApplicationManifestReceipt = {
    /** Terminal cut published through the manifest record. */
    readonly cut_id: CutId;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
    /** Manifest record identity. */
    readonly record_id: RecordId;
};

/** Record-derived view of one retained manifest. */
export type ApplicationManifestInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Terminal cut published through the manifest record. */
    readonly cut_id: CutId;
    /** Validated manifest. */
    readonly manifest: ApplicationManifest;
    /** Manifest record identity. */
    readonly record_id: RecordId;
};

/** Request to fork isolated custody for one worker attempt. */
export type ApplicationWorldForkRequest = {
    /** Globally idempotent fork command identity derived by the application. */
    readonly commandId: string;
    /** Unix time the application's clock reported when the request was issued. */
    readonly nowMilliseconds: number;
    /**
     * Custody, previously returned by this adapter, whose current content the fork copies instead
     * of the parent world: the runtime supervisor's cross-agent handoff forks the leader's custody
     * as the follower's new root. Omitted for a clean fork of the parent world.
     */
    readonly sourceCustodyId?: string;
    /** Worker the custody belongs to. */
    readonly workerId: string;
};

/** Isolated custody one worker attempt edits. */
export type ApplicationWorldCustody = {
    /** Adapter-owned custody identity used by later merge, discard, and changed-path requests. */
    readonly custody_id: string;
    /** Retained fork receipt identity cited as an artifact. */
    readonly receipt_id: string;
    /** Absolute root of the custody the worker edits. */
    readonly root: string;
};

/** Request to publish one accepted custody into the parent world. */
export type ApplicationWorldMergeRequest = {
    /** Globally idempotent merge command identity derived by the application. */
    readonly commandId: string;
    /** Custody to merge. */
    readonly custodyId: string;
    /** Unix time the application's clock reported when the request was issued. */
    readonly nowMilliseconds: number;
    /** Worker that produced the custody. */
    readonly workerId: string;
};

/** Request to abandon one custody without changing the parent world. */
export type ApplicationWorldDiscardRequest = {
    /** Globally idempotent discard command identity derived by the application. */
    readonly commandId: string;
    /** Custody to abandon. */
    readonly custodyId: string;
    /** Unix time the application's clock reported when the request was issued. */
    readonly nowMilliseconds: number;
    /** Worker that produced the custody. */
    readonly workerId: string;
};

/** Retained receipt of one merge or discard. */
export type ApplicationWorldReceipt = {
    /** Retained receipt identity cited as an artifact. */
    readonly receipt_id: string;
};

/**
 * Caller-supplied isolated world custody for supervised workers.
 *
 * Every request carries a globally idempotent command identity, so repeating a request after an
 * interruption converges on the retained receipt. The applications area never touches a
 * filesystem itself; the workspace area provides the concrete adapter over scope forks, merges,
 * discards, and changesets.
 */
export type ApplicationWorldAdapter = {
    /**
     * Returns the canonical changed-path set of one custody for conflict classification.
     *
     * @param custodyId - Custody returned by {@link ApplicationWorldAdapter.fork}.
     * @returns Distinct changed paths relative to the parent world the custody's lineage was first
     * forked from.
     */
    readonly changedPaths: (custodyId: string) => Promise<readonly string[]>;
    /**
     * Abandons custody and every custody forked from it without changing the parent world. A
     * request whose command already completed returns the retained receipt even in a fresh
     * process that has not re-issued the custody's fork.
     *
     * @param request - Command, custody, worker, and time.
     * @returns The discard receipt identity.
     */
    readonly discard: (request: ApplicationWorldDiscardRequest) => Promise<ApplicationWorldReceipt>;
    /**
     * Forks isolated custody from the current parent world, or from the current content of the
     * request's source custody. Re-issuing a completed fork command returns the same custody.
     *
     * @param request - Command, worker, time, and optional source custody.
     * @returns The custody with its root and receipt identity.
     */
    readonly fork: (request: ApplicationWorldForkRequest) => Promise<ApplicationWorldCustody>;
    /**
     * Publishes accepted custody into the world it was forked from: the parent world, or its
     * source custody.
     *
     * @param request - Command, custody, worker, and time.
     * @returns The merge receipt identity.
     */
    readonly merge: (request: ApplicationWorldMergeRequest) => Promise<ApplicationWorldReceipt>;
};
