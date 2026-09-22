import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REQUIRED_KERNEL_FRAMING_DEPTH } from "../src/canonical/framing.ts";
import {
    DELEGATION_PROTOCOL_V1_CONTRACT,
    EVIDENCE_RECORD_PROJECTION_V1_CONTRACT,
    EXECUTION_HISTORY_PROJECTION_V1_CONTRACT,
    FORMAL_ASSURANCE_V1_CONTRACT,
    KERNEL_ABI_V0_CONTRACT,
    KERNEL_ABI_V0_STORE_V7_CONTRACT,
    PROVIDER_PROTOCOL_V1_CONTRACT,
    TASK_PROTOCOL_V1_CONTRACT,
    TASK_RUN_LEDGER_PROJECTION_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V1_CONTRACT,
    WORKSPACE_PROTOCOL_V2_CONTRACT,
    WORKSPACE_PROTOCOL_V3_CONTRACT,
    WORKSPACE_PROTOCOL_V4_CONTRACT,
    WORKSPACE_PROTOCOL_V5_CONTRACT,
    WORKSPACE_PROTOCOL_V6_CONTRACT,
    WORKSPACE_PROTOCOL_V7_CONTRACT,
    WORKSPACE_PROTOCOL_V8_CONTRACT,
    WORKSPACE_PROTOCOL_V9_CONTRACT,
    WORKSPACE_PROTOCOL_V10_CONTRACT,
    WORKSPACE_PROTOCOL_V11_CONTRACT,
    WORKSPACE_PROTOCOL_V12_CONTRACT,
    WORKSPACE_PROTOCOL_V13_CONTRACT,
    WORKSPACE_PROTOCOL_V14_CONTRACT,
    WORKSPACE_PROTOCOL_V15_CONTRACT,
    WORKSPACE_PROTOCOL_V16_CONTRACT,
    WORKSPACE_PROTOCOL_V17_CONTRACT,
    WORKSPACE_PROTOCOL_V18_CONTRACT,
    WORKSPACE_PROTOCOL_V19_CONTRACT,
    WORKSPACE_PROTOCOL_V20_CONTRACT,
    WORKSPACE_PROTOCOL_V21_CONTRACT,
    WORKSPACE_PROTOCOL_V22_CONTRACT,
    WORKSPACE_PROTOCOL_V24_CONTRACT,
    WORKSPACE_PROTOCOL_V25_CONTRACT,
    WORKSPACE_PROTOCOL_V26_CONTRACT,
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
    assert.equal(Object.isFrozen(KERNEL_ABI_V0_STORE_V7_CONTRACT), true);
    assert.equal(Object.isFrozen(EXECUTION_HISTORY_PROJECTION_V1_CONTRACT), true);
    assert.equal(
        parsed.projections.evidenceRecords.compatibilityVersion,
        "shepherd.output-trace-recovery.v1",
    );
    assert.equal(parsed.projections.evidenceRecords.latestSelector, "@latest");
    assert.equal(Object.isFrozen(parsed.projections.evidenceRecords), true);
    assert.equal(Object.isFrozen(EVIDENCE_RECORD_PROJECTION_V1_CONTRACT), true);
    assert.equal(parsed.projections.taskRunLedgers.latestSelector, "@latest");
    assert.equal(parsed.projections.taskRunLedgers.taskVersionSeparator, "@");
    assert.equal(parsed.projections.taskRunLedgers.defaultPageSize, 50);
    assert.equal(Object.isFrozen(parsed.projections.taskRunLedgers), true);
    assert.equal(Object.isFrozen(TASK_RUN_LEDGER_PROJECTION_V1_CONTRACT), true);
    assert.equal(parsed.tasks.compatibilityVersion, "shepherd.tasks.v1");
    assert.equal(parsed.tasks.registry.schemaVersion, 1);
    assert.equal(parsed.tasks.registry.transactionMode, "IMMEDIATE");
    assert.equal(Object.isFrozen(parsed.tasks.registry.migrations), true);
    assert.equal(Object.isFrozen(parsed.tasks), true);
    assert.equal(Object.isFrozen(TASK_PROTOCOL_V1_CONTRACT), true);
    assert.deepEqual(parsed.tasks, TASK_PROTOCOL_V1_CONTRACT);
    assert.match(parsed.tasks.schemas.valueId, /task-value-v1\.schema\.json$/u);
    assert.deepEqual(parsed.providers, PROVIDER_PROTOCOL_V1_CONTRACT);
    assert.deepEqual(parsed.providers.kinds, ["static", "program"]);
    assert.equal(parsed.providers.program.kind, "program");
    assert.equal(Object.isFrozen(parsed.providers.program), true);
    assert.deepEqual(parsed.delegation, DELEGATION_PROTOCOL_V1_CONTRACT);
    assert.equal(parsed.delegation.compatibilityVersion, "shepherd.delegation.v1");
    assert.equal(parsed.delegation.recordVersion, 1);
    assert.deepEqual(parsed.delegation.parentKinds, ["root", "handle"]);
    assert.deepEqual(parsed.delegation.executionKinds, ["provider", "program"]);
    assert.deepEqual(parsed.delegation.provenanceKinds, ["declared", "revised", "synthesized"]);
    assert.deepEqual(parsed.delegation.statuses, [
        "ready",
        "running",
        "settling",
        "approval_pending",
        "rejected",
        "accepted",
        "discarded",
    ]);
    assert.equal(parsed.delegation.identity.handleIdPrefix, "delegation:sha256:");
    assert.equal(parsed.delegation.identity.childRunIdPrefix, "delegation-run:sha256:");
    assert.equal(parsed.delegation.limits.maxNestingDepth, 16);
    assert.equal(parsed.delegation.limits.maxTreeEntries, 256);
    assert.deepEqual(parsed.delegation.treeRootKinds, ["handle", "supervisor"]);
    assert.equal(Object.isFrozen(parsed.delegation), true);
    assert.equal(Object.isFrozen(parsed.delegation.limits), true);
    assert.equal(Object.isFrozen(DELEGATION_PROTOCOL_V1_CONTRACT), true);
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
    assert.equal(parsed.workspaces.worldTaskCapture.journalVersion, 12);
    assert.deepEqual(
        parsed.workspaces.worldTaskCapture.journalReaders.map(({ version }) => version),
        [9, 10, 11, 12],
    );
    assert.match(parsed.workspaces.worldTaskCapture.journalSchemaId, /v4/u);
    assert.equal(parsed.workspaces.placements.nativeJails.journalVersion, 12);
    assert.equal(parsed.workspaces.placements.nativeJails.enforcement, "native-syscall-deny");
    assert.equal(Object.isFrozen(parsed.workspaces.placements.nativeJails), true);
    assert.equal(parsed.workspaces.worldTaskCapture.custodyIdentityKind, "task-world-custody");
    assert.equal(parsed.workspaces.settlement.version, 12);
    assert.equal(parsed.workspaces.settlement.operationVersion, 1);
    assert.equal(parsed.workspaces.settlement.receiptVersion, 1);
    assert.deepEqual(parsed.workspaces.settlement.actions, [
        "select",
        "discard",
        "apply",
        "release",
    ]);
    assert.deepEqual(parsed.workspaces.settlement.states, [
        "prepared",
        "applying",
        "selected",
        "discarded",
        "applied",
        "released",
    ]);
    assert.deepEqual(parsed.workspaces.settlement.application.reasons, [
        "unmoved-parent",
        "path-disjoint",
    ]);
    assert.equal(Object.isFrozen(parsed.workspaces.settlement.application), true);
    assert.equal(parsed.workspaces.settlement.release.receiptVersion, 1);
    assert.equal(Object.isFrozen(parsed.workspaces.settlement.release), true);
    assert.equal(parsed.workspaces.selectionPublication.version, 16);
    assert.equal(parsed.workspaces.selectionPublication.planVersion, 1);
    assert.equal(parsed.workspaces.selectionPublication.stepVersion, 1);
    assert.equal(parsed.workspaces.selectionPublication.publicationVersion, 1);
    assert.equal(parsed.workspaces.selectionPublication.scheduleVersion, 1);
    assert.equal(parsed.workspaces.selectionPublication.scheduledStepVersion, 1);
    assert.equal(parsed.workspaces.selectionPublication.scheduledPublicationVersion, 1);
    assert.equal(parsed.workspaces.protectedPaths.version, 18);
    assert.equal(parsed.workspaces.platformConformance.version, 19);
    assert.equal(parsed.workspaces.repositoryBindings.version, 1);
    assert.equal(parsed.workspaces.repositoryBindings.resourceType, "git-repository");
    assert.deepEqual(parsed.workspaces.repositoryGrants.atoms, ["read", "write"]);
    assert.deepEqual(
        parsed.workspaces.repositoryGrants.profiles.map(({ name }) => name),
        ["read-only", "read-write"],
    );
    assert.equal(parsed.workspaces.repositoryGrants.enforcement, "advisory");
    assert.equal(parsed.workspaces.repositoryGrants.operations.readText, "read");
    assert.equal(parsed.workspaces.repositoryGrants.operations.writeText, "write");
    assert.deepEqual(parsed.workspaces.repositoryGrants.journalVersions, [10, 11, 12]);
    assert.equal(parsed.workspaces.repositoryGrants.journalVersion, 10);
    assert.deepEqual(parsed.workspaces.placements.requests, ["advisory", "auto", "jail"]);
    assert.deepEqual(parsed.workspaces.placements.resolvedPlacements, ["advisory"]);
    assert.deepEqual(parsed.workspaces.placements.journalVersions, [11, 12]);
    assert.equal(parsed.workspaces.placements.journalVersion, 11);
    assert.deepEqual(parsed.workspaces.placements.statuses, ["resolved", "refused"]);
    assert.equal(parsed.workspaces.placements.platform.wslFamily, "windows");
    assert.equal(Object.isFrozen(parsed.workspaces), true);
    assert.equal(Object.isFrozen(parsed.workspaces.bindingErrors), true);
    assert.equal(Object.isFrozen(parsed.workspaces.protectedPaths), true);
    assert.equal(Object.isFrozen(parsed.workspaces.repositoryBindings), true);
    assert.equal(Object.isFrozen(parsed.workspaces.repositoryGrants), true);
    assert.equal(Object.isFrozen(parsed.workspaces.placements), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V1_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V2_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V3_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V4_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V5_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V6_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V7_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V8_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V9_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V10_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V11_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V12_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V13_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V14_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V15_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V16_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V17_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V18_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V19_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V20_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V21_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V22_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V25_CONTRACT), true);
    assert.equal(Object.isFrozen(WORKSPACE_PROTOCOL_V26_CONTRACT), true);
    assert.equal("carrierBackends" in WORKSPACE_PROTOCOL_V25_CONTRACT, false);
    assert.deepEqual(parsed.workspaces.carrierBackends.backends, ["copy", "clone", "overlay"]);
    assert.equal(parsed.workspaces.carrierBackends.version, 26);
    assert.equal(Object.isFrozen(parsed.workspaces.carrierBackends.overlay.tokens), true);
    assert.equal("release" in WORKSPACE_PROTOCOL_V24_CONTRACT.settlement, false);
    assert.equal("placements" in WORKSPACE_PROTOCOL_V21_CONTRACT, false);
    assert.equal("repositoryGrants" in WORKSPACE_PROTOCOL_V20_CONTRACT, false);
    assert.equal("repositoryBindings" in WORKSPACE_PROTOCOL_V19_CONTRACT, false);
    assert.equal("platformConformance" in WORKSPACE_PROTOCOL_V18_CONTRACT, false);
    assert.equal("protectedPaths" in WORKSPACE_PROTOCOL_V17_CONTRACT, false);
    assert.equal(
        "scheduledStepVersion" in WORKSPACE_PROTOCOL_V15_CONTRACT.selectionPublication,
        false,
    );
    assert.equal("scheduleKinds" in WORKSPACE_PROTOCOL_V14_CONTRACT.selectionPublication, false);
    assert.equal("selectionPublication" in WORKSPACE_PROTOCOL_V13_CONTRACT, false);
    assert.equal("operationVersion" in WORKSPACE_PROTOCOL_V12_CONTRACT.settlement, false);
    assert.equal("settlement" in WORKSPACE_PROTOCOL_V11_CONTRACT, false);
    assert.equal("custodyIdentityKind" in WORKSPACE_PROTOCOL_V9_CONTRACT.worldTaskCapture, false);
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
            objectAt(objectAt(config, "kernel"), "store").schemaVersion = 10;
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

