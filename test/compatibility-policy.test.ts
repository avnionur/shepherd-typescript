import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ApiSurface } from "../tooling/compatibility/api-surface.ts";
import {
    type ApiBaseline,
    type ClassifiedChange,
    type CompatibilityPolicy,
    checkCompatibility,
    evaluateCompatibility,
    type ProtocolBaseline,
    parseClassifiedChanges,
    parseCompatibilityPolicy,
    updateCompatibilityBaseline,
} from "../tooling/compatibility/policy.ts";
import {
    containedPath,
    digestOf,
    extractProtocolSurface,
    fingerprintSchema,
    type ProtocolSurface,
    resolvePointer,
} from "../tooling/compatibility/protocol-surface.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const productionPolicy = JSON.parse(
    await readFile(path.join(repositoryRoot, "config/compatibility-policy.config.json"), "utf8"),
) as Record<string, unknown> & {
    readonly api: Record<string, unknown>;
    readonly deprecation: Record<string, unknown>;
    readonly frozen: Record<string, unknown>;
    readonly protocol: Record<string, unknown>;
};

const baseDeclarations = [
    "/** Returns the input. */",
    "export declare function helper(value: string): string;",
    "/** Shape summary. */",
    "export type Shape = { readonly value: string };",
    "",
].join("\n");

test("the checked-in compatibility baselines match the repository surfaces", async () => {
    const report = await checkCompatibility();
    assert.deepEqual(report.violations, []);
    assert.deepEqual(report.accepted, []);
});

test("removed exports, commands, error codes, migrations, and narrowed schemas fail precisely", async (context) => {
    const root = await fixtureRepository(context);
    await setVersion(root, "1.1.0");
    await writeDeclarations(
        root,
        "/** Shape summary. */\nexport type Shape = { readonly value: string };\n",
    );
    await mutateJson(root, "protocol.config.json", (config) => {
        const groups = (config.cli as { groups: { name: string; commands: { name: string }[] }[] })
            .groups;
        const run = groups.find(({ name }) => name === "run") as (typeof groups)[number];
        run.commands = run.commands.filter(({ name }) => name !== "list");
        const store = (config.kernel as { store: { migrations: unknown[] } }).store;
        store.migrations = [store.migrations[1], store.migrations[0], ...store.migrations.slice(2)];
    });
    await mutateJson(root, "public-errors.config.json", (config) => {
        delete (config.codes as { runs: Record<string, string> }).runs.cancelled;
    });
    await mutateJson(root, "spec/schemas/cli-output-v1.schema.json", (schema) => {
        (schema.oneOf as unknown[]).pop();
    });
    const baselineBefore = await readFile(
        path.join(root, "spec/compatibility/api-baseline.json"),
        "utf8",
    );

    const failure = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(
        failure,
        /- api:\.#helper: removed function export, but it was never deprecated and removal requires a MAJOR version bump \(baseline 1\.0\.0, package 1\.1\.0\)/u,
    );
    assert.match(
        failure,
        /- cli-command:run list: removed CLI command, but it was never deprecated/u,
    );
    assert.match(failure, /- error-code:RUN_CANCELLED: removed public error code/u);
    assert.match(
        failure,
        /- migrations:protocol\.config\.json#\/kernel\/store\/migrations: migration 1 of 13 was removed, reordered, or changed; migrations may only be appended/u,
    );
    assert.match(
        failure,
        /- schema:cli-output-v1\.schema\.json: changed or narrowed schema without a classified entry in spec\/compatibility\/protocol-changes\.json \(from sha256:[0-9a-f]{64} to sha256:[0-9a-f]{64}\)/u,
    );
    await assert.rejects(
        updateCompatibilityBaseline({ repositoryRoot: root, classify: "additive" }),
        /compatibility check failed/u,
    );
    assert.equal(
        await readFile(path.join(root, "spec/compatibility/api-baseline.json"), "utf8"),
        baselineBefore,
    );
});

