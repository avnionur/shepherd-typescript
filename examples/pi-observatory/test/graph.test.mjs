import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveFlowTracker, orderCausalNodes } from "../public/graph.mjs";

test("playback follows recorded parents even when owners arrive out of order, retaining external anchors", () => {
    const records = [
        { id: "result", parents: ["invocation", "usage"] },
        { id: "invocation", parents: ["creation"] },
        { id: "usage", parents: ["invocation"] },
        { id: "creation", parents: ["outside-view"] },
    ];
    assert.deepEqual(
        orderCausalNodes(records).map((node) => node.id),
        ["creation", "invocation", "usage", "result"],
    );
    assert.deepEqual(records[3].parents, ["outside-view"]);
    assert.throws(
        () =>
            orderCausalNodes([
                { id: "a", parents: ["b"] },
                { id: "b", parents: ["a"] },
            ]),
        TypeError,
    );
    assert.throws(
        () =>
            orderCausalNodes([
                { id: "a", parents: [] },
                { id: "a", parents: [] },
            ]),
        TypeError,
    );
});

test("live flow highlights new commits only and expires without renewing on repeated polls", () => {
    const tracker = createLiveFlowTracker(100);
    assert.deepEqual([...tracker.observe([{ id: "restored" }], 0)], []);
    assert.deepEqual([...tracker.observe([{ id: "restored" }, { id: "new" }], 10)], ["new"]);
    assert.deepEqual([...tracker.observe([{ id: "restored" }, { id: "new" }], 50)], ["new"]);
    assert.deepEqual([...tracker.observe([{ id: "restored" }, { id: "new" }], 110)], []);
    assert.deepEqual([...tracker.observe([{ id: "another" }], 120)], ["another"]);
});
