import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    type ApiSurface,
    type ApiSymbolFingerprint,
    type DeprecationConvention,
    extractApiSurface,
} from "./api-surface.ts";
import {
    type ConfigurationLocation,
    containedPath,
    digestOf,
    extractProtocolSurface,
    type ProtocolSurface,
    type ProtocolSurfaceConfiguration,
    type SchemaFingerprint,
} from "./protocol-surface.ts";

/** Change-handling rules of one stability tier. */
export type TierRules = {
    /** Whether changed or removed artifacts need a classified change or a deprecation window. */
    readonly requiresClassification: boolean;
    /** Whether additive changes need at least a MINOR version bump. */
    readonly requiresVersionBump: boolean;
};

/** A protocol artifact deprecation declared in configuration. */
export type ProtocolDeprecation = {
    /** Artifact identifier such as `cli-command:run list` or `error-code:TRACE_STORE_ERROR`. */
    readonly artifact: string;
    /** Release that deprecated the artifact. */
    readonly since: string;
};

/** A numeric schema-version marker that may increase only with appended migrations. */
export type MigrationBackedVersion = {
    /** Version-marker key (`source#pointer`). */
    readonly marker: string;
    /** Migration-list key (`source#pointer`) that must gain one entry per version increase. */
    readonly migrations: string;
};

/** Validated `config/compatibility-policy.config.json`. */
export type CompatibilityPolicy = {
    /** API-surface sources and per-entry stability tiers. */
    readonly api: {
        /** Repository-relative API-reference configuration. */
        readonly configuration: string;
        /** Repository-relative package manifest. */
        readonly packageManifest: string;
        /** Tier name keyed by package entry; must cover every entry exactly. */
        readonly tiers: Readonly<Record<string, string>>;
    };
    /** Repository-relative baseline and change-log paths. */
    readonly baselines: {
        /** API baseline. */
        readonly api: string;
        /** Append-only classified change log. */
        readonly changes: string;
        /** Protocol baseline. */
        readonly protocol: string;
    };
    /** Build freshness: the emitted declarations must be newer than every source file. */
    readonly build: {
        /** Repository-relative source directories compiled into the declarations. */
        readonly sources: readonly string[];
    };
    /** Classification rules for changed artifacts. */
    readonly classification: {
        /** Artifacts whose `additive` classification must carry a note (regular expressions). */
        readonly additiveNotePatterns: readonly string[];
        /**
         * Artifacts a baseline update may classify `additive` only when named individually
         * (regular expressions).
         */
        readonly perArtifactPatterns: readonly string[];
    };
    /** Deprecation convention and window. */
    readonly deprecation: DeprecationConvention & {
        /**
         * Last released version, measured by the deprecation window; not the last baseline
         * update.
         */
        readonly lastReleasedVersion: string;
        /** Minor releases a deprecated artifact must ship before removal. */
        readonly windowMinorReleases: number;
    };
    /** Artifacts that must never change once published. */
    readonly frozen: {
        /** Regular expressions matched against artifact identifiers. */
        readonly artifactPatterns: readonly string[];
        /**
         * Pattern with `family` and `version` groups; a schema file is frozen once a higher
         * version of the same family exists.
         */
        readonly supersededSchemaPattern: string;
    };
    /** Protocol surface locations, tier, and configured deprecations. */
    readonly protocol: ProtocolSurfaceConfiguration & {
        /** Configured protocol artifact deprecations. */
        readonly deprecations: readonly ProtocolDeprecation[];
        /** Schema-version markers that increase only together with appended migrations. */
        readonly migrationBackedVersions: readonly MigrationBackedVersion[];
        /** Tier applied to every protocol artifact. */
        readonly tier: string;
    };
    /** Tier rules keyed by tier name. */
    readonly tiers: Readonly<Record<string, TierRules>>;
};

/** One append-only classified change-log entry. */
export type ClassifiedChange = {
    /** Changed artifact identifier. */
    readonly artifact: string;
    /** Whether consumers must adapt (`breaking`) or not (`additive`). */
    readonly classification: "additive" | "breaking";
    /** Baseline value or digest. */
    readonly from: string;
    /** Optional reviewer note. */
    readonly note?: string;
    /** Current value or digest. */
    readonly to: string;
    /** Package version that ships the change. */
    readonly version: string;
};

/** Shared version header of both baselines. */
export type BaselineVersions = {
    /** Package version the baseline was recorded for. */
    readonly packageVersion: string;
    /** Last released version before `packageVersion`, or `null` for the first baseline. */
    readonly previousVersion: string | null;
};

/** Checked-in API baseline. */
export type ApiBaseline = BaselineVersions & {
    /** Symbol fingerprints keyed by entry and name. */
    readonly entries: ApiSurface["entries"];
};

/** Checked-in protocol baseline. */
export type ProtocolBaseline = BaselineVersions & {
    /** Length and digest of the change-log prefix that must never change. */
    readonly changeLog: {
        /** Canonical digest of the first `entries` log entries. */
        readonly digest: string;
        /** Number of entries covered. */
        readonly entries: number;
    };
    /** Protocol fingerprints. */
    readonly surface: ProtocolSurface;
};

/** Everything a compatibility evaluation compares. */
export type CompatibilityInputs = {
    /** API baseline. */
    readonly apiBaseline: ApiBaseline;
    /** Current change log. */
    readonly changes: readonly ClassifiedChange[];
    /** Current API surface. */
    readonly currentApi: ApiSurface;
    /** Current protocol surface. */
    readonly currentProtocol: ProtocolSurface;
    /** Validated policy. */
    readonly policy: CompatibilityPolicy;
    /** Protocol baseline. */
    readonly protocolBaseline: ProtocolBaseline;
};

/** Outcome of comparing the current surfaces with the baselines. */
export type CompatibilityReport = {
    /** Accepted differences that still require a baseline update. */
    readonly accepted: readonly string[];
    /** Change-log entries the evaluation would need, one per unclassified changed artifact. */
    readonly unclassified: readonly Omit<ClassifiedChange, "classification" | "version">[];
    /** Precise policy violations; any violation fails the gate. */
    readonly violations: readonly string[];
};

