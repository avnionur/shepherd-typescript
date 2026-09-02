import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    checkApiReference,
    generateApiReference,
    writeApiReference,
} from "../tooling/api-reference/generator.ts";

test("API reference is deterministic, complete, and safe for every supported package entry", async () => {
    const packageManifest = JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly exports: Readonly<Record<string, unknown>> };
    const configuration = JSON.parse(
        await readFile(new URL("../api-reference.config.json", import.meta.url), "utf8"),
    ) as { readonly runtime: string };
    const first = await generateApiReference();
    const second = await generateApiReference();
    const checkedIn = await readFile(
        new URL("../docs/generated/api-reference.md", import.meta.url),
        "utf8",
    );

    assert.equal(first, second);
    assert.equal(first, checkedIn);
    for (const entry of Object.keys(packageManifest.exports).sort()) {
        assert.match(first, new RegExp(`Package entry: \`${escapeRegExp(entry)}\``));
    }
    assert.match(first, /Classification: `runtime-(?:and-type|only)`/u);
    assert.match(first, /Classification: `type-only`/u);
    assert.match(first, /Throws:/u);
    assert.match(first, /Authority and mutation:/u);
    assert.match(first, new RegExp(escapeRegExp(configuration.runtime)));
    assert.doesNotMatch(
        first,
        /(?:#private|@internal|node_modules|\/Users\/|[A-Za-z]:\\\\|migrations?\.ts|codec\.ts|validation\.ts|(?:class|interface|type|function|const)\s+\w*(?:Credential|Secret|AccessToken)|stack trace)/iu,
    );
});

