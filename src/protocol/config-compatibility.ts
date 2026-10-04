import {
    APPLICATIONS_PROTOCOL_V10_CONTRACT,
    BACKUP_PROTOCOL_V1_CONTRACT,
    CLI_PROTOCOL_V1_CONTRACT,
    DELEGATION_PROTOCOL_V1_CONTRACT,
    EFFECT_PROTOCOL_V2_CONTRACT,
    EVIDENCE_RECORD_PROJECTION_V1_CONTRACT,
    EXECUTION_HISTORY_PROJECTION_V1_CONTRACT,
    FORMAL_ASSURANCE_V2_CONTRACT,
    KERNEL_ABI_V0_CONTRACT,
    KERNEL_ABI_V0_STORE_V13_CONTRACT,
    OBSERVABILITY_PROTOCOL_V1_CONTRACT,
    ORPHAN_REPAIR_PROTOCOL_V1_CONTRACT,
    PROVIDER_PROTOCOL_V3_CONTRACT,
    REPLAY_PROTOCOL_V4_CONTRACT,
    RETENTION_PROTOCOL_V1_CONTRACT,
    RUN_PROTOCOL_V1_CONTRACT,
    SCOPE_PROTOCOL_V6_CONTRACT,
    STORAGE_PROTOCOL_V1_CONTRACT,
    SUPERVISION_PROTOCOL_V1_CONTRACT,
    TASK_PROTOCOL_V2_CONTRACT,
    TASK_RUN_LEDGER_PROJECTION_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V28_CONTRACT,
} from "./compatibility-constants.ts";
import type { ProtocolConfig } from "./config-types.ts";
import { sameStrings } from "./config-value-readers.ts";

