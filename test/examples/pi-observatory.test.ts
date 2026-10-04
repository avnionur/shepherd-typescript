import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("Pi observatory example passes its real HTTP and subprocess conformance suite", async (context) => {
    const childEnvironment = { ...process.env };
    // Nested --test inherits Node's child-test marker and otherwise produces no test report.
    delete childEnvironment.NODE_TEST_CONTEXT;
    const sdkInstalled = existsSync(
        new URL(
            "../../examples/pi-observatory/sdk/node_modules/@earendil-works/pi-coding-agent/package.json",
            import.meta.url,
        ),
    );
    if (!sdkInstalled)
        context.diagnostic(
            "Optional native Pi setup tests require npm ci --prefix examples/pi-observatory/sdk --ignore-scripts; no native credential evidence is claimed without it.",
        );
    const { stdout } = await execute(
        process.execPath,
        [
            "--test",
            "--test-reporter=tap",
            fileURLToPath(
                new URL("../../examples/pi-observatory/test/http.test.mjs", import.meta.url),
            ),
            fileURLToPath(
                new URL("../../examples/pi-observatory/test/graph.test.mjs", import.meta.url),
            ),
            ...(sdkInstalled
                ? [
                      fileURLToPath(
                          new URL(
                              "../../examples/pi-observatory/test/connection.test.mjs",
                              import.meta.url,
                          ),
                      ),
                  ]
                : []),
        ],
        { env: childEnvironment, timeout: 120_000, maxBuffer: 1_048_576 },
    );
    assert.match(stdout, /# fail 0\r?\n/);
    const count = stdout.match(/# tests (\d+)/);
    assert.ok(count && Number(count[1]) > 0, "example tests must actually execute");
});
