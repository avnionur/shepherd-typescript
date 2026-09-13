import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
    createReferenceCopyCarrier,
    initializeWorkspace,
    inspectWorkspacePlatformConformance,
    type WorldCarrierBackend,
    WorldCarrierError,
    type WorldCustody,
} from "../../src/index.ts";
import { workspaceProtocolConfig } from "../../src/protocol/config.ts";
import {
    inspectCarrierBackendAvailability,
    materializeClonedFile,
} from "../../src/workspace/carrier-backends.ts";
import {
    assertCarrierBackendRefused,
    createTreeWorkspace,
    registerCarrierConformanceSuite,
} from "./carrier-conformance.ts";

type ConformanceConfiguration = {
    readonly requiredBackendsEnvironmentVariable: string;
    readonly requiredBackendsSeparator: string;
};

const backends = workspaceProtocolConfig.carrierBackends;
const conformance = JSON.parse(
    readFileSync(new URL("../../config/carrier-conformance.config.json", import.meta.url), "utf8"),
) as ConformanceConfiguration;
const requiredBackends = (process.env[conformance.requiredBackendsEnvironmentVariable] ?? "")
    .split(conformance.requiredBackendsSeparator)
    .filter((backend) => backend.length > 0);
const hostRoot = await mkdtemp(path.join(tmpdir(), "shepherd-carrier-host-"));
after(() => rm(hostRoot, { force: true, recursive: true }));
initializeWorkspace({ adopt: "none", initializeGit: false, rootPath: hostRoot });
const hostEvidence = inspectWorkspacePlatformConformance({
    workspaceRoot: hostRoot,
}).optimized_carriers;

registerCarrierConformanceSuite({
    backend: backends.defaultBackend as WorldCarrierBackend,
    directoryCustody: true,
    dropVolatileState: () => undefined,
    releaseHostState: () => undefined,
});

for (const evidence of hostEvidence) {
    const backend = evidence.backend as WorldCarrierBackend;
    const overlay = backend === backends.overlay.backend;
    if (evidence.status === backends.conformance.statusRoles.conformant) {
        registerCarrierConformanceSuite({
            backend,
            directoryCustody: !overlay,
            dropVolatileState: overlay ? unmountCustody : () => undefined,
            releaseHostState: overlay ? unmountBeneath : () => undefined,
        });
        continue;
    }
    test(`${backend} carrier fails closed where the host cannot run it`, () => {
        assert.equal(requiredBackends.includes(backend), false, `${backend} is required here`);
        assert.equal(evidence.status, backends.conformance.statusRoles.unavailable);
        assert.equal(assertCarrierBackendRefused(backend, hostRoot), evidence.reason);
        if (overlay && !backends.overlay.platforms.includes(process.platform)) {
            assert.equal(evidence.reason, backends.conformance.reasonRoles.platformUnsupported);
        }
    });
}

test("platform inspection names every optimized backend and every required backend is conformant", () => {
    assert.deepEqual(
        hostEvidence.map((evidence) => evidence.backend),
        backends.backends.filter((backend) => backend !== backends.defaultBackend),
    );
    assert.equal(Object.isFrozen(hostEvidence), true);
    for (const evidence of hostEvidence) {
        assert.equal(backends.conformance.statuses.includes(evidence.status), true);
        assert.equal(backends.conformance.reasons.includes(evidence.reason), true);
        assert.equal(
            evidence.reason === backends.conformance.reasonRoles.available,
            evidence.status === backends.conformance.statusRoles.conformant,
        );
    }
    for (const backend of requiredBackends) {
        assert.equal(
            hostEvidence.find((evidence) => evidence.backend === backend)?.status,
            backends.conformance.statusRoles.conformant,
            `${backend} must be conformant on this host`,
        );
    }
});

test("carrier backend selection and retained backend evidence are closed", async (context) => {
    const { binding, workspaceRoot } = await createTreeWorkspace(context, "backend-boundary");
    const accessor = Object.defineProperty({ workspaceRoot }, "backend", {
        enumerable: true,
        get: () => backends.defaultBackend,
    });
    for (const value of [
        { backend: "unknown", workspaceRoot },
        { backend: null, workspaceRoot },
        { backend: backends.defaultBackend, extra: true, faultInjection: undefined, workspaceRoot },
        accessor,
    ]) {
        assert.throws(() => createReferenceCopyCarrier(value as never), TypeError);
    }
    const carrier = createReferenceCopyCarrier({ workspaceRoot });
    assert.equal(carrier.backend, backends.defaultBackend);
    const custody = await carrier.fork((await carrier.snapshot(binding)).revision_id);
    const descriptorPath = path.join(
        path.dirname(custody.path),
        workspaceProtocolConfig.carrier.custodyDescriptorFile,
    );
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as Record<
        string,
        unknown
    >;
    for (const forged of [
        {
            ...descriptor,
            backend: backends.overlay.backend,
            upper_identity: "1:1",
            work_identity: "1:2",
        },
        { ...descriptor, backend: backends.overlay.backend },
        { ...descriptor, backend: "unknown" },
    ]) {
        await writeFile(descriptorPath, `${JSON.stringify(forged)}\n`);
        await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    }
    await writeFile(descriptorPath, "null\n");
    await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
    await writeFile(descriptorPath, `${JSON.stringify(descriptor)}\n`);
    assert.deepEqual(await carrier.openCustody(custody.custody_id), custody);

    const existing = path.join(workspaceRoot, "existing.txt");
    await writeFile(existing, "existing\n");
    assert.throws(
        () => materializeClonedFile(existing, existing, Buffer.from("existing\n"), 0o600),
        WorldCarrierError,
    );
    assert.throws(
        () => materializeClonedFile(existing, path.join(existing, "child"), Buffer.alloc(0), 0o600),
        (error: unknown) => !(error instanceof WorldCarrierError),
    );
    assert.throws(
        () => inspectCarrierBackendAvailability(path.join(workspaceRoot, "missing-staging")),
        (error: unknown) => !(error instanceof WorldCarrierError),
    );
    const staging = path.join(
        workspaceRoot,
        workspaceProtocolConfig.controlDirectory,
        workspaceProtocolConfig.carrier.carrierDirectory,
        workspaceProtocolConfig.carrier.stagingDirectory,
    );
    const outside = await mkdtemp(path.join(tmpdir(), "shepherd-carrier-staging-outside-"));
    context.after(() => rm(outside, { force: true, recursive: true }));
    await rm(staging, { recursive: true });
    await symlink(outside, staging);
    assert.throws(() => inspectWorkspacePlatformConformance({ workspaceRoot }), WorldCarrierError);
});

