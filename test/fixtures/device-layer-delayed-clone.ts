import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const [executable, source, target, gate, result] = process.argv.slice(2);
assert.ok(executable && source && target && gate && result);
const deadline = Date.now() + 30_000;
while (!existsSync(gate) && Date.now() < deadline)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
assert.ok(existsSync(gate), "delayed clone gate expired");
try {
    execFileSync(executable, [source, target], { stdio: "ignore" });
    writeFileSync(result, JSON.stringify({ cloned: true }));
} catch {
    writeFileSync(result, JSON.stringify({ cloned: false }));
}
