import type { SemanticValue } from "../canonical/canonical-record.ts";
import type {
    ChildRunInspection,
    ChildRunProgramContext,
    ChildRunProvenanceDeclaration,
    ChildRunRootParent,
    ChildRunStatus,
} from "../delegation/types.ts";
import type {
    APPLICATION_SUPERVISION_CONFLICT_KINDS,
    APPLICATION_SUPERVISION_PHASES,
    APPLICATION_SUPERVISION_POLICY_KINDS,
    APPLICATION_SUPERVISION_WORKER_STATUSES,
} from "../protocol/values.generated.ts";
import type { ModelProvider } from "../provider/types.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import type { RunTerminalStatus } from "../run/types.ts";
import type { ScopeResourceGrantRequest } from "../scope/types.ts";
import type { CutId } from "../store/types.ts";
import type { TraceSubscriptionCursor } from "../supervision/types.ts";
import type { TaskSchema } from "../task/schema.ts";
import type { TaskDescriptor, TaskValue } from "../task/types.ts";
import type {
    ApplicationKind,
    ApplicationManifest,
    ApplicationProtocolDefinition,
    ApplicationWorldAdapter,
    ApplicationWorldCustody,
} from "./types.ts";

/** Configured supervision record phase: the opened record or a per-round decision record. */
export type CodingSupervisorPhase = (typeof APPLICATION_SUPERVISION_PHASES)[number];