test("additive changes pass after a MINOR bump and a baseline update", async (context) => {
    const root = await fixtureRepository(context);
    await writeDeclarations(
        root,
        `${baseDeclarations}/** Added. */\nexport declare const added: number;\n`,
    );
    await mutateJson(root, "spec/schemas/cli-output-v1.schema.json", (schema) => {
        (schema.oneOf as unknown[]).push({ const: "fixture-branch" });
        (schema.$defs as Record<string, unknown>).fixtureDefinition = { type: "string" };
    });
    await mutateJson(root, "protocol.config.json", (config) => {
        const store = (config.kernel as { store: { migrations: unknown[]; schemaVersion: number } })
            .store;
        store.migrations.push({ firstOwnerOrdinal: 0, lastOwnerOrdinal: 1, version: 14 });
        store.schemaVersion = 14;
        const cli = config.cli as {
            exitCodes: Record<string, number>;
            groups: { commands: { handler: string; name: string }[]; name: string }[];
        };
        cli.exitCodes.fixture = 9;
        cli.groups[2]?.commands.push({ handler: "run-list", name: "fixture" });
        (config.kernel as Record<string, unknown>).fixtureVersion = 1;
    });
    await mutateJson(root, "public-errors.config.json", (config) => {
        (config.codes as Record<string, unknown>).fixture = { added: "FIXTURE_ADDED" };
    });
    await writeFile(path.join(root, "spec/schemas/fixture-v1.schema.json"), "{}\n");

    await setVersion(root, "1.0.1");
    const patchFailure = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(
        patchFailure,
        /- api:\.#added: added export requires at least a MINOR version bump \(baseline 1\.0\.0, package 1\.0\.1\)/u,
    );

    await setVersion(root, "1.1.0");
    const stale = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(
        stale,
        /compatibility baselines are stale \(recorded for 1\.0\.0, package is 1\.1\.0\)/u,
    );
    for (const accepted of [
        "api:.#added: added export",
        "schema:cli-output-v1.schema.json: added oneOf branches or $defs members",
        "schema:fixture-v1.schema.json: added schema",
        "migrations:protocol.config.json#/kernel/store/migrations: appended 1 migration(s)",
        "version:protocol.config.json#/kernel/store/schemaVersion: increased 13 to 14",
        "version:protocol.config.json#/kernel/fixtureVersion: added version marker",
        "cli-exit-code:fixture: added CLI exit code",
        "cli-command:run fixture: added CLI command",
        "error-code:FIXTURE_ADDED: added public error code",
    ]) {
        assert.ok(stale.includes(`- ${accepted}`), accepted);
    }
    const report = await updateCompatibilityBaseline({ repositoryRoot: root });
    assert.equal(report.violations.length, 0);
    await checkCompatibility({ repositoryRoot: root });
    const baseline = JSON.parse(
        await readFile(path.join(root, "spec/compatibility/protocol-baseline.json"), "utf8"),
    ) as ProtocolBaseline;
    assert.equal(baseline.packageVersion, "1.1.0");
    assert.equal(baseline.previousVersion, "1.0.0");

    await writeDeclarations(
        root,
        `${baseDeclarations}/** Added. */\nexport declare const added: number;\n/** Later. */\nexport declare const later: number;\n`,
    );
    const sameVersion = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(sameVersion, /compatibility baselines are stale/u);
    await updateCompatibilityBaseline({ repositoryRoot: root });
    const repeated = JSON.parse(
        await readFile(path.join(root, "spec/compatibility/api-baseline.json"), "utf8"),
    ) as ApiBaseline;
    assert.equal(repeated.previousVersion, "1.0.0");
});

test("changed declarations and values need a classified entry with a matching version bump", async (context) => {
    const root = await fixtureRepository(context);
    await writeDeclarations(
        root,
        baseDeclarations.replace("value: string): string", "value: number): string"),
    );
    await mutateJson(root, "protocol.config.json", (config) => {
        (config.cli as { exitCodes: Record<string, number> }).exitCodes.usage = 64;
    });
    await setVersion(root, "1.1.0");
    const unclassified = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(
        unclassified,
        /- api:\.#helper: changed function declaration without a classified entry in spec\/compatibility\/protocol-changes\.json/u,
    );
    assert.match(
        unclassified,
        /- cli-exit-code:usage: changed exit code 2 to 64 without a classified entry/u,
    );

    await assert.rejects(
        updateCompatibilityBaseline({ repositoryRoot: root, classify: "breaking" }),
        /is classified breaking and requires a MAJOR version bump/u,
    );
    await assert.rejects(readFile(path.join(root, "spec/compatibility/protocol-changes.json")), {
        code: "ENOENT",
    });
    await assert.rejects(
        updateCompatibilityBaseline({ classify: "additive", repositoryRoot: root }),
        /bulk additive classification is refused for changed API declarations and version markers; judge each and name it with --artifact: api:\.#helper$/u,
    );
    await assert.rejects(
        updateCompatibilityBaseline({ artifacts: ["api:.#helper"], repositoryRoot: root }),
        /naming artifacts requires a classification/u,
    );
    await assert.rejects(
        updateCompatibilityBaseline({
            artifacts: ["api:.#helper", "api:.#missing"],
            classify: "additive",
            repositoryRoot: root,
        }),
        /not an unclassified changed artifact: api:\.#missing/u,
    );
    await assert.rejects(readFile(path.join(root, "spec/compatibility/protocol-changes.json")), {
        code: "ENOENT",
    });

    await updateCompatibilityBaseline({
        artifacts: ["api:.#helper", "cli-exit-code:usage"],
        classify: "additive",
        note: "Widened for the fixture.",
        repositoryRoot: root,
    });
    const log = parseClassifiedChanges(
        JSON.parse(
            await readFile(path.join(root, "spec/compatibility/protocol-changes.json"), "utf8"),
        ) as unknown,
    );
    assert.deepEqual(
        log.map(({ artifact, classification, note, version }) => ({
            artifact,
            classification,
            note,
            version,
        })),
        [
            {
                artifact: "api:.#helper",
                classification: "additive",
                note: "Widened for the fixture.",
                version: "1.1.0",
            },
            {
                artifact: "cli-exit-code:usage",
                classification: "additive",
                note: "Widened for the fixture.",
                version: "1.1.0",
            },
        ],
    );
    assert.equal(log[1]?.from, "2");
    assert.equal(log[1]?.to, "64");
    await checkCompatibility({ repositoryRoot: root });

    await mutateJson(root, "spec/compatibility/protocol-changes.json", (changes) => {
        (changes as unknown as ClassifiedChange[])[0] = {
            ...(changes as unknown as ClassifiedChange[])[0],
            classification: "breaking",
        } as ClassifiedChange;
    });
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: root })),
        /protocol-changes\.json is append-only: its first 2 entries were changed or removed/u,
    );
});

