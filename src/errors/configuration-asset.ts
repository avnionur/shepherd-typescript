import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIGURATION_ASSET_MISSING_CODE } from "../protocol/values.generated.ts";
import type { PublicErrorCode } from "./public-errors.ts";

/**
 * Raised when a runtime configuration asset that Shepherd loads next to its modules cannot be
 * found or located.
 *
 * Shepherd reads `runtime.config.json`, `protocol.config.json`, and `public-errors.config.json`
 * relative to the loading module's URL. A bundler that inlines Shepherd without copying those
 * assets, or a bundle format without `import.meta.url` (for example a CommonJS bundle), triggers
 * this error while the module graph is evaluated. The `code` is generated from
 * `public-errors.config.json` into the module source, so it is available even when that asset is
 * the one missing. The message and `expectedPath` name only the expected location, never file
 * contents. See `docs/package-exports.md` for supported bundle layouts.
 *
 * @example
 * ```ts
 * try {
 *     await import("@avnionur/shepherd-typescript");
 * } catch (error) {
 *     if (isPublicError(error) && error.code === "CONFIGURATION_ASSET_MISSING") {
 *         console.error((error as ConfigurationAssetError).expectedPath);
 *     }
 * }
 * ```
 *
 * @public
 */
export class ConfigurationAssetError extends Error {
    /** Stable configured machine-readable configuration-asset code. */
    readonly code: PublicErrorCode = CONFIGURATION_ASSET_MISSING_CODE;
    /** File name of the missing configuration asset, such as `protocol.config.json`. */
    readonly asset: string;
    /**
     * Absolute filesystem path where the asset was expected, or the module-relative specifier
     * when the module URL is unavailable in the running bundle format.
     */
    readonly expectedPath: string;

    /**
     * Creates a refusal naming the missing asset and its expected location.
     *
     * @param asset - File name of the missing configuration asset.
     * @param expectedPath - Absolute expected path, or module-relative specifier.
     * @param options - Optional in-memory cause.
     */
    constructor(asset: string, expectedPath: string, options?: ErrorOptions) {
        super(
            `Shepherd configuration asset ${asset} was not found; expected it at ${expectedPath}. ` +
                "Bundled consumers must ship the package configuration assets next to the bundle " +
                "(see docs/package-exports.md).",
            options,
        );
        this.name = "ConfigurationAssetError";
        this.asset = asset;
        this.expectedPath = expectedPath;
    }
}

/**
 * Resolves a module-relative configuration asset URL, refusing bundle formats without a module URL.
 *
 * @param specifier - Asset path relative to the loading module, such as `../../x.config.json`.
 * @param moduleUrl - The loading module's `import.meta.url`; `undefined` in CommonJS bundles.
 * @returns The absolute asset URL.
 * @throws {ConfigurationAssetError} If `moduleUrl` is absent or not a URL.
 * @internal
 */
export function resolveConfigurationAssetUrl(
    specifier: string,
    moduleUrl: string | undefined,
): URL {
    const base = typeof moduleUrl === "string" ? URL.parse(moduleUrl) : null;
    if (base === null) {
        throw new ConfigurationAssetError(
            path.posix.basename(specifier),
            `${specifier} relative to the Shepherd module (import.meta.url is unavailable in this bundle format)`,
        );
    }
    return new URL(specifier, base);
}

/**
 * Reads and parses one JSON configuration asset, classifying only a missing file.
 *
 * @param url - Absolute `file:` URL of the asset.
 * @returns The parsed JSON value.
 * @throws {ConfigurationAssetError} If the asset does not exist.
 * @throws {Error} For any other read or parse failure, unchanged.
 * @internal
 */
export function readConfigurationAsset(url: URL): unknown {
    let text: string;
    try {
        text = readFileSync(url, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
        const expectedPath = fileURLToPath(url);
        throw new ConfigurationAssetError(path.basename(expectedPath), expectedPath, {
            cause: error,
        });
    }
    return JSON.parse(text);
}
