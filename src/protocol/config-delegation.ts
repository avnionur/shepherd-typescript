import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

type DelegationConfig = ProtocolConfig["delegation"];

const ARTIFACT_KEYS = [
    "approvalSchema",
    "completionSchema",
    "contextSchema",
    "decisionSchema",
    "handoffSchema",
    "openedSchema",
] as const;
const SCHEMA_KEYS = [
    "approvalId",
    "completionId",
    "contextId",
    "decisionId",
    "handoffId",
    "openedId",
] as const;
const TRACE_SCHEMA_KEYS = [
    "approval",
    "completion",
    "context",
    "decision",
    "handoff",
    "opened",
] as const;
const ERROR_KEYS = [
    "approvalRequiredCode",
    "approvalRequiredMessage",
    "authorityCode",
    "authorityMessage",
    "commandConflictCode",
    "commandConflictMessage",
    "evidenceCode",
    "evidenceMessage",
    "headConflictCode",
    "headConflictMessage",
    "statusCode",
    "statusMessage",
    "supervisorCode",
    "supervisorMessage",
] as const;
const IDENTITY_KEYS = [
    "childRunIdPrefix",
    "commandAppendIntentKind",
    "handleIdPrefix",
    "originCutIdPrefix",
    "outputDigestKind",
    "requestDigestKind",
    "retryCutIdPrefix",
] as const;
const LIMIT_KEYS = [
    "maxCitedRecords",
    "maxInjections",
    "maxNestingDepth",
    "maxReasonLength",
    "maxSupervisorIdLength",
    "maxTreeEntries",
] as const;

/**
 * Validates configured task delegation, child run handle, delegated authority, and projection
 * values.
 *
 * @param value - Untrusted `delegation` configuration section.
 * @returns The validated delegation configuration.
 * @throws {TypeError} If any field is missing, malformed, or inconsistent.
 */
export function readDelegationConfig(value: unknown): DelegationConfig {
    const delegation = readObject(
        value,
        [
            "approvalVerdicts",
            "artifacts",
            "compatibilityVersion",
            "contextPhases",
            "decisionKinds",
            "errors",
            "executionKinds",
            "identity",
            "limits",
            "parentKinds",
            "provenanceKinds",
            "recordVersion",
            "revisionFields",
            "schemas",
            "statuses",
            "traceSchemas",
            "treeRootKinds",
        ],
        "delegation",
    );
    const traceSchemas = readRecord(
        delegation.traceSchemas,
        TRACE_SCHEMA_KEYS,
        "delegation.traceSchemas",
        readNonEmptyString,
    );
    if (new Set(Object.values(traceSchemas)).size !== TRACE_SCHEMA_KEYS.length) {
        throw new TypeError("delegation.traceSchemas must be distinct");
    }
    const identity = readRecord(
        delegation.identity,
        IDENTITY_KEYS,
        "delegation.identity",
        readNonEmptyString,
    );
    if (new Set(Object.values(identity)).size !== IDENTITY_KEYS.length) {
        throw new TypeError("delegation.identity values must be distinct");
    }
    return {
        approvalVerdicts: readVocabulary(
            delegation.approvalVerdicts,
            "delegation.approvalVerdicts",
            2,
        ),
        artifacts: readRecord(
            delegation.artifacts,
            ARTIFACT_KEYS,
            "delegation.artifacts",
            readNonEmptyString,
        ),
        compatibilityVersion: readNonEmptyString(
            delegation.compatibilityVersion,
            "delegation.compatibilityVersion",
        ),
        contextPhases: readVocabulary(delegation.contextPhases, "delegation.contextPhases", 2),
        decisionKinds: readVocabulary(delegation.decisionKinds, "delegation.decisionKinds", 2),
        errors: readRecord(delegation.errors, ERROR_KEYS, "delegation.errors", readNonEmptyString),
        executionKinds: readVocabulary(delegation.executionKinds, "delegation.executionKinds", 2),
        identity,
        limits: readRecord(delegation.limits, LIMIT_KEYS, "delegation.limits", readPositiveInteger),
        parentKinds: readVocabulary(delegation.parentKinds, "delegation.parentKinds", 2),
        provenanceKinds: readVocabulary(
            delegation.provenanceKinds,
            "delegation.provenanceKinds",
            3,
        ),
        recordVersion: readPositiveInteger(delegation.recordVersion, "delegation.recordVersion"),
        revisionFields: readVocabulary(delegation.revisionFields, "delegation.revisionFields", 4),
        schemas: readRecord(delegation.schemas, SCHEMA_KEYS, "delegation.schemas", readAbsoluteUrl),
        statuses: readVocabulary(delegation.statuses, "delegation.statuses", 7),
        traceSchemas,
        treeRootKinds: readVocabulary(delegation.treeRootKinds, "delegation.treeRootKinds", 2),
    };
}

function readRecord<const K extends string, V>(
    value: unknown,
    keys: readonly K[],
    path: string,
    read: (entry: unknown, entryPath: string) => V,
): { readonly [Key in K]: V } {
    const object = readObject(value, keys, path);
    return Object.fromEntries(keys.map((key) => [key, read(object[key], `${path}.${key}`)])) as {
        readonly [Key in K]: V;
    };
}

function readVocabulary(value: unknown, path: string, length: number): readonly string[] {
    const values = readUniqueStrings(value, path);
    if (values.length !== length) {
        throw new TypeError(`${path} must contain exactly ${length} values`);
    }
    return values;
}
