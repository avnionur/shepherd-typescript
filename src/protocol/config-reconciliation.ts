import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Configured immutable audit format and operational reconciliation bounds. */
export type EffectReconciliationProtocolConfig = {
    /** Public audit compatibility namespace. */
    readonly compatibilityVersion: string;
    /** Wire record version. */
    readonly recordVersion: number;
    /** Trace schema reference. */
    readonly traceSchema: string;
    /** Generated schema identifier. */
    readonly schemaId: string;
    /** Generated schema file. */
    readonly recordSchema: string;
    /** Explicit retry, verified completion and accepted-risk vocabulary. */
    readonly dispositions: readonly string[];
    /** Supported source execution kinds. */
    readonly sourceKinds: readonly string[];
    /** Stable identity and owner-path namespaces. */
    readonly identity: {
        /** Prefix reserving each original effect audit owner. */
        readonly targetOwnerPrefix: string;
        /** Prefix reserving globally idempotent command receipts. */
        readonly commandOwnerPrefix: string;
        /** Canonical command digest discriminator. */
        readonly commandIntentKind: string;
        /** Prefix for exact-head basis identities. */
        readonly basisIdPrefix: string;
    };
    /** Bounded audit inputs and inspection scans. */
    readonly limits: {
        /** Maximum UTF-8 bytes in actor, policy, reason and command text. */
        readonly maxTextBytes: number;
        /** Maximum retained incident citations per decision. */
        readonly maxEvidenceRecords: number;
        /** Maximum immutable decisions for one target. */
        readonly maxDecisions: number;
        /** Maximum unresolved targets in an aggregate inspection. */
        readonly maxTargets: number;
    };
};

/** Validates the closed reconciliation contract without accepting silent vocabulary drift. @internal */
export function readEffectReconciliationConfig(value: unknown): EffectReconciliationProtocolConfig {
    const fields = readObject(
        value,
        [
            "compatibilityVersion",
            "recordVersion",
            "traceSchema",
            "schemaId",
            "recordSchema",
            "dispositions",
            "sourceKinds",
            "identity",
            "limits",
        ],
        "effects.compensation.reconciliation",
    );
    const identity = readObject(
        fields.identity,
        ["targetOwnerPrefix", "commandOwnerPrefix", "commandIntentKind", "basisIdPrefix"],
        "reconciliation identity",
    );
    const limits = readObject(
        fields.limits,
        ["maxTextBytes", "maxEvidenceRecords", "maxDecisions", "maxTargets"],
        "reconciliation limits",
    );
    const dispositions = readUniqueStrings(fields.dispositions, "reconciliation dispositions");
    const sourceKinds = readUniqueStrings(fields.sourceKinds, "reconciliation source kinds");
    if (dispositions.length !== 3 || sourceKinds.length !== 2)
        throw new TypeError("reconciliation vocabulary is incomplete");
    return {
        compatibilityVersion: readNonEmptyString(
            fields.compatibilityVersion,
            "reconciliation compatibility",
        ),
        recordVersion: readPositiveInteger(fields.recordVersion, "reconciliation version"),
        traceSchema: readNonEmptyString(fields.traceSchema, "reconciliation trace schema"),
        schemaId: readAbsoluteUrl(fields.schemaId, "reconciliation schema id"),
        recordSchema: readNonEmptyString(fields.recordSchema, "reconciliation schema path"),
        dispositions,
        sourceKinds,
        identity: {
            targetOwnerPrefix: readNonEmptyString(
                identity.targetOwnerPrefix,
                "reconciliation target prefix",
            ),
            commandOwnerPrefix: readNonEmptyString(
                identity.commandOwnerPrefix,
                "reconciliation command prefix",
            ),
            commandIntentKind: readNonEmptyString(
                identity.commandIntentKind,
                "reconciliation command kind",
            ),
            basisIdPrefix: readNonEmptyString(
                identity.basisIdPrefix,
                "reconciliation basis prefix",
            ),
        },
        limits: {
            maxTextBytes: readPositiveInteger(limits.maxTextBytes, "reconciliation text bound"),
            maxEvidenceRecords: readPositiveInteger(
                limits.maxEvidenceRecords,
                "reconciliation evidence bound",
            ),
            maxDecisions: readPositiveInteger(limits.maxDecisions, "reconciliation decision bound"),
            maxTargets: readPositiveInteger(limits.maxTargets, "reconciliation target bound"),
        },
    };
}