test("protocol configuration rejects invalid store maintenance settings", () => {
    const maintenanceOf = (config: Record<string, unknown>) =>
        objectAt(objectAt(config, "kernel"), "store").maintenance as Record<string, unknown>;
    assertInvalid([
        (config) => {
            maintenanceOf(config).modes = [];
        },
        (config) => {
            maintenanceOf(config).modes = ["inspect", "compact"];
        },
        (config) => {
            maintenanceOf(config).modes = ["inspect", "inspect"];
        },
        (config) => {
            maintenanceOf(config).defaultMode = "compact";
        },
        (config) => {
            maintenanceOf(config).modes = ["checkpoint", "vacuum"];
        },
        (config) => {
            maintenanceOf(config).quickCheckMaxIssues = 0;
        },
        (config) => {
            maintenanceOf(config).walCheckpointMode = "EVERYTHING";
        },
        (config) => {
            maintenanceOf(config).walFileSuffix = "";
        },
        (config) => {
            maintenanceOf(config).walFileSuffix = "/../wal";
        },
        (config) => {
            maintenanceOf(config).extra = true;
        },
    ]);
});

test("protocol configuration rejects invalid or drifted CLI topology", () => {
    assertInvalid([
        (config) => {
            objectAt(config, "cli").groups = [];
        },
        (config) => {
            const groups = objectAt(config, "cli").groups as Record<string, unknown>[];
            groups[1] = { ...groups[0] };
        },
        (config) => {
            const exitCodes = objectAt(objectAt(config, "cli"), "exitCodes");
            exitCodes.failure = exitCodes.usage;
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "limits").defaultPageSize = 65;
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "limits").defaultRetainedReadBytes = 1_048_577;
        },
        (config) => {
            const groups = objectAt(config, "cli").groups as Record<string, unknown>[];
            const commands = groups[2]?.commands as Record<string, unknown>[];
            commands[1] = { ...commands[0] };
        },
        (config) => {
            const groups = objectAt(config, "cli").groups as Record<string, unknown>[];
            groups[0] = {
                ...groups[0],
                commands: [{ handler: "duplicate", name: "duplicate" }],
            };
        },
        (config) => {
            const groups = objectAt(config, "cli").groups as Record<string, unknown>[];
            groups[2] = { ...groups[2], commands: [] };
        },
        (config) => {
            objectAt(config, "cli").compatibilityVersion = "changed";
        },
        (config) => {
            const roles = objectAt(objectAt(config, "cli"), "handlerRoles");
            roles.doctor = roles.workspaceInit;
        },
        (config) => {
            const groups = objectAt(config, "cli").groups as Record<string, unknown>[];
            groups[0] = { ...groups[0], handler: "unknown-handler" };
        },
        (config) => {
            const options = objectAt(objectAt(config, "cli"), "options");
            options.store = options.registry;
        },
        (config) => {
            delete objectAt(objectAt(config, "cli"), "commandOptions").doctor;
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "commandOptions").doctor = {
                flags: ["store"],
                values: ["store"],
            };
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "commandOptions").doctor = {
                flags: [],
                values: ["unknown"],
            };
        },
        (config) => {
            objectAt(config, "cli").helpAliases = [];
        },
        (config) => {
            objectAt(config, "cli").helpAliases = ["--help", "--help"];
        },
        (config) => {
            const errorCodes = objectAt(
                objectAt(objectAt(config, "cli"), "machineOutput"),
                "errorCodes",
            );
            errorCodes.failure = errorCodes.usage;
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "machineOutput").maxCanonicalBytes = 0;
        },
        (config) => {
            objectAt(objectAt(config, "cli"), "machineOutput").schemaId = "relative.json";
        },
        (config) => {
            const resultShapes = objectAt(objectAt(config, "cli"), "machineOutput")
                .resultShapes as Record<string, unknown>;
            delete resultShapes.doctor;
        },
        (config) => {
            const resultShapes = objectAt(objectAt(config, "cli"), "machineOutput")
                .resultShapes as Record<string, unknown>;
            delete resultShapes.doctor;
            resultShapes.unknown = [["unknown"]];
        },
        (config) => {
            const resultShapes = objectAt(objectAt(config, "cli"), "machineOutput")
                .resultShapes as Record<string, unknown>;
            resultShapes.doctor = [["same"], ["same"]];
        },
        (config) => {
            const resultShapes = objectAt(objectAt(config, "cli"), "machineOutput")
                .resultShapes as Record<string, unknown>;
            resultShapes.doctor = [[]];
        },
        (config) => {
            const resultShapes = objectAt(objectAt(config, "cli"), "machineOutput")
                .resultShapes as Record<string, unknown>;
            resultShapes.doctor = [];
        },
        (config) => {
            const machineOutput = objectAt(objectAt(config, "cli"), "machineOutput");
            const unavailable = machineOutput.unavailableRemedies as Record<string, unknown>;
            delete unavailable["unsupported-start"];
            unavailable.doctor = "fencedStart";
        },
        (config) => {
            const unavailable = objectAt(objectAt(config, "cli"), "machineOutput")
                .unavailableRemedies as Record<string, unknown>;
            unavailable["unsupported-start"] = "packageInit";
        },
        (config) => {
            const unavailable = objectAt(objectAt(config, "cli"), "machineOutput")
                .unavailableRemedies as Record<string, unknown>;
            unavailable["unsupported-start"] = "unknown";
        },
        (config) => {
            const machineOutput = objectAt(objectAt(config, "cli"), "machineOutput");
            const resultShapes = machineOutput.resultShapes as Record<string, unknown>;
            const unavailable = machineOutput.unavailableRemedies as Record<string, unknown>;
            resultShapes["unsupported-start"] = [["unexpected_success"]];
            delete unavailable["unsupported-start"];
        },
    ]);
});

