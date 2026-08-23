import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    captureJailedGrantedTaskWorldDurably,
    createGitRepositoryBindings,
    createGitRepositoryGrantPlan,
    createNativeJailCommand,
    createNativeJailPlacementResolution,
    createNativeJailRunner,
    createReferenceCopyCarrier,
    createRetainedWorldRunner,
    createStaticProvider,
    DurableExecutionRecoveryError,
    grantTaskRepositories,
    initializeWorkspace,
    inspectLocalNativeJailBackend,
    listRunLedger,
    NativeJailExecutionError,
    NativeJailUnavailableError,
    recoverJailedGrantedTaskWorldDurably,
    resolveRunLedgerSelector,
    SQLiteTraceStore,
    schema,
    task,
} from "../../src/index.ts";
import {
    createNativeJailConfinementPlan,
    launchNativeJailRunner,
} from "../../src/workspace/native-jail.ts";

class InterruptedNativeReceiptStore extends SQLiteTraceStore {
    override appendDurableExecutionTerminal(
        ...argumentsValue: Parameters<SQLiteTraceStore["appendDurableExecutionTerminal"]>
    ): ReturnType<SQLiteTraceStore["appendDurableExecutionTerminal"]> {
        const request = argumentsValue[3];
        if (
            request.batch.groups.some((group) =>
                group.records.some((record) => "receipt_id" in record.body),
            )
        ) {
            throw new Error("interrupted before native receipt retention");
        }
        return super.appendDurableExecutionTerminal(...argumentsValue);
    }
}

test("local native jail probing is closed, authenticated, and backed by a real denial", async () => {
    const probe = await inspectLocalNativeJailBackend();

    assert.equal(Object.isFrozen(probe), true);
    assert.equal(Object.isFrozen(probe.backend), true);
    assert.match(probe.probe_id, /^native-jail-probe:sha256:[0-9a-f]{64}$/u);
    assert.equal(probe.platform.node_platform, process.platform);
    assert.equal(probe.enforcement, "native-syscall-deny");

    if (process.platform === "darwin") {
        assert.ok(probe.backend);
        assert.equal(probe.backend.name, "seatbelt");
        if (probe.status === "available") {
            assert.equal(probe.reason, "probe-succeeded");
            assert.equal(probe.denied_write, true);
            assert.equal(probe.granted_write, true);
        } else {
            assert.equal(probe.granted_write, false);
            assert.notEqual(probe.reason, "probe-succeeded");
        }
        return;
    }

    if (process.platform === "win32") {
        assert.equal(probe.status, "unavailable");
        assert.equal(probe.reason, "platform-unsupported");
    }
});

test("supported native backends enforce writable, read-only, and alias boundaries", async (context) => {
    const probe = await inspectLocalNativeJailBackend();
    if (probe.status !== "available") {
        context.skip(`native jail backend unavailable: ${probe.reason}`);
        return;
    }
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-native-jail-test-"));
    const outside = await mkdtemp(path.join(tmpdir(), "shepherd-native-jail-outside-"));
    context.after(() =>
        Promise.all([
            rm(root, { force: true, recursive: true }),
            rm(outside, { force: true, recursive: true }),
        ]),
    );

    const run = async (argument: string, writable: boolean) => {
        const runner = createNativeJailRunner({
            command: {
                arguments: ["--", argument],
                environment: [],
                executable: "/usr/bin/touch",
            },
            maxOutputBytes: 4096,
            probe,
            runnerId: `runner:native:${argument}`,
            timeoutMilliseconds: 5000,
        });
        const plan = createNativeJailConfinementPlan(runner, root, writable);
        let intents = 0;
        let receipts = 0;
        let starts = 0;
        const receipt = await launchNativeJailRunner(runner, plan, new AbortController().signal, {
            onIntent: () => {
                intents += 1;
            },
            onReceipt: () => {
                receipts += 1;
            },
            onStarted: () => {
                starts += 1;
            },
        });
        assert.deepEqual({ intents, receipts, starts }, { intents: 1, receipts: 1, starts: 1 });
        return receipt;
    };

    const writableReceipt = await run("allowed.txt", true);
    assert.equal(writableReceipt.exit_code, 0);
    assert.equal(await readFile(path.join(root, "allowed.txt"), "utf8"), "");

    const readonlyReceipt = await run("readonly.txt", false);
    assert.notEqual(readonlyReceipt.exit_code, 0);
    await assert.rejects(readFile(path.join(root, "readonly.txt")));

    await symlink(outside, path.join(root, "escape"));
    const aliasReceipt = await run("escape/escaped.txt", true);
    assert.notEqual(aliasReceipt.exit_code, 0);
    await assert.rejects(readFile(path.join(outside, "escaped.txt")));
});

