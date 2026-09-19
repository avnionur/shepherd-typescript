import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    defaultRepositoryRoot,
    type ProvenanceConfiguration,
    readReleaseIntegrityConfiguration,
} from "./integrity-config.ts";
import { sha256 } from "./reproducible-build.ts";
import { generateRepositorySbom } from "./sbom.ts";

/** In-toto resource descriptor limited to name, URI, and digests. */
export type ResourceDescriptor = {
    /** Digests keyed by algorithm (`sha256`, `gitCommit`). */
    readonly digest: Readonly<Record<string, string>>;
    /** Human-readable name. */
    readonly name?: string;
    /** Resource URI. */
    readonly uri?: string;
};

/** Build inputs recorded as SLSA external parameters. */
export type ProvenanceExternalParameters = {
    /** Source commit the release was built from. */
    readonly commit: string;
    /** SHA-256 of the lockfile. */
    readonly lockfileDigest: { readonly sha256: string };
    /** Node.js version that ran the build. */
    readonly nodeVersion: string;
    /** Package name. */
    readonly packageName: string;
    /** Package version. */
    readonly packageVersion: string;
    /** pnpm version that ran the build. */
    readonly pnpmVersion: string;
    /** Whether the working tree had no uncommitted changes. */
    readonly workingTreeClean: boolean;
};

/** Unsigned in-toto Statement v1 carrying a SLSA provenance v1 predicate. */
export type ProvenanceStatement = {
    /** Statement type URI. */
    readonly _type: string;
    /** SLSA provenance predicate. */
    readonly predicate: {
        /** Build definition. */
        readonly buildDefinition: {
            /** Build type URI. */
            readonly buildType: string;
            /** Recorded build inputs. */
            readonly externalParameters: ProvenanceExternalParameters;
            /** Builder-internal parameters (none for the local builder). */
            readonly internalParameters: Readonly<Record<string, never>>;
            /** Source commit and lockfile. */
            readonly resolvedDependencies: readonly ResourceDescriptor[];
        };
        /** Builder identity and outputs other than the subject. */
        readonly runDetails: {
            /** Builder identity. */
            readonly builder: { readonly id: string };
            /** SBOM and reproducible-build evidence. */
            readonly byproducts: readonly ResourceDescriptor[];
            /** Content-derived invocation identifier; no timestamps. */
            readonly metadata: { readonly invocationId: string };
        };
    };
    /** Predicate type URI. */
    readonly predicateType: string;
    /** Packed tarballs. */
    readonly subject: readonly ResourceDescriptor[];
};

/** Inputs of a provenance statement. */
export type ProvenanceInputs = ProvenanceExternalParameters & {
    /** Byproducts recorded with their SHA-256 digests. */
    readonly byproducts: readonly { readonly name: string; readonly sha256: string }[];
    /** Provenance settings. */
    readonly configuration: ProvenanceConfiguration;
    /** Repository-relative lockfile path. */
    readonly lockfile: string;
    /** Source repository URI without a `git+` prefix. */
    readonly repositoryUri: string;
    /** Packed tarball. */
    readonly tarball: { readonly name: string; readonly sha256: string };
};

/** Host facts collected by the release command for provenance. */
export type ReleaseEnvironment = {
    /** Source commit. */
    readonly commit: string;
    /** Node.js version. */
    readonly nodeVersion: string;
    /** pnpm version. */
    readonly pnpmVersion: string;
    /** Whether the working tree had no uncommitted changes. */
    readonly workingTreeClean: boolean;
};

/** Files written into the release directory. */
export type ReleaseEvidence = {
    /** Absolute release-manifest path. */
    readonly manifestPath: string;
    /** The written provenance statement. */
    readonly statement: ProvenanceStatement;
};

/**
 * Creates an unsigned in-toto Statement v1 with a SLSA provenance v1 predicate.
 *
 * @param inputs - Subject tarball, recorded parameters, byproducts, and settings.
 * @returns The statement; the invocation identifier is derived from its content.
 */
export function createProvenanceStatement(inputs: ProvenanceInputs): ProvenanceStatement {
    const externalParameters: ProvenanceExternalParameters = {
        commit: inputs.commit,
        lockfileDigest: { sha256: inputs.lockfileDigest.sha256 },
        nodeVersion: inputs.nodeVersion,
        packageName: inputs.packageName,
        packageVersion: inputs.packageVersion,
        pnpmVersion: inputs.pnpmVersion,
        workingTreeClean: inputs.workingTreeClean,
    };
    const subject = [{ digest: { sha256: inputs.tarball.sha256 }, name: inputs.tarball.name }];
    const byproducts = inputs.byproducts.map(({ name, sha256: digest }) => ({
        digest: { sha256: digest },
        name,
    }));
    return {
        _type: inputs.configuration.statementType,
        predicate: {
            buildDefinition: {
                buildType: inputs.configuration.buildType,
                externalParameters,
                internalParameters: {},
                resolvedDependencies: [
                    {
                        digest: { gitCommit: inputs.commit },
                        uri: `git+${inputs.repositoryUri}@${inputs.commit}`,
                    },
                    { digest: { sha256: inputs.lockfileDigest.sha256 }, name: inputs.lockfile },
                ],
            },
            runDetails: {
                builder: { id: inputs.configuration.builderId },
                byproducts,
                metadata: {
                    invocationId: `sha256:${sha256(JSON.stringify({ byproducts, externalParameters, subject }))}`,
                },
            },
        },
        predicateType: inputs.configuration.predicateType,
        subject,
    };
}

