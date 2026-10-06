import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRetainedDeviceMountTable } from "../../src/workspace/retained-device-files.ts";

test("retained device mount policy rejects direct and descendant bind mounts, including escaped paths", () => {
    const root = "/private/device root";
    const baseline = "1 0 0:1 / / rw - ext4 /dev/root rw\n";
    assert.doesNotThrow(() => assertRetainedDeviceMountTable(root, baseline));
    for (const target of ["/private/device\\040root", "/private/device\\040root/world/borrowed"]) {
        assert.throws(
            () =>
                assertRetainedDeviceMountTable(
                    root,
                    baseline + `2 1 0:1 /elsewhere ${target} rw - ext4 /dev/root rw\n`,
                ),
            /foreign mount/u,
        );
    }
    assert.doesNotThrow(() =>
        assertRetainedDeviceMountTable(
            root,
            baseline +
                "2 1 0:1 /elsewhere /private/device\\040root-sibling rw - ext4 /dev/root rw\n",
        ),
    );
    for (const text of ["", "malformed", "1 0 0:1 / relative rw - ext4 /dev/root rw"])
        assert.throws(() => assertRetainedDeviceMountTable(root, text), /mount table/u);
});