test("native process receipts classify cancellation, timeout, and output bounds", async (context) => {
    const probe = await inspectLocalNativeJailBackend();
    if (probe.status !== "available") {
        context.skip(`native jail backend unavailable: ${probe.reason}`);
        return;
    }
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-native-process-"));
    context.after(() => rm(root, { force: true, recursive: true }));

    const execute = async (
        script: string,
        timeoutMilliseconds: number,
        maxOutputBytes: number,
        signal = new AbortController().signal,
    ) => {
        const runner = createNativeJailRunner({
            command: {
                arguments: ["-e", script],
                environment: [],
                executable: process.execPath,
            },
            maxOutputBytes,
            probe,
            runnerId: `runner:process:${timeoutMilliseconds}:${maxOutputBytes}`,
            timeoutMilliseconds,
        });
        const plan = createNativeJailConfinementPlan(runner, root, false);
        return launchNativeJailRunner(runner, plan, signal, {
            onIntent: () => undefined,
            onReceipt: () => undefined,
            onStarted: () => undefined,
        });
    };

    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledReceipt = await execute("", 5000, 1024, cancelled.signal);
    assert.equal(cancelledReceipt.status, "cancelled");
    assert.equal(cancelledReceipt.process_id, null);
    assert.equal(cancelledReceipt.quiescence, "proven");

    const timeoutReceipt = await execute("setInterval(() => undefined, 1000)", 25, 1024);
    assert.equal(timeoutReceipt.status, "timed-out");
    assert.equal(timeoutReceipt.quiescence, "proven");

    const outputReceipt = await execute(
        'process.stdout.write("x".repeat(8192)); setInterval(() => undefined, 1000)',
        5000,
        1024,
    );
    assert.equal(outputReceipt.status, "output-limit");
    assert.equal(outputReceipt.stdout_bytes, 1025);
    assert.equal(Buffer.from(outputReceipt.stdout_base64, "base64").byteLength, 1024);
});

test("native jail runner admission fails before command use without an authenticated live probe", async () => {
    const probe = await inspectLocalNativeJailBackend();
    const refusal = new NativeJailUnavailableError(probe);
    assert.equal(refusal.evidence, probe);
    assert.match(refusal.message, /native jail is unavailable/u);
    const definition = {
        command: {
            arguments: [] as readonly string[],
            environment: [] as readonly { readonly name: string; readonly value: string }[],
            executable: "/usr/bin/true",
        },
        maxOutputBytes: 1024,
        probe,
        runnerId: "runner:native-jail",
        timeoutMilliseconds: 1000,
    };

    if (probe.status === "available") {
        const runner = createNativeJailRunner(definition);
        assert.equal(runner.enforcement, "native-syscall-deny");
        assert.equal(Object.isFrozen(runner), true);
        for (const invalid of [
            null,
            [],
            {},
            { ...definition, extra: true },
            { ...definition, maxOutputBytes: 0 },
            { ...definition, timeoutMilliseconds: 0 },
            { ...definition, runnerId: "" },
        ]) {
            assert.throws(() => createNativeJailRunner(invalid as never), TypeError);
        }
    } else {
        assert.throws(
            () => createNativeJailRunner(definition),
            (error: unknown) =>
                error instanceof NativeJailUnavailableError && error.evidence === probe,
        );
    }
    assert.throws(
        () => createNativeJailRunner({ ...definition, probe: { ...probe } } as never),
        TypeError,
    );
    assert.throws(
        () =>
            createRetainedWorldRunner({
                enforcement: "native-syscall-deny",
                runnerId: "runner:forged-native",
                run: async () => {
                    throw new Error("must not run");
                },
            }),
        TypeError,
    );
});

