import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";
import { TypedEffectTraceValidationError } from "./errors.ts";
import type {
    TypedEffectTraceRecord,
    TypedEffectTraceValidation,
    TypedEffectTraceValidationOptions,
} from "./types.ts";

type Declaration = {
    readonly branchRef: string;
    readonly executionContextRef: string;
    readonly fullContinuationRef: string;
    readonly operationResultSchemaRef: string | null;
    readonly programRef: string;
    readonly ref: string;
};

type Selection = {
    readonly capturedContinuationControlRef: string;
    readonly capturedContinuationRef: string;
    readonly declarationRef: string;
    readonly handledResultSchemaRef: string;
    readonly handlerContextRef: string;
    readonly outerContextRef: string;
    readonly outerContinuationControlRef: string;
    readonly ref: string;
    readonly workerContextRef: string;
};

type ResumptionHandle = {
    readonly capturedContinuationControlRef: string;
    readonly continuationRef: string;
    readonly declarationRef: string;
    readonly handledResultSchemaRef: string;
    readonly operationResultSchemaRef: string | null;
    readonly ref: string;
    readonly selectionRef: string;
};

type Resume = {
    readonly branchRef: string;
    readonly handlerContextRef: string;
    readonly handlerContinuationRef: string;
    readonly handlerDynamicTailRef: string;
    readonly ref: string;
    readonly selectionPathRef: string;
    readonly selectionRef: string;
    readonly value: SemanticValue;
};

type Capture = {
    readonly actionKind: string;
    readonly ref: string;
    readonly selectionPathRef: string;
    readonly selectionRef: string;
};

type Path = {
    readonly branchRef: string;
    readonly capturedContinuationControlRef: string;
    readonly ref: string;
    readonly selectionRef: string;
    readonly sourceRef: string;
    open: boolean;
};

const { proofEnvelope, referenceMachine } = formalAssuranceProtocolConfig;
const recordTypes = referenceMachine.recordTypes;

/**
 * Executes the configured single-root Core-A lifecycle machine over normalized effect records.
 *
 * Validation checks exact record shapes, declaration/selection/handle correlation, callable
 * one-shot resumption, handler returns, terminal captures, nested selection closure, program
 * identity, and completed-versus-prefix obligations without mutating the supplied trace.
 *
 * @param options - Static program identity, completion mode, and ordered untrusted records.
 * @returns A frozen lifecycle summary for the accepted trace or trace prefix.
 * @throws {TypeError} If the options container or program identity is malformed.
 * @throws {TypedEffectTraceValidationError} If a record or lifecycle transition is invalid.
 *
 * @example
 * ```ts
 * const result = validateTypedEffectTrace({
 *     completed: false,
 *     programRef,
 *     trace: declarationPrefix,
 * });
 * result.open_path_count;
 * ```
 *
 * @public
 */
