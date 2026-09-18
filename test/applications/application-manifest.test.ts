import assert from "node:assert/strict";
import { test } from "node:test";

import {
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
} from "../../src/applications/records.ts";
import {
    APPLICATION_LIMITS,
    type ApplicationArtifactSource,
    ApplicationEvidenceError,
    type ApplicationManifest,
    ApplicationProtocolError,
    ApplicationVerificationError,
    applicationProtocolId,
    createApplicationManifest,
    deriveApplicationOwnerId,
    inspectApplicationManifest,
    isPublicError,
    type RecordBody,
    type RecordId,
    ROOT_WITNESS_ID,
    readApplicationProtocol,
    retainApplicationManifest,
    SQLiteTraceStore,
    type StoreAppendRequest,
    TraceStoreError,
    validateApplicationManifest,
} from "../../src/index.ts";
import { applicationsProtocolConfig } from "../../src/protocol/config.ts";
import { appendOwnerRecord } from "../supervision/fixtures.ts";
import { rawSupervisionProtocol, supervisionProtocol, temporaryDatabasePath } from "./fixtures.ts";

const config = applicationsProtocolConfig;
const COSTS = {
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cost_usd: null,
    input_tokens: 1,
    output_tokens: 1,
    provider_calls: 1,
};

/** Store whose application appends report a moved head after the configured number of calls. */
class MovedHeadStore extends SQLiteTraceStore {
    failAfter = Number.POSITIVE_INFINITY;
    calls = 0;

    override appendApplicationRecord(
        applicationId: string,
        expectedHeadRecordId: RecordId | null,
        request: StoreAppendRequest,
        cutId: string | null,
    ) {
        this.calls += 1;
        if (this.calls > this.failAfter) {
            return Object.freeze({ status: "head_moved" as const });
        }
        return super.appendApplicationRecord(applicationId, expectedHeadRecordId, request, cutId);
    }
}

function manifestOf(
    commandId: string,
    artifacts: readonly ApplicationArtifactSource[] = [],
): ApplicationManifest {
    return createApplicationManifest({
        applicationId: deriveApplicationOwnerId(commandId),
        artifacts,
        costs: COSTS,
        protocol: supervisionProtocol(),
    });
}

function forge(
    store: SQLiteTraceStore,
    applicationId: string,
    step: string,
    body: RecordBody,
    schemaRef: string,
    causes: readonly RecordId[] = [],
    cutId: string | null = null,
): RecordId {
    const head = store.readOwner(applicationId).at(-1)?.envelope.record_id ?? null;
    const appended = store.appendApplicationRecord(
        applicationId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(applicationId, step),
            applicationId,
            body,
            schemaRef,
            causes,
        ),
        cutId,
    );
    assert.equal(appended.status, "appended");
    return (appended as { readonly receipt: { readonly record_ids: readonly RecordId[] } }).receipt
        .record_ids[0] as RecordId;
}