test("deprecated exports are removable only after the window and a MAJOR bump", async (context) => {
    const root = await fixtureRepository(
        context,
        baseDeclarations.replace(
            "/** Returns the input. */",
            "/**\n * Returns the input.\n * @deprecated Since 1.0.0. Use Shape instead.\n */",
        ),
    );
    await writeDeclarations(
        root,
        "/** Shape summary. */\nexport type Shape = { readonly value: string };\n",
    );
    await setVersion(root, "2.0.0");
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: root })),
        /api:\.#helper: removed function export, but it was deprecated in 1\.0\.0 and the window of 2 minor releases has not elapsed by the last released version 1\.0\.0/u,
    );

    const released = await fixtureRepository(
        context,
        baseDeclarations.replace(
            "/** Returns the input. */",
            "/**\n * Returns the input.\n * @deprecated Since 1.0.0. Use Shape instead.\n */",
        ),
    );
    await setVersion(released, "1.1.0");
    await updateCompatibilityBaseline({ repositoryRoot: released });
    await setVersion(released, "1.2.0");
    await updateCompatibilityBaseline({ repositoryRoot: released });
    await writeDeclarations(
        released,
        "/** Shape summary. */\nexport type Shape = { readonly value: string };\n",
    );
    await setVersion(released, "2.0.0");
    // Baseline updates at 1.1.0 and 1.2.0 are not releases: the window counts released versions.
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: released })),
        /api:\.#helper: removed function export, but it was deprecated in 1\.0\.0 and the window of 2 minor releases has not elapsed by the last released version 1\.0\.0 \(baseline 1\.2\.0, package 2\.0\.0\)/u,
    );
    await mutateJson(released, "config/compatibility-policy.config.json", (policy) => {
        (policy.deprecation as Record<string, unknown>).lastReleasedVersion = "1.2.0";
    });
    await setVersion(released, "1.3.0");
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: released })),
        /api:\.#helper: removed function export, but removal requires a MAJOR version bump/u,
    );
    await setVersion(released, "2.0.0");
    await updateCompatibilityBaseline({ repositoryRoot: released });
    await checkCompatibility({ repositoryRoot: released });

    const undated = await fixtureRepository(context);
    await writeDeclarations(
        undated,
        baseDeclarations.replace(
            "/** Returns the input. */",
            "/**\n * Returns the input.\n * @deprecated Use Shape instead.\n */",
        ),
    );
    await setVersion(undated, "1.1.0");
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: undated })),
        /api:\.#helper: @deprecated must state the release it was deprecated in/u,
    );
});

test("format and protocol version increases need a noted classification; schema versions need migrations", async (context) => {
    const root = await fixtureRepository(context);
    const formatVersion = "version:protocol.config.json#/kernel/interchange/formatVersion";
    await mutateJson(root, "protocol.config.json", (config) => {
        const kernel = config.kernel as {
            interchange: { formatVersion: number };
            store: { schemaVersion: number };
        };
        kernel.interchange.formatVersion = 2;
        kernel.store.schemaVersion = 14;
    });
    await setVersion(root, "1.1.0");
    const failure = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(
        failure,
        /- version:protocol\.config\.json#\/kernel\/interchange\/formatVersion: increased 1 to 2; readers require an exact format or protocol version, so the increase needs a classification without a classified entry/u,
    );
    assert.match(
        failure,
        /- version:protocol\.config\.json#\/kernel\/store\/schemaVersion: increased 13 to 14, but protocol\.config\.json#\/kernel\/store\/migrations gained 0 migration\(s\); a schema version increases only with one appended migration per version/u,
    );

    await mutateJson(root, "protocol.config.json", (config) => {
        const store = (config.kernel as { store: { migrations: unknown[] } }).store;
        store.migrations.push({ firstOwnerOrdinal: 0, lastOwnerOrdinal: 1, version: 14 });
    });
    await assert.rejects(
        updateCompatibilityBaseline({ classify: "additive", repositoryRoot: root }),
        /bulk additive classification is refused .*: version:protocol\.config\.json#\/kernel\/interchange\/formatVersion$/u,
    );
    await assert.rejects(
        updateCompatibilityBaseline({
            artifacts: [formatVersion],
            classify: "additive",
            repositoryRoot: root,
        }),
        /formatVersion: increased 1 to 2; .* is classified additive without a note naming the reader that still accepts the previous value/u,
    );
    const report = await updateCompatibilityBaseline({
        artifacts: [formatVersion],
        classify: "additive",
        note: "The importer keeps a documented reader for archive format version 1.",
        repositoryRoot: root,
    });
    assert.ok(
        report.accepted.includes(
            "version:protocol.config.json#/kernel/store/schemaVersion: increased 13 to 14 with 1 appended migration(s)",
        ),
    );
    await checkCompatibility({ repositoryRoot: root });
});

