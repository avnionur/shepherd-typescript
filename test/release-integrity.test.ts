import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import {
    parseReleaseIntegrityConfiguration,
    readReleaseIntegrityConfiguration,
} from "../tooling/release/integrity-config.ts";
import {
    createProvenanceStatement,
    isProvenanceStatement,
    type ProvenanceStatement,
    writeReleaseEvidence,
} from "../tooling/release/provenance.ts";
import {
    type BuildEvidence,
    compareBuilds,
    digestTree,
    readTarEntries,
    runReproducibleBuild,
    sha256,
    treeDigest,
} from "../tooling/release/reproducible-build.ts";
import {
    checkSbom,
    generateRepositorySbom,
    generateSbom,
    writeSbom,
} from "../tooling/release/sbom.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const productionConfiguration = JSON.parse(
    await readFile(path.join(repositoryRoot, "config/release-integrity.config.json"), "utf8"),
) as Record<string, Record<string, unknown>>;
const configuration = parseReleaseIntegrityConfiguration(productionConfiguration);

const fixtureLockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      runtime-lib:
        specifier: 1.0.0
        version: 1.0.0(peer-lib@2.0.0)
      shared:
        specifier: 1.0.0
        version: 1.0.0
    optionalDependencies:
      maybe:
        specifier: 1.0.0
        version: 1.0.0
    devDependencies:
      aliased:
        specifier: npm:@scope/real@3.0.0
        version: '@scope/real@3.0.0'

