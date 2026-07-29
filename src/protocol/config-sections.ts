import { createHash } from "node:crypto";

import { type ProtocolConfig, SECURE_HASH_ALGORITHMS } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readEnum,
    readJsonObject,
    readNonEmptyString,
    readObject,
    readSafeInteger,
} from "./config-value-readers.ts";

/** Validates the configured content-addressed identifier contract. */
export function readRecordIdConfig(value: unknown): ProtocolConfig["recordId"] {
    const config = readObject(value, ["algorithm", "hexLength", "prefix"], "recordId");
    const algorithm = readEnum(config.algorithm, SECURE_HASH_ALGORITHMS, "recordId.algorithm");
    const hexLength = readSafeInteger(config.hexLength, "recordId.hexLength");
    if (hexLength !== createHash(algorithm).digest("hex").length) {
        throw new TypeError("recordId.hexLength must match the configured hash algorithm");
    }
    const prefix = readNonEmptyString(config.prefix, "recordId.prefix");
    if (prefix !== `${algorithm}:`) {
        throw new TypeError("recordId.prefix must identify the configured hash algorithm");
    }
    return {
        algorithm,
        hexLength,
        prefix,
    };
}

/** Validates configured protocol artifact destinations. */
export function readArtifacts(value: unknown): ProtocolConfig["kernel"]["artifacts"] {
    const artifacts = readObject(
        value,
        [
            "appendBatchDraftSchema",
            "recordBodySchema",
            "recordEnvelopeSchema",
            "recordValues",
            "recordViewSchema",
        ],
        "kernel.artifacts",
    );
    return {
        appendBatchDraftSchema: readNonEmptyString(
            artifacts.appendBatchDraftSchema,
            "kernel.artifacts.appendBatchDraftSchema",
        ),
        recordBodySchema: readNonEmptyString(
            artifacts.recordBodySchema,
            "kernel.artifacts.recordBodySchema",
        ),
        recordEnvelopeSchema: readNonEmptyString(
            artifacts.recordEnvelopeSchema,
            "kernel.artifacts.recordEnvelopeSchema",
        ),
        recordValues: readNonEmptyString(artifacts.recordValues, "kernel.artifacts.recordValues"),
        recordViewSchema: readNonEmptyString(
            artifacts.recordViewSchema,
            "kernel.artifacts.recordViewSchema",
        ),
    };
}

/** Validates configured schema identifiers and dialect. */
export function readSchemas(value: unknown): ProtocolConfig["kernel"]["schemas"] {
    const schemas = readObject(
        value,
        ["appendBatchDraftId", "dialect", "recordBodyId", "recordEnvelopeId", "recordViewId"],
        "kernel.schemas",
    );
    const validated = {
        appendBatchDraftId: readAbsoluteUrl(
            schemas.appendBatchDraftId,
            "kernel.schemas.appendBatchDraftId",
        ),
        dialect: readAbsoluteUrl(schemas.dialect, "kernel.schemas.dialect"),
        recordBodyId: readAbsoluteUrl(schemas.recordBodyId, "kernel.schemas.recordBodyId"),
        recordEnvelopeId: readAbsoluteUrl(
            schemas.recordEnvelopeId,
            "kernel.schemas.recordEnvelopeId",
        ),
        recordViewId: readAbsoluteUrl(schemas.recordViewId, "kernel.schemas.recordViewId"),
    };
    const schemaIds = [
        validated.appendBatchDraftId,
        validated.recordBodyId,
        validated.recordEnvelopeId,
        validated.recordViewId,
    ];
    if (new Set(schemaIds).size !== schemaIds.length) {
        throw new TypeError("kernel schema identifiers must be unique");
    }
    return validated;
}

/** Validates the configured root witness declaration. */
export function readRootWitness(
    value: unknown,
    recordModes: readonly string[],
): ProtocolConfig["kernel"]["rootWitness"] {
    const root = readObject(
        value,
        ["body", "mode", "schemaRef", "witnessRef"],
        "kernel.rootWitness",
    );
    const mode = readNonEmptyString(root.mode, "kernel.rootWitness.mode");
    if (!recordModes.includes(mode)) {
        throw new TypeError("kernel.rootWitness.mode must be a configured record mode");
    }
    if (root.witnessRef !== "") {
        throw new TypeError("kernel.rootWitness.witnessRef must be empty");
    }
    return {
        body: readJsonObject(root.body, "kernel.rootWitness.body"),
        mode,
        schemaRef: readNonEmptyString(root.schemaRef, "kernel.rootWitness.schemaRef"),
        witnessRef: "",
    };
}