if (process.platform === "darwin") {
    test("clone carrier fails closed on a macOS filesystem without clonefile support", async (context) => {
        const parent = await mkdtemp(path.join(tmpdir(), "shepherd-carrier-hfs-"));
        const image = path.join(parent, "volume.dmg");
        const mountPoint = path.join(parent, "volume");
        await mkdir(mountPoint);
        execFileSync("hdiutil", [
            "create",
            "-size",
            "16m",
            "-fs",
            "HFS+",
            "-volname",
            "shepherd",
            image,
        ]);
        execFileSync("hdiutil", [
            "attach",
            image,
            "-mountpoint",
            mountPoint,
            "-nobrowse",
            "-noautoopen",
        ]);
        context.after(async () => {
            execFileSync("hdiutil", ["detach", mountPoint, "-force"]);
            await rm(parent, { force: true, recursive: true });
        });
        const { workspaceRoot } = await createTreeWorkspace(context, "hfs", mountPoint);
        assert.equal(
            assertCarrierBackendRefused(
                backends.clone.backend as WorldCarrierBackend,
                workspaceRoot,
            ),
            backends.conformance.reasonRoles.reflinkUnsupported,
        );
        assert.deepEqual(
            inspectWorkspacePlatformConformance({ workspaceRoot }).optimized_carriers.find(
                (evidence) => evidence.backend === backends.clone.backend,
            ),
            {
                backend: backends.clone.backend,
                reason: backends.conformance.reasonRoles.reflinkUnsupported,
                status: backends.conformance.statusRoles.unavailable,
            },
        );
    });
}

if (
    hostEvidence.some(
        (evidence) =>
            evidence.backend === backends.overlay.backend &&
            evidence.status === backends.conformance.statusRoles.conformant,
    )
) {
    test("overlay carrier refuses retained custody that contradicts its layers", async (context) => {
        const { binding, workspaceRoot } = await createTreeWorkspace(
            context,
            "overlay-contradiction",
            tmpdir(),
            unmountBeneath,
        );
        const backend = backends.overlay.backend as WorldCarrierBackend;
        const carrier = createReferenceCopyCarrier({ backend, workspaceRoot });
        const revision = await carrier.snapshot(binding);
        const custody = await carrier.fork(revision.revision_id);
        await writeFile(path.join(custody.path, "upper.txt"), "upper\n");
        const root = path.dirname(custody.path);
        assert.equal(
            await readFile(path.join(root, backends.overlay.upperDirectory, "upper.txt"), "utf8"),
            "upper\n",
        );

        unmountCustody(custody);
        await writeFile(path.join(custody.path, "stray.txt"), "stray\n");
        await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
        await rm(path.join(custody.path, "stray.txt"));
        assert.equal(
            await readFile(
                path.join((await carrier.openCustody(custody.custody_id)).path, "upper.txt"),
                "utf8",
            ),
            "upper\n",
        );

        unmountCustody(custody);
        execFileSync(backends.overlay.mountExecutable, ["-t", "tmpfs", "tmpfs", custody.path]);
        await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
        unmountCustody(custody);

        const upper = path.join(root, backends.overlay.upperDirectory);
        await rm(upper, { recursive: true });
        await mkdir(upper, { mode: 0o700 });
        await assert.rejects(carrier.openCustody(custody.custody_id), WorldCarrierError);
        assert.equal((await carrier.verifyRevision(revision.revision_id)).modified, false);
    });
}

function unmountCustody(custody: WorldCustody): void {
    execFileSync(backends.overlay.unmountExecutable, [custody.path]);
}

function unmountBeneath(workspaceRoot: string): void {
    const mounts = readFileSync(backends.overlay.mountInfoPath, "utf8")
        .split("\n")
        .map((line) =>
            (line.split(" ")[4] ?? "").replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
                String.fromCharCode(Number.parseInt(octal, 8)),
            ),
        )
        .filter((mountPoint) => mountPoint.startsWith(`${workspaceRoot}${path.sep}`))
        .sort((left, right) => right.length - left.length);
    for (const mountPoint of mounts) {
        execFileSync(backends.overlay.unmountExecutable, [mountPoint]);
    }
}
