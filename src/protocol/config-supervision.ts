import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

type SupervisionConfig = ProtocolConfig["supervision"];

const ARTIFACT_KEYS = [
    "admissionSchema",
    "approvalSchema",
    "contextSchema",
    "cursorSchema",
    "decisionSchema",
    "dispatchSchema",
    "resolutionSchema",
] as const;
const SCHEMA_KEYS = [
    "admissionId",
    "approvalId",
    "contextId",
    "cursorId",
    "decisionId",
    "dispatchId",
    "resolutionId",
] as const;
const TRACE_SCHEMA_KEYS = [
    "admission",
    "approval",
    "context",
    "decision",
    "dispatch",
    "resolution",
] as const;
const ERROR_KEYS = [
    "approvalConflictCode",
    "approvalConflictMessage",
    "cursorConflictCode",
    "cursorConflictMessage",
    "evidenceCode",
    "evidenceMessage",
    "leaseConflictCode",
    "leaseConflictMessage",
    "leaseFencedCode",
    "leaseFencedMessage",
    "materializationUncertainCode",
    "materializationUncertainMessage",
    "overflowCode",
    "overflowMessage",
] as const;
const IDENTITY_KEYS = [
    "commandAppendIntentKind",
    "contextChannelIdPrefix",
    "cursorIdPrefix",
    "dispatchIdPrefix",
] as const;

/**
 * Validates configured subscription, interception, approval, context, identity, and schema values.
 *
 * @param value - Untrusted `supervision` configuration section.
 * @param reversibilityTiers - Validated effect reversibility tiers that policy tiers must cite.
 * @returns The validated supervision configuration.
 * @throws {TypeError} If any field is missing, malformed, inconsistent, or cites an unknown tier.
 */
