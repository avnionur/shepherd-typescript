import assert from "node:assert/strict";
import { test } from "node:test";

import * as providers from "../../src/facades/providers.ts";
import * as root from "../../src/index.ts";

test("providers facade re-exports the root provider runtime values", () => {
    assert.deepEqual(Object.keys(providers).sort(), [
        "LiveProviderError",
        "MODEL_CONTENT_BLOCK_TYPES",
        "MODEL_MESSAGE_ROLES",
        "PROVIDER_KINDS",
        "StaticProviderExhaustedError",
        "StaticProviderRequestMismatchError",
        "createLiveProvider",
        "createProgramConversationProvider",
        "createProviderConversation",
        "createStaticProvider",
    ]);
    for (const [name, value] of Object.entries(providers)) {
        assert.equal(value, (root as Record<string, unknown>)[name], name);
    }
});
