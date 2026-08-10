import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PROVIDER_PROTOCOL_V1_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

const validConfig = JSON.parse(
    readFileSync(new URL("../../protocol.config.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("provider protocol configuration is frozen and compatibility locked", () => {
    const parsed = parseProtocolConfig(structuredClone(validConfig));

    assert.deepEqual(parsed.providers, PROVIDER_PROTOCOL_V1_CONTRACT);
    assert.equal(Object.isFrozen(parsed.providers), true);
    assert.equal(Object.isFrozen(parsed.providers.static.capabilities), true);
    assert.equal(Object.isFrozen(PROVIDER_PROTOCOL_V1_CONTRACT), true);

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
    ]) {
        const config = structuredClone(validConfig);
        mutate(objectAt(config, "providers"));
        assert.throws(() => parseProtocolConfig(config), TypeError);
    }
});

function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
    return value[key] as Record<string, unknown>;
}