export function validateTypedEffectTrace(
    options: TypedEffectTraceValidationOptions,
): TypedEffectTraceValidation {
    const parsed = readOptions(options);
    const declarations = new Map<string, Declaration>();
    const selections = new Map<string, Selection>();
    const handles = new Map<string, ResumptionHandle>();
    const selectionByDeclaration = new Map<string, string>();
    const handleBySelection = new Map<string, string>();
    const paths = new Map<string, Path>();
    const resumes = new Map<string, Resume>();
    const resumeByPath = new Map<string, string>();
    const returnedResumes = new Set<string>();
    const captures = new Map<string, Capture>();
    const selectionParents = new Map<string, ReadonlySet<string>>();
    const refs = new Set<string>();

    for (const value of parsed.trace) {
        const record = readRecord(value);
        rejectDuplicate(refs, record.ref, "trace record");
        switch (record.record_type) {
            case recordTypes.declaration: {
                const declaration = readDeclaration(record, parsed.programRef);
                declarations.set(declaration.ref, declaration);
                break;
            }
            case recordTypes.selection: {
                const selection = readSelection(record, declarations, selectionByDeclaration);
                const parents = new Set<string>();
                for (const path of paths.values()) {
                    if (
                        path.open &&
                        path.capturedContinuationControlRef ===
                            selection.outerContinuationControlRef
                    ) {
                        parents.add(path.selectionRef);
                    }
                }
                selectionParents.set(selection.ref, parents);
                selections.set(selection.ref, selection);
                selectionByDeclaration.set(selection.declarationRef, selection.ref);
                break;
            }
            case recordTypes.resumptionHandle: {
                const handle = readResumptionHandle(
                    record,
                    declarations,
                    selections,
                    handleBySelection,
                );
                const pathRef = selectedPathRef(handle.selectionRef, handle.ref);
                handles.set(handle.ref, handle);
                handleBySelection.set(handle.selectionRef, handle.ref);
                paths.set(pathRef, {
                    branchRef: referenceMachine.rootBranchRef,
                    capturedContinuationControlRef: handle.capturedContinuationControlRef,
                    open: true,
                    ref: pathRef,
                    selectionRef: handle.selectionRef,
                    sourceRef: handle.ref,
                });
                break;
            }
            case recordTypes.continuationResume: {
                const resume = readContinuationResume(
                    record,
                    declarations,
                    selections,
                    handles,
                    paths,
                    resumeByPath,
                );
                resumes.set(resume.ref, resume);
                resumeByPath.set(resume.selectionPathRef, resume.ref);
                break;
            }
            case recordTypes.resumeReturn: {
                const resumeRef = readResumeReturn(record, resumes, returnedResumes);
                returnedResumes.add(resumeRef);
                break;
            }
            case recordTypes.capture: {
                const capture = readCapture(
                    record,
                    selections,
                    paths,
                    resumeByPath,
                    returnedResumes,
                );
                captures.set(capture.ref, capture);
                terminalizePath(paths, capture.selectionPathRef, "effect capture");
                break;
            }
            case recordTypes.selectionClosed: {
                const pathRef = readSelectionClosed(
                    record,
                    paths,
                    captures,
                    selectionParents,
                    resumeByPath,
                    returnedResumes,
                );
                terminalizePath(paths, pathRef, "selection closure");
                break;
            }
            default:
                throw invalid(`unsupported typed-effect trace record: ${record.record_type}`);
        }
    }

    if (parsed.completed) {
        for (const declarationRef of declarations.keys()) {
            requireMachine(
                selectionByDeclaration.has(declarationRef),
                `completed trace has unselected declaration ${declarationRef}`,
            );
        }
        for (const selectionRef of selections.keys()) {
            requireMachine(
                handleBySelection.has(selectionRef),
                `completed trace selection ${selectionRef} has no resumption handle`,
            );
        }
        for (const path of paths.values()) {
            requireMachine(!path.open, `completed trace leaves selected path ${path.ref} open`);
        }
    }
    const openPathCount = [...paths.values()].filter((path) => path.open).length;
    return Object.freeze({
        completed: parsed.completed,
        open_path_count: openPathCount,
        program_ref: parsed.programRef,
        record_count: parsed.trace.length,
    });
}

function readOptions(value: unknown): {
    readonly completed: boolean;
    readonly programRef: string;
    readonly trace: readonly unknown[];
} {
    const fields = readExactObject(value, ["completed", "programRef", "trace"]);
    if (typeof fields.completed !== "boolean") {
        throw new TypeError("typed-effect trace completed must be boolean");
    }
    const programRef = readProgramRef(fields.programRef);
    if (!Array.isArray(fields.trace)) {
        throw new TypeError("typed-effect trace must be an array");
    }
    return { completed: fields.completed, programRef, trace: fields.trace };
}

function readRecord(value: unknown): TypedEffectTraceRecord {
    const fields = readObject(value);
    const recordType = readText(fields.record_type, "typed-effect record type");
    const ref = readText(fields.ref, "typed-effect record identity");
    return { ...fields, record_type: recordType, ref } as TypedEffectTraceRecord;
}

