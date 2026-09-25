import type { SemanticValue } from "../canonical/canonical-record.ts";
import { applicationsProtocolConfig } from "../protocol/config.ts";
import { APPLICATION_CRO_EXAMPLE_ROLES } from "../protocol/values.generated.ts";
import type {
    CounterfactualEdit,
    CounterfactualExampleResult,
    CounterfactualGateVerdict,
} from "./counterfactual-types.ts";

const cro = applicationsProtocolConfig.cro;
const [FIX_ROLE, GUARD_ROLE] = APPLICATION_CRO_EXAMPLE_ROLES;
const TOKEN_SEPARATOR = /[^\p{L}\p{N}]+/u;

/** Resolved fractional thresholds of one run, read by the configured threshold keys. @internal */
export type CroThresholds = {
    readonly audaciousPrior: number;
    readonly duplicateSimilarity: number;
    readonly improveThreshold: number;
    readonly maxScoreDrop: number;
    readonly minPromotionScore: number;
    readonly minScoreLift: number;
    readonly promoteDevEpsilon: number;
};

/** Candidate row the reflection contract compares new mechanisms against. @internal */
export type CroLedgerRow = {
    readonly mechanism: string;
    readonly name: string;
    readonly promoted: boolean;
};

/**
 * Reads the configured thresholds from protocol thresholds, or reports the missing key.
 * @internal
 */
export function readCroThresholds(
    thresholds: Readonly<Record<string, number>> | undefined,
): CroThresholds | string {
    const keys = cro.thresholdKeys;
    const resolved: Record<string, number> = {};
    for (const [field, key] of Object.entries(keys)) {
        const value = thresholds?.[key];
        if (value === undefined) {
            return key;
        }
        resolved[field] = value;
    }
    return resolved as CroThresholds;
}

/**
 * Computes the targeted fix/guard gate verdict (paper Appendix F.2.5) over retained fix and guard
 * results: the mean score over the union must exceed the parent's by at least `minScoreLift`, no
 * guard example may drop by more than `maxScoreDrop`, and at least `improveThreshold` of the fix
 * examples must score strictly above the parent. Scores are compared in IEEE-754 double
 * arithmetic.
 * @internal
 */
export function evaluateCroGate(
    thresholds: CroThresholds,
    results: readonly Pick<CounterfactualExampleResult, "parent_score" | "role" | "score">[],
): CounterfactualGateVerdict {
    const fix = results.filter((result) => result.role === FIX_ROLE);
    const guard = results.filter((result) => result.role === GUARD_ROLE);
    const lift =
        mean(results.map((result) => result.score)) -
        mean(results.map((result) => result.parent_score));
    const drop = Math.max(0, ...guard.map((result) => result.parent_score - result.score));
    // Admission guarantees a non-empty fix set.
    const improved = fix.filter((result) => result.score > result.parent_score).length / fix.length;
    const failures = [
        lift < thresholds.minScoreLift
            ? `aggregate lift ${lift} is below ${thresholds.minScoreLift}`
            : null,
        drop > thresholds.maxScoreDrop
            ? `guard drop ${drop} exceeds ${thresholds.maxScoreDrop}`
            : null,
        improved < thresholds.improveThreshold
            ? `improved fix fraction ${improved} is below ${thresholds.improveThreshold}`
            : null,
    ].filter((failure): failure is string => failure !== null);
    return Object.freeze({
        aggregate_lift: lift,
        improve_fraction: improved,
        max_guard_drop: drop,
        passed: failures.length === 0,
        reason: failures.length === 0 ? "every targeted threshold held" : failures.join("; "),
    });
}

/**
 * Reports whether a graduated candidate is promoted into the parent pool: its dev score reaches
 * `minPromotionScore` and lies within `promoteDevEpsilon` of the current promoted member's dev
 * score (`dev + epsilon >= reference`).
 * @internal
 */