/** Repository and policy paths for the compatibility gate. */
export type CompatibilityOptions = {
    /** Optional policy path; defaults to `config/compatibility-policy.config.json`. */
    readonly policyPath?: string;
    /** Optional repository root; defaults to this package root. */
    readonly repositoryRoot?: string;
};

/** Options for recording a new baseline. */
export type CompatibilityUpdateOptions = CompatibilityOptions & {
    /**
     * Limits `classify` to these unclassified changed artifacts. Without it, `classify` covers
     * every unclassified change, except that `additive` is refused while any of them matches a
     * configured per-artifact pattern (changed API declarations and version-marker increases).
     */
    readonly artifacts?: readonly string[];
    /**
     * Classifies unclassified changed artifacts with this classification at the current package
     * version before recording, appending the entries to the change log.
     */
    readonly classify?: "additive" | "breaking";
    /** Optional note stored on appended entries. */
    readonly note?: string;
};

type Diff = {
    readonly artifact: string;
    readonly description: string;
    readonly from?: string;
    readonly rule: "additive" | "classify" | "forbidden" | "record" | "remove";
    readonly deprecatedSince?: string | null | undefined;
    readonly tier: TierRules;
    readonly to?: string;
};

type Version = { readonly major: number; readonly minor: number; readonly patch: number };

type LoadedState = {
    readonly apiBaseline: ApiBaseline | undefined;
    readonly changes: readonly ClassifiedChange[];
    readonly currentApi: ApiSurface;
    readonly currentProtocol: ProtocolSurface;
    readonly paths: { readonly api: string; readonly changes: string; readonly protocol: string };
    readonly policy: CompatibilityPolicy;
    readonly protocolBaseline: ProtocolBaseline | undefined;
    readonly repositoryRoot: string;
};

const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const strictTier: TierRules = { requiresClassification: true, requiresVersionBump: true };

/**
 * Checks the current API and protocol surfaces against the checked-in baselines.
 *
 * @param options - Optional repository root and policy path.
 * @returns The evaluation report when the baselines are current and no rule is violated.
 * @throws {TypeError} If the policy, baselines, or change log are malformed.
 * @throws {Error} When a configured source file is newer than the oldest emitted declaration
 * file (run the build first), with every violation when a rule is broken, or with the accepted
 * differences when the baselines are stale.
 */
export async function checkCompatibility(
    options: CompatibilityOptions = {},
): Promise<CompatibilityReport> {
    const state = await loadState(options);
    await assertDeclarationsCurrent(state.repositoryRoot, state.policy);
    if (state.apiBaseline === undefined || state.protocolBaseline === undefined) {
        throw new Error(
            "compatibility baselines are missing: run `pnpm update:compatibility-baseline`",
        );
    }
    const report = evaluateCompatibility({
        apiBaseline: state.apiBaseline,
        changes: state.changes,
        currentApi: state.currentApi,
        currentProtocol: state.currentProtocol,
        policy: state.policy,
        protocolBaseline: state.protocolBaseline,
    });
    assertNoViolations(report);
    const version = state.currentApi.packageVersion;
    if (
        report.accepted.length > 0 ||
        state.apiBaseline.packageVersion !== version ||
        state.protocolBaseline.packageVersion !== version ||
        state.protocolBaseline.changeLog.entries !== state.changes.length
    ) {
        throw new Error(
            [
                `compatibility baselines are stale (recorded for ${state.protocolBaseline.packageVersion}, package is ${version}); run \`pnpm update:compatibility-baseline\`:`,
                ...report.accepted.map((line) => `- ${line}`),
            ].join("\n"),
        );
    }
    return report;
}

/**
 * Records the current surfaces as the new baselines after enforcing every rule.
 *
 * @param options - Repository root, policy path, and optional classification of unclassified
 * changes.
 * @returns The evaluation report the recorded baselines satisfy.
 * @throws {TypeError} If the policy, baselines, or change log are malformed, or `artifacts` names
 * an artifact that is not an unclassified change.
 * @throws {Error} With every violation, or when bulk `additive` classification would cover an
 * artifact that must be classified individually; nothing is written in either case.
 */
export async function updateCompatibilityBaseline(
    options: CompatibilityUpdateOptions = {},
): Promise<CompatibilityReport> {
    const state = await loadState(options);
    const version = state.currentApi.packageVersion;
    let changes = state.changes;
    let report: CompatibilityReport = { accepted: [], unclassified: [], violations: [] };
    if (state.apiBaseline !== undefined && state.protocolBaseline !== undefined) {
        const inputs = {
            apiBaseline: state.apiBaseline,
            currentApi: state.currentApi,
            currentProtocol: state.currentProtocol,
            policy: state.policy,
            protocolBaseline: state.protocolBaseline,
        };
        report = evaluateCompatibility({ ...inputs, changes });
        const selected = selectClassified(report, options, state.policy);
        if (selected.length > 0) {
            changes = [
                ...changes,
                ...selected.map((change) => ({
                    ...change,
                    classification: options.classify as "additive" | "breaking",
                    ...(options.note === undefined ? {} : { note: options.note }),
                    version,
                })),
            ];
            report = evaluateCompatibility({ ...inputs, changes });
        }
    }
    assertNoViolations(report);

    const previous = state.protocolBaseline ?? state.apiBaseline;
    const previousVersion =
        previous === undefined
            ? null
            : previous.packageVersion === version
              ? previous.previousVersion
              : previous.packageVersion;
    const apiBaseline: ApiBaseline = {
        entries: state.currentApi.entries,
        packageVersion: version,
        previousVersion,
    };
    const protocolBaseline: ProtocolBaseline = {
        changeLog: { digest: digestOf(changes), entries: changes.length },
        packageVersion: version,
        previousVersion,
        surface: state.currentProtocol,
    };
    if (changes !== state.changes) {
        await writeJson(state.paths.changes, changes);
    }
    await writeJson(state.paths.api, apiBaseline);
    await writeJson(state.paths.protocol, protocolBaseline);
    return report;
}

