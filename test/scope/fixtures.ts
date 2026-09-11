import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    claimScopeWriter,
    ROOT_WITNESS_ID,
    registerRootScope,
    type ScopeResourceGrant,
    type ScopeRootRegistrationReceipt,
    type ScopeWriter,
    type SQLiteTraceStore,
} from "../../src/index.ts";

/** Creates one temporary file-backed trace store path removed after the test. */
export async function temporaryDatabasePath(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-scope-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return path.join(directory, "trace.sqlite");
}

/** Builds one exact repository-binding resource grant. */
export function resource(
    resourceId: string,
    atoms: readonly ("read" | "write")[],
): ScopeResourceGrant {
    return { atoms, resource_id: resourceId, resource_kind: "repository_binding" };
}

/** Whole-run ceiling shared by the fixtures: docs read-only, source read-write. */
export const CEILING: readonly ScopeResourceGrant[] = [
    resource("resource:docs", ["read"]),
    resource("resource:source", ["read", "write"]),
];

/** Registers one root scope with the fixture ceiling and full grant. */
export function registerFixtureRoot(
    store: SQLiteTraceStore,
    commandId = "scope-command:root",
    executionId?: string,
): ScopeRootRegistrationReceipt {
    return registerRootScope(store, {
        authority: { ceiling: CEILING, grant: CEILING },
        commandId,
        ...(executionId === undefined ? {} : { executionId }),
    });
}

/** Registers a root scope and claims its writer. */
export function registerAndClaim(
    store: SQLiteTraceStore,
    commandId = "scope-command:root",
    claimId = "claim:root",
): { readonly root: ScopeRootRegistrationReceipt; readonly writer: ScopeWriter } {
    const root = registerFixtureRoot(store, commandId);
    const writer = claimScopeWriter(store, {
        claimId,
        nowMilliseconds: 1_000,
        scopeId: root.scope_id,
    });
    return { root, writer };
}

/** Appends one arbitrary retained record and returns its identity. */
export function appendUnrelatedRecord(store: SQLiteTraceStore, label: string): string {
    const receipt = store.append({
        append_intent_id: `intent:${label}`,
        batch: {
            groups: [
                {
                    owner_id: `run:${label}`,
                    records: [
                        {
                            body: { label },
                            mode: "capture",
                            schema_ref: "example.unrelated.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as string;
}

/** Appends run creation evidence for an execution owner path. */
export function appendExecutionCreation(store: SQLiteTraceStore, runId: string): string {
    const receipt = store.append({
        append_intent_id: `intent:creation:${runId}`,
        batch: {
            groups: [
                {
                    owner_id: runId,
                    records: [
                        {
                            body: { payload: { execution_id: runId } },
                            mode: "declaration",
                            schema_ref: "shepherd2.execution.created.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as string;
}
