import type { ProtocolConfig } from "./config-types.ts";
import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
    readUniqueStrings,
} from "./config-value-readers.ts";

type ReplayConfig = ProtocolConfig["replay"];

const ARTIFACT_KEYS = [
    "admissionSchema",
    "checkpointSchema",
    "restoreSchema",
    "sessionSchema",
    "stepSchema",
    "terminalSchema",
] as const;
const SCHEMA_KEYS = [
    "admissionId",
    "checkpointId",
    "restoreId",
    "sessionId",
    "stepId",
    "terminalId",
] as const;
const TRACE_SCHEMA_KEYS = [
    "admission",
    "checkpoint",
    "restore",
    "session",
    "step",
    "terminal",
] as const;
const ERROR_KEYS = [
    "checkpointUnavailableCode",
    "checkpointUnavailableMessage",
    "compatibilityCode",
    "compatibilityMessage",
    "effectRefusedCode",
    "effectRefusedMessage",
    "evidenceCode",
    "evidenceMessage",
    "interruptedCode",
    "interruptedMessage",
    "leaseConflictCode",
    "leaseConflictMessage",
    "leaseFencedCode",
    "leaseFencedMessage",
    "materializationUncertainCode",
    "materializationUncertainMessage",
    "prefixMismatchCode",
    "prefixMismatchMessage",
    "restoreCode",
    "restoreMessage",
    "stepFailureCode",
    "stepFailureMessage",
] as const;
const IDENTITY_KEYS = [
    "checkpointIdPrefix",
    "commandAppendIntentKind",
    "contextPrefixIdPrefix",
    "cutIdPrefix",
    "frontierIdPrefix",
    "prefixIdPrefix",
    "promptIdPrefix",
    "responseIdPrefix",
    "sessionIdPrefix",
    "stepIdPrefix",
] as const;
const LIMIT_KEYS = [
    "maxDependencies",
    "maxErrorMessageBytes",
    "maxProcessImageBytes",
    "maxProcesses",
    "maxReasonBytes",
    "maxSteps",
    "maxWorldEntries",
    "maxWorlds",
] as const;
const MESSAGE_TYPE_KEYS = [
    "checkpoint",
    "error",
    "image",
    "request",
    "response",
    "restore",
    "restored",
] as const;
const TRANSPARENT_REASON_KEYS = [
    "captureUnsupportedReason",
    "checkFailedReason",
    "executable",
    "executableUnavailableReason",
    "platformUnsupportedReason",
] as const;

/**
 * Validates configured replay session, branch, checkpoint, restore, process, and analysis values.
 *
 * @param value - Untrusted `replay` configuration section.
 * @param reversibilityTiers - Validated effect reversibility tiers that approval tiers must cite.
 * @returns The validated replay configuration.
 * @throws {TypeError} If any field is missing, malformed, inconsistent, or cites an unknown tier.
 */
