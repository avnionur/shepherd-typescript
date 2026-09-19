import type { DatabaseSync } from "node:sqlite";

import type { RecordBody } from "../record/types.ts";
import type { SecretScanningMode } from "../retention/policy.ts";
import {
    collectSecretFindings,
    createSecretCollector,
    finishSecretScan,
} from "../retention/secret-scan.ts";
import { TraceSecretDetectedError } from "./errors.ts";

/** Record body with the JSON Pointer that locates it inside the refused request. */
export type ScannedBody = {
    readonly body: RecordBody;
    readonly pointer: string;
};

const secretScanningModes = new WeakMap<DatabaseSync, SecretScanningMode>();

/** Binds the append scanning mode chosen when a store handle was opened. @internal */
export function configureSecretScanning(database: DatabaseSync, mode: SecretScanningMode): void {
    secretScanningModes.set(database, mode);
}

/**
 * Refuses secret-bearing record bodies before any write when the store scans in `refuse` mode.
 *
 * A database never bound by a store handle, such as an import staging database, is not scanned.
 *
 * @internal
 */
export function refuseSecretBearingBodies(
    database: DatabaseSync,
    bodies: () => readonly ScannedBody[],
): void {
    if (secretScanningModes.get(database) !== "refuse") {
        return;
    }
    const collector = createSecretCollector();
    for (const { body, pointer } of bodies()) {
        collectSecretFindings(body, pointer, collector);
    }
    const report = finishSecretScan(collector);
    if (report.findings.length > 0) {
        throw new TraceSecretDetectedError(report);
    }
}
