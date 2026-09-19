import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
    ROOT_WITNESS_ID,
    type SQLiteTraceStore,
    type StoreAppendRequest,
} from "../../src/index.ts";
import { createPrng, deriveSeed } from "../support/prng.ts";

/** Repository root resolved from this module. */
export const repositoryRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

/** Inclusive integer range from configuration. */
export type IntegerRange = { readonly max: number; readonly min: number };

/** Operations a killed child writer loops over. */
export type FaultOperation = "append" | "backup" | "blob" | "cut" | "import" | "vacuum";

/** The `faults` section of `config/hardening-suites.config.json`. */
export type FaultSettings = {
    readonly corruption: {
        readonly bytesPerFlip: IntegerRange;
        readonly pageFlipCases: number;
        readonly walCases: number;
    };
    readonly diskFull: {
        readonly fileSizeLimitBlocks: number;
        readonly headroomPages: number;
        readonly unlimitedPageCount: number;
        readonly volume: {
            readonly fillBlobBytes: number;
            readonly sizeMegabytes: number;
        };
    };
    readonly processKill: {
        readonly cyclesPerOperation: number;
        readonly killDelayMilliseconds: IntegerRange;
        readonly operations: readonly FaultOperation[];
        readonly readyTimeoutMilliseconds: number;
    };
    readonly seedEnvironmentVariable: string;
    readonly seeds: readonly number[];
    readonly testTimeoutMilliseconds: number;
    readonly workload: {
        readonly blobBytes: IntegerRange;
        readonly owners: number;
        readonly recordBodyBytes: IntegerRange;
        readonly recordsPerAppend: IntegerRange;
    };
};

/** The `soak` section of `config/hardening-suites.config.json`. */
export type SoakSettings = {
    readonly boundedOperations: number;
    readonly defaultDurationSeconds: number;
    readonly every: {
        readonly backup: number;
        readonly invariants: number;
        readonly kill: number;
        readonly maintenance: number;
        readonly telemetry: number;
    };
    readonly maintenanceModes: readonly ("checkpoint" | "inspect" | "optimize" | "vacuum")[];
    readonly retainedBackups: number;
    readonly seed: number;
    readonly testTimeoutMilliseconds: number;
    readonly weights: { readonly append: number; readonly blob: number; readonly cut: number };
};

const hardeningConfig = JSON.parse(
    readFileSync(path.join(repositoryRoot, "config/hardening-suites.config.json"), "utf8"),
) as { readonly faults: FaultSettings; readonly soak: SoakSettings };

/** Loaded fault settings. */
export const faultSettings = hardeningConfig.faults;

/** Loaded soak settings. */
export const soakSettings = hardeningConfig.soak;

/** Run seeds, honoring the configured environment override. */
export function faultSeeds(): readonly number[] {
    const override = process.env[faultSettings.seedEnvironmentVariable];
    return override === undefined ? faultSettings.seeds : [Number(override)];
}

/** Uniform integer in an inclusive configured range. */
export function inRange(next: () => number, range: IntegerRange): number {
    return range.min + Math.floor(next() * (range.max - range.min + 1));
}

/** Owner path for one workload owner index. */
export function ownerFor(index: number): string {
    return `run:fault:owner:${index}`;
}

/**
 * Deterministic append request for one label and index. The same arguments always produce the
 * same request, so a parent can retry exactly what a killed child attempted.
 */
export function appendRequestFor(seed: number, label: string, index: number): StoreAppendRequest {
    const random = createPrng(deriveSeed(seed, `append:${label}`, index));
    const settings = faultSettings.workload;
    const owner = ownerFor(random.int(settings.owners));
    const count = inRange(random.next, settings.recordsPerAppend);
    const records = Array.from({ length: count }, (_, position) => ({
        body: {
            index,
            label,
            padding: "p".repeat(inRange(random.next, settings.recordBodyBytes)),
            position,
        },
        mode: "capture" as const,
        schema_ref: "example.fault.v1",
        witness_ref: ROOT_WITNESS_ID,
    }));
    return {
        append_intent_id: `intent:fault:${label}:${index}`,
        batch: { groups: [{ owner_id: owner, records }] },
    };
}

/** Deterministic blob bytes for one label and index. */
export function blobContentFor(seed: number, label: string, index: number): Uint8Array {
    const random = createPrng(deriveSeed(seed, `blob:${label}`, index));
    const length = inRange(random.next, faultSettings.workload.blobBytes);
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 1) bytes[offset] = random.int(256);
    return bytes;
}

