import {
    readConfigurationAsset,
    resolveConfigurationAssetUrl,
} from "../errors/configuration-asset.ts";

/** Validated bounded Node version policy. @internal */
export type NodeRuntimePolicy = {
    /** Canonical package-engine expression. */
    readonly node: string;
    /** Inclusive minimum major, minor and patch. */
    readonly minimum: readonly [number, number, number];
    /** Exclusive upper major. */
    readonly maximumMajor: number;
};

/** Runtime policy asset shared by source, build and installed consumers. @internal */
export const runtimePolicyConfigUrl = resolveConfigurationAssetUrl(
    "../../runtime.config.json",
    import.meta.url,
);

/** Parses the closed bounded-major policy without evaluating accessors. @internal */
export function parseNodeRuntimePolicy(value: unknown): NodeRuntimePolicy {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("runtime policy must be a closed node-range object");
    }
    const fields = Object.getOwnPropertyDescriptors(value);
    const node: unknown = fields.node?.value;
    if (
        Object.keys(fields).length !== 1 ||
        Object.getOwnPropertySymbols(value).length !== 0 ||
        typeof node !== "string"
    ) {
        throw new TypeError("runtime policy must contain only a node range");
    }
    const match = /^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*) <(0|[1-9]\d*)$/u.exec(node);
    if (match === null) throw new TypeError("runtime policy requires >=major.minor.patch <major");
    const parts = match.slice(1).map(Number);
    if (
        parts.some((part) => !Number.isSafeInteger(part)) ||
        (parts[0] as number) >= (parts[3] as number)
    ) {
        throw new TypeError("runtime policy bounds must be safe and increasing");
    }
    return Object.freeze({
        node,
        minimum: Object.freeze(parts.slice(0, 3)) as readonly [number, number, number],
        maximumMajor: parts[3] as number,
    });
}

/** Validated configuration-owned engine policy. @internal */
export const nodeRuntimePolicy = parseNodeRuntimePolicy(
    readConfigurationAsset(runtimePolicyConfigUrl),
);

/** Rejects unsupported/prerelease Node versions before runtime side effects. @internal */
export function assertNodeRuntime(
    version = process.versions.node,
    policy = nodeRuntimePolicy,
): void {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
    const parts = match?.slice(1).map(Number);
    const failure = new Error(`Unsupported Node.js runtime ${version}; required ${policy.node}`);
    if (
        parts === undefined ||
        parts.some((part) => !Number.isSafeInteger(part)) ||
        (parts[0] as number) >= policy.maximumMajor
    )
        throw failure;
    for (let index = 0; index < policy.minimum.length; index += 1) {
        if ((parts[index] as number) < (policy.minimum[index] as number)) throw failure;
        if ((parts[index] as number) > (policy.minimum[index] as number)) return;
    }
}
