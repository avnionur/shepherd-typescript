import assert from "node:assert/strict";
import { test } from "node:test";

import { createRetainedWorldRunner } from "../../src/index.ts";

test("createRetainedWorldRunner returns one closed frozen registration handle", () => {
    const runner = createRetainedWorldRunner({
        enforcement: "advisory",
        run: async () => {
            throw new Error("not invoked");
        },
        runnerId: "runner:deterministic:1",
    });

    assert.deepEqual(runner, {
        enforcement: "advisory",
        runner_id: "runner:deterministic:1",
        runner_version: 7,
    });
    assert.equal(Object.isFrozen(runner), true);
});

test("createRetainedWorldRunner rejects malformed and open definitions", () => {
    const run = async () => {
        throw new Error("not invoked");
    };
    assert.throws(() => createRetainedWorldRunner({ enforcement: "advisory", run, runnerId: "" }));
    assert.throws(() =>
        createRetainedWorldRunner({
            enforcement: "sandboxed" as "advisory",
            run,
            runnerId: "runner:unsupported",
        }),
    );
    assert.throws(() =>
        createRetainedWorldRunner({
            enforcement: "advisory",
            run,
            runnerId: "runner:symbol",
            [Symbol("extension")]: true,
        } as never),
    );
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
    Object.assign(inherited, {
        enforcement: "advisory",
        run,
        runnerId: "runner:inherited",
    });
    assert.throws(() => createRetainedWorldRunner(inherited as never));
    const changing = new Proxy(
        { enforcement: "advisory", run, runnerId: "runner:proxy" },
        {
            get: (_target, key, receiver) =>
                key === "runnerId" ? "runner:substituted" : Reflect.get(_target, key, receiver),
        },
    ) as Parameters<typeof createRetainedWorldRunner>[0];
    assert.deepEqual(createRetainedWorldRunner(changing), {
        enforcement: "advisory",
        runner_id: "runner:proxy",
        runner_version: 7,
    });
    assert.throws(() =>
        createRetainedWorldRunner({
            enforcement: "advisory",
            run,
            runnerId: "runner:open",
            unexpected: true,
        } as never),
    );
    assert.throws(() => createRetainedWorldRunner(null as never));
    assert.throws(() => createRetainedWorldRunner([] as never));
    assert.throws(() =>
        createRetainedWorldRunner({
            enforcement: "advisory",
            run,
            runnerId: "x".repeat(257),
        }),
    );
    assert.throws(() =>
        createRetainedWorldRunner({ enforcement: "advisory", run, runnerId: "runner:\0" }),
    );
    assert.throws(() =>
        createRetainedWorldRunner({ enforcement: "advisory", run, runnerId: "runner:\uD800" }),
    );
    assert.throws(() =>
        createRetainedWorldRunner(
            Object.defineProperties(
                {},
                {
                    enforcement: { enumerable: true, get: () => "advisory" },
                    run: { enumerable: true, value: run },
                    runnerId: { enumerable: true, value: "runner:getter" },
                },
            ) as never,
        ),
    );
    assert.throws(() =>
        createRetainedWorldRunner({
            enforcement: "advisory",
            run: null as never,
            runnerId: "runner:no-callback",
        }),
    );
});
