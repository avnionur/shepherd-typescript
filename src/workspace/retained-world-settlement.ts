import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import {
    DURABLE_EXECUTION_RECOVERY_STATUSES,
    RETAINED_WORLD_SETTLEMENT_ACTIONS,
} from "../protocol/values.generated.ts";
import { readDurableTaskExecution } from "../run/durable-execution-recovery.ts";
import {
    RetainedWorldSettlementConflictError,
    RetainedWorldSettlementInvalidError,
} from "../store/errors.ts";
import type { RetainedWorldSettlementRequest } from "../store/types.ts";
import { assertWorkspaceBinding } from "./bindings.ts";
import { createVerifiedWorldChangeset } from "./changesets.ts";
import { assertReferenceCopyCarrier } from "./reference-copy-carrier.ts";
import type {
    PreparedRetainedWorldSettlement,
    PrepareRetainedWorldSettlementOptions,
} from "./retained-world-settlement-types.ts";
import type { RetainedWorldOutput } from "./task-world-execution-types.ts";
import { inspectTaskWorldCaptureJournal } from "./task-world-journal.ts";
import type { WorldRevision } from "./types.ts";

const [, , , , COMMITTED_RECOVERY_STATUS] = DURABLE_EXECUTION_RECOVERY_STATUSES;

/**
 * Authenticates one exact retained output and atomically prepares its consume-once settlement.
 *
 * This function reads only durable trace and retained carrier evidence. It does not mutate the
 * user binding, select a revision, or discard custody. Exact replay returns the existing prepared
 * decision; a different command or action conflicts at the store transaction.
 *
 * @param options - Exact action, command, output, store, binding, and carrier authority.
 * @returns Frozen authenticated prepared settlement decision.
 * @throws {RetainedWorldSettlementInvalidError} If any durable or carrier citation is absent,
 * malformed, forged, moved, or inconsistent.
 * @throws {RetainedWorldSettlementConflictError} If another exact request owns the command or
 * output identity.
 *
 * @example
 * ```ts
 * const prepared = await prepareRetainedWorldSettlement({
 *     action: "select",
 *     binding,
 *     carrier,
 *     commandId: "settlement:review:1",
 *     output: captured.output,
 *     store,
 * });
 * prepared.state;
 * ```
 *
 * @public
 */
