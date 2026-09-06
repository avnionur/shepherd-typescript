import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { schema } from "@avnionur/shepherd-typescript/tasks";
import {
    resolveOutputCitationSelector,
    SQLiteTraceStore,
} from "@avnionur/shepherd-typescript/trace";
import {
    createReferenceCopyCarrier,
    createWorldChangesetInspection,
    openWorkspace,
} from "@avnionur/shepherd-typescript/workspace";

// Review an existing completed capture; this program never prepares or settles an output.
const [directory, configurationPath, ...extra] = process.argv.slice(2);
assert.ok(
    directory && configurationPath && extra.length === 0,
    "Usage: node read-only-review.ts <existing-workspace> <review.json>",
);
const configuration = schema
    .object({
        storeFile: schema.string(),
        outputSelector: schema.string(),
        sourceFile: schema.string(),
        pageLimit: schema.string(),
        previewBytes: schema.string(),
        previewLines: schema.string(),
    })
    .parse(JSON.parse(readFileSync(configurationPath, "utf8")));
assert.match(configuration.storeFile, /^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const limits = [
    configuration.pageLimit,
    configuration.previewBytes,
    configuration.previewLines,
].map(Number);
assert.ok(limits.every((limit) => Number.isSafeInteger(limit) && limit > 0));
const workspaceRoot = path.resolve(directory);
const workspace = openWorkspace(workspaceRoot);
using store = new SQLiteTraceStore(path.join(workspace.control_path, configuration.storeFile), {
    readOnly: true,
});
const before = store.exportTrace();
const citation = resolveOutputCitationSelector(store, configuration.outputSelector);
// The carrier also exposes mutations; review uses only existing revision reads.
const carrier = createReferenceCopyCarrier({ workspaceRoot });
const inspection = await createWorldChangesetInspection({
    carrier,
    baseRevision: await carrier.openRevision(citation.output.base_revision_id),
    headRevision: await carrier.openRevision(citation.output.head_revision_id),
});
const page = inspection.page({ limit: limits[0] as number, offset: 0 });
const change = inspection.change(configuration.sourceFile);
assert.ok(change?.after?.kind === "file", "requested retained file is unavailable");
const preview = await inspection.previewText({
    contentId: change.after.content_id,
    maxBytes: limits[1] as number,
    maxLines: limits[2] as number,
});
assert.equal(store.exportTrace(), before, "review changed durable evidence");
process.stdout.write(
    `${JSON.stringify({
        runId: citation.run_id,
        changedPaths: page.changes.map((entry) => entry.path),
        total: page.total,
        nextOffset: page.next_offset,
        preview: preview.text,
        truncated: preview.truncated,
        settlementStates: citation.settlements.map((entry) => entry.state),
        traceUnchanged: true,
    })}\n`,
);