test("API reference check mode rejects stale, internal, and unsafe declaration inputs", async (context) => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "shepherd-api-reference-test-"));
    context.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const declarationDirectory = path.join(repositoryRoot, "dist");
    const artifactDirectory = path.join(repositoryRoot, "docs", "generated");
    await mkdir(declarationDirectory);
    await mkdir(artifactDirectory, { recursive: true });
    const declarationPath = path.join(declarationDirectory, "index.d.ts");
    const packagePath = path.join(repositoryRoot, "package.json");
    const configurationPath = path.join(repositoryRoot, "api-reference.config.json");
    const productionConfiguration = JSON.parse(
        await readFile(new URL("../api-reference.config.json", import.meta.url), "utf8"),
    ) as { readonly forbiddenDeclarationPatterns: readonly Record<string, unknown>[] };
    await writeFile(
        declarationPath,
        `/** Runtime summary.\n * @throws {TypeError} If input is invalid.\n * @return The input.\n * @exception {RangeError} If input is out of range.\n * @deprecated Use another fixture.\n * @beta\n */\nexport declare function run<T>(value: T): T;\n/** Type summary. */\nexport type Shape<T> = { readonly value: T };\n/** Resource summary. */\nexport declare class Resource {\n    #private;\n    constructor();\n    /** @internal Hidden implementation member. */\n    hidden(): void;\n    /** Closes the resource. */\n    close(): void;\n    undocumented(): void;\n}\n/** Callable summary. */\nexport interface Callable {\n    /** Calls the fixture. */\n    (value: string): string;\n    /** Constructs the fixture. */\n    new (): Resource;\n    /** Indexes the fixture. */\n    [key: string]: string;\n}\n/** Empty interface summary. */\nexport interface Empty {}\n/** Enum summary. */\nexport declare enum FixtureEnum { Value = "value" }\n/** Namespace summary. */\nexport declare namespace FixtureNamespace { const value: string; }\n`,
    );
    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/index.d.ts")));
    await writeFile(
        configurationPath,
        JSON.stringify(
            fixtureConfiguration(
                "docs/generated/api-reference.md",
                productionConfiguration.forbiddenDeclarationPatterns,
            ),
        ),
    );
    const options = { configurationPath, packagePath, repositoryRoot };

    const generated = await generateApiReference(options);
    assert.match(generated, /run<T>\(value: T\): T/u);
    assert.match(generated, /Throws:\n\n- \{TypeError\} If input is invalid\./u);
    assert.match(generated, /Classification: `type-only`/u);
    assert.match(generated, /close\(\): void/u);
    assert.match(generated, /#### `call signature`/u);
    assert.match(generated, /#### `construct signature`/u);
    assert.match(generated, /#### `index signature`/u);
    assert.match(generated, /@deprecated:/u);
    assert.match(generated, /@beta:\n\n- Declared\./u);
    assert.doesNotMatch(generated, /#private|hidden\(\)|@internal/u);

    const artifactPath = await writeApiReference(options);
    assert.equal(await checkApiReference(options), artifactPath);
    await writeFile(artifactPath, "stale\n");
    await assert.rejects(checkApiReference(options), /is stale/u);

    const validConfiguration = fixtureConfiguration(
        "docs/generated/api-reference.md",
        productionConfiguration.forbiddenDeclarationPatterns,
    );
    for (const invalidConfiguration of [
        [],
        null,
        "invalid",
        { ...validConfiguration, entries: [] },
        { ...validConfiguration, forbiddenPatterns: null },
        { ...validConfiguration, runtime: 24 },
        {
            ...validConfiguration,
            forbiddenPatterns: [{ flags: "u", label: "", pattern: "blocked" }],
        },
    ]) {
        await writeFile(configurationPath, JSON.stringify(invalidConfiguration));
        await assert.rejects(generateApiReference(options), TypeError);
    }
    await writeFile(configurationPath, JSON.stringify(validConfiguration));

    await writeFile(
        configurationPath,
        JSON.stringify({
            ...validConfiguration,
            entries: {
                "./renamed": {
                    authority: "No mutation authority.",
                    summary: "Fixture entry.",
                    title: "Renamed",
                },
            },
        }),
    );
    await assert.rejects(generateApiReference(options), /must exactly match/u);
    await writeFile(configurationPath, JSON.stringify(validConfiguration));

    await writeFile(
        configurationPath,
        JSON.stringify({ ...validConfiguration, declarationRoot: ".." }),
    );
    await assert.rejects(generateApiReference(options), /must remain inside/u);
    await writeFile(configurationPath, JSON.stringify(validConfiguration));

    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/index.js")));
    await assert.rejects(generateApiReference(options), /must target an emitted declaration/u);

    const emptyDeclarationPath = path.join(declarationDirectory, "empty.d.ts");
    await writeFile(emptyDeclarationPath, "interface NotExported {}\n");
    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/empty.d.ts")));
    await assert.rejects(generateApiReference(options), /not an external module/u);

    await writeFile(
        packagePath,
        JSON.stringify({
            ...fixturePackage("./dist/index.d.ts"),
            exports: {
                ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
                "./extra": { import: "./dist/extra.js", types: "./dist/extra.d.ts" },
            },
        }),
    );
    await assert.rejects(generateApiReference(options), /must exactly match/u);

    await writeFile(packagePath, JSON.stringify(fixturePackage("../outside.d.ts")));
    await assert.rejects(generateApiReference(options), /must remain inside/u);

    const externalRoot = await mkdtemp(path.join(tmpdir(), "shepherd-api-reference-external-"));
    context.after(() => rm(externalRoot, { force: true, recursive: true }));
    const externalDeclarationPath = path.join(externalRoot, "outside.d.ts");
    await writeFile(
        externalDeclarationPath,
        "/** Outside export. */\nexport declare const outside: string;\n",
    );
    const linkedDeclarationPath = path.join(declarationDirectory, "linked.d.ts");
    await symlink(externalDeclarationPath, linkedDeclarationPath);
    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/linked.d.ts")));
    await assert.rejects(generateApiReference(options), /real path must remain inside/u);

    const outsideImportPath = path.join(repositoryRoot, "outside-import.d.ts");
    await writeFile(
        outsideImportPath,
        "/** Outside import. */\nexport declare const outsideImport: string;\n",
    );
    await writeFile(declarationPath, 'export { outsideImport } from "../outside-import.d.ts";\n');
    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/index.d.ts")));
    await assert.rejects(generateApiReference(options), /does not resolve inside/u);

    await writeFile(
        declarationPath,
        "/** Forbidden output. */\nexport declare const forbiddenOutput: string;\n",
    );
    await writeFile(
        configurationPath,
        JSON.stringify({
            ...validConfiguration,
            forbiddenPatterns: [{ flags: "u", label: "fixture text", pattern: "Forbidden output" }],
        }),
    );
    await assert.rejects(generateApiReference(options), /contains forbidden fixture text/u);

    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/index.d.ts")));
    const externalArtifactPath = path.join(repositoryRoot, "external-artifact.md");
    const linkedArtifactPath = path.join(artifactDirectory, "linked-reference.md");
    await writeFile(externalArtifactPath, "preserved\n");
    await symlink(externalArtifactPath, linkedArtifactPath);
    await writeFile(
        configurationPath,
        JSON.stringify(
            fixtureConfiguration(
                "docs/generated/linked-reference.md",
                productionConfiguration.forbiddenDeclarationPatterns,
            ),
        ),
    );
    await assert.rejects(writeApiReference(options), /without symlinks/u);
    assert.equal(await readFile(externalArtifactPath, "utf8"), "preserved\n");

    const externalArtifactDirectory = await mkdtemp(
        path.join(tmpdir(), "shepherd-api-reference-artifact-"),
    );
    context.after(() => rm(externalArtifactDirectory, { force: true, recursive: true }));
    const linkedArtifactDirectory = path.join(repositoryRoot, "linked-artifacts");
    await symlink(externalArtifactDirectory, linkedArtifactDirectory);
    await writeFile(
        configurationPath,
        JSON.stringify(
            fixtureConfiguration(
                "linked-artifacts/reference.md",
                productionConfiguration.forbiddenDeclarationPatterns,
            ),
        ),
    );
    await assert.rejects(writeApiReference(options), /parent must remain inside/u);

    await writeFile(
        configurationPath,
        JSON.stringify(
            fixtureConfiguration(
                "docs/generated",
                productionConfiguration.forbiddenDeclarationPatterns,
            ),
        ),
    );
    await assert.rejects(writeApiReference(options), /regular file/u);

    await writeFile(
        configurationPath,
        JSON.stringify(
            fixtureConfiguration(
                "docs/generated/api-reference.md",
                productionConfiguration.forbiddenDeclarationPatterns,
            ),
        ),
    );
    await writeFile(
        declarationPath,
        `/** Runtime summary. */\nexport declare function run<T>(value: T): T;\n`,
    );
    for (const [target, symbol] of [
        ["./dist/private/codec.d.ts", "PrivateCodec"],
        ["./dist/private/migration.d.ts", "PrivateMigration"],
        ["./dist/sql-statements.d.ts", "SqlStatement"],
        ["./dist/store/read.d.ts", "readStoreRows"],
        ["./dist/protocol/config.d.ts", "protocolConfig"],
        ["./dist/private/validation.d.ts", "validatePrivate"],
        ["./dist/provider/credentials.d.ts", "ProviderCredentials"],
    ] as const) {
        const privateDeclarationPath = path.join(repositoryRoot, target);
        await mkdir(path.dirname(privateDeclarationPath), { recursive: true });
        await writeFile(
            privateDeclarationPath,
            `/** Must remain private. */\nexport declare const ${symbol}: string;\n`,
        );
        await writeFile(packagePath, JSON.stringify(fixturePackage(target)));
        await assert.rejects(generateApiReference(options), /resolves from forbidden/u);
    }

    await writeFile(packagePath, JSON.stringify(fixturePackage("./dist/index.d.ts")));
    await writeFile(
        declarationPath,
        "/** Internal export. @internal */\nexport declare function internalOnly(): void;\n",
    );
    await assert.rejects(generateApiReference(options), /marked internal/u);
});

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function fixturePackage(declarationTarget: string): Record<string, unknown> {
    return {
        engines: { node: ">=24.0.0" },
        exports: { ".": { import: "./dist/index.js", types: declarationTarget } },
        name: "@example/reference-fixture",
        version: "1.0.0",
    };
}

function fixtureConfiguration(
    artifact = "docs/generated/api-reference.md",
    forbiddenDeclarationPatterns: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
    return {
        artifact,
        declarationRoot: "dist",
        entries: {
            ".": {
                authority: "No mutation authority.",
                summary: "Fixture entry.",
                title: "Root",
            },
        },
        forbiddenDeclarationPatterns,
        forbiddenPatterns: [
            { flags: "u", label: "internal annotation", pattern: "@internal" },
            { flags: "u", label: "private declaration member", pattern: "#private" },
        ],
        runtime: "Node 24 or newer.",
    };
}
