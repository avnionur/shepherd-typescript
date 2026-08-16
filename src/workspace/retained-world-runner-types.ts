import type { RETAINED_WORLD_ENFORCEMENT_KINDS } from "../protocol/values.generated.ts";
import type { TaskExecutionOptions, TaskExecutionResult } from "../run/execution-types.ts";
import type { TaskSchema } from "../task/schema.ts";

declare const retainedWorldRunnerContract: unique symbol;

/** Configured enforcement classification claimed by a retained-world runner. */
export type RetainedWorldEnforcement = (typeof RETAINED_WORLD_ENFORCEMENT_KINDS)[number];

/** Fenced retained-world authority issued only for one runner invocation. */
export type RetainedWorldCapability = {
    /** Exact immutable revision from which mutable custody was forked. */
    readonly base_revision_id: string;
    /** Exact workspace binding available to the runner. */
    readonly binding_id: string;
    /** Monotonic authority token checked at every mutable operation. */
    readonly capture_fence: number;
    /** Exact mutable carrier custody governed by this capability. */
    readonly custody_id: string;
    /** Enforcement actually provided for this invocation. */
    readonly enforcement: RetainedWorldEnforcement;
    /**
     * Reads one existing regular UTF-8 file beneath isolated custody.
     *
     * @param relativePath - Canonical binding-relative path.
     * @returns Exact UTF-8 text.
     * @throws {TypeError} If the path or current fence is invalid.
     */
    readonly readText: (relativePath: string) => Promise<string>;
    /**
     * Replaces one existing regular UTF-8 file beneath isolated custody.
     *
     * @param relativePath - Canonical binding-relative path.
     * @param text - UTF-8 text within the configured operation bound.
     * @returns Completion after the fenced write closes.
     * @throws {TypeError} If the path, text, file, or current fence is invalid.
     */
    readonly writeText: (relativePath: string, text: string) => Promise<void>;
};

/** Frozen context supplied to one authenticated retained-world runner invocation. */
export type RetainedWorldExecutionContext<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Monotonic authority token shared with {@link world}. */
    readonly capture_fence: number;
    /** Exact provider-backed execution contract associated with this world. */
    readonly execution: TaskExecutionOptions<I, O>;
    /** Composed cancellation signal governing execution and quiescence. */
    readonly signal: AbortSignal;
    /** Fenced isolated retained-world authority. */
    readonly world: RetainedWorldCapability;
};

/** Closed callback definition accepted by {@link createRetainedWorldRunner}. */
export type RetainedWorldRunnerDefinition<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
> = {
    /** Enforcement the adapter can actually provide. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Executes once inside the supplied fenced retained-world context. */
    readonly run: (context: RetainedWorldExecutionContext<I, O>) => Promise<TaskExecutionResult>;
    /** Stable caller-assigned identity included in durable prepared evidence. */
    readonly runnerId: string;
};

/** Opaque registered handle for one retained-world runner adapter. */
export type RetainedWorldRunner<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>> = {
    /** Enforcement declared by the registered adapter. */
    readonly enforcement: RetainedWorldEnforcement;
    /** Stable runner identity included in durable capture evidence. */
    readonly runner_id: string;
    /** Configured retained-world runner protocol version. */
    readonly runner_version: number;
    /** Compile-time association with the callback's exact task execution contract. */
    readonly [retainedWorldRunnerContract]?: (
        context: RetainedWorldExecutionContext<I, O>,
    ) => Promise<TaskExecutionResult>;
};