packages:

  '@scope/real@3.0.0':
    resolution: {integrity: sha256-AAAA}

  maybe@1.0.0:
    resolution: {integrity: sha1-AAAA sha384-AAAA}

  peer-lib@2.0.0:
    resolution: {tarball: https://example.invalid/peer-lib.tgz}

  runtime-lib@1.0.0:
    resolution: {integrity: sha512-AAAA}

  shared@1.0.0:
    resolution: {integrity: sha512-AAAA}

  transitive@1.0.0:
    resolution: {integrity: sha512-AAAA}

snapshots:

  '@scope/real@3.0.0':
    dependencies:
      shared: 1.0.0

  maybe@1.0.0:
    dependencies:
      shared: 1.0.0
    optional: true

  peer-lib@2.0.0: {}

  runtime-lib@1.0.0(peer-lib@2.0.0):
    dependencies:
      peer-lib: 2.0.0
    optionalDependencies:
      transitive: 1.0.0

  shared@1.0.0: {}

  transitive@1.0.0: {}
`;

test("the checked-in SBOM matches the lockfile and regenerates identically", async () => {
    const first = await generateRepositorySbom();
    assert.equal(first, await generateRepositorySbom());
    assert.equal(
        await readFile(path.join(repositoryRoot, configuration.sbom.artifact), "utf8"),
        first,
    );
    await checkSbom();
    const bom = JSON.parse(first) as {
        readonly components: readonly { readonly scope: string }[];
        readonly serialNumber: string;
    };
    assert.ok(bom.components.length > 0);
    assert.ok(bom.components.every(({ scope }) => scope === "excluded"));
    assert.match(
        bom.serialNumber,
        /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
});

test("SBOM generation classifies runtime, optional, and development components", () => {
    const bom = generateSbom({
        configuration: configuration.sbom,
        lockfileText: fixtureLockfile,
        packageManifest: { license: "MIT", name: "fixture-root", version: "1.2.3" },
    });
    const byName = new Map(bom.components.map((component) => [component.name, component]));
    assert.equal(byName.get("runtime-lib")?.scope, "required");
    assert.equal(byName.get("peer-lib")?.scope, "required");
    assert.equal(byName.get("shared")?.scope, "required");
    assert.equal(byName.get("transitive")?.scope, "optional");
    assert.equal(byName.get("maybe")?.scope, "optional");
    assert.equal(byName.get("real")?.scope, "excluded");
    assert.equal(byName.get("real")?.group, "@scope");
    assert.equal(byName.get("real")?.purl, "pkg:npm/%40scope/real@3.0.0");
    assert.deepEqual(byName.get("real")?.properties, [
        { name: configuration.sbom.developmentProperty, value: "true" },
    ]);
    assert.deepEqual(byName.get("maybe")?.properties, [
        { name: `${configuration.sbom.propertyPrefix}:optional`, value: "true" },
    ]);
    assert.deepEqual(
        byName.get("maybe")?.hashes?.map(({ alg }) => alg),
        ["SHA-1", "SHA-384"],
    );
    assert.equal(byName.get("peer-lib")?.hashes, undefined);
    assert.equal(bom.metadata.component.purl, "pkg:npm/fixture-root@1.2.3");
    assert.equal(bom.metadata.component.group, undefined);
    assert.deepEqual(
        bom.dependencies.find(({ ref }) => ref === bom.metadata.component.purl)?.dependsOn,
        [
            "pkg:npm/%40scope/real@3.0.0",
            "pkg:npm/maybe@1.0.0",
            "pkg:npm/runtime-lib@1.0.0",
            "pkg:npm/shared@1.0.0",
        ],
    );
    assert.deepEqual(
        bom.dependencies.find(({ ref }) => ref === "pkg:npm/runtime-lib@1.0.0")?.dependsOn,
        ["pkg:npm/peer-lib@2.0.0", "pkg:npm/transitive@1.0.0"],
    );
    assert.ok(
        bom.metadata.properties.some(
            ({ name, value }) =>
                name === `${configuration.sbom.propertyPrefix}:runtime-components` && value === "5",
        ),
    );
    assert.deepEqual(
        generateSbom({
            configuration: configuration.sbom,
            lockfileText: fixtureLockfile,
            packageManifest: { license: "MIT", name: "fixture-root", version: "1.2.3" },
        }),
        bom,
    );

    const empty = generateSbom({
        configuration: configuration.sbom,
        lockfileText: "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
        packageManifest: { license: "MIT", name: "@scope/empty", version: "0.0.1" },
    });
    assert.deepEqual(empty.components, []);
    assert.equal(empty.metadata.component.group, "@scope");
    const unresolved = generateSbom({
        configuration: configuration.sbom,
        lockfileText: "importers:\n  .: {}\npackages:\n  local@1.0.0: {}\n",
        packageManifest: { license: "MIT", name: "root", version: "1.0.0" },
    });
    assert.equal(unresolved.components[0]?.hashes, undefined);
    assert.equal(unresolved.components[0]?.scope, "excluded");

    for (const [lockfileText, pattern] of [
        ["[]", /lockfile must be an object/u],
        [
            "importers:\n  .: {}\npackages:\n  broken: {}\n",
            /package key must be name@version: broken/u,
        ],
        [
            "importers:\n  .: {}\npackages:\n  trailing@: {}\n",
            /package key must be name@version: trailing@/u,
        ],
        [
            "importers:\n  .: {}\npackages:\n  a@1.0.0:\n    resolution: {integrity: md5-AAAA}\n",
            /unsupported lockfile integrity: md5-AAAA/u,
        ],
        [
            "importers:\n  .: {}\npackages:\n  a@1.0.0:\n    resolution: {integrity: noseparator}\n",
            /unsupported lockfile integrity/u,
        ],
        [
            "importers:\n  .:\n    dependencies:\n      missing:\n        specifier: 1.0.0\n        version: 1.0.0\n",
            /lockfile dependency has no package entry: missing@1\.0\.0/u,
        ],
        [
            "importers:\n  .: {}\nsnapshots:\n  a@1.0.0:\n    dependencies:\n      b: 1.0.0\n",
            /lockfile dependency has no package entry/u,
        ],
        [
            "importers:\n  .:\n    dependencies:\n      a: {}\n",
            /version must be a non-empty string/u,
        ],
    ] as const) {
        assert.throws(
            () =>
                generateSbom({
                    configuration: configuration.sbom,
                    lockfileText,
                    packageManifest: { license: "MIT", name: "x", version: "1.0.0" },
                }),
            pattern,
        );
    }
});

test("SBOM write and check operate on the configured artifact", async (context) => {
    const root = await temporaryDirectory(context, "shepherd-sbom-test-");
    await mkdir(path.join(root, "config"));
    await mkdir(path.join(root, "docs/generated"), { recursive: true });
    await cp(
        path.join(repositoryRoot, "config/release-integrity.config.json"),
        path.join(root, "config/release-integrity.config.json"),
    );
    await writeFile(path.join(root, "pnpm-lock.yaml"), fixtureLockfile);
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ license: "MIT", name: "fixture-root", version: "1.0.0" }),
    );
    const artifact = await writeSbom(root);
    assert.equal(await checkSbom({ repositoryRoot: root }), artifact);
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ license: "MIT", name: "fixture-root", version: "1.0.1" }),
    );
    await assert.rejects(checkSbom({ repositoryRoot: root }), /SBOM is stale/u);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));
    await assert.rejects(generateRepositorySbom({ repositoryRoot: root }), /package license/u);
    await writeFile(path.join(root, "package.json"), "[]");
    await assert.rejects(generateRepositorySbom({ repositoryRoot: root }), /must be an object/u);
});

test("release-integrity configuration is validated", async () => {
    assert.deepEqual(await readReleaseIntegrityConfiguration(), configuration);
    for (const invalid of [
        null,
        { ...productionConfiguration, sbom: [] },
        {
            ...productionConfiguration,
            provenance: { ...productionConfiguration.provenance, artifact: "" },
        },
        {
            ...productionConfiguration,
            reproducibleBuild: { buildCommand: [], packCommand: ["npm"] },
        },
        {
            ...productionConfiguration,
            reproducibleBuild: { buildCommand: ["pnpm", 1], packCommand: ["npm"] },
        },
    ]) {
        assert.throws(() => parseReleaseIntegrityConfiguration(invalid), TypeError);
    }
});

test("tarball entries are read from ustar and PAX headers", () => {
    const longName = "n".repeat(100);
    const archive = tarball([
        { body: "global", name: "pax_global_header", type: "g" },
        { body: "22 path=package/long.js\n", name: "PaxHeader", type: "x" },
        { body: "long body", name: "ignored", type: "0" },
        { body: "10 x=value\n", name: "PaxHeader", type: "x" },
        { body: "plain", name: "plain.js", type: "\0" },
        { body: "", name: "dir/", prefix: "package", type: "5" },
        { body: "full", name: longName, type: "0" },
        { body: "", emptyMode: true, name: "no-mode", type: "0" },
    ]);
    const entries = readTarEntries(archive);
    assert.deepEqual(
        entries.map(({ mode, path: entryPath, type }) => ({ entryPath, mode, type })),
        [
            { entryPath: "package/long.js", mode: 0o644, type: "0" },
            { entryPath: "plain.js", mode: 0o644, type: "0" },
            { entryPath: "package/dir/", mode: 0o644, type: "5" },
            { entryPath: longName, mode: 0o644, type: "0" },
            { entryPath: "no-mode", mode: 0, type: "0" },
        ],
    );
    assert.equal(entries[0]?.sha256, sha256("long body"));
    assert.equal(entries[0]?.mtime, 0o3561752204);

    assert.deepEqual(readTarEntries(gzipSync(Buffer.alloc(0))), []);
    assert.throws(() => readTarEntries(gzipSync(Buffer.alloc(100, 1))), /truncated tar header/u);
    const corrupt = gunzipSync(tarball([{ body: "x", name: "bad", type: "0" }]));
    corrupt.write("9", 124);
    assert.throws(() => readTarEntries(gzipSync(corrupt)), /non-octal field/u);
});

test("reproducible builds compare output trees and tarballs and report differing files", async (context) => {
    const outputDirectory = await temporaryDirectory(context, "shepherd-reproducible-out-");
    let builds = 0;
    const identical = await runReproducibleBuild({
        build: async () => {
            builds += 1;
            await mkdir(path.join(outputDirectory, "nested"), { recursive: true });
            await writeFile(path.join(outputDirectory, "nested/a.js"), "a");
            await writeFile(path.join(outputDirectory, "b.js"), "b");
            await rm(path.join(outputDirectory, "link"), { force: true });
            await symlink("b.js", path.join(outputDirectory, "link"));
        },
        outputDirectory,
        pack: async (destination) => {
            const tarballPath = path.join(destination, "fixture-1.0.0.tgz");
            await writeFile(tarballPath, tarball([{ body: "a", name: "package/a.js", type: "0" }]));
            return tarballPath;
        },
    });
    context.after(identical.dispose);
    assert.equal(builds, 2);
    assert.equal(identical.report.identical, true);
    assert.deepEqual(identical.report.differingFiles, []);
    assert.equal(path.basename(identical.tarballPath), "fixture-1.0.0.tgz");
    assert.equal(
        identical.report.builds[0]?.tarballSha256,
        sha256(await readFile(identical.tarballPath)),
    );

    const files = await digestTree(outputDirectory);
    assert.deepEqual(Object.keys(files), ["b.js", "link", "nested/a.js"]);
    assert.equal(files.link, "symlink:b.js");
    assert.equal(treeDigest(files), identical.report.builds[1]?.distTreeDigest);

    let run = 0;
    const differing = await runReproducibleBuild({
        build: async () => {
            run += 1;
            await writeFile(path.join(outputDirectory, "b.js"), `b${run}`);
            if (run === 2) {
                await writeFile(path.join(outputDirectory, "extra.js"), "extra");
            }
        },
        outputDirectory,
        pack: async (destination) => {
            const tarballPath = path.join(destination, "fixture-1.0.0.tgz");
            await writeFile(
                tarballPath,
                tarball([
                    { body: `b${run}`, name: "package/b.js", type: "0" },
                    ...(run === 1 ? [{ body: "gone", name: "package/gone.js", type: "0" }] : []),
                ]),
            );
            return tarballPath;
        },
    });
    context.after(differing.dispose);
    assert.equal(differing.report.identical, false);
    assert.deepEqual(differing.report.differingFiles, [
        "dist:b.js",
        "dist:extra.js",
        "tarball:package/b.js",
        "tarball:package/gone.js",
    ]);

    await assert.rejects(
        runReproducibleBuild({
            build: async () => {},
            outputDirectory,
            pack: async () => {
                throw new Error("pack failed");
            },
        }),
        /pack failed/u,
    );

    const evidence = (tarballSha256: string): BuildEvidence => ({
        distTreeDigest: "sha256:same",
        files: {},
        tarEntries: [],
        tarball: "fixture.tgz",
        tarballSha256,
    });
    const bytesOnly = compareBuilds(evidence("a"), evidence("b"));
    assert.equal(bytesOnly.identical, false);
    assert.deepEqual(bytesOnly.differingFiles, []);
    assert.equal(
        compareBuilds(evidence("a"), { ...evidence("a"), distTreeDigest: "sha256:other" })
            .identical,
        false,
    );
});

test("provenance statements are unsigned in-toto v1 with a SLSA v1 predicate", () => {
    const statement = createProvenanceStatement({
        byproducts: [{ name: "sbom.cdx.json", sha256: "b".repeat(64) }],
        commit: "c".repeat(40),
        configuration: configuration.provenance,
        lockfile: configuration.sbom.lockfile,
        lockfileDigest: { sha256: "d".repeat(64) },
        nodeVersion: "v24.12.0",
        packageName: "fixture",
        packageVersion: "1.0.0",
        pnpmVersion: "10.32.1",
        repositoryUri: "https://example.invalid/fixture.git",
        tarball: { name: "fixture-1.0.0.tgz", sha256: "a".repeat(64) },
        workingTreeClean: true,
    });
    assert.equal(statement._type, configuration.provenance.statementType);
    assert.equal(statement.predicateType, configuration.provenance.predicateType);
    assert.deepEqual(statement.subject, [
        { digest: { sha256: "a".repeat(64) }, name: "fixture-1.0.0.tgz" },
    ]);
    assert.equal(
        statement.predicate.buildDefinition.resolvedDependencies[0]?.uri,
        `git+https://example.invalid/fixture.git@${"c".repeat(40)}`,
    );
    assert.match(statement.predicate.runDetails.metadata.invocationId, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(isProvenanceStatement(statement), true);
    assert.equal(isProvenanceStatement(JSON.parse(JSON.stringify(statement))), true);

    for (const invalid of [
        null,
        [],
        replaced(statement, ["predicate"], "none"),
        replaced(statement, ["predicate", "buildDefinition"], null),
        replaced(statement, ["predicate", "runDetails"], []),
        replaced(statement, ["subject"], []),
        replaced(statement, ["subject", 0, "digest", "sha256"], "short"),
        replaced(
            statement,
            ["predicate", "buildDefinition", "externalParameters", "workingTreeClean"],
            "yes",
        ),
        replaced(statement, ["predicate", "buildDefinition", "externalParameters", "commit"], ""),
        replaced(statement, ["predicate", "runDetails", "byproducts"], [{ digest: null }]),
    ]) {
        assert.equal(isProvenanceStatement(invalid), false);
    }
});

