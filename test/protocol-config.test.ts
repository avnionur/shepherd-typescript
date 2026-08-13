import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    EXECUTION_HISTORY_PROJECTION_V1_CONTRACT,
    FORMAL_ASSURANCE_V1_CONTRACT,
    KERNEL_ABI_V0_CONTRACT,
    TASK_PROTOCOL_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V2_CONTRACT,
    WORKSPACE_PROTOCOL_V3_CONTRACT,
    WORKSPACE_PROTOCOL_V4_CONTRACT,
    WORKSPACE_PROTOCOL_V5_CONTRACT,
    WORKSPACE_PROTOCOL_V6_CONTRACT,
    WORKSPACE_PROTOCOL_V7_CONTRACT,
    WORKSPACE_PROTOCOL_V8_CONTRACT,
    WORKSPACE_PROTOCOL_V9_CONTRACT,
} from "../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../src/protocol/config-validation.ts";

type Mutation = (config: Record<string, unknown>) => void;

const validConfig = JSON.parse(
    readFileSync(new URL("../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("protocol configuration validates and freezes every critical section", () => {
    const config = structuredClone(validConfig);
    const parsed = parseProtocolConfig(config, {
        expectedRecordModes: ["capture", "declaration"],
    });

    assert.equal(parsed.recordId.algorithm, "sha256");
    assert.equal(parsed.kernel.store.transactionMode, "IMMEDIATE");
    assert.equal(parsed.kernel.store.blobs.fanoutCharacters, 2);
    assert.equal(parsed.kernel.store.blobs.defaultCollectionMode, "inspect");
    assert.equal(parsed.kernel.store.defensive, true);
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.kernel.store), true);
    assert.equal(Object.isFrozen(parsed.kernel.store.migrations), true);
    assert.equal(parsed.projections.executionHistory.modeRequirement, "both");
    assert.equal(Object.isFrozen(parsed.projections.executionHistory), true);
    assert.equal(Object.isFrozen(KERNEL_ABI_V0_CONTRACT), true);
    assert.equal(Object.isFrozen(KERNEL_ABI_V0_CONTRACT.store.migrations), true);
    assert.equal(Object.isFrozen(EXECUTION_HISTORY_PROJECTION_V1_CONTRACT), true);
    assert.equal(parsed.tasks.compatibilityVersion, "shepherd.tasks.v1");
    assert.equal(parsed.tasks.registry.schemaVersion, 1);
    assert.equal(parsed.tasks.registry.transactionMode, "IMMEDIATE");
    assert.equal(Object.isFrozen(parsed.tasks.registry.migrations), true);
    assert.equal(Object.isFrozen(parsed.tasks), true);
    assert.equal(Object.isFrozen(TASK_PROTOCOL_V1_CONTRACT), true);
    assert.equal(parsed.formalAssurance.referenceMachine.rootBranchRef, "branch:root");
    assert.equal(parsed.formalAssurance.proofEnvelope.runtimeOnlyProfile, "runtime_only");
    assert.equal(Object.isFrozen(parsed.formalAssurance), true);
    assert.equal(Object.isFrozen(FORMAL_ASSURANCE_V1_CONTRACT), true);
    assert.equal(parsed.workspaces.defaultAdoptionMode, "worktree");
    assert.equal(parsed.workspaces.bindingVersion, 2);
    assert.equal(parsed.workspaces.carrier.descriptorVersion, 1);
    assert.equal(parsed.workspaces.gitCustody.version, 4);
    assert.equal(parsed.workspaces.changesets.version, 5);
    assert.equal(parsed.workspaces.worldCapture.version, 6);
    assert.equal(parsed.workspaces.worldExecution.runnerVersion, 7);
    assert.equal(parsed.workspaces.worldTaskCapture.version, 8);
    assert.equal(parsed.workspaces.worldTaskCapture.journalVersion, 9);
    assert.equal(Object.isFrozen(parsed.workspaces), true);
    assert.equal(Object.isFrozen(parsed.workspaces.bindingErrors), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V1_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V2_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V3_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V4_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V5_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V6_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V7_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V8_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V9_CONTRACT), true);
    assert.equal("journalPhases" in WORKSPACE_PROTOCOL_V8_CONTRACT.worldTaskCapture, false);
    assert.equal("bindingErrors" in WORKSPACE_PROTOCOL_V1_CONTRACT, false);
    assert.equal("carrier" in WORKSPACE_PROTOCOL_V2_CONTRACT, false);
    assert.equal("gitCustody" in WORKSPACE_PROTOCOL_V3_CONTRACT, false);
    assert.equal("changesets" in WORKSPACE_PROTOCOL_V4_CONTRACT, false);
    assert.equal("worldCapture" in WORKSPACE_PROTOCOL_V5_CONTRACT, false);
    assert.equal("worldExecution" in WORKSPACE_PROTOCOL_V6_CONTRACT, false);
    assert.equal("worldTaskCapture" in WORKSPACE_PROTOCOL_V7_CONTRACT, false);
    assert.notEqual(
        parsed.kernel.rootWitness.body,
        objectAt(objectAt(config, "kernel"), "rootWitness").body,
    );
    assert.throws(
        () =>
            parseProtocolConfig(structuredClone(validConfig), {
                expectedRecordModes: ["capture"],
            }),
        /generated constants/,
    );
});