export function readSupervisionConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
): SupervisionConfig {
    const supervision = readObject(
        value,
        [
            "approval",
            "artifacts",
            "compatibilityVersion",
            "errors",
            "identity",
            "interception",
            "limits",
            "recordVersion",
            "recovery",
            "resolution",
            "schemas",
            "subscriptions",
            "traceSchemas",
        ],
        "supervision",
    );
    const approval = readObject(
        supervision.approval,
        [
            "defaultWaitMilliseconds",
            "gates",
            "maxWaitMilliseconds",
            "phases",
            "pollIntervalMilliseconds",
            "requiredTiers",
            "verdicts",
        ],
        "supervision.approval",
    );
    const interception = readObject(
        supervision.interception,
        [
            "decisionLeaseMilliseconds",
            "decisionSources",
            "decisions",
            "failOpenForbiddenTiers",
            "leaseRenewalMilliseconds",
            "maxInterceptors",
            "maxTimeoutMilliseconds",
            "timeoutPolicies",
        ],
        "supervision.interception",
    );
    const subscriptions = readObject(
        supervision.subscriptions,
        [
            "cursorVersion",
            "defaultBufferCapacity",
            "maxBufferCapacity",
            "maxOwners",
            "overflowPolicies",
            "pollIntervalMilliseconds",
            "startPositions",
        ],
        "supervision.subscriptions",
    );
    const recovery = readObject(supervision.recovery, ["classifications"], "supervision.recovery");
    const resolution = readObject(
        supervision.resolution,
        ["dispositions"],
        "supervision.resolution",
    );
    const decisionLeaseMilliseconds = readPositiveInteger(
        interception.decisionLeaseMilliseconds,
        "supervision.interception.decisionLeaseMilliseconds",
    );
    const leaseRenewalMilliseconds = readPositiveInteger(
        interception.leaseRenewalMilliseconds,
        "supervision.interception.leaseRenewalMilliseconds",
    );
    if (leaseRenewalMilliseconds >= decisionLeaseMilliseconds) {
        throw new TypeError(
            "supervision.interception.leaseRenewalMilliseconds must be shorter than the decision lease",
        );
    }
    const defaultBufferCapacity = readPositiveInteger(
        subscriptions.defaultBufferCapacity,
        "supervision.subscriptions.defaultBufferCapacity",
    );
    const maxBufferCapacity = readPositiveInteger(
        subscriptions.maxBufferCapacity,
        "supervision.subscriptions.maxBufferCapacity",
    );
    if (defaultBufferCapacity > maxBufferCapacity) {
        throw new TypeError(
            "supervision.subscriptions.defaultBufferCapacity must not exceed maxBufferCapacity",
        );
    }
    const defaultWaitMilliseconds = readPositiveInteger(
        approval.defaultWaitMilliseconds,
        "supervision.approval.defaultWaitMilliseconds",
    );
    const maxWaitMilliseconds = readPositiveInteger(
        approval.maxWaitMilliseconds,
        "supervision.approval.maxWaitMilliseconds",
    );
    if (defaultWaitMilliseconds > maxWaitMilliseconds) {
        throw new TypeError(
            "supervision.approval.defaultWaitMilliseconds must not exceed maxWaitMilliseconds",
        );
    }
    const traceSchemas = readRecord(
        supervision.traceSchemas,
        TRACE_SCHEMA_KEYS,
        "supervision.traceSchemas",
        readNonEmptyString,
    );
    if (new Set(Object.values(traceSchemas)).size !== TRACE_SCHEMA_KEYS.length) {
        throw new TypeError("supervision.traceSchemas must be distinct");
    }
    return {
        approval: {
            defaultWaitMilliseconds,
            gates: readVocabulary(approval.gates, "supervision.approval.gates", 2),
            maxWaitMilliseconds,
            phases: readVocabulary(approval.phases, "supervision.approval.phases", 2),
            pollIntervalMilliseconds: readPositiveInteger(
                approval.pollIntervalMilliseconds,
                "supervision.approval.pollIntervalMilliseconds",
            ),
            requiredTiers: readTiers(
                approval.requiredTiers,
                "supervision.approval.requiredTiers",
                reversibilityTiers,
            ),
            verdicts: readVocabulary(approval.verdicts, "supervision.approval.verdicts", 3),
        },
        artifacts: readRecord(
            supervision.artifacts,
            ARTIFACT_KEYS,
            "supervision.artifacts",
            readNonEmptyString,
        ),
        compatibilityVersion: readNonEmptyString(
            supervision.compatibilityVersion,
            "supervision.compatibilityVersion",
        ),
        errors: readRecord(
            supervision.errors,
            ERROR_KEYS,
            "supervision.errors",
            readNonEmptyString,
        ),
        identity: readRecord(
            supervision.identity,
            IDENTITY_KEYS,
            "supervision.identity",
            readNonEmptyString,
        ),
        interception: {
            decisionLeaseMilliseconds,
            decisionSources: readVocabulary(
                interception.decisionSources,
                "supervision.interception.decisionSources",
                3,
            ),
            decisions: readVocabulary(
                interception.decisions,
                "supervision.interception.decisions",
                4,
            ),
            failOpenForbiddenTiers: readTiers(
                interception.failOpenForbiddenTiers,
                "supervision.interception.failOpenForbiddenTiers",
                reversibilityTiers,
            ),
            leaseRenewalMilliseconds,
            maxInterceptors: readPositiveInteger(
                interception.maxInterceptors,
                "supervision.interception.maxInterceptors",
            ),
            maxTimeoutMilliseconds: readPositiveInteger(
                interception.maxTimeoutMilliseconds,
                "supervision.interception.maxTimeoutMilliseconds",
            ),
            timeoutPolicies: readVocabulary(
                interception.timeoutPolicies,
                "supervision.interception.timeoutPolicies",
                2,
            ),
        },
        limits: readRecord(
            supervision.limits,
            ["maxCitedRecords", "maxDataCanonicalBytes", "maxReasonBytes"],
            "supervision.limits",
            readPositiveInteger,
        ),
        recordVersion: readPositiveInteger(supervision.recordVersion, "supervision.recordVersion"),
        recovery: {
            classifications: readVocabulary(
                recovery.classifications,
                "supervision.recovery.classifications",
                5,
            ),
        },
        resolution: {
            dispositions: readVocabulary(
                resolution.dispositions,
                "supervision.resolution.dispositions",
                5,
            ),
        },
        schemas: readRecord(
            supervision.schemas,
            SCHEMA_KEYS,
            "supervision.schemas",
            readAbsoluteUrl,
        ),
        subscriptions: {
            cursorVersion: readPositiveInteger(
                subscriptions.cursorVersion,
                "supervision.subscriptions.cursorVersion",
            ),
            defaultBufferCapacity,
            maxBufferCapacity,
            maxOwners: readPositiveInteger(
                subscriptions.maxOwners,
                "supervision.subscriptions.maxOwners",
            ),
            overflowPolicies: readVocabulary(
                subscriptions.overflowPolicies,
                "supervision.subscriptions.overflowPolicies",
                2,
            ),
            pollIntervalMilliseconds: readPositiveInteger(
                subscriptions.pollIntervalMilliseconds,
                "supervision.subscriptions.pollIntervalMilliseconds",
            ),
            startPositions: readVocabulary(
                subscriptions.startPositions,
                "supervision.subscriptions.startPositions",
                2,
            ),
        },
        traceSchemas,
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

function readTiers(value: unknown, path: string, tiers: readonly string[]): readonly string[] {
    const values = readUniqueStrings(value, path);
    if (values.some((tier) => !tiers.includes(tier))) {
        throw new TypeError(`${path} must cite configured effect reversibility tiers`);
    }
    return values;
}