/** Configured content identifier of blob bytes. */
export function blobIdOf(content: Uint8Array): string {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Cut identity published for one label and index. */
export function cutIdFor(label: string, index: number): string {
    return `cut:fault:${label}:${index}`;
}

/** Health of one reopened store: every check a restart must pass. */
export type StoreHealth = {
    readonly blobsOk: boolean;
    readonly integrityOk: boolean;
    readonly issues: readonly string[];
    readonly quickCheckOk: boolean;
};

/** Runs `verifyIntegrity`, `verifyBlobs`, and `maintain` inspect on an open store. */
export function inspectHealth(store: SQLiteTraceStore): StoreHealth {
    const integrity = store.verifyIntegrity();
    const blobs = store.verifyBlobs();
    const quickCheck = store.maintain().quick_check;
    return {
        blobsOk: blobs.ok,
        integrityOk: integrity.ok,
        issues: [
            ...integrity.issues.map((issue) => `${issue.kind}:${issue.subject_id}`),
            ...blobs.issues.map((issue) => `blob:${issue.kind}:${issue.blob_id}`),
            ...quickCheck.issues.map((issue) => `quick_check:${issue}`),
        ],
        quickCheckOk: quickCheck.ok,
    };
}

/** One JSON event line written by the fault child. */
export type FaultEvent =
    | { readonly event: "ready" }
    | { readonly event: "start"; readonly index: number }
    | { readonly event: "done"; readonly index: number }
    | {
          readonly errcode: number | null;
          readonly code: string | null;
          readonly event: "error";
          readonly index: number;
          readonly message: string;
          readonly name: string;
      };

/** Arguments of `test/fixtures/fault-process.ts`. */
export type FaultProcessArguments = {
    readonly archivePath?: string;
    readonly backupRoot?: string;
    readonly databasePath: string;
    readonly importRoot?: string;
    readonly label: string;
    readonly operation: FaultOperation;
    readonly seed: number;
    readonly stopAfterError?: boolean;
};

/** Result of one child run. */
export type FaultProcessResult = {
    readonly events: readonly FaultEvent[];
    readonly signal: NodeJS.Signals | null;
    readonly status: number | null;
    readonly stderr: string;
};

const FAULT_PROCESS = fileURLToPath(new URL("../fixtures/fault-process.ts", import.meta.url));

/**
 * Starts the looping fault child and resolves when it exits. `killAfterReady` sends SIGKILL the
 * given number of milliseconds after the child reports `ready`; `fileSizeLimitBlocks` launches it
 * through `/bin/sh` under `ulimit -f`.
 */
export async function runFaultProcess(
    args: FaultProcessArguments,
    options: {
        readonly fileSizeLimitBlocks?: number;
        readonly killAfterReady?: number;
        readonly temporaryDirectory?: string;
    } = {},
): Promise<FaultProcessResult> {
    const nodeArguments = [FAULT_PROCESS, JSON.stringify(args)];
    const spawnOptions = {
        env:
            options.temporaryDirectory === undefined
                ? process.env
                : { ...process.env, TMPDIR: options.temporaryDirectory },
        stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    };
    const child =
        options.fileSizeLimitBlocks === undefined
            ? spawn(process.execPath, nodeArguments, spawnOptions)
            : spawn(
                  "/bin/sh",
                  [
                      "-c",
                      `ulimit -f ${options.fileSizeLimitBlocks} && exec "$0" "$@"`,
                      process.execPath,
                      ...nodeArguments,
                  ],
                  spawnOptions,
              );
    const events: FaultEvent[] = [];
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
    });
    const exited = new Promise<{ signal: NodeJS.Signals | null; status: number | null }>(
        (resolve) => {
            child.on("close", (status, signal) => resolve({ signal, status }));
        },
    );
    let readyTimer: NodeJS.Timeout | undefined;
    const readyDeadline = setTimeout(() => {
        child.kill("SIGKILL");
    }, faultSettings.processKill.readyTimeoutMilliseconds);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
        const event = JSON.parse(line) as FaultEvent;
        events.push(event);
        if (event.event === "ready") {
            clearTimeout(readyDeadline);
            if (options.killAfterReady !== undefined) {
                readyTimer = setTimeout(() => child.kill("SIGKILL"), options.killAfterReady);
            }
        }
    });
    const { signal, status } = await exited;
    clearTimeout(readyDeadline);
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    if (!events.some((event) => event.event === "ready")) {
        throw new Error(
            `fault child never became ready (status ${status}, signal ${signal}): ${stderr}`,
        );
    }
    return { events, signal, status, stderr };
}

/** Indices the child started, in order. */
export function startedIndices(events: readonly FaultEvent[]): readonly number[] {
    return events.flatMap((event) => (event.event === "start" ? [event.index] : []));
}

/** Indices whose operation returned before the kill. */
export function completedIndices(events: readonly FaultEvent[]): ReadonlySet<number> {
    return new Set(events.flatMap((event) => (event.event === "done" ? [event.index] : [])));
}
