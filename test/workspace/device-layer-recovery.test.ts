import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "../replay/fixtures.ts";

const worker = fileURLToPath(
    new URL("../fixtures/device-layer-recovery-process.ts", import.meta.url),
);

test("retained device layers reopen in a fresh process with named layers and writable state", async (context) => {
    const directory = await temporaryDirectory(context, "device-recovery-restart");
    execFileSync(process.execPath, [worker, "capture", directory]);
    const result = JSON.parse(
        execFileSync(process.execPath, [worker, "restore", directory], { encoding: "utf8" }),
    ) as { status: string; restored: string };
    assert.equal(result.status, "ready");
    assert.equal(result.restored, "one");
});
