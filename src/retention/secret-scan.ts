import { createHash, createHmac, randomBytes } from "node:crypto";

import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { retentionProtocolConfig } from "../protocol/config.ts";

/**
 * One configured detector match, reported without the matched text.
 *
 * @public
 */
export type SecretFinding = {
    /**
     * Keyed digest of the matched text: an HMAC under the configured retention digest algorithm
     * with a random key created once per process, prefixed by
     * `retention.scanning.findingDigestPrefix`. Equal matches have equal digests within one
     * process, so findings can be deduplicated and correlated there, but a digest cannot be
     * recomputed elsewhere to confirm a guessed secret.
     */
    readonly digest: string;
    /**
     * Whether the match was an object key or a string value. A key match reports the pointer of
     * the containing object, and its value is not descended into, so no reported pointer contains
     * matched text.
     */
    readonly location: "key" | "value";
    /** RFC 6901 JSON Pointer to the matching value, or to the object owning a matching key. */
    readonly path: string;
    /** Configured secret-class name. */
    readonly secret_class: string;
};

/**
 * Result of scanning one semantic value with the configured detectors.
 *
 * @public
 */
export type SecretScanReport = {
    /** Unique findings in canonical key order, bounded by the configured finding limit. */
    readonly findings: readonly SecretFinding[];
    /** Sorted unique secret-class names of the reported findings. */
    readonly secret_classes: readonly string[];
    /** Whether more findings existed than the configured limit allows. */
    readonly truncated: boolean;
};

type CompiledDetector = {
    readonly expression: RegExp;
    readonly name: string;
};

type FindingCollector = {
    readonly findings: SecretFinding[];
    readonly keys: Set<string>;
    truncated: boolean;
};

const detectors: readonly CompiledDetector[] = retentionProtocolConfig.secretClasses.map(
    ({ flags, name, pattern }) => ({ expression: new RegExp(pattern, `${flags}g`), name }),
);

// A key as long as the algorithm's output; it never leaves this process.
const findingDigestKey = randomBytes(
    createHash(retentionProtocolConfig.digestAlgorithm).digest().length,
);

function findingDigest(text: string): string {
    return `${retentionProtocolConfig.scanning.findingDigestPrefix}${createHmac(
        retentionProtocolConfig.digestAlgorithm,
        findingDigestKey,
    )
        .update(text, "utf8")
        .digest("hex")}`;
}

/**
 * Scans a semantic value for configured secret classes without retaining matched text.
 *
 * The value is canonicalized first, so object keys are visited in canonical order. Every string
 * value and object key is matched against every configured detector. Findings carry the class, a
 * JSON Pointer, and a per-process keyed digest of the matched text; the matched text itself is
 * never returned, logged, or included in an error, and the digest cannot be used outside this
 * process to confirm a guessed secret. Detection is pattern-based and incomplete by design.
 *
 * @param value - Plain semantic value, such as a record body.
 * @returns A frozen report with unique findings, their sorted classes, and a truncation flag.
 * @throws {TypeError} If the value is not a canonicalizable semantic value.
 *
 * @example
 * ```ts
 * const report = scanSemanticValueForSecrets({ headers: { authorization: token } });
 * for (const finding of report.findings) {
 *     console.log(finding.secret_class, finding.path);
 * }
 * ```
 *
 * @public
 */
export function scanSemanticValueForSecrets(value: SemanticValue): SecretScanReport {
    const collector = createSecretCollector();
    collectSecretFindings(value, "", collector);
    return finishSecretScan(collector);
}

/** Creates an empty finding collector shared across several scanned values. @internal */
export function createSecretCollector(): FindingCollector {
    return { findings: [], keys: new Set(), truncated: false };
}

/** Scans one value below a JSON Pointer prefix into a shared collector. @internal */
export function collectSecretFindings(
    value: SemanticValue,
    pointerPrefix: string,
    collector: FindingCollector,
): void {
    visit(JSON.parse(canonicalizeSemanticValue(value)) as unknown, pointerPrefix, collector);
}

/** Freezes a collector into a report. @internal */
export function finishSecretScan(collector: FindingCollector): SecretScanReport {
    const findings = collector.findings.map((finding) => Object.freeze({ ...finding }));
    return Object.freeze({
        findings: Object.freeze(findings),
        secret_classes: Object.freeze(
            [...new Set(findings.map(({ secret_class }) => secret_class))].sort(),
        ),
        truncated: collector.truncated,
    });
}

/** Digests text under the configured retention digest algorithm. @internal */
export function retentionDigest(text: string): string {
    return `${retentionProtocolConfig.digestPrefix}${createHash(
        retentionProtocolConfig.digestAlgorithm,
    )
        .update(text, "utf8")
        .digest("hex")}`;
}

function visit(value: unknown, pointer: string, collector: FindingCollector): void {
    if (typeof value === "string") {
        matchText(value, pointer, "value", collector);
        return;
    }
    if (value === null || typeof value !== "object") {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        // A matching key is reported at its owner and never becomes part of a pointer.
        if (!matchText(key, pointer, "key", collector)) {
            visit(
                child,
                `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
                collector,
            );
        }
    }
}

function matchText(
    text: string,
    path: string,
    location: SecretFinding["location"],
    collector: FindingCollector,
): boolean {
    let matched = false;
    for (const { expression, name } of detectors) {
        for (const match of text.matchAll(expression)) {
            matched = true;
            const finding = {
                digest: findingDigest(match[0]),
                location,
                path,
                secret_class: name,
            };
            const key = `${name}\0${location}\0${path}\0${finding.digest}`;
            if (collector.keys.has(key)) {
                continue;
            }
            if (collector.findings.length >= retentionProtocolConfig.limits.maxFindings) {
                collector.truncated = true;
                continue;
            }
            collector.keys.add(key);
            collector.findings.push(finding);
        }
    }
    return matched;
}
