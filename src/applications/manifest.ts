import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { applicationsProtocolConfig } from "../protocol/config.ts";
import { APPLICATION_KINDS, APPLICATION_PROTOCOL_SURFACES } from "../protocol/values.generated.ts";
import { assertRecordId } from "../record/guards.ts";
import type { RecordBody, RecordId } from "../record/types.ts";
import { assertScopeText, readScopeArray, readScopeDataObject } from "../scope/validation.ts";
import type { SQLiteTraceStore } from "../store/sqlite-trace-store.ts";
import type { Cut, CutId } from "../store/types.ts";
import { ApplicationEvidenceError, ApplicationProtocolError } from "./errors.ts";
import {
    applicationDigest,
    assertApplicationDigest,
    assertPlainDigest,
    createApplicationAppendIntentId,
    createApplicationAppendRequest,
    createApplicationCutId,
    prefixedApplicationId,
    readApplicationCosts,
    readNullableText,
} from "./records.ts";
import type {
    ApplicationArtifactCitation,
    ApplicationDatasetSelection,
    ApplicationManifest,
    ApplicationManifestInspection,
    ApplicationManifestReceipt,
    ApplicationProtocolDefinition,
    ApplicationProtocolSurface,
    ApplicationProtocolSurfaceKind,
    CreateApplicationManifestOptions,
    RetainApplicationManifestOptions,
} from "./types.ts";

const config = applicationsProtocolConfig;
const [PROMPT_KIND, SCHEMA_KIND, TOOL_KIND] = APPLICATION_PROTOCOL_SURFACES;
const SURFACE_BYTE_LIMITS: Readonly<Record<ApplicationProtocolSurfaceKind, number>> = Object.freeze(
    {
        [PROMPT_KIND]: config.limits.maxPromptBytes,
        [SCHEMA_KIND]: config.limits.maxSchemaBytes,
        [TOOL_KIND]: config.limits.maxToolBytes,
    },
);
const MANIFEST_STEP = "manifest";

/**
 * Validates an untrusted application protocol definition into its canonical frozen form.
 *
 * The definition must be a plain data object of exactly `budgets`, `dataset`, `kind`,
 * `protocolVersion`, `seeds`, and `surfaces`. Kinds and surface kinds must be configured, surface
 * identities distinct, every surface content canonical and within the configured byte bound for
 * its kind, budgets non-negative integers by non-empty metric name, seeds distinct integers, and
 * the dataset selection a distinct item list, all within `APPLICATION_LIMITS`.
 *
 * @param value - Untrusted protocol definition.
 * @returns The canonical frozen definition.
 * @throws {ApplicationProtocolError} If the definition is malformed or exceeds a configured bound.
 *
 * @example
 * ```ts
 * const protocol = readApplicationProtocol(JSON.parse(text).supervision);
 * console.log(applicationProtocolId(protocol));
 * ```
 */
export function readApplicationProtocol(value: unknown): ApplicationProtocolDefinition {
    try {
        const fields = readScopeDataObject(
            value,
            ["budgets", "dataset", "kind", "protocolVersion", "seeds", "surfaces"],
            "application protocol",
        );
        if (!APPLICATION_KINDS.includes(fields.kind as never)) {
            throw new TypeError("kind must be a configured application kind");
        }
        assertScopeText(fields.protocolVersion, "protocolVersion");
        const surfaces = readScopeArray(fields.surfaces, "surfaces").map((surface, index) =>
            readSurface(surface, `surfaces[${index}]`),
        );
        if (
            surfaces.length === 0 ||
            surfaces.length > config.limits.maxSurfaces ||
            new Set(surfaces.map((surface) => surface.id)).size !== surfaces.length
        ) {
            throw new TypeError("surfaces must be non-empty, distinct, and within the bound");
        }
        return createCanonicalSnapshot({
            budgets: readBudgets(fields.budgets),
            dataset: readDataset(fields.dataset),
            kind: fields.kind,
            protocolVersion: fields.protocolVersion,
            seeds: readSeeds(fields.seeds),
            surfaces,
        } as unknown as RecordBody) as unknown as ApplicationProtocolDefinition;
    } catch (error) {
        throw new ApplicationProtocolError("definition is malformed", { cause: error });
    }
}

