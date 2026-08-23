import { projectionProtocolConfig } from "../protocol/config.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { SQLiteTaskRegistry } from "../task/sqlite-task-registry.ts";
import type { TaskRegistration } from "../task/types.ts";
import type { RepositoryGrantedTask } from "../workspace/repository-grant-types.ts";
import { assertRepositoryGrantedTaskHandle } from "../workspace/repository-grants.ts";
import { assertLedgerEntryBounded, readLedgerListOptions, readLedgerSelector } from "./bounds.ts";
import { ambiguousLedgerSelector, missingLedgerSelector } from "./selector-errors.ts";
import type { LedgerListOptions, TaskLedgerEntry } from "./types.ts";

/**
 * Lists a bounded page of verified task registrations in canonical identity/version byte order.
 *
 * @param registry - Open durable task registry.
 * @param options - Optional closed configured pagination object.
 * @param repositoryGrants - Optional authenticated companion grant evidence.
 * @returns Frozen immutable task ledger entries.
 * @throws {TaskRegistryError} If the registry is closed or retained data is corrupt.
 * @throws {TypeError} If options, grants, retained entries, or canonical size are invalid.
 *
 * @example
 * ```ts
 * const page = listTaskLedger(registry, { limit: 25, offset: 0 });
 * ```
 */
export function listTaskLedger(
    registry: SQLiteTaskRegistry,
    options?: LedgerListOptions,
    repositoryGrants: readonly RepositoryGrantedTask<
        TaskSchema<unknown>,
        TaskSchema<unknown>
    >[] = [],
): readonly TaskLedgerEntry[] {
    const { limit, offset } = readLedgerListOptions(options);
    const grants = readRepositoryGrants(repositoryGrants);
    const entries = registry
        .listRegistrations(limit, offset)
        .map((registration) => taskEntry(registration, grants));
    return Object.freeze(entries);
}

/**
 * Resolves an exact task/version, unique task-ID prefix, or canonical latest read selector.
 *
 * @param registry - Open durable task registry.
 * @param selector - Exact `task-id@version`, task-ID/prefix, or `@latest`.
 * @param repositoryGrants - Optional authenticated companion grant evidence.
 * @returns Exact verified immutable task ledger entry.
 * @throws {LedgerSelectorAmbiguousError} If a task-ID/prefix matches multiple versions/entries.
 * @throws {LedgerSelectorNotFoundError} If no registration matches.
 * @throws {TaskRegistryError} If the registry is closed or retained data is corrupt.
 * @throws {TypeError} If the selector, grants, retained entry, or canonical size is invalid.
 *
 * @example
 * ```ts
 * const entry = resolveTaskLedgerSelector(registry, `${taskId}@${version}`);
 * ```
 */
export function resolveTaskLedgerSelector(
    registry: SQLiteTaskRegistry,
    selector: string,
    repositoryGrants: readonly RepositoryGrantedTask<
        TaskSchema<unknown>,
        TaskSchema<unknown>
    >[] = [],
): TaskLedgerEntry {
    const exactSelector = readLedgerSelector(selector, "task ledger selector");
    const grants = readRepositoryGrants(repositoryGrants);
    if (exactSelector === projectionProtocolConfig.taskRunLedgers.latestSelector) {
        const latest = registry.listRegistrations(1, 0, true)[0];
        if (latest === undefined) throw missingLedgerSelector(exactSelector);
        return taskEntry(latest, grants);
    }
    const { taskVersionSeparator } = projectionProtocolConfig.taskRunLedgers;
    const separator = exactSelector.lastIndexOf(taskVersionSeparator);
    if (separator >= 0) {
        const taskId = exactSelector.slice(0, separator);
        const version = exactSelector.slice(separator + taskVersionSeparator.length);
        if (taskId.length === 0 || version.length === 0) {
            throw new TypeError(
                `exact task ledger selector must be shaped as task-id${taskVersionSeparator}version`,
            );
        }
        const exact = registry.resolve({ taskId, version });
        if (exact === undefined) throw missingLedgerSelector(exactSelector);
        return taskEntry(exact, grants);
    }
    const matches = registry.listTaskIdPrefix(
        exactSelector,
        projectionProtocolConfig.taskRunLedgers.maxPageSize + 1,
    );
    if (matches.length > projectionProtocolConfig.taskRunLedgers.maxPageSize) {
        throw ambiguousLedgerSelector(exactSelector);
    }
    if (matches.length === 0) throw missingLedgerSelector(exactSelector);
    if (matches.length > 1) {
        throw ambiguousLedgerSelector(exactSelector);
    }
    return taskEntry(matches[0] as (typeof matches)[number], grants);
}

function taskEntry(
    registration: TaskRegistration,
    repositoryGrants: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[],
): TaskLedgerEntry {
    const matches = repositoryGrants.filter(
        ({ task }) =>
            task.artifactLock.artifact_digest === registration.artifactLock.artifact_digest,
    );
    if (matches.length > 1) {
        throw new TypeError("task ledger repository-grant evidence is ambiguous");
    }
    const grant = matches[0];
    const entry = Object.freeze({
        artifact: registration.artifact,
        artifact_lock: registration.artifactLock,
        compatibility_version: projectionProtocolConfig.taskRunLedgers.compatibilityVersion,
        ledger_version: projectionProtocolConfig.taskRunLedgers.version,
        repository_grant:
            grant === undefined
                ? null
                : Object.freeze({ artifact: grant.artifact, artifact_lock: grant.artifactLock }),
    });
    assertLedgerEntryBounded(entry);
    return entry;
}

function readRepositoryGrants(
    value: readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[],
): readonly RepositoryGrantedTask<TaskSchema<unknown>, TaskSchema<unknown>>[] {
    if (
        !Array.isArray(value) ||
        value.length > projectionProtocolConfig.taskRunLedgers.maxPageSize
    ) {
        throw new TypeError("task ledger repository-grant evidence exceeds configured bounds");
    }
    for (const grant of value) assertRepositoryGrantedTaskHandle(grant);
    return value;
}
