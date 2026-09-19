import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SQLiteTraceStore } from "../../src/index.ts";
import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import { createPrng, deriveSeed } from "../support/prng.ts";
import { addCounts, emptyCounts, recoverAfterKill } from "./recovery.ts";
import {
    appendRequestFor,
    blobContentFor,
    type FaultProcessArguments,
    faultSeeds,
    faultSettings,
    inRange,
    runFaultProcess,
} from "./workload.ts";

const settings = faultSettings.processKill;
const IMPORT_STAGE = kernelProtocolConfig.interchange.staging.directoryPrefix;

/** Seeds a store with records, a blob, and a cut, and writes its archive for import cycles. */
function prepareStore(directory: string, seed: number): FaultProcessArguments {
    const databasePath = path.join(directory, "trace.sqlite");
    const archivePath = path.join(directory, "archive.json");
    const backupRoot = path.join(directory, "backups");
    const importRoot = path.join(directory, "imports");
    mkdirSync(backupRoot);
    mkdirSync(importRoot);
    const store = new SQLiteTraceStore(databasePath);
    try {
        for (let index = 0; index < 8; index += 1) {
            store.append(appendRequestFor(seed, "prepare", index));
        }
        store.putBlob(blobContentFor(seed, "prepare", 0));
        writeFileSync(archivePath, store.exportTrace());
    } finally {
        store.close();
    }
    return {
        archivePath,
        backupRoot,
        databasePath,
        importRoot,
        label: "prepare",
        operation: "append",
        seed,
    };
}

for (const operation of settings.operations) {
    test(`SIGKILL during ${operation} leaves every intent complete, retryable, or refused`, {
        timeout: faultSettings.testTimeoutMilliseconds,
    }, async (context) => {
        const directory = await mkdtemp(path.join(tmpdir(), `shepherd-kill-${operation}-`));
        context.after(() => rm(directory, { force: true, recursive: true }));
        const totals = emptyCounts();
        let killedDuringOperation = 0;
        for (const seed of faultSeeds()) {
            const seedDirectory = path.join(directory, String(seed));
            mkdirSync(seedDirectory);
            const base = prepareStore(seedDirectory, seed);
            const childTemporary = path.join(seedDirectory, "tmp");
            mkdirSync(childTemporary);
            const random = createPrng(deriveSeed(seed, `kill:${operation}`, 0));
            for (let cycle = 0; cycle < settings.cyclesPerOperation; cycle += 1) {
                const args: FaultProcessArguments = {
                    ...base,
                    label: `${operation}-${cycle}`,
                    operation,
                };
                const result = await runFaultProcess(args, {
                    killAfterReady: inRange(random.next, settings.killDelayMilliseconds),
                    temporaryDirectory: childTemporary,
                });
                assert.equal(result.signal, "SIGKILL", result.stderr);
                const started = result.events.filter((event) => event.event === "start").length;
                const done = result.events.filter((event) => event.event === "done").length;
                if (started > done) killedDuringOperation += 1;
                addCounts(totals, await recoverAfterKill(args, result.events));
            }
            // F-019: nothing may leak into the OS temporary directory; a kill during import leaves
            // its owner-only staging directory beside the target store instead.
            const leftovers = readdirSync(childTemporary);
            assert.deepEqual(
                leftovers,
                [],
                `unexpected temporary residue: ${leftovers.join(", ")}`,
            );
            const staged = readdirSync(base.importRoot as string).filter((name) =>
                name.startsWith(IMPORT_STAGE),
            );
            assert.ok(operation === "import" || staged.length === 0, staged.join(", "));
            context.diagnostic(
                `seed ${seed}: ${staged.length} import staging director(ies) left beside the targets`,
            );
        }
        context.diagnostic(
            `${operation}: ${JSON.stringify(totals)}, ${killedDuringOperation} kill(s) landed inside an operation`,
        );
        assert.ok(totals.complete + totals.retryable + totals.refused > 0);
    });
}
