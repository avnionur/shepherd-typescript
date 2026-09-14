import { spawn } from "node:child_process";

import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { replayProtocolConfig } from "../protocol/config.ts";
import { REPLAY_PROCESS_BACKENDS } from "../protocol/values.generated.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type {
    ReplayProcessAdapter,
    ReplayProcessCheckpointContext,
    ReplayProcessProbe,
} from "./types.ts";

const [COOPERATIVE_BACKEND, TRANSPARENT_BACKEND] = REPLAY_PROCESS_BACKENDS;
const cooperative = replayProtocolConfig.processes.cooperative;
const transparent = replayProtocolConfig.processes.transparent;
const types = cooperative.messageTypes;

/** Options for {@link createCooperativeProcessAdapter}. */
export type CooperativeProcessAdapterOptions = {
    /** Arguments passed to the executable without a shell. */
    readonly args?: readonly string[];
    /** Executable started for the process and for every restore. */
    readonly command: string;
    /** Working directory of the process. */
    readonly cwd?: string;
    /** Stable process identity within the session. */
    readonly processId: string;
    /** Response timeout; defaults to and may not exceed the configured cooperative timeout. */
    readonly timeoutMilliseconds?: number;
};

/** Cooperative process adapter with an application request channel. */
export type CooperativeProcessAdapter = ReplayProcessAdapter & {
    /**
     * Stops the current process, if any.
     *
     * @returns Completion after the process exits.
     */
    readonly close: () => Promise<void>;
    /**
     * Sends one application request to the current process, starting it when needed.
     *
     * @param payload - Canonical request payload.
     * @returns The canonical response payload.
     * @throws {Error} If the process fails, exits, times out, or violates the protocol.
     */
    readonly request: (payload: SemanticValue) => Promise<SemanticValue>;
};

/** Options for {@link createTransparentProcessAdapter}. */
export type TransparentProcessAdapterOptions = {
    /** Stable process identity within the session. */
    readonly processId: string;
};

/**
 * Creates a process adapter that checkpoints a cooperating child process.
 *
 * The child speaks newline-delimited JSON on standard input and output. Every request carries the
 * configured protocol version, a message type, and a correlation number. A checkpoint request is
 * answered with an image message holding base64 state bytes; a restore request carries those bytes
 * to a freshly started process and is answered with a restored message; application requests are
 * answered with response messages; error messages fail the request. Responses are bounded by the
 * configured line size and timeout, and a process that exits, times out, or violates the protocol is
 * stopped. The image is captured by the process itself, so the backend is cooperative rather than
 * transparent.
 *
 * @param options - Process identity, executable, arguments, and working directory.
 * @returns A process adapter with request and close operations.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const worker = createCooperativeProcessAdapter({
 *     args: ["worker.js"],
 *     command: process.execPath,
 *     processId: "counter",
 * });
 * await worker.request({ op: "increment" });
 * ```
 */
