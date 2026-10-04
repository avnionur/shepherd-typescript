import type { EffectReconciliationReceipt } from "../effect/reconciliation-types.ts";

/**
 * Formats accepted external risk without implying successful compensation.
 * @param risks - Recorded unresolved operator dispositions, when present.
 * @returns Escaped human lines; the CLI caller enforces its overall output bound.
 * @internal
 */
export function renderResidualRisks(
    risks: readonly EffectReconciliationReceipt[] | undefined,
): string {
    if (risks === undefined) return "";
    return `Accepted unresolved effects: ${risks.length}\n${risks.map((risk) => `  ${risk.target_record_id} actor ${JSON.stringify(risk.actor_id)}: ${JSON.stringify(risk.reason)}\n`).join("")}`;
}