test("protocol definitions are validated, canonical, and content-addressed", () => {
    const protocol = supervisionProtocol();
    assert.equal(Object.isFrozen(protocol), true);
    assert.equal(Object.isFrozen(protocol.surfaces), true);
    assert.deepEqual(protocol.seeds, [11, 23]);
    assert.equal(protocol.kind, "coding_supervisor");
    const protocolId = applicationProtocolId(protocol);
    assert.match(protocolId, /^application-protocol:sha256:[0-9a-f]{64}$/u);
    assert.equal(applicationProtocolId(supervisionProtocol()), protocolId);
    assert.notEqual(
        applicationProtocolId(supervisionProtocol({ protocolVersion: "appendix-e.v2" })),
        protocolId,
    );
    assert.equal(
        readApplicationProtocol(JSON.parse(JSON.stringify(protocol))).surfaces.length,
        protocol.surfaces.length,
    );
    assert.match(deriveApplicationOwnerId("application:1"), /^application:sha256:[0-9a-f]{64}$/u);
    assert.throws(() => deriveApplicationOwnerId(""), TypeError);
    const longPrompt = "x".repeat(APPLICATION_LIMITS.maxPromptBytes + 1);
    const surfaces = rawSupervisionProtocol().surfaces as Record<string, unknown>[];
    const [prompt] = surfaces as [Record<string, unknown>];
    for (const mutation of [
        null,
        { ...rawSupervisionProtocol(), extra: true },
        { ...rawSupervisionProtocol(), kind: "unknown" },
        { ...rawSupervisionProtocol(), protocolVersion: "" },
        { ...rawSupervisionProtocol(), surfaces: [] },
        { ...rawSupervisionProtocol(), surfaces: [...surfaces, prompt] },
        {
            ...rawSupervisionProtocol(),
            surfaces: Array.from({ length: APPLICATION_LIMITS.maxSurfaces + 1 }, (_, index) => ({
                ...prompt,
                id: `prompt-${index}`,
            })),
        },
        { ...rawSupervisionProtocol(), surfaces: [{ ...prompt, kind: "audio" }] },
        { ...rawSupervisionProtocol(), surfaces: [{ ...prompt, id: "" }] },
        { ...rawSupervisionProtocol(), surfaces: [{ ...prompt, role: "" }] },
        { ...rawSupervisionProtocol(), surfaces: [{ ...prompt, content: longPrompt }] },
        { ...rawSupervisionProtocol(), surfaces: [{ ...prompt, content: undefined }] },
        { ...rawSupervisionProtocol(), budgets: { maxRounds: 1.5 } },
        { ...rawSupervisionProtocol(), budgets: { maxRounds: -1 } },
        { ...rawSupervisionProtocol(), budgets: null },
        { ...rawSupervisionProtocol(), seeds: [] },
        { ...rawSupervisionProtocol(), seeds: [1, 1] },
        { ...rawSupervisionProtocol(), seeds: [1.5] },
        {
            ...rawSupervisionProtocol(),
            seeds: Array.from({ length: APPLICATION_LIMITS.maxSeeds + 1 }, (_, index) => index),
        },
        { ...rawSupervisionProtocol(), dataset: { id: "", items: [], revision: "1" } },
        { ...rawSupervisionProtocol(), dataset: { id: "d", items: ["a", "a"], revision: "1" } },
        { ...rawSupervisionProtocol(), dataset: { id: "d", items: [""], revision: "1" } },
    ]) {
        assert.throws(
            () => readApplicationProtocol(mutation),
            (error: unknown) =>
                error instanceof ApplicationProtocolError &&
                isPublicError(error) &&
                error.code === config.errors.protocolCode,
        );
    }
    assert.throws(() => applicationProtocolId(null as never), ApplicationProtocolError);
});