test("protocol configuration rejects invalid record identity and kernel constants", () => {
    assertInvalid([
        (config) => {
            objectAt(config, "recordId").algorithm = "md5";
        },
        (config) => {
            objectAt(config, "recordId").hexLength = 63;
        },
        (config) => {
            objectAt(config, "recordId").prefix = "";
        },
        (config) => {
            objectAt(config, "recordId").prefix = "digest:";
        },
        (config) => {
            const recordId = objectAt(config, "recordId");
            recordId.algorithm = "sha512";
            recordId.hexLength = 128;
            recordId.prefix = "sha512:";
        },
        (config) => {
            objectAt(config, "kernel").abiVersion = "";
        },
        (config) => {
            objectAt(config, "kernel").abiVersion = "shepherd.kernel.abi.v1";
        },
        (config) => {
            objectAt(config, "kernel").canonicalVersion = "";
        },
        (config) => {
            objectAt(config, "kernel").recordKind = "";
        },
        (config) => {
            objectAt(config, "kernel").recordModes = [];
        },
        (config) => {
            objectAt(config, "kernel").recordModes = null;
        },
        (config) => {
            objectAt(config, "kernel").recordModes = ["capture", "capture"];
        },
        (config) => {
            objectAt(config, "kernel").recordModes = ["capture", 1];
        },
    ]);
});

test("protocol configuration rejects invalid append and migration bounds", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").firstOwnerOrdinal = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").lastOwnerOrdinal = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").lastOwnerOrdinal =
                Number.MAX_SAFE_INTEGER;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").schemaVersion = 0;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").migrations = [];
        },
        (config) => {
            firstMigrationOf(config).version = 2;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").schemaVersion = 6;
        },
        (config) => {
            firstMigrationOf(config).firstOwnerOrdinal = 1;
        },
        (config) => {
            firstMigrationOf(config).lastOwnerOrdinal = Number.MAX_SAFE_INTEGER;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "append").firstOwnerOrdinal = 5;
            firstMigrationOf(config).firstOwnerOrdinal = 5;
        },
    ]);
});

test("protocol configuration rejects weakened or unsafe store settings", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").appendIntentDigestAlgorithm = "md5";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").appendIntentDigestAlgorithm = "sha512";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").busyTimeoutMilliseconds = -1;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").busyTimeoutMilliseconds = 1.5;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").defensive = false;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").foreignKeys = false;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").journalMode = "WAL; DROP TABLE records";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").synchronous = "NORMAL";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "store").transactionMode = "DEFERRED";
        },
        (config) => {
            blobConfigOf(config).digestAlgorithm = "md5";
        },
        (config) => {
            blobConfigOf(config).digestAlgorithm = "sha512";
            blobConfigOf(config).hexLength = 128;
            blobConfigOf(config).idPrefix = "sha512:";
        },
        (config) => {
            blobConfigOf(config).hexLength = 63;
        },
        (config) => {
            blobConfigOf(config).idPrefix = "blob:";
        },
        (config) => {
            blobConfigOf(config).fanoutCharacters = 0;
        },
        (config) => {
            blobConfigOf(config).fanoutCharacters = 64;
        },
        (config) => {
            blobConfigOf(config).fsync = false;
        },
        (config) => {
            blobConfigOf(config).directorySuffix = "../blobs";
        },
        (config) => {
            blobConfigOf(config).directorySuffix = ".blob\u0000s";
        },
        (config) => {
            blobConfigOf(config).receiptVersion = 0;
        },
        (config) => {
            blobConfigOf(config).receiptVersion = 2;
        },
        (config) => {
            blobConfigOf(config).collectionModes = [];
        },
        (config) => {
            blobConfigOf(config).collectionModes = ["inspect", "delete", "archive"];
        },
        (config) => {
            blobConfigOf(config).defaultCollectionMode = "unknown";
        },
        (config) => {
            blobConfigOf(config).defaultCollectionMode = "delete";
        },
        (config) => {
            blobConfigOf(config).temporaryFilePrefix = "";
        },
        (config) => {
            blobConfigOf(config).temporaryFilePrefix = "../temporary";
        },
        (config) => {
            blobConfigOf(config).temporaryFilePrefix = ".partial-";
        },
    ]);
});

