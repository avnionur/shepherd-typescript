import type { SemanticRecord } from "../canonical/canonical-record.ts";
import type { EffectReconciliationReceipt } from "../effect/reconciliation-types.ts";
import type {
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_CHECKPOINT_CONSTITUENT_KINDS,
    SCOPE_CHECKPOINT_EVIDENCE_STATUSES,
    SCOPE_CHECKPOINT_START_CLASSIFICATIONS,
    SCOPE_COMMAND_KINDS,
    SCOPE_DISCARD_PHASES,
    SCOPE_EVIDENCE_KINDS,
    SCOPE_FORK_PHASES,
    SCOPE_KINDS,
    SCOPE_MERGE_PHASES,
    SCOPE_RECOVERY_CLASSIFICATIONS,
    SCOPE_RECOVERY_RESUME_KINDS,
    SCOPE_RESOURCE_KINDS,
    SCOPE_STATES,
    SCOPE_VOCABULARY_STATUSES,
    SCOPE_VOCABULARY_TERMS,
    SCOPE_WORLD_CAPABILITIES,
} from "../protocol/values.generated.ts";
import type { RecordId } from "../record/types.ts";
import type { CutId } from "../store/types.ts";

declare const scopeWriterContract: unique symbol;

/** Configured scope kind: root or child. */
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Configured branch-lifecycle state of one scope. */
export type ScopeState = (typeof SCOPE_STATES)[number];

/** Configured scope command kind: root or child registration, emission, fork, merge, or discard. */
export type ScopeCommandKind = (typeof SCOPE_COMMAND_KINDS)[number];

/** Configured scope fork journal phase: prepared or completed. */
export type ScopeForkPhase = (typeof SCOPE_FORK_PHASES)[number];

/** Configured scope merge journal phase: prepared or completed. */
export type ScopeMergePhase = (typeof SCOPE_MERGE_PHASES)[number];

/** Configured scope discard journal phase: decided or cleaned. */
export type ScopeDiscardPhase = (typeof SCOPE_DISCARD_PHASES)[number];

/** Configured constituent kind classified by a scope checkpoint descriptor. */
export type ScopeCheckpointConstituentKind = (typeof SCOPE_CHECKPOINT_CONSTITUENT_KINDS)[number];

