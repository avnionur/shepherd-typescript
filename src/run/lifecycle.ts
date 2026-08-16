import {
    RUN_LIFECYCLE_STATUSES,
    RUN_LIFECYCLE_TERMINAL_STATUS,
    RUN_LIFECYCLE_TERMINAL_TRANSITIONS,
    RUN_LIFECYCLE_TRANSITIONS,
    RUN_TERMINAL_STATUSES,
} from "../protocol/values.generated.ts";
import type {
    RunLifecycleStatus,
    RunLifecycleTerminalStatus,
    RunLifecycleTransition,
    RunLifecycleTransitionDefinition,
} from "./lifecycle-types.ts";

/**
 * Validates one transition against the configured normative lifecycle matrix.
 *
 * This pure builder validates topology and terminal-outcome legality only. Durable command,
 * checkpoint, receipt, expected-head, and fencing evidence remain obligations of the runtime
 * transition that cites this value.
 *
 * @param definition - Closed source, target, and optional terminal-outcome definition.
 * @returns A frozen validated lifecycle transition.
 * @throws {TypeError} If the definition is malformed or the transition is not configured.
 *
 * @example
 * ```ts
 * const transition = createRunLifecycleTransition({
 *     source_status: "running",
 *     target_status: "waiting",
 * });
 * ```
 *
 * @public
 */
export function createRunLifecycleTransition(
    definition: RunLifecycleTransitionDefinition,
): RunLifecycleTransition {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
        throw new TypeError("run lifecycle transition must be a plain object");
    }
    if (
        Object.getPrototypeOf(definition) !== Object.prototype ||
        Object.getOwnPropertySymbols(definition).length > 0
    ) {
        throw new TypeError("run lifecycle transition must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(definition);
    const fields = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor)) {
            throw new TypeError(`run lifecycle transition ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    const sourceStatus = readLifecycleStatus(fields.source_status, "source_status");
    const targetStatus = readLifecycleStatus(fields.target_status, "target_status");
    if (targetStatus === RUN_LIFECYCLE_TERMINAL_STATUS) {
        assertExactKeys(fields, ["source_status", "target_status", "terminal_status"]);
        const terminalStatus = readTerminalStatus(fields.terminal_status);
        if (!hasPair(RUN_LIFECYCLE_TERMINAL_TRANSITIONS, sourceStatus, terminalStatus)) {
            throw new TypeError("run lifecycle terminal transition is not configured");
        }
        return Object.freeze({
            source_status: sourceStatus,
            target_status: targetStatus,
            terminal_status: terminalStatus,
        });
    }
    assertExactKeys(fields, ["source_status", "target_status"]);
    if (!hasPair(RUN_LIFECYCLE_TRANSITIONS, sourceStatus, targetStatus)) {
        throw new TypeError("run lifecycle transition is not configured");
    }
    return Object.freeze({ source_status: sourceStatus, target_status: targetStatus });
}

function readLifecycleStatus(value: unknown, subject: string): RunLifecycleStatus {
    if (typeof value !== "string" || !RUN_LIFECYCLE_STATUSES.includes(value as never)) {
        throw new TypeError(`${subject} must be a configured run lifecycle status`);
    }
    return value as RunLifecycleStatus;
}

function readTerminalStatus(value: unknown): RunLifecycleTerminalStatus {
    if (typeof value !== "string" || !RUN_TERMINAL_STATUSES.includes(value as never)) {
        throw new TypeError("terminal_status must be a configured run terminal status");
    }
    return value as RunLifecycleTerminalStatus;
}

function assertExactKeys(
    value: Readonly<Record<string, unknown>>,
    expected: readonly string[],
): void {
    const keys = Object.keys(value);
    if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
        throw new TypeError(`run lifecycle transition must contain only ${expected.join(", ")}`);
    }
}

function hasPair(
    pairs: readonly (readonly [string, string])[],
    first: string,
    second: string,
): boolean {
    return pairs.some(([candidateFirst, candidateSecond]) => {
        return candidateFirst === first && candidateSecond === second;
    });
}
