import { assertBlobId } from "../blob/identity.ts";
import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
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

/** Validates and snapshots artifact fields that do not depend on a run identity. @internal */
export function readRunArtifactPayloadDefinition(
    value: unknown,
    subject = "run artifact payload",
): {
    readonly content: RunArtifactContentDefinition;
    readonly kind: string;
    readonly metadata: SemanticRecord;
    readonly name: string;
} {
    const fields = readRunDataObject(value, ["content", "kind", "metadata", "name"], subject);
    assertRunText(fields.kind, `${subject} kind`);
    assertRunText(fields.name, `${subject} name`);
    assertRunSemanticRecord(fields.metadata, `${subject} metadata`);
    const content = readArtifactContent<RunArtifactContentDefinition>(fields.content);
    return createCanonicalSnapshot({
        content:
            content.type === TEXT_CONTENT_TYPE
                ? content
                : {
                      receipt: {
                          blob_id: content.blob_id,
                          byte_length: content.byte_length,
                      },
                      type: BLOB_CONTENT_TYPE,
                  },
        kind: fields.kind,
        metadata: fields.metadata,
        name: fields.name,
    }) as {
        readonly content: RunArtifactContentDefinition;
        readonly kind: string;
        readonly metadata: SemanticRecord;
        readonly name: string;
    };
}

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
    const payload = readRunArtifactPayloadDefinition(
        {
            content: fields.content,
            kind: fields.kind,
            metadata: fields.metadata,
            name: fields.name,
        },
        "run artifact",
    );
    return {
        artifactOrdinal: fields.artifactOrdinal,
        content:
            payload.content.type === TEXT_CONTENT_TYPE
                ? payload.content
                : {
                      blob_id: payload.content.receipt.blob_id,
                      byte_length: payload.content.receipt.byte_length,
                      type: BLOB_CONTENT_TYPE,
                  },
        kind: payload.kind,
        metadata: payload.metadata,
        name: payload.name,
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
