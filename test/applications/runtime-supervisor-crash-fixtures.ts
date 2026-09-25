import {
    type ApplicationWorldAdapter,
    claimScopeWriter,
    createReferenceCopyCarrier,
    createScopeWorldAdapter,
    createWorkspaceBindings,
    type ModelConversationRequest,
    type RuntimeSupervisorDecision,
    type RuntimeSupervisorWorkerDefinition,
    type SQLiteTraceStore,
    type WorkspaceBinding,
} from "../../src/index.ts";
import { bindingGrant } from "../scope/fork-fixtures.ts";
import { runtimeWorker, say, scriptedWorker, use } from "./runtime-supervisor-fixtures.ts";

/** Command identity the process crash scenario runs under. */
export const CRASH_COMMAND = "application:runtime:crash";

/** Command identity the settlement crash scenario runs under. */
export const SETTLEMENT_COMMAND = "application:runtime:settlement-crash";

/** Supervisor identity of the process crash scenario. */
export const CRASH_SUPERVISOR = "supervisor:runtime-crash";

/** World clock of the process crash scenario. */
export const CRASH_CLOCK = () => 3_000;

/** Tick 1 of the crash scenario: inject into the leader, cross-agent handoff of the follower. */
export const CRASH_DECISIONS: readonly RuntimeSupervisorDecision[] = [
    {
        action: "inject",
        agent: "a",
        guidance: "Agent b will restart from your tree; keep lead.txt stable.",
        reason: "coordinate",
    },
    {
        action: "handoff",
        agent: "b",
        guidance: "Restart from a's tree and build on lead.txt.",
        leader: "a",
        reason: "b is looping",
    },
];

/**
 * Rebuilds the scope world adapter of a fixture workspace from its root, an open store, and the
 * retained parent scope, as a fresh process does.
 */
export function reopenSupervisorWorld(
    workspaceRoot: string,
    store: SQLiteTraceStore,
    parentScopeId: string,
): ApplicationWorldAdapter {
    const [source] = createWorkspaceBindings({
        bindings: [
            { name: "source", root: "source" },
            { name: "docs", root: "docs" },
        ],
        workspaceRoot,
    }).bindings as readonly [WorkspaceBinding, WorkspaceBinding];
    return createScopeWorldAdapter({
        binding: source,
        carrier: createReferenceCopyCarrier({ workspaceRoot }),
        grant: [bindingGrant(source)],
        parent: claimScopeWriter(store, {
            claimId: "claim:supervisor-parent",
            nowMilliseconds: 1_500,
            scopeId: parentScopeId,
        }),
        store,
    });
}

/**
 * Workers of the crash scenario. Worker a writes `lead.txt`, then its second turn either never
 * answers (the process that is killed) or writes again and finishes. Worker b writes `b.txt` and
 * stalls until the handoff restarts it from a's tree, where it reads `lead.txt` and finishes.
 */
export function crashWorkers(stall: boolean): {
    readonly requests: {
        readonly a: ModelConversationRequest[];
        readonly b: ModelConversationRequest[];
    };
    readonly workers: readonly RuntimeSupervisorWorkerDefinition[];
} {
    const never = () => new Promise<never>(() => {});
    const a = scriptedWorker("model:a", [
        [
            () => [use("a1", "write_file", { path: "lead.txt", text: "leader tree" })],
            async () => {
                if (stall) {
                    await never();
                }
                return [use("a2", "write_file", { path: "lead.txt", text: "leader tree v2" })];
            },
            () => [say("a done")],
        ],
    ]);
    const b = scriptedWorker(
        "model:b",
        [
            [
                () => [use("b1", "write_file", { path: "b.txt", text: "stale" })],
                async (_request, signal) => {
                    await new Promise((_resolve, reject) =>
                        signal.addEventListener("abort", () => reject(signal.reason), {
                            once: true,
                        }),
                    );
                    return [say("never")];
                },
            ],
            [() => [use("b2", "read_file", { path: "lead.txt" })], () => [say("b done")]],
        ],
        // A handoff session's first user message carries the guidance after the feature.
        (request) => (request.messages[0]?.content.length ?? 1) - 1,
    );
    return {
        requests: { a: a.requests, b: b.requests },
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
    };
}

/** Tick 1 of the settlement crash scenario: discard both workers, so settlement discards two custodies. */
export const SETTLEMENT_DECISIONS: readonly RuntimeSupervisorDecision[] = [
    { action: "discard", agent: "a", reason: "restart a" },
    { action: "discard", agent: "b", reason: "restart b" },
];

/**
 * Workers of the settlement crash scenario: each writes one file, then waits until the discard
 * aborts it; the fresh session after the discard finishes at once.
 */
export function discardWorkers(): {
    readonly requests: {
        readonly a: ModelConversationRequest[];
        readonly b: ModelConversationRequest[];
    };
    readonly workers: readonly RuntimeSupervisorWorkerDefinition[];
} {
    const worker = (id: string) =>
        scriptedWorker(`model:${id}`, [
            [
                () => [use(`${id}1`, "write_file", { path: `${id}.txt`, text: "abandoned" })],
                (_request, signal) =>
                    new Promise((_resolve, reject) => {
                        signal.addEventListener("abort", () => reject(signal.reason), {
                            once: true,
                        });
                    }),
            ],
            [() => [say(`${id} done`)]],
        ]);
    const a = worker("a");
    const b = worker("b");
    return {
        requests: { a: a.requests, b: b.requests },
        workers: [runtimeWorker("a", a.model), runtimeWorker("b", b.model)],
    };
}
