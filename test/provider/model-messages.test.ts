import assert from "node:assert/strict";
import { test } from "node:test";

import { readModelMessage } from "../../src/provider/messages.ts";

test("tool-use blocks require a portable tool name", () => {
    const block = { id: "call-1", input: {}, name: "read_file", type: "tool_use" };
    const message = (name: unknown) => ({ content: [{ ...block, name }], role: "assistant" });
    assert.deepEqual(readModelMessage(message("read_file"), "message"), {
        content: [block],
        role: "assistant",
    });
    for (const name of [7, "", "read file", "a".repeat(65), "tool.name"]) {
        assert.throws(
            () => readModelMessage(message(name), "message"),
            (error: unknown) =>
                error instanceof TypeError &&
                /name must be a portable tool name/u.test(error.message),
            String(name),
        );
    }
});
