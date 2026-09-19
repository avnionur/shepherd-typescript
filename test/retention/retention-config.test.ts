import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { RETENTION_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

type Config = Record<string, unknown>;
type Retention = Record<string, unknown> & {
    schemaFamilies: { dataClass: string; path: string }[];
    secretClasses: { flags: string; name: string; pattern: string }[];
    exportDispositions: Record<string, unknown>;
    redactedArchive: Record<string, unknown>;
    report: Record<string, unknown>;
    scanning: Record<string, unknown>;
    storeFiles: Record<string, unknown>;
};

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Config;

function retentionOf(config: Config): Retention {
    return config.retention as Retention;
}

function assertRejected(
    mutate: (config: Config, retention: Retention) => void,
    message: RegExp,
): void {
    const config = structuredClone(validConfig);
    mutate(config, retentionOf(config));
    assert.throws(
        () => parseProtocolConfig(config),
        (error: unknown) => {
            assert.ok(error instanceof TypeError);
            assert.match(error.message, message);
            return true;
        },
    );
}

test("retention configuration parses, resolves schema classes, and freezes", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.equal(Object.isFrozen(parsed.retention.schemaDataClasses), true);
    assert.equal(parsed.retention.storeFiles.mode & 0o077, 0);
    assert.equal(
        parsed.retention.compatibilityVersion,
        RETENTION_PROTOCOL_V1_CONTRACT.compatibilityVersion,
    );
    assert.equal(Object.isFrozen(RETENTION_PROTOCOL_V1_CONTRACT), true);
});

test("retention configuration rejects malformed vocabularies and wire identities", () => {
    assertRejected((_, retention) => {
        retention.defaultDataClass = "unknown";
    }, /retention\.defaultDataClass/u);
    assertRejected((_, retention) => {
        retention.exportDispositions.context = "publish";
    }, /retention\.exportDispositions\.context/u);
    assertRejected((_, retention) => {
        delete retention.exportDispositions.context;
    }, /retention\.exportDispositions/u);
    assertRejected((_, retention) => {
        retention.digestAlgorithm = "md5";
    }, /retention\.digestAlgorithm/u);
    assertRejected((_, retention) => {
        retention.digestPrefix = "sha512:";
    }, /retention\.digestPrefix/u);
    assertRejected((config, retention) => {
        retention.redactedArchive.format = ((config.kernel as Config).interchange as Config).format;
    }, /wire formats must differ/u);
    assertRejected((_, retention) => {
        retention.report.format = retention.redactedArchive.format;
    }, /wire formats must differ/u);
    assertRejected((_, retention) => {
        retention.scanning.defaultMode = "block";
    }, /retention\.scanning\.defaultMode/u);
    // An unkeyed prefix would claim that a finding digest can be recomputed from the text.
    assertRejected((_, retention) => {
        retention.scanning.findingDigestPrefix = "sha256:";
    }, /retention\.scanning\.findingDigestPrefix/u);
    assertRejected((_, retention) => {
        retention.compatibilityVersion = "shepherd.retention.v2";
    }, /retention wire constants/u);
    assertRejected((_, retention) => {
        retention.dispositions = ["include", "redact", "omit-body"];
    }, /retention wire constants/u);
});

test("retention configuration rejects unsafe secret detectors", () => {
    assertRejected((_, retention) => {
        retention.secretClasses = [];
    }, /uniquely named detectors/u);
    assertRejected((_, retention) => {
        retention.secretClasses.push(structuredClone(retention.secretClasses[0] as never));
    }, /uniquely named detectors/u);
    assertRejected((_, retention) => {
        (retention.secretClasses[0] as { flags: string }).flags = "gu";
    }, /flags must use Unicode mode/u);
    assertRejected((_, retention) => {
        (retention.secretClasses[0] as { flags: string }).flags = "i";
    }, /flags must use Unicode mode/u);
    assertRejected((_, retention) => {
        (retention.secretClasses[0] as { pattern: string }).pattern = "(";
    }, /valid regular expression/u);
    assertRejected((_, retention) => {
        (retention.secretClasses[0] as { pattern: string }).pattern = "x*";
    }, /must not match the empty string/u);
});

test("retention configuration requires owner-only store file modes", () => {
    for (const mode of ["0644", "0400", "600", "0o600", "0660"]) {
        assertRejected((_, retention) => {
            retention.storeFiles.mode = mode;
        }, /owner-only read-write octal mode/u);
    }
});

test("retention configuration gates schema-family mappings", () => {
    assertRejected((_, retention) => {
        retention.schemaFamilies = [];
    }, /unique paths/u);
    assertRejected((_, retention) => {
        retention.schemaFamilies.push(structuredClone(retention.schemaFamilies[0] as never));
    }, /unique paths/u);
    assertRejected((_, retention) => {
        (retention.schemaFamilies[0] as { dataClass: string }).dataClass = "secretive";
    }, /schemaFamilies\[0\]\.dataClass/u);
    assertRejected((_, retention) => {
        retention.schemaFamilies = retention.schemaFamilies.filter(
            ({ path }) => path !== "replay.traceSchemas",
        );
    }, /must map replay\.traceSchemas/u);
    assertRejected((config) => {
        ((config.runs as Config).schemas as Config).addedId = "https://example.test/added.json";
        (config.tasks as Config).traceSchemas = { added: "shepherd.tasks.added.v1" };
    }, /must map tasks\.traceSchemas/u);
    assertRejected((_, retention) => {
        retention.schemaFamilies.push({ dataClass: "general", path: "kernel.missing" });
    }, /path kernel\.missing must name configured schemas/u);
    assertRejected((_, retention) => {
        retention.schemaFamilies.push({ dataClass: "general", path: "kernel.recordModes" });
    }, /must name configured schemas/u);
    assertRejected((_, retention) => {
        retention.schemaFamilies.push({ dataClass: "general", path: "retention.limits" });
    }, /retention\.limits\.maxFindings must name configured schemas/u);
    assertRejected((config, retention) => {
        ((config.kernel as Config).append as Config).emptyFamily = {};
        retention.schemaFamilies.push({ dataClass: "general", path: "kernel.append.emptyFamily" });
    }, /must name configured schemas/u);
    assertRejected((config, retention) => {
        const replay = (config.replay as { traceSchemas: Record<string, string> }).traceSchemas;
        ((config.kernel as Config).queries as Config).witnessSchemaRef = replay.step;
        retention.schemaFamilies.push({
            dataClass: "context",
            path: "kernel.queries.witnessSchemaRef",
        });
    }, /classify shepherd\.replay\.step\.v1 inconsistently/u);
});

test("retention configuration accepts consistent duplicate classification across families", () => {
    const config = structuredClone(validConfig);
    const replay = (config.replay as { traceSchemas: Record<string, string> }).traceSchemas;
    const retention = retentionOf(config);
    retention.schemaFamilies.push({
        dataClass: "provider-citation",
        path: "kernel.queries.witnessSchemaRef",
    });
    ((config.kernel as Config).queries as Config).witnessSchemaRef = replay.step;
    const parsed = parseProtocolConfig(config, { enforceCompatibility: false });
    assert.equal(parsed.retention.schemaDataClasses[replay.step as string], "provider-citation");
});
