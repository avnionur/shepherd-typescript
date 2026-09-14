import { mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
    createEffectHandlerStack,
    createEffectIntent,
    createStaticProvider,
    type EffectHandlerStack,
    type EffectReversibility,
    type ModelProvider,
    type ModelRequest,
    type ReplaySessionContext,
    type ReplaySessionProgram,
    type StaticProviderExchange,
} from "../../src/index.ts";

/** Absolute path of the cooperative counter worker used by process tests. */
export const COUNTER_WORKER = fileURLToPath(new URL("./counter-worker.ts", import.meta.url));

/** Creates one temporary directory removed after the test. */
export async function temporaryDirectory(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-replay-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

/** Creates an empty child directory and returns its path. */
export async function emptyDirectory(parent: string, name: string): Promise<string> {
    const directory = path.join(parent, name);
    await mkdir(directory, { recursive: true });
    return directory;
}

/** Builds one canonical provider request. */
export function requestOf(step: number, instruction = "summarize"): ModelRequest {
    return { input: { step }, instruction, outputSchema: { type: "object" } };
}

/** Builds one static exchange for a request. */
export function exchangeOf(
    request: ModelRequest,
    output: Record<string, string>,
    cacheReadInputTokens = 0,
): StaticProviderExchange {
    return {
        request,
        response: {
            output,
            usage: {
                cacheCreationInputTokens: cacheReadInputTokens === 0 ? 4 : 0,
                cacheReadInputTokens,
                costUsd: null,
                inputTokens: 10,
                outputTokens: 2,
            },
        },
    };
}

/** Builds one static provider. */
export function providerOf(
    id: string,
    exchanges: readonly StaticProviderExchange[],
): ModelProvider {
    return createStaticProvider({ descriptor: { id, model: "fixture-v1" }, exchanges });
}

/** Builds one effect intent. */
export function intentOf(
    effectId: string,
    kind: string,
    payload: Record<string, string | boolean>,
    reversibility: EffectReversibility = "reversible",
) {
    return createEffectIntent({ effectId, kind, payload, reversibility });
}

/** Handler stack writing files into a world root and recording every invocation. */
export function worldHandlers(root: string, calls: string[] = [], suffix = ""): EffectHandlerStack {
    return createEffectHandlerStack([
        {
            handle: async (intent) => {
                const payload = intent.payload as { readonly name: string; readonly text: string };
                calls.push(`write:${payload.name}`);
                await writeFile(path.join(root, payload.name), `${payload.text}${suffix}`);
                return { ok: true, value: { written: payload.name } };
            },
            handlerId: "handler:write",
            kind: "file.write",
        },
        {
            handle: (intent) => {
                calls.push(`notify:${intent.effect_id}`);
                return { ok: true, value: null };
            },
            handlerId: "handler:notify",
            kind: "notify",
        },
    ]);
}

/**
 * Deterministic program: provider step 0, file write 1 (depends on 0), irreversible notify 2 (no
 * dependencies), checkpoint, provider step 3 (depends on 0), file write 4 (depends on 3), independent
 * notify 5, result from step 3.
 */
export const reviewProgram: ReplaySessionProgram = async (context: ReplaySessionContext) => {
    const plan = await context.invokeProvider(requestOf(0));
    await context.dispatchEffect(
        intentOf("effect:draft", "file.write", { name: "draft.txt", text: "draft" }),
        { dependsOn: [plan.handle] },
    );
    await context.dispatchEffect(
        intentOf("effect:notify:1", "notify", { stage: "draft" }, "irreversible"),
        { dependsOn: [] },
    );
    await context.checkpoint();
    const final = await context.invokeProvider(requestOf(1), { dependsOn: [plan.handle] });
    const text = (final.response.output as { readonly text: string }).text;
    await context.dispatchEffect(
        intentOf("effect:final", "file.write", { name: "final.txt", text }),
        { dependsOn: [final.handle] },
    );
    await context.dispatchEffect(
        intentOf("effect:notify:2", "notify", { stage: "final" }, "irreversible"),
        { dependsOn: [] },
    );
    return { text };
};

/** Static provider serving the review program's two exchanges. */
export function reviewProvider(finalText = "final", cacheReadInputTokens = 0): ModelProvider {
    return providerOf("provider:review", [
        exchangeOf(requestOf(0), { text: "plan" }),
        exchangeOf(requestOf(1), { text: finalText }, cacheReadInputTokens),
    ]);
}

/** Reads a directory tree as a canonical path-to-content listing including modes and links. */
export async function readTree(root: string): Promise<Record<string, string>> {
    const entries: Record<string, string> = {};
    const walk = async (relative: string): Promise<void> => {
        const directory = path.join(root, relative);
        for (const name of (await readdir(directory)).sort()) {
            const child = path.join(directory, name);
            const key = relative === "" ? name : `${relative}/${name}`;
            const status = await stat(child).catch(() => null);
            const link = await readlink(child).catch(() => null);
            if (link !== null) {
                entries[key] = `link:${link}`;
            } else if (status?.isDirectory() === true) {
                entries[key] = `dir:${(status.mode & 0o777).toString(8)}`;
                await walk(key);
            } else {
                entries[key] =
                    `file:${((status?.mode ?? 0) & 0o777).toString(8)}:${(await readFile(child)).toString("base64")}`;
            }
        }
    };
    await walk("");
    return entries;
}