function readDeclaration(record: TypedEffectTraceRecord, programRef: string): Declaration {
    const fields = readExactObject(record, [
        "branch_ref",
        "effect_kind",
        "execution_context_ref",
        "full_continuation_ref",
        "operation_result_schema_ref",
        "payload",
        "payload_schema_ref",
        "program_ref",
        "record_type",
        "ref",
    ]);
    requireMachine(fields.record_type === recordTypes.declaration, "declaration type changed");
    requireMachine(fields.program_ref === programRef, "declaration program identity disagrees");
    const branchRef = readText(fields.branch_ref, "declaration branch identity");
    requireMachine(
        branchRef === referenceMachine.rootBranchRef,
        "typed-effect core admits only the configured root branch",
    );
    readText(fields.effect_kind, "declaration effect kind");
    readSemantic(fields.payload, "declaration payload");
    readNullableText(fields.payload_schema_ref, "declaration payload schema");
    return {
        branchRef,
        executionContextRef: readText(
            fields.execution_context_ref,
            "declaration execution context",
        ),
        fullContinuationRef: readText(
            fields.full_continuation_ref,
            "declaration full continuation",
        ),
        operationResultSchemaRef: readNullableText(
            fields.operation_result_schema_ref,
            "declaration operation-result schema",
        ),
        programRef,
        ref: readText(fields.ref, "declaration identity"),
    };
}

function readSelection(
    record: TypedEffectTraceRecord,
    declarations: ReadonlyMap<string, Declaration>,
    selectionByDeclaration: ReadonlyMap<string, string>,
): Selection {
    const fields = readExactObject(record, [
        "captured_continuation_control_ref",
        "captured_continuation_ref",
        "declaration_ref",
        "handled_result_schema_ref",
        "handler_context_ref",
        "handler_frame_ref",
        "handler_id",
        "outer_context_ref",
        "outer_continuation_control_ref",
        "outer_continuation_ref",
        "record_type",
        "ref",
        "selected_binding_ref",
        "worker_context_ref",
    ]);
    const declarationRef = readText(fields.declaration_ref, "selection declaration identity");
    const declaration = declarations.get(declarationRef);
    requireMachine(declaration !== undefined, "selection cites a missing declaration");
    requireMachine(
        !selectionByDeclaration.has(declarationRef),
        `declaration ${declarationRef} has duplicate handler selections`,
    );
    const workerContextRef = readText(fields.worker_context_ref, "selection worker context");
    requireMachine(
        workerContextRef === declaration.executionContextRef,
        "selection worker context disagrees with its declaration",
    );
    readText(fields.selected_binding_ref, "selected handler binding");
    readText(fields.handler_id, "selected handler identity");
    readText(fields.handler_frame_ref, "selected handler frame");
    readText(fields.outer_continuation_ref, "selection outer continuation");
    return {
        capturedContinuationControlRef: readText(
            fields.captured_continuation_control_ref,
            "selection captured continuation control",
        ),
        capturedContinuationRef: readText(
            fields.captured_continuation_ref,
            "selection captured continuation",
        ),
        declarationRef,
        handledResultSchemaRef: readText(
            fields.handled_result_schema_ref,
            "selection handled-result schema",
        ),
        handlerContextRef: readText(fields.handler_context_ref, "selection handler context"),
        outerContextRef: readText(fields.outer_context_ref, "selection outer context"),
        outerContinuationControlRef: readText(
            fields.outer_continuation_control_ref,
            "selection outer continuation control",
        ),
        ref: readText(fields.ref, "selection identity"),
        workerContextRef,
    };
}