test("identity settings and per-command CLI options are fingerprinted", async (context) => {
    const root = await fixtureRepository(context);
    await mutateJson(root, "protocol.config.json", (config) => {
        (config.recordId as Record<string, unknown>).prefix = "sha512:";
        const kernel = config.kernel as { fixtureIdPrefix?: string; store: { blobs: object } };
        delete (kernel.store.blobs as { idPrefix?: string }).idPrefix;
        kernel.fixtureIdPrefix = "fixture:";
        const cli = config.cli as {
            commandOptions: Record<string, { flags: string[]; values: string[] }>;
        };
        cli.commandOptions["run-list"] = { flags: ["offset"], values: ["json", "store"] };
    });
    await setVersion(root, "1.1.0");
    const failure = await rejection(checkCompatibility({ repositoryRoot: root }));
    for (const expected of [
        /- identity:protocol\.config\.json#\/recordId\/prefix: changed sha256: to sha512: without a classified entry/u,
        /- identity:protocol\.config\.json#\/recordId: changed sha256:[0-9a-f]{64} to sha256:[0-9a-f]{64} without a classified entry/u,
        /- identity:protocol\.config\.json#\/kernel\/store\/blobs\/idPrefix: removed identity setting, but it was never deprecated/u,
        /- cli-option:run list --limit: removed CLI option, but it was never deprecated/u,
        /- cli-option:run list --offset: changed value option to flag without a classified entry/u,
    ]) {
        assert.match(failure, expected);
    }

    await mutateJson(root, "protocol.config.json", (config) => {
        const kernel = config.kernel as { store: { blobs: Record<string, unknown> } };
        kernel.store.blobs.idPrefix = "sha256:";
        const cli = config.cli as {
            commandOptions: Record<string, { flags: string[]; values: string[] }>;
        };
        cli.commandOptions["run-list"] = { flags: ["offset"], values: ["json", "limit", "store"] };
    });
    const report = await updateCompatibilityBaseline({
        artifacts: [
            "cli-option:run list --offset",
            "identity:protocol.config.json#/recordId",
            "identity:protocol.config.json#/recordId/prefix",
        ],
        classify: "additive",
        note: "Fixture.",
        repositoryRoot: root,
    });
    for (const accepted of [
        "cli-option:run list --json: added CLI option",
        "identity:protocol.config.json#/kernel/fixtureIdPrefix: added identity setting",
    ]) {
        assert.ok(report.accepted.includes(accepted), accepted);
    }
    await checkCompatibility({ repositoryRoot: root });
});

test("baselines that predate identity and CLI-option fingerprints are upgraded without judgment", async (context) => {
    const root = await fixtureRepository(context);
    await mutateJson(root, "spec/compatibility/protocol-baseline.json", (baseline) => {
        const surface = baseline.surface as Record<string, unknown>;
        delete surface.commandOptions;
        delete surface.identity;
    });
    await setVersion(root, "1.0.1");
    const stale = await rejection(checkCompatibility({ repositoryRoot: root }));
    assert.match(stale, /- cli-option: per-command CLI options fingerprinted for the first time/u);
    assert.match(stale, /- identity: identity settings fingerprinted for the first time/u);
    await updateCompatibilityBaseline({ repositoryRoot: root });
    await checkCompatibility({ repositoryRoot: root });
});

test("the gate refuses declarations emitted before the newest source edit", async (context) => {
    const root = await fixtureRepository(context);
    await mkdir(path.join(root, "src/nested"), { recursive: true });
    const source = path.join(root, "src/nested/module.ts");
    await writeFile(source, "export {};\n");
    const past = new Date(Date.now() - 60_000);
    await utimes(source, past, past);
    await checkCompatibility({ repositoryRoot: root });
    const future = new Date(Date.now() + 60_000);
    await utimes(source, future, future);
    assert.match(
        await rejection(checkCompatibility({ repositoryRoot: root })),
        /^src\/nested\/module\.ts is newer than the declarations in dist: run `pnpm build` before `pnpm check:compatibility`$/u,
    );
    await mutateJson(root, "config/compatibility-policy.config.json", (policy) => {
        policy.build = { sources: ["package.json"] };
    });
    await assert.rejects(checkCompatibility({ repositoryRoot: root }), { code: "ENOTDIR" });
});