export function createCooperativeProcessAdapter(
    options: CooperativeProcessAdapterOptions,
): CooperativeProcessAdapter {
    const fields = readScopeDataObject(
        options,
        ["command", "processId"],
        "createCooperativeProcessAdapter options",
        ["args", "cwd", "timeoutMilliseconds"],
    );
    const timeoutMilliseconds = fields.timeoutMilliseconds ?? cooperative.timeoutMilliseconds;
    if (
        !Number.isSafeInteger(timeoutMilliseconds) ||
        (timeoutMilliseconds as number) <= 0 ||
        (timeoutMilliseconds as number) > cooperative.timeoutMilliseconds
    ) {
        throw new TypeError("timeoutMilliseconds must be positive and within the configured bound");
    }
    assertScopeText(fields.processId, "processId");
    assertScopeText(fields.command, "command");
    const args = readScopeArray(fields.args ?? [], "args").map((argument, index) => {
        if (typeof argument !== "string") {
            throw new TypeError(`args[${index}] must be a string`);
        }
        return argument;
    });
    if (fields.cwd !== undefined) {
        assertScopeText(fields.cwd, "cwd");
    }
    const launch = Object.freeze({
        args: Object.freeze(args),
        command: fields.command,
        cwd: fields.cwd as string | undefined,
        timeoutMilliseconds: timeoutMilliseconds as number,
    });
    let channel: Promise<CooperativeChannel> | null = null;
    const current = async (): Promise<CooperativeChannel> => {
        const active = channel === null ? null : await channel.catch(() => null);
        if (active !== null && !active.exited) {
            return active;
        }
        const started = startChannel(launch);
        channel = started;
        return started;
    };
    const stop = async (): Promise<void> => {
        const active = channel;
        channel = null;
        await (await active?.catch(() => null))?.stop();
    };
    return Object.freeze({
        backend: COOPERATIVE_BACKEND,
        checkpoint: async (_context: ReplayProcessCheckpointContext) => {
            const message = await (await current()).send({ type: types.checkpoint }, types.image);
            if (typeof message.data !== "string") {
                throw new TypeError("cooperative image message must carry base64 data");
            }
            const image = Buffer.from(message.data, "base64");
            if (image.toString("base64") !== message.data) {
                throw new TypeError("cooperative image data must be canonical base64");
            }
            return new Uint8Array(image);
        },
        close: stop,
        probe: async (): Promise<ReplayProcessProbe> => {
            try {
                await current();
                return Object.freeze({ available: true });
            } catch {
                return Object.freeze({ available: false, reason: cooperative.spawnFailedReason });
            }
        },
        processId: fields.processId,
        request: async (payload: SemanticValue) => {
            const message = await (await current()).send(
                { payload: snapshot(payload), type: types.request },
                types.response,
            );
            return snapshot(message.payload as SemanticValue);
        },
        restore: async (image: Uint8Array, _context: ReplayProcessCheckpointContext) => {
            if (!(image instanceof Uint8Array)) {
                throw new TypeError("process image must be bytes");
            }
            await stop();
            await (await current()).send(
                { data: Buffer.from(image).toString("base64"), type: types.restore },
                types.restored,
            );
        },
    });
}

/**
 * Creates a transparent CRIU process adapter that reports host capability accurately.
 *
 * The probe refuses unsupported platforms, an executable that cannot be started, and a failing
 * configured host check, each with its configured reason. Replay protocol v1 does not capture
 * transparent process images, so a passing host check is still reported unavailable with the
 * configured capture-unsupported reason, and checkpoint and restore always fail.
 *
 * @param options - Process identity.
 * @returns A process adapter whose probe never claims transparent capture.
 * @throws {TypeError} If options are malformed.
 *
 * @example
 * ```ts
 * const probe = await createTransparentProcessAdapter({ processId: "tool" }).probe();
 * console.log(probe.available, "reason" in probe ? probe.reason : "");
 * ```
 */
export function createTransparentProcessAdapter(
    options: TransparentProcessAdapterOptions,
): ReplayProcessAdapter {
    const fields = readScopeDataObject(
        options,
        ["processId"],
        "createTransparentProcessAdapter options",
    );
    assertScopeText(fields.processId, "processId");
    const refuse = async (): Promise<never> => {
        throw new TypeError(transparent.captureUnsupportedReason);
    };
    return Object.freeze({
        backend: TRANSPARENT_BACKEND,
        checkpoint: refuse,
        probe: () => probeTransparentCheckpointing(process.platform, transparent.executable),
        processId: fields.processId,
        restore: refuse,
    });
}

/**
 * Probes transparent checkpoint capability for one platform and executable.
 *
 * @internal
 */
export async function probeTransparentCheckpointing(
    platform: string,
    executable: string,
): Promise<ReplayProcessProbe> {
    if (!transparent.platforms.includes(platform)) {
        return unavailable(`${transparent.platformUnsupportedReason}: ${platform}`);
    }
    const result = await new Promise<{ readonly code: number | null; readonly started: boolean }>(
        (resolve) => {
            const child = spawn(executable, transparent.checkArguments, {
                shell: false,
                stdio: "ignore",
                timeout: transparent.probeTimeoutMilliseconds,
            });
            child.once("error", () => resolve({ code: null, started: false }));
            child.once("exit", (code) => resolve({ code, started: true }));
        },
    );
    if (!result.started) {
        return unavailable(transparent.executableUnavailableReason);
    }
    return unavailable(
        result.code === 0
            ? transparent.captureUnsupportedReason
            : `${transparent.checkFailedReason}: exit ${result.code}`,
    );
}

