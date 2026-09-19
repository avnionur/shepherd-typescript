import assert from "node:assert/strict";
import { test } from "node:test";

import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import { classifyOverlayMountInfo } from "../../src/workspace/carrier-backends.ts";

const overlay = workspaceProtocolConfig.carrierBackends.overlay;
const layers = { lower: "/w/lower", target: "/w/world dir", upper: "/w/upper", work: "/w/work" };
const options = overlay.mountOptions
    .replaceAll(overlay.tokens.lower, layers.lower)
    .replaceAll(overlay.tokens.upper, layers.upper)
    .replaceAll(overlay.tokens.work, layers.work);

function line(target: string, filesystem: string, superOptions: string): string {
    return `36 35 98:0 / ${target} rw,noatime - ${filesystem} ${filesystem} ${superOptions}`;
}

test("overlay mountinfo classification is exact, last-entry-wins, and total on hostile text", () => {
    const escapedTarget = layers.target.replace(" ", "\\040");
    assert.equal(classifyOverlayMountInfo("", layers), "absent");
    assert.equal(classifyOverlayMountInfo(`${line("/", "ext4", "rw")}\n`, layers), "absent");
    assert.equal(
        classifyOverlayMountInfo(
            line(escapedTarget, overlay.filesystemType, `rw,${options}`),
            layers,
        ),
        "owned",
    );
    // Another filesystem, or an overlay missing one exact layer option, is foreign.
    assert.equal(
        classifyOverlayMountInfo(line(escapedTarget, "tmpfs", `rw,${options}`), layers),
        "foreign",
    );
    assert.equal(
        classifyOverlayMountInfo(
            line(escapedTarget, overlay.filesystemType, options.replace(layers.upper, "/other")),
            layers,
        ),
        "foreign",
    );
    // A later mount over the same target wins.
    assert.equal(
        classifyOverlayMountInfo(
            [
                line(escapedTarget, overlay.filesystemType, options),
                line(escapedTarget, "tmpfs", "rw"),
            ].join("\n"),
            layers,
        ),
        "foreign",
    );
    // Truncated and separator-only lines never throw.
    for (const text of [" - ", "1 2 3 - ", `1 2 3 4 ${escapedTarget} - `, "no separator"]) {
        assert.ok(["absent", "foreign"].includes(classifyOverlayMountInfo(text, layers)));
    }
});
