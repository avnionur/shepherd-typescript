import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPrng, deriveSeed, type Prng } from "../support/prng.ts";
import {
    configuredNumber,
    type MutationSettings,
    mutateText,
    mutateValue,
    nestText,
    nestValue,
} from "./mutators.ts";

/** Repository root resolved from this module. */
export const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

type TierSettings = {
    readonly defaultIterations: number;
    readonly iterations: Readonly<Record<string, number>>;
};

/** The `fuzz` section of `config/hardening-suites.config.json`. */
export type FuzzSettings = {
    readonly caseBudgetMilliseconds: number;
    readonly corpusDirectory: string;
    readonly defaultTier: string;
    readonly iterationsEnvironmentVariable: string;
    readonly mutation: MutationSettings;
    readonly seedEnvironmentVariable: string;
    readonly seeds: readonly number[];
    readonly targets: Readonly<
        Record<string, { readonly allowedErrors: readonly string[]; readonly skip?: string }>
    >;
    readonly testTimeoutMilliseconds: number;
    readonly tierEnvironmentVariable: string;
    readonly tiers: Readonly<Record<string, TierSettings>>;
};

/** Loaded fuzz settings. */
export const fuzzSettings = (
    JSON.parse(
        readFileSync(path.join(repositoryRoot, "config/hardening-suites.config.json"), "utf8"),
    ) as { readonly fuzz: FuzzSettings }
).fuzz;

/** One fuzz input: JSON text or a JSON-shaped value (including argv string arrays). */
export type FuzzInput =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "value"; readonly value: unknown };

/** A prepared target: seeds plus an executor and an acceptance oracle. */
export type PreparedTarget = {
    /** Well-formed seed inputs; every seed must be accepted. */
    readonly seeds: readonly FuzzInput[];
    /** Optional custom generator replacing the default seed mutation. */
    readonly generate?: (random: Prng, seed: FuzzInput) => FuzzInput;
    /** Runs the unit under test; the result is handed to `verifyAccepted`. */
    readonly execute: (input: FuzzInput) => unknown;
    /** Asserts canonical, stable re-encoding of an accepted result; throws on violation. */
    readonly verifyAccepted: (result: unknown, input: FuzzInput) => void | Promise<void>;
    /** Releases temporary resources. */
    readonly dispose?: () => void | Promise<void>;
};

/** A named fuzz target. */
export type FuzzTarget = {
    /** Configuration key in `fuzz.targets`. */
    readonly name: string;
    /** Prepares seeds and resources; may return a skip reason when the host cannot run it. */
    readonly prepare: () => Promise<PreparedTarget | { readonly skip: string }>;
};

/** Outcome of one fuzz case. */
export type CaseOutcome =
    | { readonly status: "accepted" }
    | { readonly status: "rejected"; readonly error: string }
    | { readonly status: "finding"; readonly reason: string };

/** Summary of one target run. */
export type TargetReport = {
    readonly accepted: number;
    readonly cases: number;
    readonly durationMilliseconds: number;
    readonly findings: readonly {
        readonly case: number;
        readonly input: string;
        readonly reason: string;
    }[];
    readonly rejected: Readonly<Record<string, number>>;
    readonly seed: number;
    readonly skipped?: string;
    readonly target: string;
};

const PROTOTYPES: readonly [string, object][] = [
    ["Object.prototype", Object.prototype],
    ["Array.prototype", Array.prototype],
    ["Function.prototype", Function.prototype],
    ["String.prototype", String.prototype],
];
const prototypeBaseline = snapshotPrototypes();

function snapshotPrototypes(): string {
    return PROTOTYPES.map(
        ([name, prototype]) => `${name}:${Reflect.ownKeys(prototype).map(String).sort().join(",")}`,
    ).join("|");
}

/** Resolves the tier, seed override, and iteration count for one target. */
export function resolveRun(
    targetName: string,
    overrides: {
        readonly iterations?: number;
        readonly seeds?: readonly number[];
        readonly tier?: string;
    } = {},
): { readonly iterations: number; readonly seeds: readonly number[]; readonly tier: string } {
    const tier =
        overrides.tier ??
        process.env[fuzzSettings.tierEnvironmentVariable] ??
        fuzzSettings.defaultTier;
    const settings = fuzzSettings.tiers[tier];
    if (settings === undefined) throw new TypeError(`unknown fuzz tier: ${tier}`);
    const seedOverride = process.env[fuzzSettings.seedEnvironmentVariable];
    const iterationOverride = process.env[fuzzSettings.iterationsEnvironmentVariable];
    return {
        iterations:
            overrides.iterations ??
            (iterationOverride === undefined ? undefined : Number(iterationOverride)) ??
            settings.iterations[targetName] ??
            settings.defaultIterations,
        seeds:
            overrides.seeds ??
            (seedOverride === undefined ? fuzzSettings.seeds : [Number(seedOverride)]),
        tier,
    };
}

