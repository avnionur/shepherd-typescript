import { createHash } from "node:crypto";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { formalAssuranceProtocolConfig } from "../protocol/config.ts";

const { proofEnvelope } = formalAssuranceProtocolConfig;

/**
 * Returns a configured content reference for one canonical formal-evidence value.
 *
 * @param prefix - Configured domain prefix ending in the selected hash algorithm.
 * @param value - Canonical semantic value to identify.
 * @returns The prefixed lowercase content digest.
 * @internal
 */
export function formalContentRef(prefix: string, value: SemanticValue): string {
    const digest = createHash(proofEnvelope.digestAlgorithm)
        .update(canonicalizeSemanticValue(value), "utf8")
        .digest("hex");
    return `${prefix}${digest}`;
}
