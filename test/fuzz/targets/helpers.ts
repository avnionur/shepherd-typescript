import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    canonicalizeRecord,
    createNativeJailCommand,
    createNativeJailRunner,
    inspectLocalNativeJailBackend,
    type SemanticRecord,
} from "../../../src/index.ts";
import { workspaceProtocolConfig } from "../../../src/protocol/config.ts";
import {
    readNativeJailCommandEvidence,
    readNativeJailPlanEvidence,
} from "../../../src/protocol/native-jail-evidence.ts";
import {
    readGrantedPlacementResolutionEvidence,
    readPlacementPlatformEvidence,
} from "../../../src/protocol/placement-evidence.ts";
import { readRepositoryGrantPlanEvidence } from "../../../src/protocol/repository-grant-evidence.ts";
import { classifyOverlayMountInfo } from "../../../src/workspace/carrier-backends.ts";
import { createNativeJailConfinementPlan } from "../../../src/workspace/native-jail.ts";
import type { Prng } from "../../support/prng.ts";
import { type FuzzInput, type FuzzTarget, fuzzSettings, repositoryRoot } from "../harness.ts";
import { mutateText } from "../mutators.ts";
import { assertCanonicalStable } from "./records.ts";

const placementFixture = JSON.parse(
    readFileSync(path.join(repositoryRoot, "test/fixtures/placement-resolution-v1.json"), "utf8"),
) as Record<string, unknown>;

/** A reader that decodes, rehashes, and returns canonical evidence. */
function evidenceTarget(
    name: string,
    reader: (value: unknown) => SemanticRecord,
    seeds: () => Promise<readonly unknown[] | { readonly skip: string }>,
): FuzzTarget {
    return {
        name,
        prepare: async () => {
            const values = await seeds();
            if ("skip" in values) return values;
            return {
                execute: (input) => reader((input as { value: unknown }).value),
                seeds: values.map((value) => ({ kind: "value", value }) as FuzzInput),
                verifyAccepted: (result) => {
                    const encoded = canonicalizeRecord(result as SemanticRecord);
                    assertCanonicalStable(encoded);
                    // Re-reading accepted evidence is idempotent.
                    assert.equal(canonicalizeRecord(reader(JSON.parse(encoded))), encoded);
                },
            };
        },
    };
}

const OVERLAY = workspaceProtocolConfig.carrierBackends.overlay;
const LAYERS = {
    lower: "/w/revisions",
    target: "/w/world dir",
    upper: "/w/upper",
    work: "/w/work",
};

function mountInfoLine(target: string, filesystem: string, options: string): string {
    return `36 35 98:0 / ${target.replaceAll(" ", "\\040")} rw,noatime master:1 - ${filesystem} ${filesystem} rw,${options}`;
}

const ownedOptions = OVERLAY.mountOptions
    .replaceAll(OVERLAY.tokens.lower, LAYERS.lower)
    .replaceAll(OVERLAY.tokens.upper, LAYERS.upper)
    .replaceAll(OVERLAY.tokens.work, LAYERS.work);

const overlayMountInfo: FuzzTarget = {
    name: "classifyOverlayMountInfo",
    prepare: async () => ({
        execute: (input) => classifyOverlayMountInfo((input as { text: string }).text, LAYERS),
        generate: (random: Prng, seed) => ({
            kind: "text",
            text: mutateText((seed as { text: string }).text, random, fuzzSettings.mutation),
        }),
        seeds: [
            `${mountInfoLine("/", "ext4", "errors=remount-ro")}\n${mountInfoLine(LAYERS.target, OVERLAY.filesystemType, ownedOptions)}\n`,
            `${mountInfoLine(LAYERS.target, "tmpfs", "size=1k")}\n`,
            "",
        ].map((text) => ({ kind: "text", text })),
        verifyAccepted: (result, input) => {
            assert.ok(["absent", "foreign", "owned"].includes(result as string));
            // Ownership needs the configured filesystem type and every exact layer option.
            if (result === "owned") {
                const text = (input as { text: string }).text;
                assert.ok(text.includes(` - ${OVERLAY.filesystemType} `));
                for (const option of ownedOptions.split(OVERLAY.mountOptionSeparator)) {
                    assert.ok(
                        text.includes(option.replaceAll(" ", "\\040")) || text.includes(option),
                    );
                }
            }
        },
    }),
};

async function nativeJailPlan(): Promise<readonly unknown[] | { readonly skip: string }> {
    const probe = await inspectLocalNativeJailBackend();
    if (probe.status !== "available") {
        return { skip: `native jail backend unavailable on this host: ${probe.reason}` };
    }
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "shepherd-fuzz-jail-")));
    try {
        const runner = createNativeJailRunner({
            command: { arguments: [], environment: [], executable: "/usr/bin/true" },
            maxOutputBytes: 1024,
            probe,
            runnerId: "runner:fuzz",
            timeoutMilliseconds: 5000,
        });
        return [
            createNativeJailConfinementPlan(runner, root, false),
            createNativeJailConfinementPlan(runner, root, true),
        ];
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
}

/** Placement, repository-grant, overlay mount, and native-jail helper evidence readers. */
export const HELPER_TARGETS: readonly FuzzTarget[] = [
    evidenceTarget("readPlacementPlatformEvidence", readPlacementPlatformEvidence, async () => [
        placementFixture.platform,
    ]),
    evidenceTarget(
        "readGrantedPlacementResolutionEvidence",
        readGrantedPlacementResolutionEvidence,
        async () => [placementFixture.resolution],
    ),
    evidenceTarget("readRepositoryGrantPlanEvidence", readRepositoryGrantPlanEvidence, async () => [
        placementFixture.repository_grant_plan,
    ]),
    overlayMountInfo,
    evidenceTarget("readNativeJailCommandEvidence", readNativeJailCommandEvidence, async () => [
        createNativeJailCommand({
            arguments: ["--flag", "value é"],
            environment: [
                { name: "SECOND", value: "2" },
                { name: "FIRST", value: "" },
            ],
            executable: "/usr/bin/true",
        }),
        createNativeJailCommand({ arguments: [], environment: [], executable: "/bin/sh" }),
    ]),
    evidenceTarget("readNativeJailPlanEvidence", readNativeJailPlanEvidence, nativeJailPlan),
];
