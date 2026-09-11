import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type {
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_COMMAND_KINDS,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_KINDS,
    SCOPE_RESOURCE_KINDS,
    SCOPE_STATES,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { CutId } from "../store/types.ts";

declare const scopeWriterContract: unique symbol;

/** Configured scope kind: root or child. */
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Configured branch-lifecycle state of one scope. */
export type ScopeState = (typeof SCOPE_STATES)[number];

/** Configured scope command kind: root registration, child registration, or emission. */
export type ScopeCommandKind = (typeof SCOPE_COMMAND_KINDS)[number];

/** Configured classification of one retained scope-local history entry. */
export type ScopeEvidenceKind = (typeof SCOPE_EVIDENCE_KINDS)[number];

/** Configured world capability declared by a scope registration. */
export type ScopeWorldCapability = (typeof SCOPE_WORLD_CAPABILITIES)[number];

/** Configured authority atom shared with repository grants. */
export type ScopeAuthorityAtom = (typeof SCOPE_AUTHORITY_ATOMS)[number];

/** Configured resource kind that scope authority may cite. */
export type ScopeResourceKind = (typeof SCOPE_RESOURCE_KINDS)[number];

/** Authority atoms bound to one exact resource identity. */
export type ScopeResourceGrant = {
    /** Configured atoms granted on the resource, in configured order. */
    readonly atoms: readonly ScopeAuthorityAtom[];
    /** Exact resource identity; slice A treats it as an opaque exact string. */
    readonly resource_id: string;
    /** Configured resource kind. */
    readonly resource_kind: ScopeResourceKind;
};

/** Whole-run ceiling and effective attenuated authority retained by a scope. */
export type ScopeAuthority = {
    /** Whole-run ceiling inherited by every scope in the tree. */
    readonly ceiling: readonly ScopeResourceGrant[];
    /** Effective authority: the intersection of parent, request, and ceiling per resource. */
    readonly effective: readonly ScopeResourceGrant[];
};

/** Exact ownership and fork-origin evidence retained by a child scope. */
export type ScopeParentOrigin = {
    /** Parent-owned control record retaining this child registration. */
    readonly child_registered_record_id: RecordId;
    /** Immutable cut through the parent head at registration. */
    readonly origin_cut_id: CutId;
    /** Parent head record fixed as this child's origin. */
    readonly origin_record_id: RecordId;
    /** Owning parent scope identity. */
    readonly scope_id: string;
};

/** Canonical scope registration record body. */
export type ScopeRegistrationRecord = {
    /** Ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Globally idempotent registration command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Associated durable execution, or null. */
    readonly execution_id: string | null;
    /** Root or child kind. */
    readonly kind: ScopeKind;
    /** Exact parent origin for a child, or null for a root. */
    readonly parent: ScopeParentOrigin | null;
    /** Registered scope identity and owner path. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
    /** Declared world capability; slice A registrations are trace-only. */
    readonly world_capability: ScopeWorldCapability;
};

/** Canonical parent-owned child-registration control record body. */
export type ScopeChildRegisteredRecord = {
    /** Registered child scope identity. */
    readonly child_scope_id: string;
    /** Globally idempotent registration command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Immutable origin cut published through the parent head. */
    readonly origin_cut_id: CutId;
    /** Parent head record fixed as the child's origin. */
    readonly origin_record_id: RecordId;
    /** Owning parent scope identity. */
    readonly parent_scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Canonical scope-local application-data emission record body. */
export type ScopeEmissionRecord = {
    /** Retained records cited as additional causal parents. */
    readonly cited_record_ids: readonly RecordId[];
    /** Globally idempotent emission command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Validated canonical application data. */
    readonly data: SemanticRecord;
    /** Exact scope head expected when the emission was admitted. */
    readonly expected_head_record_id: RecordId;
    /** Emitting scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Package-authenticated live writer authority for one scope. */
export type ScopeWriter = {
    /** Exact claim identity admitted by the store. */
    readonly claim_id: string;
    /** Monotonic fencing token checked by every mutating command. */
    readonly fencing_token: number;
    /** Lease expiry in Unix milliseconds. */
    readonly lease_expires_at: number;
    /** Scope owned by this writer. */
    readonly scope_id: string;
    /** Compile-time marker for package-minted handles. */
    readonly [scopeWriterContract]?: true;
};

/** Retained head address of one scope owner path. */
export type ScopeHeadAddress = {
    /** Retained ordinal of the head occurrence. */
    readonly owner_ordinal: number;
    /** Record at the head occurrence. */
    readonly record_id: RecordId;
};

/** Requested root or child resource authority. */
export type ScopeResourceGrantRequest = readonly ScopeResourceGrant[];

/** Closed options for registering one root scope. */
export type RegisterRootScopeOptions = {
    /** Whole-run ceiling and requested root grant. */
    readonly authority: {
        /** Whole-run ceiling inherited by the entire scope tree. */
        readonly ceiling: ScopeResourceGrantRequest;
        /** Requested root authority attenuated by the ceiling. */
        readonly grant: ScopeResourceGrantRequest;
    };
    /** Globally idempotent command identity. */
    readonly commandId: string;
    /** Optional durable execution owner path with retained creation evidence. */
    readonly executionId?: string;
};

/** Closed options for registering one child scope under a parent writer. */
export type RegisterChildScopeOptions = {
    /** Globally idempotent command identity. */
    readonly commandId: string;
    /** Optional durable execution owner path with retained creation evidence. */
    readonly executionId?: string;
    /** Exact current parent head fixed as the child's origin. */
    readonly expectedHeadRecordId: RecordId;
    /** Requested child authority attenuated by parent and ceiling. */
    readonly grant: ScopeResourceGrantRequest;
    /** Unix time used for deterministic fence evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /** Authenticated parent writer supplying explicit parent authority. */
    readonly parent: ScopeWriter;
};

/** Closed options for claiming scope writer authority. */
export type ClaimScopeWriterOptions = {
    /** Unique claim identity proposed by this caller. */
    readonly claimId: string;
    /** Unix time used for deterministic lease evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /** Registered scope to write. */
    readonly scopeId: string;
};

/** Closed options for releasing scope writer authority. */
export type ReleaseScopeWriterOptions = {
    /** Authenticated writer being released. */
    readonly writer: ScopeWriter;
};

/** Closed options for one fenced scope-local emission. */
export type EmitScopeRecordOptions = {
    /** Retained records cited as additional causal parents. */
    readonly citedRecordIds?: readonly RecordId[];
    /** Globally idempotent command identity. */
    readonly commandId: string;
    /** Validated canonical application data. */
    readonly data: SemanticRecord;
    /** Exact current scope head. */
    readonly expectedHeadRecordId: RecordId;
    /** Unix time used for deterministic fence evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
    /** Authenticated writer for the emitting scope. */
    readonly writer: ScopeWriter;
};

/** Durable result of registering one root scope. */
export type ScopeRootRegistrationReceipt = {
    /** Retained ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Globally idempotent command identity. */
    readonly command_id: string;
    /** Head of the new scope path, which is its registration record. */
    readonly head: ScopeHeadAddress;
    /** Root kind. */
    readonly kind: ScopeKind;
    /** Retained registration record identity. */
    readonly registration_record_id: RecordId;
    /** Registered scope identity and owner path. */
    readonly scope_id: string;
};

/** Durable result of registering one child scope. */
export type ScopeChildRegistrationReceipt = {
    /** Retained ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Globally idempotent command identity. */
    readonly command_id: string;
    /** Head of the child path after registration, which is its origin-cut publication. */
    readonly head: ScopeHeadAddress;
    /** Child kind. */
    readonly kind: ScopeKind;
    /** Exact parent origin evidence. */
    readonly origin: ScopeParentOrigin;
    /** Parent head after the child-registration control record was appended. */
    readonly parent_head: ScopeHeadAddress;
    /** Retained registration record identity. */
    readonly registration_record_id: RecordId;
    /** Registered scope identity and owner path. */
    readonly scope_id: string;
};

/** Durable result of releasing one exact scope writer. */
export type ScopeWriterRelease = {
    /** Released claim identity. */
    readonly claim_id: string;
    /** Fencing token of the released claim. */
    readonly fencing_token: number;
    /** Scope whose writer was released. */
    readonly scope_id: string;
};

/** Durable result of one scope-local emission. */
export type ScopeEmissionReceipt = {
    /** Globally idempotent command identity. */
    readonly command_id: string;
    /** Head of the scope path after the emission. */
    readonly head: ScopeHeadAddress;
    /** Head the emission was admitted against. */
    readonly previous_head_record_id: RecordId;
    /** Emitting scope identity. */
    readonly scope_id: string;
};

/** Classified original receipt of one completed scope command, reconstructed from records. */
export type ScopeCommandReplay =
    | {
          /** Root registration command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[0];
          /** Original root registration receipt. */
          readonly receipt: ScopeRootRegistrationReceipt;
      }
    | {
          /** Child registration command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[1];
          /** Original child registration receipt. */
          readonly receipt: ScopeChildRegistrationReceipt;
      }
    | {
          /** Emission command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[2];
          /** Original emission receipt. */
          readonly receipt: ScopeEmissionReceipt;
      };

/** One validated scope-local history entry. */
export type ScopeHistoryEntry =
    | {
          /** Registration command identity. */
          readonly command_id: string;
          /** Registration classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[0];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Published origin cut identity. */
          readonly cut_id: CutId;
          /** Origin-cut classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[1];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Registered child scope identity. */
          readonly child_scope_id: string;
          /** Registration command identity. */
          readonly command_id: string;
          /** Child-registration classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[2];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Retained records cited by the emission. */
          readonly cited_record_ids: readonly RecordId[];
          /** Emission command identity. */
          readonly command_id: string;
          /** Emission classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[3];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      };

/** Read-only validated projection of one scope reconstructed from retained records. */
export type ScopeInspection = {
    /** Retained ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Child scopes registered from this scope, in retained order. */
    readonly children: readonly string[];
    /** Associated durable execution, or null. */
    readonly execution_id: string | null;
    /** Current head of the scope path. */
    readonly head: ScopeHeadAddress;
    /** Complete validated scope-local history in ordinal order. */
    readonly history: readonly ScopeHistoryEntry[];
    /** Root or child kind. */
    readonly kind: ScopeKind;
    /** Exact parent origin for a child, or null for a root. */
    readonly parent: ScopeParentOrigin | null;
    /** Whether this store holds live registration admitting mutation; false after import. */
    readonly registered_for_mutation: boolean;
    /** Retained registration record identity. */
    readonly registration_record_id: RecordId;
    /** Inspected scope identity. */
    readonly scope_id: string;
    /** Current branch-lifecycle state. */
    readonly state: ScopeState;
    /** Declared world capability. */
    readonly world_capability: ScopeWorldCapability;
};
