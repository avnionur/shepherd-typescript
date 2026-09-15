import type { SemanticValue } from "../canonical/canonical-record.ts";
import type {
    DELEGATION_APPROVAL_VERDICTS,
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_DECISION_KINDS,
    DELEGATION_EXECUTION_KINDS,
    DELEGATION_PARENT_KINDS,
    DELEGATION_PROVENANCE_KINDS,
    DELEGATION_REVISION_FIELDS,
    DELEGATION_STATUSES,
    DELEGATION_TREE_ROOT_KINDS,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import type { DurableTaskExecutionInspection } from "../run/durable-execution-inspection-types.ts";
import type { RunTerminalStatus } from "../run/types.ts";
import type { ScopeAuthority, ScopeResourceGrantRequest } from "../scope/types.ts";
import type { CutId } from "../store/types.ts";
import type { OpenTraceSubscriptionOptions } from "../supervision/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor, TaskValue } from "../task/types.ts";

declare const childRunHandleContract: unique symbol;

/** Configured parent kind of one child run handle: a root declaration or a parent handle. */
export type ChildRunParentKind = (typeof DELEGATION_PARENT_KINDS)[number];

/** Configured way one child run was serviced: a caller-bound provider or a caller program. */
export type ChildRunExecutionKind = (typeof DELEGATION_EXECUTION_KINDS)[number];

/** Configured provenance kind of the task value a handle executes. */
export type ChildRunProvenanceKind = (typeof DELEGATION_PROVENANCE_KINDS)[number];

/** Configured derived status of one child run handle. */
export type ChildRunStatus = (typeof DELEGATION_STATUSES)[number];

/** Configured task field a revision may change. */
export type ChildRunRevisionField = (typeof DELEGATION_REVISION_FIELDS)[number];

/** Configured approval verdict for a revised or synthesized task value. */
export type ChildRunApprovalVerdict = (typeof DELEGATION_APPROVAL_VERDICTS)[number];

/** Configured terminal decision kind. */
export type ChildRunDecisionKind = (typeof DELEGATION_DECISION_KINDS)[number];

/** Configured context record phase: an injection or the consumption record. */
export type ChildRunContextPhase = (typeof DELEGATION_CONTEXT_PHASES)[number];

/** Configured root kind of a delegation tree projection: a parent handle or a supervisor. */
export type DelegationTreeRootKind = (typeof DELEGATION_TREE_ROOT_KINDS)[number];

/** Retained declared provenance: a package-created descriptor or a caller-asserted value. */
export type ChildRunDeclaredProvenance = {
    /** Declared provenance kind. */
    readonly kind: (typeof DELEGATION_PROVENANCE_KINDS)[0];
};

/** Retained revised provenance: the source task value and the fields the revision changed. */
export type ChildRunRevisedProvenance = {
    /** Revision fields that differ from the source, in configured order. */
    readonly fields: readonly ChildRunRevisionField[];
    /** Revised provenance kind. */
    readonly kind: (typeof DELEGATION_PROVENANCE_KINDS)[1];
    /** Source task value the revision was derived from; it shares the task identity. */
    readonly source_task: TaskValue;
};

/** Retained synthesized provenance: the retained record of the run that produced the value. */
export type ChildRunSynthesizedProvenance = {
    /** Synthesized provenance kind. */
    readonly kind: (typeof DELEGATION_PROVENANCE_KINDS)[2];
    /** Retained record that produced the task value. */
    readonly source_record_id: RecordId;
    /** Owner path of the producing run. */
    readonly source_run_id: string;
};

/** Retained provenance of a handle's task value. */
export type ChildRunProvenance =
    | ChildRunDeclaredProvenance
    | ChildRunRevisedProvenance
    | ChildRunSynthesizedProvenance;

/** Provenance a caller states when opening or retrying a handle. */
export type ChildRunProvenanceDeclaration =
    | ChildRunDeclaredProvenance
    | {
          /** Revision fields that differ from the source; must list exactly the differing fields. */
          readonly changes: readonly ChildRunRevisionField[];
          /** Revised provenance kind. */
          readonly kind: (typeof DELEGATION_PROVENANCE_KINDS)[1];
          /** Source task value; the revised task keeps its task identity. */
          readonly source: TaskValue;
      }
    | {
          /** Synthesized provenance kind. */
          readonly kind: (typeof DELEGATION_PROVENANCE_KINDS)[2];
          /** Retained record of the run that produced the task value. */
          readonly producer: {
              /** Record retained on the producing run's owner path. */
              readonly record_id: RecordId;
              /** Owner path of the producing run. */
              readonly run_id: string;
          };
      };

/** Budget authority retained by a handle: the parent's declared ceiling and the child's budget. */
export type ChildRunBudgetAuthority = {
    /** Budget declared by the root declaration or the parent handle. */
    readonly ceiling: RunBudgetDefinition;
    /** Child budget; every ceiling metric is declared with a value no greater than the ceiling. */
    readonly effective: RunBudgetDefinition;
};

/** Root parent declaration: the whole-tree resource ceiling and budget ceiling. */
export type ChildRunRootParent = {
    /** Budget ceiling for the handle and every descendant. */
    readonly budget: RunBudgetDefinition;
    /** Resource ceiling for the handle and every descendant. */
    readonly ceiling: ScopeResourceGrantRequest;
    /** Root parent kind. */
    readonly kind: (typeof DELEGATION_PARENT_KINDS)[0];
};

/** Retained root parent evidence. */
export type ChildRunRootParentInspection = {
    /** Root parent kind. */
    readonly kind: (typeof DELEGATION_PARENT_KINDS)[0];
};

/** Retained parent handle evidence with the origin cut through the parent head. */
export type ChildRunHandleParentInspection = {
    /** Parent handle identity. */
    readonly handle_id: string;
    /** Handle parent kind. */
    readonly kind: (typeof DELEGATION_PARENT_KINDS)[1];
    /** Immutable cut through the parent handle head at opening. */
    readonly origin_cut_id: CutId;
    /** Parent handle head fixed as this handle's origin. */
    readonly origin_record_id: RecordId;
};

/** Retained parent evidence of one handle. */
export type ChildRunParentInspection =
    | ChildRunHandleParentInspection
    | ChildRunRootParentInspection;

/** Retained predecessor evidence of a retry: the causal replay point. */
export type ChildRunPredecessorInspection = {
    /** Immutable cut through the predecessor handle head, published by the successor. */
    readonly cut_id: CutId;
    /** Discard decision record the retry cites. */
    readonly decision_record_id: RecordId;
    /** Discarded predecessor handle. */
    readonly handle_id: string;
};

/**
 * Package-authenticated child run handle.
 *
 * A handle names one delegated execution of one task value under one supervisor. Only handles
 * minted by {@link openChildRun} or {@link retryChildRun} in the same store are accepted as
 * parents or command targets; forged, copied, or foreign-store objects are refused.
 */
export type ChildRunHandle = {
    /** Retained ceiling and effective resource authority. */
    readonly authority: ScopeAuthority;
    /** Retained budget ceiling and child budget. */
    readonly budget: ChildRunBudgetAuthority;
    /** Derived durable run identity of the child execution. */
    readonly child_run_id: string;
    /** Nesting depth below the root declaration; the first handle is depth one. */
    readonly depth: number;
    /** Handle identity and reserved owner path. */
    readonly handle_id: string;
    /** Retained opened record identity. */
    readonly opened_record_id: RecordId;
    /** Supervisor that opened the handle; the current owner is `inspectChildRun(...).supervisor_id`. */
    readonly supervisor_id: string;
    /** Compile-time marker for package-minted handles. */
    readonly [childRunHandleContract]?: true;
};

/** Closed options for {@link openChildRun}. */
export type OpenChildRunOptions = {
    /** Child budget; every metric the parent declares must be declared no greater. */
    readonly budget: RunBudgetDefinition;
    /** Optional clock for deterministic tests; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent opening command identity. */
    readonly commandId: string;
    /** Requested resource grant attenuated by the ceiling and the parent's effective authority. */
    readonly grant: ScopeResourceGrantRequest;
    /** Child input validated against the task input schema. */
    readonly input: unknown;
    /** Root declaration, or the authenticated parent handle. */
    readonly parent: ChildRunHandle | ChildRunRootParent;
    /**
     * Provenance of the task value. Defaults to `declared` for a package-created descriptor; a
     * task value must state its provenance explicitly.
     */
    readonly provenance?: ChildRunProvenanceDeclaration;
    /** Supervisor identity retained on the handle. */
    readonly supervisorId: string;
    /** Package-created descriptor or canonical task value to execute. */
    readonly task: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>> | TaskValue;
};

/** Closed options for {@link retryChildRun}. */
export type RetryChildRunOptions = {
    /** Successor budget; defaults to the predecessor's child budget. */
    readonly budget?: RunBudgetDefinition;
    /** Globally idempotent opening command identity of the successor. */
    readonly commandId: string;
    /** Successor grant; defaults to the predecessor's grant. */
    readonly grant?: ScopeResourceGrantRequest;
    /** Authenticated discarded predecessor handle. */
    readonly handle: ChildRunHandle;
    /** Successor input; defaults to the predecessor's validated input. */
    readonly input?: unknown;
    /**
     * Provenance of a supplied task value. Defaults to `declared` for a package-created
     * descriptor and to the predecessor's retained provenance when `task` is omitted.
     */
    readonly provenance?: ChildRunProvenanceDeclaration;
    /** Current supervisor of the predecessor. */
    readonly supervisorId: string;
    /** Same or revised task; defaults to the predecessor's task value. */
    readonly task?: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>> | TaskValue;
};

/** Retained completion evidence of one handle. */
export type ChildRunCompletionInspection = {
    /** Published terminal cut of the child run. */
    readonly child_cut_id: CutId;
    /** Terminal lifecycle record of the child run. */
    readonly child_terminal_record_id: RecordId;
    /** How the child was serviced. */
    readonly execution_kind: ChildRunExecutionKind;
    /** Completion record identity. */
    readonly record_id: RecordId;
    /** Terminal status of the child outcome. */
    readonly status: RunTerminalStatus;
    /** Supervisor named by the completion. */
    readonly supervisor_id: string;
};

/** One retained context injection. */
export type ChildRunInjectionInspection = {
    /** Retained records the injection cites; each is a causal parent of the record. */
    readonly cited_record_ids: readonly RecordId[];
    /** Injection command identity. */
    readonly command_id: string;
    /** Whether a later consumption record folded this injection into the child's request. */
    readonly consumed: boolean;
    /** Canonical application data. */
    readonly data: RecordBody;
    /** Injection record identity. */
    readonly record_id: RecordId;
    /** Supervisor that injected the context. */
    readonly supervisor_id: string;
};

/** Retained consumption evidence: the injections folded into the composed provider request. */
export type ChildRunConsumedContextInspection = {
    /** Injection records consumed, in owner order. */
    readonly consumed_record_ids: readonly RecordId[];
    /** Consumption record identity. */
    readonly record_id: RecordId;
    /** Canonical digest of the composed provider request the child saw. */
    readonly request_digest: string;
    /** Supervisor that owned the handle when the child started. */
    readonly supervisor_id: string;
};

/** One entry of the supervisor context folded into a child's composed request. */
export type ChildRunSupervisorContextEntry = {
    /** Records the injection cited. */
    readonly cited_record_ids: readonly RecordId[];
    /** Canonical injected data. */
    readonly data: RecordBody;
    /** Injection record identity. */
    readonly record_id: RecordId;
};

/** Retained handoff evidence. */
export type ChildRunHandoffInspection = {
    /** Handoff command identity. */
    readonly command_id: string;
    /** Retained reason, or null. */
    readonly reason: string | null;
    /** Handoff record identity. */
    readonly record_id: RecordId;
    /** Supervisor that received ownership. */
    readonly successor_id: string;
    /** Supervisor that transferred ownership. */
    readonly supervisor_id: string;
};

/** Retained approval evidence for a revised or synthesized task value. */
export type ChildRunApprovalInspection = {
    /** Approver identity. */
    readonly approver_id: string;
    /** Approval command identity. */
    readonly command_id: string;
    /** Retained reason, or null. */
    readonly reason: string | null;
    /** Approval record identity. */
    readonly record_id: RecordId;
    /** Supervisor that owned the handle at approval. */
    readonly supervisor_id: string;
    /** Digest of the approved task artifact. */
    readonly task_artifact_digest: string;
    /** Retained verdict. */
    readonly verdict: ChildRunApprovalVerdict;
};

/** Retained terminal decision evidence. */
export type ChildRunDecisionInspection = {
    /** Child outcome record cited by an accept, otherwise null. */
    readonly child_outcome_record_id: RecordId | null;
    /** Decision command identity. */
    readonly command_id: string;
    /** Decision kind. */
    readonly kind: ChildRunDecisionKind;
    /** Digest of the canonical accepted output value, otherwise null. */
    readonly output_id: string | null;
    /** Retained discard reason, otherwise null. */
    readonly reason: string | null;
    /** Decision record identity. */
    readonly record_id: RecordId;
    /** Supervisor that decided. */
    readonly supervisor_id: string;
};

/** Immutable record-derived view of one child run handle. */
export type ChildRunInspection = {
    /** Retained approval, or null. */
    readonly approval: ChildRunApprovalInspection | null;
    /** Retained ceiling and effective resource authority, re-derived and verified. */
    readonly authority: ScopeAuthority;
    /** Retained budget ceiling and child budget, verified against the parent. */
    readonly budget: ChildRunBudgetAuthority;
    /** Durable inspection of the child run, or null before any child record. */
    readonly child: DurableTaskExecutionInspection | null;
    /** Derived durable run identity of the child execution. */
    readonly child_run_id: string;
    /** Opening command identity. */
    readonly command_id: string;
    /** Retained completion, or null. */
    readonly completion: ChildRunCompletionInspection | null;
    /** Retained consumption record, or null. */
    readonly consumed_context: ChildRunConsumedContextInspection | null;
    /** Retained terminal decision, or null. */
    readonly decision: ChildRunDecisionInspection | null;
    /** Nesting depth below the root declaration. */
    readonly depth: number;
    /** Requested resource grant. */
    readonly grant: ScopeResourceGrantRequest;
    /** Handle identity and owner path. */
    readonly handle_id: string;
    /** Retained handoffs in owner order. */
    readonly handoffs: readonly ChildRunHandoffInspection[];
    /** Current handle head. */
    readonly head_record_id: RecordId;
    /** Retained injections in owner order. */
    readonly injections: readonly ChildRunInjectionInspection[];
    /** Validated child input. */
    readonly input: SemanticValue;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Supervisor that opened the handle. */
    readonly opened_supervisor_id: string;
    /** Retained parent evidence. */
    readonly parent: ChildRunParentInspection;
    /** Retained discarded predecessor of a retry, or null. */
    readonly predecessor: ChildRunPredecessorInspection | null;
    /** Retained task provenance. */
    readonly provenance: ChildRunProvenance;
    /** Derived handle status. */
    readonly status: ChildRunStatus;
    /** Current supervisor after every retained handoff. */
    readonly supervisor_id: string;
    /** Retained task value. */
    readonly task: TaskValue;
};

/** Result of {@link openChildRun} and {@link retryChildRun}. */
export type ChildRunReceipt = {
    /** Authenticated handle for later commands. */
    readonly handle: ChildRunHandle;
    /** Validated inspection after opening. */
    readonly inspection: ChildRunInspection;
};

/** Result of a handle command that retained or replayed one record. */
export type ChildRunCommandReceipt = {
    /** Handle the command addressed. */
    readonly handle: ChildRunHandle;
    /** Validated inspection after the command. */
    readonly inspection: ChildRunInspection;
    /** Retained command record identity. */
    readonly record_id: RecordId;
};

/** Context a program-serviced child receives. */
export type ChildRunProgramContext = {
    /** Delegated resource authority; grandchildren may be opened only under `effective`. */
    readonly authority: ScopeAuthority;
    /** Child budget enforced by the durable execution. */
    readonly budget: RunBudgetDefinition;
    /** Authenticated handle of the child being serviced. */
    readonly handle: ChildRunHandle;
    /** Validated canonical child input. */
    readonly input: SemanticValue;
    /** Cooperative cancellation composed from the child budget and control. */
    readonly signal: AbortSignal;
    /** Supervisor context consumed before the child started, in owner order. */
    readonly supervisor_context: readonly ChildRunSupervisorContextEntry[];
    /** Rehydrated task descriptor. */
    readonly task: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>>;
};

/**
 * Caller program that services one child run under its durable claim.
 *
 * The returned value is validated against the task output schema; an invalid output or a thrown
 * error fails the child.
 *
 * @param context - Handle, authority, budget, input, supervisor context, signal, and task.
 * @returns The child output.
 */
export type ChildRunProgram = (context: ChildRunProgramContext) => Promise<unknown> | unknown;

/** Closed options for {@link runChildRun}. */
export type RunChildRunOptions =
    | {
          /** Optional clock for deterministic tests; defaults to `Date.now`. */
          readonly clock?: () => number;
          /** Authenticated handle to run. */
          readonly handle: ChildRunHandle;
          /** Caller program servicing the child. */
          readonly program: ChildRunProgram;
      }
    | {
          /** Optional clock for deterministic tests; defaults to `Date.now`. */
          readonly clock?: () => number;
          /** Authenticated handle to run. */
          readonly handle: ChildRunHandle;
          /** Caller-bound provider servicing the child. */
          readonly provider: ModelProvider;
      };

/** Options for {@link inspectChildRun}. */
export type InspectChildRunOptions = {
    /** Optional clock for deterministic tests; defaults to `Date.now`. */
    readonly clock?: () => number;
};

/** Closed options for {@link observeChildRun}. */
export type ObserveChildRunOptions = Omit<OpenTraceSubscriptionOptions, "owners"> &
    (
        | {
              /** Authenticated handle to observe. */
              readonly handle: ChildRunHandle;
          }
        | {
              /** Handle identity to observe; the handle need not be retained yet. */
              readonly handleId: string;
          }
    );

/** Closed options for {@link injectChildRunContext}. */
export type InjectChildRunContextOptions = {
    /** At least one retained record cited as causal parents. */
    readonly citedRecordIds: readonly RecordId[];
    /** Globally idempotent injection command identity. */
    readonly commandId: string;
    /** Canonical application data. */
    readonly data: RecordBody;
    /** Exact handle head the command expects; defaults to the current head. */
    readonly expectedHeadRecordId?: RecordId;
    /** Authenticated handle. */
    readonly handle: ChildRunHandle;
    /** Current supervisor. */
    readonly supervisorId: string;
};

/** Closed options for {@link handoffChildRun}. */
export type HandoffChildRunOptions = {
    /** Globally idempotent handoff command identity. */
    readonly commandId: string;
    /** Exact handle head the command expects; defaults to the current head. */
    readonly expectedHeadRecordId?: RecordId;
    /** Authenticated handle. */
    readonly handle: ChildRunHandle;
    /** Optional retained reason. */
    readonly reason?: string;
    /** Supervisor receiving ownership. */
    readonly successorSupervisorId: string;
    /** Current supervisor transferring ownership. */
    readonly supervisorId: string;
};

/** Closed options for {@link discardChildRun}. */
export type DiscardChildRunOptions = {
    /** Globally idempotent decision command identity. */
    readonly commandId: string;
    /** Exact handle head the command expects; defaults to the current head. */
    readonly expectedHeadRecordId?: RecordId;
    /** Authenticated handle. */
    readonly handle: ChildRunHandle;
    /** Retained discard reason. */
    readonly reason: string;
    /** Current supervisor. */
    readonly supervisorId: string;
};

/** Closed options for {@link acceptChildRunResult}. */
export type AcceptChildRunResultOptions = {
    /** Globally idempotent decision command identity. */
    readonly commandId: string;
    /** Exact handle head the command expects; defaults to the current head. */
    readonly expectedHeadRecordId?: RecordId;
    /** Authenticated handle. */
    readonly handle: ChildRunHandle;
    /** Current supervisor. */
    readonly supervisorId: string;
};

/** Closed options for {@link projectChildRunResult}. */
export type ProjectChildRunResultOptions<T> = {
    /**
     * Caller schema proving the projected value type. Its document must canonically equal the
     * retained task value's output schema; a mismatch is refused before any value is returned.
     */
    readonly schema?: TaskSchema<T>;
};

/**
 * Typed projection of one handle's retained result.
 *
 * `value` and `output_id` are non-null only for an `accepted` handle, where the retained child
 * outcome has been re-validated against the retained task value's output schema and its digest
 * equals the accept decision's `output_id`.
 */
export type ChildRunResultProjection<T = SemanticValue> = {
    /** Child outcome record the accept decision cites, otherwise null. */
    readonly child_outcome_record_id: RecordId | null;
    /** Derived durable run identity of the child execution. */
    readonly child_run_id: string;
    /** Retained terminal decision record, otherwise null. */
    readonly decision_record_id: RecordId | null;
    /** Handle identity and owner path. */
    readonly handle_id: string;
    /** Digest of the canonical accepted output value, otherwise null. */
    readonly output_id: string | null;
    /** Derived handle status. */
    readonly status: ChildRunStatus;
    /** Retained task value whose output schema typed the value. */
    readonly task: TaskValue;
    /** Validated canonical accepted output, otherwise null. */
    readonly value: T | null;
};

/** Root of a delegation tree projection. */
export type DelegationTreeRoot =
    | {
          /** Parent handle whose direct children are projected. */
          readonly handleId: string;
          /** Handle root kind. */
          readonly kind: (typeof DELEGATION_TREE_ROOT_KINDS)[0];
      }
    | {
          /** Supervisor root kind. */
          readonly kind: (typeof DELEGATION_TREE_ROOT_KINDS)[1];
          /** Supervisor whose root-parent handles are projected. */
          readonly supervisorId: string;
      };

/** One direct handle of a delegation tree projection. */
export type DelegationTreeEntry = {
    /** Retained ceiling and effective resource authority. */
    readonly authority: ScopeAuthority;
    /** Retained budget ceiling and child budget. */
    readonly budget: ChildRunBudgetAuthority;
    /** Derived durable run identity of the child execution. */
    readonly child_run_id: string;
    /** Nesting depth below the root declaration. */
    readonly depth: number;
    /** Handle identity and owner path. */
    readonly handle_id: string;
    /** Retained result: the accepted value, or null for every other status. */
    readonly result: ChildRunResultProjection;
    /** Derived handle status. */
    readonly status: ChildRunStatus;
    /** Current supervisor after every retained handoff. */
    readonly supervisor_id: string;
    /** Retained task value. */
    readonly task: TaskValue;
};

/**
 * Direct handles under one root in canonical handle-identity order.
 *
 * Grandchildren are never listed: a parent's accepted value is the only thing a grandchild
 * contributes upward.
 */
export type DelegationTreeProjection = {
    /** Direct handles in canonical handle-identity order, bounded by `limits.maxTreeEntries`. */
    readonly entries: readonly DelegationTreeEntry[];
    /** Validated root the projection was taken from. */
    readonly root: DelegationTreeRoot;
};

/** Closed options for {@link approveChildRunTask}. */
export type ApproveChildRunTaskOptions = {
    /** Approver identity retained on the record; defaults to the supervisor. */
    readonly approverId?: string;
    /** Globally idempotent approval command identity. */
    readonly commandId: string;
    /** Exact handle head the command expects; defaults to the current head. */
    readonly expectedHeadRecordId?: RecordId;
    /** Authenticated handle. */
    readonly handle: ChildRunHandle;
    /** Optional retained reason. */
    readonly reason?: string;
    /** Current supervisor. */
    readonly supervisorId: string;
    /** Approve or reject the task value. */
    readonly verdict: ChildRunApprovalVerdict;
};