test("protocol configuration rejects invalid or drifted orphan repair contracts", () => {
    assertInvalid([
        (config) => {
            objectAt(objectAt(config, "orphanRepair"), "identity").algorithm = "md5";
        },
        (config) => {
            objectAt(objectAt(config, "orphanRepair"), "identity").hexLength = 63;
        },
        (config) => {
            objectAt(objectAt(config, "orphanRepair"), "limits").defaultPageSize = 101;
        },
        (config) => {
            objectAt(objectAt(config, "orphanRepair"), "limits").maxPageSize = 101;
        },
        (config) => {
            const blockers = objectAt(objectAt(config, "orphanRepair"), "blockers");
            blockers.scopeOwned = blockers.liveSession;
        },
        (config) => {
            objectAt(config, "orphanRepair").compatibilityVersion = "changed";
        },
        (config) => {
            const preRun = objectAt(
                objectAt(objectAt(config, "orphanRepair"), "statuses"),
                "preRun",
            );
            preRun.repaired = preRun.declined;
        },
        (config) => {
            const session = objectAt(
                objectAt(objectAt(config, "orphanRepair"), "statuses"),
                "session",
            );
            session.live = session.dead;
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
        (config) => {
            interchangeConfigOf(config).limits = null;
        },
        (config) => {
            objectAt(interchangeConfigOf(config), "limits").maxRecords = 0;
        },
        (config) => {
            objectAt(interchangeConfigOf(config), "limits").extra = 1;
        },
    ]);
});

test("protocol configuration validates the canonical nesting bound at load", () => {
    const canonicalization = (config: Record<string, unknown>) =>
        objectAt(objectAt(config, "kernel"), "canonicalization");
    assertInvalid([
        (config) => {
            delete objectAt(config, "kernel").canonicalization;
        },
        (config) => {
            objectAt(config, "kernel").canonicalization = [];
        },
        (config) => {
            canonicalization(config).extra = 1;
        },
        (config) => {
            delete canonicalization(config).framingDepth;
        },
        (config) => {
            canonicalization(config).maxNestingDepth = 0;
        },
        (config) => {
            canonicalization(config).maxNestingDepth = 1.5;
        },
        (config) => {
            canonicalization(config).maxNestingDepth = "1000";
        },
        (config) => {
            canonicalization(config).framingDepth = 0;
        },
        (config) => {
            canonicalization(config).framingDepth = -1;
        },
    ]);

    // Framing shallower than the deepest kernel frame body location would refuse a body at the
    // bound, so it is rejected at load; the minimum itself is accepted.
    const tooShallowFraming = structuredClone(validConfig);
    canonicalization(tooShallowFraming).framingDepth = REQUIRED_KERNEL_FRAMING_DEPTH - 1;
    assert.throws(
        () => parseProtocolConfig(tooShallowFraming),
        new RegExp(
            `kernel\\.canonicalization\\.framingDepth must be at least ${REQUIRED_KERNEL_FRAMING_DEPTH}`,
        ),
    );

    const configured = structuredClone(validConfig);
    canonicalization(configured).maxNestingDepth = 64;
    canonicalization(configured).framingDepth = REQUIRED_KERNEL_FRAMING_DEPTH;
    objectAt(interchangeConfigOf(configured), "limits").maxNestingDepth =
        64 + REQUIRED_KERNEL_FRAMING_DEPTH;
    const parsed = parseProtocolConfig(configured);
    assert.deepEqual(parsed.kernel.canonicalization, {
        framingDepth: REQUIRED_KERNEL_FRAMING_DEPTH,
        maxNestingDepth: 64,
    });
    assert.equal(Object.isFrozen(parsed.kernel.canonicalization), true);

    // An archive must be able to carry a body at the bound inside its framing.
    const tooShallowArchive = structuredClone(configured);
    objectAt(interchangeConfigOf(tooShallowArchive), "limits").maxNestingDepth =
        64 + REQUIRED_KERNEL_FRAMING_DEPTH - 1;
    assert.throws(
        () => parseProtocolConfig(tooShallowArchive),
        /kernel\.interchange\.limits\.maxNestingDepth must admit kernel\.canonicalization\.maxNestingDepth plus framingDepth/,
    );
});

test("interchange limits and Git invocation hardening are operational, not protocol identity", () => {
    const config = structuredClone(validConfig);
    objectAt(interchangeConfigOf(config), "limits").maxArchiveBytes = 1024;
    objectAt(interchangeConfigOf(config), "staging").directoryPrefix = "import-";
    objectAt(workspaceConfigOf(config), "gitInvocation").configOverrides = ["core.fsmonitor=false"];
    const parsed = parseProtocolConfig(config);
    assert.equal(parsed.kernel.interchange.limits.maxArchiveBytes, 1024);
    assert.equal(parsed.kernel.interchange.staging.directoryPrefix, "import-");
    for (const directoryPrefix of ["a/b", "..", ".", ""]) {
        const invalid = structuredClone(validConfig);
        objectAt(interchangeConfigOf(invalid), "staging").directoryPrefix = directoryPrefix;
        assert.throws(() => parseProtocolConfig(invalid), TypeError, directoryPrefix);
    }
    assert.deepEqual(parsed.workspaces.gitInvocation.configOverrides, ["core.fsmonitor=false"]);
    assert.equal(Object.isFrozen(parsed.workspaces.gitInvocation.environment), true);
});

test("protocol configuration rejects malformed Git invocation hardening", () => {
    const invocation = (config: Record<string, unknown>) =>
        objectAt(workspaceConfigOf(config), "gitInvocation");
    assertInvalid([
        (config) => {
            invocation(config).configOverrides = [];
        },
        (config) => {
            invocation(config).configOverrides = ["no-equals-sign"];
        },
        (config) => {
            invocation(config).configOverrides = ["-c=injected"];
        },
        (config) => {
            invocation(config).environment = { "lower-case": "1" };
        },
        (config) => {
            invocation(config).environment = { GIT_OPTIONAL_LOCKS: 0 };
        },
        (config) => {
            invocation(config).environment = { GIT_OPTIONAL_LOCKS: "a\0b" };
        },
        (config) => {
            invocation(config).removedEnvironmentPrefixes = [""];
        },
        (config) => {
            invocation(config).extra = true;
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
        (config) => {
            ledgerProjectionConfigOf(config).defaultPageSize = 101;
        },
        (config) => {
            ledgerProjectionConfigOf(config).maxPageSize = 0;
        },
        (config) => {
            ledgerProjectionConfigOf(config).latestSelector = "latest";
        },
        (config) => {
            ledgerProjectionConfigOf(config).taskVersionSeparator = ":";
        },
        (config) => {
            ledgerProjectionConfigOf(config).version = 2;
        },
        (config) => {
            objectAt(ledgerProjectionConfigOf(config), "errors").ambiguousCode = "changed";
        },
        (config) => {
            objectAt(ledgerProjectionConfigOf(config), "schemas").runEntryId = "relative";
        },
        (config) => {
            objectAt(ledgerProjectionConfigOf(config), "artifacts").taskEntrySchema = "";
        },
        (config) => {
            evidenceProjectionConfigOf(config).defaultPageSize = 101;
        },
        (config) => {
            evidenceProjectionConfigOf(config).maxPageSize = 0;
        },
        (config) => {
            evidenceProjectionConfigOf(config).latestSelector = "latest";
        },
        (config) => {
            evidenceProjectionConfigOf(config).version = 2;
        },
        (config) => {
            evidenceProjectionConfigOf(config).outputIdJsonPath = "$.changed";
        },
        (config) => {
            objectAt(evidenceProjectionConfigOf(config), "errors").ambiguousCode = "changed";
        },
        (config) => {
            objectAt(evidenceProjectionConfigOf(config), "schemas").traceRevisionId = "relative";
        },
        (config) => {
            objectAt(evidenceProjectionConfigOf(config), "artifacts").outputCitationSchema = "";
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
            objectAt(taskConfigOf(config), "schemas").valueId = "relative";
        },
        (config) => {
            delete objectAt(taskConfigOf(config), "schemas").valueId;
        },
        (config) => {
            objectAt(taskConfigOf(config), "artifacts").valueSchema = "";
        },
        (config) => {
            objectAt(taskConfigOf(config), "artifacts").valueSchema = objectAt(
                taskConfigOf(config),
                "artifacts",
            ).descriptorSchema;
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

test("protocol configuration rejects invalid or drifted delegation and provider contracts", () => {
    assertInvalid([
        (config) => {
            delete config.delegation;
        },
        (config) => {
            delegationConfigOf(config).extra = true;
        },
        (config) => {
            delegationConfigOf(config).compatibilityVersion = "";
        },
        (config) => {
            delegationConfigOf(config).compatibilityVersion = "shepherd.delegation.v2";
        },
        (config) => {
            delegationConfigOf(config).recordVersion = 0;
        },
        (config) => {
            delegationConfigOf(config).recordVersion = 2;
        },
        (config) => {
            delegationConfigOf(config).parentKinds = ["root"];
        },
        (config) => {
            delegationConfigOf(config).parentKinds = ["handle", "root"];
        },
        (config) => {
            delegationConfigOf(config).executionKinds = ["provider", "provider"];
        },
        (config) => {
            delegationConfigOf(config).provenanceKinds = ["declared"];
        },
        (config) => {
            delegationConfigOf(config).approvalVerdicts = ["approved", "rejected", "pending"];
        },
        (config) => {
            delegationConfigOf(config).decisionKinds = ["accepted"];
        },
        (config) => {
            delegationConfigOf(config).revisionFields = ["instruction"];
        },
        (config) => {
            delegationConfigOf(config).statuses = ["ready", "running", "settling"];
        },
        (config) => {
            objectAt(delegationConfigOf(config), "traceSchemas").opened = "";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "traceSchemas").opened =
                "shepherd.delegation.completion.v1";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "traceSchemas").extra = "shepherd.delegation.x.v1";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "identity").handleIdPrefix = "";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "identity").handleIdPrefix = "scope:sha256:";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "identity").childRunIdPrefix =
                "delegation:sha256:";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "limits").maxNestingDepth = 0;
        },
        (config) => {
            objectAt(delegationConfigOf(config), "limits").maxNestingDepth = 17;
        },
        (config) => {
            objectAt(delegationConfigOf(config), "limits").maxSupervisorIdLength = 1.5;
        },
        (config) => {
            objectAt(delegationConfigOf(config), "limits").maxTreeEntries = 0;
        },
        (config) => {
            delete objectAt(delegationConfigOf(config), "limits").maxTreeEntries;
        },
        (config) => {
            delegationConfigOf(config).treeRootKinds = ["handle"];
        },
        (config) => {
            delegationConfigOf(config).treeRootKinds = ["supervisor", "handle"];
        },
        (config) => {
            delete delegationConfigOf(config).treeRootKinds;
        },
        (config) => {
            objectAt(delegationConfigOf(config), "schemas").openedId = "relative";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "artifacts").openedSchema = "";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "artifacts").openedSchema = objectAt(
                objectAt(config, "kernel"),
                "artifacts",
            ).recordBodySchema;
        },
        (config) => {
            objectAt(delegationConfigOf(config), "errors").evidenceCode = "";
        },
        (config) => {
            objectAt(delegationConfigOf(config), "errors").headConflictCode = "OTHER";
        },
        (config) => {
            objectAt(config, "providers").kinds = ["static"];
        },
        (config) => {
            objectAt(config, "providers").kinds = ["static", "program", "remote"];
        },
        (config) => {
            objectAt(objectAt(config, "providers"), "program").kind = "static";
        },
        (config) => {
            objectAt(objectAt(config, "providers"), "program").kind = "remote";
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "providers"), "program"), "capabilities").tools =
                "no";
        },
        (config) => {
            objectAt(objectAt(objectAt(config, "providers"), "program"), "capabilities").tools =
                true;
        },
        (config) => {
            delete objectAt(config, "providers").program;
        },
    ]);
});

