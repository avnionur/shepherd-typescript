import { AsyncLocalStorage } from "node:async_hooks";

const scopes = new AsyncLocalStorage<string>();

/**
 * Runs one tool-call dispatch with the identity of the replay session that executes it in scope,
 * so a handler invoked by that dispatch can scope the identities it derives to the session.
 *
 * @param sessionId - Identity of the executing replay session.
 * @param dispatch - Dispatch to run inside the scope.
 * @returns The dispatch's result.
 * @internal
 */
export function runInToolEffectScope<T>(sessionId: string, dispatch: () => Promise<T>): Promise<T> {
    return scopes.run(sessionId, dispatch);
}

/**
 * Reads the identity of the replay session executing the current tool-call dispatch.
 *
 * @returns The executing session identity, or null outside a replay-bound tool loop.
 * @internal
 */
export function currentToolEffectScope(): string | null {
    return scopes.getStore() ?? null;
}