function selectClassified(
    report: CompatibilityReport,
    options: CompatibilityUpdateOptions,
    policy: CompatibilityPolicy,
): CompatibilityReport["unclassified"] {
    const artifacts = options.artifacts;
    if (options.classify === undefined) {
        if (artifacts !== undefined) {
            throw new TypeError("naming artifacts requires a classification");
        }
        return [];
    }
    if (artifacts !== undefined) {
        const missing = artifacts.filter(
            (artifact) => !report.unclassified.some((change) => change.artifact === artifact),
        );
        if (missing.length > 0) {
            throw new TypeError(`not an unclassified changed artifact: ${missing.join(", ")}`);
        }
        return report.unclassified.filter(({ artifact }) => artifacts.includes(artifact));
    }
    if (options.classify === "additive") {
        const patterns = policy.classification.perArtifactPatterns.map(
            (pattern) => new RegExp(pattern, "u"),
        );
        const individual = report.unclassified
            .map(({ artifact }) => artifact)
            .filter((artifact) => patterns.some((pattern) => pattern.test(artifact)));
        if (individual.length > 0) {
            throw new Error(
                `bulk additive classification is refused for changed API declarations and version markers; judge each and name it with --artifact: ${individual.join(", ")}`,
            );
        }
    }
    return report.unclassified;
}

/**
 * Compares current surfaces with baselines under the configured policy.
 *
 * Additions are additive. Removals of stable artifacts need a deprecation that shipped for the
 * configured window, measured to the configured last released version, and a MAJOR bump. Changed
 * digests or values, including any increase of a format or protocol version marker, need a
 * classified change-log entry whose version bump matches; `additive` entries for artifacts matching
 * a configured note pattern must carry a note. A schema may add `oneOf` branches and `$defs`
 * members while every baseline branch and member stays byte-equal after canonicalization,
 * migration lists may be appended, and a migration-backed schema version may increase by exactly
 * the number of appended migrations. Frozen artifacts, decreasing markers, schema versions without
 * matching migrations, and rewritten migrations always fail. Surfaces a baseline predates are
 * recorded without judgment.
 *
 * @param inputs - Policy, baselines, change log, and current surfaces.
 * @returns Accepted differences, unclassified changes, and violations.
 * @throws {TypeError} If a version is not `MAJOR.MINOR.PATCH` or a configured pattern is invalid.
 */
export function evaluateCompatibility(inputs: CompatibilityInputs): CompatibilityReport {
    const { apiBaseline, changes, currentApi, policy, protocolBaseline } = inputs;
    const violations: string[] = [];
    if (
        apiBaseline.packageVersion !== protocolBaseline.packageVersion ||
        apiBaseline.previousVersion !== protocolBaseline.previousVersion
    ) {
        violations.push("API and protocol baselines record different package versions");
    }
    const current = parseVersion(currentApi.packageVersion, "package version");
    const recorded = parseVersion(protocolBaseline.packageVersion, "baseline package version");
    const referenceText =
        protocolBaseline.packageVersion === currentApi.packageVersion
            ? (protocolBaseline.previousVersion ?? protocolBaseline.packageVersion)
            : protocolBaseline.packageVersion;
    const reference = parseVersion(referenceText, "baseline previous version");
    const lastReleasedText = policy.deprecation.lastReleasedVersion;
    const lastReleased = parseVersion(lastReleasedText, "deprecation lastReleasedVersion");
    const notePatterns = policy.classification.additiveNotePatterns.map(
        (pattern) => new RegExp(pattern, "u"),
    );
    if (compareVersions(current, recorded) < 0) {
        violations.push(
            `package version ${currentApi.packageVersion} is lower than the baseline version ${protocolBaseline.packageVersion}`,
        );
    }

    const recordedLog = changes.slice(0, protocolBaseline.changeLog.entries);
    if (
        changes.length < protocolBaseline.changeLog.entries ||
        digestOf(recordedLog) !== protocolBaseline.changeLog.digest
    ) {
        violations.push(
            `${policy.baselines.changes} is append-only: its first ${protocolBaseline.changeLog.entries} entries were changed or removed`,
        );
    }
    const pendingChanges = changes.slice(protocolBaseline.changeLog.entries);

    const diffs = [
        ...diffApi(apiBaseline, currentApi, policy),
        ...diffProtocol(protocolBaseline.surface, inputs.currentProtocol, policy),
    ];
    for (const [entry, symbols] of Object.entries(currentApi.entries)) {
        for (const [name, symbol] of Object.entries(symbols)) {
            if (symbol.deprecatedSince === null) {
                violations.push(
                    `api:${entry}#${name}: @${policy.deprecation.tag} must state the release it was deprecated in (pattern ${policy.deprecation.sincePattern})`,
                );
            }
        }
    }

    const accepted: string[] = [];
    const unclassified: Omit<ClassifiedChange, "classification" | "version">[] = [];
    const window = policy.deprecation.windowMinorReleases;
    const versions = `baseline ${referenceText}, package ${currentApi.packageVersion}`;
    for (const diff of diffs) {
        const label = `${diff.artifact}: ${diff.description}`;
        if (diff.rule === "forbidden") {
            violations.push(label);
            continue;
        }
        if (diff.rule === "record") {
            accepted.push(label);
            continue;
        }
        if (diff.rule === "additive") {
            if (diff.tier.requiresVersionBump && !isMinorBump(current, reference)) {
                violations.push(`${label} requires at least a MINOR version bump (${versions})`);
            } else {
                accepted.push(label);
            }
            continue;
        }
        if (!diff.tier.requiresClassification) {
            accepted.push(`${label} (not enforced for this tier)`);
            continue;
        }
        if (diff.rule === "remove") {
            const reasons: string[] = [];
            if (diff.deprecatedSince === undefined) {
                reasons.push("it was never deprecated");
            } else if (diff.deprecatedSince === null) {
                reasons.push("its deprecation names no release");
            } else if (
                !windowSatisfied(
                    parseVersion(diff.deprecatedSince, `${diff.artifact} deprecation`),
                    lastReleased,
                    window,
                )
            ) {
                reasons.push(
                    `it was deprecated in ${diff.deprecatedSince} and the window of ${window} minor releases has not elapsed by the last released version ${lastReleasedText}`,
                );
            }
            if (current.major <= reference.major) {
                reasons.push("removal requires a MAJOR version bump");
            }
            if (reasons.length > 0) {
                violations.push(`${label}, but ${reasons.join(" and ")} (${versions})`);
            } else {
                accepted.push(label);
            }
            continue;
        }
        const entry = pendingChanges.find(
            (change) =>
                change.artifact === diff.artifact &&
                change.from === diff.from &&
                change.to === diff.to,
        );
        if (entry === undefined) {
            unclassified.push({
                artifact: diff.artifact,
                from: diff.from as string,
                to: diff.to as string,
            });
            violations.push(
                `${label} without a classified entry in ${policy.baselines.changes} (from ${diff.from} to ${diff.to})`,
            );
        } else if (entry.version !== currentApi.packageVersion) {
            violations.push(
                `${label}: its classified entry names version ${entry.version}, but the package is ${currentApi.packageVersion}`,
            );
        } else if (entry.classification === "breaking" && current.major <= reference.major) {
            violations.push(
                `${label} is classified breaking and requires a MAJOR version bump (${versions})`,
            );
        } else if (entry.classification === "additive" && !isMinorBump(current, reference)) {
            violations.push(
                `${label} is classified additive and requires at least a MINOR version bump (${versions})`,
            );
        } else if (
            entry.classification === "additive" &&
            entry.note === undefined &&
            notePatterns.some((pattern) => pattern.test(diff.artifact))
        ) {
            violations.push(
                `${label} is classified additive without a note naming the reader that still accepts the previous value`,
            );
        } else {
            accepted.push(`${label} (classified ${entry.classification})`);
        }
    }
    return { accepted, unclassified, violations };
}