/**
 * Checks whether a value has the shape of an unsigned provenance statement from this tooling.
 *
 * @param value - Candidate value, for example a parsed statement file.
 * @returns Whether every required field is present with the documented type and every SHA-256
 * digest is 64 lower-case hexadecimal characters.
 */
export function isProvenanceStatement(value: unknown): value is ProvenanceStatement {
    if (!isRecord(value) || !isRecord(value.predicate)) {
        return false;
    }
    const { buildDefinition, runDetails } = value.predicate;
    if (!isRecord(buildDefinition) || !isRecord(runDetails)) {
        return false;
    }
    const parameters = buildDefinition.externalParameters;
    return (
        isText(value._type) &&
        isText(value.predicateType) &&
        Array.isArray(value.subject) &&
        value.subject.length > 0 &&
        value.subject.every(isSha256Descriptor) &&
        isText(buildDefinition.buildType) &&
        isRecord(buildDefinition.internalParameters) &&
        Array.isArray(buildDefinition.resolvedDependencies) &&
        buildDefinition.resolvedDependencies.every(
            (dependency) => isRecord(dependency) && isRecord(dependency.digest),
        ) &&
        isRecord(parameters) &&
        ["commit", "nodeVersion", "packageName", "packageVersion", "pnpmVersion"].every((key) =>
            isText(parameters[key]),
        ) &&
        typeof parameters.workingTreeClean === "boolean" &&
        isRecord(parameters.lockfileDigest) &&
        isSha256(parameters.lockfileDigest.sha256) &&
        isRecord(runDetails.builder) &&
        isText(runDetails.builder.id) &&
        Array.isArray(runDetails.byproducts) &&
        runDetails.byproducts.every(isSha256Descriptor) &&
        isRecord(runDetails.metadata) &&
        isText(runDetails.metadata.invocationId)
    );
}

/**
 * Writes the SBOM copy, provenance statement, and release manifest into the release directory.
 *
 * Reads the reproducible-build report written by `scripts/reproducible-build-cli.ts` to name and
 * verify the tarball subject; the tarball bytes must match the second build's digest.
 *
 * @param environment - Commit, tool versions, and working-tree state collected by the caller.
 * @param repositoryRoot - Repository root; defaults to this package root.
 * @returns The manifest path and the statement written.
 * @throws {Error} If the report is missing or not identical, or the tarball digest differs.
 * @throws {TypeError} If configuration or the package manifest is invalid.
 */
export async function writeReleaseEvidence(
    environment: ReleaseEnvironment,
    repositoryRoot: string = defaultRepositoryRoot,
): Promise<ReleaseEvidence> {
    const configuration = await readReleaseIntegrityConfiguration(repositoryRoot);
    const releaseDirectory = path.join(repositoryRoot, configuration.release.directory);
    const report = JSON.parse(
        await readFile(
            path.join(releaseDirectory, configuration.release.reproducibleBuildReport),
            "utf8",
        ),
    ) as {
        readonly builds: readonly { readonly tarball: string; readonly tarballSha256: string }[];
        readonly identical: boolean;
    };
    const build = report.builds.at(-1);
    if (!report.identical || build === undefined) {
        throw new Error("release evidence requires an identical reproducible-build report");
    }
    const tarballBytes = await readFile(path.join(releaseDirectory, build.tarball));
    if (sha256(tarballBytes) !== build.tarballSha256) {
        throw new Error(`release tarball digest does not match the report: ${build.tarball}`);
    }
    const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, configuration.sbom.packageManifest), "utf8"),
    ) as {
        readonly name: string;
        readonly repository: { readonly url: string };
        readonly version: string;
    };
    const sbomText = await generateRepositorySbom({ repositoryRoot });
    const lockfileText = await readFile(path.join(repositoryRoot, configuration.sbom.lockfile));
    const reportText = await readFile(
        path.join(releaseDirectory, configuration.release.reproducibleBuildReport),
    );
    const statement = createProvenanceStatement({
        ...environment,
        byproducts: [
            { name: configuration.sbom.releaseArtifact, sha256: sha256(sbomText) },
            { name: configuration.release.reproducibleBuildReport, sha256: sha256(reportText) },
        ],
        configuration: configuration.provenance,
        lockfile: configuration.sbom.lockfile,
        lockfileDigest: { sha256: sha256(lockfileText) },
        packageName: manifest.name,
        packageVersion: manifest.version,
        repositoryUri: manifest.repository.url.replace(/^git\+/u, ""),
        tarball: { name: build.tarball, sha256: build.tarballSha256 },
    });
    const statementText = `${JSON.stringify(statement, null, 4)}\n`;
    await mkdir(releaseDirectory, { recursive: true });
    await writeFile(path.join(releaseDirectory, configuration.sbom.releaseArtifact), sbomText);
    await writeFile(path.join(releaseDirectory, configuration.provenance.artifact), statementText);
    const manifestPath = path.join(releaseDirectory, configuration.release.manifest);
    await writeFile(
        manifestPath,
        `${JSON.stringify(
            {
                artifacts: [
                    { name: build.tarball, sha256: build.tarballSha256 },
                    { name: configuration.sbom.releaseArtifact, sha256: sha256(sbomText) },
                    { name: configuration.provenance.artifact, sha256: sha256(statementText) },
                    {
                        name: configuration.release.reproducibleBuildReport,
                        sha256: sha256(reportText),
                    },
                ],
                commit: environment.commit,
                package: manifest.name,
                signed: false,
                version: manifest.version,
            },
            null,
            4,
        )}\n`,
    );
    return { manifestPath, statement };
}

function isSha256Descriptor(value: unknown): boolean {
    return isRecord(value) && isRecord(value.digest) && isSha256(value.digest.sha256);
}

function isSha256(value: unknown): boolean {
    return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isText(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
