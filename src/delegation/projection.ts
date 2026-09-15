import type { SemanticValue } from "../canonical/canonical-record.ts";
import { delegationProtocolConfig } from "../protocol/config.ts";
import {
    DELEGATION_DECISION_KINDS,
    DELEGATION_PARENT_KINDS,
    DELEGATION_TREE_ROOT_KINDS,
} from "../protocol/values.generated.ts";
import type {
    DurableTaskExecutionInspection,
    DurableTaskExecutionOutcomeInspection,
} from "../run/durable-execution-inspection-types.ts";
import { normalizeTaskValue } from "../run/execution-preparation.ts";
import { assertPrefixedDigest, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { OwnerRecord } from "../store/types.ts";
import { type TaskSchema, taskSchemaMetadata } from "../task/schema.ts";
import type { TaskValue } from "../task/types.ts";
import { taskDescriptorOf } from "../task/value.ts";
import { DelegationEvidenceError } from "./errors.ts";
import { inspectChildRun } from "./inspection.ts";
import { canonical, createDelegationOutputDigest, readSupervisorId } from "./records.ts";
import type {
    ChildRunInspection,
    ChildRunResultProjection,
    DelegationTreeEntry,
    DelegationTreeProjection,
    DelegationTreeRoot,
    ProjectChildRunResultOptions,
} from "./types.ts";

const config = delegationProtocolConfig;
const [ROOT_PARENT_KIND, HANDLE_PARENT_KIND] = DELEGATION_PARENT_KINDS;
const [ACCEPTED_KIND] = DELEGATION_DECISION_KINDS;
const [HANDLE_ROOT_KIND, SUPERVISOR_ROOT_KIND] = DELEGATION_TREE_ROOT_KINDS;

/**
 * Projects the retained result of one child run handle as a typed value.
 *
 * The handle is folded with {@link inspectChildRun}. For an `accepted` handle the retained child
 * outcome value is re-validated against the retained task value's output schema, rehydrated
 * through the schema factory, normalized, and its digest must equal the accept decision's
 * `output_id`; the projection then carries the canonical value and digest. For every other status
 * `value` and `output_id` are null, so a discarded handle contributes nothing upward. A caller
 * schema proves the projected type: its document must canonically equal the retained output
 * schema, and no value is returned for a mismatched schema. The projection appends nothing and
 * works on read-only, reopened, and imported stores.
 *
 * @param store - Open trace store, writable or read-only.
 * @param handleId - Handle identity.
 * @param options - Optional caller schema typing the value.
 * @returns The frozen result projection.
 * @throws {DelegationEvidenceError} If the handle is absent, its evidence is inconsistent, or the
 * accepted output fails the retained output schema or disagrees with the retained digest.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the handle identity or options are malformed, the schema was not created
 * by the schema factory, or its document differs from the retained output schema.
 *
 * @example
 * ```ts
 * const result = projectChildRunResult(store, handle.handle_id, {
 *     schema: schema.object({ text: schema.string() }),
 * });
 * if (result.value !== null) {
 *     console.log(result.value.text);
 * }
 * ```
 */
export function projectChildRunResult<T = SemanticValue>(
    store: SQLiteTraceStore,
    handleId: string,
    options: ProjectChildRunResultOptions<T> = {},
): ChildRunResultProjection<T> {
    const fields = readScopeDataObject(options, [], "projectChildRunResult options", ["schema"]);
    assertPrefixedDigest(handleId, config.identity.handleIdPrefix, "handleId");
    const document =
        fields.schema === undefined
            ? null
            : taskSchemaMetadata(fields.schema as TaskSchema<unknown>).document;
    const inspection = inspectChildRun(store, handleId);
    if (
        document !== null &&
        canonical(document) !== canonical(inspection.task.artifact.output_schema)
    ) {
        throw new TypeError("schema does not match the retained task output schema");
    }
    return projectResult(inspection) as ChildRunResultProjection<T>;
}

/**
 * Projects the direct handles under one root as a typed delegation tree.
 *
 * A handle root lists the handles whose retained parent is that handle; a supervisor root lists
 * the root-parent handles whose current supervisor, after every retained handoff, is that
 * supervisor. Handles are enumerated through the store's schema-based owner listing over the
 * opened record schema and folded with {@link inspectChildRun}; each entry carries the handle, its
 * status, current supervisor, authority, budget, depth, task value, and result projection, in
 * canonical handle-identity order. Grandchildren are never listed and none of their records,
 * authority, or values appear: a parent's accepted value is the only thing a grandchild
 * contributes upward, and discarding a handle removes its value and everything threaded through
 * it. The projection is bounded by `limits.maxTreeEntries` and appends nothing.
 *
 * @param store - Open trace store, writable or read-only.
 * @param root - Handle root `{ kind: "handle", handleId }` or supervisor root
 * `{ kind: "supervisor", supervisorId }`.
 * @returns The frozen tree projection.
 * @throws {DelegationEvidenceError} If a handle root is not retained or any direct handle's
 * evidence is inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the root is malformed or the direct handles exceed the configured
 * tree-entry bound.
 *
 * @example
 * ```ts
 * const tree = projectDelegationTree(store, { kind: "supervisor", supervisorId: "supervisor:lead" });
 * for (const entry of tree.entries) {
 *     console.log(entry.handle_id, entry.status, entry.result.value);
 * }
 * ```
 */
export function projectDelegationTree(
    store: SQLiteTraceStore,
    root: DelegationTreeRoot,
): DelegationTreeProjection {
    const resolved = readTreeRoot(root);
    if (resolved.kind === HANDLE_ROOT_KIND) {
        inspectChildRun(store, resolved.handleId);
    }
    const limit = config.limits.maxTreeEntries;
    const entries: DelegationTreeEntry[] = [];
    for (let offset = 0; ; offset += limit) {
        const page = store.listOwnersBySchema(
            config.traceSchemas.opened,
            limit,
            offset,
            false,
            config.identity.handleIdPrefix,
        );
        for (const handleId of page) {
            if (!isDirectChild(store, handleId, resolved)) {
                continue;
            }
            const inspection = inspectChildRun(store, handleId);
            if (
                resolved.kind === SUPERVISOR_ROOT_KIND &&
                inspection.supervisor_id !== resolved.supervisorId
            ) {
                continue;
            }
            if (entries.length === limit) {
                throw new TypeError(
                    `delegation tree exceeds the configured bound of ${limit} direct handles`,
                );
            }
            entries.push(
                Object.freeze({
                    authority: inspection.authority,
                    budget: inspection.budget,
                    child_run_id: inspection.child_run_id,
                    depth: inspection.depth,
                    handle_id: inspection.handle_id,
                    result: projectResult(inspection),
                    status: inspection.status,
                    supervisor_id: inspection.supervisor_id,
                    task: inspection.task,
                }),
            );
        }
        if (page.length < limit) {
            break;
        }
    }
    entries.sort(
        (left, right) =>
            Number(left.handle_id > right.handle_id) - Number(left.handle_id < right.handle_id),
    );
    return Object.freeze({ entries: Object.freeze(entries), root: resolved });
}

function projectResult(inspection: ChildRunInspection): ChildRunResultProjection {
    const { child_run_id, decision, handle_id, status, task } = inspection;
    if (decision === null || decision.kind !== ACCEPTED_KIND) {
        return Object.freeze({
            child_outcome_record_id: null,
            child_run_id,
            decision_record_id: decision === null ? null : decision.record_id,
            handle_id,
            output_id: null,
            status,
            task,
            value: null,
        });
    }
    const outcome = (inspection.child as DurableTaskExecutionInspection)
        .outcome as DurableTaskExecutionOutcomeInspection;
    const value = readAcceptedValue(
        task,
        (outcome.outcome.outcome as { readonly value?: unknown }).value,
    );
    if (value === undefined || createDelegationOutputDigest(value) !== decision.output_id) {
        throw new DelegationEvidenceError(
            `handle ${handle_id} accepted output fails the retained output schema or its digest`,
        );
    }
    return Object.freeze({
        child_outcome_record_id: decision.child_outcome_record_id,
        child_run_id,
        decision_record_id: decision.record_id,
        handle_id,
        output_id: decision.output_id,
        status,
        task,
        value,
    });
}

function readAcceptedValue(task: TaskValue, raw: unknown): SemanticValue | undefined {
    try {
        return normalizeTaskValue(taskDescriptorOf(task).parseOutput(raw));
    } catch {
        return undefined;
    }
}

function isDirectChild(
    store: SQLiteTraceStore,
    handleId: string,
    root: DelegationTreeRoot,
): boolean {
    const opened = store.readOwner(handleId)[0] as OwnerRecord;
    const parent = opened.body.parent as {
        readonly handle_id?: unknown;
        readonly kind?: unknown;
    } | null;
    return root.kind === HANDLE_ROOT_KIND
        ? parent !== null &&
              typeof parent === "object" &&
              parent.kind === HANDLE_PARENT_KIND &&
              parent.handle_id === root.handleId
        : parent !== null && typeof parent === "object" && parent.kind === ROOT_PARENT_KIND;
}

function readTreeRoot(value: unknown): DelegationTreeRoot {
    const fields = readScopeDataObject(value, ["kind"], "projectDelegationTree root", [
        "handleId",
        "supervisorId",
    ]);
    if (fields.kind === HANDLE_ROOT_KIND) {
        if (fields.supervisorId !== undefined) {
            throw new TypeError("a handle root must not name a supervisor");
        }
        assertPrefixedDigest(fields.handleId, config.identity.handleIdPrefix, "root.handleId");
        return Object.freeze({ handleId: fields.handleId as string, kind: HANDLE_ROOT_KIND });
    }
    if (fields.kind !== SUPERVISOR_ROOT_KIND) {
        throw new TypeError("root.kind must be a configured delegation tree root kind");
    }
    if (fields.handleId !== undefined) {
        throw new TypeError("a supervisor root must not name a handle");
    }
    return Object.freeze({
        kind: SUPERVISOR_ROOT_KIND,
        supervisorId: readSupervisorId(fields.supervisorId, "root.supervisorId"),
    });
}