test("pure evaluation covers tiers, frozen artifacts, markers, and baseline integrity", async () => {
    const policy = parseCompatibilityPolicy({
        ...productionPolicy,
        api: { ...productionPolicy.api, tiers: { ".": "stable", "./lab": "experimental" } },
        frozen: { ...productionPolicy.frozen, artifactPatterns: ["^version:.*#/frozen$"] },
        protocol: {
            ...productionPolicy.protocol,
            deprecations: [{ artifact: "cli-command:old", since: "1.0.0" }],
        },
    });
    const surface = protocolSurface();
    const apiBaseline: ApiBaseline = {
        entries: {
            ".": {
                gone: { deprecatedSince: null, digest: "sha256:a", kind: "function" },
                kept: { digest: "sha256:k", kind: "function" },
                marked: { digest: "sha256:m", kind: "function" },
                restored: { deprecatedSince: "1.1.0", digest: "sha256:r", kind: "function" },
            },
            "./lab": {
                trial: { digest: "sha256:t", kind: "function" },
                tweak: { digest: "sha256:w", kind: "function" },
            },
            "./removed-lab": {},
        },
        packageVersion: "1.2.0",
        previousVersion: "1.1.0",
    };
    const protocolBaseline: ProtocolBaseline = {
        changeLog: { digest: digestOf([]), entries: 0 },
        packageVersion: "1.2.0",
        previousVersion: "1.1.0",
        surface,
    };
    const currentApi: ApiSurface = {
        entries: {
            ".": {
                kept: { digest: "sha256:k", kind: "function" },
                marked: { deprecatedSince: "1.2.0", digest: "sha256:m", kind: "function" },
                restored: { digest: "sha256:r", kind: "function" },
            },
            "./lab": { tweak: { digest: "sha256:w2", kind: "function" } },
        },
        packageVersion: "2.0.0",
    };
    const report = evaluateCompatibility({
        apiBaseline: {
            ...apiBaseline,
            entries: { ...apiBaseline.entries, "./removed-lab": {}, "./unconfigured": {} },
        },
        changes: [],
        currentApi,
        currentProtocol: {
            ...surface,
            commands: ["new"],
            exitCodes: {},
            migrations: { "p#/new": [] },
            schemas: {
                "family-v1.schema.json": fingerprintSchema({ const: "changed" }),
                "family-v2.schema.json": surface.schemas["family-v2.schema.json"] as never,
                "plain.schema.json": fingerprintSchema({ type: "number" }),
            },
            versions: {
                "p#/format": 2,
                "p#/frozen": 3,
                "p#/label": "b",
                "p#/number": 1,
                "p#/schema": 2,
            },
        },
        policy: parseCompatibilityPolicy({
            ...productionPolicy,
            api: {
                ...productionPolicy.api,
                tiers: { ".": "stable", "./lab": "experimental", "./removed-lab": "experimental" },
            },
            frozen: policy.frozen,
            protocol: {
                ...productionPolicy.protocol,
                deprecations: [{ artifact: "cli-command:old", since: "1.0.0" }],
                migrationBackedVersions: [{ marker: "p#/schema", migrations: "p#/absent" }],
            },
        }),
        protocolBaseline,
    });
    const text = [...report.accepted, ...report.violations].join("\n");
    assert.match(
        text,
        /version:p#\/format: increased 1 to 2; readers require an exact format or protocol version, so the increase needs a classification without a classified entry/u,
    );
    assert.match(
        text,
        /version:p#\/schema: increased 1 to 2, but p#\/absent gained 0 migration\(s\)/u,
    );
    assert.match(text, /^cli-option: per-command CLI options fingerprinted for the first time$/mu);
    assert.match(text, /^identity: identity settings fingerprinted for the first time$/mu);
    assert.match(
        text,
        /api:\.#gone: removed function export, but its deprecation names no release/u,
    );
    assert.match(text, /api:\.#marked: deprecated since 1\.2\.0/u);
    assert.match(text, /api:\.#restored: deprecation withdrawn/u);
    assert.match(
        text,
        /api:\.\/lab#trial: removed function export \(not enforced for this tier\)/u,
    );
    assert.match(
        text,
        /api:\.\/lab#tweak: changed function declaration \(not enforced for this tier\)/u,
    );
    assert.match(text, /cli-command:old: removed CLI command$/mu);
    assert.match(
        text,
        /schema:family-v1\.schema\.json: changed a frozen schema; publish a new versioned schema file instead/u,
    );
    assert.match(
        text,
        /schema:plain\.schema\.json: changed or narrowed schema without a classified entry/u,
    );
    assert.match(text, /version:p#\/number: decreased 2 to 1; version markers never decrease/u);
    assert.match(text, /version:p#\/frozen: increased 1 to 3, but the artifact is frozen/u);
    assert.match(text, /version:p#\/label: changed a to b without a classified entry/u);
    assert.match(
        text,
        /migrations:p#\/m: removed migration list; migrations may only be appended/u,
    );
    assert.match(
        text,
        /api:\.\/removed-lab: removed package entry \(not enforced for this tier\)/u,
    );
    assert.match(
        text,
        /api:\.\/unconfigured: removed package entry, but it was never deprecated \(baseline 1\.2\.0, package 2\.0\.0\)/u,
    );
    assert.match(text, /schema:gone\.schema\.json: removed schema, but it was never deprecated/u);
    assert.match(text, /version:p#\/gone: removed version marker, but it was never deprecated/u);
    assert.match(text, /cli-exit-code:gone: removed CLI exit code, but it was never deprecated/u);
    assert.match(text, /migrations:p#\/new: added migration list/u);
    assert.deepEqual(
        report.unclassified.map(({ artifact }) => artifact),
        ["schema:plain.schema.json", "version:p#/label", "version:p#/format"],
    );

    const fingerprinted: ProtocolSurface = {
        ...surface,
        commandOptions: {
            kept: { "--gone": "value", "--kind": "flag" },
            old: { "--any": "value" },
        },
        identity: { "p#/a": "x", "p#/b": "y" },
    };
    const identityReport = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {} },
        changes: [],
        currentApi: { entries: {}, packageVersion: "1.3.0" },
        currentProtocol: {
            ...surface,
            commandOptions: { kept: { "--kind": "value", "--new": "flag" } },
            identity: { "p#/a": "z", "p#/c": "w" },
        },
        policy,
        protocolBaseline: { ...protocolBaseline, surface: fingerprinted },
    });
    const identityText = [...identityReport.accepted, ...identityReport.violations].join("\n");
    for (const expected of [
        /cli-option:kept --gone: removed CLI option, but it was never deprecated/u,
        /cli-option:kept --kind: changed flag option to value without a classified entry/u,
        /cli-option:kept --new: added CLI option/u,
        /identity:p#\/a: changed x to z without a classified entry/u,
        /identity:p#\/b: removed identity setting, but it was never deprecated/u,
        /identity:p#\/c: added identity setting/u,
    ]) {
        assert.match(identityText, expected);
    }
    assert.doesNotMatch(identityText, /cli-option:old/u);
    const withoutSurfaces = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {} },
        changes: [],
        currentApi: { entries: {}, packageVersion: "1.3.0" },
        currentProtocol: surface,
        policy,
        protocolBaseline: { ...protocolBaseline, surface: fingerprinted },
    });
    assert.match(
        withoutSurfaces.violations.join("\n"),
        /identity:p#\/a: removed identity setting/u,
    );
    assert.doesNotMatch(withoutSurfaces.violations.join("\n"), /cli-option:/u);

    const frozenLabel = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {} },
        changes: [],
        currentApi: { entries: { "./lab": {} }, packageVersion: "1.2.0" },
        currentProtocol: { ...surface, versions: { ...surface.versions, "p#/frozen": 0 } },
        policy,
        protocolBaseline,
    });
    assert.match(frozenLabel.violations.join("\n"), /version:p#\/frozen: decreased 1 to 0/u);
    assert.match(frozenLabel.accepted.join("\n"), /api:\.\/lab: added package entry/u);

    const stringFrozen = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {} },
        changes: [],
        currentApi: { entries: {}, packageVersion: "1.2.0" },
        currentProtocol: {
            ...surface,
            versions: { ...surface.versions, "p#/frozen": "text" },
        },
        policy,
        protocolBaseline,
    });
    assert.match(
        stringFrozen.violations.join("\n"),
        /version:p#\/frozen: changed 1 to text, but the artifact is frozen/u,
    );

    const integrity = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {}, packageVersion: "1.1.0" },
        changes: [
            {
                artifact: "version:p#/label",
                classification: "additive",
                from: "a",
                to: "b",
                version: "1.0.0",
            },
        ],
        currentApi: { entries: {}, packageVersion: "1.0.0" },
        currentProtocol: {
            ...surface,
            versions: { ...surface.versions, "p#/label": "b" },
        },
        policy,
        protocolBaseline: { ...protocolBaseline, previousVersion: null },
    });
    assert.match(
        integrity.violations.join("\n"),
        /API and protocol baselines record different package versions/u,
    );
    assert.match(
        integrity.violations.join("\n"),
        /package version 1\.0\.0 is lower than the baseline version 1\.2\.0/u,
    );
    assert.match(
        integrity.violations.join("\n"),
        /version:p#\/label: changed a to b: its classified entry names version 1\.0\.0, but the package is 1\.0\.0|is classified additive and requires at least a MINOR version bump/u,
    );

    const sameVersion = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {}, previousVersion: null },
        changes: [
            {
                artifact: "version:p#/label",
                classification: "additive",
                from: "a",
                to: "b",
                version: "1.2.0",
            },
        ],
        currentApi: { entries: {}, packageVersion: "1.2.0" },
        currentProtocol: { ...surface, versions: { ...surface.versions, "p#/label": "b" } },
        policy,
        protocolBaseline: { ...protocolBaseline, previousVersion: null },
    });
    assert.match(
        sameVersion.violations.join("\n"),
        /version:p#\/label: changed a to b is classified additive and requires at least a MINOR version bump \(baseline 1\.2\.0, package 1\.2\.0\)/u,
    );

    const wrongVersion = evaluateCompatibility({
        apiBaseline: { ...apiBaseline, entries: {} },
        changes: [
            {
                artifact: "version:p#/label",
                classification: "additive",
                from: "a",
                to: "b",
                version: "1.2.0",
            },
        ],
        currentApi: { entries: {}, packageVersion: "1.3.0" },
        currentProtocol: { ...surface, versions: { ...surface.versions, "p#/label": "b" } },
        policy,
        protocolBaseline,
    });
    assert.match(
        wrongVersion.violations.join("\n"),
        /its classified entry names version 1\.2\.0, but the package is 1\.3\.0/u,
    );

    assert.throws(
        () =>
            evaluateCompatibility({
                apiBaseline: { ...apiBaseline, entries: {} },
                changes: [],
                currentApi: { entries: { "./unknown": {} }, packageVersion: "1.2.0" },
                currentProtocol: surface,
                policy,
                protocolBaseline,
            }),
        /package entry \.\/unknown has no configured stability tier/u,
    );
    assert.throws(
        () =>
            evaluateCompatibility({
                apiBaseline: { ...apiBaseline, entries: {} },
                changes: [],
                currentApi: { entries: {}, packageVersion: "1.2" },
                currentProtocol: surface,
                policy,
                protocolBaseline,
            }),
        /package version must be MAJOR\.MINOR\.PATCH: 1\.2/u,
    );
});