export function croPromotes(
    thresholds: CroThresholds,
    devScore: number,
    reference: number,
): boolean {
    return (
        devScore >= thresholds.minPromotionScore &&
        devScore + thresholds.promoteDevEpsilon >= reference
    );
}

/** Arithmetic mean of a non-empty score list. @internal */
export function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Jaccard similarity of the case-folded letter and digit token sets of two texts; zero when both
 * are empty.
 * @internal
 */
export function croTokenSimilarity(left: string, right: string): number {
    const tokens = (text: string) =>
        new Set(
            text
                .toLowerCase()
                .split(TOKEN_SEPARATOR)
                .filter((token) => token.length > 0),
        );
    const a = tokens(left);
    const b = tokens(right);
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : [...a].filter((token) => b.has(token)).length / union;
}

/**
 * Checks the reflection contract of paper Appendix F.2.5 over a schema-valid reflection and the
 * proposal's edits, reading the configured reflection field names:
 *
 * 1. Once any non-promoted candidate exists, the findings cite at least one retained candidate
 *    name.
 * 2. An edit whose mechanism is a near-duplicate (token similarity at least `duplicateSimilarity`)
 *    of a non-promoted candidate's mechanism requires the case-folded findings to contain that
 *    candidate's name and the configured `differsByPhrase`; near-duplicates of promoted
 *    mechanisms pass.
 * 3. The hypotheses enumerate at least `minMechanisms` mechanisms with finite priors, and at least
 *    one edit carries a prior strictly below `audaciousPrior`.
 *
 * @returns The violated rules, empty when the contract holds.
 * @internal
 */
export function checkCroReflectionContract(
    reflection: SemanticValue,
    edits: readonly CounterfactualEdit[],
    ledger: readonly CroLedgerRow[],
    thresholds: CroThresholds,
    minMechanisms: number,
): readonly string[] {
    const fields = cro.reflection.fields;
    const object = (reflection ?? {}) as Readonly<Record<string, unknown>>;
    const rawFindings = object[fields.findings];
    const findings = (
        typeof rawFindings === "string"
            ? rawFindings
            : Array.isArray(rawFindings)
              ? rawFindings.filter((entry) => typeof entry === "string").join("\n")
              : ""
    ).toLowerCase();
    const violations: string[] = [];
    const archived = ledger.filter((row) => !row.promoted);
    if (archived.length > 0 && !ledger.some((row) => findings.includes(row.name.toLowerCase()))) {
        violations.push(`${fields.findings} must cite at least one prior candidate by name`);
    }
    for (const edit of edits) {
        for (const row of archived) {
            if (
                croTokenSimilarity(edit.mechanism, row.mechanism) >=
                    thresholds.duplicateSimilarity &&
                !(
                    findings.includes(row.name.toLowerCase()) &&
                    findings.includes(cro.reflection.differsByPhrase.toLowerCase())
                )
            ) {
                violations.push(
                    `edit ${edit.name} repeats the mechanism of ${row.name} without explaining how it ${cro.reflection.differsByPhrase}`,
                );
            }
        }
    }
    const hypotheses = object[fields.hypotheses];
    const enumerated = Array.isArray(hypotheses)
        ? hypotheses.filter((entry) => {
              const hypothesis = entry as Readonly<Record<string, unknown>> | null;
              return (
                  typeof hypothesis?.[fields.mechanism] === "string" &&
                  typeof hypothesis[fields.prior] === "number" &&
                  Number.isFinite(hypothesis[fields.prior])
              );
          }).length
        : 0;
    if (enumerated < minMechanisms) {
        violations.push(
            `${fields.hypotheses} must enumerate at least ${minMechanisms} mechanisms with priors, not ${enumerated}`,
        );
    }
    if (!edits.some((edit) => edit.prior < thresholds.audaciousPrior)) {
        violations.push(`at least one edit must carry a prior below ${thresholds.audaciousPrior}`);
    }
    return Object.freeze(violations);
}