/**
 * Derives the content-addressed identity of one protocol definition.
 *
 * @param definition - Protocol definition; validated again before hashing.
 * @returns The configured `protocolIdPrefix` identity over the canonical definition.
 * @throws {ApplicationProtocolError} If the definition is malformed.
 */
export function applicationProtocolId(definition: ApplicationProtocolDefinition): string {
    return prefixedApplicationId(
        config.identity.protocolIdPrefix,
        readApplicationProtocol(definition) as unknown as SemanticValue,
    );
}

/**
 * Derives the application identity and reserved owner path of one application command.
 *
 * @param commandId - Globally idempotent application command identity.
 * @returns The configured `applicationIdPrefix` identity.
 * @throws {TypeError} If the command identity is malformed.
 */
export function deriveApplicationOwnerId(commandId: string): string {
    assertScopeText(commandId, "commandId");
    return prefixedApplicationId(config.identity.applicationIdPrefix, { command_id: commandId });
}

/**
 * Builds the canonical manifest of one application run.
 *
 * Surfaces are cited by the digest of their canonical content; artifacts by the digest of the
 * supplied content with the record and cut they live in; the manifest identity is the digest of
 * the manifest body without the identity field, so the same protocol, artifacts, and costs yield
 * the same manifest identity.
 *
 * @param options - Application identity, artifact sources, measured costs, and protocol.
 * @returns The frozen manifest.
 * @throws {ApplicationProtocolError} If the protocol definition is malformed.
 * @throws {TypeError} If the options, an artifact, or the costs are malformed or exceed bounds.
 */
export function createApplicationManifest(
    options: CreateApplicationManifestOptions,
): ApplicationManifest {
    const fields = readScopeDataObject(
        options,
        ["applicationId", "artifacts", "costs", "protocol"],
        "createApplicationManifest options",
    );
    assertApplicationDigest(
        fields.applicationId,
        config.identity.applicationIdPrefix,
        "applicationId",
    );
    const protocol = readApplicationProtocol(fields.protocol);
    const artifacts = readScopeArray(fields.artifacts, "artifacts").map((artifact, index) => {
        const subject = `artifacts[${index}]`;
        const source = readScopeDataObject(
            artifact,
            ["content", "cut_id", "record_id", "role"],
            subject,
        );
        assertScopeText(source.role, `${subject}.role`);
        if (source.record_id !== null) {
            assertRecordId(source.record_id, `${subject}.record_id`);
        }
        return createArtifactCitation(
            source.role,
            applicationDigest(source.content as SemanticValue),
            source.record_id as RecordId | null,
            readNullableText(source.cut_id, `${subject}.cut_id`),
        );
    });
    if (artifacts.length > config.limits.maxArtifacts) {
        throw new TypeError("artifacts exceed the configured bound");
    }
    const body = {
        application_id: fields.applicationId as string,
        artifacts,
        budgets: protocol.budgets,
        compatibility_version: config.compatibilityVersion,
        costs: readApplicationCosts(fields.costs),
        dataset: protocol.dataset,
        kind: protocol.kind,
        manifest_version: config.manifestVersion,
        protocol_id: applicationProtocolId(protocol),
        protocol_version: protocol.protocolVersion,
        seeds: protocol.seeds,
        surfaces: protocol.surfaces.map((surface) => ({
            digest: applicationDigest(surface.content),
            id: surface.id,
            kind: surface.kind,
            role: surface.role,
        })),
    };
    return validateApplicationManifest({
        ...body,
        manifest_id: prefixedApplicationId(config.identity.manifestIdPrefix, body),
    });
}

/**
 * Validates an untrusted manifest document, re-deriving its identity and every artifact identity.
 *
 * @param value - Untrusted manifest.
 * @returns The canonical frozen manifest.
 * @throws {ApplicationEvidenceError} If the document is malformed, exceeds a bound, or its
 * identities do not re-derive from its body.
 */
