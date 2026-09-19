import assert from "node:assert/strict";
import { test } from "node:test";

import { corpusInput, fuzzSettings, type PreparedTarget, readCorpus, runCase } from "./harness.ts";
import { FUZZ_TARGETS } from "./targets/index.ts";

test("every configured fuzz target has an implementation and every implementation is configured", () => {
    assert.deepEqual(
        FUZZ_TARGETS.map(({ name }) => name).sort(),
        Object.keys(fuzzSettings.targets).sort(),
    );
});

test("the minimized fuzz regression corpus replays with its recorded outcomes", {
    timeout: fuzzSettings.testTimeoutMilliseconds,
}, async (context) => {
    const corpus = readCorpus();
    assert.ok(corpus.length > 0);
    const prepared = new Map<string, PreparedTarget | null>();
    try {
        for (const { entry, file, target } of corpus) {
            const implementation = FUZZ_TARGETS.find(({ name }) => name === target);
            assert.ok(implementation, `${file}: unknown fuzz target ${target}`);
            if (!prepared.has(target)) {
                const result = await implementation.prepare();
                prepared.set(target, "skip" in result ? null : result);
            }
            const ready = prepared.get(target);
            if (ready === null || ready === undefined) {
                context.diagnostic(`${file}: target skipped on this host`);
                continue;
            }
            const outcome = await runCase(target, ready, corpusInput(entry, ready));
            const expected =
                entry.expect.outcome === "accepted"
                    ? { status: "accepted" }
                    : { error: entry.expect.error, status: "rejected" };
            assert.deepEqual(outcome, expected, `${file}: ${entry.description}`);
        }
    } finally {
        for (const ready of prepared.values()) await ready?.dispose?.();
    }
});
