import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import type { RECORD_MODES } from "../protocol/values.generated.ts";

export { RECORD_MODES } from "../protocol/values.generated.ts";

/**
 * The frozen Shepherd kernel ABI implemented by this package.
 *
 * @public
 */
export const KERNEL_ABI_VERSION = kernelProtocolConfig.abiVersion;

/**
 * The domain-separated canonical digest version used for record identity.
 *
 * @public
 */
export const KERNEL_CANONICAL_VERSION = kernelProtocolConfig.canonicalVersion;

/**
 * A content-addressed retained-record identifier.
 *
 * Runtime validation enforces the configured digest prefix and length.
 *
 * @public
 */
export type RecordId = string;

/**
 * A schema-specific semantic payload retained by a record.
 *
 * Record bodies accept the same plain, canonicalizable values as semantic
 * records. Storage metadata does not belong in a record body.
 *
 * @public
 */
export type RecordBody = SemanticRecord;

/**
 * Whether a record declares intended state or captures observed state.
 *
 * @public
 */
export type RecordMode = (typeof RECORD_MODES)[number];

/**
 * Stable semantic identity and ordered causality for one retained record.
 *
 * Owner paths, ordinals, receipts, and local timestamps are intentionally
 * excluded because they do not change record identity.
 *
 * @public
 */
export type RecordEnvelope = {
    /** Ordered semantic causes; order participates in identity. */
    readonly caused_by_record_ids: readonly RecordId[];
    /** Versioned canonical digest, equal to `record_id` in ABI v0. */
    readonly digest: RecordId;
    /** Whether the body declares intended state or captures observed state. */
    readonly mode: RecordMode;
    /** Content-addressed identity of the semantic record input. */
    readonly record_id: RecordId;
    /** Non-empty identifier for the body schema. */
    readonly schema_ref: string;
    /** Retained witness record ID, or the reserved root sentinel. */
    readonly witness_ref: RecordId | "";
};

/**
 * Semantic input used to create a record envelope.
 *
 * @public
 */
export type RecordEnvelopeDraft<TBody extends RecordBody = RecordBody> = {
    /** Schema-specific semantic payload. */
    readonly body: TBody;
    /** Ordered semantic causes; omitted for a record without parents. */
    readonly caused_by_record_ids?: readonly RecordId[];
    /** Whether the body declares intended state or captures observed state. */
    readonly mode: RecordMode;
    /** Non-empty identifier for the body schema. */
    readonly schema_ref: string;
    /** Retained witness record ID, or the reserved root sentinel. */
    readonly witness_ref: RecordId | "";
};
