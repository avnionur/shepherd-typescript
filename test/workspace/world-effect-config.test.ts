import assert from "node:assert/strict";
import { test } from "node:test";
import configuration from "../../protocol.config.json" with { type: "json" };
import { WORKSPACE_PROTOCOL_V28_CONTRACT } from "../../src/protocol/compatibility-constants.ts";
import { parseProtocolConfig } from "../../src/protocol/config-validation.ts";

test("world-operation configuration validates its complete vocabulary and pinned contract", () => {
    const parsed = parseProtocolConfig(structuredClone(configuration));
    assert.deepEqual(
        parsed.workspaces.worldTaskCapture.operationJournal,
        WORKSPACE_PROTOCOL_V28_CONTRACT.worldTaskCapture.operationJournal,
    );
    assert.equal(Object.isFrozen(parsed.workspaces.worldTaskCapture.operationJournal), true);
    type Journal = typeof configuration.workspaces.worldTaskCapture.operationJournal;
    for (const mutate of [
        (journal: Journal) => {
            journal.kinds.writeText = journal.kinds.readText;
        },
        (journal: Journal) => {
            journal.phases.pop();
        },
        (journal: Journal) => {
            journal.outcomes.pop();
        },
        (journal: Journal) => {
            journal.recovery.pop();
        },
        (journal: Journal) => {
            journal.maxPathEvidenceBytes = 0;
        },
        (journal: Journal) => {
            journal.schemaId = "relative";
        },
        (journal: Journal) => {
            journal.version = 0;
        },
    ]) {
        const changed = structuredClone(configuration);
        mutate(changed.workspaces.worldTaskCapture.operationJournal);
        assert.throws(
            () => parseProtocolConfig(changed, { enforceCompatibility: false }),
            TypeError,
        );
    }
    const drifted = structuredClone(configuration);
    drifted.workspaces.worldTaskCapture.operationJournal.contentPolicy = "changed-policy";
    assert.throws(() => parseProtocolConfig(drifted), /workspace constants/u);
});
