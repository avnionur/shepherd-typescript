import { readFileSync } from "node:fs";
import path from "node:path";

import {
    exportRedactedTraceArchive,
    ROOT_WITNESS_ID,
    SQLiteTraceStore,
} from "../../../src/index.ts";
import { repositoryRoot } from "../harness.ts";

/** Archive, redacted archive, record, and receipt seeds shared by record and archive targets. */
export type ArchiveSeeds = {
    readonly archives: readonly string[];
    readonly records: readonly { readonly body: unknown; readonly envelope: unknown }[];
    readonly receipts: readonly { readonly id: string; readonly json: string }[];
    readonly redactedArchives: readonly string[];
};

let cached: ArchiveSeeds | undefined;

/** Builds (once per process) well-formed archives from the committed fixture and a fresh store. */
export function archiveSeeds(): ArchiveSeeds {
    if (cached !== undefined) return cached;
    const fixture = readFileSync(
        path.join(repositoryRoot, "test/fixtures/trace-archive-v1.json"),
        "utf8",
    );
    using store = new SQLiteTraceStore();
    const first = store.append({
        append_intent_id: "intent:fuzz-seed",
        batch: {
            groups: [
                {
                    owner_id: "run:fuzz-seed",
                    records: [
                        {
                            body: {
                                nested: { list: [1, "two", null, true, { three: 3.5 }] },
                                text: "seed é\u{1f600}",
                            },
                            mode: "capture",
                            schema_ref: "example.fuzz.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    const recordId = first.record_ids[0] as string;
    store.append({
        append_intent_id: "intent:fuzz-seed-child",
        batch: {
            groups: [
                {
                    owner_id: "run:fuzz-seed",
                    records: [
                        {
                            body: { step: 2 },
                            caused_by_record_ids: [recordId],
                            mode: "declaration",
                            schema_ref: "example.fuzz.v1",
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    });
    store.publishCut({
        cut_id: "cut:fuzz-seed",
        target_owner_id: "run:fuzz-seed",
        through_record_id: recordId,
    });
    store.putBlob(new TextEncoder().encode("fuzz seed blob"));
    const exported = store.exportTrace();
    const archives = [fixture, exported];
    const parsed = archives.map(
        (text) =>
            JSON.parse(text) as {
                readonly append_intents: readonly {
                    readonly append_intent_id: string;
                    readonly receipt_json: string;
                }[];
                readonly records: readonly { readonly body: unknown; readonly envelope: unknown }[];
            },
    );
    cached = {
        archives,
        receipts: parsed.flatMap((archive) =>
            archive.append_intents.map(({ append_intent_id, receipt_json }) => ({
                id: append_intent_id,
                json: receipt_json,
            })),
        ),
        records: parsed.flatMap((archive) => archive.records),
        redactedArchives: [exportRedactedTraceArchive(store)],
    };
    return cached;
}
