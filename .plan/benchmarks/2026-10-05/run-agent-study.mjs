import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { canonicalizeSemanticValue } from "../../../src/canonical/canonical-record.ts";
import {
    compileJSONSchema,
    createLiveProvider,
    inspectReplaySession,
    runReplaySession,
    SQLiteTraceStore,
} from "../../../src/index.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const configuration = JSON.parse(readFileSync(path.join(root, "agent-study.config.json"), "utf8"));
assert.equal(process.version, configuration.node);
const outputRoot = path.join(
    root,
    process.argv[2] === "--smoke"
        ? "raw/agent-study-smoke"
        : (process.argv[2] ?? "raw/agent-study"),
);
mkdirSync(outputRoot, { recursive: true });
const databasePath = path.join(outputRoot, "trace.sqlite");
if (configuration.harnesses.includes(configuration.durableHarness)) {
    assert.throws(() => statSync(databasePath), { code: "ENOENT" }, "Use a fresh output directory");
}
const inventory = await fetch(configuration.inventoryEndpoint).then((response) => response.json());
const model = inventory.models.find((entry) => entry.name === configuration.model);
assert.ok(model, "Configured model must already be installed");
assert.equal(model.remote_host, undefined, "This study admits only a local model");
const version = await fetch(configuration.versionEndpoint).then((response) => response.json());
writeJson("model-provenance.json", { model, server: version, configuration });
const validator = compileJSONSchema(configuration.outputSchema);
const rows = [];
const stores = [];
let store = new SQLiteTraceStore(databasePath);
const selectedTasks =
    process.argv[2] === "--smoke" ? configuration.tasks.slice(0, 1) : configuration.tasks;
const selectedSeeds =
    process.argv[2] === "--smoke" ? configuration.seeds.slice(0, 1) : configuration.seeds;
