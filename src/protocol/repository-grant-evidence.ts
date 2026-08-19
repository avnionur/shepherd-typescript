import { createRecordId, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { recordIdConfig, taskProtocolConfig, workspaceProtocolConfig } from "./config.ts";

const PROFILE_ATOMS = new Map(
    workspaceProtocolConfig.repositoryGrants.profiles.map(({ atoms, name }) => [name, atoms]),
);

/**
 * Decodes and rehashes one exact persisted repository grant-plan descriptor.
 *
 * @param value - Untrusted retained semantic value.
 * @returns Frozen canonical grant-plan evidence with a verified content-addressed identity.
 * @throws {TypeError} If shape, vocabulary, ordering, effective authority, or identity is invalid.
 *
 * @internal
 */
export function readRepositoryGrantPlanEvidence(value: unknown): SemanticRecord {
    const fields = readExactObject(
        value,
        [
            "authority_ceiling",
            "enforcement",
            "grant_plan_version",
            "grants",
            "plan_id",
            "task_artifact_digest",
            "task_grant_artifact_digest",
        ],
        "repository grant plan evidence",
    );
    const ceiling = readProfile(fields.authority_ceiling, "repository grant authority ceiling");
    if (
        fields.enforcement !== workspaceProtocolConfig.repositoryGrants.enforcement ||
        fields.grant_plan_version !== workspaceProtocolConfig.repositoryGrants.planVersion
    ) {
        throw new TypeError("repository grant plan protocol evidence is inconsistent");
    }
    assertDigest(
        fields.task_artifact_digest,
        taskProtocolConfig.digestPrefix,
        taskProtocolConfig.hexLength,
        "task artifact",
    );
    assertDigest(
        fields.task_grant_artifact_digest,
        recordIdConfig.prefix,
        recordIdConfig.hexLength,
        "task grant artifact",
    );
    if (!Array.isArray(fields.grants) || fields.grants.length === 0) {
        throw new TypeError("repository grant plan entries are invalid");
    }
    const ceilingAtoms = profileAtoms(ceiling);
    const names = new Set<string>();
    let previousName: string | null = null;
    const grants = fields.grants.map((value, index) => {
        const entry = readExactObject(
            value,
            ["authority", "binding_id", "binding_name", "resource_id", "task_profile"],
            `repository grant plan entry ${index}`,
        );
        const bindingName = readBindingName(entry.binding_name);
        if (names.has(bindingName) || (previousName !== null && previousName >= bindingName)) {
            throw new TypeError("repository grant plan binding order is invalid");
        }
        names.add(bindingName);
        previousName = bindingName;
        const taskProfile = readProfile(entry.task_profile, "repository grant task profile");
        const authority = readAuthority(entry.authority);
        const effective = profileAtoms(taskProfile).filter((atom) => ceilingAtoms.includes(atom));
        if (
            authority.length !== effective.length ||
            authority.some((atom, atomIndex) => atom !== effective[atomIndex])
        ) {
            throw new TypeError(
                "repository grant plan authority is not the configured intersection",
            );
        }
        assertDigest(
            entry.binding_id,
            recordIdConfig.prefix,
            recordIdConfig.hexLength,
            "repository binding",
        );
        assertDigest(
            entry.resource_id,
            recordIdConfig.prefix,
            recordIdConfig.hexLength,
            "repository resource",
        );
        return Object.freeze({
            authority: Object.freeze(authority),
            binding_id: entry.binding_id as string,
            binding_name: bindingName,
            resource_id: entry.resource_id as string,
            task_profile: taskProfile,
        });
    });
    const semantic = createCanonicalSnapshot({
        authority_ceiling: ceiling,
        enforcement: workspaceProtocolConfig.repositoryGrants.enforcement,
        grants,
        grant_plan_version: workspaceProtocolConfig.repositoryGrants.planVersion,
        task_artifact_digest: fields.task_artifact_digest as string,
        task_grant_artifact_digest: fields.task_grant_artifact_digest as string,
    });
    const digest = createRecordId(semantic);
    const expectedPlanId = `${workspaceProtocolConfig.repositoryGrants.planIdPrefix}${digest.slice(
        digest.lastIndexOf(":") + 1,
    )}`;
    if (fields.plan_id !== expectedPlanId) {
        throw new TypeError("repository grant plan identity is inconsistent");
    }
    return createCanonicalSnapshot({ ...semantic, plan_id: expectedPlanId });
}

function readProfile(value: unknown, subject: string): string {
    if (
        typeof value !== "string" ||
        !workspaceProtocolConfig.repositoryGrants.profiles.some(({ name }) => name === value)
    ) {
        throw new TypeError(`${subject} is unsupported`);
    }
    return value;
}

function profileAtoms(profile: string): readonly string[] {
    return PROFILE_ATOMS.get(profile) as readonly string[];
}

function readAuthority(value: unknown): readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError("repository grant plan authority is invalid");
    }
    const authority = value.map((atom) => {
        if (
            typeof atom !== "string" ||
            !workspaceProtocolConfig.repositoryGrants.atoms.includes(atom)
        ) {
            throw new TypeError("repository grant plan authority atom is unsupported");
        }
        return atom;
    });
    if (new Set(authority).size !== authority.length) {
        throw new TypeError("repository grant plan authority atoms must be unique");
    }
    return authority;
}

function readBindingName(value: unknown): string {
    if (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value === "." ||
        value === ".." ||
        value.includes("/") ||
        value.includes("\\") ||
        value.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(value)
    ) {
        throw new TypeError("repository grant plan binding name is invalid");
    }
    return value;
}

function assertDigest(
    value: unknown,
    prefix: string,
    hexLength: number,
    subject: string,
): asserts value is string {
    if (typeof value !== "string" || !value.startsWith(prefix)) {
        throw new TypeError(`${subject} identity is invalid`);
    }
    const suffix = value.slice(prefix.length);
    if (suffix.length !== hexLength || !/^[0-9a-f]+$/u.test(suffix)) {
        throw new TypeError(`${subject} identity is invalid`);
    }
}

function readExactObject(
    value: unknown,
    expected: readonly string[],
    subject: string,
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        expected.some((key) => !("value" in (descriptors[key] as PropertyDescriptor)))
    ) {
        throw new TypeError(`${subject} must be exact data`);
    }
    return Object.fromEntries(
        expected.map((key) => [key, (descriptors[key] as PropertyDescriptor).value]),
    );
}