test("manifests cite surfaces and artifacts by digest and re-derive their identity", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "manifest");
    using store = new SQLiteTraceStore(databasePath);
    const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
    const manifest = manifestOf("application:manifest", [
        { content: { note: "cited" }, cut_id: null, record_id: cited, role: "note" },
        { content: "text", cut_id: "cut:1", record_id: null, role: "text" },
    ]);
    assert.equal(Object.isFrozen(manifest), true);
    assert.match(manifest.manifest_id, /^application-manifest:sha256:[0-9a-f]{64}$/u);
    assert.equal(manifest.compatibility_version, config.compatibilityVersion);
    assert.equal(manifest.manifest_version, config.manifestVersion);
    assert.equal(manifest.protocol_id, applicationProtocolId(supervisionProtocol()));
    assert.equal(manifest.surfaces.length, supervisionProtocol().surfaces.length);
    assert.ok(manifest.surfaces.every((surface) => /^sha256:[0-9a-f]{64}$/u.test(surface.digest)));
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(manifest.artifacts[0]?.record_id, cited);
    assert.equal(manifest.artifacts[1]?.cut_id, "cut:1");
    assert.deepEqual(manifest.costs, COSTS);
    // Identity is a pure function of the body.
    assert.equal(
        manifestOf("application:manifest", [
            { content: { note: "cited" }, cut_id: null, record_id: cited, role: "note" },
            { content: "text", cut_id: "cut:1", record_id: null, role: "text" },
        ]).manifest_id,
        manifest.manifest_id,
    );
    assert.notEqual(manifestOf("application:other").manifest_id, manifest.manifest_id);
    assert.deepEqual(validateApplicationManifest(JSON.parse(JSON.stringify(manifest))), manifest);

    const retained = retainApplicationManifest(store, { manifest });
    assert.match(retained.cut_id, /^application-cut:sha256:[0-9a-f]{64}$/u);
    assert.equal(store.readCut(retained.cut_id).through_record_id, retained.record_id);
    assert.deepEqual(store.readRecord(retained.record_id)?.envelope.caused_by_record_ids, [cited]);
    assert.deepEqual(retainApplicationManifest(store, { manifest }), retained);
    const inspection = inspectApplicationManifest(store, manifest.application_id);
    assert.deepEqual(inspection, {
        application_id: manifest.application_id,
        cut_id: retained.cut_id,
        manifest,
        record_id: retained.record_id,
    });
    using readOnly = new SQLiteTraceStore(databasePath, { readOnly: true });
    assert.deepEqual(inspectApplicationManifest(readOnly, manifest.application_id), inspection);
    using imported = new SQLiteTraceStore();
    imported.importTrace(store.exportTrace());
    assert.deepEqual(inspectApplicationManifest(imported, manifest.application_id), inspection);
    // Raw appends and cut publication onto the reserved application owner path are refused.
    assert.throws(
        () =>
            store.append({
                append_intent_id: "intent:forged",
                batch: {
                    groups: [
                        {
                            owner_id: manifest.application_id,
                            records: [
                                {
                                    body: { forged: true },
                                    mode: "capture",
                                    schema_ref: "example.forged.v1",
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            }),
        TraceStoreError,
    );
    assert.throws(
        () =>
            store.publishCut({
                cut_id: "cut:forged",
                target_owner_id: manifest.application_id,
                through_record_id: retained.record_id,
            }),
        TraceStoreError,
    );
    assert.equal(
        store.appendApplicationRecord(
            manifest.application_id,
            null,
            createApplicationAppendRequest(
                createApplicationAppendIntentId(manifest.application_id, "late"),
                manifest.application_id,
                { late: true },
                config.traceSchemas.manifest,
                [],
            ),
            null,
        ).status,
        "head_moved",
    );
    assert.equal(store.verifyIntegrity().ok, true);
});

test("manifest construction, validation, retention, and inspection refuse malformed evidence", async (context) => {
    const databasePath = await temporaryDatabasePath(context, "manifest-refusals");
    const store = new MovedHeadStore(databasePath);
    context.after(() => store.close());
    const cited = appendOwnerRecord(store, "worker:notes", "n0") as RecordId;
    const applicationId = deriveApplicationOwnerId("application:refusals");
    const good = manifestOf("application:refusals", [
        { content: { note: "cited" }, cut_id: null, record_id: cited, role: "note" },
    ]);
    const recordId = `sha256:${"0".repeat(64)}` as RecordId;
    for (const options of [
        null,
        { applicationId, artifacts: [], costs: COSTS },
        {
            applicationId: "application:x",
            artifacts: [],
            costs: COSTS,
            protocol: supervisionProtocol(),
        },
        { applicationId, artifacts: [{}], costs: COSTS, protocol: supervisionProtocol() },
        {
            applicationId,
            artifacts: [{ content: 1, cut_id: null, record_id: null, role: "" }],
            costs: COSTS,
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [{ content: 1, cut_id: null, record_id: "run:x", role: "r" }],
            costs: COSTS,
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [{ content: 1, cut_id: 5, record_id: null, role: "r" }],
            costs: COSTS,
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: Array.from({ length: APPLICATION_LIMITS.maxArtifacts + 1 }, () => ({
                content: 1,
                cut_id: null,
                record_id: null,
                role: "r",
            })),
            costs: COSTS,
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [],
            costs: { ...COSTS, extra: 1 },
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [],
            costs: { ...COSTS, input_tokens: -1 },
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [],
            costs: { ...COSTS, cost_usd: -1 },
            protocol: supervisionProtocol(),
        },
        {
            applicationId,
            artifacts: [],
            costs: { ...COSTS, cost_usd: "1" },
            protocol: supervisionProtocol(),
        },
    ]) {
        assert.throws(() => createApplicationManifest(options as never), TypeError);
    }
    assert.throws(
        () =>
            createApplicationManifest({
                applicationId,
                artifacts: [],
                costs: COSTS,
                protocol: {} as never,
            }),
        ApplicationProtocolError,
    );
    assert.equal(
        createApplicationManifest({
            applicationId,
            artifacts: [],
            costs: { ...COSTS, cost_usd: 0.5 },
            protocol: supervisionProtocol(),
        }).costs.cost_usd,
        0.5,
    );
    const [surface] = good.surfaces as [ApplicationManifest["surfaces"][number]];
    const [artifact] = good.artifacts as [ApplicationManifest["artifacts"][number]];
    for (const mutation of [
        null,
        { ...good, extra: true },
        { ...good, compatibility_version: "shepherd.applications.v2" },
        { ...good, manifest_version: 2 },
        { ...good, kind: "unknown" },
        { ...good, application_id: "application:x" },
        { ...good, protocol_id: "x" },
        { ...good, protocol_version: "" },
        { ...good, surfaces: [] },
        { ...good, surfaces: [surface, surface] },
        { ...good, surfaces: [{ ...surface, digest: "x" }] },
        { ...good, surfaces: [{ ...surface, kind: "audio" }] },
        { ...good, surfaces: [{ ...surface, id: "" }] },
        { ...good, surfaces: [{ ...surface, role: "" }] },
        { ...good, artifacts: [{ ...artifact, role: "" }] },
        { ...good, artifacts: [{ ...artifact, digest: "x" }] },
        { ...good, artifacts: [{ ...artifact, record_id: "run:x" }] },
        { ...good, artifacts: [{ ...artifact, cut_id: 1 }] },
        {
            ...good,
            artifacts: [{ ...artifact, artifact_id: `application-artifact:${"0".repeat(64)}` }],
        },
        {
            ...good,
            artifacts: Array.from({ length: APPLICATION_LIMITS.maxArtifacts + 1 }, () => artifact),
        },
        { ...good, budgets: { maxRounds: -1 } },
        { ...good, costs: { ...COSTS, provider_calls: 1.5 } },
        { ...good, dataset: { ...good.dataset, revision: "" } },
        { ...good, seeds: [] },
        { ...good, manifest_id: `application-manifest:sha256:${"0".repeat(64)}` },
        { ...good, manifest_id: "x" },
    ]) {
        assert.throws(
            () => validateApplicationManifest(mutation),
            (error: unknown) =>
                error instanceof ApplicationEvidenceError &&
                error.code === config.errors.evidenceCode,
        );
    }
    assert.throws(() => retainApplicationManifest(store, {} as never), TypeError);
    assert.throws(
        () =>
            retainApplicationManifest(store, {
                manifest: manifestOf("application:refusals", [
                    { content: 1, cut_id: null, record_id: recordId, role: "r" },
                ]),
            }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /not retained/u.test(error.message),
    );
    store.failAfter = 0;
    assert.throws(
        () => retainApplicationManifest(store, { manifest: good }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /head moved/u.test(error.message),
    );
    store.failAfter = Number.POSITIVE_INFINITY;
    const retained = retainApplicationManifest(store, { manifest: good });
    assert.throws(
        () => retainApplicationManifest(store, { manifest: manifestOf("application:refusals") }),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /different manifest/u.test(error.message),
    );
    assert.equal(inspectApplicationManifest(store, applicationId).record_id, retained.record_id);
    assert.throws(() => inspectApplicationManifest(store, "application:x"), TypeError);
    assert.throws(
        () => inspectApplicationManifest(store, deriveApplicationOwnerId("application:absent")),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /retains no manifest/u.test(error.message),
    );
    // Forged evidence: a manifest without its cut, a manifest naming another application, and a
    // second manifest record are each inconsistent.
    const withoutCut = deriveApplicationOwnerId("application:without-cut");
    forge(
        store,
        withoutCut,
        "manifest",
        { ...manifestOf("application:without-cut") },
        config.traceSchemas.manifest,
    );
    assert.throws(
        () => inspectApplicationManifest(store, withoutCut),
        (error: unknown) =>
            error instanceof ApplicationEvidenceError && /inconsistent/u.test(error.message),
    );
    const foreign = deriveApplicationOwnerId("application:foreign");
    forge(store, foreign, "manifest", { ...good }, config.traceSchemas.manifest);
    assert.throws(() => inspectApplicationManifest(store, foreign), ApplicationEvidenceError);
    forge(store, applicationId, "second", { ...good }, config.traceSchemas.manifest, [
        retained.record_id,
    ]);
    assert.throws(() => inspectApplicationManifest(store, applicationId), ApplicationEvidenceError);
    const malformed = deriveApplicationOwnerId("application:malformed");
    forge(store, malformed, "manifest", { forged: true }, config.traceSchemas.manifest);
    assert.throws(() => inspectApplicationManifest(store, malformed), ApplicationEvidenceError);
    const verification = new ApplicationVerificationError("verifier unavailable");
    assert.equal(verification.code, config.errors.verificationCode);
    assert.equal(isPublicError(verification), true);
});