test("policy, change-log, baseline, and surface inputs are validated", async (context) => {
    const invalidPolicies: unknown[] = [
        null,
        {
            ...productionPolicy,
            tiers: { stable: { requiresClassification: "yes", requiresVersionBump: true } },
        },
        {
            ...productionPolicy,
            tiers: { stable: { requiresClassification: true, requiresVersionBump: 1 } },
        },
        { ...productionPolicy, api: { ...productionPolicy.api, tiers: { ".": "unknown" } } },
        { ...productionPolicy, api: { ...productionPolicy.api, tiers: { ".": 1 } } },
        {
            ...productionPolicy,
            deprecation: { sincePattern: "x", tag: "deprecated", windowMinorReleases: 2 },
        },
        {
            ...productionPolicy,
            deprecation: { ...productionPolicy.deprecation, lastReleasedVersion: "1" },
        },
        { ...productionPolicy, build: { sources: [1] } },
        {
            ...productionPolicy,
            classification: { additiveNotePatterns: ["("], perArtifactPatterns: [] },
        },
        {
            ...productionPolicy,
            protocol: { ...productionPolicy.protocol, migrationBackedVersions: [null] },
        },
        {
            ...productionPolicy,
            protocol: {
                ...productionPolicy.protocol,
                identity: { keyPattern: "x", pointers: [{ pointer: "/x" }], sources: [] },
            },
        },
        {
            ...productionPolicy,
            deprecation: {
                sincePattern: "(?<version>x)",
                tag: "deprecated",
                windowMinorReleases: -1,
            },
        },
        {
            ...productionPolicy,
            deprecation: {
                sincePattern: "(?<version>x)",
                tag: "deprecated",
                windowMinorReleases: "2",
            },
        },
        {
            ...productionPolicy,
            deprecation: { sincePattern: "(?<version>", tag: "deprecated", windowMinorReleases: 2 },
        },
        { ...productionPolicy, frozen: { artifactPatterns: "x", supersededSchemaPattern: "x" } },
        {
            ...productionPolicy,
            protocol: {
                ...productionPolicy.protocol,
                deprecations: [{ artifact: "x", since: "1" }],
            },
        },
        { ...productionPolicy, protocol: { ...productionPolicy.protocol, deprecations: [null] } },
        {
            ...productionPolicy,
            protocol: { ...productionPolicy.protocol, migrations: [{ pointer: "", source: "x" }] },
        },
        { ...productionPolicy, protocol: { ...productionPolicy.protocol, tier: "missing" } },
    ];
    for (const policy of invalidPolicies) {
        assert.throws(() => parseCompatibilityPolicy(policy), TypeError);
    }
    for (const log of [
        {},
        [null],
        [{ artifact: "a", classification: "other", from: "1", to: "2", version: "1.0.0" }],
        [{ artifact: "a", classification: "additive", from: "1", to: "2", version: "1" }],
        [
            {
                artifact: "a",
                classification: "additive",
                from: "1",
                to: "2",
                note: "",
                version: "1.0.0",
            },
        ],
    ]) {
        assert.throws(() => parseClassifiedChanges(log), TypeError);
    }
    assert.deepEqual(
        parseClassifiedChanges([
            { artifact: "a", classification: "breaking", from: "1", to: "2", version: "2.0.0" },
        ]),
        [{ artifact: "a", classification: "breaking", from: "1", to: "2", version: "2.0.0" }],
    );

    const root = await fixtureRepository(context);
    const apiBaselinePath = path.join(root, "spec/compatibility/api-baseline.json");
    const protocolBaselinePath = path.join(root, "spec/compatibility/protocol-baseline.json");
    const apiBaseline = await readFile(apiBaselinePath, "utf8");
    const protocolBaseline = JSON.parse(await readFile(protocolBaselinePath, "utf8")) as Record<
        string,
        unknown
    >;
    for (const invalid of [
        {
            entries: { ".": { helper: { kind: "function" } } },
            packageVersion: "1.0.0",
            previousVersion: null,
        },
        { entries: {}, packageVersion: "1.0.0", previousVersion: "next" },
    ]) {
        await writeFile(apiBaselinePath, JSON.stringify(invalid));
        await assert.rejects(checkCompatibility({ repositoryRoot: root }), TypeError);
    }
    await writeFile(apiBaselinePath, apiBaseline);
    for (const invalid of [
        { ...protocolBaseline, changeLog: { digest: "sha256:x", entries: -1 } },
        { ...protocolBaseline, surface: { ...(protocolBaseline.surface as object), versions: [] } },
        { ...protocolBaseline, surface: { ...(protocolBaseline.surface as object), commands: {} } },
        { ...protocolBaseline, surface: { ...(protocolBaseline.surface as object), identity: [] } },
    ]) {
        await writeFile(protocolBaselinePath, JSON.stringify(invalid));
        await assert.rejects(checkCompatibility({ repositoryRoot: root }), TypeError);
    }
    await writeFile(protocolBaselinePath, "{");
    await assert.rejects(checkCompatibility({ repositoryRoot: root }), SyntaxError);
    await rm(protocolBaselinePath);
    await assert.rejects(checkCompatibility({ repositoryRoot: root }), /baselines are missing/u);

    const fresh = await fixtureRepository(context);
    await rm(path.join(fresh, "spec/compatibility"), { recursive: true });
    await mkdir(path.join(fresh, "spec/compatibility"));
    await mutateJson(fresh, "public-errors.config.json", (config) => {
        config.codes = {};
    });
    await updateCompatibilityBaseline({ repositoryRoot: fresh });
    const created = JSON.parse(
        await readFile(path.join(fresh, "spec/compatibility/api-baseline.json"), "utf8"),
    ) as ApiBaseline;
    assert.equal(created.previousVersion, null);
    assert.match(
        await readFile(path.join(fresh, "spec/compatibility/protocol-baseline.json"), "utf8"),
        /\n {8}"errorCodes": \[\],\n/u,
    );

    const configuration = policyOf(productionPolicy).protocol;
    for (const [label, mutate] of [
        [
            "migration list",
            (config: Record<string, unknown>) => {
                (config.kernel as { store: Record<string, unknown> }).store.migrations = {};
            },
        ],
        [
            "exit code",
            (config: Record<string, unknown>) => {
                (config.cli as { exitCodes: Record<string, unknown> }).exitCodes.usage = "2";
            },
        ],
        [
            "groups",
            (config: Record<string, unknown>) => {
                (config.cli as Record<string, unknown>).groups = {};
            },
        ],
        [
            "group commands",
            (config: Record<string, unknown>) => {
                (config.cli as { groups: Record<string, unknown>[] }).groups[0] = { name: "init" };
            },
        ],
        [
            "group name",
            (config: Record<string, unknown>) => {
                (config.cli as { groups: Record<string, unknown>[] }).groups[0] = {
                    commands: [],
                    name: "",
                };
            },
        ],
        [
            "command option table",
            (config: Record<string, unknown>) => {
                (config.cli as Record<string, unknown>).commandOptions = [];
            },
        ],
        [
            "option map",
            (config: Record<string, unknown>) => {
                (config.cli as Record<string, unknown>).options = [];
            },
        ],
        [
            "undeclared handler",
            (config: Record<string, unknown>) => {
                delete (config.cli as { commandOptions: Record<string, unknown> }).commandOptions[
                    "run-list"
                ];
            },
        ],
        [
            "group without handler",
            (config: Record<string, unknown>) => {
                (config.cli as { groups: Record<string, unknown>[] }).groups[0] = {
                    commands: [],
                    name: "init",
                };
            },
        ],
        [
            "declared entry",
            (config: Record<string, unknown>) => {
                (config.cli as { commandOptions: Record<string, unknown> }).commandOptions[
                    "run-list"
                ] = null;
            },
        ],
        [
            "declared kinds",
            (config: Record<string, unknown>) => {
                (config.cli as { commandOptions: Record<string, unknown> }).commandOptions[
                    "run-list"
                ] = { flags: "limit", values: [] };
            },
        ],
        [
            "declared keys",
            (config: Record<string, unknown>) => {
                (config.cli as { commandOptions: Record<string, unknown> }).commandOptions[
                    "run-list"
                ] = { flags: [], values: [1] };
            },
        ],
        [
            "unconfigured key",
            (config: Record<string, unknown>) => {
                (config.cli as { commandOptions: Record<string, unknown> }).commandOptions[
                    "run-list"
                ] = { flags: [], values: ["unconfigured"] };
            },
        ],
    ] as const) {
        const broken = await fixtureRepository(context);
        await mutateJson(broken, "protocol.config.json", mutate);
        await assert.rejects(extractProtocolSurface(broken, configuration), TypeError, label);
    }

    assert.deepEqual(fingerprintSchema({ type: "string" }).oneOf, null);
    assert.equal(fingerprintSchema({ oneOf: "invalid" }).rest, digestOf({ oneOf: "invalid" }));
    assert.throws(() => fingerprintSchema([]), /schema must be an object/u);
    assert.equal(resolvePointer({ a: { "b/c": { "d~e": 1 } } }, "/a/b~1c/d~0e"), 1);
    assert.deepEqual(resolvePointer({ a: 1 }, ""), { a: 1 });
    assert.throws(() => resolvePointer({}, "a"), /must start with/u);
    assert.throws(() => resolvePointer({ a: 1 }, "/a/b"), /does not resolve/u);
    assert.throws(() => containedPath(root, ".."), /must remain inside/u);
    assert.throws(() => containedPath(root, "."), /must remain inside/u);
    assert.equal(containedPath(root, "a/b"), path.join(root, "a/b"));
});

