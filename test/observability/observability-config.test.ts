import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { OBSERVABILITY_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";
import {
    TELEMETRY_BODY_HANDLINGS,
    TELEMETRY_BODY_MODES,
} from "../../src/protocol/values.generated.ts";

type Fields = Record<string, unknown>;
type Section = Fields & {
    batch: Fields;
    bodies: Fields;
    ids: Fields;
    limits: Fields;
    otlp: Fields;
    runSpans: Fields;
    semanticConventions: Fields;
};

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function assertRejected(mutate: (observability: Section) => void, message: RegExp): void {
    const config = structuredClone(validConfig);
    mutate(config.observability as Section);
    assert.throws(
        () => parseProtocolConfig(config),
        (error: unknown) => {
            assert.ok(error instanceof TypeError);
            assert.match(error.message, message);
            return true;
        },
    );
}

test("observability configuration parses, freezes, and matches generated vocabularies", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));
    assert.equal(Object.isFrozen(parsed.observability.runSpans.terminalSchemaRefs), true);
    assert.deepEqual(parsed.observability.bodies.modes, TELEMETRY_BODY_MODES);
    assert.deepEqual(parsed.observability.bodies.handlings, TELEMETRY_BODY_HANDLINGS);
    assert.equal(parsed.observability.bodies.defaultMode, TELEMETRY_BODY_MODES[0]);
    assert.equal(
        parsed.observability.compatibilityVersion,
        OBSERVABILITY_PROTOCOL_V1_CONTRACT.compatibilityVersion,
    );
});

test("observability configuration rejects malformed and inconsistent fields", () => {
    const cases: readonly [(observability: Section) => void, RegExp][] = [
        [
            (section) => {
                section.attributeNamespace = "Shepherd";
            },
            /dotted lowercase key/u,
        ],
        [
            (section) => {
                section.batch.format = "shepherd.trace.archive";
            },
            /must differ from the importable archive format/u,
        ],
        [
            (section) => {
                section.ids.spanDomain = section.ids.traceDomain;
            },
            /ids domains must differ/u,
        ],
        [
            (section) => {
                section.limits.defaultRecordsPerBatch = 5000;
            },
            /must not exceed the maximum/u,
        ],
        [
            (section) => {
                section.otlp.statusCodes = [];
            },
            /statusCodes must be an object/u,
        ],
        [
            (section) => {
                section.otlp.statusCodes = {};
            },
            /statusCodes must not be empty/u,
        ],
        [
            (section) => {
                section.otlp.statusCodes = { ok: 0 };
            },
            /statusCodes.ok must be positive/u,
        ],
        [
            (section) => {
                section.resourceAttributes = { "": "value" };
            },
            /resourceAttributes key must be a non-empty/u,
        ],
        [
            (section) => {
                section.otlp.protoVersion = "1.11";
            },
            /MAJOR.MINOR.PATCH release/u,
        ],
        [
            (section) => {
                section.semanticConventions.schemaUrlPrefix = "https://opentelemetry.io/schemas";
            },
            /must end with \//u,
        ],
        [
            (section) => {
                section.runSpans.startSchemaRefs = ["example.unconfigured.v1"];
            },
            /distinct configured execution schemas/u,
        ],
        [
            (section) => {
                (section.runSpans.terminalSchemaRefs as Record<string, string>)[
                    "shepherd2.execution.created.v1"
                ] = "ok";
            },
            /distinct configured execution schemas/u,
        ],
        [
            (section) => {
                (section.runSpans.terminalSchemaRefs as Record<string, string>)[
                    "shepherd2.execution.completed.v1"
                ] = "unset";
            },
            /must be one of: error, ok/u,
        ],
        [
            (section) => {
                section.extra = true;
            },
            /observability must contain exactly/u,
        ],
    ];
    for (const [mutate, message] of cases) {
        assertRejected(mutate, message);
    }
});

test("observability wire constants are pinned by the observability v1 contract", () => {
    assert.equal(Object.isFrozen(OBSERVABILITY_PROTOCOL_V1_CONTRACT), true);
    assertRejected((section) => {
        section.batch.formatVersion = 2;
    }, /observability wire constants require a new observability protocol/u);
    assertRejected((section) => {
        section.bodies.handlings = ["included"];
    }, /observability wire constants require a new observability protocol/u);
});