/**
 * Parses and validates the compatibility policy configuration.
 *
 * @param value - Parsed JSON configuration.
 * @returns The validated policy.
 * @throws {TypeError} If any field is missing, mistyped, or refers to an undefined tier.
 */
export function parseCompatibilityPolicy(value: unknown): CompatibilityPolicy {
    const root = objectValue(value, "compatibility policy");
    const baselines = objectValue(root.baselines, "compatibility baselines");
    const api = objectValue(root.api, "compatibility api");
    const build = objectValue(root.build, "compatibility build");
    const classification = objectValue(root.classification, "compatibility classification");
    const deprecation = objectValue(root.deprecation, "compatibility deprecation");
    const frozen = objectValue(root.frozen, "compatibility frozen");
    const protocol = objectValue(root.protocol, "compatibility protocol");
    const tiersValue = objectValue(root.tiers, "compatibility tiers");
    const tiers: Record<string, TierRules> = {};
    for (const [name, rulesValue] of Object.entries(tiersValue)) {
        const rules = objectValue(rulesValue, `tier ${name}`);
        tiers[name] = {
            requiresClassification: booleanValue(
                rules.requiresClassification,
                `tier ${name} requiresClassification`,
            ),
            requiresVersionBump: booleanValue(
                rules.requiresVersionBump,
                `tier ${name} requiresVersionBump`,
            ),
        };
    }
    const tierName = (candidate: unknown, label: string): string => {
        const name = stringValue(candidate, label);
        if (!Object.hasOwn(tiers, name)) {
            throw new TypeError(`${label} names an undefined tier: ${name}`);
        }
        return name;
    };
    const entryTiers: Record<string, string> = {};
    for (const [entry, tier] of Object.entries(objectValue(api.tiers, "compatibility api tiers"))) {
        entryTiers[entry] = tierName(tier, `api tier for ${entry}`);
    }
    const window = deprecation.windowMinorReleases;
    if (typeof window !== "number" || !Number.isSafeInteger(window) || window < 0) {
        throw new TypeError("deprecation windowMinorReleases must be a non-negative integer");
    }
    const sincePattern = validPattern(deprecation.sincePattern, "deprecation sincePattern");
    if (!sincePattern.includes("(?<version>")) {
        throw new TypeError("deprecation sincePattern must define a named version group");
    }
    const lastReleasedVersion = stringValue(
        deprecation.lastReleasedVersion,
        "deprecation lastReleasedVersion",
    );
    parseVersion(lastReleasedVersion, "deprecation lastReleasedVersion");
    const cli = objectValue(protocol.cli, "protocol cli");
    const identity = objectValue(protocol.identity, "protocol identity");
    const schemas = objectValue(protocol.schemas, "protocol schemas");
    const versions = objectValue(protocol.versions, "protocol versions");
    const artifactPatterns = arrayValue(frozen.artifactPatterns, "frozen artifactPatterns").map(
        (pattern, index) => validPattern(pattern, `frozen artifact pattern ${index}`),
    );
    const patterns = (list: unknown, label: string): readonly string[] =>
        arrayValue(list, label).map((pattern, index) => validPattern(pattern, `${label} ${index}`));
    return {
        api: {
            configuration: stringValue(api.configuration, "api configuration"),
            packageManifest: stringValue(api.packageManifest, "api packageManifest"),
            tiers: entryTiers,
        },
        baselines: {
            api: stringValue(baselines.api, "api baseline"),
            changes: stringValue(baselines.changes, "change log"),
            protocol: stringValue(baselines.protocol, "protocol baseline"),
        },
        build: {
            sources: arrayValue(build.sources, "build sources").map((source, index) =>
                stringValue(source, `build source ${index}`),
            ),
        },
        classification: {
            additiveNotePatterns: patterns(
                classification.additiveNotePatterns,
                "classification additiveNotePatterns",
            ),
            perArtifactPatterns: patterns(
                classification.perArtifactPatterns,
                "classification perArtifactPatterns",
            ),
        },
        deprecation: {
            lastReleasedVersion,
            sincePattern,
            tag: stringValue(deprecation.tag, "deprecation tag"),
            windowMinorReleases: window,
        },
        frozen: {
            artifactPatterns,
            supersededSchemaPattern: validPattern(
                frozen.supersededSchemaPattern,
                "frozen supersededSchemaPattern",
            ),
        },
        protocol: {
            cli: {
                commandOptionsPointer: stringValue(
                    cli.commandOptionsPointer,
                    "cli commandOptionsPointer",
                ),
                exitCodesPointer: stringValue(cli.exitCodesPointer, "cli exitCodesPointer"),
                groupsPointer: stringValue(cli.groupsPointer, "cli groupsPointer"),
                optionsPointer: stringValue(cli.optionsPointer, "cli optionsPointer"),
                source: stringValue(cli.source, "cli source"),
            },
            deprecations: arrayValue(protocol.deprecations, "protocol deprecations").map(
                (deprecationValue, index) => {
                    const item = objectValue(deprecationValue, `protocol deprecation ${index}`);
                    const since = stringValue(item.since, `protocol deprecation ${index} since`);
                    parseVersion(since, `protocol deprecation ${index} since`);
                    return {
                        artifact: stringValue(item.artifact, `protocol deprecation ${index}`),
                        since,
                    };
                },
            ),
            identity: {
                keyPattern: validPattern(identity.keyPattern, "identity keyPattern"),
                pointers: arrayValue(identity.pointers, "identity pointers").map(
                    (location, index) => locationValue(location, `identity pointer ${index}`),
                ),
                sources: arrayValue(identity.sources, "identity sources").map((source, index) =>
                    stringValue(source, `identity source ${index}`),
                ),
            },
            migrationBackedVersions: arrayValue(
                protocol.migrationBackedVersions,
                "protocol migrationBackedVersions",
            ).map((entryValue, index) => {
                const entry = objectValue(entryValue, `migration-backed version ${index}`);
                return {
                    marker: stringValue(entry.marker, `migration-backed version ${index} marker`),
                    migrations: stringValue(
                        entry.migrations,
                        `migration-backed version ${index} migrations`,
                    ),
                };
            }),
            migrations: arrayValue(protocol.migrations, "protocol migrations").map(
                (location, index) => locationValue(location, `protocol migration ${index}`),
            ),
            publicErrors: locationValue(protocol.publicErrors, "protocol publicErrors"),
            schemas: {
                directory: stringValue(schemas.directory, "schemas directory"),
                suffix: stringValue(schemas.suffix, "schemas suffix"),
            },
            tier: tierName(protocol.tier, "protocol tier"),
            versions: {
                keyPattern: validPattern(versions.keyPattern, "versions keyPattern"),
                sources: arrayValue(versions.sources, "versions sources").map((source, index) =>
                    stringValue(source, `versions source ${index}`),
                ),
            },
        },
        tiers,
    };
}