async function fixtureRepository(
    context: TestContext,
    declarations = baseDeclarations,
): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-compatibility-test-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    await mkdir(path.join(root, "config"));
    await mkdir(path.join(root, "dist"));
    await mkdir(path.join(root, "spec/compatibility"), { recursive: true });
    await cp(path.join(repositoryRoot, "spec/schemas"), path.join(root, "spec/schemas"), {
        recursive: true,
    });
    for (const file of ["protocol.config.json", "public-errors.config.json"]) {
        await cp(path.join(repositoryRoot, file), path.join(root, file));
    }
    await writeFile(
        path.join(root, "config/compatibility-policy.config.json"),
        JSON.stringify({
            ...productionPolicy,
            api: { ...productionPolicy.api, tiers: { ".": "stable" } },
            deprecation: { ...productionPolicy.deprecation, lastReleasedVersion: "1.0.0" },
        }),
    );
    await writeFile(
        path.join(root, "api-reference.config.json"),
        JSON.stringify({
            artifact: "api-reference.md",
            declarationRoot: "dist",
            entries: { ".": { authority: "None.", summary: "Fixture.", title: "Root" } },
            forbiddenDeclarationPatterns: [],
            forbiddenPatterns: [],
            runtime: "Node.",
        }),
    );
    await writeDeclarations(root, declarations);
    await setVersion(root, "1.0.0");
    await updateCompatibilityBaseline({ repositoryRoot: root });
    return root;
}

