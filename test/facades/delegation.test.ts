import assert from "node:assert/strict";
import { test } from "node:test";

import * as delegation from "../../src/facades/delegation.ts";
import * as tasks from "../../src/facades/tasks.ts";
import * as root from "../../src/index.ts";

test("delegation facade symbols are identical to their root exports", () => {
    assert.equal(delegation.openChildRun, root.openChildRun);
    assert.equal(delegation.runChildRun, root.runChildRun);
    assert.equal(delegation.inspectChildRun, root.inspectChildRun);
    assert.equal(delegation.readTaskValue, root.readTaskValue);
    assert.equal(delegation.taskValueOf, root.taskValueOf);
    assert.equal(delegation.taskDescriptorOf, root.taskDescriptorOf);
    assert.equal(delegation.DelegationAuthorityError, root.DelegationAuthorityError);
    assert.equal(delegation.DelegationCommandConflictError, root.DelegationCommandConflictError);
    assert.equal(delegation.DelegationEvidenceError, root.DelegationEvidenceError);
    assert.equal(delegation.DelegationHeadConflictError, root.DelegationHeadConflictError);
    assert.equal(delegation.DelegationStatusError, root.DelegationStatusError);
    assert.equal(delegation.DELEGATION_STATUSES, root.DELEGATION_STATUSES);
    assert.equal(delegation.DELEGATION_LIMITS, root.DELEGATION_LIMITS);
    assert.equal(delegation.TraceStoreError, root.TraceStoreError);
    assert.equal(tasks.readTaskValue, root.readTaskValue);
    assert.equal(tasks.taskValueOf, root.taskValueOf);
    assert.equal(tasks.taskDescriptorOf, root.taskDescriptorOf);
    assert.equal(tasks.schema.task, root.schema.task);
});
