import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    inspectTraceRetention,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
    TraceStoreError,
} from "../../src/index.ts";
import { CLEAN_TEXT, SECRET_SAMPLES, singleRecordRequest, temporaryDirectory } from "./fixtures.ts";

const config = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as {
    readonly retention: { readonly limits: { readonly maxReportedRecords: number } };
    readonly supervision: { readonly traceSchemas: { readonly context: string } };
};
const reportSchema = JSON.parse(
    readFileSync(
        new URL("../../spec/schemas/retention-report-v1.schema.json", import.meta.url),
        "utf8",
    ),
) as AnySchemaObject;
const secret = SECRET_SAMPLES["github-token"] as string;

test("retention inspection counts classes and secrets without content and only reads", async (context) => {
    const directory = await temporaryDirectory(context, "shepherd-retention-report-");
    const databasePath = path.join(directory, "trace.sqlite");
    {
        using store = new SQLiteTraceStore(databasePath);
        store.append(
            singleRecordRequest("intent:clean", "owner:a", "retention.event.v1", {
                text: CLEAN_TEXT,
            }),
        );
        store.append(
            singleRecordRequest("intent:leak", "owner:a", "retention.event.v1", {
                token: secret,
                also: SECRET_SAMPLES["slack-token"] as string,
            }),
        );
        store.append(
            singleRecordRequest(
                "intent:context",
                "owner:c",
                config.supervision.traceSchemas.context,
                {
                    token: `${secret}x`,
                },
            ),
        );
        store.append(
            singleRecordRequest("intent:memory", "owner:m", "retention.memory.v1", {
                text: CLEAN_TEXT,
            }),
        );
    }
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    const before = readOnly.exportTrace();
    const report = inspectTraceRetention(readOnly, {
        schemaDataClasses: { "retention.memory.v1": "memory-adapter" },
    });
    assert.equal(readOnly.exportTrace(), before);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(Object.isFrozen(report), true);
    assert.equal(report.record_count, 5);
    assert.equal(report.secret_record_count, 2);
    assert.equal(report.secret_records_truncated, false);
    assert.equal(report.secret_scanning, "off");
    const byClass = Object.fromEntries(
        report.data_classes.map((entry) => [entry.data_class, entry]),
    );
    assert.deepEqual([byClass.general?.record_count, byClass.general?.secret_record_count], [3, 1]);
    assert.deepEqual(
        [
            byClass.context?.record_count,
            byClass.context?.secret_record_count,
            byClass.context?.disposition,
        ],
        [1, 1, "redact"],
    );
    assert.equal(byClass["memory-adapter"]?.record_count, 1);
    const bySecret = Object.fromEntries(
        report.secret_classes.map((entry) => [entry.secret_class, entry]),
    );
    assert.deepEqual(
        [bySecret["github-token"]?.finding_count, bySecret["github-token"]?.record_count],
        [2, 2],
    );
    assert.equal(bySecret["slack-token"]?.record_count, 1);
    assert.deepEqual(
        report.secret_records.map(({ secret_classes }) => secret_classes.length).sort(),
        [1, 2],
    );
    const validator = new Ajv2020({ strict: true });
    const validate = validator.compile(reportSchema);
    assert.equal(validate(report), true, validator.errorsText(validate.errors));
    assert.equal(validate({ ...report, secret_scanning: "block" }), false);
});

test("retention inspection bounds reported secret records", () => {
    using store = new SQLiteTraceStore();
    const count = config.retention.limits.maxReportedRecords + 1;
    store.append({
        append_intent_id: "intent:bulk",
        batch: {
            groups: [
                {
                    owner_id: "owner:bulk",
                    records: Array.from({ length: count }, (_, index) => ({
                        body: { token: `${secret}${index}` },
                        mode: "capture" as const,
                        schema_ref: "retention.event.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    })),
                },
            ],
        },
    });
    const report = inspectTraceRetention(store);
    assert.equal(report.secret_record_count, count);
    assert.equal(report.secret_records.length, config.retention.limits.maxReportedRecords);
    assert.equal(report.secret_records_truncated, true);
    store.close();
    assert.throws(() => inspectTraceRetention(store), TraceStoreError);
});