test("structured native commands reject shell-like ambiguity and configured bound violations", () => {
    const valid = {
        arguments: ["literal"],
        environment: [{ name: "LANG", value: "C" }],
        executable: "/usr/bin/true",
    } as const;
    const command = createNativeJailCommand(valid);
    assert.equal(command.arguments[0], "literal");
    assert.deepEqual(command.environment, [{ name: "LANG", value: "C" }]);
    assert.equal(Object.isFrozen(command), true);

    for (const definition of [
        null,
        [],
        {},
        { ...valid, extra: true },
        { ...valid, arguments: {} },
        { ...valid, arguments: Array.from({ length: 257 }, () => "x") },
        { ...valid, arguments: ["\0"] },
        { ...valid, arguments: ["x".repeat(65537)] },
        { ...valid, environment: {} },
        {
            ...valid,
            environment: Array.from({ length: 129 }, (_, index) => ({
                name: `VALUE_${index}`,
                value: "x",
            })),
        },
        { ...valid, environment: [{ name: "1INVALID", value: "x" }] },
        {
            ...valid,
            environment: [
                { name: "DUPLICATE", value: "x" },
                { name: "DUPLICATE", value: "y" },
            ],
        },
        { ...valid, environment: [{ name: "VALUE", value: "x".repeat(16385) }] },
        { ...valid, executable: "relative" },
        { ...valid, executable: "/missing/native-jail-executable" },
        { ...valid, executable: tmpdir() },
        Object.defineProperty({ ...valid }, "executable", { get: () => "/usr/bin/true" }),
    ]) {
        assert.throws(() => createNativeJailCommand(definition as never), TypeError);
    }
});