/** Rejects valid configuration that would redefine the implemented ABI or store schema. */
export function assertSupportedProtocolCompatibility(config: ProtocolConfig): void {
    const expected = KERNEL_ABI_V0_CONTRACT;
    if (!sameJson(config.cli, CLI_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("CLI constants require a new CLI protocol");
    }
    if (
        config.kernel.abiVersion !== expected.abiVersion ||
        config.kernel.canonicalVersion !== expected.canonicalVersion ||
        config.kernel.recordKind !== expected.recordKind ||
        !sameStrings(config.kernel.recordModes, expected.recordModes)
    ) {
        throw new TypeError("kernel identity constants do not match the implemented ABI");
    }
    if (
        config.recordId.algorithm !== expected.recordId.algorithm ||
        config.recordId.hexLength !== expected.recordId.hexLength ||
        config.recordId.prefix !== expected.recordId.prefix
    ) {
        throw new TypeError("recordId constants do not match the implemented ABI");
    }
    if (config.kernel.store.appendIntentDigestAlgorithm !== expected.appendIntentDigestAlgorithm) {
        throw new TypeError("append intent digest requires a new store migration");
    }
    if (!sameJson(config.kernel.store.blobs, KERNEL_ABI_V0_STORE_V13_CONTRACT.blobs)) {
        throw new TypeError("blob identity and filesystem constants require a new store migration");
    }
    if (!sameJson(config.kernel.queries, expected.queries)) {
        throw new TypeError("kernel query constants do not match the implemented ABI");
    }
    // Archive input limits and import staging are operational, not part of the archive format
    // identity.
    const {
        limits: _limits,
        staging: _staging,
        ...interchangeIdentity
    } = config.kernel.interchange;
    if (!sameJson(interchangeIdentity, expected.interchange)) {
        throw new TypeError("kernel interchange constants require a new archive format");
    }
    if (!sameJson(config.kernel.schemas, expected.schemas)) {
        throw new TypeError("kernel schema constants do not match the implemented ABI");
    }
    const artifactDestinations = [
        ...Object.values(config.applications.artifacts),
        ...Object.values(config.backup.artifacts),
        ...Object.values(config.cli.artifacts),
        ...Object.values(config.delegation.artifacts),
        ...Object.values(config.effects.artifacts),
        ...Object.values(config.effects.compensation.artifacts),
        ...Object.values(config.kernel.artifacts),
        ...Object.values(config.observability.artifacts),
        ...Object.values(config.orphanRepair.artifacts),
        ...Object.values(config.projections.evidenceRecords.artifacts),
        ...Object.values(config.projections.taskRunLedgers.artifacts),
        ...Object.values(config.replay.artifacts),
        config.replay.branch.request.schemaPath,
        ...Object.values(config.retention.artifacts),
        ...Object.values(config.runs.artifacts),
        ...Object.values(config.scopes.artifacts),
        ...Object.values(config.supervision.artifacts),
        ...Object.values(config.tasks.artifacts),
        ...Object.values(config.workspaces.placements.artifacts),
        ...Object.values(config.workspaces.placements.nativeJails.artifacts),
        config.workspaces.selectionPublication.schemaPath,
        ...Object.values(config.workspaces.repositoryGrants.artifacts),
        ...Object.values(config.workspaces.settlement.application.artifacts),
        ...Object.values(config.workspaces.settlement.release.artifacts),
        config.workspaces.settlement.citationSchemaPath,
        config.workspaces.worldTaskCapture.captureSchemaPath,
        config.workspaces.worldTaskCapture.journalSchemaPath,
        config.workspaces.worldTaskCapture.operationJournal.schemaPath,
    ];
    if (new Set(artifactDestinations).size !== artifactDestinations.length) {
        throw new TypeError("protocol artifact destinations must be unique");
    }
    if (!sameJson(config.kernel.artifacts, expected.artifacts)) {
        throw new TypeError("protocol artifact destinations do not match the repository contract");
    }
    if (
        config.kernel.store.schemaVersion !== KERNEL_ABI_V0_STORE_V13_CONTRACT.schemaVersion ||
        !sameMigrations(config.kernel.store.migrations, KERNEL_ABI_V0_STORE_V13_CONTRACT.migrations)
    ) {
        throw new TypeError("store migration constants do not match the implemented schema");
    }
    if (!sameJson(config.kernel.rootWitness, expected.rootWitness)) {
        throw new TypeError("root witness constants do not match the implemented ABI");
    }
    if (!sameJson(config.projections.executionHistory, EXECUTION_HISTORY_PROJECTION_V1_CONTRACT)) {
        throw new TypeError("execution-history projection constants require a new projection");
    }
    if (!sameJson(config.orphanRepair, ORPHAN_REPAIR_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("orphan repair constants require a new repair protocol");
    }
    if (!sameJson(config.projections.evidenceRecords, EVIDENCE_RECORD_PROJECTION_V1_CONTRACT)) {
        throw new TypeError("output/trace/recovery constants require a new evidence projection");
    }
    if (!sameJson(config.projections.taskRunLedgers, TASK_RUN_LEDGER_PROJECTION_V1_CONTRACT)) {
        throw new TypeError("task/run ledger projection constants require a new projection");
    }
    if (!sameJson(config.providers, PROVIDER_PROTOCOL_V3_CONTRACT)) {
        throw new TypeError("provider constants require a new provider protocol");
    }
    if (!sameJson(config.tasks, TASK_PROTOCOL_V2_CONTRACT)) {
        throw new TypeError("task descriptor constants require a new task protocol");
    }
    if (!sameJson(config.effects, EFFECT_PROTOCOL_V2_CONTRACT)) {
        throw new TypeError("effect record constants require a new effect protocol");
    }
    if (!sameJson(config.formalAssurance, FORMAL_ASSURANCE_V2_CONTRACT)) {
        throw new TypeError("formal assurance constants require a new formal assurance protocol");
    }
    if (!sameJson(config.runs, RUN_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("run outcome constants require a new run protocol");
    }
    if (!sameJson(config.scopes, SCOPE_PROTOCOL_V6_CONTRACT)) {
        throw new TypeError("scope constants require a new scope protocol");
    }
    if (!sameJson(config.replay, REPLAY_PROTOCOL_V4_CONTRACT)) {
        throw new TypeError("replay constants require a new replay protocol");
    }
    if (!sameJson(config.supervision, SUPERVISION_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("supervision constants require a new supervision protocol");
    }
    if (!sameJson(config.delegation, DELEGATION_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("delegation constants require a new delegation protocol");
    }
    // Git subprocess hardening is operational and never reaches recorded workspace evidence.
    const { gitInvocation: _gitInvocation, ...workspaceIdentity } = config.workspaces;
    if (!sameJson(workspaceIdentity, WORKSPACE_PROTOCOL_V28_CONTRACT)) {
        throw new TypeError("workspace constants require a new workspace protocol");
    }
    if (!sameJson(config.applications, APPLICATIONS_PROTOCOL_V10_CONTRACT)) {
        throw new TypeError("application constants require a new applications protocol");
    }
    const retention = config.retention;
    if (
        !sameJson(
            {
                artifacts: retention.artifacts,
                compatibilityVersion: retention.compatibilityVersion,
                dataClasses: retention.dataClasses,
                dispositions: retention.dispositions,
                redactedArchive: retention.redactedArchive,
                report: retention.report,
                scanningModes: retention.scanning.modes,
                schemas: retention.schemas,
            },
            RETENTION_PROTOCOL_V1_CONTRACT,
        )
    ) {
        throw new TypeError("retention wire constants require a new retention protocol");
    }
    if (
        !sameJson(
            {
                compatibilityVersion: config.storage.compatibilityVersion,
                durabilities: config.storage.durabilities,
                statuses: config.storage.statuses,
            },
            STORAGE_PROTOCOL_V1_CONTRACT,
        )
    ) {
        throw new TypeError("storage vocabularies require a new storage protocol");
    }
    const backup = config.backup;
    if (
        !sameJson(
            {
                artifacts: backup.artifacts,
                blobLocations: backup.blobLocations,
                compatibilityVersion: backup.compatibilityVersion,
                digestAlgorithm: backup.digestAlgorithm,
                failureReasons: backup.failureReasons,
                manifest: backup.manifest,
                schemas: backup.schemas,
            },
            BACKUP_PROTOCOL_V1_CONTRACT,
        )
    ) {
        throw new TypeError("backup wire constants require a new backup protocol");
    }
    const observability = config.observability;
    if (
        !sameJson(
            {
                artifacts: observability.artifacts,
                batch: observability.batch,
                bodies: {
                    handlings: observability.bodies.handlings,
                    modes: observability.bodies.modes,
                },
                compatibilityVersion: observability.compatibilityVersion,
                ids: observability.ids,
                schemas: observability.schemas,
            },
            OBSERVABILITY_PROTOCOL_V1_CONTRACT,
        )
    ) {
        throw new TypeError("observability wire constants require a new observability protocol");
    }
}

function sameMigrations(
    actual: ProtocolConfig["kernel"]["store"]["migrations"],
    expected: typeof KERNEL_ABI_V0_STORE_V13_CONTRACT.migrations,
): boolean {
    return (
        actual.length === expected.length &&
        actual.every(
            (migration, index) =>
                migration.version === expected[index]?.version &&
                migration.firstOwnerOrdinal === expected[index]?.firstOwnerOrdinal &&
                migration.lastOwnerOrdinal === expected[index]?.lastOwnerOrdinal,
        )
    );
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value !== null && typeof value === "object") {
        const sorted = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortJson((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}
