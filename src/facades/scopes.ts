/** Stable Node-only ESM subpath for durable trace-only scope registration, emission, and inspection. */
export {
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_COMMAND_KINDS,
    SCOPE_COMPATIBILITY_VERSION,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_KINDS,
    SCOPE_LIMITS,
    SCOPE_RECORD_VERSION,
    SCOPE_RESOURCE_KINDS,
    SCOPE_STATES,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
export { emitScopeRecord } from "../scope/emission.ts";
export {
    ScopeAuthorityError,
    ScopeEvidenceError,
    ScopeHeadConflictError,
    ScopeWriterConflictError,
    ScopeWriterFencedError,
} from "../scope/errors.ts";
export { inspectScope } from "../scope/inspection.ts";
export { registerChildScope, registerRootScope } from "../scope/registration.ts";
export { readScopeCommandReceipt } from "../scope/replay.ts";
export type {
    ClaimScopeWriterOptions,
    EmitScopeRecordOptions,
    RegisterChildScopeOptions,
    RegisterRootScopeOptions,
    ReleaseScopeWriterOptions,
    ScopeAuthority,
    ScopeAuthorityAtom,
    ScopeChildRegisteredRecord,
    ScopeChildRegistrationReceipt,
    ScopeCommandKind,
    ScopeCommandReplay,
    ScopeEmissionReceipt,
    ScopeEmissionRecord,
    ScopeEvidenceKind,
    ScopeHeadAddress,
    ScopeHistoryEntry,
    ScopeInspection,
    ScopeKind,
    ScopeParentOrigin,
    ScopeRegistrationRecord,
    ScopeResourceGrant,
    ScopeResourceGrantRequest,
    ScopeResourceKind,
    ScopeRootRegistrationReceipt,
    ScopeState,
    ScopeWorldCapability,
    ScopeWriter,
    ScopeWriterRelease,
} from "../scope/types.ts";
export { claimScopeWriter, releaseScopeWriter } from "../scope/writer.ts";
export { AppendIntentConflictError, TraceStoreError } from "../store/errors.ts";
