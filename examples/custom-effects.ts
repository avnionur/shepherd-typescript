import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
    createEffectHandlerStack,
    createEffectIntent,
    createEffectOutcome,
    createTypedEffectHandler,
    EffectHandlerNotFoundError,
    type EffectIntent,
    validateEffectCorrelation,
} from "@avnionur/shepherd-typescript/effects";
import { schema } from "@avnionur/shepherd-typescript/tasks";

const [directory, configurationPath, ...extra] = process.argv.slice(2);
assert.ok(
    directory && configurationPath && extra.length === 0,
    "Usage: node custom-effects.ts <new-demo-directory> <scenario.json>",
);
const configuration = schema
    .object({
        kind: schema.string(),
        unrelatedKind: schema.string(),
        missingKind: schema.string(),
        fallbackHandler: schema.string(),
        localHandler: schema.string(),
        unrelatedHandler: schema.string(),
        successId: schema.string(),
        failureId: schema.string(),
        missingId: schema.string(),
        text: schema.string(),
        declinedText: schema.string(),
        prefix: schema.string(),
        fallbackValue: schema.string(),
        failureCode: schema.string(),
    })
    .parse(JSON.parse(readFileSync(configurationPath, "utf8")));
assert.notEqual(configuration.kind, configuration.unrelatedKind);
assert.ok(![configuration.kind, configuration.unrelatedKind].includes(configuration.missingKind));
assert.notEqual(configuration.text, configuration.declinedText);
// This empty directory is only a demo-run marker; effect handlers perform no filesystem writes.
mkdirSync(path.resolve(directory));
const payloadSchema = schema.object({ text: schema.string() });
// Dynamic documents yield unknown, while the ordinary builder retains static field inference.
const importedPayloadSchema = schema.fromJSONSchema(payloadSchema.toJSONSchema());
assert.deepEqual(
    importedPayloadSchema.parse({ text: configuration.text }),
    payloadSchema.parse({ text: configuration.text }),
);
const successIntent: EffectIntent<string, { readonly text: string }> = createEffectIntent({
    effectId: configuration.successId,
    kind: configuration.kind,
    payload: { text: configuration.text },
    reversibility: "reversible", // Pure formatting has no external side effects to undo.
});
const failureIntent = createEffectIntent({
    effectId: configuration.failureId,
    kind: configuration.kind,
    payload: { text: configuration.declinedText },
    reversibility: "reversible",
});
const stack = createEffectHandlerStack([
    {
        handlerId: configuration.fallbackHandler,
        kind: configuration.kind,
        handle: () => ({ ok: true, value: configuration.fallbackValue }),
    },
    createTypedEffectHandler({
        handlerId: configuration.localHandler,
        kind: configuration.kind,
        payloadSchema,
        handle: (payload) => {
            // Payload type inference and runtime validation share the same schema.
            return payload.text === configuration.declinedText
                ? { ok: false, error: { code: configuration.failureCode } }
                : { ok: true, value: configuration.prefix + payload.text };
        },
    }),
    {
        handlerId: configuration.unrelatedHandler,
        kind: configuration.unrelatedKind,
        handle: () => ({ ok: true, value: null }),
    },
]);
const success = await stack.dispatch(successIntent);
const failure = await stack.dispatch(failureIntent);
assert.equal(success.handlerId, configuration.localHandler);
assert.equal(failure.handlerId, configuration.localHandler);
validateEffectCorrelation(successIntent, success.outcome);
validateEffectCorrelation(failureIntent, failure.outcome);

// A caller interpreting an effect without a stack can construct its correlated outcome explicitly.
const manualOutcome = createEffectOutcome(successIntent, {
    ok: true,
    value: configuration.prefix + configuration.text,
});
validateEffectCorrelation(successIntent, manualOutcome);
const changedIntent = createEffectIntent({
    effectId: configuration.successId,
    kind: configuration.kind,
    payload: { text: configuration.declinedText },
    reversibility: "reversible",
});
assert.throws(() => validateEffectCorrelation(changedIntent, manualOutcome), TypeError);
let unhandledCode: string | undefined;
try {
    await stack.dispatch(
        createEffectIntent({
            effectId: configuration.missingId,
            kind: configuration.missingKind,
            payload: null,
            reversibility: "reversible",
        }),
    );
    assert.fail("an unhandled effect unexpectedly succeeded");
} catch (error) {
    assert.ok(error instanceof EffectHandlerNotFoundError);
    assert.equal(error.effectId, configuration.missingId);
    assert.equal(error.kind, configuration.missingKind);
    unhandledCode = error.code;
}
process.stdout.write(
    `${JSON.stringify({
        successHandler: success.handlerId,
        success: success.outcome.result,
        failureHandler: failure.handlerId,
        failure: failure.outcome.result,
        manualOutcomeCorrelated: true,
        changedIntentRejected: true,
        unhandledCode,
    })}\n`,
);