let cellIndex = 0;
try {
    for (const task of selectedTasks) {
        for (const seed of selectedSeeds) {
            for (const profile of configuration.profiles) {
                // Alternate which harness goes first across paired cells to reduce order bias.
                const order =
                    cellIndex++ % 2 === 0
                        ? configuration.harnesses
                        : [...configuration.harnesses].reverse();
                const documents =
                    profile.selection === "all"
                        ? [
                              ...configuration.distractors.slice(
                                  0,
                                  Math.floor(configuration.distractors.length / 2),
                              ),
                              ...task.relevant,
                              ...configuration.distractors.slice(
                                  Math.floor(configuration.distractors.length / 2),
                              ),
                          ]
                        : profile.selection === "relevant"
                          ? task.relevant
                          : configuration.distractors;
                const request = {
                    instruction: configuration.instruction,
                    outputSchema: configuration.outputSchema,
                    input: { documents, question: task.question },
                };
                for (const harness of order) {
                    const id = `${task.id}-${seed}-${profile.id}-${harness}`;
                    const exchanges = [];
                    const provider = createLiveProvider({
                        credential: configuration.credential,
                        endpoint: configuration.endpoint,
                        id,
                        kind: configuration.providerKind,
                        maxOutputTokens: configuration.maxOutputTokens,
                        model: configuration.model,
                        transport: async (http, signal) => {
                            const body = {
                                ...JSON.parse(http.body),
                                ...configuration.wireOverrides,
                                seed,
                            };
                            for (const field of configuration.wireRemoveFields) delete body[field];
                            const wire = JSON.stringify(body);
                            const started = performance.now();
                            const response = await fetch(http.url, {
                                body: wire,
                                headers: http.headers,
                                method: "POST",
                                signal,
                            });
                            const text = await response.text();
                            exchanges.push({
                                body,
                                response_body: text,
                                status: response.status,
                                elapsed_ms: performance.now() - started,
                                body_sha256: createHash("sha256").update(wire).digest("hex"),
                            });
                            return { body: text, status: response.status };
                        },
                    });
                    const signal = AbortSignal.timeout(configuration.requestTimeoutMs);
                    const options = {
                        claimId: configuration.claimId,
                        commandId: id,
                        programId: configuration.programId,
                        provider,
                        signal,
                        program: async (context) =>
                            (await context.invokeProvider(request)).response.output,
                    };
                    const started = performance.now();
                    let output = null;
                    let usage = null;
                    let terminal = null;
                    let error = null;
                    let sessionId = null;
                    try {
                        if (harness === configuration.directHarness) {
                            const response = await provider.invoke(request, signal);
                            output = response.output;
                            usage = response.usage;
                            terminal = "finished";
                        } else {
                            const receipt = await runReplaySession(store, options);
                            output = receipt.inspection.terminal?.result?.value ?? null;
                            usage = receipt.inspection.steps[0]?.provider?.response?.usage ?? null;
                            terminal = receipt.inspection.terminal?.status;
                            sessionId = receipt.inspection.session_id;
                            error = receipt.inspection.terminal?.failure;
                        }
                    } catch (failure) {
                        error = String(failure);
                    }
                    const elapsedMs = performance.now() - started;
                    const issues = validator.validate(output);
                    const expectedAnswer =
                        profile.selection === "irrelevant" ? null : task.expectedAnswer;
                    const expectedEvidence =
                        profile.selection === "irrelevant" ? [] : task.expectedEvidence;
                    const schemaValid = issues.length === 0;
                    const answerCorrect = schemaValid && output.answer === expectedAnswer;
                    const evidenceCorrect =
                        schemaValid &&
                        JSON.stringify([...output.evidence].sort()) ===
                            JSON.stringify([...expectedEvidence].sort());
                    let repeat = null;
                    let reopen = null;
                    if (harness === configuration.durableHarness && sessionId !== null) {
                        const count = exchanges.length;
                        const receipt = await runReplaySession(store, options);
                        repeat =
                            exchanges.length === count &&
                            canonicalizeSemanticValue(
                                receipt.inspection.terminal?.result?.value ?? null,
                            ) === canonicalizeSemanticValue(output);
                        store.close();
                        store = new SQLiteTraceStore(databasePath);
                        const restored = inspectReplaySession(store, { sessionId });
                        reopen =
                            canonicalizeSemanticValue(restored.terminal?.result?.value ?? null) ===
                            canonicalizeSemanticValue(output);
                        stores.push({ sessionId, output });
                    }
                    rows.push({
                        id,
                        task: task.id,
                        seed,
                        profile: profile.id,
                        harness,
                        terminal,
                        output,
                        usage,
                        error,
                        schema_valid: schemaValid,
                        answer_correct: answerCorrect,
                        evidence_correct: evidenceCorrect,
                        success: terminal === "finished" && answerCorrect && evidenceCorrect,
                        elapsed_ms: elapsedMs,
                        transport_ms: exchanges.reduce(
                            (sum, exchange) => sum + exchange.elapsed_ms,
                            0,
                        ),
                        request_bytes: Buffer.byteLength(JSON.stringify(request)),
                        repeat_without_provider_call: repeat,
                        reopened_result_equal: reopen,
                        exchanges,
                    });
                    writeJson("results.json", rows);
                    process.stdout.write(`${id}: ${rows.at(-1).success ? "pass" : "FAIL"}\n`);
                }
            }
        }
    }
    const archive = store.exportTrace();
    writeJson("trace-archive.json", archive);
    const imported = new SQLiteTraceStore();
    try {
        imported.importTrace(archive);
        writeJson("reliability.json", {
            integrity: store.verifyIntegrity(),
            imported_integrity: imported.verifyIntegrity(),
            imported_results: stores.map(({ sessionId, output }) => ({
                session_id: sessionId,
                equal:
                    canonicalizeSemanticValue(
                        inspectReplaySession(imported, { sessionId }).terminal?.result?.value ??
                            null,
                    ) === canonicalizeSemanticValue(output),
            })),
        });
    } finally {
        imported.close();
    }
} finally {
    store.close();
}
// The paired harnesses must transmit exactly the same request for each task, seed, and profile.
for (let index = 0; index < rows.length; index += configuration.harnesses.length) {
    const pair = rows.slice(index, index + configuration.harnesses.length);
    assert.equal(new Set(pair.map((row) => row.exchanges[0]?.body_sha256)).size, 1);
}
writeJson("completed.json", {
    completed_at: new Date().toISOString(),
    rows: rows.length,
    paired_requests_identical: true,
});

/** Writes the raw experiment artifact after each completed call. */
function writeJson(file, value) {
    writeFileSync(path.join(outputRoot, file), `${JSON.stringify(value, null, 4)}\n`);
}