test("protocol configuration rejects invalid root witnesses and JSON bodies", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").mode = "unknown";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").witnessRef = "not-empty";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").schemaRef = "";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "rootWitness").body = null;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                Number.NaN;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                undefined;
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").invalid =
                "\uD800";
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body").complex = {
                enabled: true,
                list: ["value"],
                optional: null,
                ratio: 1,
            };
        },
        (config) => {
            Object.defineProperty(
                objectAt(objectAt(objectAt(config, "kernel"), "rootWitness"), "body"),
                "\uD800",
                { enumerable: true, value: "invalid-key" },
            );
        },
    ]);
});

test("protocol configuration rejects invalid or drifted query contracts", () => {
    assertInvalid([
        (config) => {
            queryConfigOf(config).closurePolicies = [];
        },
        (config) => {
            queryConfigOf(config).modeFilters = ["both", "both"];
        },
        (config) => {
            queryConfigOf(config).visibilityProfiles = ["payload", 1];
        },
        (config) => {
            queryConfigOf(config).defaultClosurePolicy = "unknown";
        },
        (config) => {
            queryConfigOf(config).defaultModeFilter = "unknown";
        },
        (config) => {
            queryConfigOf(config).defaultVisibilityProfile = "unknown";
        },
        (config) => {
            queryConfigOf(config).cutSchemaRef = "";
        },
        (config) => {
            queryConfigOf(config).witnessSchemaRef = "changed.witness.v1";
        },
    ]);
});

test("protocol configuration rejects invalid or drifted interchange contracts", () => {
    assertInvalid([
        (config) => {
            interchangeConfigOf(config).blobEncoding = "hex";
        },
        (config) => {
            interchangeConfigOf(config).format = "";
        },
        (config) => {
            interchangeConfigOf(config).format = "changed.trace.archive";
        },
        (config) => {
            interchangeConfigOf(config).formatVersion = 0;
        },
        (config) => {
            interchangeConfigOf(config).formatVersion = 2;
        },
    ]);
});

test("protocol configuration rejects invalid or drifted projection contracts", () => {
    assertInvalid([
        (config) => {
            projectionConfigOf(config).modeRequirement = "captures_only";
        },
        (config) => {
            projectionConfigOf(config).modeRequirement = "unknown";
        },
        (config) => {
            projectionConfigOf(config).payloadVisibilityProfiles = [];
        },
        (config) => {
            projectionConfigOf(config).payloadVisibilityProfiles = ["payload", "unknown"];
        },
        (config) => {
            projectionConfigOf(config).relationKinds = ["spawned", "spawned"];
        },
        (config) => {
            projectionConfigOf(config).activeRelationKinds = ["unknown"];
        },
        (config) => {
            projectionConfigOf(config).publishedRecordSchemaRef = "";
        },
        (config) => {
            projectionConfigOf(config).relationSchemaRef = "changed.relation.v1";
        },
        (config) => {
            objectAt(projectionConfigOf(config), "executionSchemas").completed = "";
        },
        (config) => {
            objectAt(projectionConfigOf(config), "executionSchemas").created =
                "changed.execution.created.v1";
        },
        (config) => {
            objectAt(config, "projections").extra = true;
        },
    ]);
});

test("protocol configuration rejects invalid schema, artifact, and object shapes", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "kernel"), "schemas").dialect = "relative";
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "schemas").dialect =
                "http://json-schema.org/draft-07/schema#";
        },
        (config) => {
            const schemas = objectAt(objectAt(config, "kernel"), "schemas");
            schemas.recordViewId = schemas.recordBodyId;
        },
        (config) => {
            objectAt(objectAt(config, "kernel"), "artifacts").recordValues = "";
        },
        (config) => {
            config.extra = true;
        },
        (config) => {
            delete config.kernel;
        },
        (config) => {
            config.kernel = [];
        },
    ]);
    assert.throws(() => parseProtocolConfig(null), /must be an object/);
});

