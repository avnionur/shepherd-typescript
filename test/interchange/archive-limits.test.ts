import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { runCli } from "../../src/cli/cli.ts";
import {
    exportRedactedTraceArchive,
    RedactedTraceArchiveError,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceArchiveLimitError,
    verifyRedactedTraceArchive,
} from "../../src/index.ts";
import { decodeTraceArchive } from "../../src/interchange/decode.ts";
import { assertTraceArchiveCount, assertTraceArchiveText } from "../../src/interchange/limits.ts";
import { cliProtocolConfig, kernelProtocolConfig } from "../../src/protocol/config.ts";
import type { TraceArchiveLimitsConfig } from "../../src/protocol/config-types.ts";

const configured = kernelProtocolConfig.interchange.limits;

function limits(overrides: Partial<TraceArchiveLimitsConfig>): TraceArchiveLimitsConfig {
    return { ...configured, ...overrides };
}

function seedArchive(): { readonly archive: string; readonly redacted: string } {
    using store = new SQLiteTraceStore();
    const recordId = store.append({
        append_intent_id: "intent:limits",
        batch: {
            groups: [
                {
                    owner_id: "run:limits",
                    records: [
                        {
                            body: { value: "limits" },
                            mode: "capture",
                            schema_ref: "example.limits.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    }).record_ids[0] as string;
    store.publishCut({
        cut_id: "cut:limits",
        target_owner_id: "run:limits",
        through_record_id: recordId,
    });
    store.putBlob(new TextEncoder().encode("first blob"));
    store.putBlob(new TextEncoder().encode("second blob"));
    return { archive: store.exportTrace(), redacted: exportRedactedTraceArchive(store) };
}

function refusedLimit(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        assert.ok(error instanceof TraceArchiveLimitError, String(error));
        assert.equal(error.code, "TRACE_ARCHIVE_LIMIT_EXCEEDED");
        assert.ok(error instanceof TypeError);
        return error.limit;
    }
    assert.fail("expected a TraceArchiveLimitError");
}

test("configured interchange limits refuse oversized archive text before parsing", () => {
    const { archive } = seedArchive();
    assert.equal(decodeTraceArchive(archive).records.length, 3);
    // UTF-16 length over the bound and UTF-8 bytes over the bound with a short length.
    assert.equal(
        refusedLimit(() =>
            decodeTraceArchive(archive, limits({ maxArchiveBytes: archive.length - 1 })),
        ),
        "maxArchiveBytes",
    );
    assert.equal(
        refusedLimit(() => assertTraceArchiveText("éé", limits({ maxArchiveBytes: 3 }))),
        "maxArchiveBytes",
    );
    assert.equal(
        refusedLimit(() =>
            decodeTraceArchive(`${"[".repeat(5)}${"]".repeat(5)}`, limits({ maxNestingDepth: 4 })),
        ),
        "maxNestingDepth",
    );
    assert.throws(
        () => decodeTraceArchive("[[[[]]]]", limits({ maxNestingDepth: 4 })),
        (error) => !(error instanceof TraceArchiveLimitError) && error instanceof TypeError,
    );
    // Brackets inside strings, escaped quotes, and top-level scalars do not count.
    assertTraceArchiveText('"[[[[[\\"[[[["', limits({ maxNestingDepth: 1 }));
    assertTraceArchiveText('1,2,["[", "{"]', limits({ maxNestingDepth: 1 }));
    assertTraceArchiveText('{"a":"b","c":["d",{"a":1}]}', configured);
    // A repeated key, including an escaped spelling of the same key, is refused.
    assert.throws(
        () => assertTraceArchiveText('{"a":1,"a":2}', configured),
        /repeats an object key/,
    );
    assert.throws(() => assertTraceArchiveText('{"a":1,"\\u0061":2}', configured), /repeats/);
    assert.throws(() => assertTraceArchiveText('[{"a":{"b":1,"b":1}}]', configured), /repeats/);
    // A malformed escape is left for JSON.parse, which refuses the text.
    assertTraceArchiveText('{"\\x":1}', configured);
    assert.throws(() => decodeTraceArchive('{"\\x":1}'), TypeError);
    // An unterminated string ends the scan.
    assertTraceArchiveText('{"a', configured);
});

test("configured interchange limits refuse collection counts and blob bytes before decoding", () => {
    const { archive } = seedArchive();
    for (const limit of [
        "maxAppendIntents",
        "maxBlobs",
        "maxCuts",
        "maxRecords",
        "maxRecordViews",
    ] as const) {
        assert.equal(
            refusedLimit(() => decodeTraceArchive(archive, limits({ [limit]: 0 }))),
            limit,
        );
    }
    assert.equal(
        refusedLimit(() => decodeTraceArchive(archive, limits({ maxBlobBytes: 15 }))),
        "maxBlobBytes",
    );
    assert.equal(decodeTraceArchive(archive, limits({ maxBlobBytes: 21 })).blobs.length, 2);
    // The store's own export is decoded without limits.
    assert.equal(decodeTraceArchive(archive, null).blobs.length, 2);
    assertTraceArchiveCount({}, "maxRecords", limits({ maxRecords: 1 }));

    // Base64 text longer than the declared length is refused before it is decoded.
    const parsed = JSON.parse(archive) as { blobs: { content_base64: string }[] };
    const blob = parsed.blobs[0] as { content_base64: string };
    blob.content_base64 = `${blob.content_base64}AAAA`;
    assert.throws(() => decodeTraceArchive(JSON.stringify(parsed)), /declared length/);
    // The right length but not canonical base64, and canonical base64 of a different length.
    const typed = blob as { byte_length: number; content_base64: string };
    typed.byte_length = 3;
    typed.content_base64 = "@@@@";
    assert.throws(() => decodeTraceArchive(JSON.stringify(parsed)), /declared length/);
    typed.byte_length = 4;
    typed.content_base64 = Buffer.alloc(5).toString("base64");
    assert.throws(() => decodeTraceArchive(JSON.stringify(parsed)), /declared length/);
});

test("a well-formed archive with substituted blob bytes is refused without partial state", () => {
    const { archive } = seedArchive();
    const parsed = JSON.parse(archive) as {
        blobs: { byte_length: number; content_base64: string }[];
    };
    const blob = parsed.blobs[0] as { byte_length: number; content_base64: string };
    // Same length, valid base64, different bytes: only the content digest can tell.
    const bytes = Buffer.from(blob.content_base64, "base64");
    bytes[0] = (bytes[0] as number) ^ 1;
    blob.content_base64 = bytes.toString("base64");
    const substituted = JSON.stringify(parsed);
    assert.equal(decodeTraceArchive(substituted).blobs.length, 2);
    using target = new SQLiteTraceStore();
    const pristine = target.exportTrace();
    assert.throws(() => target.importTrace(substituted), TypeError);
    assert.equal(target.exportTrace(), pristine);
});

test("archived receipts must be canonical JSON", () => {
    const { archive } = seedArchive();
    const parsed = JSON.parse(archive) as { append_intents: { receipt_json: string }[] };
    const intent = parsed.append_intents[0] as { receipt_json: string };
    const receipt = intent.receipt_json;
    intent.receipt_json = receipt.replace(":", ": ");
    assert.throws(
        () => decodeTraceArchive(JSON.stringify(parsed)),
        /receipt_json must be canonical/,
    );
    intent.receipt_json = `${receipt}}`;
    assert.throws(
        () => decodeTraceArchive(JSON.stringify(parsed)),
        /receipt_json must be canonical/,
    );
    intent.receipt_json = receipt;
    assert.equal(decodeTraceArchive(JSON.stringify(parsed)).appendIntents.length, 2);
});

test("the redacted verifier applies the same text and count limits", () => {
    const { redacted } = seedArchive();
    assert.equal(verifyRedactedTraceArchive(redacted).blob_count, 2);
    assert.throws(
        () =>
            verifyRedactedTraceArchive(redacted.replace('"records":[', '"records":[],"records":[')),
        RedactedTraceArchiveError,
    );
    assert.throws(
        () => verifyRedactedTraceArchive(`${"[".repeat(configured.maxNestingDepth + 1)}`),
        TraceArchiveLimitError,
    );
    const parsed = JSON.parse(redacted) as Record<string, unknown>;
    const oversized = { ...parsed, cuts: new Array(configured.maxCuts + 1).fill(0) };
    assert.equal(
        refusedLimit(() => verifyRedactedTraceArchive(JSON.stringify(oversized))),
        "maxCuts",
    );
});

test("store import through the CLI refuses an oversized archive file before reading it", async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "shepherd-archive-limit-cli-"));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const archivePath = path.join(directory, "huge.json");
    await writeFile(archivePath, "");
    // A sparse file: the size check must refuse it without reading its (virtual) bytes.
    await truncate(archivePath, configured.maxArchiveBytes + 1);
    const validate = new Ajv2020({ strict: true }).compile(
        JSON.parse(
            readFileSync(
                new URL("../../spec/schemas/cli-output-v1.schema.json", import.meta.url),
                "utf8",
            ),
        ) as AnySchemaObject,
    );
    const errors: string[] = [];
    const exitCode = await runCli(
        ["store", "import", "--input", "huge.json", "--store", "target.sqlite", "--json"],
        { cwd: directory, stderr: (text) => errors.push(text), stdout: () => undefined },
    );
    assert.equal(exitCode, cliProtocolConfig.exitCodes.failure);
    const envelope = JSON.parse(errors.join("")) as { error: { code: string } };
    assert.equal(validate(envelope), true);
    assert.equal(envelope.error.code, cliProtocolConfig.machineOutput.errorCodes.failure);
    const human: string[] = [];
    await runCli(["store", "import", "--input", "huge.json", "--store", "target.sqlite"], {
        cwd: directory,
        stderr: (text) => human.push(text),
        stdout: () => undefined,
    });
    assert.match(human.join(""), /maxArchiveBytes/);
});