export function validateApplicationManifest(value: unknown): ApplicationManifest {
    try {
        const fields = readScopeDataObject(
            value,
            [
                "application_id",
                "artifacts",
                "budgets",
                "compatibility_version",
                "costs",
                "dataset",
                "kind",
                "manifest_id",
                "manifest_version",
                "protocol_id",
                "protocol_version",
                "seeds",
                "surfaces",
            ],
            "application manifest",
        );
        if (
            fields.compatibility_version !== config.compatibilityVersion ||
            fields.manifest_version !== config.manifestVersion
        ) {
            throw new TypeError("manifest version is unsupported");
        }
        if (!APPLICATION_KINDS.includes(fields.kind as never)) {
            throw new TypeError("kind must be a configured application kind");
        }
        assertApplicationDigest(
            fields.application_id,
            config.identity.applicationIdPrefix,
            "application_id",
        );
        assertApplicationDigest(
            fields.protocol_id,
            config.identity.protocolIdPrefix,
            "protocol_id",
        );
        assertScopeText(fields.protocol_version, "protocol_version");
        const surfaces = readScopeArray(fields.surfaces, "surfaces").map((surface, index) => {
            const subject = `surfaces[${index}]`;
            const entry = readScopeDataObject(surface, ["digest", "id", "kind", "role"], subject);
            assertPlainDigest(entry.digest, `${subject}.digest`);
            assertScopeText(entry.id, `${subject}.id`);
            assertScopeText(entry.role, `${subject}.role`);
            if (!APPLICATION_PROTOCOL_SURFACES.includes(entry.kind as never)) {
                throw new TypeError(`${subject}.kind must be a configured surface kind`);
            }
            return entry;
        });
        if (
            surfaces.length === 0 ||
            surfaces.length > config.limits.maxSurfaces ||
            new Set(surfaces.map((surface) => surface.id)).size !== surfaces.length
        ) {
            throw new TypeError("surfaces must be non-empty, distinct, and within the bound");
        }
        const artifacts = readScopeArray(fields.artifacts, "artifacts").map((artifact, index) => {
            const subject = `artifacts[${index}]`;
            const entry = readScopeDataObject(
                artifact,
                ["artifact_id", "cut_id", "digest", "record_id", "role"],
                subject,
            );
            assertScopeText(entry.role, `${subject}.role`);
            assertPlainDigest(entry.digest, `${subject}.digest`);
            if (entry.record_id !== null) {
                assertRecordId(entry.record_id, `${subject}.record_id`);
            }
            const citation = createArtifactCitation(
                entry.role,
                entry.digest as string,
                entry.record_id as RecordId | null,
                readNullableText(entry.cut_id, `${subject}.cut_id`),
            );
            if (citation.artifact_id !== entry.artifact_id) {
                throw new TypeError(`${subject}.artifact_id does not re-derive from its citation`);
            }
            return citation;
        });
        if (artifacts.length > config.limits.maxArtifacts) {
            throw new TypeError("artifacts exceed the configured bound");
        }
        const { manifest_id: manifestId, ...body } = fields;
        const manifest = {
            ...body,
            artifacts,
            budgets: readBudgets(fields.budgets),
            costs: readApplicationCosts(fields.costs),
            dataset: readDataset(fields.dataset),
            seeds: readSeeds(fields.seeds),
            surfaces,
        };
        if (
            manifestId !==
            prefixedApplicationId(
                config.identity.manifestIdPrefix,
                manifest as unknown as SemanticValue,
            )
        ) {
            throw new TypeError("manifest_id does not re-derive from the manifest body");
        }
        return createCanonicalSnapshot({
            ...manifest,
            manifest_id: manifestId,
        } as unknown as RecordBody) as unknown as ApplicationManifest;
    } catch (error) {
        throw new ApplicationEvidenceError("manifest is malformed", { cause: error });
    }
}

