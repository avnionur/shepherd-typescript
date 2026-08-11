import assert from "node:assert/strict";
import { test } from "node:test";

import { createRunLifecycleTransition } from "../../src/index.ts";

test("createRunLifecycleTransition accepts exactly the normative transition matrix", () => {
    for (const transition of [
        { source_status: "created", target_status: "running" },
        { source_status: "running", target_status: "waiting" },
        { source_status: "waiting", target_status: "running" },
        { source_status: "running", target_status: "suspended" },
        { source_status: "suspended", target_status: "running" },
        { source_status: "created", target_status: "terminal", terminal_status: "failed" },
        { source_status: "created", target_status: "terminal", terminal_status: "exhausted" },
        { source_status: "created", target_status: "terminal", terminal_status: "cancelled" },
        { source_status: "running", target_status: "terminal", terminal_status: "finished" },
        { source_status: "running", target_status: "terminal", terminal_status: "failed" },
        { source_status: "running", target_status: "terminal", terminal_status: "exhausted" },
        { source_status: "running", target_status: "terminal", terminal_status: "cancelled" },
        { source_status: "waiting", target_status: "terminal", terminal_status: "failed" },
        { source_status: "waiting", target_status: "terminal", terminal_status: "exhausted" },
        { source_status: "waiting", target_status: "terminal", terminal_status: "cancelled" },
        { source_status: "suspended", target_status: "terminal", terminal_status: "failed" },
        { source_status: "suspended", target_status: "terminal", terminal_status: "exhausted" },
        { source_status: "suspended", target_status: "terminal", terminal_status: "cancelled" },
    ] as const) {
        const created = createRunLifecycleTransition(transition);
        assert.deepEqual(created, transition);
        assert.equal(Object.isFrozen(created), true);
    }

    for (const invalid of [
        null,
        [],
        {},
        { source_status: "created", target_status: "waiting" },
        { source_status: "terminal", target_status: "running" },
        { source_status: "waiting", target_status: "suspended" },
        { source_status: "created", target_status: "terminal" },
        { source_status: "created", target_status: "terminal", terminal_status: null },
        { source_status: "created", target_status: "terminal", terminal_status: "unknown" },
        { source_status: "created", target_status: "terminal", terminal_status: "finished" },
        { source_status: "waiting", target_status: "terminal", terminal_status: "finished" },
        { source_status: "running", target_status: "waiting", terminal_status: "failed" },
        { source_status: "unknown", target_status: "running" },
        { source_status: "created", target_status: "unknown" },
        { source_status: "created", target_status: "running", extra: true },
        Object.assign(Object.create(null), {
            source_status: "created",
            target_status: "running",
        }),
        Object.defineProperty({ target_status: "running" }, "source_status", {
            enumerable: true,
            get: () => "created",
        }),
        {
            source_status: "created",
            target_status: "running",
            [Symbol("invalid")]: true,
        },
    ]) {
        assert.throws(() => createRunLifecycleTransition(invalid as never), TypeError);
    }
});
