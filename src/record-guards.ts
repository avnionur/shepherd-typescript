import { canonicalizeRecord, type SemanticRecord } from "./canonical-record.ts";
import { kernelProtocolConfig, recordIdConfig } from "./protocol-config.ts";
import {
    RECORD_MODES,
    type RecordBody,
    type RecordEnvelopeDraft,
    type RecordId,
    type RecordMode,
} from "./record-types.ts";

/**
 * Validates a value as a canonical record body.
 *
 * @param value - The untrusted value to validate.
 * @throws {TypeError} If the value is not a plain canonicalizable object.
 *
 * @public
 */
export function validateRecordBody(value: unknown): asserts value is RecordBody {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("record body must be a plain object");
    }
    canonicalizeRecord(value as SemanticRecord);
}

export function assertNonEmptyString(value: unknown, path: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${path} must be a non-empty string`);
    }
}

export function assertRecordMode(value: unknown): asserts value is RecordMode {
    if (
        typeof value !== "string" ||
        !kernelProtocolConfig.recordModes.includes(value) ||
        !RECORD_MODES.some((mode) => mode === value)
    ) {
        throw new TypeError(`mode must be one of: ${kernelProtocolConfig.recordModes.join(", ")}`);
    }
}

export function assertString(value: unknown, path: string): asserts value is string {
    if (typeof value !== "string") {
        throw new TypeError(`${path} must be a string`);
    }
}

export function assertRecordId(value: unknown, path: string): asserts value is RecordId {
    assertString(value, path);
    const hex = value.slice(recordIdConfig.prefix.length);
    if (
        !value.startsWith(recordIdConfig.prefix) ||
        hex.length !== recordIdConfig.hexLength ||
        !/^[0-9a-f]+$/u.test(hex)
    ) {
        throw new TypeError(`${path} must be a configured record identifier`);
    }
}

export function assertWitnessRules(
    draft: RecordEnvelopeDraft,
    causedBy: readonly RecordId[],
): void {
    const rootWitness = kernelProtocolConfig.rootWitness;
    if (draft.witness_ref === rootWitness.witnessRef) {
        if (draft.schema_ref !== rootWitness.schemaRef) {
            throw new TypeError("empty witness_ref is reserved for the configured root witness");
        }
        if (draft.mode !== rootWitness.mode) {
            throw new TypeError("root witness mode does not match the configured mode");
        }
        if (causedBy.length !== 0) {
            throw new TypeError("root witness must not contain causal parents");
        }
        if (canonicalizeRecord(draft.body) !== canonicalizeRecord(rootWitness.body as RecordBody)) {
            throw new TypeError("root witness body does not match the configured body");
        }
        return;
    }
    if (draft.schema_ref === rootWitness.schemaRef) {
        throw new TypeError("the configured root witness must use the empty witness_ref");
    }
    assertRecordId(draft.witness_ref, "witness_ref");
}