/**
 * Retains one manifest as a `shepherd.application.manifest.v1` record on its application owner
 * path and publishes the terminal application cut through it in the same transaction.
 *
 * Every artifact record the manifest cites must be retained and becomes a causal parent, with the
 * current application head first. Repeating the command with the same manifest returns the
 * retained receipt; an owner path that already retains a different manifest is refused.
 *
 * @param store - Open writable trace store.
 * @param options - Manifest to retain.
 * @returns The retained manifest, its record identity, and the terminal cut.
 * @throws {ApplicationEvidenceError} If the manifest is malformed, cites an unretained record, the
 * owner path retains a different manifest, or the application head moved.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If options are malformed.
 */
export function retainApplicationManifest(
    store: SQLiteTraceStore,
    options: RetainApplicationManifestOptions,
): ApplicationManifestReceipt {
    const fields = readScopeDataObject(options, ["manifest"], "retainApplicationManifest options");
    const manifest = validateApplicationManifest(fields.manifest);
    const applicationId = manifest.application_id;
    const cited: RecordId[] = [];
    for (const artifact of manifest.artifacts) {
        if (artifact.record_id === null) {
            continue;
        }
        if (store.readRecord(artifact.record_id) === undefined) {
            throw new ApplicationEvidenceError(
                `cited record ${artifact.record_id} is not retained`,
            );
        }
        if (!cited.includes(artifact.record_id)) {
            cited.push(artifact.record_id);
        }
    }
    const retained = readRetainedManifest(store, applicationId);
    if (retained !== null) {
        if (retained.manifest.manifest_id !== manifest.manifest_id) {
            throw new ApplicationEvidenceError(
                `application ${applicationId} already retains a different manifest`,
            );
        }
        return Object.freeze({ cut_id: retained.cut_id, manifest, record_id: retained.record_id });
    }
    const head = store.readOwner(applicationId).at(-1)?.envelope.record_id ?? null;
    const appended = store.appendApplicationRecord(
        applicationId,
        head,
        createApplicationAppendRequest(
            createApplicationAppendIntentId(applicationId, MANIFEST_STEP),
            applicationId,
            manifest as unknown as RecordBody,
            config.traceSchemas.manifest,
            [...(head === null ? [] : [head]), ...cited.filter((recordId) => recordId !== head)],
        ),
        createApplicationCutId(manifest.manifest_id),
    );
    if (appended.status === "head_moved") {
        throw new ApplicationEvidenceError(`application ${applicationId} head moved`);
    }
    return Object.freeze({
        cut_id: (appended.cut as Cut).cut_id,
        manifest,
        record_id: appended.receipt.record_ids[0] as RecordId,
    });
}

/**
 * Reads the retained manifest of one application without mutation.
 *
 * Inspection works on reopened, read-only, and imported stores.
 *
 * @param store - Open trace store, writable or read-only.
 * @param applicationId - Application identity derived by {@link deriveApplicationOwnerId}.
 * @returns The validated manifest with its record and terminal cut.
 * @throws {ApplicationEvidenceError} If no manifest is retained or the retained evidence is
 * inconsistent.
 * @throws {TraceStoreError} If the store is closed.
 * @throws {TypeError} If the application identity is malformed.
 */
export function inspectApplicationManifest(
    store: SQLiteTraceStore,
    applicationId: string,
): ApplicationManifestInspection {
    assertApplicationDigest(applicationId, config.identity.applicationIdPrefix, "applicationId");
    const retained = readRetainedManifest(store, applicationId);
    if (retained === null) {
        throw new ApplicationEvidenceError(`application ${applicationId} retains no manifest`);
    }
    return Object.freeze({ application_id: applicationId, ...retained });
}