export function readReplayConfig(
    value: unknown,
    reversibilityTiers: readonly string[],
): ReplayConfig {
    const replay = readObject(
        value,
        [
            "artifacts",
            "branch",
            "cache",
            "changes",
            "checkpoint",
            "compatibilityVersion",
            "divergence",
            "effects",
            "errors",
            "identity",
            "lease",
            "limits",
            "modes",
            "processes",
            "recordVersion",
            "recovery",
            "schemas",
            "steps",
            "terminal",
            "traceSchemas",
        ],
        "replay",
    );
    const branch = readObject(
        replay.branch,
        ["defaultSourceDisposition", "sourceDispositions"],
        "replay.branch",
    );
    const sourceDispositions = readVocabulary(
        branch.sourceDispositions,
        "replay.branch.sourceDispositions",
        2,
    );
    const defaultSourceDisposition = readNonEmptyString(
        branch.defaultSourceDisposition,
        "replay.branch.defaultSourceDisposition",
    );
    if (!sourceDispositions.includes(defaultSourceDisposition)) {
        throw new TypeError(
            "replay.branch.defaultSourceDisposition must be a configured source disposition",
        );
    }
    const cache = readObject(replay.cache, ["statuses"], "replay.cache");
    const checkpoint = readObject(
        replay.checkpoint,
        ["automatic", "classifications", "constituentKinds", "evidenceStatuses", "reasons"],
        "replay.checkpoint",
    );
    const automatic = readObject(
        checkpoint.automatic,
        ["defaultPolicy", "policies"],
        "replay.checkpoint.automatic",
    );
    const divergence = readObject(
        replay.divergence,
        ["causes", "maxSessions", "regressionStrategies", "statuses"],
        "replay.divergence",
    );
    const effects = readObject(
        replay.effects,
        ["approvalRequiredTiers", "dispositions", "reasons"],
        "replay.effects",
    );
    const lease = readRecord(
        replay.lease,
        ["leaseMilliseconds", "renewalMilliseconds"],
        "replay.lease",
        readPositiveInteger,
    );
    if (lease.renewalMilliseconds >= lease.leaseMilliseconds) {
        throw new TypeError("replay.lease.renewalMilliseconds must be shorter than the lease");
    }
    const limits = readRecord(replay.limits, LIMIT_KEYS, "replay.limits", readPositiveInteger);
    const processes = readObject(
        replay.processes,
        ["backends", "cooperative", "transparent"],
        "replay.processes",
    );
    const cooperative = readObject(
        processes.cooperative,
        [
            "maxLineBytes",
            "messageTypes",
            "protocolVersion",
            "spawnFailedReason",
            "timeoutMilliseconds",
        ],
        "replay.processes.cooperative",
    );
    const maxLineBytes = readPositiveInteger(
        cooperative.maxLineBytes,
        "replay.processes.cooperative.maxLineBytes",
    );
    if (maxLineBytes < Math.ceil(limits.maxProcessImageBytes / 3) * 4) {
        throw new TypeError(
            "replay.processes.cooperative.maxLineBytes must hold an encoded maximum process image",
        );
    }
    const messageTypes = readRecord(
        cooperative.messageTypes,
        MESSAGE_TYPE_KEYS,
        "replay.processes.cooperative.messageTypes",
        readNonEmptyString,
    );
    if (new Set(Object.values(messageTypes)).size !== MESSAGE_TYPE_KEYS.length) {
        throw new TypeError("replay.processes.cooperative.messageTypes must be distinct");
    }
    const transparent = readObject(
        processes.transparent,
        [...TRANSPARENT_REASON_KEYS, "checkArguments", "platforms", "probeTimeoutMilliseconds"],
        "replay.processes.transparent",
    );
    const recovery = readObject(replay.recovery, ["classifications"], "replay.recovery");
    const steps = readObject(replay.steps, ["kinds", "sources"], "replay.steps");
    const terminal = readObject(replay.terminal, ["statuses"], "replay.terminal");
    const traceSchemas = readRecord(
        replay.traceSchemas,
        TRACE_SCHEMA_KEYS,
        "replay.traceSchemas",
        readNonEmptyString,
    );
    if (new Set(Object.values(traceSchemas)).size !== TRACE_SCHEMA_KEYS.length) {
        throw new TypeError("replay.traceSchemas must be distinct");
    }
    const approvalRequiredTiers = readUniqueStrings(
        effects.approvalRequiredTiers,
        "replay.effects.approvalRequiredTiers",
    );
    if (approvalRequiredTiers.some((tier) => !reversibilityTiers.includes(tier))) {
        throw new TypeError(
            "replay.effects.approvalRequiredTiers must cite configured effect reversibility tiers",
        );
    }
    return {
        artifacts: readRecord(
            replay.artifacts,
            ARTIFACT_KEYS,
            "replay.artifacts",
            readNonEmptyString,
        ),
        branch: { defaultSourceDisposition, sourceDispositions },
        cache: { statuses: readVocabulary(cache.statuses, "replay.cache.statuses", 2) },
        changes: readVocabulary(replay.changes, "replay.changes", 3),
        checkpoint: {
            automatic: readAutomaticCheckpointConfig(automatic, limits.maxSteps),
            classifications: readVocabulary(
                checkpoint.classifications,
                "replay.checkpoint.classifications",
                3,
            ),
            constituentKinds: readVocabulary(
                checkpoint.constituentKinds,
                "replay.checkpoint.constituentKinds",
                5,
            ),
            evidenceStatuses: readVocabulary(
                checkpoint.evidenceStatuses,
                "replay.checkpoint.evidenceStatuses",
                4,
            ),
            reasons: readRecord(
                checkpoint.reasons,
                [
                    "adapterFailure",
                    "boundaryWithoutCheckpoint",
                    "processImageBound",
                    "providerPrefixMismatch",
                    "worldCapture",
                ],
                "replay.checkpoint.reasons",
                readNonEmptyString,
            ),
        },
        compatibilityVersion: readNonEmptyString(
            replay.compatibilityVersion,
            "replay.compatibilityVersion",
        ),
        divergence: {
            causes: readVocabulary(divergence.causes, "replay.divergence.causes", 3),
            maxSessions: readMaxDiffSessions(divergence.maxSessions),
            regressionStrategies: readVocabulary(
                divergence.regressionStrategies,
                "replay.divergence.regressionStrategies",
                2,
            ),
            statuses: readVocabulary(divergence.statuses, "replay.divergence.statuses", 4),
        },
        effects: {
            approvalRequiredTiers,
            dispositions: readVocabulary(effects.dispositions, "replay.effects.dispositions", 3),
            reasons: readRecord(
                effects.reasons,
                ["missingPolicy", "policyFailure"],
                "replay.effects.reasons",
                readNonEmptyString,
            ),
        },
        errors: readRecord(replay.errors, ERROR_KEYS, "replay.errors", readNonEmptyString),
        identity: readRecord(replay.identity, IDENTITY_KEYS, "replay.identity", readNonEmptyString),
        lease,
        limits,
        modes: readVocabulary(replay.modes, "replay.modes", 3),
        processes: {
            backends: readVocabulary(processes.backends, "replay.processes.backends", 2),
            cooperative: {
                maxLineBytes,
                messageTypes,
                protocolVersion: readPositiveInteger(
                    cooperative.protocolVersion,
                    "replay.processes.cooperative.protocolVersion",
                ),
                spawnFailedReason: readNonEmptyString(
                    cooperative.spawnFailedReason,
                    "replay.processes.cooperative.spawnFailedReason",
                ),
                timeoutMilliseconds: readPositiveInteger(
                    cooperative.timeoutMilliseconds,
                    "replay.processes.cooperative.timeoutMilliseconds",
                ),
            },
            transparent: {
                ...readRecord(
                    transparent,
                    TRANSPARENT_REASON_KEYS,
                    "replay.processes.transparent",
                    readNonEmptyString,
                    true,
                ),
                checkArguments: readUniqueStrings(
                    transparent.checkArguments,
                    "replay.processes.transparent.checkArguments",
                ),
                platforms: readUniqueStrings(
                    transparent.platforms,
                    "replay.processes.transparent.platforms",
                ),
                probeTimeoutMilliseconds: readPositiveInteger(
                    transparent.probeTimeoutMilliseconds,
                    "replay.processes.transparent.probeTimeoutMilliseconds",
                ),
            },
        },
        recordVersion: readPositiveInteger(replay.recordVersion, "replay.recordVersion"),
        recovery: {
            classifications: readVocabulary(
                recovery.classifications,
                "replay.recovery.classifications",
                4,
            ),
        },
        schemas: readRecord(replay.schemas, SCHEMA_KEYS, "replay.schemas", readAbsoluteUrl),
        steps: {
            kinds: readVocabulary(steps.kinds, "replay.steps.kinds", 2),
            sources: readVocabulary(steps.sources, "replay.steps.sources", 2),
        },
        terminal: { statuses: readVocabulary(terminal.statuses, "replay.terminal.statuses", 4) },
        traceSchemas,
    };
}

