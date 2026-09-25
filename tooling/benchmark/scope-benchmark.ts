import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    closeSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statfsSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    claimScopeWriter,
    createEffectHandlerStack,
    createEffectIntent,
    createReferenceCopyCarrier,
    createWorkspaceBindings,
    deriveReplaySessionId,
    discardScope,
    forkScope,
    initializeWorkspace,
    inspectScope,
    inspectWorkspacePlatformConformance,
    openTraceSubscription,
    type ReferenceCopyCarrier,
    registerRootScope,
    releaseScopeWriter,
    runReplaySession,
    type ScopeResourceGrant,
    type ScopeWriter,
    SQLiteTraceStore,
    type TraceSubscription,
    type WorkspaceBinding,
    type WorldCarrierBackend,
    WorldCarrierError,
} from "../../src/index.ts";
import { kernelProtocolConfig, workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    EFFECT_REVERSIBILITY_TIERS,
    SCOPE_AUTHORITY_ATOMS,
    SCOPE_RESOURCE_KINDS,
} from "../../src/protocol/values.generated.ts";
import {
    type BenchmarkCommandIo,
    type BenchmarkEnvironment,
    detectHostClass,
    digestBenchmarkConfiguration,
    evaluateSlo,
    type MetricResult,
    readBenchmarkEnvironment,
    renderSloEvaluation,
    summarizeSamples,
} from "./kernel-benchmark.ts";
import {
    digestTree,
    fitLine,
    readScopeBenchmarkConfiguration,
    SCOPE_METRIC_FAMILIES,
    type ScopeBenchmarkConfiguration,
    type ScopeBenchmarkWorld,
    type ScopeMetricFamily,
    type ScopeSloConfiguration,
    scopeMetricName,
    scopeResultPath,
} from "./scope-benchmark-config.ts";

const [REVERSIBLE] = EFFECT_REVERSIBILITY_TIERS;
const [, WORKSPACE_RESOURCE_KIND] = SCOPE_RESOURCE_KINDS;
const BACKENDS = workspaceProtocolConfig.carrierBackends;
const STORE_FILE = "trace.sqlite";
const SETTLE_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

/** One K-branch storage measurement (parent, checkpoint, K - 1 mutated siblings). */
export type ScopeBranchingSample = {
    /** Free space consumed by the K - 1 sibling forks and their writes. */
    readonly disk_k_bytes: number;
    /** Sibling fork latencies in fork order. */
    readonly fork_ms: readonly number[];
    /** Median free space consumed by one sibling fork plus its writes. */
    readonly per_branch_bytes: number;
    /** Resident set size growth of this process while the K branches exist. */
    readonly rss_k_bytes: number;
    /** Sibling discard latencies in discard order. */
    readonly revert_ms: readonly number[];
    /** Growth of the trace store files (database, WAL, shared memory) over the same interval. */
    readonly store_delta_bytes: number;
    /** Free space consumed by baseline writes, the checkpoint, and every sibling. */
    readonly total_delta_bytes: number;
    /** Allocated bytes of every overlay upper layer, or null for other backends. */
    readonly upper_layer_bytes: number | null;
};

/** Summarized K-branch measurement of one backend, world, and write size. */
export type ScopeBranchingResult = {
    readonly backend: string;
    /** Bytes the workload wrote: (baseline + (K - 1) * branch writes) * write size. */
    readonly written_bytes: number;
    readonly world: string;
    readonly world_bytes: number;
    readonly write_bytes: number;
    /** Median over repetitions of each storage figure. */
    readonly median: Omit<ScopeBranchingSample, "fork_ms" | "revert_ms">;
    readonly samples: readonly ScopeBranchingSample[];
};

/** One revert-correctness check. */
export type ScopeRevertCheck = {
    readonly backend: string;
    /** What was compared after the revert. */
    readonly check: string;
    readonly ok: boolean;
    readonly world: string;
    readonly write_bytes: number;
};

/** Per-backend line fit of total storage growth against bytes written in the mutation sweep. */
export type ScopeStorageScaling = {
    readonly backend: string;
    readonly intercept: number;
    readonly r_squared: number;
    /** Bytes of storage per byte written. */
    readonly slope: number;
};