test("protocol configuration rejects invalid or drifted scope contracts", () => {
    assertInvalid([
        (config) => {
            scopeConfigOf(config).extra = true;
        },
        (config) => {
            scopeConfigOf(config).compatibilityVersion = "";
        },
        (config) => {
            scopeConfigOf(config).compatibilityVersion = "shepherd.scope.v2";
        },
        (config) => {
            scopeConfigOf(config).recordVersion = 0;
        },
        (config) => {
            scopeConfigOf(config).writerClaimLeaseMilliseconds = 0;
        },
        (config) => {
            scopeConfigOf(config).kinds = ["root"];
        },
        (config) => {
            scopeConfigOf(config).kinds = ["root", "child", "other"];
        },
        (config) => {
            scopeConfigOf(config).states = ["open", "merged"];
        },
        (config) => {
            scopeConfigOf(config).commandKinds = ["register_root", "emit"];
        },
        (config) => {
            scopeConfigOf(config).forkPhases = ["prepared"];
        },
        (config) => {
            scopeConfigOf(config).mergePhases = ["prepared"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "vocabulary").terms = ["spawn", "adopt"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "vocabulary").statuses = ["pending"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "vocabulary").version = 0;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "recovery").classifications = ["terminal"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "recovery").resumeKinds = ["fork"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "scheduling").decisions = ["merge"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "scheduling").outcomes = ["merged"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "scheduling").maxParallel = 0;
        },
        (config) => {
            objectAt(objectAt(scopeConfigOf(config), "checkpoint"), "startClassifications").values =
                ["reconstructed"];
        },
        (config) => {
            objectAt(
                objectAt(objectAt(scopeConfigOf(config), "checkpoint"), "startClassifications"),
                "captureKinds",
            )["verified-copy"] = "reconstructed";
        },
        (config) => {
            objectAt(objectAt(scopeConfigOf(config), "scheduling"), "commandSuffixes").merge =
                "create";
        },
        (config) => {
            scopeConfigOf(config).discardPhases = ["decided"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "limits").maxContributions = 0;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "errors").terminalConflictCode = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "identity").mergeCutIdPrefix = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "traceSchemas").merge = objectAt(
                scopeConfigOf(config),
                "traceSchemas",
            ).discard;
        },
        (config) => {
            scopeConfigOf(config).worldCapabilities = ["trace_only"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "checkpoint").evidenceStatuses = [
                "verified",
                "unavailable",
            ];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "checkpoint").constituentKinds = [];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "checkpoint").constituentKinds = ["trace_cut", "world"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "checkpoint").version = 0;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "checkpoint").extra = true;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "identity").custodyIdentityKind = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "traceSchemas").fork = objectAt(
                scopeConfigOf(config),
                "traceSchemas",
            ).emission;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "schemas").forkId = "relative";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "artifacts").forkSchema = "";
        },
        (config) => {
            scopeConfigOf(config).evidenceKinds = ["registration"];
        },
        (config) => {
            scopeConfigOf(config).worldCapabilities = [];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "authority").atoms = ["read"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "authority").atoms = ["write", "read"];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "authority").resourceKinds = [];
        },
        (config) => {
            objectAt(scopeConfigOf(config), "identity").scopeIdPrefix = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "identity").originCutIdPrefix = "origin:";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "limits").maxCitedRecords = 0;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "limits").maxDataCanonicalBytes = -1;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "limits").maxResources = 1.5;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "errors").authorityCode = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "errors").extra = true;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "schemas").registrationId = "relative";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "artifacts").emissionSchema = "";
        },
        (config) => {
            objectAt(scopeConfigOf(config), "artifacts").emissionSchema = objectAt(
                objectAt(config, "kernel"),
                "artifacts",
            ).recordBodySchema;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "traceSchemas").emission = objectAt(
                scopeConfigOf(config),
                "traceSchemas",
            ).registration;
        },
        (config) => {
            objectAt(scopeConfigOf(config), "traceSchemas").registration = "";
        },
        (config) => {
            delete config.scopes;
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
            objectAt(workspaceConfigOf(config), "worldTaskCapture").journalReaders = [];
        },
        (config) => {
            const capture = objectAt(workspaceConfigOf(config), "worldTaskCapture");
            const readers = capture.journalReaders as Record<string, unknown>[];
            assert.ok(readers[1]);
            readers[1].version = readers[0]?.version;
        },
        (config) => {
            const capture = objectAt(workspaceConfigOf(config), "worldTaskCapture");
            const readers = capture.journalReaders as Record<string, unknown>[];
            assert.ok(readers[1]);
            readers[1].schemaId = readers[0]?.schemaId;
        },
        (config) => {
            const capture = objectAt(workspaceConfigOf(config), "worldTaskCapture");
            capture.journalReaders = (capture.journalReaders as unknown[]).slice(0, 1);
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").ordinaryJournalVersion = 12;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "worldTaskCapture").custodyIdentityKind = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "settlement").actions = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "settlement").states = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "settlement").requestIdPrefix = "";
        },
        (config) => {
            settlementApplicationConfigOf(config).conflictKinds = [];
        },
        (config) => {
            settlementApplicationConfigOf(config).reasons = [];
        },
        (config) => {
            settlementApplicationConfigOf(config).statuses = [];
        },
        (config) => {
            objectAt(settlementApplicationConfigOf(config), "reasonRoles").disjoint = "unknown";
        },
        (config) => {
            settlementApplicationConfigOf(config).caseFold = "yes";
        },
        (config) => {
            settlementApplicationConfigOf(config).normalizationForm = "invalid";
        },
        (config) => {
            settlementApplicationConfigOf(config).maxConflicts = 0;
        },
        (config) => {
            objectAt(settlementApplicationConfigOf(config), "schemas").planId = "relative";
        },
        (config) => {
            carrierBackendsConfigOf(config).extra = true;
        },
        (config) => {
            carrierBackendsConfigOf(config).defaultBackend = "clone";
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "clone").backend = "copy";
        },
        (config) => {
            carrierBackendsConfigOf(config).backends = ["copy", "clone", "overlay", "extra"];
        },
        (config) => {
            carrierBackendsConfigOf(config).backends = ["copy", "clone", "other"];
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").mountArguments = [];
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").mountArguments = ["{target}"];
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").mountArguments = ["{options}"];
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").unmountArguments = ["-l"];
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").mountOptions = "lowerdir={lower}";
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").upperDirectory = "world";
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "overlay").workDirectory = "../work";
        },
        (config) => {
            objectAt(objectAt(carrierBackendsConfigOf(config), "overlay"), "tokens").lower = "";
        },
        (config) => {
            objectAt(
                objectAt(carrierBackendsConfigOf(config), "conformance"),
                "statusRoles",
            ).unavailable = "conformant";
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "conformance").reasons = [
                "shared-suite-host",
                "platform-unsupported",
                "clone-helper-unavailable",
                "reflink-unsupported",
                "overlay-mount-not-permitted",
                "unmapped",
            ];
        },
        (config) => {
            objectAt(
                objectAt(carrierBackendsConfigOf(config), "conformance"),
                "reasonRoles",
            ).available = "unknown";
        },
        (config) => {
            objectAt(objectAt(carrierBackendsConfigOf(config), "clone"), "helper").platforms = [];
        },
        (config) => {
            carrierBackendsConfigOf(config).commandTimeoutMs = 0;
        },
        (config) => {
            objectAt(carrierBackendsConfigOf(config), "errors").unavailableCode = "";
        },
        (config) => {
            settlementReleaseConfigOf(config).receiptVersion = 0;
        },
        (config) => {
            settlementReleaseConfigOf(config).schemaId = "relative";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").atomicityKinds = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").planIdPrefix =
                "world-selection-plan:md5:";
        },
        (config) => {
            const publication = objectAt(workspaceConfigOf(config), "selectionPublication");
            publication.stepIdPrefix = publication.planIdPrefix;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxSteps = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxPlanBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxStepBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxReceiptBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxScheduleBytes = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").scheduleKinds = [];
        },
        (config) => {
            const publication = objectAt(workspaceConfigOf(config), "selectionPublication");
            publication.scheduleIdPrefix = publication.planIdPrefix;
        },
        (config) => {
            const publication = objectAt(workspaceConfigOf(config), "selectionPublication");
            publication.scheduledStepIdPrefix = publication.planIdPrefix;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").scheduledStepVersion = 0;
        },
        (config) => {
            objectAt(
                workspaceConfigOf(config),
                "selectionPublication",
            ).scheduledPublicationVersion = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").maxSteps =
                Number(changesetConfigOf(config).maxChanges) + 1;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "selectionPublication").planFile = "../plan.json";
        },
        (config) => {
            const publication = objectAt(workspaceConfigOf(config), "selectionPublication");
            publication.stepsDirectory = publication.stagingDirectory;
        },
        (config) => {
            const publication = objectAt(workspaceConfigOf(config), "selectionPublication");
            publication.stagingDirectory = carrierConfigOf(config).stagingDirectory;
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
            objectAt(workspaceConfigOf(config), "protectedPaths").roots = ["ordinary"];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").roots = ["unsafe/path"];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").alternateNameSeparators = ["::"];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").alternateNameSeparators = ["/"];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").trailingCharacters = ["\\"];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").caseFold = "yes";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").normalizationForm = "invalid";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").errorCode = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").version = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "protectedPaths").extra = true;
        },
        (config) => {
            platformConformanceConfigOf(config).version = 0;
        },
        (config) => {
            platformConformanceConfigOf(config).metadataProbeTimeoutMs = 0;
        },
        (config) => {
            objectAt(platformConformanceConfigOf(config), "faults").metadataClassification =
                "unknown";
        },
        (config) => {
            objectAt(platformConformanceConfigOf(config), "faults").classifications = [];
        },
        (config) => {
            const probes = platformConformanceConfigOf(config).metadataProbes as Record<
                string,
                unknown
            >[];
            const first = probes[0];
            assert.ok(first);
            first.matchPattern = "[";
        },
        (config) => {
            const probes = platformConformanceConfigOf(config).metadataProbes as Record<
                string,
                unknown
            >[];
            const first = probes[0];
            assert.ok(first);
            first.arguments = ["missing-token"];
        },
        (config) => {
            const probes = platformConformanceConfigOf(config).metadataProbes as Record<
                string,
                unknown
            >[];
            const first = probes[0];
            assert.ok(first);
            first.symlinkArguments = ["missing-token"];
        },
        (config) => {
            const probes = platformConformanceConfigOf(config).metadataProbes as Record<
                string,
                unknown
            >[];
            const first = probes[0];
            assert.ok(first);
            first.separateLineBreakPaths = "yes";
        },
        (config) => {
            platformConformanceConfigOf(config).supportedPlatforms = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryBindings").version = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryBindings").identityDirectory =
                "unsafe/path";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryBindings").identityDirectory = objectAt(
                workspaceConfigOf(config),
                "gitCustody",
            ).stagingDirectory;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryBindings").identityKind = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryBindings").resourceType = "";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").atoms = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").profiles = [];
        },
        (config) => {
            const grantConfig = objectAt(workspaceConfigOf(config), "repositoryGrants");
            grantConfig.profiles = [
                { atoms: ["read"], name: "duplicate" },
                { atoms: ["write"], name: "duplicate" },
            ];
        },
        (config) => {
            const grantConfig = objectAt(workspaceConfigOf(config), "repositoryGrants");
            grantConfig.profiles = [{ atoms: ["admin"], name: "invalid" }];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").artifactVersion = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").journalVersions = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").journalVersions = [10, 99];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "repositoryGrants").journalVersion = 99;
        },
        (config) => {
            objectAt(
                objectAt(workspaceConfigOf(config), "repositoryGrants"),
                "operations",
            ).readText = "admin";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").artifactVersion = 0;
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").enforcement = "jailed";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").journalVersions = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").journalVersions = [12];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").journalVersion = 12;
        },
        (config) => {
            nativeJailConfigOf(config).backends = [];
        },
        (config) => {
            const jail = nativeJailConfigOf(config);
            const backends = jail.backends as Record<string, unknown>[];
            assert.ok(backends[0]);
            assert.ok(backends[1]);
            backends[1].name = backends[0].name;
        },
        (config) => {
            const backend = (nativeJailConfigOf(config).backends as Record<string, unknown>[])[0];
            assert.ok(backend);
            backend.environments = ["unknown"];
        },
        (config) => {
            nativeJailConfigOf(config).probeReasons = [];
        },
        (config) => {
            nativeJailConfigOf(config).probeStatuses = ["available"];
        },
        (config) => {
            objectAt(nativeJailConfigOf(config), "probeReasonRoles").succeeded = "unknown";
        },
        (config) => {
            objectAt(nativeJailConfigOf(config), "placementReasonRoles").auto = "unknown";
        },
        (config) => {
            nativeJailConfigOf(config).journalVersions = [];
        },
        (config) => {
            nativeJailConfigOf(config).journalVersion = 11;
        },
        (config) => {
            objectAt(nativeJailConfigOf(config), "process").statuses = [];
        },
        (config) => {
            objectAt(nativeJailConfigOf(config), "schemas").backendId = "relative";
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").statuses = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").requests = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").reasons = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").resolvedPlacements = [];
        },
        (config) => {
            objectAt(workspaceConfigOf(config), "placements").rules = [];
        },
        (config) => {
            const rules = objectAt(workspaceConfigOf(config), "placements").rules as Record<
                string,
                unknown
            >[];
            assert.ok(rules[2]);
            rules[2].request = rules[0]?.request;
        },
        (config) => {
            const rules = objectAt(workspaceConfigOf(config), "placements").rules as Record<
                string,
                unknown
            >[];
            assert.ok(rules[0]);
            rules[0].supported = false;
        },
        (config) => {
            const rules = objectAt(workspaceConfigOf(config), "placements").rules as Record<
                string,
                unknown
            >[];
            assert.ok(rules[0]);
            rules[0].supported = "yes";
        },
        (config) => {
            const rules = objectAt(workspaceConfigOf(config), "placements").rules as Record<
                string,
                unknown
            >[];
            assert.ok(rules[0]);
            rules[0].status = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.wslEnvironmentVariables = [];
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.environments = [];
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.families = [];
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.nativeEnvironment = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.unsupportedEnvironment = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.wslEnvironment = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.unsupportedFamily = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.wslFamily = "other";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.wslNodePlatform = "freebsd";
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            platform.nodePlatforms = [];
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            const entries = platform.nodePlatforms as Record<string, unknown>[];
            assert.ok(entries[1]);
            entries[1].name = entries[0]?.name;
        },
        (config) => {
            const platform = objectAt(
                objectAt(workspaceConfigOf(config), "placements"),
                "platform",
            );
            const entries = platform.nodePlatforms as Record<string, unknown>[];
            assert.ok(entries[0]);
            entries[0].family = "other";
        },
        (config) => {
            objectAt(
                objectAt(workspaceConfigOf(config), "repositoryBindings"),
                "errors",
            ).invalidRepositoryCode = "";
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

function evidenceProjectionConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "projections"), "evidenceRecords");
}

function ledgerProjectionConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(config, "projections"), "taskRunLedgers");
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

function scopeConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(config, "scopes");
}

function delegationConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(config, "delegation");
}

function taskRegistryConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(taskConfigOf(config), "registry");
}

function workspaceConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(config, "workspaces");
}

function nativeJailConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(workspaceConfigOf(config), "placements"), "nativeJails");
}

function settlementApplicationConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(workspaceConfigOf(config), "settlement"), "application");
}

function settlementReleaseConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(objectAt(workspaceConfigOf(config), "settlement"), "release");
}

function carrierBackendsConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(workspaceConfigOf(config), "carrierBackends");
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

function platformConformanceConfigOf(config: Record<string, unknown>): Record<string, unknown> {
    return objectAt(workspaceConfigOf(config), "platformConformance");
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
