import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { inspect } from "node:util";

import {
    isPublicError,
    SQLiteTraceStore,
    TraceSecretDetectedError,
    TraceStoreError,
} from "../../src/index.ts";
import { CLEAN_TEXT, SECRET_SAMPLES, singleRecordRequest, temporaryDirectory } from "./fixtures.ts";

const SCHEMA = "retention.test.event.v1";
const secret = SECRET_SAMPLES["github-token"] as string;
const maxFindings = (
    JSON.parse(readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8")) as {
        readonly retention: { readonly limits: { readonly maxFindings: number } };
    }
).retention.limits.maxFindings;

function assertNoLeak(error: unknown, secrets: readonly string[]): void {
    const rendered = [
        String(error),
        (error as Error).message,
        (error as Error).stack ?? "",
        inspect(error, { depth: null }),
        JSON.stringify((error as TraceSecretDetectedError).findings),
    ];
    for (const value of secrets) {
        for (const text of rendered) {
            assert.equal(text.includes(value), false);
        }
    }
}

test("refuse mode rejects a secret-bearing append before any write and a corrected retry succeeds", () => {
    using store = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    assert.equal(store.secretScanning, "refuse");
    const before = store.exportTrace();
    let refusal: unknown;
    try {
        store.append(
            singleRecordRequest("intent:secret", "owner:secret", SCHEMA, { token: secret }),
        );
    } catch (error) {
        refusal = error;
    }
    assert.ok(refusal instanceof TraceSecretDetectedError);
    assert.ok(refusal instanceof TraceStoreError);
    assert.equal(isPublicError(refusal), true);
    assert.equal(refusal.code, "TRACE_SECRET_DETECTED");
    assert.equal(refusal.truncated, false);
    assert.deepEqual(
        refusal.findings.map(({ path: pointer, secret_class }) => [pointer, secret_class]),
        [["/batch/groups/0/records/0/body/token", "github-token"]],
    );
    assert.match(refusal.message, /1 configured secret finding\(s\) of class github-token/u);
    assertNoLeak(refusal, [secret]);
    assert.equal(store.exportTrace(), before);
    assert.equal(store.readOwner("owner:secret").length, 0);
    assert.equal(store.diagnoseAppend("intent:secret").status, "retry_safe");

    const receipt = store.append(
        singleRecordRequest("intent:secret", "owner:secret", SCHEMA, { token: CLEAN_TEXT }),
    );
    assert.equal(receipt.append_intent_id, "intent:secret");
    assert.equal(store.readOwner("owner:secret").length, 1);
    assert.equal(store.verifyIntegrity().ok, true);
});

test("refusal messages mark truncated findings and name every class without matched text", () => {
    using store = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    const values = Array.from({ length: maxFindings + 1 }, (_, index) => `${secret}${index}`);
    assert.throws(
        () =>
            store.append(
                singleRecordRequest("intent:many", "owner:many", SCHEMA, {
                    values,
                    pem: SECRET_SAMPLES["pem-private-key"] as string,
                }),
            ),
        (error: unknown) => {
            assert.ok(error instanceof TraceSecretDetectedError);
            assert.equal(error.truncated, true);
            assert.equal(error.findings.length, maxFindings);
            assert.match(error.message, new RegExp(`refused ${maxFindings}\\+ `, "u"));
            assertNoLeak(error, [...values, SECRET_SAMPLES["pem-private-key"] as string]);
            return true;
        },
    );
});

test("refuse mode also guards appends made inside store-owned transactions", () => {
    using store = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    const receipt = store.append(
        singleRecordRequest("intent:target", "owner:target", SCHEMA, { text: CLEAN_TEXT }),
    );
    const before = store.exportTrace();
    assert.throws(
        () =>
            store.publishCut({
                cut_id: `cut:${secret}`,
                target_owner_id: "owner:target",
                through_record_id: receipt.record_ids[0] as string,
            }),
        TraceSecretDetectedError,
    );
    assert.equal(store.readOptionalCut(`cut:${secret}`), undefined);
    assert.equal(store.exportTrace(), before);
});

test("the default off mode leaves appends unchanged", () => {
    using store = new SQLiteTraceStore();
    assert.equal(store.secretScanning, "off");
    using explicit = new SQLiteTraceStore(":memory:", { secretScanning: "off" });
    for (const target of [store, explicit]) {
        target.append(singleRecordRequest("intent:off", "owner:off", SCHEMA, { token: secret }));
        assert.equal(target.readOwner("owner:off")[0]?.body.token, secret);
    }
});

test("refuse mode refuses replaying a previously accepted secret-bearing intent", async (context) => {
    const directory = await temporaryDirectory(context, "shepherd-retention-replay-");
    const databasePath = path.join(directory, "trace.sqlite");
    const request = singleRecordRequest("intent:replay", "owner:replay", SCHEMA, { token: secret });
    {
        using store = new SQLiteTraceStore(databasePath);
        store.append(request);
    }
    using refusing = new SQLiteTraceStore(databasePath, { secretScanning: "refuse" });
    assert.throws(() => refusing.append(request), TraceSecretDetectedError);
    assert.equal(refusing.readOwner("owner:replay").length, 1);
    using readOnly = new SQLiteTraceStore(databasePath, {
        readOnly: true,
        secretScanning: "refuse",
    });
    assert.equal(readOnly.secretScanning, "refuse");
});

test("refuse mode rejects importing a secret-bearing archive without writing", () => {
    using source = new SQLiteTraceStore();
    source.append(singleRecordRequest("intent:import", "owner:import", SCHEMA, { token: secret }));
    using target = new SQLiteTraceStore(":memory:", { secretScanning: "refuse" });
    const before = target.exportTrace();
    assert.throws(
        () => target.importTrace(source.exportTrace()),
        (error: unknown) => {
            assert.ok(error instanceof TraceSecretDetectedError);
            assert.match(error.findings[0]?.path ?? "", /^\/records\/\d+\/body\/token$/u);
            assertNoLeak(error, [secret]);
            return true;
        },
    );
    assert.equal(target.exportTrace(), before);
    using permissive = new SQLiteTraceStore();
    assert.equal(permissive.importTrace(source.exportTrace()).imported_record_count, 2);
});

test("store options reject unconfigured scanning modes", () => {
    for (const secretScanning of ["block", 1, null]) {
        assert.throws(
            () => new SQLiteTraceStore(":memory:", { secretScanning } as never),
            TypeError,
        );
    }
});
