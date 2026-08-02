import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import type { RecordBody } from "./types.ts";

/** Creates a canonical, deeply frozen body snapshot for a planned record. */
export function createRecordBodySnapshot(body: RecordBody): RecordBody {
    return createCanonicalSnapshot(body) as RecordBody;
}
