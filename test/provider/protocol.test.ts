import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PROVIDER_PROTOCOL_V3_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("provider protocol configuration is frozen and compatibility locked", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));

    assert.deepEqual(parsed.providers, PROVIDER_PROTOCOL_V3_CONTRACT);
    assert.equal(Object.isFrozen(parsed.providers), true);
    assert.equal(Object.isFrozen(parsed.providers.static.capabilities), true);
    assert.equal(Object.isFrozen(PROVIDER_PROTOCOL_V3_CONTRACT), true);

    for (const mutate of [
        (providers: Record<string, unknown>) => {
            providers.kinds = ["live"];
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "static").kind = "recorded";
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "static"), "capabilities").streaming = "false";
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "static"), "errors").mismatchMessage = "";
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "program").kind = "unlisted";
        },
        (providers: Record<string, unknown>) => {
            (providers.kinds as string[]).push("extra");
        },
        (providers: Record<string, unknown>) => {
            (providers.kinds as string[]).splice(4, 1, "extra");
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "static").kind = "anthropic";
            (providers.kinds as string[]).splice(0, 1);
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "conversation").receiptIdPrefix = "provider-prefix:";
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "live"), "errors").httpCode =
                "LIVE_PROVIDER_CREDENTIAL_MISSING";
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "live"), "errors").httpMessage = "";
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "live").kinds = {};
            providers.kinds = ["static", "program"];
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "live"), "limits").maxErrorDetailBytes = 0;
        },
        (providers: Record<string, unknown>) => {
            objectAt(liveKind(providers, "anthropic"), "headers")["x-api-key"] = "leak";
        },
        (providers: Record<string, unknown>) => {
            objectAt(liveKind(providers, "anthropic"), "headers")["Anthropic-Version"] = "x";
        },
        (providers: Record<string, unknown>) => {
            objectAt(liveKind(providers, "anthropic"), "credential").header = "X Api Key";
        },
        (providers: Record<string, unknown>) => {
            liveKind(providers, "anthropic").dialect = "gemini";
        },
        (providers: Record<string, unknown>) => {
            liveKind(providers, "openai").outputFormat = null;
        },
        (providers: Record<string, unknown>) => {
            objectAt(liveKind(providers, "openai"), "outputFormat").strict = "false";
        },
        (providers: Record<string, unknown>) => {
            liveKind(providers, "openai").endpoint = "chat/completions";
        },
        (providers: Record<string, unknown>) => {
            objectAt(liveKind(providers, "openai"), "credential").scheme = "";
        },
        (providers: Record<string, unknown>) => {
            liveKind(providers, "openai").cacheControl = [];
        },
        (providers: Record<string, unknown>) => {
            liveKind(providers, "openai").completeStopReasons = [];
        },
        (providers: Record<string, unknown>) => {
            objectAt(objectAt(providers, "messages"), "rendering").input = "instruction";
        },
        (providers: Record<string, unknown>) => {
            (objectAt(providers, "messages").roles as string[]).push("system");
        },
        (providers: Record<string, unknown>) => {
            objectAt(providers, "messages").contentTypes = [];
        },
    ]) {
        const config = structuredClone(validConfig);
        mutate(objectAt(config, "providers"));
        assert.throws(() => parseProtocolConfig(config), TypeError);
    }
});

test("tool-use configuration is validated before compatibility", () => {
    const tools = (providers: Record<string, unknown>) => objectAt(providers, "tools");
    const catalog = (providers: Record<string, unknown>) =>
        objectAt(objectAt(tools(providers), "metaAgent"), "tools") as unknown as Record<
            string,
            unknown
        >[];
    for (const [mutate, message] of [
        [
            (providers: Record<string, unknown>) => {
                objectAt(tools(providers), "loop").defaultMaxTurns = 1_000;
            },
            /defaultMaxTurns must not exceed maxTurns/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                objectAt(tools(providers), "loop").dispositions = ["materialized"];
            },
            /dispositions must list/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                objectAt(tools(providers), "loop").statuses = ["completed"];
            },
            /statuses must list/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                catalog(providers).pop();
            },
            /must bind every operation exactly once/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                (catalog(providers)[0] as Record<string, unknown>).name = "bad name";
            },
            /portable tool name/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                (catalog(providers)[0] as Record<string, unknown>).reversibility = "maybe";
            },
            /reversibility must be one of/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                objectAt(liveKind(providers, "anthropic"), "toolUse").stopReasons = ["end_turn"];
            },
            /disjoint from completeStopReasons/u,
        ],
        [
            (providers: Record<string, unknown>) => {
                (objectAt(providers, "messages").contentTypes as string[]).pop();
            },
            /contentTypes must list/u,
        ],
    ] as const) {
        const config = structuredClone(validConfig);
        mutate(objectAt(config, "providers"));
        assert.throws(() => parseProtocolConfig(config), message);
    }
});

function liveKind(providers: Record<string, unknown>, kind: string): Record<string, unknown> {
    return objectAt(objectAt(objectAt(providers, "live"), "kinds"), kind);
}

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
    return value[key] as Record<string, unknown>;
}
