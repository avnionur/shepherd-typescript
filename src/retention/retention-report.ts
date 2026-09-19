import { retentionProtocolConfig } from "../protocol/config.ts";
import type { RecordId } from "../record/types.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import {
    createSchemaClassifier,
    type RetentionClassificationOptions,
    type RetentionDataClass,
    type RetentionExportDisposition,
    type SecretScanningMode,
} from "./policy.ts";
import { scanSemanticValueForSecrets } from "./secret-scan.ts";

/**
 * Record counts of one data class.
 *
 * @public
 */
export type RetentionDataClassCount = {
    /** Configured data class. */
    readonly data_class: RetentionDataClass;
    /** Export disposition configured for the class. */
    readonly disposition: RetentionExportDisposition;
    /** Records classified into the class. */
    readonly record_count: number;
    /** Records of the class whose body matches at least one detector. */
    readonly secret_record_count: number;
};

/**
 * Finding counts of one configured secret class.
 *
 * @public
 */
export type RetentionSecretClassCount = {
    /** Reported findings of the class across all records. */
    readonly finding_count: number;
    /** Records with at least one finding of the class. */
    readonly record_count: number;
    /** Configured secret-class name. */
    readonly secret_class: string;
};

/**
 * One record whose body matches a configured detector, identified without its content.
 *
 * @public
 */
export type RetentionSecretRecord = {
    /** Data class of the record. */
    readonly data_class: RetentionDataClass;
    /** Reported findings in the body. */
    readonly finding_count: number;
    /** Content-addressed record identity. */
    readonly record_id: RecordId;
    /** Sorted secret classes detected in the body. */
    readonly secret_classes: readonly string[];
    /** Whether the body had more findings than the configured limit. */
    readonly truncated: boolean;
};

/**
 * Read-only retention inventory of a trace store.
 *
 * @public
 */
export type TraceRetentionReport = {
    /** Every configured data class in configuration order. */
    readonly data_classes: readonly RetentionDataClassCount[];
    /** Configured report format. */
    readonly format: string;
    /** Configured report format version. */
    readonly format_version: number;
    /** Every retained record, including the root witness. */
    readonly record_count: number;
    /** Retention compatibility namespace. */
    readonly retention_compatibility_version: string;
    /** Every configured secret class in detector order. */
    readonly secret_classes: readonly RetentionSecretClassCount[];
    /** Records whose body matches at least one detector. */
    readonly secret_record_count: number;
    /** Secret-bearing records in record-identity order, bounded by the configured limit. */
    readonly secret_records: readonly RetentionSecretRecord[];
    /** Whether more secret-bearing records existed than the configured limit allows. */
    readonly secret_records_truncated: boolean;
    /** Append scanning mode of the inspected store handle. */
    readonly secret_scanning: SecretScanningMode;
};

/**
 * Inventories a trace store by data class, export disposition, and detected secret class.
 *
 * The inspection only reads: it classifies every retained record by schema, scans every body with
 * the configured detectors, and returns counts and record identities without any body content or
 * matched text. It works on writable and read-only handles.
 *
 * @param store - Open trace store.
 * @param options - Optional caller classification of unconfigured schema identifiers.
 * @returns A frozen report matching the configured retention-report schema.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the options are malformed or a stored record fails validation.
 *
 * @example
 * ```ts
 * const report = inspectTraceRetention(store);
 * if (report.secret_record_count > 0) {
 *     console.log(report.secret_records.map(({ record_id }) => record_id));
 * }
 * ```
 *
 * @public
 */
export function inspectTraceRetention(
    store: SQLiteTraceStore,
    options: RetentionClassificationOptions = {},
): TraceRetentionReport {
    const classify = createSchemaClassifier(options);
    const classCounts = new Map(
        retentionProtocolConfig.dataClasses.map((dataClass) => [
            dataClass,
            { records: 0, secrets: 0 },
        ]),
    );
    const secretCounts = new Map(
        retentionProtocolConfig.secretClasses.map(({ name }) => [
            name,
            { findings: 0, records: 0 },
        ]),
    );
    const secretRecords: RetentionSecretRecord[] = [];
    let secretRecordCount = 0;
    const recordCount = store.visitRetainedRecords(({ body, envelope }) => {
        const { data_class: dataClass } = classify(envelope.schema_ref);
        const counts = classCounts.get(dataClass) as { records: number; secrets: number };
        counts.records += 1;
        const scan = scanSemanticValueForSecrets(body);
        if (scan.findings.length === 0) {
            return;
        }
        counts.secrets += 1;
        secretRecordCount += 1;
        for (const finding of scan.findings) {
            (secretCounts.get(finding.secret_class) as { findings: number }).findings += 1;
        }
        for (const secretClass of scan.secret_classes) {
            (secretCounts.get(secretClass) as { records: number }).records += 1;
        }
        if (secretRecords.length < retentionProtocolConfig.limits.maxReportedRecords) {
            secretRecords.push(
                Object.freeze({
                    data_class: dataClass,
                    finding_count: scan.findings.length,
                    record_id: envelope.record_id,
                    secret_classes: scan.secret_classes,
                    truncated: scan.truncated,
                }),
            );
        }
    });
    return Object.freeze({
        data_classes: Object.freeze(
            [...classCounts].map(([dataClass, counts]) =>
                Object.freeze({
                    data_class: dataClass as RetentionDataClass,
                    disposition: retentionProtocolConfig.exportDispositions[
                        dataClass
                    ] as RetentionExportDisposition,
                    record_count: counts.records,
                    secret_record_count: counts.secrets,
                }),
            ),
        ),
        format: retentionProtocolConfig.report.format,
        format_version: retentionProtocolConfig.report.formatVersion,
        record_count: recordCount,
        retention_compatibility_version: retentionProtocolConfig.compatibilityVersion,
        secret_classes: Object.freeze(
            [...secretCounts].map(([secretClass, counts]) =>
                Object.freeze({
                    finding_count: counts.findings,
                    record_count: counts.records,
                    secret_class: secretClass,
                }),
            ),
        ),
        secret_record_count: secretRecordCount,
        secret_records: Object.freeze(secretRecords),
        secret_records_truncated: secretRecordCount > secretRecords.length,
        secret_scanning: store.secretScanning,
    });
}