/** Classifies one execution against the shared oracle. */
export async function runCase(
    target: string,
    prepared: PreparedTarget,
    input: FuzzInput,
): Promise<CaseOutcome> {
    const allowed = fuzzSettings.targets[target]?.allowedErrors;
    if (allowed === undefined) throw new TypeError(`fuzz target ${target} is not configured`);
    const budget = fuzzSettings.caseBudgetMilliseconds;
    const started = performance.now();
    let outcome: CaseOutcome;
    let timer: NodeJS.Timeout | undefined;
    try {
        const result = await Promise.race([
            Promise.resolve().then(() => prepared.execute(input)),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new FuzzTimeout()), budget);
            }),
        ]);
        try {
            await prepared.verifyAccepted(result, input);
            outcome = { status: "accepted" };
        } catch (error) {
            outcome = {
                status: "finding",
                reason: `accepted input violates the re-encoding oracle: ${describe(error)}`,
            };
        }
    } catch (error) {
        if (error instanceof FuzzTimeout) {
            outcome = { status: "finding", reason: `no result within ${budget} ms` };
        } else if (!(error instanceof Error)) {
            outcome = { status: "finding", reason: `non-Error throw: ${String(error)}` };
        } else if (!allowed.includes(error.constructor.name)) {
            outcome = { status: "finding", reason: `disallowed ${describe(error)}` };
        } else {
            outcome = { status: "rejected", error: error.constructor.name };
        }
    } finally {
        clearTimeout(timer);
    }
    const elapsed = performance.now() - started;
    if (outcome.status !== "finding" && elapsed > budget) {
        outcome = {
            status: "finding",
            reason: `case took ${Math.round(elapsed)} ms (budget ${budget} ms)`,
        };
    }
    if (snapshotPrototypes() !== prototypeBaseline) {
        outcome = { status: "finding", reason: "built-in prototype changed" };
    }
    return outcome;
}

class FuzzTimeout extends Error {}

function describe(error: unknown): string {
    return error instanceof Error
        ? `${error.constructor.name}: ${error.message.slice(0, 300)} at ${(error.stack ?? "").split("\n").slice(1, 3).join(" <- ").trim()}`
        : String(error);
}

/** Generates one mutated input from a seed. */
export function generateInput(prepared: PreparedTarget, random: Prng): FuzzInput {
    const seed = random.pick(prepared.seeds);
    try {
        if (prepared.generate !== undefined) return prepared.generate(random, seed);
        return seed.kind === "text"
            ? { kind: "text", text: mutateText(seed.text, random, fuzzSettings.mutation) }
            : { kind: "value", value: mutateValue(seed.value, random, fuzzSettings.mutation) };
    } catch {
        // A mutator can itself exceed the call stack on deeply nested intermediate values.
        return seed.kind === "text"
            ? { kind: "text", text: seed.text.slice(0, random.int(seed.text.length)) }
            : { kind: "value", value: nestValue(64, "array", null) };
    }
}

/** Runs seeds (which must be accepted) and `iterations` mutated cases per configured seed. */
export async function fuzzTarget(
    target: FuzzTarget,
    options: {
        readonly iterations?: number;
        readonly seeds?: readonly number[];
        readonly tier?: string;
    } = {},
): Promise<readonly TargetReport[]> {
    const configured = fuzzSettings.targets[target.name];
    if (configured === undefined)
        throw new TypeError(`fuzz target ${target.name} is not configured`);
    const run = resolveRun(target.name, options);
    if (configured.skip !== undefined) {
        return run.seeds.map((seed) => emptyReport(target.name, seed, configured.skip as string));
    }
    const prepared = await target.prepare();
    if ("skip" in prepared) {
        return run.seeds.map((seed) => emptyReport(target.name, seed, prepared.skip));
    }
    const reports: TargetReport[] = [];
    try {
        for (const seed of run.seeds) {
            const started = performance.now();
            const findings: { case: number; input: string; reason: string }[] = [];
            const rejected: Record<string, number> = {};
            let accepted = 0;
            for (const [index, input] of prepared.seeds.entries()) {
                const outcome = await runCase(target.name, prepared, input);
                if (outcome.status !== "accepted") {
                    findings.push({
                        case: -1 - index,
                        input: preview(input),
                        reason: `well-formed seed was not accepted: ${outcome.status === "finding" ? outcome.reason : outcome.error}`,
                    });
                }
            }
            for (let index = 0; index < run.iterations; index += 1) {
                const random = createPrng(deriveSeed(seed, target.name, index));
                const input = generateInput(prepared, random);
                const outcome = await runCase(target.name, prepared, input);
                if (outcome.status === "accepted") accepted += 1;
                else if (outcome.status === "rejected")
                    rejected[outcome.error] = (rejected[outcome.error] ?? 0) + 1;
                else findings.push({ case: index, input: preview(input), reason: outcome.reason });
            }
            reports.push({
                accepted,
                cases: run.iterations,
                durationMilliseconds: Math.round(performance.now() - started),
                findings,
                rejected,
                seed,
                target: target.name,
            });
        }
    } finally {
        await prepared.dispose?.();
    }
    return reports;
}