test("release evidence binds the reproducible tarball, SBOM, and provenance", async (context) => {
    const root = await temporaryDirectory(context, "shepherd-release-evidence-");
    await mkdir(path.join(root, "config"));
    await mkdir(path.join(root, configuration.release.directory));
    await cp(
        path.join(repositoryRoot, "config/release-integrity.config.json"),
        path.join(root, "config/release-integrity.config.json"),
    );
    await writeFile(path.join(root, "pnpm-lock.yaml"), fixtureLockfile);
    await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
            license: "MIT",
            name: "fixture-root",
            repository: { type: "git", url: "git+https://example.invalid/fixture.git" },
            version: "1.0.0",
        }),
    );
    const releaseDirectory = path.join(root, configuration.release.directory);
    const tarballBytes = tarball([{ body: "a", name: "package/a.js", type: "0" }]);
    await writeFile(path.join(releaseDirectory, "fixture-root-1.0.0.tgz"), tarballBytes);
    const reportPath = path.join(releaseDirectory, configuration.release.reproducibleBuildReport);
    const build = {
        distTreeDigest: "sha256:tree",
        tarball: "fixture-root-1.0.0.tgz",
        tarballSha256: sha256(tarballBytes),
    };
    await writeFile(
        reportPath,
        JSON.stringify({ builds: [build, build], differingFiles: [], identical: true }),
    );
    const environment = {
        commit: "e".repeat(40),
        nodeVersion: "v24.12.0",
        pnpmVersion: "10.32.1",
        workingTreeClean: false,
    };
    const evidence = await writeReleaseEvidence(environment, root);
    const written = JSON.parse(
        await readFile(path.join(releaseDirectory, configuration.provenance.artifact), "utf8"),
    ) as ProvenanceStatement;
    assert.equal(isProvenanceStatement(written), true);
    assert.deepEqual(written, evidence.statement);
    assert.equal(written.subject[0]?.digest.sha256, sha256(tarballBytes));
    assert.equal(
        written.predicate.buildDefinition.externalParameters.lockfileDigest.sha256,
        sha256(fixtureLockfile),
    );
    const manifest = JSON.parse(await readFile(evidence.manifestPath, "utf8")) as {
        readonly artifacts: readonly { readonly name: string; readonly sha256: string }[];
        readonly signed: boolean;
    };
    assert.equal(manifest.signed, false);
    assert.equal(
        manifest.artifacts.find(({ name }) => name === configuration.sbom.releaseArtifact)?.sha256,
        sha256(await readFile(path.join(releaseDirectory, configuration.sbom.releaseArtifact))),
    );

    await writeFile(
        reportPath,
        JSON.stringify({
            builds: [build, { ...build, tarballSha256: "0".repeat(64) }],
            identical: true,
        }),
    );
    await assert.rejects(writeReleaseEvidence(environment, root), /digest does not match/u);
    await writeFile(reportPath, JSON.stringify({ builds: [], identical: true }));
    await assert.rejects(writeReleaseEvidence(environment, root), /identical reproducible-build/u);
    await writeFile(reportPath, JSON.stringify({ builds: [build], identical: false }));
    await assert.rejects(writeReleaseEvidence(environment, root), /identical reproducible-build/u);
});

type TarFixture = {
    readonly body: string;
    readonly emptyMode?: boolean;
    readonly name: string;
    readonly prefix?: string;
    readonly type: string;
};

function tarball(entries: readonly TarFixture[]): Buffer {
    const blocks: Buffer[] = [];
    for (const entry of entries) {
        const body = Buffer.from(entry.body, "utf8");
        const header = Buffer.alloc(512);
        header.write(entry.name, 0, 100, "utf8");
        if (entry.emptyMode !== true) {
            header.write("0000644\0", 100);
        }
        header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
        header.write("03561752204\0", 136);
        header.write(entry.type, 156);
        header.write("ustar\0", 257);
        if (entry.prefix !== undefined) {
            header.write(entry.prefix, 345, 155, "utf8");
        }
        blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

function replaced(
    value: unknown,
    keys: readonly (number | string)[],
    replacement: unknown,
): unknown {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    let target = copy as Record<number | string, unknown>;
    for (const key of keys.slice(0, -1)) {
        target = target[key] as Record<number | string, unknown>;
    }
    target[keys.at(-1) as number | string] = replacement;
    return copy;
}

async function temporaryDirectory(context: TestContext, prefix: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}
