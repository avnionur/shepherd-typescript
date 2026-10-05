import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import * as facade from "../../src/facades/delegation.ts";
import {
    DELEGATION_COMPATIBILITY_VERSION,
    DELEGATION_CONTEXT_PHASES,
    DELEGATION_LIMITS,
    DELEGATION_STATUSES,
    DELEGATION_TREE_ROOT_KINDS,
    inspectChildRun,
    openChildRun,
    projectChildRunResult,
    projectDelegationTree,
    readTaskValue,
    runChildRun,
    SQLiteTraceStore,
} from "../../src/index.ts";
import {
    DELEGATION_PROTOCOL_V1_CONTRACT,
    PROVIDER_PROTOCOL_V4_CONTRACT,
    TASK_PROTOCOL_V2_CONTRACT,
} from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import { echoTask, openOptions, providerFor, temporaryDatabasePath } from "./fixtures.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("the delegation facade exposes the complete runtime surface", () => {
    assert.deepEqual(Object.keys(facade).sort(), [
        "AppendIntentConflictError",
        "DELEGATION_APPROVAL_VERDICTS",
        "DELEGATION_COMPATIBILITY_VERSION",
        "DELEGATION_CONTEXT_PHASES",
        "DELEGATION_DECISION_KINDS",
        "DELEGATION_EXECUTION_KINDS",
        "DELEGATION_LIMITS",
        "DELEGATION_PARENT_KINDS",
        "DELEGATION_PROVENANCE_KINDS",
        "DELEGATION_RECORD_VERSION",
        "DELEGATION_REVISION_FIELDS",
        "DELEGATION_STATUSES",
        "DELEGATION_TREE_ROOT_KINDS",
        "DelegationApprovalRequiredError",
        "DelegationAuthorityError",
        "DelegationCommandConflictError",
        "DelegationEvidenceError",
        "DelegationHeadConflictError",
        "DelegationStatusError",
        "DelegationSupervisorError",
        "TraceStoreError",
        "acceptChildRunResult",
        "approveChildRunTask",
        "discardChildRun",
        "handoffChildRun",
        "injectChildRunContext",
        "inspectChildRun",
        "observeChildRun",
        "openChildRun",
        "projectChildRunResult",
        "projectDelegationTree",
        "readTaskValue",
        "retryChildRun",
        "runChildRun",
        "taskDescriptorOf",
        "taskValueOf",
    ]);
    assert.equal(facade.openChildRun, openChildRun);
    assert.equal(facade.runChildRun, runChildRun);
    assert.equal(facade.inspectChildRun, inspectChildRun);
    assert.equal(facade.readTaskValue, readTaskValue);
    assert.equal(facade.DELEGATION_COMPATIBILITY_VERSION, DELEGATION_COMPATIBILITY_VERSION);
    assert.equal(DELEGATION_LIMITS.maxNestingDepth, 16);
    assert.equal(DELEGATION_LIMITS.maxInjections, 64);
    assert.equal(DELEGATION_LIMITS.maxCitedRecords, 32);
    assert.equal(DELEGATION_LIMITS.maxTreeEntries, 256);
    assert.deepEqual(DELEGATION_TREE_ROOT_KINDS, ["handle", "supervisor"]);
    assert.equal(facade.projectChildRunResult, projectChildRunResult);
    assert.equal(facade.projectDelegationTree, projectDelegationTree);
    assert.deepEqual(DELEGATION_STATUSES.slice(0, 3), ["ready", "running", "settling"]);
    assert.deepEqual(DELEGATION_CONTEXT_PHASES, ["injected", "consumed"]);
});