/**
 * Parses and validates the append-only classified change log.
 *
 * @param value - Parsed JSON change log.
 * @returns The validated entries in order.
 * @throws {TypeError} If the log is not an array of well-formed entries.
 */
export function parseClassifiedChanges(value: unknown): readonly ClassifiedChange[] {
    return arrayValue(value, "classified change log").map((entryValue, index) => {
        const entry = objectValue(entryValue, `classified change ${index}`);
        const classification = entry.classification;
        if (classification !== "additive" && classification !== "breaking") {
            throw new TypeError(
                `classified change ${index} classification must be additive or breaking`,
            );
        }
        const version = stringValue(entry.version, `classified change ${index} version`);
        parseVersion(version, `classified change ${index} version`);
        const parsed = {
            artifact: stringValue(entry.artifact, `classified change ${index} artifact`),
            classification,
            from: stringValue(entry.from, `classified change ${index} from`),
            to: stringValue(entry.to, `classified change ${index} to`),
            version,
        } as const;
        return entry.note === undefined
            ? parsed
            : { ...parsed, note: stringValue(entry.note, `classified change ${index} note`) };
    });
}

function diffApi(
    baseline: ApiBaseline,
    current: ApiSurface,
    policy: CompatibilityPolicy,
): readonly Diff[] {
    const diffs: Diff[] = [];
    const tierOf = (entry: string): TierRules => {
        const tierName = policy.api.tiers[entry];
        if (tierName === undefined) {
            throw new TypeError(`package entry ${entry} has no configured stability tier`);
        }
        return policy.tiers[tierName] as TierRules;
    };
    for (const entry of Object.keys(current.entries)) {
        tierOf(entry);
    }
    for (const [entry, symbols] of Object.entries(baseline.entries)) {
        // An entry dropped from both the export map and the tier map is judged by the strictest rules.
        const tier =
            policy.api.tiers[entry] === undefined && current.entries[entry] === undefined
                ? strictTier
                : tierOf(entry);
        const currentSymbols = current.entries[entry];
        if (currentSymbols === undefined) {
            diffs.push({
                artifact: `api:${entry}`,
                description: "removed package entry",
                rule: "remove",
                tier,
            });
            continue;
        }
        for (const [name, symbol] of Object.entries(symbols)) {
            const artifact = `api:${entry}#${name}`;
            const now = currentSymbols[name];
            if (now === undefined) {
                diffs.push({
                    artifact,
                    deprecatedSince: symbol.deprecatedSince,
                    description: `removed ${symbol.kind} export`,
                    rule: "remove",
                    tier,
                });
            } else {
                diffs.push(...diffSymbol(artifact, symbol, now, tier));
            }
        }
        for (const name of Object.keys(currentSymbols)) {
            if (symbols[name] === undefined) {
                diffs.push({
                    artifact: `api:${entry}#${name}`,
                    description: "added export",
                    rule: "additive",
                    tier,
                });
            }
        }
    }
    for (const entry of Object.keys(current.entries)) {
        if (baseline.entries[entry] === undefined) {
            diffs.push({
                artifact: `api:${entry}`,
                description: "added package entry",
                rule: "additive",
                tier: tierOf(entry),
            });
        }
    }
    return diffs;
}

function diffSymbol(
    artifact: string,
    baseline: ApiSymbolFingerprint,
    current: ApiSymbolFingerprint,
    tier: TierRules,
): readonly Diff[] {
    const diffs: Diff[] = [];
    if (baseline.digest !== current.digest) {
        diffs.push({
            artifact,
            description: `changed ${current.kind} declaration`,
            from: baseline.digest,
            rule: "classify",
            tier,
            to: current.digest,
        });
    }
    if (baseline.deprecatedSince !== current.deprecatedSince) {
        diffs.push({
            artifact,
            description:
                current.deprecatedSince === undefined
                    ? "deprecation withdrawn"
                    : `deprecated since ${current.deprecatedSince}`,
            rule: "additive",
            tier,
        });
    }
    return diffs;
}

