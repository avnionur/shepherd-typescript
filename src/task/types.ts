import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type { InferTaskSchema, TaskSchema } from "./schema.ts";

/** Options controlling task-registry open behavior. */
export type SQLiteTaskRegistryOptions = {
    /** Opens current-schema registrations without migrations or writes. */
    readonly readOnly?: boolean;
};

/** Canonical bodyless task contract included in task artifact identity. */
export type TaskArtifact = {
    /** Compatibility namespace governing descriptor semantics. */
    readonly compatibility_version: string;
    /** Configured task descriptor wire version. */
    readonly descriptor_version: number;
    /** Canonical JSON Schema document for task inputs. */
    readonly input_schema: SemanticRecord;
    /** Behavioral instruction executed by a future task runtime. */
    readonly instruction: string;
    /** Stable human-readable logical task name. */
    readonly name: string;
    /** Canonical JSON Schema document for task outputs. */
    readonly output_schema: SemanticRecord;
    /** Caller-declared logical task version. */
    readonly task_version: string;
};

/** Exact content-addressed lock for one immutable task artifact revision. */
export type TaskArtifactLock = {
    /** Digest of the complete canonical task artifact. */
    readonly artifact_digest: string;
    /** Configured artifact-lock wire version. */
    readonly artifact_lock_version: number;
    /** Compatibility namespace governing descriptor semantics. */
    readonly compatibility_version: string;
    /** Configured task descriptor wire version. */
    readonly descriptor_version: number;
    /** Digest of the canonical input/output schema pair. */
    readonly schema_digest: string;
    /** Stable content-addressed identity of the logical task name. */
    readonly task_id: string;
    /** Caller-declared logical task version. */
    readonly task_version: string;
};

/** Exact selector for one registered task artifact version. */
export type ExactTaskReference = {
    /** Stable content-addressed logical task identity. */
    readonly taskId: string;
    /** Exact caller-declared task version. */
    readonly version: string;
};

/** Durable registry result containing a canonical artifact and its verified lock. */
export type TaskRegistration = {
    /** Canonical task artifact retained by the registry. */
    readonly artifact: TaskArtifact;
    /** Recomputed and verified exact artifact lock. */
    readonly artifactLock: TaskArtifactLock;
};

/** Definition accepted by the bodyless task descriptor builder. */
export type TaskDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Input schema used for static inference and runtime validation. */
    readonly input: I;
    /** Behavioral instruction; changing it changes artifact identity. */
    readonly instruction: string;
    /** Stable human-readable logical task name. */
    readonly name: string;
    /** Output schema used for static inference and runtime validation. */
    readonly output: O;
    /** Caller-declared logical task version. */
    readonly version: string;
};

/** Immutable bodyless task descriptor with inferred runtime validation methods. */
export type TaskDescriptor<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Canonical task artifact used to derive exact identity. */
    readonly artifact: TaskArtifact;
    /** Exact frozen lock suitable for durable run citations. */
    readonly artifactLock: TaskArtifactLock;
    /** Input schema supplied by the task author. */
    readonly inputSchema: I;
    /** Behavioral instruction executed by a future task runtime. */
    readonly instruction: string;
    /** Stable human-readable logical task name. */
    readonly name: string;
    /** Output schema supplied by the task author. */
    readonly outputSchema: O;
    /**
     * Validates and snapshots one untrusted task input.
     *
     * @param value - Untrusted input supplied by a caller or decoder.
     * @returns The inferred immutable input value.
     * @throws {TypeError} If the input does not satisfy `inputSchema`.
     */
    readonly parseInput: (value: unknown) => InferTaskSchema<I>;
    /**
     * Validates and snapshots one untrusted task output.
     *
     * @param value - Untrusted output supplied by a future executor or decoder.
     * @returns The inferred immutable output value.
     * @throws {TypeError} If the output does not satisfy `outputSchema`.
     */
    readonly parseOutput: (value: unknown) => InferTaskSchema<O>;
    /** Caller-declared logical task version. */
    readonly version: string;
};