/** Configured policy decision kind. */
export type CodingSupervisorPolicyKind = (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[number];

/** Configured conflict classification of the workers' changed paths. */
export type CodingSupervisorConflictKind = (typeof APPLICATION_SUPERVISION_CONFLICT_KINDS)[number];

/** Configured lineage status of one worker attempt. */
export type CodingSupervisorWorkerStatus = (typeof APPLICATION_SUPERVISION_WORKER_STATUSES)[number];

/** Context a program-serviced worker receives in addition to the child run program context. */
export type CodingSupervisorWorkerContext = ChildRunProgramContext & {
    /** Attempt number of the worker lineage; the first handle is attempt one. */
    readonly attempt: number;
    /** Isolated custody the attempt edits, or null on the trace-only path. */
    readonly custody: ApplicationWorldCustody | null;
    /** Protocol seeds in declared order. */
    readonly seeds: readonly number[];
    /** Worker identity. */
    readonly workerId: string;
};

/**
 * Caller program that services one worker attempt under its child run's durable claim.
 *
 * The returned value is validated against the task output schema; an invalid output or a thrown
 * error fails the attempt.
 *
 * @param context - Child run program context plus attempt, custody, seeds, and worker identity.
 * @returns The worker output.
 */
export type CodingSupervisorWorkerProgram = (
    context: CodingSupervisorWorkerContext,
) => Promise<unknown> | unknown;

/** One supervised worker: a child run definition serviced by a program or a provider. */
export type CodingSupervisorWorkerDefinition = {
    /** Child budget; every metric the protocol bounds must be declared no greater. */
    readonly budget: RunBudgetDefinition;
    /** Requested resource grant attenuated by the root ceiling. */
    readonly grant: ScopeResourceGrantRequest;
    /** Child input validated against the task input schema. */
    readonly input: unknown;
    /** Caller program servicing every attempt; exactly one of `program` or `provider`. */
    readonly program?: CodingSupervisorWorkerProgram;
    /** Provenance of a supplied task value; a descriptor defaults to `declared`. */
    readonly provenance?: ChildRunProvenanceDeclaration;
    /** Caller-bound provider servicing every attempt; exactly one of `program` or `provider`. */
    readonly provider?: ModelProvider;
    /** Package-created descriptor or canonical task value the worker executes. */
    readonly task: TaskDescriptor<TaskSchema<unknown>, TaskSchema<unknown>> | TaskValue;
    /** Stable worker identity, unique within the run. */
    readonly workerId: string;
};

/** Record-derived observation of one worker attempt at the start of a round. */
export type CodingSupervisorObservation = {
    /** Attempt number of the worker lineage. */
    readonly attempt: number;
    /** Distinct changed paths of the attempt's custody or declared output. */
    readonly changed_paths: readonly string[];
    /** Derived durable run identity of the attempt. */
    readonly child_run_id: string;
    /** Retained completion status, or null before completion. */
    readonly completion_status: RunTerminalStatus | null;
    /** Custody the attempt edits, or null on the trace-only path. */
    readonly custody_id: string | null;
    /** Subscription cursor after every retained handle and child run record was delivered. */
    readonly delivered_cursor: TraceSubscriptionCursor;
    /** Handle identity of the attempt. */
    readonly handle_id: string;
    /** Handle head at observation. */
    readonly head_record_id: RecordId;
    /** Derived handle status. */
    readonly status: ChildRunStatus;
    /** Supervisor currently owning the handle. */
    readonly supervisor_id: string;
    /** Worker identity. */
    readonly worker_id: string;
    /** Lineage status derived from the handle and the application's supervisor. */
    readonly worker_status: CodingSupervisorWorkerStatus;
};

/** Conflict classification over the live workers' changed paths. */
export type CodingSupervisorConflict = {
    /** Configured classification. */
    readonly kind: CodingSupervisorConflictKind;
    /** Sorted distinct paths changed by more than one worker. */
    readonly paths: readonly string[];
    /** Sorted workers that changed an overlapping path. */
    readonly worker_ids: readonly string[];
};

/**
 * Decision a policy returns for one round, retained verbatim in the round's supervision record.
 */
export type CodingSupervisorDecision =
    | {
          /** No intervention; every ready worker runs. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[0];
      }
    | {
          /** Retained records the injection cites; each becomes a causal parent. */
          readonly cited_record_ids: readonly RecordId[];
          /** Canonical application data injected before the worker starts. */
          readonly data: RecordBody;
          /** Inject kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[1];
          /** Worker to inject into. */
          readonly worker_id: string;
      }
    | {
          /** Handoff kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[2];
          /** Retained reason, or null. */
          readonly reason: string | null;
          /** Supervisor receiving ownership of the worker's handle. */
          readonly successor_supervisor_id: string;
          /** Worker to hand off. */
          readonly worker_id: string;
      }
    | {
          /** Discard and restart kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[3];
          /** Retained discard reason. */
          readonly reason: string;
          /** Worker whose attempt is discarded and restarted from clean custody. */
          readonly worker_id: string;
      }
    | {
          /** Accept kind; terminal for the run. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[4];
          /** Finished worker whose result is accepted and merged. */
          readonly worker_id: string;
      };

/** One worker discarded by the terminal accept decision. */
export type CodingSupervisorDiscardedWorker = {
    /** Discard decision record on the worker's handle. */
    readonly decision_record_id: RecordId;
    /** World discard receipt identity, or null on the trace-only path. */
    readonly discard_receipt_id: string | null;
    /** Discarded worker. */
    readonly worker_id: string;
};

/** Exact evidence produced by applying one decision. */
export type CodingSupervisorEvidence =
    | {
          /** Observe kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[0];
      }
    | {
          /** Injection record retained on the worker's handle. */
          readonly injection_record_id: RecordId;
          /** Inject kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[1];
      }
    | {
          /** Handoff record retained on the worker's handle. */
          readonly handoff_record_id: RecordId;
          /** Handoff kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[2];
      }
    | {
          /** Discard decision record on the predecessor handle. */
          readonly decision_record_id: RecordId;
          /** World discard receipt identity, or null on the trace-only path. */
          readonly discard_receipt_id: string | null;
          /** Clean world fork receipt identity, or null on the trace-only path. */
          readonly fork_receipt_id: string | null;
          /** Discard and restart kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[3];
          /** Retry cut published through the predecessor head. */
          readonly retry_cut_id: string;
          /** Successor handle opened by the retry. */
          readonly successor_handle_id: string;
      }
    | {
          /** Accept decision record on the accepted handle. */
          readonly decision_record_id: RecordId;
          /** Every other worker, discarded. */
          readonly discarded: readonly CodingSupervisorDiscardedWorker[];
          /** Accept kind. */
          readonly kind: (typeof APPLICATION_SUPERVISION_POLICY_KINDS)[4];
          /** World merge receipt identity, or null on the trace-only path. */
          readonly merge_receipt_id: string | null;
      };

/** Context a policy receives for one round. */
export type CodingSupervisorPolicyContext = {
    /** Conflict classification over the observations. */
    readonly conflict: CodingSupervisorConflict;
    /** Observation of every live worker attempt in worker order. */
    readonly observations: readonly CodingSupervisorObservation[];
    /** Validated protocol the run executes. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Round number, starting at one. */
    readonly round: number;
    /** Supervisor the application commands are issued as. */
    readonly supervisorId: string;
};

/**
 * Caller decision function returning the configured policy to apply to the observed workers.
 *
 * @param context - Round, observations, conflict, protocol, and supervisor.
 * @returns Exactly one decision.
 */
export type CodingSupervisorPolicy = (
    context: CodingSupervisorPolicyContext,
) => CodingSupervisorDecision | Promise<CodingSupervisorDecision>;

/** Context a trace-only changed-path reader receives. */
export type CodingSupervisorChangedPathsContext = {
    /** Validated finished worker output. */
    readonly output: SemanticValue;
    /** Worker identity. */
    readonly workerId: string;
};

/**
 * Caller reader returning the declared changed paths of one finished worker output on the
 * trace-only path.
 *
 * @param context - Worker identity and validated output.
 * @returns Changed paths declared by the output.
 */
export type CodingSupervisorChangedPathsReader = (
    context: CodingSupervisorChangedPathsContext,
) => readonly string[];

/** Closed options for {@link runCodingSupervisor}. */
export type RunCodingSupervisorOptions = {
    /** Trace-only changed-path reader; exactly one of `changedPaths` or `world`. */
    readonly changedPaths?: CodingSupervisorChangedPathsReader;
    /** Optional clock for deterministic world requests; defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Globally idempotent application command identity. */
    readonly commandId: string;
    /** Root declaration bounding every worker's grant and budget. */
    readonly parent: ChildRunRootParent;
    /** Policy consulted once per round. */
    readonly policy: CodingSupervisorPolicy;
    /** Appendix E protocol definition; validated before any record. */
    readonly protocol: ApplicationProtocolDefinition;
    /** Supervisor the application commands are issued as. */
    readonly supervisorId: string;
    /** Workers, bounded by the configured minimum and `limits.maxWorkers`. */
    readonly workers: readonly CodingSupervisorWorkerDefinition[];
    /** World adapter supplying isolated custody; exactly one of `changedPaths` or `world`. */
    readonly world?: ApplicationWorldAdapter;
};

/** One retained decision round. */
export type CodingSupervisorDecisionInspection = {
    /** Retained conflict classification. */
    readonly conflict: CodingSupervisorConflict;
    /** Retained decision. */
    readonly decision: CodingSupervisorDecision;
    /** Retained evidence the decision produced. */
    readonly evidence: CodingSupervisorEvidence;
    /** Retained observations. */
    readonly observations: readonly CodingSupervisorObservation[];
    /** Decision record identity. */
    readonly record_id: RecordId;
    /** Round number. */
    readonly round: number;
    /** Supervisor that decided. */
    readonly supervisor_id: string;
};

/** One attempt of a worker lineage. */
export type CodingSupervisorAttemptInspection = {
    /** Attempt number. */
    readonly attempt: number;
    /** Handle identity. */
    readonly handle_id: string;
    /** Record-derived handle inspection. */
    readonly inspection: ChildRunInspection;
    /** Lineage status of the attempt. */
    readonly status: CodingSupervisorWorkerStatus;
};

/** One supervised worker lineage. */
export type CodingSupervisorWorkerInspection = {
    /** Attempts in order; the first handle is attempt one. */
    readonly attempts: readonly CodingSupervisorAttemptInspection[];
    /** Worker identity. */
    readonly worker_id: string;
};

/** Immutable record-derived view of one coding supervisor run. */
export type CodingSupervisorInspection = {
    /** Application identity and owner path. */
    readonly application_id: string;
    /** Application command identity. */
    readonly command_id: string;
    /** Terminal cut once the manifest is retained, otherwise null. */
    readonly cut_id: CutId | null;
    /** Retained decision rounds in order. */
    readonly decisions: readonly CodingSupervisorDecisionInspection[];
    /** Application kind. */
    readonly kind: ApplicationKind;
    /** Retained manifest, or null while the run is open. */
    readonly manifest: ApplicationManifest | null;
    /** Manifest record identity, or null while the run is open. */
    readonly manifest_record_id: RecordId | null;
    /** Opened record identity. */
    readonly opened_record_id: RecordId;
    /** Protocol definition identity. */
    readonly protocol_id: string;
    /** Supervisor the application commands were issued as. */
    readonly supervisor_id: string;
    /** Worker lineages in declared order. */
    readonly workers: readonly CodingSupervisorWorkerInspection[];
    /** Whether workers edited isolated world custody. */
    readonly world: boolean;
};

/** Result of {@link runCodingSupervisor}. */
export type CodingSupervisorReceipt = {
    /** Record-derived inspection after the manifest was retained. */
    readonly inspection: CodingSupervisorInspection;
    /** Retained manifest. */
    readonly manifest: ApplicationManifest;
};
