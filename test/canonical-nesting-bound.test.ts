import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalizeKernelFrame } from "../src/canonical/canonical-record.ts";
import {
    KERNEL_FRAME_BODY_PATHS,
    type KernelFrameBodyPath,
    REQUIRED_KERNEL_FRAMING_DEPTH,
} from "../src/canonical/framing.ts";
import { createCanonicalSnapshot } from "../src/canonical/snapshot.ts";
import {
    CanonicalNestingLimitError,
    createEffectIntent,
    createRecordEnvelope,
    createRunOutcome,
    exportRedactedTraceArchive,
    ROOT_WITNESS_ID,
    type SemanticRecord,
    SQLiteTraceStore,
    type TaskArtifactLock,
    validateRecordBody,
    verifyRedactedTraceArchive,
} from "../src/index.ts";
import { decodeTraceArchive } from "../src/interchange/decode.ts";
import { kernelProtocolConfig, recordIdConfig } from "../src/protocol/config.ts";
import { readModelResponse } from "../src/provider/validation.ts";
import { readRunArtifactPayloadDefinition } from "../src/run/artifact-validation.ts";
import { readScopeData } from "../src/scope/records.ts";
import { createBatchDigest } from "../src/store/codec.ts";
import { assertTaskSemanticRecord } from "../src/task/validation.ts";

const { maxNestingDepth } = kernelProtocolConfig.canonicalization;

/** A record body nested exactly `levels` containers deep, counting the body itself. */
function body(levels: number): SemanticRecord {
    let value: unknown = "leaf";
    for (let level = 1; level < levels; level += 1) value = { a: value };
    return { a: value } as SemanticRecord;
}

/** Text of `body(levels)` as canonical JSON, built without the encoder. */
function bodyText(levels: number): string {
    return `${'{"a":'.repeat(levels)}"leaf"${"}".repeat(levels)}`;
}

