import { assertBlobId } from "../blob/identity.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import { RUN_ARTIFACT_CONTENT_TYPES } from "../protocol/values.generated.ts";
import type {
    RunArtifactContentDefinition,
    RunArtifactContentFor,
    RunArtifactDefinition,
    RunBlobArtifactContent,
} from "./artifact-types.ts";
import {
    assertRunSemanticRecord,
    assertRunText,
    assertRunWellFormedString,
    readRunDataObject,
} from "./validation-values.ts";

const [TEXT_CONTENT_TYPE, BLOB_CONTENT_TYPE] = RUN_ARTIFACT_CONTENT_TYPES;

/** Validates and normalizes one exact run-artifact definition. @internal */
export function readRunArtifactDefinition<C extends RunArtifactContentDefinition>(
    value: RunArtifactDefinition<C>,
): Omit<RunArtifactDefinition<C>, "content"> & { readonly content: RunArtifactContentFor<C> } {
    const fields = readRunDataObject(
        value,
        ["artifactOrdinal", "content", "kind", "metadata", "name", "runId"],
        "run artifact definition",
    );
    assertRunText(fields.runId, "run artifact runId");
    assertArtifactOrdinal(fields.artifactOrdinal);
    assertRunText(fields.kind, "run artifact kind");
    assertRunText(fields.name, "run artifact name");
    assertRunSemanticRecord(fields.metadata, "run artifact metadata");
    return {
        artifactOrdinal: fields.artifactOrdinal,
        content: readArtifactContent(fields.content),
        kind: fields.kind,
        metadata: fields.metadata,
        name: fields.name,
        runId: fields.runId,
    } as Omit<RunArtifactDefinition<C>, "content"> & {
        readonly content: RunArtifactContentFor<C>;
    };
}

function readArtifactContent<C extends RunArtifactContentDefinition>(
    value: unknown,
): RunArtifactContentFor<C> {
    const candidate = readContentDiscriminant(value);
    if (!runProtocolConfig.artifactContentTypes.includes(candidate.type as string)) {
        throw new TypeError("run artifact content type is not configured");
    }
    if (candidate.type === TEXT_CONTENT_TYPE) {
        const fields = readRunDataObject(value, ["text", "type"], "text artifact content");
        assertRunWellFormedString(fields.text, "text artifact content text");
        return fields as RunArtifactContentFor<C>;
    }
    const fields = readRunDataObject(value, ["receipt", "type"], "blob artifact content");
    return readBlobContent(fields.receipt) as RunArtifactContentFor<C>;
}

function readBlobContent(value: unknown): RunBlobArtifactContent {
    const receipt = readRunDataObject(value, ["blob_id", "byte_length"], "blob receipt");
    assertBlobId(receipt.blob_id, "blob receipt blob_id");
    assertNonNegativeSafeInteger(receipt.byte_length, "blob receipt byte_length");
    return {
        blob_id: receipt.blob_id,
        byte_length: receipt.byte_length,
        type: BLOB_CONTENT_TYPE,
    };
}

function readContentDiscriminant(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("run artifact content must be a plain data object");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "type");
    if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("run artifact content type must be a data property");
    }
    return { type: descriptor.value };
}

function assertArtifactOrdinal(value: unknown): asserts value is number {
    if (
        typeof value === "number" &&
        (value < runProtocolConfig.firstArtifactOrdinal ||
            value > runProtocolConfig.lastArtifactOrdinal)
    ) {
        throw new TypeError("run artifact artifactOrdinal is outside configured bounds");
    }
    assertNonNegativeSafeInteger(value, "run artifact artifactOrdinal");
}

function assertNonNegativeSafeInteger(value: unknown, subject: string): asserts value is number {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    if ((value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
}
