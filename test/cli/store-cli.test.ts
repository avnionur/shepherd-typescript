import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { ROOT_WITNESS_ID, runCli, SQLiteTraceStore } from "../../src/index.ts";
import { populateStoreForSchema } from "../../tooling/testing/store-schema-fixtures.ts";

type Invocation = { readonly errors: string; readonly exitCode: number; readonly output: string };

const validateOutput = new Ajv2020({ strict: false }).compile(
    JSON.parse(
        readFileSync(
            new URL("../../spec/schemas/cli-output-v1.schema.json", import.meta.url),
            "utf8",
        ),
    ) as AnySchemaObject,
);

async function scratch(context: TestContext): Promise<string> {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "shepherd-store-cli-")));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

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

async function invokeJson(
    args: readonly string[],
    cwd: string,
): Promise<Readonly<Record<string, unknown>>> {
    const result = await invoke([...args, "--json"], cwd);
    assert.equal(result.exitCode, 0, result.errors);
    const envelope = JSON.parse(result.output) as Record<string, unknown>;
    assert.equal(validateOutput(envelope), true, JSON.stringify(validateOutput.errors));
    return envelope.result as Record<string, unknown>;
}

function populated(directory: string): string {
    const storePath = path.join(directory, "trace.sqlite");
    using store = new SQLiteTraceStore(storePath);
    populateStoreForSchema(store, store.schemaVersion);
    return storePath;
}

test("store group help lists its configured commands", async (context) => {
    const directory = await scratch(context);
    assert.equal(
        (await invoke(["store", "--help"], directory)).output,
        "Usage: shepherd-ts store <command> [options]\n\nCommands:\n  verify\n  backup\n  restore\n  export\n  import\n  maintain\n",
    );
});

test("store verify, backup, verify --backup, and restore round-trip through the CLI", async (context) => {
    const directory = await scratch(context);
    populated(directory);

    const verified = await invokeJson(["store", "verify"], directory);
    assert.deepEqual(Object.keys(verified), ["store_verification"]);
    assert.equal((verified.store_verification as { schema_version: number }).schema_version, 15);
    assert.match((await invoke(["store", "verify"], directory)).output, /^Trace store verified\./u);

    const backedUp = await invokeJson(["store", "backup", "--output", "backup"], directory);
    const backup = backedUp.backup as {
        readonly manifest_id: string;
        readonly record_count: number;
    };
    assert.equal(backup.record_count, 8);
    const again = await invoke(["store", "backup", "--output", "backup"], directory);
    assert.equal(again.exitCode, 1);
    assert.match(again.errors, /^destination-exists: /u);

    const backupVerification = await invokeJson(
        ["store", "verify", "--backup", "backup", "--manifest", backup.manifest_id],
        directory,
    );
    assert.equal(
        (backupVerification.backup_verification as { manifest_id: string }).manifest_id,
        backup.manifest_id,
    );
    assert.match(
        (await invoke(["store", "verify", "--backup", "backup"], directory)).output,
        /^Backup verified: sha256:/u,
    );
    const mismatch = await invoke(
        ["store", "verify", "--backup", "backup", "--manifest", "sha256:other", "--json"],
        directory,
    );
    assert.equal(mismatch.exitCode, 1);
    assert.equal(JSON.parse(mismatch.errors).error.code, "CLI_FAILURE");

    const restored = await invokeJson(
        [
            "store",
            "restore",
            "--backup",
            "backup",
            "--manifest",
            backup.manifest_id,
            "--store",
            "restored.sqlite",
        ],
        directory,
    );
    assert.equal((restored.restore as { manifest_id: string }).manifest_id, backup.manifest_id);
    const overwrite = await invoke(
        [
            "store",
            "restore",
            "--backup",
            "backup",
            "--manifest",
            backup.manifest_id,
            "--store",
            "restored.sqlite",
        ],
        directory,
    );
    assert.equal(overwrite.exitCode, 1);
    assert.match(overwrite.errors, /^target-exists: /u);
    assert.match(
        (
            await invoke(
                [
                    "store",
                    "restore",
                    "--backup",
                    "backup",
                    "--manifest",
                    backup.manifest_id,
                    "--store",
                    "human.sqlite",
                ],
                directory,
            )
        ).output,
        /^Restored: sha256:/u,
    );
});

test("store export writes owner-only native or redacted archives that import into a fresh store", async (context) => {
    const directory = await scratch(context);
    const storePath = populated(directory);

    const exported = await invokeJson(["store", "export", "--output", "archive.json"], directory);
    assert.deepEqual(Object.keys(exported.export as object).sort(), [
        "byte_length",
        "digest",
        "format",
        "format_version",
    ]);
    assert.equal((exported.export as { format: string }).format, "shepherd.trace.archive");
    assert.equal(statSync(path.join(directory, "archive.json")).mode & 0o777, 0o600);
    const refused = await invoke(["store", "export", "--output", "archive.json"], directory);
    assert.equal(refused.exitCode, 2);

    const redacted = await invokeJson(
        ["store", "export", "--output", "redacted.json", "--redacted"],
        directory,
    );
    assert.equal((redacted.export as { format: string }).format, "shepherd.trace.redacted-archive");
    assert.match(
        (await invoke(["store", "export", "--output", "human.json"], directory)).output,
        /^Exported shepherd\.trace\.archive v1/u,
    );

    const imported = await invokeJson(
        ["store", "import", "--store", "imported.sqlite", "--input", "archive.json"],
        directory,
    );
    assert.equal((imported.import as { imported_record_count: number }).imported_record_count, 8);
    using source = new SQLiteTraceStore(storePath, { readOnly: true });
    using target = new SQLiteTraceStore(path.join(directory, "imported.sqlite"), {
        readOnly: true,
    });
    assert.equal(target.exportTrace(), source.exportTrace());
    assert.match(
        (
            await invoke(
                ["store", "import", "--store", "second.sqlite", "--input", "archive.json"],
                directory,
            )
        ).output,
        /^Imported 8 record\(s\) and 1 blob\(s\)\./u,
    );

    const redactedImport = await invoke(
        ["store", "import", "--store", "never.sqlite", "--input", "redacted.json"],
        directory,
    );
    assert.equal(redactedImport.exitCode, 1);
    assert.equal(
        (await invoke(["store", "import", "--input", "missing.json"], directory)).exitCode,
        3,
    );
});