function readResumptionHandle(
    record: TypedEffectTraceRecord,
    declarations: ReadonlyMap<string, Declaration>,
    selections: ReadonlyMap<string, Selection>,
    handleBySelection: ReadonlyMap<string, string>,
): ResumptionHandle {
    const fields = readExactObject(record, [
        "continuation_ref",
        "declaration_ref",
        "handled_result_schema_ref",
        "operation_result_schema_ref",
        "record_type",
        "ref",
        "selection_ref",
    ]);
    const selectionRef = readText(fields.selection_ref, "resumption selection identity");
    const selection = selections.get(selectionRef);
    requireMachine(selection !== undefined, "resumption handle cites a missing selection");
    requireMachine(
        !handleBySelection.has(selectionRef),
        `selection ${selectionRef} has duplicate resumption handles`,
    );
    const declarationRef = readText(fields.declaration_ref, "resumption declaration identity");
    const declaration = declarations.get(declarationRef);
    requireMachine(declaration !== undefined, "resumption handle cites a missing declaration");
    requireMachine(
        declarationRef === selection.declarationRef,
        "resumption declaration disagrees with selection",
    );
    const continuationRef = readText(fields.continuation_ref, "resumption continuation");
    requireMachine(
        continuationRef === selection.capturedContinuationRef,
        "resumption must name the selected captured continuation",
    );
    const handledResultSchemaRef = readText(
        fields.handled_result_schema_ref,
        "resumption handled-result schema",
    );
    requireMachine(
        handledResultSchemaRef === selection.handledResultSchemaRef,
        "resumption handled-result schema disagrees with selection",
    );
    const operationResultSchemaRef = readNullableText(
        fields.operation_result_schema_ref,
        "resumption operation-result schema",
    );
    requireMachine(
        operationResultSchemaRef === declaration.operationResultSchemaRef,
        "resumption operation-result schema disagrees with declaration",
    );
    return {
        capturedContinuationControlRef: selection.capturedContinuationControlRef,
        continuationRef,
        declarationRef,
        handledResultSchemaRef,
        operationResultSchemaRef,
        ref: readText(fields.ref, "resumption identity"),
        selectionRef,
    };
}

function readContinuationResume(
    record: TypedEffectTraceRecord,
    declarations: ReadonlyMap<string, Declaration>,
    selections: ReadonlyMap<string, Selection>,
    handles: ReadonlyMap<string, ResumptionHandle>,
    paths: ReadonlyMap<string, Path>,
    resumeByPath: ReadonlyMap<string, string>,
): Resume {
    const fields = readExactObject(record, [
        "branch_ref",
        "continuation_ref",
        "declaration_ref",
        "handler_context_ref",
        "handler_continuation_ref",
        "handler_dynamic_tail_ref",
        "record_type",
        "ref",
        "returns_to_handler",
        "selection_path_ref",
        "selection_ref",
        "source_record_type",
        "source_ref",
        "value",
        "worker_context_ref",
    ]);
    requireMachine(
        fields.source_record_type === referenceMachine.resumptionSourceRecordType,
        "continuation resume source record type is unsupported",
    );
    const sourceRef = readText(fields.source_ref, "continuation resume source");
    const handle = handles.get(sourceRef);
    requireMachine(handle !== undefined, "continuation resume cites a missing resumption handle");
    const selectionRef = readText(fields.selection_ref, "continuation resume selection");
    const selection = selections.get(selectionRef);
    requireMachine(selection !== undefined, "continuation resume cites a missing selection");
    requireMachine(selectionRef === handle.selectionRef, "continuation resume selection disagrees");
    const declarationRef = readText(fields.declaration_ref, "continuation resume declaration");
    const declaration = declarations.get(declarationRef);
    requireMachine(
        declaration !== undefined && declarationRef === handle.declarationRef,
        "continuation resume declaration disagrees",
    );
    const selectionPathRef = readText(fields.selection_path_ref, "continuation resume path");
    const path = paths.get(selectionPathRef);
    requireMachine(
        path?.open === true && path.sourceRef === sourceRef,
        "continuation resume path is not open for its source",
    );
    requireMachine(!resumeByPath.has(selectionPathRef), "callable resumption is one-shot");
    requireMachine(fields.returns_to_handler === true, "Core-A resumes must return to the handler");
    requireMachine(
        fields.continuation_ref === handle.continuationRef,
        "continuation resume continuation disagrees with its handle",
    );
    const branchRef = readText(fields.branch_ref, "continuation resume branch");
    requireMachine(branchRef === path.branchRef, "continuation resume branch disagrees");
    requireMachine(
        fields.worker_context_ref === declaration.executionContextRef,
        "continuation resume worker context disagrees",
    );
    const handlerContextRef = readText(
        fields.handler_context_ref,
        "continuation resume handler context",
    );
    return {
        branchRef,
        handlerContextRef,
        handlerContinuationRef: readText(
            fields.handler_continuation_ref,
            "continuation resume handler continuation",
        ),
        handlerDynamicTailRef: readText(
            fields.handler_dynamic_tail_ref,
            "continuation resume handler dynamic tail",
        ),
        ref: readText(fields.ref, "continuation resume identity"),
        selectionPathRef,
        selectionRef,
        value: readSemantic(fields.value, "continuation resume value"),
    };
}