test("protocol configuration rejects invalid or drifted task contracts", () => {
    assertInvalid([
        (config) => {
            taskConfigOf(config).artifactLockVersion = 0;
        },
        (config) => {
            taskConfigOf(config).descriptorVersion = 2;
        },
        (config) => {
            taskConfigOf(config).compatibilityVersion = "";
        },
        (config) => {
            taskConfigOf(config).digestAlgorithm = "md5";
        },
        (config) => {
            taskConfigOf(config).digestPrefix = "";
        },
        (config) => {
            taskConfigOf(config).hexLength = 63;
        },
        (config) => {
            taskConfigOf(config).taskIdPrefix = "task:";
        },
        (config) => {
            objectAt(taskConfigOf(config), "schemas").descriptorId = "relative";
        },
        (config) => {
            objectAt(taskConfigOf(config), "artifacts").descriptorSchema = "";
        },
        (config) => {
            objectAt(taskConfigOf(config), "artifacts").descriptorSchema = objectAt(
                objectAt(config, "kernel"),
                "artifacts",
            ).recordBodySchema;
        },
        (config) => {
            taskConfigOf(config).extra = true;
        },
        (config) => {
            taskRegistryConfigOf(config).busyTimeoutMilliseconds = -1;
        },
        (config) => {
            taskRegistryConfigOf(config).defaultDatabasePath = "";
        },
        (config) => {
            taskRegistryConfigOf(config).defensive = false;
        },
        (config) => {
            taskRegistryConfigOf(config).foreignKeys = false;
        },
        (config) => {
            taskRegistryConfigOf(config).journalMode = "DELETE";
        },
        (config) => {
            taskRegistryConfigOf(config).migrations = [];
        },
        (config) => {
            taskRegistryConfigOf(config).migrations = [2];
        },
        (config) => {
            taskRegistryConfigOf(config).migrations = [1, 2];
        },
        (config) => {
            taskRegistryConfigOf(config).schemaVersion = 0;
        },
        (config) => {
            taskRegistryConfigOf(config).schemaVersion = 2;
        },
        (config) => {
            taskRegistryConfigOf(config).synchronous = "NORMAL";
        },
        (config) => {
            taskRegistryConfigOf(config).transactionMode = "DEFERRED";
        },
    ]);
});