function diffProtocol(
    baseline: ProtocolSurface,
    current: ProtocolSurface,
    policy: CompatibilityPolicy,
): readonly Diff[] {
    const tier = policy.tiers[policy.protocol.tier] as TierRules;
    const frozenPatterns = policy.frozen.artifactPatterns.map(
        (pattern) => new RegExp(pattern, "u"),
    );
    const supersededPattern = new RegExp(policy.frozen.supersededSchemaPattern, "u");
    const latestVersions = new Map<string, number>();
    for (const file of Object.keys(current.schemas)) {
        const groups = supersededPattern.exec(file)?.groups;
        if (groups?.family !== undefined && groups.version !== undefined) {
            latestVersions.set(
                groups.family,
                Math.max(latestVersions.get(groups.family) ?? 0, Number(groups.version)),
            );
        }
    }
    const isFrozen = (artifact: string, file?: string): boolean => {
        if (frozenPatterns.some((pattern) => pattern.test(artifact))) {
            return true;
        }
        const groups = file === undefined ? undefined : supersededPattern.exec(file)?.groups;
        return (
            groups?.family !== undefined &&
            groups.version !== undefined &&
            Number(groups.version) < (latestVersions.get(groups.family) as number)
        );
    };
    const deprecationOf = (artifact: string): string | undefined =>
        policy.protocol.deprecations.find((deprecation) => deprecation.artifact === artifact)
            ?.since;
    const diffs: Diff[] = [];
    const removed = (artifact: string, description: string): void => {
        diffs.push({
            artifact,
            deprecatedSince: deprecationOf(artifact),
            description,
            rule: "remove",
            tier,
        });
    };
    const added = (artifact: string, description: string): void => {
        diffs.push({ artifact, description, rule: "additive", tier });
    };
    const changed = (artifact: string, from: string, to: string, description: string): void => {
        diffs.push(
            isFrozen(artifact)
                ? {
                      artifact,
                      description: `${description}, but the artifact is frozen`,
                      rule: "forbidden",
                      tier,
                  }
                : { artifact, description, from, rule: "classify", tier, to },
        );
    };

    for (const [file, schema] of Object.entries(baseline.schemas)) {
        const artifact = `schema:${file}`;
        const now = current.schemas[file];
        if (now === undefined) {
            removed(artifact, "removed schema");
        } else if (now.digest !== schema.digest) {
            if (isFrozen(artifact, file)) {
                diffs.push({
                    artifact,
                    description:
                        "changed a frozen schema; publish a new versioned schema file instead",
                    rule: "forbidden",
                    tier,
                });
            } else if (isAdditiveSchema(schema, now)) {
                added(artifact, "added oneOf branches or $defs members");
            } else {
                changed(artifact, schema.digest, now.digest, "changed or narrowed schema");
            }
        }
    }
    for (const file of Object.keys(current.schemas)) {
        if (baseline.schemas[file] === undefined) {
            added(`schema:${file}`, "added schema");
        }
    }

    for (const [key, value] of Object.entries(baseline.versions)) {
        const artifact = `version:${key}`;
        const now = current.versions[key];
        if (now === undefined) {
            removed(artifact, "removed version marker");
        } else if (now !== value) {
            if (typeof value === "number" && typeof now === "number") {
                if (now < value) {
                    diffs.push({
                        artifact,
                        description: `decreased ${value} to ${now}; version markers never decrease`,
                        rule: "forbidden",
                        tier,
                    });
                } else if (isFrozen(artifact)) {
                    diffs.push({
                        artifact,
                        description: `increased ${value} to ${now}, but the artifact is frozen`,
                        rule: "forbidden",
                        tier,
                    });
                } else {
                    diffs.push(
                        versionIncrease(
                            { artifact, from: value, key, to: now },
                            { after: current, before: baseline },
                            policy,
                            tier,
                        ),
                    );
                }
            } else {
                changed(artifact, String(value), String(now), `changed ${value} to ${now}`);
            }
        }
    }
    for (const key of Object.keys(current.versions)) {
        if (baseline.versions[key] === undefined) {
            added(`version:${key}`, "added version marker");
        }
    }

    for (const [key, digests] of Object.entries(baseline.migrations)) {
        const artifact = `migrations:${key}`;
        const now = current.migrations[key];
        if (now === undefined) {
            diffs.push({
                artifact,
                description: "removed migration list; migrations may only be appended",
                rule: "forbidden",
                tier,
            });
            continue;
        }
        const firstMismatch = digests.findIndex((digest, index) => now[index] !== digest);
        if (firstMismatch >= 0) {
            diffs.push({
                artifact,
                description: `migration ${firstMismatch + 1} of ${digests.length} was removed, reordered, or changed; migrations may only be appended`,
                rule: "forbidden",
                tier,
            });
        } else if (now.length > digests.length) {
            added(artifact, `appended ${now.length - digests.length} migration(s)`);
        }
    }
    for (const key of Object.keys(current.migrations)) {
        if (baseline.migrations[key] === undefined) {
            added(`migrations:${key}`, "added migration list");
        }
    }

    const baselineCodes = new Set(baseline.errorCodes);
    const currentCodes = new Set(current.errorCodes);
    for (const code of baseline.errorCodes) {
        if (!currentCodes.has(code)) {
            removed(`error-code:${code}`, "removed public error code");
        }
    }
    for (const code of current.errorCodes) {
        if (!baselineCodes.has(code)) {
            added(`error-code:${code}`, "added public error code");
        }
    }

    for (const [name, code] of Object.entries(baseline.exitCodes)) {
        const artifact = `cli-exit-code:${name}`;
        const now = current.exitCodes[name];
        if (now === undefined) {
            removed(artifact, "removed CLI exit code");
        } else if (now !== code) {
            changed(artifact, String(code), String(now), `changed exit code ${code} to ${now}`);
        }
    }
    for (const name of Object.keys(current.exitCodes)) {
        if (baseline.exitCodes[name] === undefined) {
            added(`cli-exit-code:${name}`, "added CLI exit code");
        }
    }

    const baselineCommands = new Set(baseline.commands);
    const currentCommands = new Set(current.commands);
    for (const command of baseline.commands) {
        if (!currentCommands.has(command)) {
            removed(`cli-command:${command}`, "removed CLI command");
        }
    }
    for (const command of current.commands) {
        if (!baselineCommands.has(command)) {
            added(`cli-command:${command}`, "added CLI command");
        }
    }

    if (baseline.commandOptions === undefined) {
        diffs.push({
            artifact: "cli-option",
            description: "per-command CLI options fingerprinted for the first time",
            rule: "record",
            tier,
        });
    } else {
        const currentOptions = current.commandOptions ?? {};
        for (const [command, options] of Object.entries(baseline.commandOptions)) {
            // A removed command is judged once, as a command.
            const now = currentOptions[command];
            if (now === undefined) continue;
            for (const [name, kind] of Object.entries(options)) {
                const artifact = `cli-option:${command} ${name}`;
                const nowKind = now[name];
                if (nowKind === undefined) {
                    removed(artifact, "removed CLI option");
                } else if (nowKind !== kind) {
                    changed(artifact, kind, nowKind, `changed ${kind} option to ${nowKind}`);
                }
            }
            for (const name of Object.keys(now)) {
                if (options[name] === undefined) {
                    added(`cli-option:${command} ${name}`, "added CLI option");
                }
            }
        }
    }

    if (baseline.identity === undefined) {
        diffs.push({
            artifact: "identity",
            description: "identity settings fingerprinted for the first time",
            rule: "record",
            tier,
        });
    } else {
        const currentIdentity = current.identity ?? {};
        for (const [key, value] of Object.entries(baseline.identity)) {
            const artifact = `identity:${key}`;
            const now = currentIdentity[key];
            if (now === undefined) {
                removed(artifact, "removed identity setting");
            } else if (now !== value) {
                changed(artifact, value, now, `changed ${value} to ${now}`);
            }
        }
        for (const key of Object.keys(currentIdentity)) {
            if (baseline.identity[key] === undefined) {
                added(`identity:${key}`, "added identity setting");
            }
        }
    }
    return diffs;
}