/** Untimed shape of one observation configuration. */
export type ScopeObservationShape = {
    readonly observers: number;
    /** Committed session records per effect event. */
    readonly records_per_event: number;
    readonly steps: number;
    /** JSON bytes of the committed records per effect event. */
    readonly stream_bytes_per_event: number;
};

/** Complete scope benchmark result artifact. */
export type ScopeBenchmarkResult = {
    /** Conformant carrier backends measured on this host. */
    readonly backends: readonly string[];
    readonly branching: readonly ScopeBranchingResult[];
    readonly configuration: ScopeBenchmarkConfiguration;
    readonly configuration_digest: string;
    readonly environment: BenchmarkEnvironment;
    readonly format: string;
    readonly format_version: number;
    readonly host_class: string | null;
    readonly metrics: Readonly<Record<string, MetricResult>>;
    readonly method: string;
    readonly mutation_sweep: {
        readonly rows: readonly ScopeBranchingResult[];
        readonly scaling: readonly ScopeStorageScaling[];
    };
    readonly observation: readonly ScopeObservationShape[];
    readonly recorded_on: string;
    readonly revert_checks: readonly ScopeRevertCheck[];
};

/** Paths used by the scope benchmark commands. */
export type ScopeBenchmarkPaths = {
    readonly configuration: string;
    readonly repositoryRoot: string;
};

/**
 * Measures scope fork/revert latency, K-branch storage, the mutation-size sweep, and per-event
 * record and observe overhead in a scratch directory that is removed afterwards. Every revert is
 * checked for content equality; a failed check or an observer that appended a record fails the
 * run.
 *
 * @param configuration - Validated benchmark procedure.
 * @param options - Repository root, SLO host classes, and optional clock.
 * @returns The complete result artifact.
 * @throws {AssertionError} If a revert-correctness or observer-neutrality check fails.
 * @throws {Error} If a workload fails.
 */
