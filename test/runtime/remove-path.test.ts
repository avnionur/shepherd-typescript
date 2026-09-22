import assert from "node:assert/strict";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removePathSync } from "../../src/runtime/remove-path.ts";

function present(target: string): boolean {
    return lstatSync(target, { throwIfNoEntry: false }) !== undefined;
}

// F-031: `fs.rmSync` on Node.js 24.12.x and 24.13.x leaves a dangling symbolic link in place
// without throwing. Every assertion below on a dangling link fails there if the helper delegates
// the link to `rmSync`.
test("removePathSync removes dangling symbolic links with every option combination", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-remove-path-"));
    context.after(() => rmSync(root, { force: true, recursive: true }));
    const optionSets = [{}, { force: true }, { recursive: true }, { force: true, recursive: true }];
    for (const [index, options] of optionSets.entries()) {
        const link = path.join(root, `dangling-${index}`);
        symlinkSync(path.join(root, "missing"), link);
        removePathSync(link, options);
        assert.equal(present(link), false, JSON.stringify(options));
    }
    const chained = path.join(root, "chained");
    symlinkSync(path.join(root, "dangling-link"), path.join(root, "dangling-link-target"));
    symlinkSync(path.join(root, "dangling-link-target"), chained);
    removePathSync(chained, { force: true });
    assert.equal(present(chained), false);
    assert.equal(present(path.join(root, "dangling-link-target")), true);
});

test("removePathSync removes a link to a file or directory without touching its target", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-remove-path-"));
    context.after(() => rmSync(root, { force: true, recursive: true }));
    const directory = path.join(root, "directory");
    mkdirSync(directory);
    writeFileSync(path.join(directory, "inner.txt"), "inner\n");
    const file = path.join(root, "file.txt");
    writeFileSync(file, "file\n");
    symlinkSync(directory, path.join(root, "directory-link"));
    symlinkSync(file, path.join(root, "file-link"));

    removePathSync(path.join(root, "directory-link"), { force: true, recursive: true });
    removePathSync(path.join(root, "file-link"));

    assert.equal(present(path.join(root, "directory-link")), false);
    assert.equal(present(path.join(root, "file-link")), false);
    assert.equal(readFileSync(path.join(directory, "inner.txt"), "utf8"), "inner\n");
    assert.equal(readFileSync(file, "utf8"), "file\n");
});

test("removePathSync keeps rmSync semantics for files, directories, and missing paths", (context) => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-remove-path-"));
    context.after(() => rmSync(root, { force: true, recursive: true }));
    const file = path.join(root, "file.txt");
    writeFileSync(file, "file\n");
    removePathSync(file);
    assert.equal(existsSync(file), false);

    const directory = path.join(root, "directory");
    mkdirSync(path.join(directory, "nested"), { recursive: true });
    symlinkSync(path.join(root, "missing"), path.join(directory, "nested", "dangling"));
    assert.throws(() => removePathSync(directory), { code: "ERR_FS_EISDIR" });
    removePathSync(directory, { recursive: true });
    assert.equal(present(directory), false);

    assert.throws(() => removePathSync(path.join(root, "missing")), { code: "ENOENT" });
    assert.doesNotThrow(() => removePathSync(path.join(root, "missing"), { force: true }));
});

test("product code removes paths only through removePathSync", () => {
    const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
    const helper = path.join(sourceRoot, "runtime", "remove-path.ts");
    const offenders = readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter((file) => file !== helper && /\brmSync\b/u.test(readFileSync(file, "utf8")))
        .map((file) => path.relative(sourceRoot, file));
    assert.deepEqual(offenders, []);
});
