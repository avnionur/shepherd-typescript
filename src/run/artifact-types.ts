import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type { RUN_ARTIFACT_CONTENT_TYPES } from "../protocol/values.generated.ts";
import type { BlobStorageReceipt } from "../store/types.ts";

/** Inline textual content accepted by {@link createRunArtifact}. */
export type RunTextArtifactContentDefinition = {
    /** Text retained directly in the canonical artifact record. */
    readonly text: string;
    /** Configured inline-text content discriminant. */
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[0];
};

/** Durable binary content accepted by {@link createRunArtifact}. */
export type RunBlobArtifactContentDefinition = {
    /** Existing durable blob receipt for the artifact bytes. */
    readonly receipt: BlobStorageReceipt;
    /** Configured blob-reference content discriminant. */
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};

/** Content representation accepted by {@link createRunArtifact}. */
export type RunArtifactContentDefinition =
    | RunBlobArtifactContentDefinition
    | RunTextArtifactContentDefinition;

/** Definition accepted by {@link createRunArtifact}. */
export type RunArtifactDefinition<C extends RunArtifactContentDefinition> = {
    /** Zero-based emission position within this run. */
    readonly artifactOrdinal: number;
    /** Inline text or an existing durable blob receipt. */
    readonly content: C;
    /** Application-defined artifact family. */
    readonly kind: string;
    /** Canonical provider- or application-specific metadata. */
    readonly metadata: SemanticRecord;
    /** Caller-visible artifact name. */
    readonly name: string;
    /** Run that emitted this artifact. */
    readonly runId: string;
};

/** Inline textual content retained by a run artifact record. */
export type RunTextArtifactContent = RunTextArtifactContentDefinition;

/** Durable binary reference retained by a run artifact record. */
export type RunBlobArtifactContent = {
    /** Content-addressed identity of the retained bytes. */
    readonly blob_id: string;
    /** Exact number of retained bytes. */
    readonly byte_length: number;
    /** Configured blob-reference content discriminant. */
    readonly type: (typeof RUN_ARTIFACT_CONTENT_TYPES)[1];
};

/** Maps an artifact definition to its exact canonical content representation. */
export type RunArtifactContentFor<C extends RunArtifactContentDefinition> =
    C extends RunTextArtifactContentDefinition ? RunTextArtifactContent : RunBlobArtifactContent;

/** Immutable versioned record for one ordered side-channel run artifact. */
export type RunArtifact<C extends RunArtifactContentDefinition = RunArtifactContentDefinition> = {
    /** Zero-based emission position within this run. */
    readonly artifact_ordinal: number;
    /** Configured run-artifact wire version. */
    readonly artifact_version: number;
    /** Inline text or durable blob reference. */
    readonly content: RunArtifactContentFor<C>;
    /** Application-defined artifact family. */
    readonly kind: string;
    /** Frozen canonical provider- or application-specific metadata. */
    readonly metadata: SemanticRecord;
    /** Caller-visible artifact name. */
    readonly name: string;
    /** Run that emitted this artifact. */
    readonly run_id: string;
};