test("protocol configuration rejects invalid or drifted formal assurance contracts", () => {
    assertInvalid([
        (config) => {
            proofEnvelopeConfigOf(config).digestAlgorithm = "md5";
        },
        (config) => {
            proofEnvelopeConfigOf(config).hexLength = 63;
        },
        (config) => {
            proofEnvelopeConfigOf(config).profiles = [];
        },
        (config) => {
            proofEnvelopeConfigOf(config).profiles = ["runtime_only", "runtime_only"];
        },
        (config) => {
            proofEnvelopeConfigOf(config).strengths = [];
        },
        (config) => {
            proofEnvelopeConfigOf(config).runtimeOnlyProfile = "unknown";
        },
        (config) => {
            proofEnvelopeConfigOf(config).referenceValidatedProfile = "runtime_only";
        },
        (config) => {
            proofEnvelopeConfigOf(config).referenceValidatedStrength = "unknown";
        },
        (config) => {
            proofEnvelopeConfigOf(config).referenceValidatedStrength = "runtime_only";
        },
        (config) => {
            proofEnvelopeConfigOf(config).evidenceRefPrefix = "proof-evidence:md5:";
        },
        (config) => {
            proofEnvelopeConfigOf(config).programRefPrefix =
                proofEnvelopeConfigOf(config).evidenceRefPrefix;
        },
        (config) => {
            objectAt(proofEnvelopeConfigOf(config), "traceRefPrefixes").completed = "trace:";
        },
        (config) => {
            objectAt(proofEnvelopeConfigOf(config), "traceRefPrefixes").prefix = objectAt(
                proofEnvelopeConfigOf(config),
                "traceRefPrefixes",
            ).completed;
        },
        (config) => {
            proofEnvelopeConfigOf(config).excludedRuntimeSurfaces = [];
        },
        (config) => {
            proofEnvelopeConfigOf(config).excludedRuntimeSurfaces = ["retries", "retries"];
        },
        (config) => {
            proofEnvelopeConfigOf(config).schemaVersion = "";
        },
        (config) => {
            proofEnvelopeConfigOf(config).validator = "another-valid-validator";
        },
        (config) => {
            objectAt(proofEnvelopeConfigOf(config), "validationOperations").completed = "";
        },
        (config) => {
            objectAt(proofEnvelopeConfigOf(config), "validationOperations").extra = true;
        },
        (config) => {
            proofEnvelopeConfigOf(config).extra = true;
        },
        (config) => {
            referenceMachineConfigOf(config).actionKinds = [];
        },
        (config) => {
            referenceMachineConfigOf(config).continuationDispositions = ["completed"];
        },
        (config) => {
            referenceMachineConfigOf(config).closureReasons = ["abandoned", "abandoned"];
        },
        (config) => {
            referenceMachineConfigOf(config).pathPrefix = "";
        },
        (config) => {
            referenceMachineConfigOf(config).rootBranchRef = "";
        },
        (config) => {
            referenceMachineConfigOf(config).resumptionSourceRecordType = "unknown";
        },
        (config) => {
            objectAt(referenceMachineConfigOf(config), "recordTypes").capture = "";
        },
        (config) => {
            const types = objectAt(referenceMachineConfigOf(config), "recordTypes");
            types.capture = types.declaration;
        },
        (config) => {
            referenceMachineConfigOf(config).extra = true;
        },
        (config) => {
            strongEvidenceConfigOf(config).extra = true;
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "lowering").contentRefPrefix = objectAt(
                strongEvidenceConfigOf(config),
                "core0hSidecar",
            ).contentRefPrefix;
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "lowering").trustedManifestRefs = [];
        },
        (config) => {
            const lowering = objectAt(strongEvidenceConfigOf(config), "lowering");
            lowering.trustedManifestRefs = ["proof-lowering:not-a-digest"];
        },
        (config) => {
            const sidecar = objectAt(strongEvidenceConfigOf(config), "core0hSidecar");
            const ref = `core0h-sidecar:sha256:${"0".repeat(64)}`;
            sidecar.trustedManifestRefs = [ref, ref];
        },
        (config) => {
            objectAt(objectAt(strongEvidenceConfigOf(config), "lowering"), "oracle").path = "";
        },
        (config) => {
            objectAt(objectAt(strongEvidenceConfigOf(config), "lowering"), "oracle").extra = true;
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "core0hSidecar").extra = true;
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "theoremArtifact").metadataRef =
                `proof-artifact:sha256:${"0".repeat(64)}`;
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "theoremArtifact").metadataRefPrefix =
                "proof-artifact:md5:";
        },
        (config) => {
            const artifact = objectAt(strongEvidenceConfigOf(config), "theoremArtifact");
            artifact.extensionTheoremIds = [(artifact.theoremIds as unknown[])[0]];
        },
        (config) => {
            objectAt(strongEvidenceConfigOf(config), "theoremArtifact").theoremIds = [];
        },
        (config) => {
            strongClaimAt(config, 0).theoremIds = ["unknown"];
        },
        (config) => {
            strongClaimAt(config, 0).forbiddenActionKinds = ["unknown"];
        },
        (config) => {
            strongClaimAt(config, 0).forbiddenActionKinds = ["abort", "abort"];
        },
        (config) => {
            strongClaimAt(config, 1).forbiddenActionKinds = ["abort"];
        },
        (config) => {
            strongClaimAt(config, 0).requiresCore0hSidecar = "yes";
        },
        (config) => {
            strongClaimAt(config, 0).assumptions = ["same", "same"];
        },
        (config) => {
            const strong = strongEvidenceConfigOf(config);
            strong.profileClaims = [];
        },
        (config) => {
            strongClaimAt(config, 1).profile = strongClaimAt(config, 0).profile;
        },
        (config) => {
            objectAt(config, "formalAssurance").extra = true;
        },
    ]);
});

