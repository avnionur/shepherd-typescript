import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inspect } from "node:util";

import { readRetentionPolicy, scanSemanticValueForSecrets } from "../../src/index.ts";
import { CLEAN_TEXT, SECRET_SAMPLES } from "./fixtures.ts";

const retention = (
    JSON.parse(readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8")) as {
        readonly retention: {
            readonly digestAlgorithm: string;
            readonly digestPrefix: string;
            readonly limits: { readonly maxFindings: number };
            readonly scanning: { readonly findingDigestPrefix: string };
        };
    }
).retention;

/** The finding digest of `text` in this process, taken from a scan of the text alone. */
function digestOf(text: string): string {
    const digest = scanSemanticValueForSecrets(text).findings[0]?.digest;
    assert.ok(digest !== undefined);
    return digest;
}

test("finding digests are keyed per process and are not a digest of the matched text", async () => {
    const sample = SECRET_SAMPLES["github-token"] as string;
    const digest = digestOf(sample);
    const hexLength = createHash(retention.digestAlgorithm).digest("hex").length;
    assert.match(
        digest,
        new RegExp(`^${retention.scanning.findingDigestPrefix}[0-9a-f]{${hexLength}}$`, "u"),
    );
    assert.equal(digestOf(sample), digest);
    const unkeyed = createHash(retention.digestAlgorithm).update(sample).digest("hex");
    assert.equal(digest.endsWith(unkeyed), false);
    const program = `
        import { scanSemanticValueForSecrets } from ${JSON.stringify(new URL("../../src/index.ts", import.meta.url).href)};
        process.stdout.write(scanSemanticValueForSecrets(process.argv[1]).findings[0].digest);
    `;
    const other = await new Promise<string>((resolve, reject) => {
        execFile(
            process.execPath,
            ["--input-type=module", "-e", program, sample],
            (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
        );
    });
    assert.match(other, new RegExp(`^${retention.scanning.findingDigestPrefix}`, "u"));
    assert.notEqual(other, digest);
});

test("every configured secret class has a synthetic sample and is detected by path", () => {
    const classes = readRetentionPolicy().secret_classes;
    assert.deepEqual([...classes].sort(), Object.keys(SECRET_SAMPLES).sort());
    for (const secretClass of classes) {
        const sample = SECRET_SAMPLES[secretClass] as string;
        const report = scanSemanticValueForSecrets({
            clean: CLEAN_TEXT,
            nested: { list: [CLEAN_TEXT, `prefix ${sample} suffix`] },
        });
        assert.deepEqual(
            report.findings.filter(({ secret_class }) => secret_class === secretClass),
            [
                {
                    digest: digestOf(sample),
                    location: "value",
                    path: "/nested/list/1",
                    secret_class: secretClass,
                },
            ],
            secretClass,
        );
        assert.ok(report.secret_classes.includes(secretClass));
        assert.equal(report.truncated, false);
    }
});

test("scan reports never contain matched text", () => {
    const values = Object.values(SECRET_SAMPLES);
    const report = scanSemanticValueForSecrets({ values });
    const rendered = [JSON.stringify(report), inspect(report, { depth: null })];
    for (const secret of values) {
        for (const text of rendered) {
            assert.equal(text.includes(secret), false);
        }
    }
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.findings), true);
    assert.equal(Object.isFrozen(report.findings[0]), true);
});

test("secret keys are reported at their owner and never descended into", () => {
    const secret = SECRET_SAMPLES["github-token"] as string;
    const report = scanSemanticValueForSecrets({
        outer: { [secret]: { inner: SECRET_SAMPLES["slack-token"] as string } },
    });
    assert.deepEqual(report.findings, [
        { digest: digestOf(secret), location: "key", path: "/outer", secret_class: "github-token" },
    ]);
    assert.equal(JSON.stringify(report).includes(secret), false);
});

test("scan escapes pointer segments, deduplicates, and reads scalars and root strings", () => {
    const secret = SECRET_SAMPLES["provider-api-key"] as string;
    const report = scanSemanticValueForSecrets({
        "a/b~c": `${secret} and again ${secret}`,
        flag: true,
        nothing: null,
        number: 7,
    });
    assert.deepEqual(
        report.findings.map(({ path }) => path),
        ["/a~1b~0c"],
    );
    assert.deepEqual(scanSemanticValueForSecrets(secret).findings[0]?.path, "");
    assert.deepEqual(scanSemanticValueForSecrets(42), {
        findings: [],
        secret_classes: [],
        truncated: false,
    });
});

test("scan bounds findings by the configured limit", () => {
    const secret = SECRET_SAMPLES["github-token"] as string;
    const values = Array.from(
        { length: retention.limits.maxFindings + 2 },
        (_, index) => `${secret}${index}`,
    );
    const report = scanSemanticValueForSecrets({ values });
    assert.equal(report.findings.length, retention.limits.maxFindings);
    assert.equal(report.truncated, true);
});

test("scan rejects values that are not canonical semantic values", () => {
    assert.throws(() => scanSemanticValueForSecrets({ bad: Number.NaN } as never), TypeError);
});
