import type { SemanticValue } from "../canonical/canonical-record.ts";
import { formalContentRef } from "../formal/content-ref.ts";
import {
    createRuntimeInspectionEnvelope,
    withEnvelopeMetadata,
    withPublicationControls,
} from "../formal/inspection-envelope.ts";
import { classifyProofEnvelope } from "../formal/proof-envelope.ts";
import type { ProofEnvelope } from "../formal/types.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";
import type { ReplaySessionInspection, ReplayStepInspection } from "./types.ts";

const { inspection, proofEnvelope, referenceMachine } = formalAssuranceProtocolConfig;
const { lowering } = inspection;
const recordTypes = referenceMachine.recordTypes;
const [RETURN_ACTION] = referenceMachine.actionKinds;
const [COMPLETED_DISPOSITION] = referenceMachine.continuationDispositions;

/**
 * Classifies the proof envelope of one validated replay session.
 *
 * Root sessions default to `runtime_only`. Branch sessions (the configured rewind and replay
 * publication controls) classify as `extension`. With `lower`, an eligible static session (every
 * configured eligibility rule holds) is lowered into Core-A reference records and classified by
 * the executable reference machine; an ineligible session keeps its envelope and reports why.
 *
 * @param session - Validated replay session inspection without its proof envelope.
 * @param lower - Whether to attempt Core-A lowering.
 * @returns A frozen proof envelope.
 * @internal
 */
export function classifyReplaySessionProof(
    session: Omit<ReplaySessionInspection, "proof">,
    lower: boolean,
): ProofEnvelope {
    const control = inspection.publicationControls.replayModes[session.mode];
    const base = withPublicationControls(
        createRuntimeInspectionEnvelope([]),
        control === undefined ? [] : [control],
    );
    if (!lower) {
        return base;
    }
    const ineligibility = readIneligibility(session);
    if (ineligibility !== null) {
        return withEnvelopeMetadata(base, { lowering_ineligible: ineligibility });
    }
    const programRef = formalContentRef(proofEnvelope.programRefPrefix, {
        lowering: lowering.schemaVersion,
        program_id: session.program_id,
    });
    return withEnvelopeMetadata(
        classifyProofEnvelope({
            completed: true,
            programRef,
            trace: session.steps.flatMap((step) => lowerStep(session, step, programRef)),
        }),
        { claimed_proof_backed: false, lowering: lowering.schemaVersion },
    );
}

function readIneligibility(session: Omit<ReplaySessionInspection, "proof">): string | null {
    if (!lowering.eligibleModes.includes(session.mode)) {
        return lowering.ineligibility.mode;
    }
    if (
        session.terminal === null ||
        !lowering.eligibleTerminalStatuses.includes(session.terminal.status)
    ) {
        return lowering.ineligibility.terminal;
    }
    if (session.steps.some((step) => !lowering.eligibleStepKinds.includes(step.kind))) {
        return lowering.ineligibility.stepKind;
    }
    return session.steps.every(
        (step) =>
            step.effect !== null &&
            step.effect.outcome !== null &&
            step.effect.handler_id !== null &&
            lowering.eligibleDispositions.includes(step.effect.disposition),
    )
        ? null
        : lowering.ineligibility.disposition;
}

function lowerStep(
    session: Omit<ReplaySessionInspection, "proof">,
    step: ReplayStepInspection,
    programRef: string,
): readonly Readonly<Record<string, SemanticValue>>[] {
    const effect = step.effect as NonNullable<ReplayStepInspection["effect"]>;
    const handlerId = effect.handler_id as string;
    const value = (effect.outcome as NonNullable<typeof effect.outcome>).result as SemanticValue;
    const ref = (role: string): string => `${lowering.localRefPrefix}${role}:${step.step_id}`;
    const contextRef = `${lowering.localRefPrefix}execution_context:${session.session_record_id}`;
    const handledResultSchemaRef = `${lowering.localRefPrefix}handled_result_schema:${handlerId}`;
    const declarationRef = ref("declaration");
    const selectionRef = ref("selection");
    const handleRef = ref("resumption");
    const resumeRef = ref("resume");
    const selectionPathRef = `${referenceMachine.pathPrefix}${selectionRef}/${handleRef}/${referenceMachine.rootBranchRef}`;
    const handler = {
        branch_ref: referenceMachine.rootBranchRef,
        handler_context_ref: ref("handler_context"),
        handler_continuation_ref: ref("handler_continuation"),
        handler_dynamic_tail_ref: ref("handler_dynamic_tail"),
        selection_path_ref: selectionPathRef,
        selection_ref: selectionRef,
        value,
    };
    return [
        {
            branch_ref: referenceMachine.rootBranchRef,
            effect_kind: effect.intent.kind,
            execution_context_ref: contextRef,
            full_continuation_ref: ref("full_continuation"),
            operation_result_schema_ref: null,
            payload: effect.intent.payload,
            payload_schema_ref: null,
            program_ref: programRef,
            record_type: recordTypes.declaration,
            ref: declarationRef,
        },
        {
            captured_continuation_control_ref: ref("captured_continuation_control"),
            captured_continuation_ref: ref("captured_continuation"),
            declaration_ref: declarationRef,
            handled_result_schema_ref: handledResultSchemaRef,
            handler_context_ref: handler.handler_context_ref,
            handler_frame_ref: ref("handler_frame"),
            handler_id: handlerId,
            outer_context_ref: contextRef,
            outer_continuation_control_ref: ref("outer_continuation_control"),
            outer_continuation_ref: ref("outer_continuation"),
            record_type: recordTypes.selection,
            ref: selectionRef,
            selected_binding_ref: ref("selected_binding"),
            worker_context_ref: contextRef,
        },
        {
            continuation_ref: ref("captured_continuation"),
            declaration_ref: declarationRef,
            handled_result_schema_ref: handledResultSchemaRef,
            operation_result_schema_ref: null,
            record_type: recordTypes.resumptionHandle,
            ref: handleRef,
            selection_ref: selectionRef,
        },
        {
            ...handler,
            continuation_ref: ref("captured_continuation"),
            declaration_ref: declarationRef,
            record_type: recordTypes.continuationResume,
            ref: resumeRef,
            returns_to_handler: true,
            source_record_type: referenceMachine.resumptionSourceRecordType,
            source_ref: handleRef,
            worker_context_ref: contextRef,
        },
        {
            ...handler,
            record_type: recordTypes.resumeReturn,
            ref: ref("resume_return"),
            resume_ref: resumeRef,
        },
        {
            action_kind: RETURN_ACTION as string,
            action_payload: value,
            branch_ref: referenceMachine.rootBranchRef,
            continuation_disposition: COMPLETED_DISPOSITION as string,
            outer_context_ref: contextRef,
            record_type: recordTypes.capture,
            ref: ref("capture"),
            selection_path_ref: selectionPathRef,
            selection_ref: selectionRef,
        },
    ];
}
