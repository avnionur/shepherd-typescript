/** Stable ESM subpath for canonical record encoding and identity. */
export {
    canonicalizeRecord,
    createRecordId,
    type SemanticRecord,
    type SemanticScalar,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
export { CanonicalNestingLimitError } from "../canonical/errors.ts";