function appendRequest(recordBody: SemanticRecord, intent: string) {
    return {
        append_intent_id: intent,
        batch: {
            groups: [
                {
                    owner_id: "run:nesting",
                    records: [
                        {
                            body: recordBody,
                            mode: "capture" as const,
                            schema_ref: "example.nesting.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}

function isNestingRefusal(error: unknown): boolean {
    return error instanceof CanonicalNestingLimitError && error.bound === maxNestingDepth;
}

test("a body at the configured bound appends, exports, imports, and redacts", () => {
    assert.equal(bodyText(2), '{"a":{"a":"leaf"}}');
    using source = new SQLiteTraceStore();
    const receipt = source.append(appendRequest(body(maxNestingDepth), "intent:at-bound"));
    assert.equal(receipt.record_ids.length, 1);
    const archive = source.exportTrace();
    assert.ok(archive.includes(bodyText(maxNestingDepth)));
    assert.equal(decodeTraceArchive(archive).records.length, 2);

    using target = new SQLiteTraceStore();
    target.importTrace(archive);
    assert.equal(target.exportTrace(), archive);
    assert.equal(target.verifyIntegrity().ok, true);

    const redacted = exportRedactedTraceArchive(source);
    assert.equal(verifyRedactedTraceArchive(redacted).record_count, 2);
});

/** Runs `action` below `frames` extra stack frames of an ordinary recursive caller. */
function atStackDepth<T>(frames: number, action: () => T): T {
    return frames === 0 ? action() : atStackDepth(frames - 1, action);
}

test("append, scan, and read of a body at the bound do not depend on the caller's stack", () => {
    // Record snapshots and secret scanning walk the body too; they must be as stack-independent
    // as the encoder.
    using store = new SQLiteTraceStore(":memory:", {
        secretScanning: "refuse",
    });
    const receipt = atStackDepth(6_000, () =>
        store.append(appendRequest(body(maxNestingDepth), "intent:deep-caller")),
    );
    const recordId = receipt.record_ids[0] as string;
    const read = atStackDepth(6_000, () => store.readRecord(recordId));
    assert.equal(Object.isFrozen(read?.body), true);
    assert.throws(
        () =>
            atStackDepth(6_000, () =>
                store.append(appendRequest(body(maxNestingDepth + 1), "intent:deep-refused")),
            ),
        isNestingRefusal,
    );
});

test("append refuses a body one level past the bound before any write", () => {
    for (const secretScanning of ["off", "refuse"] as const) {
        using store = new SQLiteTraceStore(":memory:", { secretScanning });
        store.append(appendRequest(body(1), "intent:seed"));
        const before = store.exportTrace();
        assert.throws(
            () => store.append(appendRequest(body(maxNestingDepth + 1), "intent:too-deep")),
            isNestingRefusal,
        );
        assert.equal(store.exportTrace(), before);
        assert.throws(() => validateRecordBody(body(maxNestingDepth + 1)), isNestingRefusal);
    }
});

test("archive decode and import refuse a record body past the bound before any write", () => {
    using source = new SQLiteTraceStore();
    source.append(appendRequest(body(1), "intent:shallow"));
    const archive = source.exportTrace();
    const deep = archive.replace(bodyText(1), bodyText(maxNestingDepth + 1));
    assert.notEqual(deep, archive);
    // The archive text stays within kernel.interchange.limits.maxNestingDepth, so the refusal
    // comes from the canonical value bound, not from the pre-parse archive scan.
    assert.throws(() => decodeTraceArchive(deep), isNestingRefusal);

    using target = new SQLiteTraceStore();
    const pristine = target.exportTrace();
    assert.throws(() => target.importTrace(deep), isNestingRefusal);
    assert.equal(target.exportTrace(), pristine);
});

test("archive decode refuses an over-deep archived receipt with the classified error", () => {
    using source = new SQLiteTraceStore();
    source.append(appendRequest(body(1), "intent:receipt"));
    const parsed = JSON.parse(source.exportTrace()) as {
        append_intents: { receipt_json: string }[];
    };
    const intent = parsed.append_intents[0] as { receipt_json: string };
    intent.receipt_json = `{"deep":${bodyText(maxNestingDepth)}}`;
    assert.throws(() => decodeTraceArchive(JSON.stringify(parsed)), isNestingRefusal);
});

test("the redacted verifier refuses an over-deep included body with the classified error", () => {
    using source = new SQLiteTraceStore();
    source.append(appendRequest(body(1), "intent:redacted"));
    const redacted = exportRedactedTraceArchive(source);
    const included = '"disposition":"include"';
    assert.ok(redacted.includes(included));
    const deep = redacted.replace(bodyText(1), bodyText(maxNestingDepth + 1));
    assert.notEqual(deep, redacted);
    assert.throws(() => verifyRedactedTraceArchive(deep), isNestingRefusal);
});

test("domain validators keep the classified refusal instead of rewrapping it", () => {
    const deepValue = body(maxNestingDepth + 1);
    assert.throws(
        () =>
            readModelResponse({
                output: deepValue,
                usage: { inputTokens: 1, outputTokens: 1 },
            }),
        isNestingRefusal,
    );
    assert.throws(
        () =>
            createEffectIntent({
                effectId: "effect:deep",
                kind: "tool.call",
                payload: deepValue,
                reversibility: "irreversible",
            }),
        isNestingRefusal,
    );
    assert.throws(() => readScopeData(deepValue, "data"), isNestingRefusal);
    assert.throws(() => assertTaskSemanticRecord(deepValue, "schema"), isNestingRefusal);
    assert.throws(
        () =>
            readRunArtifactPayloadDefinition({
                content: { text: "x", type: "text" },
                kind: "report",
                metadata: deepValue,
                name: "deep",
            }),
        isNestingRefusal,
    );
    const fixture = JSON.parse(
        readFileSync(new URL("./fixtures/run-outcome-v1.json", import.meta.url), "utf8"),
    ) as {
        readonly finished: { readonly task_artifact_lock: TaskArtifactLock };
    };
    assert.throws(
        () =>
            createRunOutcome({
                outcome: { status: "finished", value: deepValue },
                runId: "run:deep",
                taskArtifactLock: fixture.finished.task_artifact_lock,
            }),
        isNestingRefusal,
    );
});

/** Deepest array/object nesting of JSON text, counting the outermost container as level one. */
function textNestingDepth(text: string): number {
    let depth = 0;
    let deepest = 0;
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            if (character === "\\") index += 1;
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        } else if (character === "{" || character === "[") {
            depth += 1;
            deepest = Math.max(deepest, depth);
        } else if (character === "}" || character === "]") {
            depth -= 1;
        }
    }
    return depth === 0 ? deepest : Number.NaN;
}

function followPath(value: unknown, path: KernelFrameBodyPath): unknown {
    let current = value;
    for (const step of path) current = (current as Record<number | string, unknown>)[step];
    return current;
}

test("configured framing is at least the deepest kernel frame body location", () => {
    assert.equal(
        REQUIRED_KERNEL_FRAMING_DEPTH,
        Math.max(...Object.values(KERNEL_FRAME_BODY_PATHS).map((path) => path.length)),
    );
    assert.ok(kernelProtocolConfig.canonicalization.framingDepth >= REQUIRED_KERNEL_FRAMING_DEPTH);
});

test("a body at the bound fits every kernel frame under the minimum framing depth", () => {
    // Each frame's body path is followed through the real frame, and the frame text nests exactly
    // path-length levels past the body, so maxNestingDepth + REQUIRED_KERNEL_FRAMING_DEPTH admits
    // every frame and the deepest one needs all of it.
    const minimumFramedBound = maxNestingDepth + REQUIRED_KERNEL_FRAMING_DEPTH;
    const atBound = body(maxNestingDepth);
    const request = appendRequest(atBound, "intent:minimum-framing");

    const { appendBatchDigest, recordIdentity, redactedArchive, traceArchive } =
        KERNEL_FRAME_BODY_PATHS;
    assert.equal(followPath(request.batch, appendBatchDigest), atBound);
    const batchFrame = canonicalizeKernelFrame(request.batch);
    assert.equal(textNestingDepth(batchFrame), maxNestingDepth + appendBatchDigest.length);
    assert.equal(
        createBatchDigest(request.batch),
        createHash(kernelProtocolConfig.store.appendIntentDigestAlgorithm)
            .update(batchFrame, "utf8")
            .digest("hex"),
    );

    const [record] = request.batch.groups[0]?.records ?? [];
    assert.ok(record !== undefined);
    const identityFrame = canonicalizeKernelFrame({
        body: atBound,
        caused_by: [],
        kind: kernelProtocolConfig.recordKind,
        mode: record.mode,
        schema_ref: record.schema_ref,
        witness: record.witness_ref,
    });
    assert.equal(
        JSON.stringify(followPath(JSON.parse(identityFrame), recordIdentity)),
        bodyText(maxNestingDepth),
    );
    assert.equal(textNestingDepth(identityFrame), maxNestingDepth + recordIdentity.length);
    const envelope = createRecordEnvelope(record);
    assert.equal(
        envelope.record_id,
        `${recordIdConfig.prefix}${createHash(recordIdConfig.algorithm)
            .update(`${kernelProtocolConfig.canonicalVersion}\n`, "ascii")
            .update(identityFrame, "utf8")
            .digest("hex")}`,
    );

    using store = new SQLiteTraceStore();
    store.append(request);
    const archive = store.exportTrace();
    const redacted = exportRedactedTraceArchive(store);
    for (const [text, path] of [
        [archive, traceArchive],
        [redacted, redactedArchive],
    ] as const) {
        // Records are ordered by identity, so find the appended one by following the path at
        // every record index.
        const parsed = JSON.parse(text) as {
            readonly records: readonly unknown[];
        };
        const bodies = parsed.records.map((_, index) =>
            JSON.stringify(
                followPath(
                    parsed,
                    path.map((step) => (typeof step === "number" ? index : step)),
                ),
            ),
        );
        assert.ok(bodies.includes(bodyText(maxNestingDepth)));
        assert.equal(textNestingDepth(text), maxNestingDepth + path.length);
    }

    for (const text of [batchFrame, identityFrame, archive, redacted]) {
        assert.ok(textNestingDepth(text) <= minimumFramedBound);
    }
});

test("wide bodies append and snapshot without argument-count limits", () => {
    // A million-element array and a 200k-key object exceed the engine's call-argument limit, so
    // any spread of children into a call would throw RangeError.
    const wideArray = Array.from({ length: 1_000_000 }, (_, index) => index);
    const wideObject: Record<string, number> = {};
    for (let index = 0; index < 200_000; index += 1) wideObject[`k${index}`] = index;

    for (const wide of [{ w: wideArray }, { w: wideObject }] as SemanticRecord[]) {
        const snapshot = createCanonicalSnapshot(wide);
        assert.equal(Object.isFrozen(snapshot.w), true);
        assert.deepEqual(snapshot, wide);
    }

    using store = new SQLiteTraceStore();
    store.append(appendRequest({ w: wideArray }, "intent:wide-array"));
    const receipt = store.append(appendRequest({ w: wideObject }, "intent:wide-object"));
    const read = store.readRecord(receipt.record_ids[0] as string);
    assert.equal(Object.isFrozen(read?.body.w), true);
    assert.equal(Object.keys(read?.body.w as object).length, 200_000);
});