export async function runScopeBenchmark(
    configuration: ScopeBenchmarkConfiguration,
    options: {
        readonly now?: Date;
        readonly repositoryRoot: string;
        readonly slo: ScopeSloConfiguration;
    },
): Promise<ScopeBenchmarkResult> {
    const root = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), configuration.temporaryDirectoryPrefix)),
    );
    try {
        const environment = readBenchmarkEnvironment(root, options.repositoryRoot);
        const bench = new ScopeBench(configuration, root);
        const backends = bench.conformantBackends();
        const samples: Record<string, number[]> = {};
        const branching: ScopeBranchingResult[] = [];
        const sweep: ScopeBranchingResult[] = [];
        for (const backend of backends) {
            for (const world of configuration.worlds) {
                const latency = await bench.forkRevertLatency(backend, world);
                samples[scopeMetricName("fork_ms", backend, world.id)] = latency.fork;
                samples[scopeMetricName("revert_ms", backend, world.id)] = latency.revert;
                branching.push(
                    await bench.branching(
                        backend,
                        world,
                        configuration.branching.defaultWriteBytes,
                    ),
                );
            }
            const sweepWorld = configuration.worlds.find(
                ({ id }) => id === configuration.mutationSweep.world,
            ) as ScopeBenchmarkWorld;
            for (const writeBytes of configuration.mutationSweep.writeBytes) {
                sweep.push(
                    writeBytes === configuration.branching.defaultWriteBytes
                        ? (branching.find(
                              (entry) => entry.backend === backend && entry.world === sweepWorld.id,
                          ) as ScopeBranchingResult)
                        : await bench.branching(backend, sweepWorld, writeBytes),
                );
            }
        }
        const observation: ScopeObservationShape[] = [];
        for (const steps of configuration.observation.steps) {
            for (const observers of configuration.observation.observerCounts) {
                const measured = await bench.observation(steps, observers);
                samples[scopeMetricName("record_ms", `observers-${observers}`, `steps-${steps}`)] =
                    measured.record;
                if (observers > 0) {
                    samples[
                        scopeMetricName("observe_ms", `observers-${observers}`, `steps-${steps}`)
                    ] = measured.observe;
                }
                observation.push(measured.shape);
            }
        }
        for (const steps of configuration.observation.steps) {
            const shapes = observation.filter((shape) => shape.steps === steps);
            assert.equal(
                new Set(shapes.map((shape) => shape.records_per_event)).size,
                1,
                `observers changed the recorded stream at ${steps} steps`,
            );
        }
        const failed = bench.revertChecks.filter(({ ok }) => !ok);
        assert.deepEqual(failed, [], "every revert must restore the pre-fork content");
        const metrics = Object.fromEntries(
            Object.entries(samples).map(([name, values]): [string, MetricResult] => [
                name,
                {
                    better: "lower",
                    description: SCOPE_METRIC_FAMILIES[name.split("/")[0] as ScopeMetricFamily],
                    samples: values,
                    summary: summarizeSamples(values),
                    unit: "ms",
                },
            ]),
        );
        return {
            backends,
            branching,
            configuration,
            configuration_digest: digestBenchmarkConfiguration(configuration),
            environment,
            format: configuration.resultFormat,
            format_version: configuration.resultFormatVersion,
            host_class: detectHostClass(options.slo, environment)?.id ?? null,
            metrics,
            method: "fork_ms times forkScope of a child of a writer-held root scope from one immutable snapshot of the source binding; the child then writes branchWrites files and revert_ms times discardScope with the carrier, which seals the child and removes its custody. Branching forks a parent from the snapshot, writes baselineWrites files into its custody, captures that custody as the checkpoint, and forks K - 1 siblings from the checkpoint that each write branchWrites files; storage is the host free-space drop (after the configured flush command), which also counts carrier descriptors and manifests, the trace store growth reported separately as store_delta_bytes, and any concurrent writer on the volume; rss is process.memoryUsage().rss growth of this single process, since the carriers run in-process. After each revert the source binding, the parent custody, and a fresh fork of the checkpoint are digested independently of the carrier and compared with the pre-fork digests. record_ms times one dispatchEffect in a replay session with no world binding; observe_ms times one ephemeral trace subscription pulling that event's committed records, with every observer draining after every event.",
            mutation_sweep: {
                rows: sweep,
                scaling: backends.map((backend) => ({
                    backend,
                    ...fitLine(
                        sweep
                            .filter((row) => row.backend === backend)
                            .map((row) => ({
                                x: row.written_bytes,
                                y: row.median.total_delta_bytes,
                            })),
                    ),
                })),
            },
            observation,
            recorded_on: (options.now ?? new Date()).toISOString().slice(0, 10),
            revert_checks: bench.revertChecks,
        };
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
}

/**
 * `pnpm bench:scopes`: measures, writes the result artifact for the matched host class (or
 * prints it for a host without a class), and reports the SLO evaluation without failing on it.
 *
 * @param paths - Configuration file and repository root.
 * @param io - Output sink.
 * @returns The written artifact path, or null for a host without a class.
 * @throws {AssertionError} If a correctness check fails.
 */
export async function benchScopes(
    paths: ScopeBenchmarkPaths,
    io: BenchmarkCommandIo,
): Promise<string | null> {
    const { benchmark, slo } = readScopeBenchmarkConfiguration(paths.configuration);
    const result = await runScopeBenchmark(benchmark, {
        repositoryRoot: paths.repositoryRoot,
        slo,
    });
    const text = `${JSON.stringify(result, null, 4)}\n`;
    const hostClass = slo.hostClasses.find(({ id }) => id === result.host_class);
    if (hostClass === undefined) {
        io.write(text);
        io.write("No scope benchmark host class matches this host; the result was not written.\n");
        return null;
    }
    const relative = scopeResultPath(benchmark, hostClass.id);
    mkdirSync(path.join(paths.repositoryRoot, benchmark.resultDirectory), { recursive: true });
    writeFileSync(path.join(paths.repositoryRoot, relative), text);
    io.write(`Wrote ${relative}\n`);
    io.write(renderSloEvaluation(evaluateSlo(result, hostClass)));
    return relative;
}

/**
 * `pnpm check:scopes`: requires the committed artifact of the matched host class to record the
 * current benchmark procedure, then measures afresh and evaluates the budgets. A host without a
 * class is reported and skipped.
 *
 * @param paths - Configuration file and repository root.
 * @param io - Output sink.
 * @returns Whether the check passed or was skipped.
 * @throws {AssertionError} If a correctness check fails.
 */
