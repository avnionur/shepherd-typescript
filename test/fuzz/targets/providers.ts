import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
    canonicalizeRecord,
    readApplicationProtocol,
    type SemanticRecord,
} from "../../../src/index.ts";
import {
    readModelResponse,
    readStaticProviderDefinition,
} from "../../../src/provider/validation.ts";
import type { FuzzInput, FuzzTarget } from "../harness.ts";
import { repositoryRoot } from "../harness.ts";
import { assertCanonicalStable } from "./records.ts";

const USAGE = {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: null,
    inputTokens: 8,
    outputTokens: 3,
};

const RESPONSES = [
    { output: "Hello, Ada", usage: USAGE },
    { output: { nested: [1, { value: true }] }, usage: { ...USAGE, costUsd: 0.25 } },
];

/** Splits a reader result into the canonical values it is made of, and joins them back. */
type SnapshotParts = {
    readonly split: (result: unknown) => readonly unknown[];
    readonly join: (parts: readonly unknown[]) => unknown;
};

/** A result that is itself one canonical value. */
const WHOLE: SnapshotParts = { join: ([whole]) => whole, split: (result) => [result] };

/**
 * A static provider definition is never canonicalized as a whole: it holds independently bounded
 * requests and responses, each of which may use the whole configured nesting bound (F-016).
 */
const PROVIDER_DEFINITION: SnapshotParts = {
    join: ([descriptor, ...exchanges]) => ({
        descriptor,
        exchanges: Array.from({ length: exchanges.length / 2 }, (_entry, index) => ({
            request: exchanges[2 * index],
            response: exchanges[2 * index + 1],
        })),
    }),
    split: (result) => {
        const definition = result as {
            readonly descriptor: unknown;
            readonly exchanges: readonly {
                readonly request: unknown;
                readonly response: unknown;
            }[];
        };
        return [
            definition.descriptor,
            ...definition.exchanges.flatMap(({ request, response }) => [request, response]),
        ];
    },
};

/**
 * Reader that snapshots its input: every canonical part of accepted output encodes canonically,
 * and re-reading the parts' canonical text reproduces them.
 */
function snapshotTarget(
    name: string,
    reader: (value: unknown) => unknown,
    seeds: () => readonly unknown[],
    parts: SnapshotParts = WHOLE,
): FuzzTarget {
    const encode = (result: unknown): readonly string[] =>
        parts.split(result).map((part) => canonicalizeRecord(part as SemanticRecord));
    return {
        name,
        prepare: async () => ({
            execute: (input) => reader((input as { value: unknown }).value),
            seeds: seeds().map((value) => ({ kind: "value", value }) as FuzzInput),
            verifyAccepted: (result) => {
                const encoded = encode(result);
                for (const part of encoded) assertCanonicalStable(part);
                // Canonical comparison instead of deepEqual on values, which recurses on the
                // harness stack; JSON.parse is iterative.
                const reread = reader(parts.join(encoded.map((part) => JSON.parse(part))));
                assert.deepEqual(encode(reread), encoded);
            },
        }),
    };
}

function applicationSeeds(): readonly unknown[] {
    const definitions = JSON.parse(
        readFileSync(path.join(repositoryRoot, "config/research-applications.config.json"), "utf8"),
    ) as Record<string, unknown>;
    return Object.values(definitions).filter((definition) => {
        try {
            readApplicationProtocol(definition);
            return true;
        } catch {
            return false;
        }
    });
}

/** Provider response and definition readers and the application protocol reader. */
export const PROVIDER_TARGETS: readonly FuzzTarget[] = [
    snapshotTarget(
        "readModelResponse",
        (value) => readModelResponse(value),
        () => RESPONSES,
    ),
    snapshotTarget(
        "readStaticProviderDefinition",
        readStaticProviderDefinition,
        () => [
            {
                descriptor: { id: "fuzz-fixture", model: "offline-v1" },
                exchanges: RESPONSES.map((response) => ({
                    request: {
                        input: { name: "Ada" },
                        instruction: "Return the greeting.",
                        outputSchema: { type: "string" },
                    },
                    response,
                })),
            },
        ],
        PROVIDER_DEFINITION,
    ),
    snapshotTarget("readApplicationProtocol", readApplicationProtocol, applicationSeeds),
];