/**
 * Judges a numeric version-marker increase: migration-backed schema versions are additive only
 * with exactly one appended migration per version; every other marker needs a classification.
 */
function versionIncrease(
    marker: Readonly<{ artifact: string; from: number; key: string; to: number }>,
    surfaces: Readonly<{ after: ProtocolSurface; before: ProtocolSurface }>,
    policy: CompatibilityPolicy,
    tier: TierRules,
): Diff {
    const { artifact, from, key, to } = marker;
    const backing = policy.protocol.migrationBackedVersions.find((entry) => entry.marker === key);
    if (backing === undefined) {
        return {
            artifact,
            description: `increased ${from} to ${to}; readers require an exact format or protocol version, so the increase needs a classification`,
            from: String(from),
            rule: "classify",
            tier,
            to: String(to),
        };
    }
    const appended =
        (surfaces.after.migrations[backing.migrations]?.length ?? 0) -
        (surfaces.before.migrations[backing.migrations]?.length ?? 0);
    return appended === to - from
        ? {
              artifact,
              description: `increased ${from} to ${to} with ${appended} appended migration(s)`,
              rule: "additive",
              tier,
          }
        : {
              artifact,
              description: `increased ${from} to ${to}, but ${backing.migrations} gained ${appended} migration(s); a schema version increases only with one appended migration per version`,
              rule: "forbidden",
              tier,
          };
}

function isAdditiveSchema(baseline: SchemaFingerprint, current: SchemaFingerprint): boolean {
    if (baseline.rest !== current.rest || baseline.oneOf === null || current.oneOf === null) {
        return false;
    }
    const branches = new Set(current.oneOf);
    return (
        baseline.oneOf.every((branch) => branches.has(branch)) &&
        Object.entries(baseline.defs).every(([name, digest]) => current.defs[name] === digest)
    );
}

async function loadState(options: CompatibilityOptions): Promise<LoadedState> {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot);
    const policy = parseCompatibilityPolicy(
        JSON.parse(
            await readFile(
                options.policyPath ??
                    path.join(repositoryRoot, "config/compatibility-policy.config.json"),
                "utf8",
            ),
        ) as unknown,
    );
    const paths = {
        api: containedPath(repositoryRoot, policy.baselines.api),
        changes: containedPath(repositoryRoot, policy.baselines.changes),
        protocol: containedPath(repositoryRoot, policy.baselines.protocol),
    };
    const [currentApi, currentProtocol, apiBaseline, protocolBaseline, changes] = await Promise.all(
        [
            extractApiSurface(
                {
                    configurationPath: containedPath(repositoryRoot, policy.api.configuration),
                    packagePath: containedPath(repositoryRoot, policy.api.packageManifest),
                    repositoryRoot,
                },
                policy.deprecation,
            ),
            extractProtocolSurface(repositoryRoot, policy.protocol),
            readOptionalJson(paths.api),
            readOptionalJson(paths.protocol),
            readOptionalJson(paths.changes),
        ],
    );
    return {
        apiBaseline: apiBaseline === undefined ? undefined : parseApiBaseline(apiBaseline),
        changes: parseClassifiedChanges(changes ?? []),
        currentApi,
        currentProtocol,
        paths,
        policy,
        protocolBaseline:
            protocolBaseline === undefined ? undefined : parseProtocolBaseline(protocolBaseline),
        repositoryRoot,
    };
}

/**
 * Refuses to judge declarations emitted before the newest configured source edit, so a stale
 * build cannot hide an API change from the gate.
 */
