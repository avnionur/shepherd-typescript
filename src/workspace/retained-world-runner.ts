import { workspaceProtocolConfig } from "../protocol/config.ts";
import type { TaskExecutionResult } from "../run/execution-types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type {
    RetainedWorldExecutionContext,
    RetainedWorldRunner,
    RetainedWorldRunnerDefinition,
} from "./retained-world-runner-types.ts";

type StoredRunner = (context: unknown) => Promise<TaskExecutionResult>;

const runnerCallbacks = new WeakMap<object, StoredRunner>();

/** Rejects structurally forged retained-world runner handles. @internal */
export function assertRetainedWorldRunner(
    value: unknown,
): asserts value is RetainedWorldRunner<TaskSchema<unknown>, TaskSchema<unknown>> {
    if (value === null || typeof value !== "object" || !runnerCallbacks.has(value)) {
        throw new TypeError("retained-world runner registration is invalid");
    }
}

/**
 * Creates one opaque retained-world runner registration handle.
 *
 * Construction validates a closed definition and retains the executable callback outside the
 * public handle. Task 6B.2 owns the first authority-consuming seam and forged-handle rejection.
 *
 * @param definition - Stable identity, actual enforcement, and asynchronous runner callback.
 * @returns Frozen opaque runner registration handle for retained-world execution integration.
 * @throws {TypeError} If the definition is open, malformed, or uses unsupported enforcement.
 *
 * @example
 * ```ts
 * const runner = createRetainedWorldRunner({
 *     runnerId: "runner:local:1",
 *     enforcement: "advisory",
 *     run: async ({ execution }) => executeTask(execution),
 * });
 * ```
 *
 * @public
 */
export function createRetainedWorldRunner<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(definition: RetainedWorldRunnerDefinition<I, O>): RetainedWorldRunner<I, O> {
    const fields = readDefinition(definition);
    const runner = Object.freeze({
        enforcement: fields.enforcement,
        runner_id: fields.runnerId,
        runner_version: workspaceProtocolConfig.worldExecution.runnerVersion,
    }) as RetainedWorldRunner<I, O>;
    runnerCallbacks.set(runner, fields.run as unknown as StoredRunner);
    return runner;
}

/** Invokes one registered runner while rejecting structurally forged handles. @internal */
export function invokeRetainedWorldRunner<
    I extends TaskSchema<unknown>,
    O extends TaskSchema<unknown>,
>(
    runner: RetainedWorldRunner<I, O>,
    context: RetainedWorldExecutionContext<I, O>,
): Promise<TaskExecutionResult> {
    const callback = runnerCallbacks.get(runner);
    // Package callers authenticate the handle before this private lookup.
    /* node:coverage ignore next 3 */
    if (callback === undefined) {
        throw new TypeError("retained-world runner registration is invalid");
    }
    return callback(context);
}

function readDefinition<I extends TaskSchema<unknown>, O extends TaskSchema<unknown>>(
    value: RetainedWorldRunnerDefinition<I, O>,
): RetainedWorldRunnerDefinition<I, O> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained-world runner definition must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== "string")) {
        throw new TypeError("retained-world runner definition must be exact data");
    }
    const keys = (ownKeys as string[]).sort();
    const expected = ["enforcement", "run", "runnerId"];
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        keys.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained-world runner definition must be exact data");
    }
    const enforcement = (descriptors.enforcement as PropertyDescriptor).value as unknown;
    const run = (descriptors.run as PropertyDescriptor).value as unknown;
    const runnerId = (descriptors.runnerId as PropertyDescriptor).value as unknown;
    if (
        typeof runnerId !== "string" ||
        runnerId.length === 0 ||
        Buffer.byteLength(runnerId) > workspaceProtocolConfig.worldExecution.maxRunnerIdBytes ||
        runnerId.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(runnerId)
    ) {
        throw new TypeError("retained-world runner identity is invalid");
    }
    if (
        typeof enforcement !== "string" ||
        !workspaceProtocolConfig.worldExecution.enforcementKinds.includes(enforcement)
    ) {
        throw new TypeError("retained-world runner enforcement is unsupported");
    }
    if (typeof run !== "function") {
        throw new TypeError("retained-world runner callback must be a function");
    }
    return Object.freeze({ enforcement, run, runnerId }) as RetainedWorldRunnerDefinition<I, O>;
}
