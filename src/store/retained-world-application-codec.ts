import { createHash } from "node:crypto";

import { canonicalizeRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { workspaceProtocolConfig } from "../protocol/config.ts";
import type { RetainedWorldApplicationPlanEvidence } from "./types.ts";

/** Exact semantic fields encoded into one retained-world application plan. @internal */
export type RetainedWorldApplicationPlanDefinition = Omit<
    RetainedWorldApplicationPlanEvidence,
    "application_version" | "compatibility_version" | "plan_id"
>;

/** Creates one immutable content-addressed retained-world application plan. @internal */
export function encodeRetainedWorldApplicationPlan(
    definition: RetainedWorldApplicationPlanDefinition,
): RetainedWorldApplicationPlanEvidence {
    const fields = readExactObject(definition, [
        "application_custody_id",
        "base_content_id",
        "base_revision_id",
        "binding_id",
        "candidate_changeset_id",
        "candidate_content_id",
        "candidate_paths",
        "candidate_revision_id",
        "current_changeset_id",
        "current_content_id",
        "current_paths",
        "current_revision_id",
        "merged_content_id",
        "merged_revision_id",
        "publication_changeset_id",
        "reason",
        "request_id",
        "status",
    ]);
    const application = workspaceProtocolConfig.settlement.application;
    const semantic = createCanonicalSnapshot({
        application_custody_id: readText(fields.application_custody_id),
        application_version: application.planVersion,
        base_content_id: readText(fields.base_content_id),
        base_revision_id: readText(fields.base_revision_id),
        binding_id: readText(fields.binding_id),
        candidate_changeset_id: readText(fields.candidate_changeset_id),
        candidate_content_id: readText(fields.candidate_content_id),
        candidate_paths: readPaths(fields.candidate_paths),
        candidate_revision_id: readText(fields.candidate_revision_id),
        current_changeset_id: readText(fields.current_changeset_id),
        current_content_id: readText(fields.current_content_id),
        current_paths: readPaths(fields.current_paths),
        current_revision_id: readText(fields.current_revision_id),
        compatibility_version: application.compatibilityVersion,
        merged_content_id: readText(fields.merged_content_id),
        merged_revision_id: readText(fields.merged_revision_id),
        publication_changeset_id: readText(fields.publication_changeset_id),
        reason: readConfiguredText(fields.reason, application.reasons, "reason"),
        request_id: readText(fields.request_id),
        status: readConfiguredText(fields.status, application.statuses, "status"),
    });
    const digest = createHash(workspaceProtocolConfig.digestAlgorithm)
        .update(canonicalizeRecord({ retained_world_application_plan: semantic }))
        .digest("hex");
    return Object.freeze({
        ...semantic,
        plan_id: `${application.planIdPrefix}${digest}`,
    }) as RetainedWorldApplicationPlanEvidence;
}

/** Decodes and rehashes one exact persisted retained-world application plan. @internal */
export function readRetainedWorldApplicationPlan(
    value: unknown,
): RetainedWorldApplicationPlanEvidence {
    const fields = readExactObject(value, [
        "application_custody_id",
        "application_version",
        "base_content_id",
        "base_revision_id",
        "binding_id",
        "candidate_changeset_id",
        "candidate_content_id",
        "candidate_paths",
        "candidate_revision_id",
        "compatibility_version",
        "current_changeset_id",
        "current_content_id",
        "current_paths",
        "current_revision_id",
        "merged_content_id",
        "merged_revision_id",
        "plan_id",
        "publication_changeset_id",
        "reason",
        "request_id",
        "status",
    ]);
    if (
        fields.application_version !== workspaceProtocolConfig.settlement.application.planVersion ||
        fields.compatibility_version !==
            workspaceProtocolConfig.settlement.application.compatibilityVersion
    ) {
        throw new TypeError("retained world application plan version is unsupported");
    }
    const {
        application_version: _version,
        compatibility_version: _compatibility,
        plan_id: planId,
        ...definition
    } = fields;
    const expected = encodeRetainedWorldApplicationPlan(
        definition as RetainedWorldApplicationPlanDefinition,
    );
    if (planId !== expected.plan_id) {
        throw new TypeError("retained world application plan identity is inconsistent");
    }
    return expected;
}

function readPaths(value: unknown): readonly string[] {
    if (
        !Array.isArray(value) ||
        Object.keys(value).length !== value.length ||
        value.length > workspaceProtocolConfig.changesets.maxChanges
    ) {
        throw new TypeError("retained world application paths must be a dense array");
    }
    const paths = value.map(readText);
    if (
        new Set(paths).size !== paths.length ||
        paths.some((path) => !isCanonicalApplicationPath(path)) ||
        paths.some(
            (path, index) =>
                index > 0 &&
                Buffer.from(paths[index - 1] as string).compare(Buffer.from(path)) >= 0,
        )
    ) {
        throw new TypeError("retained world application paths must be unique and canonical");
    }
    return Object.freeze(paths);
}

function isCanonicalApplicationPath(value: string): boolean {
    return (
        value.length > 0 &&
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        Buffer.byteLength(value) <= workspaceProtocolConfig.changesets.maxPathBytes &&
        value
            .split("/")
            .every(
                (part) =>
                    part !== "" &&
                    part !== "." &&
                    part !== ".." &&
                    part !== workspaceProtocolConfig.controlDirectory,
            )
    );
}

function readText(value: unknown): string {
    if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError("retained world application evidence text is invalid");
    }
    return value;
}

function readConfiguredText(value: unknown, allowed: readonly string[], subject: string): string {
    const text = readText(value);
    if (!allowed.includes(text)) {
        throw new TypeError(`retained world application ${subject} is unsupported`);
    }
    return text;
}

function readExactObject(value: unknown, expected: readonly string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError("retained world application evidence must be exact data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError("retained world application evidence must be exact data");
    }
    return Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}