function readResumeReturn(
    record: TypedEffectTraceRecord,
    resumes: ReadonlyMap<string, Resume>,
    returnedResumes: ReadonlySet<string>,
): string {
    const fields = readExactObject(record, [
        "branch_ref",
        "handler_context_ref",
        "handler_continuation_ref",
        "handler_dynamic_tail_ref",
        "record_type",
        "ref",
        "resume_ref",
        "selection_path_ref",
        "selection_ref",
        "value",
    ]);
    const resumeRef = readText(fields.resume_ref, "resume-return source");
    const resume = resumes.get(resumeRef);
    requireMachine(resume !== undefined, "resume return cites a missing continuation resume");
    requireMachine(!returnedResumes.has(resumeRef), "continuation resume returned more than once");
    requireMachine(
        fields.selection_ref === resume.selectionRef,
        "resume-return selection disagrees",
    );
    requireMachine(
        fields.selection_path_ref === resume.selectionPathRef,
        "resume-return path disagrees",
    );
    requireMachine(fields.branch_ref === resume.branchRef, "resume-return branch disagrees");
    requireMachine(
        fields.handler_continuation_ref === resume.handlerContinuationRef &&
            fields.handler_dynamic_tail_ref === resume.handlerDynamicTailRef,
        "resume-return handler continuation disagrees",
    );
    requireMachine(
        fields.handler_context_ref === resume.handlerContextRef,
        "resume-return handler context disagrees",
    );
    requireMachine(
        sameSemantic(readSemantic(fields.value, "resume-return value"), resume.value),
        "resume-return value disagrees with the resumed continuation result",
    );
    readText(fields.ref, "resume-return identity");
    return resumeRef;
}

function readCapture(
    record: TypedEffectTraceRecord,
    selections: ReadonlyMap<string, Selection>,
    paths: ReadonlyMap<string, Path>,
    resumeByPath: ReadonlyMap<string, string>,
    returnedResumes: ReadonlySet<string>,
): Capture {
    const fields = readExactObject(record, [
        "action_kind",
        "action_payload",
        "branch_ref",
        "continuation_disposition",
        "outer_context_ref",
        "record_type",
        "ref",
        "selection_path_ref",
        "selection_ref",
    ]);
    const selectionRef = readText(fields.selection_ref, "effect capture selection");
    const selection = selections.get(selectionRef);
    requireMachine(selection !== undefined, "effect capture cites a missing selection");
    const selectionPathRef = readText(fields.selection_path_ref, "effect capture path");
    const path = paths.get(selectionPathRef);
    requireMachine(
        path?.open === true && path.selectionRef === selectionRef,
        "effect capture path is not open for its selection",
    );
    requireMachine(fields.branch_ref === path.branchRef, "effect capture branch disagrees");
    const actionKind = readText(fields.action_kind, "effect capture action");
    const actionIndex = referenceMachine.actionKinds.indexOf(actionKind);
    requireMachine(actionIndex >= 0, "effect capture action is outside Core-A");
    requireMachine(
        fields.continuation_disposition === referenceMachine.continuationDispositions[actionIndex],
        "effect capture action and continuation disposition disagree",
    );
    readSemantic(fields.action_payload, "effect capture payload");
    requireMachine(
        fields.outer_context_ref === selection.outerContextRef,
        "effect capture outer context disagrees",
    );
    const resumeRef = resumeByPath.get(selectionPathRef);
    requireMachine(
        resumeRef === undefined || returnedResumes.has(resumeRef),
        "effect capture precedes callable resume return",
    );
    return {
        actionKind,
        ref: readText(fields.ref, "effect capture identity"),
        selectionPathRef,
        selectionRef,
    };
}