export async function checkScopeSlo(
    paths: ScopeBenchmarkPaths,
    io: BenchmarkCommandIo,
): Promise<boolean> {
    const { benchmark, slo } = readScopeBenchmarkConfiguration(paths.configuration);
    const result = await runScopeBenchmark(benchmark, {
        repositoryRoot: paths.repositoryRoot,
        slo,
    });
    const hostClass = slo.hostClasses.find(({ id }) => id === result.host_class);
    if (hostClass === undefined) {
        io.write(
            `SLO: skipped; no scope benchmark host class matches ${result.environment.platform}/${result.environment.arch} filesystem type ${result.environment.filesystem_type}\n`,
        );
        return true;
    }
    const relative = scopeResultPath(benchmark, hostClass.id);
    let committed: { readonly configuration_digest?: string } | undefined;
    try {
        committed = JSON.parse(readFileSync(path.join(paths.repositoryRoot, relative), "utf8"));
    } catch {
        committed = undefined;
    }
    if (committed?.configuration_digest !== result.configuration_digest) {
        io.write(
            `SLO: FAIL; ${relative} is missing or was measured with a different benchmark configuration; run pnpm bench:scopes\n`,
        );
        return false;
    }
    const evaluation = evaluateSlo(result, hostClass);
    io.write(renderSloEvaluation(evaluation));
    return evaluation.ok;
}

type BenchWorkspace = {
    readonly carrier: ReferenceCopyCarrier;
    readonly grant: ScopeResourceGrant;
    readonly rootScopeId: string;
    readonly rootWriter: ScopeWriter;
    readonly source: WorkspaceBinding;
    readonly store: SQLiteTraceStore;
    readonly workspaceRoot: string;
};

class ScopeBench {
    readonly configuration: ScopeBenchmarkConfiguration;
    readonly revertChecks: ScopeRevertCheck[] = [];
    readonly root: string;
    #sequence = 0;

    constructor(configuration: ScopeBenchmarkConfiguration, root: string) {
        this.configuration = configuration;
        this.root = root;
    }

