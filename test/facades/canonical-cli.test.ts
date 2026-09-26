import assert from "node:assert/strict";
import { test } from "node:test";

import * as canonical from "../../src/facades/canonical.ts";
import * as cli from "../../src/facades/cli.ts";
import * as root from "../../src/index.ts";

test("canonical and cli facade symbols are identical to their root exports", () => {
    assert.equal(canonical.canonicalizeRecord, root.canonicalizeRecord);
    assert.equal(canonical.createRecordId, root.createRecordId);
    assert.equal(canonical.CanonicalNestingLimitError, root.CanonicalNestingLimitError);
    assert.equal(cli.runCli, root.runCli);
});
