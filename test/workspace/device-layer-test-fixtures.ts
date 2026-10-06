import { spawn } from "node:child_process";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../fixtures/device-layer-kill-process.ts", import.meta.url));

/** Kills a real worker only after the requested physical stage reports that it was entered. */
export async function killDeviceLayerWorker(
    context: TestContext,
    directory: string,
    adapter: string,
    point: string,
): Promise<void> {
    const child = spawn(process.execPath, [worker, directory, adapter, point], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => child.kill("SIGKILL"));
    let stderr = "";
    let stdout = "";
    let ready = false;
    child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`worker timeout: ${stderr}`));
        }, 30_000);
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.includes("READY")) {
                ready = true;
                child.kill("SIGKILL");
            }
        });
        child.on("exit", (_code, signal) => {
            clearTimeout(timeout);
            if (!ready || signal !== "SIGKILL")
                reject(new Error(`worker did not reach ${point}: ${stderr}`));
            else resolve();
        });
    });
}