test("store commands refuse missing stores, bad arguments, and corrupt stores", async (context) => {
    const directory = await scratch(context);
    assert.equal((await invoke(["store", "verify"], directory)).exitCode, 3);
    assert.equal((await invoke(["store", "backup", "--output", "b"], directory)).exitCode, 3);
    assert.equal((await invoke(["store", "export", "--output", "a"], directory)).exitCode, 3);
    for (const args of [
        ["store", "verify", "--manifest", "sha256:x"],
        ["store", "verify", "--backup", "b", "--store", "s"],
        ["store", "verify", "extra"],
        ["store", "backup"],
        ["store", "restore", "--backup", "b", "--store", "t"],
        ["store", "restore", "--manifest", "m", "--store", "t"],
        ["store", "restore", "--backup", "b", "--manifest", "m"],
        ["store", "export"],
        ["store", "import"],
        ["store", "unknown"],
    ]) {
        assert.equal((await invoke(args, directory)).exitCode, 2, args.join(" "));
    }

    const storePath = populated(directory);
    const database = new DatabaseSync(storePath);
    database
        .prepare(
            "UPDATE records SET body_json = ? WHERE record_id <> ? AND rowid = (SELECT MAX(rowid) FROM records)",
        )
        .run('{"tampered":true}', ROOT_WITNESS_ID);
    database.close();
    const corrupt = await invoke(["store", "verify"], directory);
    assert.equal(corrupt.exitCode, 1);
    assert.match(
        corrupt.errors,
        /^trace store failed verification with \d+ issue\(s\): record_mismatch sha256:/u,
    );
    writeFileSync(path.join(directory, "not-json"), "{");
    assert.equal(
        (
            await invoke(
                ["store", "import", "--store", "fresh.sqlite", "--input", "not-json"],
                directory,
            )
        ).exitCode,
        1,
    );
});

test("store maintain runs each configured mode without changing the native export", async (context) => {
    const directory = await scratch(context);
    const storePath = populated(directory);
    const exportOf = () => {
        using store = new SQLiteTraceStore(storePath, { readOnly: true });
        return store.exportTrace();
    };
    const exported = exportOf();

    const inspected = await invokeJson(["store", "maintain"], directory);
    assert.deepEqual(Object.keys(inspected), ["maintenance"]);
    const report = inspected.maintenance as {
        readonly mode: string;
        readonly quick_check: { readonly ok: boolean };
        readonly schema_version: number;
    };
    assert.equal(report.mode, "inspect");
    assert.equal(report.quick_check.ok, true);
    assert.equal(report.schema_version, 15);
    for (const mode of ["inspect", "checkpoint", "optimize", "vacuum"]) {
        const result = await invokeJson(["store", "maintain", "--mode", mode], directory);
        assert.equal((result.maintenance as { readonly mode: string }).mode, mode);
    }
    const human = await invoke(["store", "maintain", "--mode", "vacuum"], directory);
    assert.equal(human.exitCode, 0, human.errors);
    assert.match(
        human.output,
        /^Maintenance: vacuum\nSchema: 15\nPages: \d+ -> \d+ \(free \d+ -> 0\)\nWAL bytes: \d+ -> 0\n$/u,
    );
    assert.equal(exportOf(), exported);
});

test("store maintain refuses missing stores, bad modes, and quick_check defects", async (context) => {
    const directory = await scratch(context);
    assert.equal((await invoke(["store", "maintain"], directory)).exitCode, 3);
    assert.equal((await invoke(["store", "maintain", "--mode", "compact"], directory)).exitCode, 2);
    assert.equal((await invoke(["store", "maintain", "extra"], directory)).exitCode, 2);
    const storePath = populated(directory);
    const database = new DatabaseSync(storePath);
    database.exec("PRAGMA ignore_check_constraints = ON");
    database
        .prepare("INSERT INTO owner_ordinals(owner_id, next_ordinal) VALUES (?, -1)")
        .run("owner:corrupt");
    database.close();
    const inspected = await invoke(["store", "maintain"], directory);
    assert.equal(inspected.exitCode, 1);
    assert.match(
        inspected.errors,
        /^trace store failed quick_check with 1 issue\(s\): CHECK constraint failed/u,
    );
    assert.equal((await invoke(["store", "maintain", "--mode", "vacuum"], directory)).exitCode, 1);

    const more = new DatabaseSync(storePath);
    more.exec("PRAGMA ignore_check_constraints = ON");
    const insert = more.prepare(
        "INSERT INTO owner_ordinals(owner_id, next_ordinal) VALUES (?, -1)",
    );
    for (let index = 0; index < 30; index += 1) insert.run(`owner:corrupt-${index}`);
    more.close();
    assert.match(
        (await invoke(["store", "maintain"], directory)).errors,
        /^trace store failed quick_check with 25\+ issue\(s\): /u,
    );
});
