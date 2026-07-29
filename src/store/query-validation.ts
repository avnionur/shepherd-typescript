import { kernelProtocolConfig } from "../protocol/config.ts";
import { assertNonEmptyString, assertRecordId } from "../record/guards.ts";
import type { RecordId } from "../record/types.ts";
import type {
    CausalClosureOptions,
    ClosurePolicy,
    CutSpec,
    ModeFilter,
    SliceReadOptions,
    VisibilityProfile,
} from "./types.ts";

type NormalizedQueryOptions = {
    readonly closurePolicy: ClosurePolicy;
    readonly modeFilter: ModeFilter;
    readonly visibilityProfile: VisibilityProfile;
};

/** Validates and snapshots a cut publication request. */
export function normalizeCutSpec(spec: CutSpec): CutSpec {
    const fields = readClosedObject(
        spec,
        [
            "append_intent_id",
            "caused_by_record_ids",
            "cut_id",
            "publisher_owner_id",
            "target_owner_id",
            "through_record_id",
            "witness_ref",
        ],
        "cut spec",
    );
    assertNonEmptyString(fields.cut_id, "cut.cut_id");
    assertNonEmptyString(fields.target_owner_id, "cut.target_owner_id");
    assertRecordId(fields.through_record_id, "cut.through_record_id");
    if (fields.append_intent_id !== undefined) {
        assertNonEmptyString(fields.append_intent_id, "cut.append_intent_id");
    }
    if (fields.publisher_owner_id !== undefined) {
        assertNonEmptyString(fields.publisher_owner_id, "cut.publisher_owner_id");
    }
    if (fields.witness_ref !== undefined) {
        assertRecordId(fields.witness_ref, "cut.witness_ref");
    }
    const causedBy =
        fields.caused_by_record_ids === undefined
            ? undefined
            : readRecordIds(fields.caused_by_record_ids, "cut.caused_by_record_ids");
    return Object.freeze({
        ...(fields.append_intent_id === undefined
            ? {}
            : { append_intent_id: fields.append_intent_id }),
        ...(causedBy === undefined ? {} : { caused_by_record_ids: causedBy }),
        cut_id: fields.cut_id,
        ...(fields.publisher_owner_id === undefined
            ? {}
            : { publisher_owner_id: fields.publisher_owner_id }),
        target_owner_id: fields.target_owner_id,
        through_record_id: fields.through_record_id,
        ...(fields.witness_ref === undefined ? {} : { witness_ref: fields.witness_ref }),
    }) as CutSpec;
}

/** Validates and snapshots causal root identifiers. */
export function normalizeCausalRoots(roots: readonly RecordId[]): readonly RecordId[] {
    return readRecordIds(roots, "rootRecordIds");
}

/** Resolves configured owner-prefix query options. */
export function normalizeSliceReadOptions(options: SliceReadOptions): NormalizedQueryOptions {
    return normalizeOptions(options, false);
}

/** Resolves configured causal-closure query options. */
export function normalizeCausalOptions(options: CausalClosureOptions): NormalizedQueryOptions {
    return normalizeOptions(options, true);
}

function normalizeOptions(
    options: CausalClosureOptions,
    allowClosurePolicy: boolean,
): NormalizedQueryOptions {
    const fields = readClosedObject(
        options,
        allowClosurePolicy
            ? ["closure_policy", "mode_filter", "visibility_profile"]
            : ["mode_filter", "visibility_profile"],
        "slice options",
    );
    const modeFilter = fields.mode_filter ?? kernelProtocolConfig.queries.defaultModeFilter;
    const visibilityProfile =
        fields.visibility_profile ?? kernelProtocolConfig.queries.defaultVisibilityProfile;
    const closurePolicy =
        fields.closure_policy ?? kernelProtocolConfig.queries.defaultClosurePolicy;
    if (
        typeof modeFilter !== "string" ||
        !kernelProtocolConfig.queries.modeFilters.includes(modeFilter)
    ) {
        throw new TypeError("mode_filter must be a configured query mode");
    }
    if (
        typeof visibilityProfile !== "string" ||
        !kernelProtocolConfig.queries.visibilityProfiles.includes(visibilityProfile)
    ) {
        throw new TypeError("visibility_profile must be configured");
    }
    if (
        typeof closurePolicy !== "string" ||
        !kernelProtocolConfig.queries.closurePolicies.includes(closurePolicy)
    ) {
        throw new TypeError("closure_policy must be configured");
    }
    return {
        closurePolicy: closurePolicy as ClosurePolicy,
        modeFilter: modeFilter as ModeFilter,
        visibilityProfile: visibilityProfile as VisibilityProfile,
    };
}

function readClosedObject(
    value: unknown,
    allowedKeys: readonly string[],
    path: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${path} must be a plain object`);
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!allowedKeys.includes(key) || !("value" in descriptor)) {
            throw new TypeError(`${path} contains an unsupported property`);
        }
        result[key] = descriptor.value;
    }
    return result;
}

function readRecordIds(value: unknown, path: string): readonly RecordId[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`${path} must be an array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: RecordId[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${path} must be a dense data array`);
        }
        assertRecordId(descriptor.value, `${path}[${index}]`);
        result.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/u.test(key))) {
        throw new TypeError(`${path} must not contain custom properties`);
    }
    return Object.freeze(result);
}
