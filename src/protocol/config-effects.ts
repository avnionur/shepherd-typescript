import { createHash } from "node:crypto";

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
        reversibilityTiers: readUniqueStrings(
            effect.reversibilityTiers,
            "effects.reversibilityTiers",
        ),
        schemas: {
            intentId: readAbsoluteUrl(schemas.intentId, "effects.schemas.intentId"),
            outcomeId: readAbsoluteUrl(schemas.outcomeId, "effects.schemas.outcomeId"),
        },
    };
}
