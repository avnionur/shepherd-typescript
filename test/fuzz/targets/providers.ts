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

/** Reader that snapshots its input: accepted output re-reads to itself and encodes canonically. */
function snapshotTarget(
    name: string,
    reader: (value: unknown) => unknown,
    seeds: () => readonly unknown[],
): FuzzTarget {
    return {
        name,
        prepare: async () => ({
            execute: (input) => reader((input as { value: unknown }).value),
            seeds: seeds().map((value) => ({ kind: "value", value }) as FuzzInput),
            verifyAccepted: (result) => {
                const encoded = canonicalizeRecord(result as SemanticRecord);
                assertCanonicalStable(encoded);
                // Canonical comparison instead of deepEqual, which recurses on the harness stack.
                assert.equal(
                    canonicalizeRecord(reader(JSON.parse(encoded)) as SemanticRecord),
                    encoded,
                );
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
    snapshotTarget("readStaticProviderDefinition", readStaticProviderDefinition, () => [
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
    ]),
    snapshotTarget("readApplicationProtocol", readApplicationProtocol, applicationSeeds),
];