/** Reads and validates the manifest record of one application owner path, if any. @internal */
export function readRetainedManifest(
    store: SQLiteTraceStore,
    applicationId: string,
): {
    readonly cut_id: CutId;
    readonly manifest: ApplicationManifest;
    readonly record_id: RecordId;
} | null {
    const records = store
        .readOwner(applicationId)
        .filter((record) => record.envelope.schema_ref === config.traceSchemas.manifest);
    const [record] = records;
    if (record === undefined) {
        return null;
    }
    const manifest = validateApplicationManifest(record.body);
    const cutId = createApplicationCutId(manifest.manifest_id);
    if (
        records.length !== 1 ||
        manifest.application_id !== applicationId ||
        store.readOptionalCut(cutId)?.through_record_id !== record.envelope.record_id
    ) {
        throw new ApplicationEvidenceError(
            `application ${applicationId} manifest evidence is inconsistent`,
        );
    }
    return Object.freeze({ cut_id: cutId, manifest, record_id: record.envelope.record_id });
}

function createArtifactCitation(
    role: string,
    digest: string,
    recordId: RecordId | null,
    cutId: string | null,
): ApplicationArtifactCitation {
    const citation = { cut_id: cutId, digest, record_id: recordId, role };
    return Object.freeze({
        artifact_id: prefixedApplicationId(config.identity.artifactIdPrefix, citation),
        ...citation,
    });
}

function readSurface(value: unknown, subject: string): ApplicationProtocolSurface {
    const fields = readScopeDataObject(value, ["content", "id", "kind", "role"], subject);
    assertScopeText(fields.id, `${subject}.id`);
    assertScopeText(fields.role, `${subject}.role`);
    if (!APPLICATION_PROTOCOL_SURFACES.includes(fields.kind as never)) {
        throw new TypeError(`${subject}.kind must be a configured surface kind`);
    }
    const kind = fields.kind as ApplicationProtocolSurfaceKind;
    const text = canonicalizeSemanticValue(fields.content as SemanticValue);
    if (Buffer.byteLength(text, "utf8") > SURFACE_BYTE_LIMITS[kind]) {
        throw new TypeError(`${subject}.content exceeds the configured byte bound`);
    }
    return Object.freeze({
        content: JSON.parse(text) as SemanticValue,
        id: fields.id,
        kind,
        role: fields.role,
    });
}

function readBudgets(value: unknown): Readonly<Record<string, number>> {
    const object = value as Record<string, unknown> | null;
    const keys = object === null || typeof object !== "object" ? [] : Object.keys(object);
    const fields = readScopeDataObject(value, [], "budgets", keys);
    const budgets: Record<string, number> = {};
    for (const key of keys) {
        assertScopeText(key, "budgets metric name");
        if (!Number.isSafeInteger(fields[key]) || (fields[key] as number) < 0) {
            throw new TypeError(`budgets.${key} must be a non-negative safe integer`);
        }
        budgets[key] = fields[key] as number;
    }
    return Object.freeze(budgets);
}

/** Validates distinct safe-integer protocol seeds within the configured bound. @internal */
export function readSeeds(value: unknown): readonly number[] {
    const seeds = readScopeArray(value, "seeds");
    if (
        seeds.length === 0 ||
        seeds.length > config.limits.maxSeeds ||
        !seeds.every((seed) => Number.isSafeInteger(seed)) ||
        new Set(seeds).size !== seeds.length
    ) {
        throw new TypeError("seeds must be distinct safe integers within the configured bound");
    }
    return Object.freeze(seeds as number[]);
}

/** Validates one dataset selection with distinct items within the configured bound. @internal */
export function readDataset(value: unknown): ApplicationDatasetSelection {
    const fields = readScopeDataObject(value, ["id", "items", "revision"], "dataset");
    assertScopeText(fields.id, "dataset.id");
    assertScopeText(fields.revision, "dataset.revision");
    const items = readScopeArray(fields.items, "dataset.items").map((item, index) => {
        assertScopeText(item, `dataset.items[${index}]`);
        return item;
    });
    if (items.length > config.limits.maxDatasetItems || new Set(items).size !== items.length) {
        throw new TypeError("dataset.items must be distinct and within the configured bound");
    }
    return Object.freeze({ id: fields.id, items: Object.freeze(items), revision: fields.revision });
}
