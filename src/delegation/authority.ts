import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import type { RunBudgetDefinition } from "../run/control-types.ts";
import { readRunControlOptions } from "../run/control-validation.ts";
import { attenuateScopeAuthority } from "../scope/authority.ts";
import { ScopeAuthorityError } from "../scope/errors.ts";
import type { ScopeAuthority, ScopeResourceGrant } from "../scope/types.ts";
import { DelegationAuthorityError } from "./errors.ts";

/** Validates one budget definition into its canonical closed form. @internal */
export function readDelegationBudget(value: unknown, subject: string): RunBudgetDefinition {
    try {
        return Object.freeze({
            ...readRunControlOptions({ budget: value as RunBudgetDefinition }).budget,
        });
    } catch (error) {
        throw new TypeError(`${subject} must be a run budget definition`, { cause: error });
    }
}

/**
 * Refuses a child budget that omits or exceeds any metric its parent declares.
 *
 * Every metric the parent declares must be declared by the child with a value no greater than
 * the parent's; the child may declare additional metrics.
 *
 * @internal
 */
export function assertBudgetAttenuated(
    ceiling: RunBudgetDefinition,
    budget: RunBudgetDefinition,
): void {
    for (const [metric, limit] of Object.entries(ceiling) as [
        keyof RunBudgetDefinition,
        number,
    ][]) {
        const declared = budget[metric];
        if (declared === undefined) {
            throw new DelegationAuthorityError(`child budget must declare ${metric}`);
        }
        if (declared > limit) {
            throw new DelegationAuthorityError(
                `child budget ${metric} exceeds the parent's ${limit}`,
            );
        }
    }
}

/**
 * Derives delegated resource authority, failing closed with the delegation authority error.
 *
 * For a root parent the ceiling is the declared ceiling; for a handle parent the ceiling is the
 * parent's effective authority. Effective authority is the per-resource intersection of the
 * requested grant and the ceiling, so delegation never amplifies.
 *
 * @internal
 */
export function deriveDelegatedAuthority(
    ceiling: readonly ScopeResourceGrant[],
    grant: readonly ScopeResourceGrant[],
): ScopeAuthority {
    try {
        return attenuateScopeAuthority(ceiling, null, grant);
    } catch (error) {
        if (error instanceof ScopeAuthorityError) {
            throw new DelegationAuthorityError(error.message, { cause: error });
        }
        throw error;
    }
}

/** Whether retained effective authority equals the re-derivation from ceiling and grant. @internal */
export function sameDelegatedAuthority(
    retained: ScopeAuthority,
    grant: readonly ScopeResourceGrant[],
): boolean {
    try {
        return (
            canonicalizeSemanticValue(
                attenuateScopeAuthority(retained.ceiling, null, grant).effective as SemanticValue,
            ) === canonicalizeSemanticValue(retained.effective as SemanticValue)
        );
    } catch {
        return false;
    }
}
