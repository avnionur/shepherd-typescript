import assert from "node:assert/strict";
import { test } from "node:test";

import * as effects from "../../src/facades/effects.ts";

test("effects facade exposes only effect-owned runtime symbols", () => {
    assert.deepEqual(Object.keys(effects), [
        "EFFECT_COMPENSABLE_TIERS",
        "EFFECT_COMPENSATION_EVIDENCE_KINDS",
        "EFFECT_COMPENSATION_OUTCOMES",
        "EFFECT_COMPENSATION_PHASES",
        "EFFECT_COMPENSATION_STATUSES",
        "EFFECT_COMPENSATION_TRIGGERS",
        "EffectCompensationConflictError",
        "EffectCompensationEvidenceError",
        "EffectCompensationFailedError",
        "EffectCompensationHandlerNotFoundError",
        "EffectHandlerNotFoundError",
        "compensateEffects",
        "createEffectCompensationRegistry",
        "createEffectHandlerStack",
        "createEffectIntent",
        "createEffectOutcome",
        "createTypedEffectHandler",
        "deriveEffectCompensationId",
        "inspectEffectCompensation",
        "validateEffectCorrelation",
    ]);
    for (const excluded of [
        "classifyProofEnvelope",
        "createStaticProvider",
        "executeTask",
        "SQLiteTraceStore",
        "validateTypedEffectTrace",
    ]) {
        assert.equal(excluded in effects, false);
    }
});
