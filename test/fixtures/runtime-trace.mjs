import { ROOT_WITNESS_ID, SQLiteTraceStore } from "PACKAGE_ENTRY";
import assert from "node:assert/strict";
import path from "node:path";

const filename = path.join(process.argv[2], "trace.sqlite");
const store = new SQLiteTraceStore(filename);
const id = store.append({
    append_intent_id: "intent:runtime",
    batch: {
        groups: [
            {
                owner_id: "run:runtime",
                records: [
                    {
                        body: { value: "preserved" },
                        mode: "capture",
                        schema_ref: "example.runtime.v1",
                        witness_ref: ROOT_WITNESS_ID,
                    },
                ],
            },
        ],
    },
}).record_ids[0];
assert.equal(store.readRecord(id).body.value, "preserved");
const archive = store.exportTrace();
store.close();
using reopened = new SQLiteTraceStore(filename, { readOnly: true });
assert.equal(reopened.exportTrace(), archive);
using imported = new SQLiteTraceStore();
imported.importTrace(archive);
assert.equal(imported.exportTrace(), archive);
process.stdout.write("trace preserved\n");
