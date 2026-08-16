import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { runProtocolConfig } from "../protocol/config.ts";
import type {
    RunArtifact,
    RunArtifactContentDefinition,
    RunArtifactDefinition,
} from "./artifact-types.ts";
import { readRunArtifactDefinition } from "./artifact-validation.ts";

/**
 * Creates one immutable ordered side-channel artifact record for a run.
 *
 * Text may be retained inline. Binary content must already have a durable blob receipt, ensuring
 * the semantic artifact record cites bytes instead of embedding a mutable `Uint8Array`.
 *
 * @param definition - Run identity, emission ordinal, artifact identity, content, and metadata.
 * @returns A deeply frozen canonical run-artifact record.
 * @throws {TypeError} If the definition, content, metadata, ordinal, or blob receipt is malformed.
 *
 * @example
 * ```ts
 * const artifact = createRunArtifact({
 *     runId: "run:example",
 *     artifactOrdinal: 0,
 *     kind: "report",
 *     name: "summary.txt",
 *     content: { type: "text", text: "Summary" },
 *     metadata: { media_type: "text/plain" },
 * });
 * ```
 *
 * @public
 */
export function createRunArtifact<C extends RunArtifactContentDefinition>(
    definition: RunArtifactDefinition<C>,
): RunArtifact<C> {
    const values = readRunArtifactDefinition(definition);
    return createCanonicalSnapshot({
        artifact_ordinal: values.artifactOrdinal,
        artifact_version: runProtocolConfig.artifactVersion,
        content: values.content,
        kind: values.kind,
        metadata: values.metadata,
        name: values.name,
        run_id: values.runId,
    }) as RunArtifact<C>;
}
