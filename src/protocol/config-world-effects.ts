import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Configuration of the built-in retained-world operation journal. */
export type WorldEffectProtocolConfig = {
    /** Canonical append-intent identity domain. */
    readonly appendIntentKind: string;
    /** Evidence compatibility namespace. */
    readonly compatibilityVersion: string;
    /** Declared content-retention policy; evidence contains digests rather than plaintext. */
    readonly contentPolicy: string;
    /** Prefix of generated operation effect identities. */
    readonly effectIdPrefix: string;
    /** Canonical operation identity domain. */
    readonly identityKind: string;
    /** Configured effect kinds of built-in capability methods. */
    readonly kinds: {
        /** Read-text effect kind. */
        readonly readText: string;
        /** Write-text effect kind. */
        readonly writeText: string;
    };
    /** Maximum path bytes hashed into bounded evidence. */
    readonly maxPathEvidenceBytes: number;
    /** Outcome statuses ordered success, refusal, failure, cancellation. */
    readonly outcomes: readonly string[];
    /** Journal phases ordered opened, intent, admitted, outcome. */
    readonly phases: readonly string[];
    /** Inspection states ordered absent, recording, not materialized, uncertain, settled. */
    readonly recovery: readonly string[];
    /** Generated schema identifier and trace schema reference. */
    readonly schemaId: string;
    /** Generated schema destination. */
    readonly schemaPath: string;
    /** Journal record version. */
    readonly version: number;
};

/**
 * Validates configured world-operation vocabulary and bounded evidence settings.
 * @param value - Untrusted journal configuration.
 * @returns The validated closed configuration.
 * @throws {TypeError} If fields are absent, malformed, duplicated or incomplete.
 */
export function readWorldEffectConfig(value: unknown): WorldEffectProtocolConfig {
    const subject = "workspaces.worldTaskCapture.operationJournal";
    const fields = readObject(
        value,
        [
            "appendIntentKind",
            "compatibilityVersion",
            "contentPolicy",
            "effectIdPrefix",
            "identityKind",
            "kinds",
            "maxPathEvidenceBytes",
            "outcomes",
            "phases",
            "recovery",
            "schemaId",
            "schemaPath",
            "version",
        ],
        subject,
    );
    const kinds = readObject(fields.kinds, ["readText", "writeText"], `${subject}.kinds`);
    const readText = readNonEmptyString(kinds.readText, `${subject}.kinds.readText`);
    const writeText = readNonEmptyString(kinds.writeText, `${subject}.kinds.writeText`);
    const phases = readUniqueStrings(fields.phases, `${subject}.phases`);
    const outcomes = readUniqueStrings(fields.outcomes, `${subject}.outcomes`);
    const recovery = readUniqueStrings(fields.recovery, `${subject}.recovery`);
    if (
        readText === writeText ||
        phases.length !== 4 ||
        outcomes.length !== 4 ||
        recovery.length !== 5
    ) {
        throw new TypeError(`${subject} vocabulary must be distinct and complete`);
    }
    return {
        appendIntentKind: readNonEmptyString(
            fields.appendIntentKind,
            `${subject}.appendIntentKind`,
        ),
        compatibilityVersion: readNonEmptyString(
            fields.compatibilityVersion,
            `${subject}.compatibilityVersion`,
        ),
        contentPolicy: readNonEmptyString(fields.contentPolicy, `${subject}.contentPolicy`),
        effectIdPrefix: readNonEmptyString(fields.effectIdPrefix, `${subject}.effectIdPrefix`),
        identityKind: readNonEmptyString(fields.identityKind, `${subject}.identityKind`),
        kinds: { readText, writeText },
        maxPathEvidenceBytes: readPositiveInteger(
            fields.maxPathEvidenceBytes,
            `${subject}.maxPathEvidenceBytes`,
        ),
        outcomes,
        phases,
        recovery,
        schemaId: readAbsoluteUrl(fields.schemaId, `${subject}.schemaId`),
        schemaPath: readNonEmptyString(fields.schemaPath, `${subject}.schemaPath`),
        version: readPositiveInteger(fields.version, `${subject}.version`),
    };
}