    conformantBackends(): string[] {
        const probe = this.#directory("probe");
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: probe });
        const backends = [
            BACKENDS.defaultBackend,
            ...inspectWorkspacePlatformConformance({ workspaceRoot: probe })
                .optimized_carriers.filter(
                    (evidence) => evidence.status === BACKENDS.conformance.statusRoles.conformant,
                )
                .map((evidence) => evidence.backend),
        ];
        rmSync(probe, { force: true, recursive: true });
        return backends;
    }

    async forkRevertLatency(
        backend: string,
        world: ScopeBenchmarkWorld,
    ): Promise<{ readonly fork: number[]; readonly revert: number[] }> {
        const workspace = this.#workspace(backend, world);
        try {
            const sourceRoot = path.join(
                workspace.workspaceRoot,
                this.configuration.naming.sourceBinding,
            );
            const sourceDigest = digestTree(sourceRoot);
            const origin = await workspace.carrier.snapshot(workspace.source);
            const fork: number[] = [];
            const revert: number[] = [];
            const { repetitions, warmupIterations } = this.configuration.fork;
            for (let index = 0; index < warmupIterations + repetitions; index += 1) {
                const started = performance.now();
                const child = await forkScope(workspace.store, {
                    binding: workspace.source,
                    carrier: workspace.carrier,
                    commandId: this.#command("fork"),
                    expectedHeadRecordId: headOf(workspace.store, workspace.rootScopeId),
                    grant: [workspace.grant],
                    nowMilliseconds: this.configuration.naming.logicalTimeMilliseconds,
                    originRevisionId: origin.revision_id,
                    parent: workspace.rootWriter,
                });
                const forked = performance.now() - started;
                await this.#write(
                    workspace.carrier,
                    child.world.custody_id,
                    this.configuration.branching.branchWrites,
                    this.configuration.branching.defaultWriteBytes,
                );
                const reverted = await this.#discard(
                    workspace,
                    workspace.rootWriter,
                    child.scope_id,
                );
                if (index >= warmupIterations) {
                    fork.push(round(forked));
                    revert.push(round(reverted));
                }
            }
            this.revertChecks.push({
                backend,
                check: "source binding digest unchanged after every fork and discard",
                ok: digestTree(sourceRoot) === sourceDigest,
                world: world.id,
                write_bytes: this.configuration.branching.defaultWriteBytes,
            });
            return { fork, revert };
        } finally {
            this.#close(workspace);
        }
    }

    async branching(
        backend: string,
        world: ScopeBenchmarkWorld,
        writeBytes: number,
    ): Promise<ScopeBranchingResult> {
        const { baselineWrites, branchCount, branchWrites, repetitions } =
            this.configuration.branching;
        const samples: ScopeBranchingSample[] = [];
        for (let repetition = 0; repetition < repetitions; repetition += 1) {
            samples.push(await this.#branchingSample(backend, world, writeBytes));
        }
        const median = (select: (sample: ScopeBranchingSample) => number): number =>
            summarizeSamples(samples.map(select)).median;
        return {
            backend,
            median: {
                disk_k_bytes: median((sample) => sample.disk_k_bytes),
                per_branch_bytes: median((sample) => sample.per_branch_bytes),
                rss_k_bytes: median((sample) => sample.rss_k_bytes),
                store_delta_bytes: median((sample) => sample.store_delta_bytes),
                total_delta_bytes: median((sample) => sample.total_delta_bytes),
                upper_layer_bytes:
                    samples[0]?.upper_layer_bytes === null
                        ? null
                        : median((sample) => sample.upper_layer_bytes as number),
            },
            samples,
            world: world.id,
            world_bytes: world.files * world.fileBytes,
            write_bytes: writeBytes,
            written_bytes: (baselineWrites + (branchCount - 1) * branchWrites) * writeBytes,
        };
    }

    async observation(
        steps: number,
        observerCount: number,
    ): Promise<{
        readonly observe: number[];
        readonly record: number[];
        readonly shape: ScopeObservationShape;
    }> {
        const { naming, observation } = this.configuration;
        const record: number[] = [];
        const observe: number[] = [];
        let recordsPerEvent = 0;
        let streamBytesPerEvent = 0;
        for (let repetition = 0; repetition < observation.sessionRepetitions; repetition += 1) {
            const directory = this.#directory("observe");
            const store = new SQLiteTraceStore(path.join(directory, STORE_FILE));
            try {
                const commandId = this.#command("session");
                const sessionId = deriveReplaySessionId(commandId);
                const firstOwnerOrdinal = kernelProtocolConfig.append.firstOwnerOrdinal;
                const observers = Array.from({ length: observerCount }, () => ({
                    delivered: firstOwnerOrdinal,
                    subscription: openTraceSubscription(store, {
                        owners: [sessionId],
                        start: "origin",
                    }),
                }));
                const nextOrdinal = (): number =>
                    store.readOwnerNextOrdinals([sessionId]).get(sessionId) ?? firstOwnerOrdinal;
                const drain = async (observer: {
                    delivered: number;
                    readonly subscription: TraceSubscription;
                }): Promise<void> => {
                    const target = nextOrdinal();
                    while (observer.delivered < target) {
                        assert.ok(await observer.subscription.next());
                        observer.delivered += 1;
                    }
                };
                let firstOrdinal = 0;
                let lastOrdinal = 0;
                await runReplaySession(store, {
                    claimId: `${naming.claimPrefix}session`,
                    commandId,
                    handlers: createEffectHandlerStack([
                        {
                            handle: () => ({ ok: true, value: null }),
                            handlerId: naming.handlerId,
                            kind: naming.effectKind,
                        },
                    ]),
                    program: async (context) => {
                        for (const observer of observers) await drain(observer);
                        firstOrdinal = nextOrdinal();
                        for (let step = 0; step < steps; step += 1) {
                            const started = performance.now();
                            await context.dispatchEffect(
                                createEffectIntent({
                                    effectId: `${naming.commandPrefix}effect:${step}`,
                                    kind: naming.effectKind,
                                    payload: { step },
                                    reversibility: REVERSIBLE,
                                }),
                            );
                            record.push(round(performance.now() - started));
                            for (const observer of observers) {
                                const pulled = performance.now();
                                await drain(observer);
                                observe.push(round(performance.now() - pulled));
                            }
                        }
                        lastOrdinal = nextOrdinal();
                        return null;
                    },
                    programId: naming.programId,
                });
                for (const observer of observers) observer.subscription.close();
                const sizing = openTraceSubscription(store, {
                    owners: [sessionId],
                    start: "origin",
                });
                let bytes = 0;
                for (let ordinal = firstOwnerOrdinal; ordinal < lastOrdinal; ordinal += 1) {
                    const delivery = await sizing.next();
                    assert.ok(delivery);
                    if (ordinal >= firstOrdinal) {
                        bytes += Buffer.byteLength(JSON.stringify(delivery.record));
                    }
                }
                sizing.close();
                recordsPerEvent = (lastOrdinal - firstOrdinal) / steps;
                streamBytesPerEvent = round(bytes / steps);
            } finally {
                store.close();
                rmSync(directory, { force: true, recursive: true });
            }
        }
        return {
            observe,
            record,
            shape: {
                observers: observerCount,
                records_per_event: recordsPerEvent,
                steps,
                stream_bytes_per_event: streamBytesPerEvent,
            },
        };
    }

    async #branchingSample(
        backend: string,
        world: ScopeBenchmarkWorld,
        writeBytes: number,
    ): Promise<ScopeBranchingSample> {
        const { baselineWrites, branchCount, branchWrites } = this.configuration.branching;
        const { naming } = this.configuration;
        const workspace = this.#workspace(backend, world);
        try {
            const sourceRoot = path.join(workspace.workspaceRoot, naming.sourceBinding);
            const sourceDigest = digestTree(sourceRoot);
            const origin = await workspace.carrier.snapshot(workspace.source);
            const parent = await forkScope(workspace.store, {
                binding: workspace.source,
                carrier: workspace.carrier,
                commandId: this.#command("fork-parent"),
                expectedHeadRecordId: headOf(workspace.store, workspace.rootScopeId),
                grant: [workspace.grant],
                nowMilliseconds: naming.logicalTimeMilliseconds,
                originRevisionId: origin.revision_id,
                parent: workspace.rootWriter,
            });
            const parentWriter = claimScopeWriter(workspace.store, {
                claimId: `${naming.claimPrefix}parent`,
                nowMilliseconds: naming.logicalTimeMilliseconds,
                scopeId: parent.scope_id,
            });
            const parentCustody = await workspace.carrier.openCustody(parent.world.custody_id);
            const rssBefore = process.memoryUsage().rss;
            const freeBefore = this.#settledFreeBytes(workspace.workspaceRoot);
            const storeBefore = storeBytes(workspace.workspaceRoot);
            await this.#write(
                workspace.carrier,
                parent.world.custody_id,
                baselineWrites,
                writeBytes,
            );
            const checkpoint = await workspace.carrier.captureCustody(parent.world.custody_id);
            const checkpointDigest = digestTree(parentCustody.path);
            const freeBeforeSiblings = this.#freeBytes(workspace.workspaceRoot);
            const siblingDeltas: number[] = [];
            const forkMilliseconds: number[] = [];
            const siblings: string[] = [];
            const custodyPaths: string[] = [];
            const custodyIds: string[] = [];
            let previous = freeBeforeSiblings;
            for (let sibling = 1; sibling < branchCount; sibling += 1) {
                const started = performance.now();
                const child = await forkScope(workspace.store, {
                    binding: workspace.source,
                    carrier: workspace.carrier,
                    commandId: this.#command("fork-sibling"),
                    expectedHeadRecordId: headOf(workspace.store, parent.scope_id),
                    grant: [workspace.grant],
                    nowMilliseconds: naming.logicalTimeMilliseconds,
                    originRevisionId: checkpoint.revision_id,
                    parent: parentWriter,
                });
                forkMilliseconds.push(round(performance.now() - started));
                custodyIds.push(child.world.custody_id);
                custodyPaths.push(
                    (await workspace.carrier.openCustody(child.world.custody_id)).path,
                );
                await this.#write(
                    workspace.carrier,
                    child.world.custody_id,
                    branchWrites,
                    writeBytes,
                );
                const current = this.#freeBytes(workspace.workspaceRoot);
                siblingDeltas.push(Math.max(0, previous - current));
                previous = current;
                siblings.push(child.scope_id);
            }
            const rssAfter = process.memoryUsage().rss;
            const storeAfter = storeBytes(workspace.workspaceRoot);
            const upperLayerBytes =
                backend === BACKENDS.overlay.backend
                    ? custodyPaths.reduce(
                          (total, custodyPath) =>
                              total +
                              allocatedBytes(
                                  path.join(
                                      path.dirname(custodyPath),
                                      BACKENDS.overlay.upperDirectory,
                                  ),
                              ),
                          allocatedBytes(
                              path.join(
                                  path.dirname(parentCustody.path),
                                  BACKENDS.overlay.upperDirectory,
                              ),
                          ),
                      )
                    : null;
            const revertMilliseconds: number[] = [];
            for (const sibling of siblings) {
                revertMilliseconds.push(
                    round(await this.#discard(workspace, parentWriter, sibling)),
                );
            }
            const fresh = await forkScope(workspace.store, {
                binding: workspace.source,
                carrier: workspace.carrier,
                commandId: this.#command("fork-check"),
                expectedHeadRecordId: headOf(workspace.store, parent.scope_id),
                grant: [workspace.grant],
                nowMilliseconds: naming.logicalTimeMilliseconds,
                originRevisionId: checkpoint.revision_id,
                parent: parentWriter,
            });
            const freshCustody = await workspace.carrier.openCustody(fresh.world.custody_id);
            const check = (description: string, ok: boolean): void => {
                this.revertChecks.push({
                    backend,
                    check: description,
                    ok,
                    world: world.id,
                    write_bytes: writeBytes,
                });
            };
            check(
                "parent custody digest equals its checkpoint after sibling discards",
                digestTree(parentCustody.path) === checkpointDigest,
            );
            check(
                "fresh fork of the checkpoint equals the pre-fork digest",
                digestTree(freshCustody.path) === checkpointDigest &&
                    (await workspace.carrier.verifyCustody(fresh.world.custody_id)).content_id ===
                        checkpoint.content_id,
            );
            check("source binding digest unchanged", digestTree(sourceRoot) === sourceDigest);
            let discardedCustodiesGone = true;
            for (const custodyId of custodyIds) {
                discardedCustodiesGone &&= await workspace.carrier.openCustody(custodyId).then(
                    () => false,
                    (error: unknown) => error instanceof WorldCarrierError,
                );
            }
            check("discarded sibling custody can no longer be opened", discardedCustodiesGone);
            // Discarding the parent subtree also removes the fresh fork's custody, so no carrier
            // custody (an overlay mount in particular) outlives the workspace.
            releaseScopeWriter(workspace.store, { writer: parentWriter });
            await this.#discard(workspace, workspace.rootWriter, parent.scope_id);
            return {
                disk_k_bytes: Math.max(0, freeBeforeSiblings - previous),
                fork_ms: forkMilliseconds,
                per_branch_bytes: summarizeSamples(siblingDeltas).median,
                rss_k_bytes: Math.max(0, rssAfter - rssBefore),
                revert_ms: revertMilliseconds,
                store_delta_bytes: storeAfter - storeBefore,
                total_delta_bytes: Math.max(0, freeBefore - previous),
                upper_layer_bytes: upperLayerBytes,
            };
        } finally {
            this.#close(workspace);
        }
    }

    async #discard(
        workspace: BenchWorkspace,
        parent: ScopeWriter,
        scopeId: string,
    ): Promise<number> {
        const expectedHeadRecordId = headOf(workspace.store, scopeId);
        const started = performance.now();
        await discardScope(workspace.store, {
            carrier: workspace.carrier,
            commandId: this.#command("discard"),
            expectedHeadRecordId,
            nowMilliseconds: this.configuration.naming.logicalTimeMilliseconds,
            parent,
            scopeId,
        });
        return performance.now() - started;
    }

    async #write(
        carrier: ReferenceCopyCarrier,
        custodyId: string,
        count: number,
        bytes: number,
    ): Promise<void> {
        const custody = await carrier.openCustody(custodyId);
        for (let index = 0; index < count; index += 1) {
            const label = this.#command("write");
            writeDurably(path.join(custody.path, fileName(label)), contentOf(label, bytes));
        }
    }

    #workspace(backend: string, world: ScopeBenchmarkWorld): BenchWorkspace {
        const { naming } = this.configuration;
        const workspaceRoot = this.#directory(`${backend}-${world.id}`);
        initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: workspaceRoot });
        const sourceRoot = path.join(workspaceRoot, naming.sourceBinding);
        mkdirSync(sourceRoot);
        for (let index = 0; index < world.files; index += 1) {
            const label = `${world.id}:${index}`;
            writeDurably(path.join(sourceRoot, fileName(label)), contentOf(label, world.fileBytes));
        }
        const [source] = createWorkspaceBindings({
            bindings: [{ name: naming.sourceBinding, root: naming.sourceBinding }],
            workspaceRoot,
        }).bindings as readonly [WorkspaceBinding];
        const grant: ScopeResourceGrant = {
            atoms: SCOPE_AUTHORITY_ATOMS,
            resource_id: source.binding_id,
            resource_kind: WORKSPACE_RESOURCE_KIND,
        };
        const store = new SQLiteTraceStore(path.join(workspaceRoot, STORE_FILE));
        const root = registerRootScope(store, {
            authority: { ceiling: [grant], grant: [grant] },
            commandId: this.#command("root"),
        });
        const rootWriter = claimScopeWriter(store, {
            claimId: `${naming.claimPrefix}root`,
            nowMilliseconds: naming.logicalTimeMilliseconds,
            scopeId: root.scope_id,
        });
        return {
            carrier: createReferenceCopyCarrier({
                backend: backend as WorldCarrierBackend,
                workspaceRoot,
            }),
            grant,
            rootScopeId: root.scope_id,
            rootWriter,
            source,
            store,
            workspaceRoot,
        };
    }

    #close(workspace: BenchWorkspace): void {
        workspace.store.close();
        rmSync(workspace.workspaceRoot, { force: true, recursive: true });
    }

    #directory(label: string): string {
        const directory = path.join(this.root, `${label}-${this.#next()}`);
        mkdirSync(directory);
        return directory;
    }

    #command(kind: string): string {
        return `${this.configuration.naming.commandPrefix}${kind}:${this.#next()}`;
    }

    #next(): number {
        this.#sequence += 1;
        return this.#sequence;
    }

    #freeBytes(directory: string): number {
        const [executable, ...args] = this.configuration.storage.flushCommand;
        execFileSync(executable as string, args);
        const status = statfsSync(directory);
        return status.bavail * status.bsize;
    }

    /** Waits until freed extents of earlier samples stop returning, then reads free space. */
    #settledFreeBytes(directory: string): number {
        const { settleAttempts, settleDelayMilliseconds, settleToleranceBytes } =
            this.configuration.storage;
        let previous = this.#freeBytes(directory);
        for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
            Atomics.wait(SETTLE_SIGNAL, 0, 0, settleDelayMilliseconds);
            const current = this.#freeBytes(directory);
            const settled = Math.abs(current - previous) <= settleToleranceBytes;
            previous = current;
            if (settled) break;
        }
        return previous;
    }
}

function headOf(store: SQLiteTraceStore, scopeId: string): string {
    return inspectScope(store, scopeId)?.head.record_id as string;
}

function fileName(label: string): string {
    return `${createHash("sha256").update(label).digest("hex").slice(0, 16)}.bin`;
}

function contentOf(seed: string, bytes: number): Buffer {
    const output = Buffer.allocUnsafe(bytes);
    let block = createHash("sha256").update(seed).digest();
    for (let offset = 0; offset < bytes; offset += block.length) {
        block.copy(output, offset);
        block = createHash("sha256").update(block).digest();
    }
    return output;
}

function writeDurably(target: string, content: Buffer): void {
    const descriptor = openSync(target, "wx", 0o644);
    try {
        writeSync(descriptor, content);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function storeBytes(workspaceRoot: string): number {
    return readdirSync(workspaceRoot)
        .filter((name) => name.startsWith(STORE_FILE))
        .reduce((total, name) => total + lstatSync(path.join(workspaceRoot, name)).size, 0);
}

function allocatedBytes(directory: string): number {
    let total = 0;
    for (const entry of readdirSync(directory, { recursive: true })) {
        total += lstatSync(path.join(directory, String(entry))).blocks * 512;
    }
    return total;
}

function round(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