/** Configured evidence status of one scope checkpoint constituent. */
export type ScopeCheckpointEvidenceStatus = (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[number];

/**
 * One classified checkpoint constituent.
 *
 * A verified constituent cites a retained receipt identity, an unavailable constituent states why,
 * and reconstructive or not-applicable constituents carry neither.
 */
export type ScopeCheckpointConstituent =
    | {
          /** Classified constituent kind. */
          readonly kind: ScopeCheckpointConstituentKind;
          /** Retained evidence identity proving the constituent. */
          readonly receipt_id: string;
          /** Verified classification. */
          readonly status: (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[0];
      }
    | {
          /** Classified constituent kind. */
          readonly kind: ScopeCheckpointConstituentKind;
          /** Reconstructive or not-applicable classification. */
          readonly status:
              | (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[1]
              | (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[2];
      }
    | {
          /** Classified constituent kind. */
          readonly kind: ScopeCheckpointConstituentKind;
          /** Stable description of why the constituent cannot be proven or restored. */
          readonly reason: string;
          /** Unavailable classification. */
          readonly status: (typeof SCOPE_CHECKPOINT_EVIDENCE_STATUSES)[3];
      };

/** Honest coupled checkpoint descriptor retained by a completed scope fork. */
export type ScopeCheckpoint = {
    /** Carrier capture classification; a quiescent verified copy, not an atomic snapshot. */
    readonly capture_kind: string;
    /** Configured checkpoint descriptor version. */
    readonly checkpoint_version: number;
    /** Every configured constituent in configured order. */
    readonly constituents: readonly ScopeCheckpointConstituent[];
};

/** Exact resource identity bound to a scope world. */
export type ScopeBoundResource = {
    /** Exact resource identity. */
    readonly resource_id: string;
    /** Configured resource kind. */
    readonly resource_kind: ScopeResourceKind;
};

/** Canonical prepared fork journal record body retained before physical custody. */
export type ScopeForkPreparedRecord = {
    /** Exact immutable origin content identity. */
    readonly base_content_id: string;
    /** Exact immutable origin revision identity. */
    readonly base_revision_id: string;
    /** Exact workspace binding identity. */
    readonly binding_id: string;
    /** Carrier capture classification of the origin. */
    readonly capture_kind: string;
    /** Globally idempotent fork command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Deterministic custody identity the fork publishes. */
    readonly custody_id: string;
    /** Prepared phase. */
    readonly phase: (typeof SCOPE_FORK_PHASES)[0];
    /** Exact bound resource identity. */
    readonly resource_id: string;
    /** Configured bound resource kind. */
    readonly resource_kind: ScopeResourceKind;
    /** Forked child scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
    /** Reference-copy world capability. */
    readonly world_capability: ScopeWorldCapability;
};

/** Canonical completed fork journal record body citing verified custody. */
export type ScopeForkCompletedRecord = {
    /** Honest coupled checkpoint descriptor. */
    readonly checkpoint: ScopeCheckpoint;
    /** Globally idempotent fork command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Verified custody content identity at completion. */
    readonly custody_content_id: string;
    /** Exact published custody identity. */
    readonly custody_id: string;
    /** Completed phase. */
    readonly phase: (typeof SCOPE_FORK_PHASES)[1];
    /** Forked child scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Validated reference-copy world of one forked scope. */
export type ScopeWorldInspection = {
    /** Exact immutable origin content identity. */
    readonly base_content_id: string;
    /** Exact immutable origin revision identity. */
    readonly base_revision_id: string;
    /** Exact workspace binding identity. */
    readonly binding_id: string;
    /** Carrier capture classification. */
    readonly capture_kind: string;
    /** Checkpoint descriptor once the fork completed, otherwise null. */
    readonly checkpoint: ScopeCheckpoint | null;
    /** Completed journal record identity, or null while only prepared. */
    readonly completed_record_id: RecordId | null;
    /** Deterministic custody identity. */
    readonly custody_id: string;
    /** Prepared journal record identity. */
    readonly prepared_record_id: RecordId;
    /** Exact bound resource. */
    readonly resource: ScopeBoundResource;
    /** Latest retained fork journal phase. */
    readonly status: ScopeForkPhase;
};

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

/** Durable result of one completed reference-copy scope fork. */
export type ScopeForkReceipt = {
    /** Retained ceiling and effective authority. */
    readonly authority: ScopeAuthority;
    /** Globally idempotent command identity. */
    readonly command_id: string;
    /** Completed fork journal record identity. */
    readonly completed_record_id: RecordId;
    /** Head of the child path after completion. */
    readonly head: ScopeHeadAddress;
    /** Child kind. */
    readonly kind: ScopeKind;
    /** Exact parent origin evidence. */
    readonly origin: ScopeParentOrigin;
    /** Parent head after the child-registration control record was appended. */
    readonly parent_head: ScopeHeadAddress;
    /** Prepared fork journal record identity. */
    readonly prepared_record_id: RecordId;
    /** Retained registration record identity. */
    readonly registration_record_id: RecordId;
    /** Forked child scope identity and owner path. */
    readonly scope_id: string;
    /** Verified reference-copy world with its checkpoint descriptor. */
    readonly world: ScopeWorldInspection;
};

/** One requested writer claim in a multi-scope acquisition. */
export type ScopeWriterClaimRequest = {
    /** Unique claim identity proposed by this caller. */
    readonly claimId: string;
    /** Registered scope to write. */
    readonly scopeId: string;
};

/** Closed options for atomically claiming writers over several scopes. */
export type ClaimScopeWritersOptions = {
    /** Distinct scopes to claim; acquisition order is canonical scope-identity order. */
    readonly claims: readonly ScopeWriterClaimRequest[];
    /** Unix time used for deterministic lease evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
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
      }
    | {
          /** Reference-copy fork command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[3];
          /** Original completed fork receipt. */
          readonly receipt: ScopeForkReceipt;
      }
    | {
          /** Consume-once merge command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[4];
          /** Original completed merge receipt. */
          readonly receipt: ScopeMergeReceipt;
      }
    | {
          /** Subtree discard command. */
          readonly command: (typeof SCOPE_COMMAND_KINDS)[5];
          /** Original logical discard receipt with current cleanup progress. */
          readonly receipt: ScopeDiscardReceipt;
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
      }
    | {
          /** Fork command identity. */
          readonly command_id: string;
          /** Deterministic custody identity. */
          readonly custody_id: string;
          /** Fork journal classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[4] | (typeof SCOPE_EVIDENCE_KINDS)[5];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Merge command identity. */
          readonly command_id: string;
          /** Fixed child cut publication, merge reservation, or child seal classification. */
          readonly kind:
              | (typeof SCOPE_EVIDENCE_KINDS)[6]
              | (typeof SCOPE_EVIDENCE_KINDS)[7]
              | (typeof SCOPE_EVIDENCE_KINDS)[8];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Consumed child scope identity. */
          readonly child_scope_id: string;
          /** Merge command identity. */
          readonly command_id: string;
          /** Parent-side child integration classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[9];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      }
    | {
          /** Discard command identity. */
          readonly command_id: string;
          /** Discard decision or cleanup classification. */
          readonly kind: (typeof SCOPE_EVIDENCE_KINDS)[10] | (typeof SCOPE_EVIDENCE_KINDS)[11];
          /** Retained ordinal. */
          readonly owner_ordinal: number;
          /** Retained record identity. */
          readonly record_id: RecordId;
      };

/** Read-only validated projection of one scope reconstructed from retained records. */
export type ScopeInspection = {
    /** Accepted external risk still unresolved in this owner's causal or associated execution evidence. */
    readonly residual_risks?: readonly EffectReconciliationReceipt[];
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
    /**
     * Effective selected history in deterministic order: this scope's own emissions plus
     * contributions integrated by completed child merges, each occurrence exactly once.
     */
    readonly selected_history: readonly ScopeContribution[];
    /** Current branch-lifecycle state derived from retained terminal evidence. */
    readonly state: ScopeState;
    /** Latest retained merge or discard decision on this scope path, or null while open. */
    readonly terminal: ScopeTerminalInspection | null;
    /** Reference-copy world evidence for a forked scope, otherwise null. */
    readonly world: ScopeWorldInspection | null;
    /** Declared world capability. */
    readonly world_capability: ScopeWorldCapability;
};

/** One exact selected-history occurrence identified by its original owner, ordinal, and record. */
export type ScopeContribution = {
    /** Scope owner path that originally retained the occurrence. */
    readonly owner_id: string;
    /** Original retained ordinal on that owner path. */
    readonly owner_ordinal: number;
    /** Immutable record identity of the occurrence. */
    readonly record_id: RecordId;
};

/** Exact three-way world plan retained by a merge reservation. */
export type ScopeMergeWorldPlan = {
    /**
     * Deterministic protected custody identity that builds the merged revision only after the
     * reservation wins, or null for an empty child delta.
     */
    readonly application_custody_id: string | null;
    /** Exact workspace binding shared by the child and parent worlds. */
    readonly binding_id: string;
    /** Content of the captured child revision. */
    readonly child_content_id: string;
    /** Captured child custody revision whose parent is the common origin. */
    readonly child_revision_id: string;
    /** Content of the common origin revision. */
    readonly origin_content_id: string;
    /** Common origin revision the child world was forked from. */
    readonly origin_revision_id: string;
    /** Content of the captured current parent revision. */
    readonly parent_content_id: string;
    /** Parent-managed custody receiving the publication. */
    readonly parent_custody_id: string;
    /** Captured current parent custody revision. */
    readonly parent_revision_id: string;
};

/** Canonical child-side merge reservation retained before any parent publication. */
export type ScopeMergePreparedRecord = {
    /** Child head the fixed merge cut is published through. */
    readonly child_head_record_id: RecordId;
    /** Globally idempotent merge command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Child selected-history occurrences not already selected by the parent, in order. */
    readonly contributions: readonly ScopeContribution[];
    /** Deterministic fixed child cut identity. */
    readonly merge_cut_id: string;
    /** Exact parent head the merge integrates against. */
    readonly parent_head_record_id: RecordId;
    /** Owning parent scope identity. */
    readonly parent_scope_id: string;
    /** Prepared phase. */
    readonly phase: (typeof SCOPE_MERGE_PHASES)[0];
    /** Consumed child scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
    /** Exact three-way world plan, or null for a trace-only child. */
    readonly world: ScopeMergeWorldPlan | null;
};

/** Canonical child-side merge seal retained with the parent integration. */
export type ScopeMergeCompletedRecord = {
    /** Globally idempotent merge command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Owning parent scope identity. */
    readonly parent_scope_id: string;
    /** Completed phase. */
    readonly phase: (typeof SCOPE_MERGE_PHASES)[1];
    /** Verified parent custody revision captured after publication, or null for a trace-only child. */
    readonly publication_revision_id: string | null;
    /** Consumed child scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Canonical parent-owned integration of one consumed child. */
export type ScopeChildMergedRecord = {
    /** Completed fork record carrying the child's checkpoint, or null for a trace-only child. */
    readonly child_checkpoint_record_id: RecordId | null;
    /** Fixed child cut cited exactly once. */
    readonly child_cut_id: string;
    /** Consumed child scope identity. */
    readonly child_scope_id: string;
    /** Globally idempotent merge command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Selected-history occurrences integrated into the parent, in order. */
    readonly contributions: readonly ScopeContribution[];
    /** Merged world content published into parent custody, or null for a trace-only child. */
    readonly merged_content_id: string | null;
    /** Owning parent scope identity. */
    readonly parent_scope_id: string;
    /** Verified parent custody revision captured after publication, or null. */
    readonly publication_revision_id: string | null;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Canonical logical discard decision retained on each sealed scope path. */
export type ScopeDiscardDecidedRecord = {
    /** Globally idempotent discard command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Proven-owned custody identities of the whole subtree on the target record, otherwise empty. */
    readonly custody_ids: readonly string[];
    /** Discarded subtree root scope identity. */
    readonly discard_scope_id: string;
    /** Owning parent of the discarded subtree root. */
    readonly parent_scope_id: string;
    /** Decided phase. */
    readonly phase: (typeof SCOPE_DISCARD_PHASES)[0];
    /** Sealed scope whose path retains this record. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
    /** Every scope sealed by the decision on the target record, otherwise empty. */
    readonly sealed_scope_ids: readonly string[];
};

/** Canonical discard cleanup progress retained on the discarded subtree root. */
export type ScopeDiscardCleanedRecord = {
    /** Globally idempotent discard command identity. */
    readonly command_id: string;
    /** Configured scope compatibility namespace. */
    readonly compatibility_version: string;
    /** Exact custody identities whose cleanup is complete. */
    readonly custody_ids: readonly string[];
    /** Cleaned phase. */
    readonly phase: (typeof SCOPE_DISCARD_PHASES)[1];
    /** Discarded subtree root scope identity. */
    readonly scope_id: string;
    /** Configured canonical scope record version. */
    readonly scope_version: number;
};

/** Latest retained terminal decision of one scope. */
export type ScopeTerminalInspection =
    | {
          /** Merge command identity. */
          readonly command_id: string;
          /** Merge command classification. */
          readonly kind: (typeof SCOPE_COMMAND_KINDS)[4];
          /** Latest retained merge phase; prepared is in flight, not a terminal state. */
          readonly phase: ScopeMergePhase;
          /** Latest retained merge journal record. */
          readonly record_id: RecordId;
      }
    | {
          /** Discard command identity. */
          readonly command_id: string;
          /** Discard command classification. */
          readonly kind: (typeof SCOPE_COMMAND_KINDS)[5];
          /** Latest retained discard phase; cleanup progress is separate from the decision. */
          readonly phase: ScopeDiscardPhase;
          /** Latest retained discard journal record. */
          readonly record_id: RecordId;
      };

/** Durable result of one completed consume-once scope merge. */
export type ScopeMergeReceipt = {
    /** Parent-side child integration record identity. */
    readonly child_merged_record_id: RecordId;
    /** Consumed child scope identity. */
    readonly child_scope_id: string;
    /** Globally idempotent merge command identity. */
    readonly command_id: string;
    /** Child-side seal record identity. */
    readonly completed_record_id: RecordId;
    /** Selected-history occurrences integrated into the parent. */
    readonly contributions: readonly ScopeContribution[];
    /** Head of the child path after the seal. */
    readonly head: ScopeHeadAddress;
    /** Fixed child cut identity. */
    readonly merge_cut_id: string;
    /** Verified merged world content published into parent custody, or null for a trace-only child. */
    readonly merged_content_id: string | null;
    /** Head of the parent path after integration. */
    readonly parent_head: ScopeHeadAddress;
    /** Owning parent scope identity. */
    readonly parent_scope_id: string;
    /** Child-side merge reservation record identity. */
    readonly prepared_record_id: RecordId;
    /** Verified parent custody revision captured after publication, or null. */
    readonly publication_revision_id: string | null;
    /** Exact three-way world plan, or null for a trace-only child. */
    readonly world: ScopeMergeWorldPlan | null;
};

/** Durable result of one logical scope discard with its cleanup progress. */
export type ScopeDiscardReceipt = {
    /** Cleanup progress, separate from the logical decision. */
    readonly cleanup: {
        /** Cleanup record identity once complete, otherwise null. */
        readonly cleaned_record_id: RecordId | null;
        /** Proven-owned custody identities the discard removes. */
        readonly custody_ids: readonly string[];
        /** Latest retained cleanup phase: decided while pending, cleaned once complete. */
        readonly phase: ScopeDiscardPhase;
    };
    /** Globally idempotent discard command identity. */
    readonly command_id: string;
    /** Decision record identity on the discarded subtree root. */
    readonly decided_record_id: RecordId;
    /** Head of the discarded subtree root path after the decision. */
    readonly head: ScopeHeadAddress;
    /** Owning parent of the discarded subtree root. */
    readonly parent_scope_id: string;
    /** Discarded subtree root scope identity. */
    readonly scope_id: string;
    /** Every scope sealed by the decision, subtree root first. */
    readonly sealed_scope_ids: readonly string[];
};

/** Configured vocabulary term mapped onto scope evidence. */
export type ScopeVocabularyTerm = (typeof SCOPE_VOCABULARY_TERMS)[number];

/** Configured vocabulary mapping status: pending while a command is in flight, or completed. */
export type ScopeVocabularyStatus = (typeof SCOPE_VOCABULARY_STATUSES)[number];

/** One vocabulary term mapped onto exact retained scope command evidence. */
export type ScopeVocabularyEntry =
    | {
          /** Spawned child scope. */
          readonly child_scope_id: string;
          /** Child registration or fork command identity. */
          readonly command_id: string;
          /** Parent-owned child-registration record. */
          readonly record_id: RecordId;
          /** Pending while a reference-copy fork is incomplete, otherwise completed. */
          readonly status: ScopeVocabularyStatus;
          /** Spawn: child creation. */
          readonly term: (typeof SCOPE_VOCABULARY_TERMS)[0];
          /** World capability the child declared. */
          readonly world_capability: ScopeWorldCapability;
      }
    | {
          /** Adopted child scope. */
          readonly child_scope_id: string;
          /** Merge command identity. */
          readonly command_id: string;
          /** Parent integration when completed, or the child reservation while pending. */
          readonly record_id: RecordId;
          /** Pending while the merge is reserved, completed once integrated. */
          readonly status: ScopeVocabularyStatus;
          /** Adopt: selection of a verified child cut by consume-once merge. */
          readonly term: (typeof SCOPE_VOCABULARY_TERMS)[1];
      }
    | {
          /** Abandoned child scope. */
          readonly child_scope_id: string;
          /** Latest cleanup progress, separate from the abandonment itself. */
          readonly cleanup_phase: ScopeDiscardPhase;
          /** Discard command identity. */
          readonly command_id: string;
          /** Discard decision retained on the child path. */
          readonly record_id: RecordId;
          /** Always completed: the logical decision is retained. */
          readonly status: ScopeVocabularyStatus;
          /** Abandon: removal from effective selection by a logical discard decision. */
          readonly term: (typeof SCOPE_VOCABULARY_TERMS)[2];
      }
    | {
          /** Merge command that made the occurrence parent-visible. */
          readonly command_id: string;
          /** Exact published occurrence. */
          readonly contribution: ScopeContribution;
          /** Parent integration record carrying the contribution. */
          readonly record_id: RecordId;
          /** Always completed: the integration is retained. */
          readonly status: ScopeVocabularyStatus;
          /** Publish: parent-visible semantic data selected through a completed merge. */
          readonly term: (typeof SCOPE_VOCABULARY_TERMS)[3];
      };

/** Read-only vocabulary mapping of one scope's child lifecycle evidence. */
export type ScopeVocabularyProjection = {
    /** Mapped entries: path-ordered spawn, adopt, and publish, then per-child pending adopt and abandon. */
    readonly entries: readonly ScopeVocabularyEntry[];
    /** Projected parent scope identity. */
    readonly scope_id: string;
    /** Configured vocabulary projection version. */
    readonly vocabulary_version: number;
};

/** Configured restart-recovery classification of one live scope. */
export type ScopeRecoveryClassification = (typeof SCOPE_RECOVERY_CLASSIFICATIONS)[number];

/** Configured recovery action that resumes a scope. */
export type ScopeRecoveryResumeKind = (typeof SCOPE_RECOVERY_RESUME_KINDS)[number];

/** Closed options for classifying live scopes for recovery. */
export type InspectScopeRecoveryOptions = {
    /** Unix time used for deterministic writer lease evaluation; defaults to the current time. */
    readonly nowMilliseconds?: number;
};

/** Recovery classification of one live scope with its single recovery owner. */
export type ScopeRecoveryEntry = {
    /** Current writer claim evidence, or null when never claimed. */
    readonly claim: {
        /** Current claim identity. */
        readonly claim_id: string;
        /** Monotonic fencing token. */
        readonly fencing_token: number;
        /** Lease expiry in Unix milliseconds. */
        readonly lease_expires_at: number;
        /** Whether the holder released the claim. */
        readonly released: boolean;
    } | null;
    /** Configured classification in precedence order. */
    readonly classification: ScopeRecoveryClassification;
    /** Owning parent scope, or null for a root. */
    readonly parent_scope_id: string | null;
    /** Scope whose writer must resume the scope, or null when nothing needs resuming. */
    readonly recovery_owner_scope_id: string | null;
    /** Exact action and retained command identity to resume, or null. */
    readonly resume: {
        /** Retained command identity, or null when a new command must be issued. */
        readonly command_id: string | null;
        /** Configured resume action. */
        readonly kind: ScopeRecoveryResumeKind;
    } | null;
    /** Classified scope identity. */
    readonly scope_id: string;
    /** Branch-lifecycle state derived from retained evidence. */
    readonly state: ScopeState;
};

/** Record-derived recovery report over every live scope in one store. */
export type ScopeRecoveryReport = {
    /** Lease evaluation time in Unix milliseconds. */
    readonly evaluated_at: number;
    /** Every live scope in canonical scope-identity order. */
    readonly scopes: readonly ScopeRecoveryEntry[];
};

/** Configured branch start classification proven by a checkpoint. */
export type ScopeCheckpointStartClassification =
    (typeof SCOPE_CHECKPOINT_START_CLASSIFICATIONS)[number];

/** Evidence-derived classification of how a branch started and what it can restore. */
export type ScopeCheckpointClassification = {
    /** Constituent kinds that are not applicable to this branch. */
    readonly not_applicable: readonly ScopeCheckpointConstituentKind[];
    /** Constituent kinds reconstructed rather than captured. */
    readonly reconstructive: readonly ScopeCheckpointConstituentKind[];
    /** Whether every applicable constituent is verified, so the start state is fully restorable. */
    readonly restorable: boolean;
    /** Atomic snapshot, quiescent verified copy, or reconstructed start. */
    readonly start: ScopeCheckpointStartClassification;
    /** Unavailable constituents with their retained reasons. */
    readonly unavailable: readonly {
        /** Unavailable constituent kind. */
        readonly kind: ScopeCheckpointConstituentKind;
        /** Retained reason the constituent cannot be proven or restored. */
        readonly reason: string;
    }[];
    /** Constituent kinds proven by retained receipts. */
    readonly verified: readonly ScopeCheckpointConstituentKind[];
};
