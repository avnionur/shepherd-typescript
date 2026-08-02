import type { TraceIntegrityIssue, TraceIntegrityIssueKind } from "./integrity-types.ts";

/** Adds one frozen classified issue to an in-progress integrity report. */
export function addIntegrityIssue(
    issues: TraceIntegrityIssue[],
    kind: TraceIntegrityIssueKind,
    subjectId: string,
): void {
    issues.push(Object.freeze({ kind, subject_id: subjectId }));
}