async function writeDeclarations(root: string, text: string): Promise<void> {
    await writeFile(path.join(root, "dist/index.d.ts"), text);
}

async function setVersion(root: string, version: string): Promise<void> {
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
            engines: { node: ">=24" },
            exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
            name: "@example/compatibility-fixture",
            version,
        }),
    );
}

async function mutateJson(
    root: string,
    file: string,
    mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
    const filePath = path.join(root, file);
    const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    mutate(value);
    await writeFile(filePath, JSON.stringify(value));
}

async function rejection(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error("expected rejection");
}

function policyOf(value: unknown): CompatibilityPolicy {
    return parseCompatibilityPolicy(value);
}

function protocolSurface(): ProtocolSurface {
    return {
        commands: ["old"],
        errorCodes: [],
        exitCodes: { gone: 1 },
        migrations: { "p#/m": ["sha256:1"] },
        schemas: {
            "family-v1.schema.json": fingerprintSchema({ const: "one" }),
            "family-v2.schema.json": fingerprintSchema({ const: "two" }),
            "gone.schema.json": fingerprintSchema({ const: "gone" }),
            "plain.schema.json": fingerprintSchema({ type: "string" }),
        },
        versions: {
            "p#/frozen": 1,
            "p#/gone": 0,
            "p#/label": "a",
            "p#/number": 2,
            "p#/format": 1,
            "p#/schema": 1,
        },
    };
}
