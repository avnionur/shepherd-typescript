import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { kernelProtocolConfig, retentionProtocolConfig } from "../protocol/config.ts";
import { removePathSync } from "../runtime/remove-path.ts";
import type { SQLiteTraceStoreOptions } from "./types.ts";

/** Resolved blob-directory ownership for one store instance. */
export type ResolvedBlobDirectory = {
    readonly cleanup: () => void;
    readonly path: string;
};

/** Resolves and validates the blob directory without accepting open option shapes. */
export function resolveBlobDirectory(
    databasePath: string,
    options: SQLiteTraceStoreOptions,
): ResolvedBlobDirectory {
    validateStoreOptions(options);
    if (options.readOnly === true && databasePath === ":memory:") {
        throw new TypeError("read-only trace stores require a file database");
    }
    const trustedBases = createTrustedPathBases(databasePath);
    if (options.blobDirectory !== undefined) {
        if (options.blobDirectory.length === 0) {
            throw new TypeError("blobDirectory must be a non-empty path");
        }
        return {
            cleanup: () => undefined,
            path: resolveAgainstTrustedBase(options.blobDirectory, trustedBases),
        };
    }
    if (databasePath === ":memory:") {
        const temporaryPath = mkdtempSync(path.join(tmpdir(), "shepherd-blobs-"));
        return {
            cleanup: () => removePathSync(temporaryPath, { force: true, recursive: true }),
            path: realpathSync(temporaryPath),
        };
    }
    const databaseFilePath = resolveAgainstTrustedBase(databasePath, trustedBases);
    return {
        cleanup: () => undefined,
        path: `${databaseFilePath}${kernelProtocolConfig.store.blobs.directorySuffix}`,
    };
}

type TrustedPathBase = {
    readonly canonical: string;
    readonly lexical: string;
};

function createTrustedPathBases(databasePath: string): readonly TrustedPathBase[] {
    const lexicalBases = [path.resolve(process.cwd()), path.resolve(tmpdir())];
    if (databasePath !== ":memory:") {
        lexicalBases.push(path.dirname(path.resolve(databasePath)));
    }
    return lexicalBases
        .map((lexical) => ({ canonical: realpathSync(lexical), lexical }))
        .sort((left, right) => right.lexical.length - left.lexical.length);
}

function resolveAgainstTrustedBase(
    requestedPath: string,
    trustedBases: readonly TrustedPathBase[],
): string {
    const absolutePath = path.resolve(requestedPath);
    for (const base of trustedBases) {
        const relative = path.relative(base.lexical, absolutePath);
        if (
            relative === "" ||
            (relative !== ".." &&
                !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative))
        ) {
            return path.join(base.canonical, relative);
        }
    }
    const filesystemRoot = path.parse(absolutePath).root;
    return path.join(realpathSync(filesystemRoot), path.relative(filesystemRoot, absolutePath));
}

function validateStoreOptions(options: SQLiteTraceStoreOptions): void {
    if (
        options === null ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        (Object.getPrototypeOf(options) !== Object.prototype &&
            Object.getPrototypeOf(options) !== null) ||
        Object.getOwnPropertySymbols(options).length > 0
    ) {
        throw new TypeError("SQLiteTraceStore options must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (
        Object.keys(descriptors).some(
            (key) => key !== "blobDirectory" && key !== "readOnly" && key !== "secretScanning",
        ) ||
        Object.values(descriptors).some((descriptor) => !("value" in descriptor)) ||
        (options.blobDirectory !== undefined && typeof options.blobDirectory !== "string") ||
        (options.readOnly !== undefined && typeof options.readOnly !== "boolean") ||
        (options.secretScanning !== undefined &&
            !retentionProtocolConfig.scanning.modes.includes(options.secretScanning))
    ) {
        throw new TypeError(
            "SQLiteTraceStore options must contain only blobDirectory, readOnly, and a configured secretScanning mode",
        );
    }
}