test("native jailed granted capture enforces at the public durable task-world seam", async (context) => {
    const probe = await inspectLocalNativeJailBackend();
    if (probe.status !== "available") {
        context.skip(`native jail backend unavailable: ${probe.reason}`);
        return;
    }
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "shepherd-native-capture-"));
    context.after(() => rm(workspaceRoot, { force: true, recursive: true }));
    initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
    const repositoryRoot = path.join(workspaceRoot, "source");
    await mkdir(repositoryRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
        cwd: repositoryRoot,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, "message.txt"), "before\n");
    execFileSync("git", ["add", "message.txt"], { cwd: repositoryRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repositoryRoot });
    const binding = createGitRepositoryBindings({
        bindings: [{ name: "source", root: "source" }],
        workspaceRoot,
    }).bindings[0];
    assert.ok(binding);
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    const baseRevision = await carrier.snapshot(binding);
    const descriptor = task({
        input: schema.void(),
        instruction: "Capture a natively jailed change.",
        name: "native-capture",
        output: schema.string(),
        version: "1",
    });
    const granted = grantTaskRepositories({
        grants: [{ binding: "source", profile: "read-write" }],
        task: descriptor,
    });
    const repositoryGrantPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-write",
        bindings: [binding],
        task: granted,
    });
    const provider = createStaticProvider({
        descriptor: { id: "native-provider", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
                },
                response: {
                    output: "complete",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    const runner = createNativeJailRunner({
        command: {
            arguments: ["-e", 'require("node:fs").writeFileSync("jailed.txt", "native\\n")'],
            environment: [],
            executable: process.execPath,
        },
        maxOutputBytes: 4096,
        probe,
        runnerId: "runner:native-capture",
        timeoutMilliseconds: 5000,
    });
    const nativeJailResolution = createNativeJailPlacementResolution({
        captureId: "capture:native-capture",
        placement: "jail",
        platform: probe.platform,
        repositoryGrantPlan,
        runId: "run:native-capture",
        runner,
    });
    const storePath = path.join(workspaceRoot, "native.sqlite");
    using store = new SQLiteTraceStore(storePath);
    const result = await captureJailedGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:native-capture",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:native-capture",
            task: descriptor,
        },
        nativeJailResolution,
        repositoryGrantPlan,
        runner,
        store,
    });

    assert.equal(result.process.exit_code, 0);
    assert.equal(result.process.quiescence, "proven");
    assert.equal(result.placement.resolved_placement, "jail");
    assert.deepEqual(
        result.changeset.changes.map(({ path: changedPath }) => changedPath),
        ["jailed.txt"],
    );
    using postTerminalStore = new SQLiteTraceStore();
    postTerminalStore.importTrace(store.exportTrace());
    const retainedProcessReceipt = postTerminalStore
        .readOwner(result.output.run_id)
        .find((record) => record.body.receipt_id === result.process.receipt_id);
    assert.ok(retainedProcessReceipt);
    postTerminalStore.append({
        append_intent_id: "test:post-terminal-native-process-receipt",
        batch: {
            groups: [
                {
                    owner_id: result.output.run_id,
                    records: [
                        {
                            body: retainedProcessReceipt.body,
                            caused_by_record_ids:
                                retainedProcessReceipt.envelope.caused_by_record_ids,
                            mode: retainedProcessReceipt.envelope.mode,
                            schema_ref: retainedProcessReceipt.envelope.schema_ref,
                            witness_ref: retainedProcessReceipt.envelope.witness_ref,
                        },
                    ],
                },
            ],
        },
    });
    const ledger = resolveRunLedgerSelector(postTerminalStore, result.output.run_id);
    assert.deepEqual(ledger.output, result.output);
    assert.equal(ledger.native_jail_processes.length, 3);
    assert.equal(
        ledger.native_jail_processes.some(
            ({ body }) => body.receipt_id === result.process.receipt_id,
        ),
        true,
    );
    assert.equal(
        ledger.world_capture.transitions[0]?.body.native_jail_resolution_id,
        result.placement.resolution_id,
    );
    using importedLedgerStore = new SQLiteTraceStore();
    importedLedgerStore.importTrace(store.exportTrace());
    assert.deepEqual(listRunLedger(importedLedgerStore), listRunLedger(store));
    const replay = await recoverJailedGrantedTaskWorldDurably({
        baseRevision,
        binding,
        captureId: "capture:native-capture",
        carrier,
        commandId: "command:recover-native-capture",
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider,
            runId: "run:native-capture",
            task: descriptor,
        },
        nativeJailResolution,
        repositoryGrantPlan,
        runner,
        store,
    });
    assert.equal(replay.process.receipt_id, result.process.receipt_id);
    assert.equal(replay.output.head_revision_id, result.output.head_revision_id);
    const changedResolution = createNativeJailPlacementResolution({
        captureId: "capture:native-capture",
        placement: "auto",
        platform: probe.platform,
        repositoryGrantPlan,
        runId: "run:native-capture",
        runner,
    });
    await assert.rejects(
        recoverJailedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:native-capture",
            carrier,
            commandId: "command:changed-native-capture",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:native-capture",
                task: descriptor,
            },
            nativeJailResolution: changedResolution,
            repositoryGrantPlan,
            runner,
            store,
        }),
        TypeError,
    );
    const changedBoundsRunner = createNativeJailRunner({
        command: {
            arguments: ["-e", 'require("node:fs").writeFileSync("jailed.txt", "native\\n")'],
            environment: [],
            executable: process.execPath,
        },
        maxOutputBytes: 2048,
        probe,
        runnerId: "runner:native-capture",
        timeoutMilliseconds: 5000,
    });
    const changedBoundsResolution = createNativeJailPlacementResolution({
        captureId: "capture:native-capture",
        placement: "jail",
        platform: probe.platform,
        repositoryGrantPlan,
        runId: "run:native-capture",
        runner: changedBoundsRunner,
    });
    await assert.rejects(
        recoverJailedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:native-capture",
            carrier,
            commandId: "command:changed-native-bounds",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:native-capture",
                task: descriptor,
            },
            nativeJailResolution: changedBoundsResolution,
            repositoryGrantPlan,
            runner: changedBoundsRunner,
            store,
        }),
        TypeError,
    );
    const fresh = recoverNativeInChild(workspaceRoot, storePath, baseRevision.revision_id);
    assert.equal(fresh.receipt_id, result.process.receipt_id);
    assert.equal(fresh.resolution_id, result.placement.resolution_id);
    await assert.rejects(readFile(path.join(repositoryRoot, "jailed.txt")));

    const readonlyPlan = createGitRepositoryGrantPlan({
        authorityCeiling: "read-only",
        bindings: [binding],
        task: granted,
    });
    const readonlyRunner = createNativeJailRunner({
        command: {
            arguments: ["-e", 'require("node:fs").writeFileSync("denied.txt", "denied\\n")'],
            environment: [],
            executable: process.execPath,
        },
        maxOutputBytes: 4096,
        probe,
        runnerId: "runner:native-readonly",
        timeoutMilliseconds: 5000,
    });
    const readonlyResolution = createNativeJailPlacementResolution({
        captureId: "capture:native-readonly",
        placement: "auto",
        platform: probe.platform,
        repositoryGrantPlan: readonlyPlan,
        runId: "run:native-readonly",
        runner: readonlyRunner,
    });
    const readonlyProvider = createStaticProvider({
        descriptor: { id: "native-readonly-provider", model: "offline-v1" },
        exchanges: [
            {
                request: {
                    input: null,
                    instruction: descriptor.instruction,
                    outputSchema: descriptor.artifact.output_schema,
                },
                response: {
                    output: "must-not-run",
                    usage: {
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                        costUsd: null,
                        inputTokens: 1,
                        outputTokens: 1,
                    },
                },
            },
        ],
    });
    await assert.rejects(
        captureJailedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:native-readonly",
            carrier,
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider: readonlyProvider,
                runId: "run:native-readonly",
                task: descriptor,
            },
            nativeJailResolution: readonlyResolution,
            repositoryGrantPlan: readonlyPlan,
            runner: readonlyRunner,
            store,
        }),
        (error: unknown) =>
            error instanceof NativeJailExecutionError && error.receipt.exit_code !== 0,
    );
    await assert.rejects(readFile(path.join(repositoryRoot, "denied.txt")));

    const uncertainRunner = createNativeJailRunner({
        command: {
            arguments: ["-e", 'require("node:fs").writeFileSync("uncertain.txt", "once")'],
            environment: [],
            executable: process.execPath,
        },
        maxOutputBytes: 4096,
        probe,
        runnerId: "runner:native-uncertain",
        timeoutMilliseconds: 5000,
    });
    const uncertainResolution = createNativeJailPlacementResolution({
        captureId: "capture:native-uncertain",
        placement: "jail",
        platform: probe.platform,
        repositoryGrantPlan,
        runId: "run:native-uncertain",
        runner: uncertainRunner,
    });
    using uncertainStore = new InterruptedNativeReceiptStore();
    const uncertainOptions = {
        baseRevision,
        binding,
        captureId: "capture:native-uncertain",
        carrier,
        execution: {
            budget: { maxTurns: 1 },
            input: undefined,
            provider: createStaticProvider({
                descriptor: { id: "native-uncertain-provider", model: "offline-v1" },
                exchanges: [],
            }),
            runId: "run:native-uncertain",
            task: descriptor,
        },
        nativeJailResolution: uncertainResolution,
        repositoryGrantPlan,
        runner: uncertainRunner,
        store: uncertainStore,
    } as const;
    await assert.rejects(
        captureJailedGrantedTaskWorldDurably(uncertainOptions),
        /interrupted before native receipt retention/u,
    );
    const startsBeforeRecovery = uncertainStore
        .readOwner("run:native-uncertain")
        .filter((record) => "start_id" in record.body).length;
    await assert.rejects(
        recoverJailedGrantedTaskWorldDurably({
            ...uncertainOptions,
            commandId: "command:recover-native-uncertain",
        }),
        DurableExecutionRecoveryError,
    );
    assert.equal(
        uncertainStore
            .readOwner("run:native-uncertain")
            .filter((record) => "start_id" in record.body).length,
        startsBeforeRecovery,
    );
});

