import {
    readConfigurationAsset,
    resolveConfigurationAssetUrl,
} from "../errors/configuration-asset.ts";
import { assertNodeRuntime } from "../runtime/policy.ts";
import type {
    ApplicationsProtocolConfig,
    BackupProtocolConfig,
    CliProtocolConfig,
    DelegationProtocolConfig,
    EffectProtocolConfig,
    FormalAssuranceProtocolConfig,
    KernelProtocolConfig,
    ObservabilityProtocolConfig,
    OrphanRepairProtocolConfig,
    ProjectionProtocolConfig,
    ProtocolConfig,
    ProviderProtocolConfig,
    RecordIdConfig,
    ReplayProtocolConfig,
    RetentionProtocolConfig,
    RunProtocolConfig,
    ScopeProtocolConfig,
    StorageProtocolConfig,
    SupervisionProtocolConfig,
    TaskProtocolConfig,
    WorkspaceProtocolConfig,
} from "./config-types.ts";
import { parseProtocolConfig } from "./config-validation.ts";
import { RECORD_MODES } from "./values.generated.ts";

/** Location of the protocol configuration relative to this source or built module. */
export const protocolConfigUrl = resolveConfigurationAssetUrl(
    "../../protocol.config.json",
    import.meta.url,
);

assertNodeRuntime();

const protocolConfig: ProtocolConfig = parseProtocolConfig(
    readConfigurationAsset(protocolConfigUrl),
    { expectedRecordModes: RECORD_MODES },
);

/** Runtime research application manifest, protocol identity, and supervisor configuration. */
export const applicationsProtocolConfig: ApplicationsProtocolConfig = protocolConfig.applications;

/** Runtime trace-store backup manifest, layout, verification, and restore configuration. */
export const backupProtocolConfig: BackupProtocolConfig = protocolConfig.backup;

/** Runtime effect intent, outcome, identity, and schema configuration. */
export const effectProtocolConfig: EffectProtocolConfig = protocolConfig.effects;

/** Runtime human-facing command topology and CLI resource policy. */
export const cliProtocolConfig: CliProtocolConfig = protocolConfig.cli;

/** Runtime task delegation, child run handle, and delegated authority configuration. */
export const delegationProtocolConfig: DelegationProtocolConfig = protocolConfig.delegation;

/** Executable reference-machine and proof-envelope configuration. */
export const formalAssuranceProtocolConfig: FormalAssuranceProtocolConfig =
    protocolConfig.formalAssurance;

/** Runtime kernel ABI and canonicalization configuration. */
export const kernelProtocolConfig: KernelProtocolConfig = protocolConfig.kernel;

/** Runtime non-canonical telemetry mapping, batch identity, and body-export configuration. */
export const observabilityProtocolConfig: ObservabilityProtocolConfig =
    protocolConfig.observability;

/** Runtime orphaned-operation diagnosis and exact repair configuration. */
export const orphanRepairProtocolConfig: OrphanRepairProtocolConfig = protocolConfig.orphanRepair;

/** Runtime contracts for disposable projections over trace slices. */
export const projectionProtocolConfig: ProjectionProtocolConfig = protocolConfig.projections;

/** Runtime provider-neutral and deterministic-provider configuration. */
export const providerProtocolConfig: ProviderProtocolConfig = protocolConfig.providers;

/** Runtime record-identifier configuration loaded from the protocol configuration file. */
export const recordIdConfig: RecordIdConfig = protocolConfig.recordId;

/** Runtime replay session, coupled checkpoint, rewind, and replay configuration. */
export const replayProtocolConfig: ReplayProtocolConfig = protocolConfig.replay;

/** Runtime secret-scanning, data-class, redacted-export, and store-file configuration. */
export const retentionProtocolConfig: RetentionProtocolConfig = protocolConfig.retention;

/** Runtime terminal run-outcome and schema configuration. */
export const runProtocolConfig: RunProtocolConfig = protocolConfig.runs;

/** Runtime durable isolated-scope registration, authority, and emission configuration. */
export const scopeProtocolConfig: ScopeProtocolConfig = protocolConfig.scopes;

/** Runtime remote-storage interface, reference-adapter, and conformance configuration. */
export const storageProtocolConfig: StorageProtocolConfig = protocolConfig.storage;

/** Runtime live subscription, supervised interception, approval, and context configuration. */
export const supervisionProtocolConfig: SupervisionProtocolConfig = protocolConfig.supervision;

/** Runtime task descriptor, schema, and artifact-lock protocol configuration. */
export const taskProtocolConfig: TaskProtocolConfig = protocolConfig.tasks;

/** Runtime workspace initialization and adoption configuration. */
export const workspaceProtocolConfig: WorkspaceProtocolConfig = protocolConfig.workspaces;
