import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** SBOM generation settings. */
export type SbomConfiguration = {
    /** Repository-relative checked-in SBOM path. */
    readonly artifact: string;
    /** CycloneDX `bomFormat` value. */
    readonly bomFormat: string;
    /** Property name marking development-only components. */
    readonly developmentProperty: string;
    /** Repository-relative pnpm lockfile. */
    readonly lockfile: string;
    /** Repository-relative package manifest. */
    readonly packageManifest: string;
    /** Prefix of repository-specific property names. */
    readonly propertyPrefix: string;
    /** File name of the SBOM copy in the release directory. */
    readonly releaseArtifact: string;
    /** CycloneDX specification version. */
    readonly specVersion: string;
    /** Name recorded for the generating tool. */
    readonly toolName: string;
};

/** Provenance statement settings. */
export type ProvenanceConfiguration = {
    /** File name of the statement in the release directory. */
    readonly artifact: string;
    /** SLSA build type URI. */
    readonly buildType: string;
    /** SLSA builder identifier URI. */
    readonly builderId: string;
    /** In-toto predicate type URI. */
    readonly predicateType: string;
    /** In-toto statement type URI. */
    readonly statementType: string;
};

/** Packed file-set check settings. */
export type PackedFilesConfiguration = {
    /** Archive-relative paths the packer adds whether or not `files` lists them. */
    readonly alwaysIncluded: readonly string[];
    /** Directory that holds every entry of a packed tarball. */
    readonly archiveRoot: string;
};

/** Validated `config/release-integrity.config.json`. */
export type ReleaseIntegrityConfiguration = {
    /** Packed file-set check settings. */
    readonly packedFiles: PackedFilesConfiguration;
    /** Provenance statement settings. */
    readonly provenance: ProvenanceConfiguration;
    /** Release output locations. */
    readonly release: {
        /** Repository-relative ignored release directory. */
        readonly directory: string;
        /** File name of the release manifest. */
        readonly manifest: string;
        /** File name of the reproducible-build report. */
        readonly reproducibleBuildReport: string;
    };
    /** Commands of the reproducible-build check. */
    readonly reproducibleBuild: {
        /** Command and arguments that produce a clean build. */
        readonly buildCommand: readonly string[];
        /** Command and arguments that pack into the directory appended as the last argument. */
        readonly packCommand: readonly string[];
    };
    /** SBOM generation settings. */
    readonly sbom: SbomConfiguration;
};

/** Default repository root of the release tooling. */
export const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Reads and validates the release-integrity configuration.
 *
 * @param repositoryRoot - Repository root containing `config/release-integrity.config.json`.
 * @returns The validated configuration.
 * @throws {TypeError} If a field is missing or mistyped.
 * @throws {Error} If the file cannot be read or parsed.
 */
export async function readReleaseIntegrityConfiguration(
    repositoryRoot: string = defaultRepositoryRoot,
): Promise<ReleaseIntegrityConfiguration> {
    return parseReleaseIntegrityConfiguration(
        JSON.parse(
            await readFile(
                path.join(repositoryRoot, "config/release-integrity.config.json"),
                "utf8",
            ),
        ) as unknown,
    );
}

/**
 * Validates a parsed release-integrity configuration.
 *
 * @param value - Parsed JSON configuration.
 * @returns The validated configuration.
 * @throws {TypeError} If a field is missing or mistyped.
 */
export function parseReleaseIntegrityConfiguration(value: unknown): ReleaseIntegrityConfiguration {
    const root = objectValue(value, "release integrity configuration");
    const packedFiles = objectValue(root.packedFiles, "packedFiles");
    const provenance = objectValue(root.provenance, "provenance");
    const release = objectValue(root.release, "release");
    const reproducibleBuild = objectValue(root.reproducibleBuild, "reproducibleBuild");
    const sbom = objectValue(root.sbom, "sbom");
    const text = (section: Readonly<Record<string, unknown>>, key: string, label: string) =>
        stringValue(section[key], `${label}.${key}`);
    return {
        packedFiles: {
            alwaysIncluded: stringArrayValue(
                packedFiles.alwaysIncluded,
                "packedFiles.alwaysIncluded",
            ),
            archiveRoot: text(packedFiles, "archiveRoot", "packedFiles"),
        },
        provenance: {
            artifact: text(provenance, "artifact", "provenance"),
            buildType: text(provenance, "buildType", "provenance"),
            builderId: text(provenance, "builderId", "provenance"),
            predicateType: text(provenance, "predicateType", "provenance"),
            statementType: text(provenance, "statementType", "provenance"),
        },
        release: {
            directory: text(release, "directory", "release"),
            manifest: text(release, "manifest", "release"),
            reproducibleBuildReport: text(release, "reproducibleBuildReport", "release"),
        },
        reproducibleBuild: {
            buildCommand: commandValue(reproducibleBuild.buildCommand, "buildCommand"),
            packCommand: commandValue(reproducibleBuild.packCommand, "packCommand"),
        },
        sbom: {
            artifact: text(sbom, "artifact", "sbom"),
            bomFormat: text(sbom, "bomFormat", "sbom"),
            developmentProperty: text(sbom, "developmentProperty", "sbom"),
            lockfile: text(sbom, "lockfile", "sbom"),
            packageManifest: text(sbom, "packageManifest", "sbom"),
            propertyPrefix: text(sbom, "propertyPrefix", "sbom"),
            releaseArtifact: text(sbom, "releaseArtifact", "sbom"),
            specVersion: text(sbom, "specVersion", "sbom"),
            toolName: text(sbom, "toolName", "sbom"),
        },
    };
}

function commandValue(value: unknown, label: string): readonly string[] {
    return stringArrayValue(value, `reproducibleBuild.${label}`);
}

function stringArrayValue(value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty array`);
    }
    return value.map((part, index) => stringValue(part, `${label}[${index}]`));
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}
