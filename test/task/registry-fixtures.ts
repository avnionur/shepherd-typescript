import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
    canonicalizeRecord,
    schema,
    type TaskArtifact,
    type TaskArtifactLock,
} from "../../src/index.ts";

type TaskConfigFixture = {
    readonly artifactLockVersion: number;
    readonly compatibilityVersion: string;
    readonly descriptorVersion: number;
    readonly digestAlgorithm: string;
    readonly digestPrefix: string;
    readonly taskIdPrefix: string;
};

const taskConfig = (
    JSON.parse(await readFile(new URL("../../protocol.config.json", import.meta.url), "utf8")) as {
        readonly tasks: TaskConfigFixture;
    }
).tasks;

export function taskDefinition() {
    return {
        name: "writeNote",
        version: "1.0.0",
        instruction: "Write one note about the topic.",
        input: schema.object({ topic: schema.string() }),
        output: schema.void(),
    };
}

export function createFixtureArtifactLock(artifact: TaskArtifact): TaskArtifactLock {
    return {
        artifact_digest: fixtureDigest(artifact),
        artifact_lock_version: taskConfig.artifactLockVersion,
        compatibility_version: taskConfig.compatibilityVersion,
        descriptor_version: taskConfig.descriptorVersion,
        schema_digest: fixtureDigest({
            input_schema: artifact.input_schema,
            output_schema: artifact.output_schema,
        }),
        task_id: `${taskConfig.taskIdPrefix}${fixtureDigestHex({ name: artifact.name })}`,
        task_version: artifact.task_version,
    };
}

function fixtureDigest(value: Parameters<typeof canonicalizeRecord>[0]): string {
    return `${taskConfig.digestPrefix}${fixtureDigestHex(value)}`;
}

function fixtureDigestHex(value: Parameters<typeof canonicalizeRecord>[0]): string {
    return createHash(taskConfig.digestAlgorithm)
        .update(canonicalizeRecord(value), "utf8")
        .digest("hex");
}