export async function prepareRetainedWorldSettlement(
    options: PrepareRetainedWorldSettlementOptions,
): Promise<PreparedRetainedWorldSettlement> {
    try {
        const fields = exactObject(options, [
            "action",
            "binding",
            "carrier",
            "commandId",
            "output",
            "store",
        ]);
        if (!RETAINED_WORLD_SETTLEMENT_ACTIONS.includes(fields.action as never)) {
            throw new TypeError("retained-world settlement action is unsupported");
        }
        if (typeof fields.commandId !== "string" || fields.commandId.length === 0) {
            throw new TypeError("retained-world settlement command identity is invalid");
        }
        const binding = fields.binding as PrepareRetainedWorldSettlementOptions["binding"];
        const carrier = fields.carrier as PrepareRetainedWorldSettlementOptions["carrier"];
        const store = fields.store as PrepareRetainedWorldSettlementOptions["store"];
        assertWorkspaceBinding(binding);
        assertReferenceCopyCarrier(carrier);
        const output = readOutput(fields.output);
        const recovery = readDurableTaskExecution(store, output.run_id);
        if (recovery.status !== COMMITTED_RECOVERY_STATUS) {
            throw new TypeError("retained-world execution is not committed");
        }
        const journal = inspectTaskWorldCaptureJournal(store, output.run_id);
        if (
            journal.capture_id !== output.capture_id ||
            journal.output_record_id !== output.capture_record_id
        ) {
            throw new TypeError("retained-world capture journal is inconsistent");
        }
        const outputRecord = store.readRecord(output.capture_record_id);
        if (
            outputRecord === undefined ||
            canonicalizeRecord(outputRecord.body as SemanticRecord) !==
                canonicalizeRecord(outputBody(output)) ||
            recovery.result.ledger.outcome_record_id !== output.execution_outcome_record_id ||
            canonicalizeRecord(recovery.result.ledger.cut as unknown as SemanticRecord) !==
                canonicalizeRecord(output.execution_cut as unknown as SemanticRecord)
        ) {
            throw new TypeError("retained-world terminal evidence is inconsistent");
        }
        if (binding.binding_id !== output.binding_id) {
            throw new TypeError("retained-world binding authority is inconsistent");
        }
        const base = await carrier.openRevision(output.base_revision_id);
        const head = await carrier.openRevision(output.head_revision_id);
        const evidence = await createVerifiedWorldChangeset({
            baseRevision: base,
            carrier,
            headRevision: head,
        });
        assertRevisionContract(evidence.baseRevision, evidence.headRevision, output);
        // Authenticated content-addressed revisions make disagreement possible only after a
        // digest collision or an implementation defect in the shared changeset constructor.
        /* node:coverage ignore next 3 */
        if (evidence.changeset.changeset_id !== output.changeset_id) {
            throw new TypeError("retained-world changeset identity is inconsistent");
        }
        const custody = await carrier.openCustody(output.custody_id);
        const custodyVerification = await carrier.verifyCustody(output.custody_id);
        if (
            custody.binding_id !== output.binding_id ||
            custody.base_revision_id !== output.base_revision_id ||
            custody.base_content_id !== base.content_id ||
            custodyVerification.content_id !== head.content_id
        ) {
            throw new TypeError("retained-world custody evidence is inconsistent");
        }
        const request = Object.freeze({
            action: fields.action as RetainedWorldSettlementRequest["action"],
            base_revision_id: output.base_revision_id,
            binding_id: output.binding_id,
            capture_record_id: output.capture_record_id,
            changeset_id: output.changeset_id,
            command_id: fields.commandId,
            custody_id: output.custody_id,
            execution_cut_id: output.execution_cut.cut_id,
            head_revision_id: output.head_revision_id,
            output_id: output.output_id,
            run_id: output.run_id,
            settlement_version: workspaceProtocolConfig.settlement.version,
            user_basis_before: output.user_basis_before,
        }) satisfies RetainedWorldSettlementRequest;
        return store.admitRetainedWorldSettlement(request);
    } catch (error) {
        if (
            error instanceof RetainedWorldSettlementInvalidError ||
            error instanceof RetainedWorldSettlementConflictError
        ) {
            throw error;
        }
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

/**
 * Inspects one durable prepared settlement decision and revalidates its immutable trace evidence.
 *
 * Inspection performs no carrier, provider, runner, or filesystem operation. It verifies the
 * retained request against the committed execution cut and exact world-capture record before
 * returning it, and therefore remains safe to use after reopening the trace store.
 *
 * @param store - Open trace store containing settlement and terminal execution evidence.
 * @param outputId - Exact retained-output identity, never a prefix or latest selector.
 * @returns Frozen prepared decision, or `undefined` when the output has no settlement admission.
 * @throws {RetainedWorldSettlementInvalidError} If settlement or cited execution evidence is
 * malformed, missing, or inconsistent.
 * @throws {TypeError} If the output identity is malformed.
 *
 * @example
 * ```ts
 * const settlement = inspectRetainedWorldSettlement(store, captured.output.output_id);
 * settlement?.request.execution_cut_id;
 * ```
 *
 * @public
 */
export function inspectRetainedWorldSettlement(
    store: PrepareRetainedWorldSettlementOptions["store"],
    outputId: string,
): PreparedRetainedWorldSettlement | undefined {
    if (typeof outputId !== "string" || outputId.length === 0) {
        throw new TypeError("retained-world settlement output identity is invalid");
    }
    try {
        const admission = store.readRetainedWorldSettlement(outputId);
        if (admission === undefined) return undefined;
        const request = admission.request;
        const recovery = readDurableTaskExecution(store, request.run_id);
        if (recovery.status !== COMMITTED_RECOVERY_STATUS) {
            throw new TypeError("retained-world settlement execution is not committed");
        }
        const journal = inspectTaskWorldCaptureJournal(store, request.run_id);
        const outputRecord = store.readRecord(request.capture_record_id);
        if (
            journal.output_record_id !== request.capture_record_id ||
            outputRecord === undefined ||
            outputRecord.body.output_id !== request.output_id ||
            outputRecord.body.run_id !== request.run_id ||
            outputRecord.body.binding_id !== request.binding_id ||
            outputRecord.body.base_revision_id !== request.base_revision_id ||
            outputRecord.body.head_revision_id !== request.head_revision_id ||
            outputRecord.body.changeset_id !== request.changeset_id ||
            outputRecord.body.custody_id !== request.custody_id ||
            outputRecord.body.user_basis_before !== request.user_basis_before ||
            recovery.result.ledger.cut.cut_id !== request.execution_cut_id
        ) {
            throw new TypeError("retained-world settlement trace evidence is inconsistent");
        }
        return admission;
    } catch (error) {
        if (error instanceof RetainedWorldSettlementInvalidError) throw error;
        throw new RetainedWorldSettlementInvalidError(
            workspaceProtocolConfig.settlement.errors.invalidMessage,
            { cause: error },
        );
    }
}

function assertRevisionContract(
    base: WorldRevision,
    head: WorldRevision,
    output: RetainedWorldOutput,
): void {
    // Retained carrier verification normally rejects these descriptor contradictions first.
    /* node:coverage ignore next 10 */
    if (
        base.binding_id !== output.binding_id ||
        base.content_id !== output.user_basis_before ||
        head.binding_id !== output.binding_id ||
        head.parent_revision_id !== base.revision_id
    ) {
        throw new TypeError("retained-world revision evidence is inconsistent");
    }
}

function readOutput(value: unknown): RetainedWorldOutput {
    const fields = exactObject(value, [
        "base_revision_id",
        "binding_id",
        "capture_id",
        "capture_record_id",
        "custody_id",
        "changeset_id",
        "execution_cut",
        "execution_outcome_record_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "schema_version",
        "status",
        "user_basis_after",
        "user_basis_before",
    ]);
    const cut = exactObject(fields.execution_cut, [
        "created_by_record_id",
        "cut_id",
        "publisher_owner_id",
        "target_owner_id",
        "through_owner_ordinal",
        "through_record_id",
    ]);
    const output = Object.freeze({
        ...fields,
        execution_cut: Object.freeze({ ...cut }),
    }) as unknown as RetainedWorldOutput;
    if (
        output.schema_version !== workspaceProtocolConfig.worldTaskCapture.version ||
        output.status !== workspaceProtocolConfig.worldTaskCapture.statuses[0]
    ) {
        throw new TypeError("retained-world output contract is unsupported");
    }
    const textFields = [
        "base_revision_id",
        "binding_id",
        "capture_id",
        "capture_record_id",
        "custody_id",
        "changeset_id",
        "execution_outcome_record_id",
        "head_revision_id",
        "output_id",
        "run_id",
        "user_basis_after",
        "user_basis_before",
    ] as const;
    if (
        textFields.some((field) => typeof output[field] !== "string" || output[field].length === 0)
    ) {
        throw new TypeError("retained-world output identity is invalid");
    }
    return output;
}

function outputBody(output: RetainedWorldOutput): SemanticRecord {
    return {
        base_revision_id: output.base_revision_id,
        binding_id: output.binding_id,
        capture_id: output.capture_id,
        changeset_id: output.changeset_id,
        custody_id: output.custody_id,
        head_revision_id: output.head_revision_id,
        output_id: output.output_id,
        run_id: output.run_id,
        schema_version: output.schema_version,
        status: output.status,
        user_basis_after: output.user_basis_after,
        user_basis_before: output.user_basis_before,
    };
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained-world settlement input must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expected = [...keys].sort();
    if (
        ownKeys.some((key) => typeof key !== "string") ||
        ownKeys.length !== expected.length ||
        (ownKeys as string[]).sort().some((key, index) => key !== expected[index]) ||
        (ownKeys as string[]).some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained-world settlement input must be exact data");
    }
    return Object.fromEntries(
        keys.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}
