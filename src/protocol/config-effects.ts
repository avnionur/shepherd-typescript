import { createHash } from "node:crypto";
import { readEffectReconciliationConfig } from "./config-reconciliation.ts";

import type { ProtocolConfig } from "./config-types.ts";
import {
    EFFECT_HANDLER_SELECTIONS,
    EFFECT_UNHANDLED_POLICIES,
    SECURE_HASH_ALGORITHMS,
} from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

/** Validates configured effect versions, identities, vocabularies, and schema artifacts. */
export function readEffectConfig(value: unknown): ProtocolConfig["effects"] {
    const effect = readObject(
        value,
        [
            "artifacts",
            "compensation",
            "digestAlgorithm",
            "digestPrefix",
            "hexLength",
            "handlers",
            "intentVersion",
            "outcomeVersion",
            "phases",
            "reversibilityTiers",
            "schemas",
        ],
        "effects",
    );
    const artifacts = readObject(
        effect.artifacts,
        ["intentSchema", "outcomeSchema"],
        "effects.artifacts",
    );
    const phases = readObject(effect.phases, ["intent", "outcome"], "effects.phases");
    const handlers = readObject(effect.handlers, ["selection", "unhandled"], "effects.handlers");
    const schemas = readObject(effect.schemas, ["intentId", "outcomeId"], "effects.schemas");
    const digestAlgorithm = readEnum(
        effect.digestAlgorithm,
        SECURE_HASH_ALGORITHMS,
        "effects.digestAlgorithm",
    );
    const digestPrefix = readNonEmptyString(effect.digestPrefix, "effects.digestPrefix");
    const hexLength = readPositiveInteger(effect.hexLength, "effects.hexLength");
    if (digestPrefix !== `${digestAlgorithm}:`) {
        throw new TypeError("effects.digestPrefix must identify the configured hash algorithm");
    }
    if (hexLength !== createHash(digestAlgorithm).digest("hex").length) {
        throw new TypeError("effects.hexLength must match the configured hash algorithm");
    }
    const reversibilityTiers = readUniqueStrings(
        effect.reversibilityTiers,
        "effects.reversibilityTiers",
    );
    const intent = readNonEmptyString(phases.intent, "effects.phases.intent");
    const outcome = readNonEmptyString(phases.outcome, "effects.phases.outcome");
    if (intent === outcome) {
        throw new TypeError("effects phases must be distinct");
    }
    return {
        artifacts: {
            intentSchema: readNonEmptyString(
                artifacts.intentSchema,
                "effects.artifacts.intentSchema",
            ),
            outcomeSchema: readNonEmptyString(
                artifacts.outcomeSchema,
                "effects.artifacts.outcomeSchema",
            ),
        },
        compensation: readCompensationConfig(
            effect.compensation,
            reversibilityTiers,
            digestAlgorithm,
        ),
        digestAlgorithm,
        digestPrefix,
        hexLength,
        handlers: {
            selection: readEnum(
                handlers.selection,
                EFFECT_HANDLER_SELECTIONS,
                "effects.handlers.selection",
            ),
            unhandled: readEnum(
                handlers.unhandled,
                EFFECT_UNHANDLED_POLICIES,
                "effects.handlers.unhandled",
            ),
        },
        intentVersion: readPositiveInteger(effect.intentVersion, "effects.intentVersion"),
        outcomeVersion: readPositiveInteger(effect.outcomeVersion, "effects.outcomeVersion"),
        phases: { intent, outcome },
        reversibilityTiers,
        schemas: {
            intentId: readAbsoluteUrl(schemas.intentId, "effects.schemas.intentId"),
            outcomeId: readAbsoluteUrl(schemas.outcomeId, "effects.schemas.outcomeId"),
        },
    };
}

const COMPENSATION_ERROR_KEYS = [
    "conflictCode",
    "conflictMessage",
    "evidenceCode",
    "evidenceMessage",
    "failedCode",
    "failedMessage",
    "handlerNotFoundCode",
    "handlerNotFoundMessage",
] as const;

function readCompensationConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
    digestAlgorithm: string,
): ProtocolConfig["effects"]["compensation"] {
    const path = "effects.compensation";
    const compensation = readObject(
        value,
        [
            "artifacts",
            "compatibilityVersion",
            "compensableTiers",
            "errors",
            "evidenceKinds",
            "identity",
            "limits",
            "outcomes",
            "ownership",
            "phases",
            "recordVersion",
            "reconciliation",
            "schemaId",
            "statuses",
            "traceSchema",
            "triggers",
        ],
        path,
    );
    const ownership = readObject(
        compensation.ownership,
        ["claimIdPrefix", "leaseMilliseconds", "renewalMilliseconds", "statuses"],
        `${path}.ownership`,
    );
    const leaseMilliseconds = readPositiveInteger(
        ownership.leaseMilliseconds,
        `${path}.ownership.leaseMilliseconds`,
    );
    const renewalMilliseconds = readPositiveInteger(
        ownership.renewalMilliseconds,
        `${path}.ownership.renewalMilliseconds`,
    );
    const statuses = readUniqueStrings(ownership.statuses, `${path}.ownership.statuses`);
    if (renewalMilliseconds >= leaseMilliseconds || statuses.length !== 4)
        throw new TypeError("compensation ownership settings are inconsistent");
    const artifacts = readObject(compensation.artifacts, ["recordSchema"], `${path}.artifacts`);
    const errors = readObject(compensation.errors, COMPENSATION_ERROR_KEYS, `${path}.errors`);
    const identity = readObject(
        compensation.identity,
        ["appendIntentKind", "compensationIdPrefix"],
        `${path}.identity`,
    );
    const limits = readObject(compensation.limits, ["maxEffectsPerTrigger"], `${path}.limits`);
    const compensableTiers = readUniqueStrings(
        compensation.compensableTiers,
        `${path}.compensableTiers`,
    );
    if (compensableTiers.some((tier) => !reversibilityTiers.includes(tier))) {
        throw new TypeError(`${path}.compensableTiers must name configured reversibility tiers`);
    }
    const compensationIdPrefix = readNonEmptyString(
        identity.compensationIdPrefix,
        `${path}.identity.compensationIdPrefix`,
    );
    if (!compensationIdPrefix.endsWith(`:${digestAlgorithm}:`)) {
        throw new TypeError(`${path}.identity.compensationIdPrefix must name the digest algorithm`);
    }
    const readFixed = (key: string, length: number): readonly string[] => {
        const values = readUniqueStrings(compensation[key], `${path}.${key}`);
        if (values.length !== length) {
            throw new TypeError(`${path}.${key} must contain exactly ${length} values`);
        }
        return values;
    };
    const readErrorText = (key: (typeof COMPENSATION_ERROR_KEYS)[number]): string =>
        readNonEmptyString(errors[key], `${path}.errors.${key}`);
    return {
        artifacts: {
            recordSchema: readNonEmptyString(
                artifacts.recordSchema,
                `${path}.artifacts.recordSchema`,
            ),
        },
        compatibilityVersion: readNonEmptyString(
            compensation.compatibilityVersion,
            `${path}.compatibilityVersion`,
        ),
        compensableTiers,
        errors: {
            conflictCode: readErrorText("conflictCode"),
            conflictMessage: readErrorText("conflictMessage"),
            evidenceCode: readErrorText("evidenceCode"),
            evidenceMessage: readErrorText("evidenceMessage"),
            failedCode: readErrorText("failedCode"),
            failedMessage: readErrorText("failedMessage"),
            handlerNotFoundCode: readErrorText("handlerNotFoundCode"),
            handlerNotFoundMessage: readErrorText("handlerNotFoundMessage"),
        },
        evidenceKinds: readFixed("evidenceKinds", 2),
        identity: {
            appendIntentKind: readNonEmptyString(
                identity.appendIntentKind,
                `${path}.identity.appendIntentKind`,
            ),
            compensationIdPrefix,
        },
        limits: {
            maxEffectsPerTrigger: readPositiveInteger(
                limits.maxEffectsPerTrigger,
                `${path}.limits.maxEffectsPerTrigger`,
            ),
        },
        ownership: {
            claimIdPrefix: readNonEmptyString(
                ownership.claimIdPrefix,
                `${path}.ownership.claimIdPrefix`,
            ),
            leaseMilliseconds,
            renewalMilliseconds,
            statuses,
        },
        outcomes: readFixed("outcomes", 2),
        phases: readFixed("phases", 3),
        recordVersion: readPositiveInteger(compensation.recordVersion, `${path}.recordVersion`),
        reconciliation: readEffectReconciliationConfig(compensation.reconciliation),
        schemaId: readAbsoluteUrl(compensation.schemaId, `${path}.schemaId`),
        statuses: readFixed("statuses", 4),
        traceSchema: readNonEmptyString(compensation.traceSchema, `${path}.traceSchema`),
        triggers: readFixed("triggers", 4),
    };
}
