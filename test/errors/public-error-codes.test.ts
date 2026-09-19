import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { publicErrorCodes, readPublicErrorConfig } from "../../src/errors/public-errors.ts";
import {
    AppendIntentConflictError,
    BlobIntegrityError,
    EffectHandlerNotFoundError,
    isPublicError,
    NativeJailExecutionError,
    NativeJailUnavailableError,
    PlacementUnavailableError,
    ProjectionCompatibilityError,
    RedactedTraceArchiveError,
    RunBudgetExhaustedError,
    RunCancelledError,
    StorageAdapterError,
    StorageBlobContentMismatchError,
    TaskRegistryError,
    TaskVersionConflictError,
    TraceArchiveLimitError,
    TraceSecretDetectedError,
    TraceStoreBackupError,
    TraceStoreError,
    TraceStoreReadOnlyError,
    TypedEffectTraceValidationError,
    UnsupportedStoreSchemaError,
    UnsupportedTaskRegistrySchemaError,
} from "../../src/index.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../public-errors.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("exported fixed-class errors expose configured stable codes", () => {
    const errors = [
        new EffectHandlerNotFoundError("effect:missing", "tool.call"),
        new TypedEffectTraceValidationError("invalid trace"),
        new TraceStoreError("trace error"),
        new AppendIntentConflictError("append conflict"),
        new UnsupportedStoreSchemaError("unsupported store"),
        new BlobIntegrityError("blob mismatch"),
        new ProjectionCompatibilityError("projection mismatch"),
        new TaskRegistryError("registry error"),
        new TaskVersionConflictError("task conflict"),
        new UnsupportedTaskRegistrySchemaError("unsupported registry"),
        new RunBudgetExhaustedError({
            limit: 1,
            metric: "turns",
            observed: 2,
            type: "budget_exhausted",
        }),
        new RunCancelledError("cancelled"),
        new PlacementUnavailableError({ reason: "jail-unavailable" } as never),
        new NativeJailUnavailableError({ reason: "backend-unavailable" } as never),
        new NativeJailExecutionError({ status: "failed" } as never),
        new TraceSecretDetectedError({ findings: [], secret_classes: [], truncated: false }),
        new RedactedTraceArchiveError("redacted"),
        new StorageAdapterError("adapter"),
        new StorageBlobContentMismatchError("mismatch"),
        new TraceStoreBackupError("manifest-missing", "backup"),
        new TraceStoreReadOnlyError("read-only"),
        new TraceArchiveLimitError("maxRecords", 1),
    ];

    assert.deepEqual(
        errors.map((error) => (error as Error & { readonly code?: string }).code),
        [
            "EFFECT_HANDLER_NOT_FOUND",
            "TYPED_EFFECT_TRACE_INVALID",
            "TRACE_STORE_ERROR",
            "APPEND_INTENT_CONFLICT",
            "TRACE_STORE_SCHEMA_UNSUPPORTED",
            "BLOB_INTEGRITY_ERROR",
            "PROJECTION_COMPATIBILITY_ERROR",
            "TASK_REGISTRY_ERROR",
            "TASK_VERSION_CONFLICT",
            "TASK_REGISTRY_SCHEMA_UNSUPPORTED",
            "RUN_BUDGET_EXHAUSTED",
            "RUN_CANCELLED",
            "PLACEMENT_UNAVAILABLE",
            "NATIVE_JAIL_UNAVAILABLE",
            "NATIVE_JAIL_EXECUTION_FAILED",
            "TRACE_SECRET_DETECTED",
            "REDACTED_TRACE_ARCHIVE_ERROR",
            "STORAGE_ADAPTER_ERROR",
            "STORAGE_BLOB_CONTENT_MISMATCH",
            "TRACE_STORE_BACKUP_ERROR",
            "TRACE_STORE_READ_ONLY",
            "TRACE_ARCHIVE_LIMIT_EXCEEDED",
        ],
    );
});

test("public wrappers retain existing in-memory causes", () => {
    const cause = new Error("private cause");

    assert.equal(new TraceStoreError("trace", { cause }).cause, cause);
    assert.equal(new TaskRegistryError("task", { cause }).cause, cause);
    assert.equal(new RunCancelledError("cancelled", cause).cause, cause);
});

test("isPublicError recognizes only data-property public codes", () => {
    const structured = new RunCancelledError("cancelled");
    const accessor = new Error("accessor") as Error & { readonly code?: string };
    Object.defineProperty(accessor, "code", {
        get: () => {
            throw new Error("must not read an accessor");
        },
    });

    assert.equal(isPublicError(structured), true);
    assert.equal(isPublicError(new TypeError("validation")), false);
    assert.equal(isPublicError(accessor), false);
    assert.equal(isPublicError({ code: "RUN_CANCELLED" }), false);
});

test("public error configuration is closed, unique, and immutable", () => {
    const parsed = readPublicErrorConfig(structuredClone(validConfig));

    assert.equal(parsed.runs.cancelled, "RUN_CANCELLED");
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.trace), true);
    assert.equal(Object.isFrozen(publicErrorCodes), true);

    for (const invalid of [
        null,
        [],
        {},
        { ...validConfig, extra: true },
        { ...validConfig, compatibilityVersion: "shepherd.public-errors.v2" },
        { ...validConfig, version: 2 },
        { ...validConfig, codes: null },
        {
            ...validConfig,
            codes: { ...(validConfig.codes as Record<string, unknown>), effects: {} },
        },
        {
            ...validConfig,
            codes: {
                ...(validConfig.codes as Record<string, unknown>),
                effects: { handlerNotFound: "invalid-code" },
            },
        },
        {
            ...validConfig,
            codes: {
                ...(validConfig.codes as Record<string, unknown>),
                effects: { handlerNotFound: "RUN_CANCELLED" },
            },
        },
    ]) {
        assert.throws(() => readPublicErrorConfig(invalid), TypeError);
    }

    const withSymbol = structuredClone(validConfig);
    Object.defineProperty(withSymbol, Symbol("extra"), { value: true });
    assert.throws(() => readPublicErrorConfig(withSymbol), TypeError);
});