test("generated schemas accept retained handle records and the configuration is locked", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "schemas");
    using store = new SQLiteTraceStore(databasePath);
    const root = openChildRun(store, openOptions("delegate:schemas"));
    const child = openChildRun(store, {
        ...openOptions("delegate:schemas-child", { maxTurns: 1 }),
        parent: root.handle,
    });
    await runChildRun(store, {
        handle: root.handle,
        provider: providerFor(echoTask, "hello", "x"),
    });
    const records = [
        ...store.readOwner(root.handle.handle_id),
        ...store.readOwner(child.handle.handle_id),
    ];
    for (const [file, schemaRef, expected] of [
        ["delegation-opened-v1.schema.json", "shepherd.delegation.opened.v1", 2],
        ["delegation-completion-v1.schema.json", "shepherd.delegation.completion.v1", 1],
    ] as const) {
        const validate = compile(file);
        const bodies = records
            .filter((record) => record.envelope.schema_ref === schemaRef)
            .map((record) => record.body as Record<string, unknown>);
        assert.equal(bodies.length, expected, schemaRef);
        for (const body of bodies) {
            assert.equal(validate(body), true, JSON.stringify(validate.errors));
            assert.equal(validate({ ...body, extra: true }), false);
            assert.equal(validate({ ...body, delegation_version: 2 }), false);
        }
    }
    for (const file of [
        "delegation-context-v1.schema.json",
        "delegation-approval-v1.schema.json",
        "delegation-handoff-v1.schema.json",
        "delegation-decision-v1.schema.json",
    ]) {
        assert.equal(typeof compile(file), "function");
    }
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.deepEqual(parsed.delegation, DELEGATION_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.delegation), true);
    assert.deepEqual(parsed.providers, PROVIDER_PROTOCOL_V4_CONTRACT);
    assert.deepEqual(parsed.tasks, TASK_PROTOCOL_V2_CONTRACT);
    assert.equal(parsed.providers.program.kind, "program");
});

test("delegation and provider configuration reject malformed and inconsistent values", () => {
    const mutations: readonly ((config: Record<string, unknown>) => void)[] = [
        (config) => {
            section(config, "delegation").extra = true;
        },
        (config) => {
            section(config, "delegation").statuses = ["ready"];
        },
        (config) => {
            section(config, "delegation").parentKinds = ["root", "handle", "other"];
        },
        (config) => {
            section(config, "delegation").recordVersion = 0;
        },
        (config) => {
            section(config, "delegation").compatibilityVersion = "";
        },
        (config) => {
            (section(config, "delegation").traceSchemas as Record<string, string>).opened =
                "shepherd.delegation.completion.v1";
        },
        (config) => {
            (section(config, "delegation").identity as Record<string, string>).handleIdPrefix =
                "delegation-run:sha256:";
        },
        (config) => {
            (section(config, "delegation").limits as Record<string, number>).maxNestingDepth = 0;
        },
        (config) => {
            (section(config, "delegation").limits as Record<string, number>).maxTreeEntries = 0;
        },
        (config) => {
            section(config, "delegation").treeRootKinds = ["handle", "handle"];
        },
        (config) => {
            (section(config, "delegation").schemas as Record<string, string>).openedId = "relative";
        },
        (config) => {
            (section(config, "delegation").errors as Record<string, string>).evidenceCode = "";
        },
        (config) => {
            section(config, "delegation").contextPhases = ["injected"];
        },
        (config) => {
            section(config, "delegation").contextPhases = ["injected", "injected"];
        },
        (config) => {
            delete section(config, "delegation").contextPhases;
        },
        (config) => {
            delete (section(config, "delegation").errors as Record<string, string>)
                .approvalRequiredCode;
        },
        (config) => {
            (section(config, "delegation").errors as Record<string, string>).supervisorMessage = "";
        },
        (config) => {
            (section(config, "delegation").errors as Record<string, string>).extra = "x";
        },
        (config) => {
            delete (section(config, "delegation").identity as Record<string, string>)
                .retryCutIdPrefix;
        },
        (config) => {
            (section(config, "delegation").identity as Record<string, string>).retryCutIdPrefix =
                "delegation-origin:sha256:";
        },
        (config) => {
            (section(config, "delegation").identity as Record<string, string>).outputDigestKind =
                "delegation_request";
        },
        (config) => {
            (section(config, "delegation").identity as Record<string, string>).extra = "x";
        },
        (config) => {
            section(config, "providers").kinds = ["static"];
        },
        (config) => {
            (section(config, "providers").program as Record<string, unknown>).kind = "static";
        },
        (config) => {
            (section(config, "providers").program as Record<string, unknown>).capabilities = {
                streaming: "no",
                structuredOutput: true,
                tools: false,
            };
        },
        (config) => {
            (section(config, "tasks").schemas as Record<string, string>).valueId = "relative";
        },
        (config) => {
            (section(config, "tasks").artifacts as Record<string, string>).valueSchema = "";
        },
    ];
    for (const mutate of mutations) {
        const config = structuredClone(validConfig);
        mutate(config);
        assert.throws(() => parseProtocolConfig(config), TypeError, mutate.toString());
    }
});

function section(config: Record<string, unknown>, key: string): Record<string, unknown> {
    return config[key] as Record<string, unknown>;
}

function compile(file: string) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    return ajv.compile(
        JSON.parse(
            readFileSync(new URL(`../../spec/schemas/${file}`, import.meta.url), "utf8"),
        ) as AnySchemaObject,
    );
}
