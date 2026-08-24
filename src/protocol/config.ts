import { readFileSync } from "node:fs";
import type {
    CliProtocolConfig,
    EffectProtocolConfig,
    FormalAssuranceProtocolConfig,
    KernelProtocolConfig,
    OrphanRepairProtocolConfig,
    ProjectionProtocolConfig,
    ProtocolConfig,
    ProviderProtocolConfig,
    RecordIdConfig,
    RunProtocolConfig,
    TaskProtocolConfig,
    WorkspaceProtocolConfig,
} from "./config-types.ts";
import { parseProtocolConfig } from "./config-validation.ts";
import { RECORD_MODES } from "./values.generated.ts";

/** Location of the protocol configuration relative to this source or built module. */
export const protocolConfigUrl = new URL("../../protocol.config.json", import.meta.url);

const protocolConfig: ProtocolConfig = parseProtocolConfig(
    JSON.parse(readFileSync(protocolConfigUrl, "utf8")),
    { expectedRecordModes: RECORD_MODES },
);

/** Runtime effect intent, outcome, identity, and schema configuration. */
export const effectProtocolConfig: EffectProtocolConfig = protocolConfig.effects;

/** Runtime human-facing command topology and CLI resource policy. */
export const cliProtocolConfig: CliProtocolConfig = protocolConfig.cli;

/** Executable reference-machine and proof-envelope configuration. */
export const formalAssuranceProtocolConfig: FormalAssuranceProtocolConfig =
    protocolConfig.formalAssurance;

/** Runtime kernel ABI and canonicalization configuration. */
export const kernelProtocolConfig: KernelProtocolConfig = protocolConfig.kernel;

/** Runtime orphaned-operation diagnosis and exact repair configuration. */
export const orphanRepairProtocolConfig: OrphanRepairProtocolConfig = protocolConfig.orphanRepair;

/** Runtime contracts for disposable projections over trace slices. */
export const projectionProtocolConfig: ProjectionProtocolConfig = protocolConfig.projections;

/** Runtime provider-neutral and deterministic-provider configuration. */
export const providerProtocolConfig: ProviderProtocolConfig = protocolConfig.providers;

/** Runtime record-identifier configuration loaded from the protocol configuration file. */
export const recordIdConfig: RecordIdConfig = protocolConfig.recordId;

/** Runtime terminal run-outcome and schema configuration. */
export const runProtocolConfig: RunProtocolConfig = protocolConfig.runs;

/** Runtime task descriptor, schema, and artifact-lock protocol configuration. */
export const taskProtocolConfig: TaskProtocolConfig = protocolConfig.tasks;

/** Runtime workspace initialization and adoption configuration. */
export const workspaceProtocolConfig: WorkspaceProtocolConfig = protocolConfig.workspaces;
