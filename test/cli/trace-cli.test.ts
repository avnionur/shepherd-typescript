import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
    claimScopeWriter,
    diffReplaySessions,
    inspectReplaySession,
    inspectScope,
    registerChildScope,
    registerRootScope,
    runCli,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { lineageRollout, recordLineageRoot, temporaryDirectory } from "../replay/fixtures.ts";

type Invocation = { readonly errors: string; readonly exitCode: number; readonly output: string };

async function invoke(args: readonly string[], cwd: string): Promise<Invocation> {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runCli(args, {
        cwd,
        stderr: (text) => errors.push(text),
        stdout: (text) => output.push(text),
    });
    return { errors: errors.join(""), exitCode, output: output.join("") };
}

async function json(args: readonly string[], cwd: string) {
    const result = await invoke([...args, "--json"], cwd);
    assert.equal(result.exitCode, 0, result.errors);
    const envelope = JSON.parse(result.output) as {
        readonly command: readonly string[];
        readonly ok: boolean;
        readonly result: Record<string, unknown>;
    };
    assert.equal(envelope.ok, true);
    return envelope;
}

async function seed(directory: string) {
    const storePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(storePath);
    const root = await recordLineageRoot(store, "cli:root");
    const alpha = await lineageRollout(store, root.session_id, "cli:rollout:alpha", "alpha");
    const beta = await lineageRollout(store, root.session_id, "cli:rollout:beta", "beta");
    const other = await recordLineageRoot(store, "cli:other", "other");
    const scope = registerRootScope(store, {
        authority: { ceiling: [], grant: [] },
        commandId: "cli:scope:root",
    });
    const writer = claimScopeWriter(store, {
        claimId: "claim:root",
        nowMilliseconds: 1_000,
        scopeId: scope.scope_id,
    });
    const child = registerChildScope(store, {
        commandId: "cli:scope:child",
        expectedHeadRecordId: scope.head.record_id,
        grant: [],
        nowMilliseconds: 1_500,
        parent: writer,
    });
    return {
        alpha: inspectReplaySession(store, { sessionId: alpha.session_id }),
        beta,
        child: inspectScope(store, child.scope_id),
        diff: diffReplaySessions(store, { sessionIds: [alpha.session_id, beta.session_id] }),
        other,
        root: inspectReplaySession(store, { sessionId: root.session_id }),
        rootScope: inspectScope(store, scope.scope_id),
        storePath,
    };
}

test("replay log, show, and diff present read-only lineage views with stable JSON", async (context) => {
    const directory = await temporaryDirectory(context, "trace-cli-replay");
    const seeded = await seed(directory);
    const { alpha, beta, other, root } = seeded;
    const before = await readFile(seeded.storePath);

    const sessions = await json(["replay", "log"], directory);
    assert.deepEqual(sessions.command, ["replay", "log"]);
    const listed = sessions.result.replay_sessions as readonly Record<string, unknown>[];
    assert.deepEqual(
        listed.map((entry) => entry.session_id).sort(),
        [alpha.session_id, beta.session_id, other.session_id, root.session_id].sort(),
    );
    assert.deepEqual(
        listed.find((entry) => entry.session_id === alpha.session_id),
        {
            classification: "terminal",
            mode: "replay",
            program_id: "program:lineage.v1",
            session_id: alpha.session_id,
            source_session_id: root.session_id,
            step_count: 4,
            terminal: JSON.parse(JSON.stringify(alpha.terminal)),
        },
    );
    assert.deepEqual(
        (await json(["replay", "log", "--limit", "1", "--offset", "1"], directory)).result
            .replay_sessions,
        listed.slice(1, 2),
    );
    const human = await invoke(["replay", "log"], directory);
    assert.equal(human.exitCode, 0);
    assert.match(human.output, new RegExp(`${alpha.session_id}\\treplay\\tterminal\\n`, "u"));

    const log = await json(
        ["replay", "log", alpha.session_id, "--limit", "2", "--offset", "2"],
        directory,
    );
    assert.deepEqual(log.result.replay_log, {
        lineage: [root.session_id, alpha.session_id],
        session_id: alpha.session_id,
        step_count: 4,
        steps: alpha.steps.slice(2).map((step) => ({
            depends_on: step.depends_on,
            index: step.index,
            kind: step.kind,
            prefix_id: step.prefix_id,
            source: step.source,
            step_id: step.step_id,
        })),
    });
    const humanLog = await invoke(["replay", "log", alpha.session_id], directory);
    assert.equal(
        humanLog.output,
        `Session: ${alpha.session_id}\nLineage: ${root.session_id} > ${alpha.session_id}\n${alpha.steps.map((step) => `${step.index}\t${step.kind}\t${step.source}\t${step.step_id}\n`).join("")}`,
    );

    const show = await json(["replay", "show", "@latest"], directory);
    assert.equal(
        (show.result.replay_session as { session_id: string }).session_id.length > 0,
        true,
    );
    const exact = await json(["replay", "show", alpha.session_id], directory);
    assert.deepEqual(exact.result.replay_session, JSON.parse(JSON.stringify(alpha)));
    assert.equal(
        (await invoke(["replay", "show", root.session_id], directory)).output,
        `Session: ${root.session_id}\nMode: root\nClassification: terminal\nSource: none\nSteps: 4\nCheckpoints: 0\n`,
    );

    const diff = await json(["replay", "diff", alpha.session_id, beta.session_id], directory);
    assert.deepEqual(diff.command, ["replay", "diff"]);
    assert.deepEqual(diff.result.replay_diff, JSON.parse(JSON.stringify(seeded.diff)));
    const humanDiff = await invoke(
        ["replay", "diff", alpha.session_id, beta.session_id],
        directory,
    );
    assert.equal(
        humanDiff.output,
        [
            `Ancestor: ${root.session_id}`,
            "Base: 2 step(s)",
            `Branch: ${alpha.session_id}\tsteps 4\tfirst divergence 2`,
            `Branch: ${beta.session_id}\tsteps 4\tfirst divergence 2`,
            "Effect: effect:publish\trecord\tmaterialized\t1/2",
            "Effect: effect:publish\trecord\tmaterialized\t1/2",
            "",
        ].join("\n"),
    );
    const unrelated = await invoke(
        ["replay", "diff", root.session_id, other.session_id],
        directory,
    );
    assert.match(unrelated.output, /^Ancestor: none\nBase: 0 step\(s\)\n/u);
    const withRoot = await invoke(["replay", "diff", root.session_id, alpha.session_id], directory);
    assert.match(
        withRoot.output,
        /Effect: effect:publish\trecord\tmaterialized\t1\/2\tancestor\n/u,
    );

    assert.deepEqual(await readFile(seeded.storePath), before, "read commands never write");
});

