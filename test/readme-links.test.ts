import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { readReleaseIntegrityConfiguration } from "../tooling/release/integrity-config.ts";
import {
    checkPackedMarkdownLinks,
    markdownLinkTargets,
    type RepositoryManifest,
    repositoryWebUrl,
} from "../tooling/release/readme-links.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const blobBase = "https://github.com/o/r/blob/main";

test("Markdown link targets skip code and include nested, reference, and HTML targets", () => {
    const markdown = [
        '[a](./a.md) and ![img](img.png "title") and [![nested](in.png)](<out.mp4>)',
        "Inline `[code](./code.md)` is ignored.",
        "```sh",
        "[fenced](./fenced.md)",
        "```",
        "[ref]: ./ref.md#part",
        '<a href="./html.md"><img src="https://example.com/x.png"></a>',
    ].join("\n");
    assert.deepEqual(markdownLinkTargets(markdown), [
        "./a.md",
        "img.png",
        "in.png",
        "out.mp4",
        "./ref.md#part",
        "./html.md",
        "https://example.com/x.png",
    ]);
});

test("repository web URLs are derived from package.json repository forms", () => {
    const cases: readonly [RepositoryManifest, string][] = [
        [{ repository: { url: "git+ssh://git@github.com/o/r.git" } }, "https://github.com/o/r"],
        [{ repository: "git+https://github.com/o/r.git" }, "https://github.com/o/r"],
        [{ repository: "https://gitlab.example:8443/g/s/r/" }, "https://gitlab.example/g/s/r"],
        [{ repository: "git@github.com:o/r.git" }, "https://github.com/o/r"],
    ];
    for (const [manifest, expected] of cases) {
        assert.equal(repositoryWebUrl(manifest), expected);
    }
    for (const manifest of [{}, { repository: {} }, { repository: "o/r" }]) {
        assert.throws(() => repositoryWebUrl(manifest), TypeError);
    }
});

test("packed Markdown links resolve inside the tarball or to absolute URLs", () => {
    const markdown = [
        "[license](./LICENSE) [ref](docs/api%20ref.md#symbol) [top](#top) [q](./NOTICE?x=1)",
        "[web](https://example.com) [mail](mailto:a@b.c) [proto](//cdn.example/x.js)",
        `[repo](${blobBase}/docs/guide.md#section) [again](${blobBase}/docs/guide.md)`,
        `[other](https://github.com/o/r/issues/1) [encoded](${blobBase}/docs/a%20b.md)`,
        "[missing](./docs/guide.md) [plan](./.plan/README.md) [dir](./docs/) [up](../x.md)",
    ].join("\n");
    assert.deepEqual(
        checkPackedMarkdownLinks({
            markdown,
            markdownPath: "README.md",
            packedPaths: ["LICENSE", "NOTICE", "README.md", "docs/api ref.md"],
            repositoryBlobBase: blobBase,
        }),
        {
            repositoryPaths: ["docs/a b.md", "docs/guide.md"],
            unresolved: ["../x.md", "./.plan/README.md", "./docs/", "./docs/guide.md"],
        },
    );
    assert.deepEqual(
        checkPackedMarkdownLinks({
            markdown: "[up](../LICENSE) [self](./x.md)",
            markdownPath: "docs/guide.md",
            packedPaths: ["LICENSE", "docs/x.md"],
            repositoryBlobBase: blobBase,
        }).unresolved,
        [],
    );
});

test("the repository README resolves when packed with the package files", async () => {
    const configuration = await readReleaseIntegrityConfiguration(repositoryRoot);
    const manifest = JSON.parse(
        readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as RepositoryManifest & { readonly files: readonly string[] };
    const readme = configuration.packedReadme.path;
    const report = checkPackedMarkdownLinks({
        markdown: readFileSync(path.join(repositoryRoot, readme), "utf8"),
        markdownPath: readme,
        packedPaths: manifest.files.map((entry) => entry.replace(/^\//u, "")),
        repositoryBlobBase: `${repositoryWebUrl(manifest)}/blob/${configuration.packedReadme.repositoryRef}`,
    });
    assert.deepEqual(report.unresolved, []);
    assert.ok(report.repositoryPaths.length > 0);
});