type CooperativeMessage = Readonly<Record<string, unknown>>;

type CooperativeChannel = {
    readonly exited: boolean;
    readonly send: (
        message: Readonly<Record<string, unknown>>,
        expectedType: string,
    ) => Promise<CooperativeMessage>;
    readonly stop: () => Promise<void>;
};

async function startChannel(launch: {
    readonly args: readonly string[];
    readonly command: string;
    readonly cwd: string | undefined;
    readonly timeoutMilliseconds: number;
}): Promise<CooperativeChannel> {
    const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
    });
    await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
    });
    let exited = false;
    let buffer = "";
    let pending: {
        readonly id: number;
        readonly resolve: (message: CooperativeMessage) => void;
        readonly reject: (error: Error) => void;
    } | null = null;
    let nextId = 0;
    const fail = (error: Error) => {
        const waiting = pending;
        pending = null;
        waiting?.reject(error);
        if (!exited) {
            // The channel is unusable from here on, so the next request starts a fresh process.
            exited = true;
            child.kill("SIGKILL");
        }
    };
    child.once("exit", () => {
        fail(new Error("cooperative process exited"));
        exited = true;
    });
    // Input and late child errors must never become unhandled error events in the host.
    const onError = (error: Error) =>
        fail(new Error("cooperative process input closed", { cause: error }));
    child.on("error", onError);
    child.stdin?.on("error", onError);
    child.stdout?.setEncoding("utf8");
    let partialBytes = 0;
    child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        partialBytes += Buffer.byteLength(chunk, "utf8");
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            partialBytes = Buffer.byteLength(buffer, "utf8");
            if (Buffer.byteLength(line, "utf8") > cooperative.maxLineBytes) {
                fail(new Error("cooperative process line exceeds the configured bound"));
                return;
            }
            let message: CooperativeMessage;
            try {
                message = readScopeDataObject(
                    JSON.parse(line),
                    ["id", "type"],
                    "cooperative message",
                    ["data", "message", "payload"],
                ) as CooperativeMessage;
            } catch {
                fail(new Error("cooperative process sent a malformed message"));
                return;
            }
            const waiting = pending;
            if (waiting === null || message.id !== waiting.id) {
                fail(new Error("cooperative process sent an uncorrelated message"));
                return;
            }
            pending = null;
            waiting.resolve(message);
        }
        if (partialBytes > cooperative.maxLineBytes) {
            fail(new Error("cooperative process line exceeds the configured bound"));
        }
    });
    return {
        get exited() {
            return exited;
        },
        send: (message, expectedType) =>
            new Promise<CooperativeMessage>((resolve, reject) => {
                if (exited || pending !== null) {
                    reject(new Error("cooperative process is not ready for a request"));
                    return;
                }
                nextId += 1;
                const id = nextId;
                const timer = setTimeout(
                    () => fail(new Error("cooperative process response timed out")),
                    launch.timeoutMilliseconds,
                );
                pending = {
                    id,
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    },
                    resolve: (response) => {
                        clearTimeout(timer);
                        if (response.type === types.error) {
                            reject(
                                new Error(
                                    typeof response.message === "string"
                                        ? response.message
                                        : "cooperative process reported an error",
                                ),
                            );
                        } else if (response.type !== expectedType) {
                            fail(new Error("cooperative process sent an unexpected message type"));
                            reject(
                                new Error("cooperative process sent an unexpected message type"),
                            );
                        } else {
                            resolve(response);
                        }
                    },
                };
                child.stdin?.write(
                    `${JSON.stringify({ ...message, id, protocol_version: cooperative.protocolVersion })}\n`,
                );
            }),
        stop: () =>
            new Promise<void>((resolve) => {
                if (child.exitCode !== null || child.signalCode !== null) {
                    resolve();
                    return;
                }
                child.once("exit", () => resolve());
                child.kill("SIGKILL");
            }),
    };
}

function unavailable(reason: string): ReplayProcessProbe {
    return Object.freeze({ available: false, reason });
}

function snapshot(value: SemanticValue): SemanticValue {
    return (
        createCanonicalSnapshot({ value } as SemanticRecord) as { readonly value: SemanticValue }
    ).value;
}