function recoverNativeInChild(
    workspaceRoot: string,
    storePath: string,
    baseRevisionId: string,
): { readonly receipt_id: string; readonly resolution_id: string } {
    const source = `
        import {
            createGitRepositoryBindings,
            createGitRepositoryGrantPlan,
            createNativeJailPlacementResolution,
            createNativeJailRunner,
            createReferenceCopyCarrier,
            createStaticProvider,
            grantTaskRepositories,
            inspectLocalNativeJailBackend,
            recoverJailedGrantedTaskWorldDurably,
            schema,
            SQLiteTraceStore,
            task,
        } from "./src/index.ts";
        const [workspaceRoot, storePath, baseRevisionId] = process.argv.slice(1);
        const binding = createGitRepositoryBindings({
            bindings: [{ name: "source", root: "source" }],
            workspaceRoot,
        }).bindings[0];
        const descriptor = task({
            input: schema.void(),
            instruction: "Capture a natively jailed change.",
            name: "native-capture",
            output: schema.string(),
            version: "1",
        });
        const granted = grantTaskRepositories({
            grants: [{ binding: "source", profile: "read-write" }],
            task: descriptor,
        });
        const repositoryGrantPlan = createGitRepositoryGrantPlan({
            authorityCeiling: "read-write",
            bindings: [binding],
            task: granted,
        });
        const probe = await inspectLocalNativeJailBackend();
        const runner = createNativeJailRunner({
            command: {
                arguments: [
                    "-e",
                    'require("node:fs").writeFileSync("jailed.txt", "native\\\\n")',
                ],
                environment: [],
                executable: process.execPath,
            },
            maxOutputBytes: 4096,
            probe,
            runnerId: "runner:native-capture",
            timeoutMilliseconds: 5000,
        });
        const nativeJailResolution = createNativeJailPlacementResolution({
            captureId: "capture:native-capture",
            placement: "jail",
            platform: probe.platform,
            repositoryGrantPlan,
            runId: "run:native-capture",
            runner,
        });
        const provider = createStaticProvider({
            descriptor: { id: "native-provider", model: "offline-v1" },
            exchanges: [],
        });
        const carrier = createReferenceCopyCarrier({ workspaceRoot });
        const baseRevision = await carrier.openRevision(baseRevisionId);
        using store = new SQLiteTraceStore(storePath);
        const result = await recoverJailedGrantedTaskWorldDurably({
            baseRevision,
            binding,
            captureId: "capture:native-capture",
            carrier,
            commandId: "command:fresh-native-capture",
            execution: {
                budget: { maxTurns: 1 },
                input: undefined,
                provider,
                runId: "run:native-capture",
                task: descriptor,
            },
            nativeJailResolution,
            repositoryGrantPlan,
            runner,
            store,
        });
        console.log(JSON.stringify({
            receipt_id: result.process.receipt_id,
            resolution_id: result.placement.resolution_id,
        }));
    `;
    return JSON.parse(
        execFileSync(
            process.execPath,
            ["--input-type=module", "-e", source, workspaceRoot, storePath, baseRevisionId],
            { cwd: process.cwd(), encoding: "utf8" },
        ),
    ) as { readonly receipt_id: string; readonly resolution_id: string };
}
