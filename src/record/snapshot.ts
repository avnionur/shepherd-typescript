import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import type { RecordBody } from "./types.ts";

/** Creates a canonical, deeply frozen body snapshot for a planned record. */
export function createRecordBodySnapshot(body: RecordBody): RecordBody {
    return deepFreeze(JSON.parse(canonicalizeRecord(body)) as RecordBody);
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}
