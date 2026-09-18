import assert from "node:assert/strict";
import { test } from "node:test";

import * as applications from "../../src/facades/applications.ts";
import * as workspace from "../../src/facades/workspace.ts";
import * as root from "../../src/index.ts";

test("applications facade symbols are identical to their root exports", () => {
    assert.equal(applications.runCodingSupervisor, root.runCodingSupervisor);
    assert.equal(applications.inspectCodingSupervisorRun, root.inspectCodingSupervisorRun);
    assert.equal(applications.readApplicationProtocol, root.readApplicationProtocol);
    assert.equal(applications.applicationProtocolId, root.applicationProtocolId);
    assert.equal(applications.deriveApplicationOwnerId, root.deriveApplicationOwnerId);
    assert.equal(applications.createApplicationManifest, root.createApplicationManifest);
    assert.equal(applications.validateApplicationManifest, root.validateApplicationManifest);
    assert.equal(applications.retainApplicationManifest, root.retainApplicationManifest);
    assert.equal(applications.inspectApplicationManifest, root.inspectApplicationManifest);
    assert.equal(applications.ApplicationBudgetError, root.ApplicationBudgetError);
    assert.equal(applications.ApplicationEvidenceError, root.ApplicationEvidenceError);
    assert.equal(applications.ApplicationProtocolError, root.ApplicationProtocolError);
    assert.equal(applications.ApplicationVerificationError, root.ApplicationVerificationError);
    assert.equal(applications.APPLICATION_KINDS, root.APPLICATION_KINDS);
    assert.equal(applications.APPLICATION_LIMITS, root.APPLICATION_LIMITS);
    assert.equal(applications.APPLICATION_PROTOCOL_SURFACES, root.APPLICATION_PROTOCOL_SURFACES);
    assert.equal(
        applications.APPLICATION_SUPERVISION_POLICY_KINDS,
        root.APPLICATION_SUPERVISION_POLICY_KINDS,
    );
    assert.equal(applications.APPLICATION_COMPATIBILITY_VERSION, "shepherd.applications.v1");
    assert.equal(applications.APPLICATION_RECORD_VERSION, 1);
    assert.equal(applications.APPLICATION_MANIFEST_VERSION, 1);
    assert.equal(applications.TraceStoreError, root.TraceStoreError);
    assert.equal(workspace.createScopeWorldAdapter, root.createScopeWorldAdapter);
});