function emptyReport(target: string, seed: number, skipped: string): TargetReport {
    return {
        accepted: 0,
        cases: 0,
        durationMilliseconds: 0,
        findings: [],
        rejected: {},
        seed,
        skipped,
        target,
    };
}

function preview(input: FuzzInput): string {
    let text: string;
    try {
        text = input.kind === "text" ? input.text : JSON.stringify(input.value);
    } catch {
        text = "<unserializable value>";
    }
    return text.length > 400 ? `${text.slice(0, 400)}... (${text.length} characters)` : text;
}

/** One stored regression case under `test/fixtures/fuzz-corpus/<target>/`. */
export type CorpusCase = {
    readonly description: string;
    readonly expect: { readonly outcome: "accepted" | "rejected"; readonly error?: string };
    readonly finding?: string;
    readonly input:
        | { readonly text: string | readonly TextSegment[] }
        | { readonly value: unknown }
        | {
              /** Index of one of the target's well-formed text seeds. */
              readonly seed: number;
              /** Ordered first-occurrence replacements applied to the seed text. */
              readonly replace: readonly {
                  readonly from: string;
                  readonly to: string | readonly TextSegment[];
              }[];
          };
};

type TextSegment =
    | { readonly literal: string }
    | { readonly repeat: string; readonly count: number };

function expandSegments(text: string | readonly TextSegment[]): string {
    return typeof text === "string"
        ? text
        : text
              .map((segment) =>
                  "literal" in segment ? segment.literal : segment.repeat.repeat(segment.count),
              )
              .join("");
}

/** Lists corpus cases grouped by target directory. */
export function readCorpus(): readonly {
    readonly file: string;
    readonly target: string;
    readonly entry: CorpusCase;
}[] {
    const root = path.join(repositoryRoot, fuzzSettings.corpusDirectory);
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((directory) =>
            readdirSync(path.join(root, directory.name))
                .filter((file) => file.endsWith(".json"))
                .sort()
                .map((file) => ({
                    entry: JSON.parse(
                        readFileSync(path.join(root, directory.name, file), "utf8"),
                    ) as CorpusCase,
                    file: `${directory.name}/${file}`,
                    target: directory.name,
                })),
        );
}

/**
 * Materializes one corpus input: literal or segmented text, a seed with replacements, or a value
 * with `$fuzz` markers for non-JSON numbers, deep nesting, and oversized strings.
 */
export function corpusInput(entry: CorpusCase, prepared: PreparedTarget): FuzzInput {
    if ("text" in entry.input) return { kind: "text", text: expandSegments(entry.input.text) };
    if ("seed" in entry.input) {
        const seed = prepared.seeds[entry.input.seed];
        if (seed?.kind !== "text") throw new TypeError("corpus seed must be a text seed");
        let text = seed.text;
        for (const { from, to } of entry.input.replace) {
            if (!text.includes(from)) throw new TypeError(`corpus seed does not contain ${from}`);
            text = text.replace(from, () => expandSegments(to));
        }
        return { kind: "text", text };
    }
    return { kind: "value", value: reviveMarkers(entry.input.value) };
}

function reviveMarkers(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reviveMarkers);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.$fuzz === "string") {
        switch (record.$fuzz) {
            case "number":
                return configuredNumber(record.spelling as string);
            case "nest":
                return nestValue(
                    record.depth as number,
                    record.kind as "array" | "object",
                    reviveMarkers(record.leaf),
                );
            case "nest-text":
                return nestText(record.depth as number, record.kind as "array" | "object");
            case "repeat":
                return (record.text as string).repeat(record.count as number);
            default:
                throw new TypeError(`unknown corpus marker ${record.$fuzz}`);
        }
    }
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        Object.defineProperty(copy, key, {
            configurable: true,
            enumerable: true,
            value: reviveMarkers(child),
            writable: true,
        });
    }
    return copy;
}
