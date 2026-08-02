import { DatabaseSync } from "node:sqlite";

import { createBatchDigest, encodeAppendReceipt } from "../../src/store/codec.ts";
import { STORE_TABLES } from "../../src/store/constants.ts";

const databasePath = process.argv[2];
if (databasePath === undefined) {
    throw new TypeError("database path is required");
}

const appendIntentId = "intent:concurrent";
const database = new DatabaseSync(databasePath);
database.exec("BEGIN IMMEDIATE");
database
    .prepare(
        `INSERT INTO ${STORE_TABLES.appendIntents}(
            append_intent_id, batch_digest, receipt_json
         ) VALUES (?, ?, ?)`,
    )
    .run(
        appendIntentId,
        createBatchDigest({ groups: [] }),
        encodeAppendReceipt({
            append_intent_id: appendIntentId,
            causal_edges: [],
            owner_ordinal_ranges: new Map(),
            record_ids: [],
        }),
    );
process.stdout.write("ready\n");
setTimeout(() => {
    database.exec("COMMIT");
    database.close();
}, 100);