async function assertDeclarationsCurrent(
    repositoryRoot: string,
    policy: CompatibilityPolicy,
): Promise<void> {
    const configuration = objectValue(
        JSON.parse(
            await readFile(containedPath(repositoryRoot, policy.api.configuration), "utf8"),
        ) as unknown,
        "API reference configuration",
    );
    const declarationRoot = stringValue(
        configuration.declarationRoot,
        "API reference declarationRoot",
    );
    const oldestDeclaration = Math.min(
        ...(await fileTimes(containedPath(repositoryRoot, declarationRoot))).map(
            ([, time]) => time,
        ),
    );
    for (const source of policy.build.sources) {
        for (const [file, time] of await fileTimes(containedPath(repositoryRoot, source))) {
            if (time > oldestDeclaration) {
                throw new Error(
                    `${path.relative(repositoryRoot, file)} is newer than the declarations in ${declarationRoot}: run \`pnpm build\` before \`pnpm check:compatibility\``,
                );
            }
        }
    }
}

/** Lists `[file, mtimeMs]` for every file under a directory, or none when it does not exist. */
async function fileTimes(directory: string): Promise<readonly (readonly [string, number])[]> {
    let entries: string[];
    try {
        entries = await readdir(directory, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const times: [string, number][] = [];
    for (const entry of entries) {
        const file = path.join(directory, entry);
        const status = await stat(file);
        if (status.isFile()) {
            times.push([file, status.mtimeMs]);
        }
    }
    return times;
}

function parseVersions(root: Readonly<Record<string, unknown>>, label: string): BaselineVersions {
    const packageVersion = stringValue(root.packageVersion, `${label} packageVersion`);
    parseVersion(packageVersion, `${label} packageVersion`);
    const previousVersion = root.previousVersion;
    if (previousVersion !== null) {
        parseVersion(stringValue(previousVersion, `${label} previousVersion`), label);
    }
    return { packageVersion, previousVersion: previousVersion as string | null };
}

function parseApiBaseline(value: unknown): ApiBaseline {
    const root = objectValue(value, "API baseline");
    const entries = objectValue(root.entries, "API baseline entries");
    for (const [entry, symbols] of Object.entries(entries)) {
        for (const [name, symbolValue] of Object.entries(
            objectValue(symbols, `API baseline entry ${entry}`),
        )) {
            const symbol = objectValue(symbolValue, `API baseline symbol ${entry}#${name}`);
            stringValue(symbol.digest, `API baseline symbol ${entry}#${name} digest`);
            stringValue(symbol.kind, `API baseline symbol ${entry}#${name} kind`);
        }
    }
    return { ...parseVersions(root, "API baseline"), entries: entries as ApiBaseline["entries"] };
}

function parseProtocolBaseline(value: unknown): ProtocolBaseline {
    const root = objectValue(value, "protocol baseline");
    const changeLog = objectValue(root.changeLog, "protocol baseline changeLog");
    const entries = changeLog.entries;
    if (typeof entries !== "number" || !Number.isSafeInteger(entries) || entries < 0) {
        throw new TypeError("protocol baseline changeLog entries must be a non-negative integer");
    }
    const surface = objectValue(root.surface, "protocol baseline surface");
    for (const key of [
        "exitCodes",
        "migrations",
        "schemas",
        "versions",
    ] as const satisfies readonly (keyof ProtocolSurface)[]) {
        objectValue(surface[key], `protocol baseline surface ${key}`);
    }
    arrayValue(surface.commands, "protocol baseline surface commands");
    arrayValue(surface.errorCodes, "protocol baseline surface errorCodes");
    // Baselines recorded before 2.32.2 predate these surfaces.
    for (const key of ["commandOptions", "identity"] as const) {
        if (surface[key] !== undefined) {
            objectValue(surface[key], `protocol baseline surface ${key}`);
        }
    }
    return {
        ...parseVersions(root, "protocol baseline"),
        changeLog: {
            digest: stringValue(changeLog.digest, "protocol baseline changeLog digest"),
            entries,
        },
        surface: surface as ProtocolSurface,
    };
}

async function readOptionalJson(filePath: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${formatJson(value, 0)}\n`);
}

/** Pretty-prints objects and arrays down to depth 3, then writes each deeper value on one line. */
function formatJson(value: unknown, depth: number): string {
    if (typeof value !== "object" || value === null || depth >= 3) {
        return JSON.stringify(value);
    }
    const indent = " ".repeat((depth + 1) * 4);
    const closing = " ".repeat(depth * 4);
    const items = Array.isArray(value)
        ? value.map((item: unknown) => formatJson(item, depth + 1))
        : Object.entries(value).map(
              ([key, item]) => `${JSON.stringify(key)}: ${formatJson(item, depth + 1)}`,
          );
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return items.length === 0
        ? `${open}${close}`
        : `${open}\n${items.map((item) => `${indent}${item}`).join(",\n")}\n${closing}${close}`;
}

function assertNoViolations(report: CompatibilityReport): void {
    if (report.violations.length > 0) {
        throw new Error(
            [
                "compatibility check failed:",
                ...report.violations.map((violation) => `- ${violation}`),
            ].join("\n"),
        );
    }
}

function parseVersion(value: string, label: string): Version {
    const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(value)?.groups;
    if (match === undefined) {
        throw new TypeError(`${label} must be MAJOR.MINOR.PATCH: ${value}`);
    }
    return {
        major: Number(match.major),
        minor: Number(match.minor),
        patch: Number(match.patch),
    };
}

function compareVersions(left: Version, right: Version): number {
    return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function isMinorBump(current: Version, reference: Version): boolean {
    return (
        current.major > reference.major ||
        (current.major === reference.major && current.minor > reference.minor)
    );
}

function windowSatisfied(since: Version, lastRelease: Version, window: number): boolean {
    return (
        lastRelease.major > since.major ||
        (lastRelease.major === since.major && lastRelease.minor - since.minor >= window)
    );
}

function locationValue(value: unknown, label: string): ConfigurationLocation {
    const location = objectValue(value, label);
    return {
        pointer: stringValue(location.pointer, `${label} pointer`),
        source: stringValue(location.source, `${label} source`),
    };
}

function validPattern(value: unknown, label: string): string {
    const pattern = stringValue(value, label);
    try {
        new RegExp(pattern, "u");
    } catch (error) {
        throw new TypeError(`${label} must be a valid regular expression`, { cause: error });
    }
    return pattern;
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${label} must be an array`);
    }
    return value;
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}

function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
        throw new TypeError(`${label} must be a boolean`);
    }
    return value;
}
