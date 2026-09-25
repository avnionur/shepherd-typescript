import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
    readConfigurationAsset,
    resolveConfigurationAssetUrl,
} from "../../src/errors/configuration-asset.ts";
import { publicErrorCodes } from "../../src/errors/public-errors.ts";
import { ConfigurationAssetError, isPublicError } from "../../src/index.ts";

function temporaryDirectory(context: { after(callback: () => unknown): void }): string {
    const directory = mkdtempSync(path.join(tmpdir(), "shepherd-config-asset-"));
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    return directory;
}

test("a missing configuration asset raises the configured public error with its path", (context) => {
    const directory = temporaryDirectory(context);
    const url = resolveConfigurationAssetUrl(
        "../protocol.config.json",
        pathToFileURL(path.join(directory, "nested", "module.js")).href,
    );
    const expectedPath = path.join(directory, "protocol.config.json");

    assert.throws(
        () => readConfigurationAsset(url),
        (error: unknown) => {
            assert.ok(error instanceof ConfigurationAssetError);
            assert.ok(isPublicError(error));
            assert.equal(error.code, publicErrorCodes.configuration.assetMissing);
            assert.equal(error.name, "ConfigurationAssetError");
            assert.equal(error.asset, "protocol.config.json");
            assert.equal(error.expectedPath, expectedPath);
            assert.ok(error.message.includes(expectedPath));
            assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
            return true;
        },
    );
});

test("bundle formats without a module URL are refused with the same public error", () => {
    for (const moduleUrl of [undefined, "", "not a url"]) {
        assert.throws(
            () => resolveConfigurationAssetUrl("../../runtime.config.json", moduleUrl),
            (error: unknown) => {
                assert.ok(error instanceof ConfigurationAssetError);
                assert.equal(error.code, publicErrorCodes.configuration.assetMissing);
                assert.equal(error.asset, "runtime.config.json");
                assert.match(error.expectedPath, /^\.\.\/\.\.\/runtime\.config\.json relative/u);
                return true;
            },
        );
    }
});

test("present assets parse and other read or parse failures stay unclassified", (context) => {
    const directory = temporaryDirectory(context);
    const valid = path.join(directory, "valid.json");
    const invalid = path.join(directory, "invalid.json");
    writeFileSync(valid, '{"node":">=1.0.0 <2"}');
    writeFileSync(invalid, "{");

    assert.deepEqual(readConfigurationAsset(pathToFileURL(valid)), { node: ">=1.0.0 <2" });
    assert.throws(() => readConfigurationAsset(pathToFileURL(invalid)), SyntaxError);
    assert.throws(
        () => readConfigurationAsset(pathToFileURL(directory)),
        (error: unknown) =>
            !(error instanceof ConfigurationAssetError) &&
            (error as NodeJS.ErrnoException).code === "EISDIR",
    );
});