test("protocol configuration rejects invalid or drifted workspace contracts", () => {
    assertInvalid([
        (config) => {
            workspaceConfigOf(config).adoptionModes = [];
        },
        (config) => {
            workspaceConfigOf(config).bindingIdentityKind = "";
        },
        (config) => {
            workspaceConfigOf(config).bindingVersion = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "bindingErrors").invalidNameCode = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "bindingErrors").extra = true;
        },
        (config) => {
            carrierConfigOf(config).blobIdPrefix = "blob:md5:";
        },
        (config) => {
            carrierConfigOf(config).custodiesDirectory = carrierConfigOf(config).revisionsDirectory;
        },
        (config) => {
            carrierConfigOf(config).carrierDirectory = workspaceConfigOf(config).manifestFile;
        },
        (config) => {
            carrierConfigOf(config).discardDescriptorSuffix = "../discarded";
        },
        (config) => {
            gitCustodyConfigOf(config).basisIdPrefix = "git-basis:md5:";
        },
        (config) => {
            gitCustodyConfigOf(config).objectFormats = [];
        },
        (config) => {
            gitCustodyConfigOf(config).descriptorFile = "../output.json";
        },
        (config) => {
            changesetConfigOf(config).idPrefix = "world-changeset:md5:";
        },
        (config) => {
            changesetConfigOf(config).operations = [];
        },
        (config) => {
            changesetConfigOf(config).maxChanges = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldCapture").maxRevisionDepth = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldExecution").enforcementKinds = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldExecution").maxRunnerIdBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").statuses = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").maxTextBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").maxCaptureIdBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").journalPhases = [];
        },
        (config) => {
            workspaceConfigOf(config).adoptionModes = ["none", "none"];
        },
        (config) => {
            workspaceConfigOf(config).defaultAdoptionMode = "unknown";
        },
        (config) => {
            workspaceConfigOf(config).defaultInitializeGit = "yes";
        },
        (config) => {
            workspaceConfigOf(config).defaultInitializeGit = false;
        },
        (config) => {
            workspaceConfigOf(config).digestAlgorithm = "md5";
        },
        (config) => {
            workspaceConfigOf(config).hexLength = 63;
        },
        (config) => {
            workspaceConfigOf(config).worktreeRefPrefix = "worktree:";
        },
        (config) => {
            workspaceConfigOf(config).controlDirectory = "";
        },
        (config) => {
            workspaceConfigOf(config).controlDirectory = ".";
        },
        (config) => {
            workspaceConfigOf(config).controlDirectory = "..";
        },
        (config) => {
            workspaceConfigOf(config).controlDirectory = "unsafe/path";
        },
        (config) => {
            workspaceConfigOf(config).manifestFile = "unsafe\\path";
        },
        (config) => {
            workspaceConfigOf(config).gitMetadataName = "../git";
        },
        (config) => {
            workspaceConfigOf(config).gitMetadataName = "unsafe\0name";
        },
        (config) => {
            workspaceConfigOf(config).controlDirectory = workspaceConfigOf(config).gitMetadataName;
        },
        (config) => {
            workspaceConfigOf(config).manifestFile = workspaceConfigOf(config).controlDirectory;
        },
        (config) => {
            workspaceConfigOf(config).format = "";
        },
        (config) => {
            workspaceConfigOf(config).formatVersion = 0;
        },
        (config) => {
            workspaceConfigOf(config).gitExecutable = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "errors").controlCode = "";
        },
        (config) => {
            workspaceConfigOf(config).extra = true;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "errors").extra = true;
        },
    ]);
});

function assertInvalid(mutations: readonly Mutation[]): void {
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config);
        assert.throws(() => parseProtocolConfig(config), TypeError);
    }
}

function queryConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "kernel"), "queries");
}

function projectionConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "projections"), "executionHistory");
}

function interchangeConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "kernel"), "interchange");
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
    return value[key] as Record<string, unknown>;
}

function migrationsOf(config: Record<string, unknown>): Record<string, unknown>[] {
    return objectAt(objectAt(config, "kernel"), "store").migrations as Record<string, unknown>[];
}

function firstMigrationOf(config: Record<string, unknown>): Record<string, unknown> {
    const [migration] = migrationsOf(config);
    if (migration === undefined) {
        throw new Error("test fixture must contain a migration");
    }
    return migration;
}

function blobConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "kernel"), "store").blobs as Record<string, unknown>;
}

function taskConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(config, "tasks");
}

function taskRegistryConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(taskConfigOf(config), "registry");
}

function workspaceConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(config, "workspaces");
}

function carrierConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(workspaceConfigOf(config), "carrier");
}

function gitCustodyConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(workspaceConfigOf(config), "gitCustody");
}

function changesetConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(workspaceConfigOf(config), "changesets");
}

function proofEnvelopeConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "formalAssurance"), "proofEnvelope");
}

function referenceMachineConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "formalAssurance"), "referenceMachine");
}

function strongEvidenceConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "formalAssurance"), "strongEvidence");
}

function strongClaimAt(config: Record<string, unknown>, index: number): Record<string, unknown> {
    const claims = strongEvidenceConfigOf(config).profileClaims;
    assert.ok(Array.isArray(claims));
    const claim = claims[index];
    assert.ok(claim !== null && typeof claim === "object" && !Array.isArray(claim));
    return claim as Record<string, unknown>;
}
