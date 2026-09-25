import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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

/**
 * Operations a killed child writer loops over. `compensation` compensates one prepared
 * materialized effect per index and is driven only by the compensation kill suite.
 */
export type FaultOperation =
    | "append"
    | "backup"
    | "blob"
    | "compensation"
    | "cut"
    | "import"
    | "vacuum";

/** The `faults` section of `config/hardening-suites.config.json`. */
export type FaultSettings = {
    readonly corruption: {
        readonly bytesPerFlip: IntegerRange;
        readonly pageFlipCases: number;
        readonly walCases: number;
    };
    readonly diskFull: {
        readonly fileSizeLimitBytes: number;
        readonly headroomPages: number;
        readonly unlimitedPageCount: number;
        readonly volume: {
            readonly fillBlobBytes: number;
            /** macOS variant: an HFS+ disk image of `sizeMegabytes`, attached without privileges. */
            readonly macos: {
                /** Command and arguments that attach the image; mount point and image are appended. */
                readonly attach: readonly string[];
                /** Command and arguments that create the image; size (`<n>m`) and path are appended. */
                readonly create: readonly string[];
                /** Command and arguments that detach the image; the mount point is appended. */
                readonly detach: readonly string[];
                /** Command and arguments that detach a busy image; the mount point is appended. */
                readonly forceDetach: readonly string[];
                /** File name of the disk image inside the suite's temporary directory. */
                readonly imageFileName: string;
                /** Commands that must exit 0 for the variant to run. */
                readonly probes: readonly (readonly string[])[];
            };
            /** Linux variant: a loop-mounted image of `sizeMegabytes`, run as root. */
            readonly linux: {
                /** Command and arguments that detach a busy mount; the mount point is appended. */
                readonly forceUnmount: readonly string[];
                /** File name of the sparse image inside the suite's temporary directory. */
                readonly imageFileName: string;
                /** Device whose absence means loop devices are unavailable (unprivileged container). */
                readonly loopControlDevice: string;
                /** Command and arguments that format the image; the image path is appended. */
                readonly makeFileSystem: readonly string[];
                /** Command and arguments that mount the image; image and mount point are appended. */
                readonly mount: readonly string[];
                /** Commands that must exit 0 for the variant to run. */
                readonly probes: readonly (readonly string[])[];
                /** Command and arguments that detach the mount; the mount point is appended. */
                readonly unmount: readonly string[];
            };
            readonly sizeMegabytes: number;
        };
    };
    readonly processKill: {
        /** Compensation kill suite: kill cycles and prepared compensable effects. */
        readonly compensation: { readonly cycles: number; readonly effects: number };
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
    /** Row-world database of the `compensation` operation. */
    readonly worldPath?: string;
};

/** Result of one child run. */
export type FaultProcessResult = {
    readonly events: readonly FaultEvent[];
    readonly signal: NodeJS.Signals | null;
    readonly status: number | null;
    readonly stderr: string;
};

const FAULT_PROCESS = fileURLToPath(new URL("../fixtures/fault-process.ts", import.meta.url));
const FILE_SIZE_UNIT_PROBE = fileURLToPath(
    new URL("../fixtures/file-size-unit-probe.ts", import.meta.url),
);
const POSIX_SHELL = "/bin/sh";

// Node.js writes a child's V8 coverage to the directory named here when the child exits. A child
// under RLIMIT_FSIZE would truncate that file at the limit and break the parent's coverage report.
// `child_process` copies the parent's value into any spawn environment that lacks the key, so it
// is disabled by setting it to the empty string rather than by removing it.
const V8_COVERAGE_ENVIRONMENT_VARIABLE = "NODE_V8_COVERAGE";

let fileSizeUnit: Promise<number> | undefined;

/**
 * Byte size of one `ulimit -f` unit of `/bin/sh`, measured once per process.
 *
 * The unit is shell dependent: dash and bash 5 in POSIX mode count 512-byte blocks, while the
 * bash 3.2 that macOS ships as `/bin/sh` counts 1024-byte blocks. The probe runs a child under
 * `ulimit -f 1` and counts the bytes it can write before `EFBIG`.
 *
 * @param capBytes - Largest unit accepted; a probe that writes more fails the measurement.
 * @returns The unit in bytes.
 * @throws {Error} If the probe fails or reports a non-positive or oversized unit.
 */
export function fileSizeLimitUnitBytes(capBytes: number): Promise<number> {
    fileSizeUnit ??= promisify(execFile)(
        POSIX_SHELL,
        [
            "-c",
            'ulimit -f 1 && exec "$0" "$@"',
            process.execPath,
            FILE_SIZE_UNIT_PROBE,
            tmpdir(),
            String(capBytes),
        ],
        { env: withoutCoverage(process.env) },
    ).then(({ stdout }) => {
        const unit = Number(stdout.trim());
        if (!Number.isSafeInteger(unit) || unit <= 0 || unit > capBytes) {
            throw new Error(`ulimit -f unit probe reported ${JSON.stringify(stdout)}`);
        }
        return unit;
    });
    return fileSizeUnit;
}

async function fileSizeLimitScript(limitBytes: number): Promise<string> {
    const unit = await fileSizeLimitUnitBytes(limitBytes);
    if (limitBytes % unit !== 0) {
        throw new Error(`file-size limit ${limitBytes} is not a multiple of the ${unit}-byte unit`);
    }
    return `ulimit -f ${limitBytes / unit} && exec "$0" "$@"`;
}

function withoutCoverage(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...environment, [V8_COVERAGE_ENVIRONMENT_VARIABLE]: "" };
}

/**
 * Starts the looping fault child and resolves when it exits. `killAfterReady` sends SIGKILL the
 * given number of milliseconds after the child reports `ready`; `fileSizeLimitBytes` launches it
 * through `/bin/sh` under `ulimit -f`, converted to the shell's measured unit (the limit must be a
 * whole number of units), and without V8 coverage output, which the limit would truncate.
 */
export async function runFaultProcess(
    args: FaultProcessArguments,
    options: {
        readonly fileSizeLimitBytes?: number;
        readonly killAfterReady?: number;
        readonly temporaryDirectory?: string;
    } = {},
): Promise<FaultProcessResult> {
    const nodeArguments = [FAULT_PROCESS, JSON.stringify(args)];
    const environment =
        options.temporaryDirectory === undefined
            ? process.env
            : { ...process.env, TMPDIR: options.temporaryDirectory };
    const stdio = ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"];
    const limitScript =
        options.fileSizeLimitBytes === undefined
            ? undefined
            : await fileSizeLimitScript(options.fileSizeLimitBytes);
    const child =
        limitScript === undefined
            ? spawn(process.execPath, nodeArguments, { env: environment, stdio })
            : spawn(POSIX_SHELL, ["-c", limitScript, process.execPath, ...nodeArguments], {
                  env: withoutCoverage(environment),
                  stdio,
              });
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

/** Command identity of the replay session whose effects the `compensation` operation compensates. */
export const COMPENSATION_SESSION_COMMAND = "session:fault:compensation";

/** Command identity compensating one prepared effect. */
export function compensationCommandFor(label: string, index: number): string {
    return `compensate:fault:${label}:${index}`;
}
