import { deepFreeze } from "./config-value-readers.ts";

/**
 * Immutable compatibility contract implemented by kernel ABI v0 and store schema v2.
 *
 * These values define historical identities. They are intentionally code constants:
 * changing the active protocol requires adding a new ABI or migration contract.
 */
export const KERNEL_ABI_V0_CONTRACT = deepFreeze({
    abiVersion: "shepherd.kernel.abi.v0",
    appendIntentDigestAlgorithm: "sha256",
    artifacts: {
        appendBatchDraftSchema: "spec/schemas/append-batch-draft-v0.schema.json",
        recordBodySchema: "spec/schemas/record-body-v0.schema.json",
        recordEnvelopeSchema: "spec/schemas/record-envelope-v0.schema.json",
        recordValues: "src/protocol/values.generated.ts",
        recordViewSchema: "spec/schemas/record-view-v0.schema.json",
    },
    canonicalVersion: "shepherd.kernel.canonical.v2",
    recordId: {
        algorithm: "sha256",
        hexLength: 64,
        prefix: "sha256:",
    },
    recordKind: "record",
    recordModes: ["capture", "declaration"],
    rootWitness: {
        body: {
            active_binding_refs: [],
            actor_ref: "kernel:root",
            authority_refs: [],
            containment: "full",
            provenance_policy_refs: [],
            semantic_environment_refs: [],
            substrate_ref: "kernel",
            visibility_policy_refs: [],
        },
        mode: "capture",
        schemaRef: "kernel.witness.root.v1",
        witnessRef: "",
    },
    schemas: {
        appendBatchDraftId:
            "https://avnionur.github.io/shepherd-typescript/schemas/append-batch-draft-v0.schema.json",
        dialect: "https://json-schema.org/draft/2020-12/schema",
        recordBodyId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-body-v0.schema.json",
        recordEnvelopeId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-envelope-v0.schema.json",
        recordViewId:
            "https://avnionur.github.io/shepherd-typescript/schemas/record-view-v0.schema.json",
    },
    store: {
        blobs: {
            digestAlgorithm: "sha256",
            directorySuffix: ".blobs",
            fanoutCharacters: 2,
            fsync: true,
            hexLength: 64,
            idPrefix: "sha256:",
            receiptVersion: 1,
        },
        migrations: [
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 1,
            },
            {
                firstOwnerOrdinal: 0,
                lastOwnerOrdinal: 9_007_199_254_740_990,
                version: 2,
            },
        ],
        schemaVersion: 2,
    },
} as const);
