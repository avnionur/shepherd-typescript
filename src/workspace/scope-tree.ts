import { canonicalizeRecord, type SemanticRecord } from "../canonical/canonical-record.ts";
import { scopeProtocolConfig } from "../protocol/config.ts";
import {
    SCOPE_COMMAND_KINDS,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_SCHEDULING_DECISIONS,
    SCOPE_SCHEDULING_LIMITS,
    SCOPE_SCHEDULING_OUTCOMES,
    SCOPE_STATES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import { emitScopeRecord } from "../scope/emission.ts";
import { ScopeMergeConflictError } from "../scope/errors.ts";
import { inspectScope } from "../scope/inspection.ts";
import { createScopeId, readScopeData, readScopeEmissionRecord } from "../scope/records.ts";
import { registerChildScope } from "../scope/registration.ts";
import { readScopeCommandReceipt } from "../scope/replay.ts";
import { readScopeMergeRecord } from "../scope/terminal-records.ts";
import type {
    ScopeEmissionReceipt,
    ScopeInspection,
    ScopeMergePreparedRecord,
    ScopeParentOrigin,
    ScopeTerminalInspection,
    ScopeWriter,
} from "../scope/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import { assertScopeWriter, claimScopeWriter, releaseScopeWriter } from "../scope/writer.ts";
import { AppendIntentConflictError } from "../store/errors.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import { assertWorkspaceBinding } from "./bindings.ts";
import { assertReferenceCopyCarrier } from "./reference-copy-carrier.ts";
import { discardScope } from "./scope-discard.ts";
import { forkScope } from "./scope-fork.ts";
import { mergeScope } from "./scope-merge.ts";
import type {
    RunScopeTreeOptions,
    ScopeTreeContext,
    ScopeTreeDecision,
    ScopeTreeNode,
    ScopeTreeOutcome,
    ScopeTreeReport,
} from "./scope-tree-types.ts";
import type { ReferenceCopyCarrier } from "./types.ts";

const [OPEN_STATE, MERGED_STATE] = SCOPE_STATES;
const [MERGE_DECISION, DISCARD_DECISION] = SCOPE_SCHEDULING_DECISIONS;
const [MERGED_OUTCOME, DISCARDED_OUTCOME, CONFLICTED_OUTCOME, FAILED_OUTCOME] =
    SCOPE_SCHEDULING_OUTCOMES;
const [, , EMIT_COMMAND, , MERGE_COMMAND] = SCOPE_COMMAND_KINDS;
const DISCARD_DECIDED_KIND = SCOPE_EVIDENCE_KINDS[10];

type Scheduler = {
    readonly carrier: ReferenceCopyCarrier | undefined;
    readonly commandPrefix: string;
    readonly maxParallel: number;
    readonly store: SQLiteTraceStore;
};

type ScheduledParent = {
    readonly claimId: string;
    readonly lock: <T>(task: () => Promise<T>) => Promise<T>;
    readonly path: readonly string[];
    readonly scopeId: string;
};

type ScheduledChild = ScheduledParent & {
    readonly commandBase: string;
    readonly node: ValidatedNode;
};

type ValidatedNode = {
    readonly children: readonly ValidatedNode[];
    readonly fork: ScopeTreeNode["fork"];
    readonly grant: ScopeTreeNode["grant"];
    readonly key: string;
    readonly run: NonNullable<ScopeTreeNode["run"]>;
};

type RanChild = {
    readonly child: ScheduledChild;
    readonly children: readonly ScopeTreeOutcome[];
    readonly decision: ScopeTreeDecision;
    readonly failure: string | null;
};

/**
 * Schedules a tree of child scopes with bounded sibling parallelism and settles each exactly once.
 *
 * Children of one parent are created in declared order under that parent's writer, then their
 * subtrees run with at most `maxParallel` siblings in flight. Nesting is depth-first: every child's
 * own children are created, run, and settled before the child's work runs with their outcomes.
 * Settlement of siblings is serialized in declared order under the parent, so results and the
 * parent's selected history do not depend on the degree of parallelism. Work returns `merge` or
 * `discard` (merge by default). A throwing work function or an invalid decision discards only that
 * scope's subtree and reports `failed`; a merge refused for overlapping world changes discards the
 * child and reports `conflicted`. Every other refusal fails the schedule closed.
 *
 * Every command and writer claim identity is derived from `commandPrefix` and the node key path,
 * so re-running the same schedule after a crash resumes from retained receipts: created scopes
 * are reused, incomplete forks, reserved merges, and pending discard cleanup resume, and settled
 * scopes are not run again. Work of unsettled scopes may run again, so its side effects must be
 * idempotent; `context.emit` replays retained emissions. Writers are re-claimed under their
 * deterministic claim identities before each mutation, which renews an expired lease held by this
 * schedule and fails closed when another holder is active. A reference-copy child can be merged
 * only into a parent that owns reference-copy custody.
 *
 * @param store - Open writable trace store holding the parent registration.
 * @param options - Parent writer, declared children, deterministic prefix, bound, and carrier.
 * @returns Frozen report of settled outcomes in declared order.
 * @throws {ScopeWriterConflictError} If another holder owns a scheduled writer.
 * @throws {ScopeEvidenceError} If retained evidence is inconsistent or a world child merges into a
 * parent without managed custody.
 * @throws {ScopeAuthorityError} If a node's grant or merge exceeds authority.
 * @throws {AppendIntentConflictError} If a derived command identity names different content.
 * @throws {WorldCarrierError} If carrier evidence is unavailable or in an unknown physical state.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options or nodes are malformed or exceed configured bounds.
 *
 * @example
 * ```ts
 * const report = await runScopeTree(store, {
 *     children: [
 *         { grant: [], key: "draft", run: (scope) => (scope.emit("note", { ok: true }), "merge") },
 *         { grant: [], key: "probe", run: () => "discard" },
 *     ],
 *     commandPrefix: "schedule:review-1",
 *     maxParallel: 2,
 *     parent: rootWriter,
 * });
 * ```
 *
 * @public
 */
export async function runScopeTree(
    store: SQLiteTraceStore,
    options: RunScopeTreeOptions,
): Promise<ScopeTreeReport> {
    const fields = readScopeDataObject(
        options,
        ["children", "commandPrefix", "maxParallel", "parent"],
        "runScopeTree options",
        ["carrier"],
    );
    assertScopeText(fields.commandPrefix, "commandPrefix");
    assertScopeWriter(fields.parent, store);
    if (
        !Number.isSafeInteger(fields.maxParallel) ||
        (fields.maxParallel as number) < 1 ||
        (fields.maxParallel as number) > SCOPE_SCHEDULING_LIMITS.maxParallel
    ) {
        throw new TypeError("maxParallel must be a positive integer within the configured bound");
    }
    if (fields.carrier !== undefined) {
        assertReferenceCopyCarrier(fields.carrier);
    }
    const counter = { nodes: 0 };
    const children = readNodes(fields.children, 1, counter, fields.carrier !== undefined);
    const scheduler: Scheduler = {
        carrier: fields.carrier as ReferenceCopyCarrier | undefined,
        commandPrefix: fields.commandPrefix,
        maxParallel: fields.maxParallel as number,
        store,
    };
    const parent = fields.parent;
    const outcomes = await settleGroup(
        scheduler,
        { claimId: parent.claim_id, lock: createLock(), path: [], scopeId: parent.scope_id },
        children,
    );
    return Object.freeze({ outcomes, parent_scope_id: parent.scope_id });
}

function readNodes(
    value: unknown,
    depth: number,
    counter: { nodes: number },
    hasCarrier: boolean,
): readonly ValidatedNode[] {
    const nodes = readScopeArray(value, "tree children").map((node): ValidatedNode => {
        const fields = readScopeDataObject(node, ["grant", "key"], "tree node", [
            "children",
            "fork",
            "run",
        ]);
        assertScopeText(fields.key, "tree node key");
        if (fields.key.includes(scopeProtocolConfig.scheduling.pathSeparator)) {
            throw new TypeError("tree node key must not contain the configured path separator");
        }
        if (fields.run !== undefined && typeof fields.run !== "function") {
            throw new TypeError("tree node run must be a function");
        }
        if (fields.fork !== undefined) {
            assertWorkspaceBinding(
                readScopeDataObject(fields.fork, ["binding"], "tree node fork").binding,
            );
            if (!hasCarrier) {
                throw new TypeError("a forked tree node requires a carrier");
            }
        }
        counter.nodes += 1;
        return Object.freeze({
            children:
                fields.children === undefined
                    ? []
                    : readNodes(fields.children, depth + 1, counter, hasCarrier),
            fork: fields.fork as ScopeTreeNode["fork"],
            grant: fields.grant as ScopeTreeNode["grant"],
            key: fields.key,
            run: (fields.run ?? mergeByDefault) as ValidatedNode["run"],
        });
    });
    if (
        (nodes.length > 0 && depth > SCOPE_SCHEDULING_LIMITS.maxDepth) ||
        counter.nodes > SCOPE_SCHEDULING_LIMITS.maxNodes ||
        new Set(nodes.map((node) => node.key)).size !== nodes.length
    ) {
        throw new TypeError("tree nodes must have unique keys within the configured bounds");
    }
    return Object.freeze(nodes);
}

async function settleGroup(
    scheduler: Scheduler,
    parent: ScheduledParent,
    nodes: readonly ValidatedNode[],
): Promise<readonly ScopeTreeOutcome[]> {
    const created: ScheduledChild[] = [];
    for (const node of nodes) {
        created.push(await createChild(scheduler, parent, node));
    }
    const limit = createSemaphore(scheduler.maxParallel);
    const runs = await Promise.allSettled(
        created.map((child) => limit(() => runSubtree(scheduler, child))),
    );
    const outcomes: ScopeTreeOutcome[] = [];
    for (const run of runs) {
        if (run.status === "rejected") {
            throw run.reason;
        }
        outcomes.push(await settle(scheduler, parent, run.value));
    }
    return Object.freeze(outcomes);
}

async function createChild(
    scheduler: Scheduler,
    parent: ScheduledParent,
    node: ValidatedNode,
): Promise<ScheduledChild> {
    const { commandSuffixes, pathSeparator } = scopeProtocolConfig.scheduling;
    const path = Object.freeze([...parent.path, node.key]);
    const commandBase = [scheduler.commandPrefix, ...path].join(pathSeparator);
    const commandId = `${commandBase}${pathSeparator}${commandSuffixes.create}`;
    const scopeId = createScopeId(commandId, parent.scopeId);
    const { store } = scheduler;
    await parent.lock(async () => {
        const existing = inspectScope(store, scopeId);
        if (existing !== undefined && existing.state !== OPEN_STATE) {
            return;
        }
        const parentWriter = reclaim(store, parent);
        // A retained registration fixes its original parent head and fork origin.
        const expectedHeadRecordId =
            existing === undefined
                ? headOf(store, parent.scopeId)
                : (existing.parent as ScopeParentOrigin).origin_record_id;
        if (node.fork === undefined) {
            registerChildScope(store, {
                commandId,
                expectedHeadRecordId,
                grant: node.grant,
                parent: parentWriter,
            });
            return;
        }
        const carrier = scheduler.carrier as ReferenceCopyCarrier;
        const parentWorld = (inspectScope(store, parent.scopeId) as ScopeInspection).world;
        const originRevisionId =
            existing?.world?.base_revision_id ??
            (parentWorld === null
                ? (await carrier.snapshot(node.fork.binding)).revision_id
                : (await carrier.captureCustody(parentWorld.custody_id)).revision_id);
        await forkScope(store, {
            binding: node.fork.binding,
            carrier,
            commandId,
            expectedHeadRecordId,
            grant: node.grant,
            originRevisionId,
            parent: parentWriter,
        });
    });
    return Object.freeze({
        claimId: `${commandBase}${pathSeparator}${commandSuffixes.writer}`,
        commandBase,
        lock: createLock(),
        node,
        path,
        scopeId,
    });
}

async function runSubtree(scheduler: Scheduler, child: ScheduledChild): Promise<RanChild> {
    const { store } = scheduler;
    const inspection = inspectScope(store, child.scopeId) as ScopeInspection;
    if (inspection.terminal !== null) {
        // A reserved or settled scope already ran; its children are settled.
        return {
            child,
            children: recoveredOutcomes(store, child),
            decision:
                (inspection.terminal as ScopeTerminalInspection).kind === MERGE_COMMAND
                    ? MERGE_DECISION
                    : DISCARD_DECISION,
            failure: null,
        };
    }
    const children = await settleGroup(scheduler, child, child.node.children);
    const writer = reclaim(store, child);
    const context: ScopeTreeContext = Object.freeze({
        children,
        custodyPath:
            inspection.world === null
                ? null
                : (
                      await (scheduler.carrier as ReferenceCopyCarrier).openCustody(
                          inspection.world.custody_id,
                      )
                  ).path,
        emit: (key: string, data: SemanticRecord) => emitOnce(store, child, key, data),
        path: child.path,
        scopeId: child.scopeId,
        writer,
    });
    try {
        const decision = await child.node.run(context);
        if (!SCOPE_SCHEDULING_DECISIONS.includes(decision)) {
            throw new TypeError(`tree node ${child.node.key} returned an unsupported decision`);
        }
        return { child, children, decision, failure: null };
    } catch (error) {
        return {
            child,
            children,
            decision: DISCARD_DECISION,
            failure: error instanceof Error ? error.message : String(error),
        };
    }
}

async function settle(
    scheduler: Scheduler,
    parent: ScheduledParent,
    ran: RanChild,
): Promise<ScopeTreeOutcome> {
    const { store } = scheduler;
    const carrierOption = scheduler.carrier === undefined ? {} : { carrier: scheduler.carrier };
    const { child } = ran;
    const { commandSuffixes, pathSeparator } = scopeProtocolConfig.scheduling;
    return parent.lock(async () => {
        const inspection = inspectScope(store, child.scopeId) as ScopeInspection;
        let conflicted = false;
        if (ran.decision === MERGE_DECISION && inspection.state !== MERGED_STATE) {
            const reservation =
                inspection.terminal === null
                    ? null
                    : (readScopeMergeRecord(
                          readBody(store, inspection.terminal.record_id),
                      ) as ScopeMergePreparedRecord);
            try {
                await mergeScope(store, {
                    ...carrierOption,
                    child: reclaim(store, child),
                    commandId: `${child.commandBase}${pathSeparator}${commandSuffixes.merge}`,
                    expectedChildHeadRecordId:
                        reservation === null
                            ? inspection.head.record_id
                            : reservation.child_head_record_id,
                    expectedParentHeadRecordId:
                        reservation === null
                            ? headOf(store, parent.scopeId)
                            : reservation.parent_head_record_id,
                    parent: reclaim(store, parent),
                });
            } catch (error) {
                if (!(error instanceof ScopeMergeConflictError)) {
                    throw error;
                }
                conflicted = true;
            }
        }
        if (ran.decision === DISCARD_DECISION || conflicted) {
            const open = inspection.state === OPEN_STATE;
            if (open) {
                releaseScopeWriter(store, { writer: reclaim(store, child) });
            }
            await discardScope(store, {
                ...carrierOption,
                commandId: `${child.commandBase}${pathSeparator}${commandSuffixes.discard}`,
                // A retained decision fixes its original head.
                expectedHeadRecordId: open
                    ? inspection.head.record_id
                    : decisionHead(store, inspection),
                parent: reclaim(store, parent),
                scopeId: child.scopeId,
            });
        }
        const merged =
            (inspectScope(store, child.scopeId) as ScopeInspection).state === MERGED_STATE;
        return Object.freeze({
            children: ran.children,
            failure: ran.failure,
            key: child.node.key,
            scope_id: child.scopeId,
            status: merged
                ? MERGED_OUTCOME
                : ran.failure !== null
                  ? FAILED_OUTCOME
                  : conflicted
                    ? CONFLICTED_OUTCOME
                    : DISCARDED_OUTCOME,
        });
    });
}

function recoveredOutcomes(
    store: SQLiteTraceStore,
    parent: ScheduledChild,
): readonly ScopeTreeOutcome[] {
    const { commandSuffixes, pathSeparator } = scopeProtocolConfig.scheduling;
    return Object.freeze(
        parent.node.children.map((node) => {
            const commandBase = `${parent.commandBase}${pathSeparator}${node.key}`;
            const scopeId = createScopeId(
                `${commandBase}${pathSeparator}${commandSuffixes.create}`,
                parent.scopeId,
            );
            const child: ScheduledChild = {
                claimId: `${commandBase}${pathSeparator}${commandSuffixes.writer}`,
                commandBase,
                lock: parent.lock,
                node,
                path: [...parent.path, node.key],
                scopeId,
            };
            return Object.freeze({
                children: recoveredOutcomes(store, child),
                failure: null,
                key: node.key,
                scope_id: scopeId,
                status:
                    (inspectScope(store, scopeId) as ScopeInspection).state === MERGED_STATE
                        ? MERGED_OUTCOME
                        : DISCARDED_OUTCOME,
            });
        }),
    );
}

function emitOnce(
    store: SQLiteTraceStore,
    child: ScheduledChild,
    key: string,
    data: SemanticRecord,
): ScopeEmissionReceipt {
    assertScopeText(key, "emission key");
    const { commandSuffixes, pathSeparator } = scopeProtocolConfig.scheduling;
    const commandId = `${child.commandBase}${pathSeparator}${commandSuffixes.emit}${pathSeparator}${key}`;
    const replay = readScopeCommandReceipt(store, commandId);
    if (replay === undefined) {
        return emitScopeRecord(store, {
            commandId,
            data,
            expectedHeadRecordId: headOf(store, child.scopeId),
            writer: reclaim(store, child),
        });
    }
    if (
        replay.command !== EMIT_COMMAND ||
        replay.receipt.scope_id !== child.scopeId ||
        canonicalizeRecord(
            readScopeEmissionRecord(readBody(store, replay.receipt.head.record_id)).data,
        ) !== canonicalizeRecord(readScopeData(data, "data"))
    ) {
        throw new AppendIntentConflictError(
            `scope command ${commandId} already names different content`,
        );
    }
    return replay.receipt;
}

function reclaim(store: SQLiteTraceStore, scope: ScheduledParent): ScopeWriter {
    return claimScopeWriter(store, { claimId: scope.claimId, scopeId: scope.scopeId });
}

function headOf(store: SQLiteTraceStore, scopeId: string): RecordId {
    return (inspectScope(store, scopeId) as ScopeInspection).head.record_id;
}

function decisionHead(store: SQLiteTraceStore, inspection: ScopeInspection): RecordId {
    const decision = inspection.history.find((entry) => entry.kind === DISCARD_DECIDED_KIND) as {
        readonly record_id: RecordId;
    };
    return (
        store.readRecord(decision.record_id) as NonNullable<
            ReturnType<SQLiteTraceStore["readRecord"]>
        >
    ).envelope.caused_by_record_ids[0] as RecordId;
}

function readBody(store: SQLiteTraceStore, recordId: RecordId) {
    return (store.readRecord(recordId) as NonNullable<ReturnType<SQLiteTraceStore["readRecord"]>>)
        .body;
}

function mergeByDefault(): ScopeTreeDecision {
    return MERGE_DECISION;
}

function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(task: () => Promise<T>): Promise<T> => {
        const result = tail.then(task);
        tail = result.then(settledTail, settledTail);
        return result;
    };
}

function settledTail(): undefined {
    return undefined;
}

function createSemaphore(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
    let available = limit;
    const waiting: (() => void)[] = [];
    return async <T>(task: () => Promise<T>): Promise<T> => {
        if (available === 0) {
            await new Promise<void>((resolve) => {
                waiting.push(resolve);
            });
        } else {
            available -= 1;
        }
        try {
            return await task();
        } finally {
            const next = waiting.shift();
            if (next === undefined) {
                available += 1;
            } else {
                next();
            }
        }
    };
}
