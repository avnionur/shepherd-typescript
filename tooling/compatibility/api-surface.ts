import { createHash } from "node:crypto";

import { canonicalizeSemanticValue } from "../../src/canonical/canonical-record.ts";
import {
    type ApiReferenceOptions,
    type PublishedApi,
    readPublishedApi,
} from "../api-reference/generator.ts";

/** Configured JSDoc deprecation convention. */
export type DeprecationConvention = {
    /** Regular expression with a named `version` group that reads the deprecation release. */
    readonly sincePattern: string;
    /** JSDoc tag name that marks a deprecated export, without `@`. */
    readonly tag: string;
};

/** Compatibility fingerprint of one exported symbol. */
export type ApiSymbolFingerprint = {
    /**
     * Release that deprecated the symbol, `null` when the deprecation tag names no release, or
     * absent when the symbol is not deprecated.
     */
    readonly deprecatedSince?: string | null;
    /** `sha256:` digest of the canonical classification, kind, and printed declaration. */
    readonly digest: string;
    /** Declaration kind from the API reference. */
    readonly kind: string;
};

/** Compatibility fingerprints of every supported package entry. */
export type ApiSurface = {
    /** Symbol fingerprints keyed by package entry, then exported name, both sorted. */
    readonly entries: Readonly<Record<string, Readonly<Record<string, ApiSymbolFingerprint>>>>;
    /** Package version the surface was read from. */
    readonly packageVersion: string;
};

/**
 * Reads the public API surface from emitted declarations and fingerprints every export.
 *
 * @param options - API-reference repository, manifest, and configuration paths.
 * @param deprecation - Configured deprecation tag and release pattern.
 * @returns Per-entry symbol fingerprints and the package version.
 * @throws {TypeError} If API-reference configuration, exports, or the deprecation pattern are
 * invalid.
 * @throws {Error} If declarations cannot be read.
 */
export async function extractApiSurface(
    options: ApiReferenceOptions,
    deprecation: DeprecationConvention,
): Promise<ApiSurface> {
    return fingerprintPublishedApi(await readPublishedApi(options), deprecation);
}

/**
 * Fingerprints an already-read public API.
 *
 * Declaration digests exclude JSDoc text, so documentation edits never change a fingerprint;
 * deprecation is recorded separately from the digest.
 *
 * @param api - Published entries and symbols.
 * @param deprecation - Configured deprecation tag and release pattern.
 * @returns Per-entry symbol fingerprints with sorted keys.
 * @throws {SyntaxError} If the configured release pattern is not a valid regular expression.
 */
export function fingerprintPublishedApi(
    api: PublishedApi,
    deprecation: DeprecationConvention,
): ApiSurface {
    const sincePattern = new RegExp(deprecation.sincePattern, "u");
    const entries: Record<string, Record<string, ApiSymbolFingerprint>> = {};
    for (const entry of api.entries) {
        const symbols: Record<string, ApiSymbolFingerprint> = {};
        for (const symbol of entry.symbols) {
            const digest = `sha256:${createHash("sha256")
                .update(
                    canonicalizeSemanticValue({
                        classification: symbol.classification,
                        kind: symbol.kind,
                        signature: symbol.signature,
                    }),
                    "utf8",
                )
                .digest("hex")}`;
            const tag = symbol.tags.find(({ name }) => name === deprecation.tag);
            symbols[symbol.name] =
                tag === undefined
                    ? { digest, kind: symbol.kind }
                    : {
                          deprecatedSince: sincePattern.exec(tag.text)?.groups?.version ?? null,
                          digest,
                          kind: symbol.kind,
                      };
        }
        entries[entry.entryName] = symbols;
    }
    return { entries, packageVersion: api.packageVersion };
}
