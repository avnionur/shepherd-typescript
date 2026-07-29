import { kernelProtocolConfig } from "../protocol/config.ts";
import { createRecordEnvelope } from "./envelope.ts";
import type { RecordBody, RecordEnvelope, RecordMode } from "./types.ts";

type RootWitnessRecord = {
    readonly body: RecordBody;
    readonly envelope: RecordEnvelope;
};

/**
 * Creates the root witness record declared by the protocol configuration.
 *
 * @internal
 */
export function createConfiguredRootWitness(): RootWitnessRecord {
    const root = kernelProtocolConfig.rootWitness;
    const body = root.body as unknown as RecordBody;
    return {
        body,
        envelope: createRecordEnvelope({
            body,
            mode: root.mode as RecordMode,
            schema_ref: root.schemaRef,
            witness_ref: root.witnessRef,
        }),
    };
}

/**
 * Content-addressed identifier of the configured root witness.
 *
 * Use this identifier as `witness_ref` until a more specific witness record is
 * available.
 *
 * @public
 */
export const ROOT_WITNESS_ID = createConfiguredRootWitness().envelope.record_id;
