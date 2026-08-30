import { readFileSync } from "node:fs";

import { deepFreeze } from "../protocol/config-value-readers.ts";

/** Stable machine-readable code carried by one exported structured public error. */
export type PublicErrorCode = string;

/** Exported error instance with stable machine-readable classification. */
export type PublicError = Error & {
    /** Stable configuration-owned machine-readable classification. */
    readonly code: PublicErrorCode;
};

type FixedPublicErrorCodes = {
    readonly effects: { readonly handlerNotFound: PublicErrorCode };
    readonly formal: { readonly typedTraceInvalid: PublicErrorCode };
    readonly runs: {
        readonly budgetExhausted: PublicErrorCode;
        readonly cancelled: PublicErrorCode;
    };
    readonly tasks: {
        readonly registry: PublicErrorCode;
        readonly schemaUnsupported: PublicErrorCode;
        readonly versionConflict: PublicErrorCode;
    };
    readonly trace: {
        readonly appendIntentConflict: PublicErrorCode;
        readonly blobIntegrity: PublicErrorCode;
        readonly projectionCompatibility: PublicErrorCode;
        readonly schemaUnsupported: PublicErrorCode;
        readonly store: PublicErrorCode;
    };
    readonly workspace: {
        readonly nativeJailExecutionFailed: PublicErrorCode;
        readonly nativeJailUnavailable: PublicErrorCode;
        readonly placementUnavailable: PublicErrorCode;
    };
};

/** Location of the public-error configuration relative to this source or built module. @internal */
export const publicErrorConfigUrl = new URL("../../public-errors.config.json", import.meta.url);

/** Validated fixed-class public error codes. @internal */
export const publicErrorCodes: FixedPublicErrorCodes = readPublicErrorConfig(
    JSON.parse(readFileSync(publicErrorConfigUrl, "utf8")),
);

/**
 * Tests whether an unknown failure implements the stable structured public-error contract.
 *
 * Validation and callback failures intentionally remain ordinary errors unless their exported
 * class owns a configured code. This guard reads no message, stack, cause, path, or evidence.
 *
 * @param value - Unknown caught value to classify in memory.
 * @returns Whether the value is an Error with a stable machine-readable public code.
 */
export function isPublicError(value: unknown): value is PublicError {
    if (!(value instanceof Error)) {
        return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "code");
    return (
        descriptor !== undefined &&
        "value" in descriptor &&
        typeof descriptor.value === "string" &&
        /^[A-Z][A-Z0-9_]*$/u.test(descriptor.value)
    );
}

/** Validates, snapshots, and freezes public-error configuration. @internal */
export function readPublicErrorConfig(value: unknown): FixedPublicErrorCodes {
    const root = readObject(
        value,
        ["codes", "compatibilityVersion", "version"],
        "public error configuration",
    );
    if (root.compatibilityVersion !== "shepherd.public-errors.v1" || root.version !== 1) {
        throw new TypeError("public error configuration version is unsupported");
    }
    const codes = readObject(
        root.codes,
        ["effects", "formal", "runs", "tasks", "trace", "workspace"],
        "public error codes",
    );
    const parsed = {
        effects: readCodeGroup(codes.effects, ["handlerNotFound"], "effects"),
        formal: readCodeGroup(codes.formal, ["typedTraceInvalid"], "formal"),
        runs: readCodeGroup(codes.runs, ["budgetExhausted", "cancelled"], "runs"),
        tasks: readCodeGroup(
            codes.tasks,
            ["registry", "schemaUnsupported", "versionConflict"],
            "tasks",
        ),
        trace: readCodeGroup(
            codes.trace,
            [
                "appendIntentConflict",
                "blobIntegrity",
                "projectionCompatibility",
                "schemaUnsupported",
                "store",
            ],
            "trace",
        ),
        workspace: readCodeGroup(
            codes.workspace,
            ["nativeJailExecutionFailed", "nativeJailUnavailable", "placementUnavailable"],
            "workspace",
        ),
    } as FixedPublicErrorCodes;
    const values = Object.values(parsed).flatMap((group) => Object.values(group));
    if (new Set(values).size !== values.length) {
        throw new TypeError("public error codes must be unique");
    }
    return deepFreeze(parsed);
}

function readCodeGroup<K extends string>(
    value: unknown,
    keys: readonly K[],
    domain: string,
): Readonly<Record<K, PublicErrorCode>> {
    const group = readObject(value, keys, `public error codes.${domain}`);
    const result = Object.create(null) as Record<K, PublicErrorCode>;
    for (const key of keys) {
        const code = group[key];
        if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(code)) {
            throw new TypeError(`public error codes.${domain}.${key} must be uppercase snake case`);
        }
        result[key] = code;
    }
    return Object.freeze(result);
}

function readObject<K extends string>(
    value: unknown,
    keys: readonly K[],
    subject: string,
): Readonly<Record<K, unknown>> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain object`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError(`${subject} must contain exactly its configured fields`);
    }
    return value as Readonly<Record<K, unknown>>;
}
