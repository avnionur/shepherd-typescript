import {
    EFFECT_PROTOCOL_V1_CONTRACT,
    EXECUTION_HISTORY_PROJECTION_V1_CONTRACT,
    FORMAL_ASSURANCE_V1_CONTRACT,
    KERNEL_ABI_V0_CONTRACT,
    KERNEL_ABI_V0_STORE_V6_CONTRACT,
    PROVIDER_PROTOCOL_V1_CONTRACT,
    RUN_PROTOCOL_V1_CONTRACT,
    TASK_PROTOCOL_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V12_CONTRACT,
} from "./compatibility-constants.ts";
import type { ProtocolConfig } from "./config-types.ts";
import { sameStrings } from "./config-value-readers.ts";

/** Rejects valid configuration that would redefine the implemented ABI or store schema. */
export function assertSupportedProtocolCompatibility(config: ProtocolConfig): void {
    const expected = KERNEL_ABI_V0_CONTRACT;
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
    if (!sameJson(config.kernel.store.blobs, KERNEL_ABI_V0_STORE_V6_CONTRACT.blobs)) {
        throw new TypeError("blob identity and filesystem constants require a new store migration");
    }
    if (!sameJson(config.kernel.queries, expected.queries)) {
        throw new TypeError("kernel query constants do not match the implemented ABI");
    }
    if (!sameJson(config.kernel.interchange, expected.interchange)) {
        throw new TypeError("kernel interchange constants require a new archive format");
    }
    if (!sameJson(config.kernel.schemas, expected.schemas)) {
        throw new TypeError("kernel schema constants do not match the implemented ABI");
    }
    const artifactDestinations = [
        ...Object.values(config.effects.artifacts),
        ...Object.values(config.kernel.artifacts),
        ...Object.values(config.runs.artifacts),
        ...Object.values(config.tasks.artifacts),
    ];
    if (new Set(artifactDestinations).size !== artifactDestinations.length) {
        throw new TypeError("protocol artifact destinations must be unique");
    }
    if (!sameJson(config.kernel.artifacts, expected.artifacts)) {
        throw new TypeError("protocol artifact destinations do not match the repository contract");
    }
    if (
        config.kernel.store.schemaVersion !== KERNEL_ABI_V0_STORE_V6_CONTRACT.schemaVersion ||
        !sameMigrations(config.kernel.store.migrations, KERNEL_ABI_V0_STORE_V6_CONTRACT.migrations)
    ) {
        throw new TypeError("store migration constants do not match the implemented schema");
    }
    if (!sameJson(config.kernel.rootWitness, expected.rootWitness)) {
        throw new TypeError("root witness constants do not match the implemented ABI");
    }
    if (!sameJson(config.projections.executionHistory, EXECUTION_HISTORY_PROJECTION_V1_CONTRACT)) {
        throw new TypeError("execution-history projection constants require a new projection");
    }
    if (!sameJson(config.providers, PROVIDER_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("provider constants require a new provider protocol");
    }
    if (!sameJson(config.tasks, TASK_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("task descriptor constants require a new task protocol");
    }
    if (!sameJson(config.effects, EFFECT_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("effect record constants require a new effect protocol");
    }
    if (!sameJson(config.formalAssurance, FORMAL_ASSURANCE_V1_CONTRACT)) {
        throw new TypeError("formal assurance constants require a new formal assurance protocol");
    }
    if (!sameJson(config.runs, RUN_PROTOCOL_V1_CONTRACT)) {
        throw new TypeError("run outcome constants require a new run protocol");
    }
    if (!sameJson(config.workspaces, WORKSPACE_PROTOCOL_V12_CONTRACT)) {
        throw new TypeError("workspace constants require a new workspace protocol");
    }
}

function sameMigrations(
    actual: ProtocolConfig["kernel"]["store"]["migrations"],
    expected: typeof KERNEL_ABI_V0_STORE_V6_CONTRACT.migrations,
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