/**
 * Validates one automatic checkpoint policy against the configured policy vocabulary.
 *
 * The policy is `{ kind }`, plus a positive `interval` of at most `maxSteps` exactly when the kind
 * is the configured interval policy (the fourth vocabulary entry).
 *
 * @param value - Untrusted policy value.
 * @param policies - Configured policy kinds ordered none, provider step, effect step, every N steps.
 * @param maxSteps - Configured session step bound.
 * @param path - Diagnostic path of the value.
 * @returns The validated policy with `interval` null for every other kind.
 * @throws {TypeError} If the policy is malformed, names an unknown kind, or has an invalid interval.
 *
 * @example
 * ```ts
 * readReplayCheckpointPolicy({ interval: 2, kind: "every_n_steps" }, policies, 4096, "policy");
 * ```
 */
export function readReplayCheckpointPolicy(
    value: unknown,
    policies: readonly string[],
    maxSteps: number,
    path: string,
): { readonly interval: number | null; readonly kind: string } {
    const intervalKind = policies[3];
    const kind = readObject(value, ["kind"], path, true).kind;
    if (typeof kind !== "string" || !policies.includes(kind)) {
        throw new TypeError(`${path}.kind must be a configured checkpoint policy`);
    }
    if (kind !== intervalKind) {
        readObject(value, ["kind"], path);
        return Object.freeze({ interval: null, kind });
    }
    const fields = readObject(value, ["interval", "kind"], path);
    const interval = readPositiveInteger(fields.interval, `${path}.interval`);
    if (interval > maxSteps) {
        throw new TypeError(`${path}.interval must not exceed the configured step bound`);
    }
    return Object.freeze({ interval, kind });
}

function readAutomaticCheckpointConfig(
    automatic: Record<string, unknown>,
    maxSteps: number,
): ReplayConfig["checkpoint"]["automatic"] {
    const policies = readVocabulary(automatic.policies, "replay.checkpoint.automatic.policies", 4);
    return {
        defaultPolicy: readReplayCheckpointPolicy(
            automatic.defaultPolicy,
            policies,
            maxSteps,
            "replay.checkpoint.automatic.defaultPolicy",
        ),
        policies,
    };
}

function readRecord<const K extends string, V>(
    value: unknown,
    keys: readonly K[],
    path: string,
    read: (entry: unknown, entryPath: string) => V,
    allowAdditionalKeys = false,
): { readonly [Key in K]: V } {
    const object = readObject(value, keys, path, allowAdditionalKeys);
    return Object.fromEntries(keys.map((key) => [key, read(object[key], `${path}.${key}`)])) as {
        readonly [Key in K]: V;
    };
}

function readVocabulary(value: unknown, path: string, length: number): readonly string[] {
    const values = readUniqueStrings(value, path);
    if (values.length !== length) {
        throw new TypeError(`${path} must contain exactly ${length} values`);
    }
    return values;
}

function readMaxDiffSessions(value: unknown): number {
    const maxSessions = readPositiveInteger(value, "replay.divergence.maxSessions");
    if (maxSessions < 2) {
        throw new TypeError("replay.divergence.maxSessions must admit at least two sessions");
    }
    return maxSessions;
}
