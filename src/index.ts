export {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
    type SemanticScalar,
    type SemanticValue,
} from "./canonical-record.ts";
export { createRecordEnvelope } from "./record-envelope.ts";
export { validateRecordBody } from "./record-guards.ts";
export {
    KERNEL_ABI_VERSION,
    KERNEL_CANONICAL_VERSION,
    RECORD_MODES,
    type RecordBody,
    type RecordEnvelope,
    type RecordEnvelopeDraft,
    type RecordId,
    type RecordMode,
} from "./record-types.ts";
export { validateRecordEnvelope } from "./record-validation.ts";