function readSelectionClosed(
    record: TypedEffectTraceRecord,
    paths: ReadonlyMap<string, Path>,
    captures: ReadonlyMap<string, Capture>,
    selectionParents: ReadonlyMap<string, ReadonlySet<string>>,
    resumeByPath: ReadonlyMap<string, string>,
    returnedResumes: ReadonlySet<string>,
): string {
    const fields = readExactObject(record, [
        "branch_ref",
        "caused_by_record_type",
        "caused_by_ref",
        "closed_by_selection_path_ref",
        "closed_by_selection_ref",
        "reason",
        "record_type",
        "ref",
        "selection_path_ref",
        "selection_ref",
    ]);
    const pathRef = readText(fields.selection_path_ref, "selection closure path");
    const path = paths.get(pathRef);
    requireMachine(path?.open === true, "selection closure path is not open");
    requireMachine(
        fields.selection_ref === path.selectionRef,
        "selection closure selection disagrees",
    );
    requireMachine(fields.branch_ref === path.branchRef, "selection closure branch disagrees");
    requireMachine(
        fields.caused_by_record_type === recordTypes.capture,
        "selection closure cause type is unsupported",
    );
    const causeRef = readText(fields.caused_by_ref, "selection closure cause");
    const cause = captures.get(causeRef);
    requireMachine(cause !== undefined, "selection closure cites a missing prior capture");
    requireMachine(
        fields.closed_by_selection_ref === cause.selectionRef &&
            fields.closed_by_selection_path_ref === cause.selectionPathRef,
        "selection closure closing selection disagrees with its cause",
    );
    requireMachine(
        selectionParents.get(cause.selectionRef)?.has(path.selectionRef) === true,
        "selection closure cause is not dynamically nested under the closed selection",
    );
    const actionIndex = referenceMachine.actionKinds.indexOf(cause.actionKind);
    requireMachine(
        fields.reason === referenceMachine.closureReasons[actionIndex],
        "selection closure reason disagrees with its cause",
    );
    const resumeRef = resumeByPath.get(pathRef);
    requireMachine(
        resumeRef === undefined || returnedResumes.has(resumeRef),
        "selection closure abandons an in-flight callable resume",
    );
    readText(fields.ref, "selection closure identity");
    return pathRef;
}

function selectedPathRef(selectionRef: string, sourceRef: string): string {
    return `${referenceMachine.pathPrefix}${selectionRef}/${sourceRef}/${referenceMachine.rootBranchRef}`;
}

function terminalizePath(paths: ReadonlyMap<string, Path>, pathRef: string, context: string): void {
    const path = paths.get(pathRef);
    requireMachine(path?.open === true, `${context} path is already terminal`);
    path.open = false;
}

function rejectDuplicate(refs: Set<string>, ref: string, context: string): void {
    requireMachine(!refs.has(ref), `duplicate ${context} identity ${ref}`);
    refs.add(ref);
}

function readProgramRef(value: unknown): string {
    const ref = typeof value === "string" ? value : "";
    const digest = ref.slice(proofEnvelope.programRefPrefix.length);
    if (
        !ref.startsWith(proofEnvelope.programRefPrefix) ||
        digest.length !== proofEnvelope.hexLength ||
        !/^[0-9a-f]+$/u.test(digest)
    ) {
        throw new TypeError("typed-effect programRef must be a configured content-addressed ref");
    }
    return ref;
}

function readExactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
    const fields = readObject(value);
    const actual = Object.keys(fields).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw invalid("typed-effect record or options shape is not exact");
    }
    return fields;
}

function readObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw invalid("typed-effect record must be a data object");
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
        throw invalid("typed-effect record must have a data-object prototype");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
            throw invalid("typed-effect record must not contain accessors");
        }
    }
    return value as Record<string, unknown>;
}

function readText(value: unknown, context: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw invalid(`${context} must be a non-empty string`);
    }
    return value;
}

function readNullableText(value: unknown, context: string): string | null {
    return value === null ? null : readText(value, context);
}

function readSemantic(value: unknown, context: string): SemanticValue {
    try {
        canonicalizeSemanticValue(value as SemanticValue);
        return value as SemanticValue;
    } catch {
        throw invalid(`${context} must be a canonical semantic value`);
    }
}

function sameSemantic(left: SemanticValue, right: SemanticValue): boolean {
    return canonicalizeSemanticValue(left) === canonicalizeSemanticValue(right);
}

function requireMachine(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw invalid(message);
    }
}

function invalid(message: string): TypedEffectTraceValidationError {
    return new TypedEffectTraceValidationError(message);
}