test("replay and scope commands refuse bad selectors and arguments with configured exit classes", async (context) => {
    const directory = await temporaryDirectory(context, "trace-cli-refusals");
    const seeded = await seed(directory);
    const { alpha, root } = seeded;
    assert.deepEqual(await invoke(["replay", "diff", alpha.session_id], directory), {
        errors: "replay diff requires at least two distinct session selectors\n",
        exitCode: 2,
        output: "",
    });
    assert.equal(
        (await invoke(["replay", "diff", alpha.session_id, alpha.session_id], directory)).exitCode,
        2,
    );
    assert.equal(
        (
            await invoke(
                ["replay", "diff", ...Array.from({ length: 17 }, (_, index) => `s${index}`)],
                directory,
            )
        ).exitCode,
        2,
    );
    assert.equal((await invoke(["replay", "show"], directory)).exitCode, 2);
    assert.equal((await invoke(["replay", "log", "a", "b"], directory)).exitCode, 2);
    assert.equal((await invoke(["scope", "list", "extra"], directory)).exitCode, 2);
    assert.equal((await invoke(["scope", "show", "--store"], directory)).exitCode, 2);
    assert.equal((await invoke(["replay", "log", "--workspace", "."], directory)).exitCode, 2);
    const missing = await invoke(["replay", "show", "replay-session:none", "--json"], directory);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.errors, /"code":"CLI_FAILURE"/u);
    const ambiguous = await invoke(["replay", "show", "replay-session:"], directory);
    assert.equal(ambiguous.exitCode, 1);
    assert.match(ambiguous.errors, /ambiguous/u);
    const prefix = alpha.session_id.slice(0, alpha.session_id.length - 4);
    assert.equal(
        (
            (await json(["replay", "show", prefix], directory)).result.replay_session as {
                session_id: string;
            }
        ).session_id,
        alpha.session_id,
    );
    assert.equal(
        (await invoke(["replay", "show", root.session_id, "--store", "none.sqlite"], directory))
            .exitCode,
        3,
    );
    assert.equal(
        (await invoke(["scope", "list", "--store", "none.sqlite"], directory)).exitCode,
        3,
    );

    const empty = await temporaryDirectory(context, "trace-cli-empty");
    new SQLiteTraceStore(path.join(empty, "trace.sqlite")).close();
    assert.equal((await invoke(["replay", "log"], empty)).output, "No replay sessions.\n");
    assert.equal((await invoke(["scope", "list"], empty)).output, "No scopes.\n");
    assert.equal((await invoke(["replay", "show", "@latest"], empty)).exitCode, 1);
});

test("scope list and show present retained scopes and their lineage read-only", async (context) => {
    const directory = await temporaryDirectory(context, "trace-cli-scope");
    const { child, rootScope } = await seed(directory);
    assert.ok(child);
    assert.ok(rootScope);
    const listed = await json(["scope", "list"], directory);
    assert.deepEqual(listed.command, ["scope", "list"]);
    assert.deepEqual(
        [...(listed.result.scopes as readonly Record<string, unknown>[])].sort((left, right) =>
            String(left.kind).localeCompare(String(right.kind)),
        ),
        [
            {
                children: 0,
                kind: "child",
                parent_scope_id: rootScope.scope_id,
                scope_id: child.scope_id,
                state: child.state,
            },
            {
                children: 1,
                kind: "root",
                parent_scope_id: null,
                scope_id: rootScope.scope_id,
                state: rootScope.state,
            },
        ],
    );
    assert.match(
        (await invoke(["scope", "list"], directory)).output,
        new RegExp(`${child.scope_id}\\tchild\\t${child.state}\\n`, "u"),
    );
    const shown = await json(["scope", "show", child.scope_id], directory);
    assert.deepEqual(shown.result, {
        lineage: [rootScope.scope_id, child.scope_id],
        scope: JSON.parse(JSON.stringify(child)),
    });
    assert.equal(
        (await invoke(["scope", "show", rootScope.scope_id], directory)).output,
        `Scope: ${rootScope.scope_id}\nKind: root\nState: ${rootScope.state}\nLineage: ${rootScope.scope_id}\nChildren: 1\nSelected history: ${rootScope.selected_history.length}\n`,
    );
});
