import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    createEffectHandlerStack,
    createEffectIntent,
    type EffectHandlerStack,
    type EffectIntent,
    type EffectReversibility,
    ROOT_WITNESS_ID,
    type SQLiteTraceStore,
    type SupervisionInterceptor,
    type SupervisionInterceptorResult,
} from "../../src/index.ts";

/** Creates one temporary file-backed trace store path removed after the test. */
export async function temporaryDatabasePath(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-supervision-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return path.join(directory, "trace.sqlite");
}

/** Appends one record to an owner path and returns its identity. */
export function appendOwnerRecord(store: SQLiteTraceStore, ownerId: string, label: string): string {
    const receipt = store.append({
        append_intent_id: `intent:${ownerId}:${label}`,
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: { label, owner: ownerId },
                            mode: "capture",
                            schema_ref: "example.worker.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    return receipt.record_ids[0] as string;
}

/** Builds one canonical effect intent. */
export function intentOf(
    reversibility: EffectReversibility = "reversible",
    payload: { readonly [key: string]: string } = { path: "notes.txt" },
): EffectIntent {
    return createEffectIntent({
        effectId: "effect:write:1",
        kind: "file.write",
        payload,
        reversibility,
    });
}

/** Handler stack that records invocations and returns success. */
export function recordingHandlers(invocations: EffectIntent[] = []): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: (intent) => {
                invocations.push(intent);
                return { ok: true, value: { written: intent.payload } };
            },
            handlerId: "handler:file",
            kind: "file.write",
        },
    ]);
}

/** Builds one interceptor with fixture defaults. */
export function interceptor(
    interceptorId: string,
    decide: SupervisionInterceptor["decide"],
    overrides: Partial<Omit<SupervisionInterceptor, "decide" | "interceptorId">> = {},
): SupervisionInterceptor {
    return {
        decide,
        interceptorId,
        priority: overrides.priority ?? 0,
        timeoutMilliseconds: overrides.timeoutMilliseconds ?? 1_000,
        timeoutPolicy: overrides.timeoutPolicy ?? "fail_closed",
    };
}

/** Returns a fixed interceptor result. */
export function always(result: SupervisionInterceptorResult): SupervisionInterceptor["decide"] {
    return () => result;
}

/** Waits until a predicate holds, polling every few milliseconds. */
export async function eventually(
    predicate: () => boolean,
    timeoutMilliseconds = 5_000,
): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMilliseconds) {
            throw new Error("condition was not reached in time");
        }
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
}
