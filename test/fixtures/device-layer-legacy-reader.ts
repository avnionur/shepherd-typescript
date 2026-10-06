import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import * as current from "../../src/index.ts";

// Manual N-1 drill: build edf6d14 (13.7.0) separately and pass its absolute dist directory.
const legacyDist = process.argv[2];
assert.ok(legacyDist, "usage: node test/fixtures/device-layer-legacy-reader.ts <legacy-dist>");
const legacy = createRequire(import.meta.url)(
    path.join(path.resolve(legacyDist), "src/index.js"),
) as typeof current;
const directory = mkdtempSync(path.join(tmpdir(), "shepherd-device-legacy-"));
const database = path.join(directory, "trace.sqlite");
using store = new current.SQLiteTraceStore(database);
const world = await current.openRetainedDeviceLayerWorld(store, {
    commandId: "create",
    root: directory,
});
await world.writeFile("note", Buffer.from("preserve"));
await world.checkpoint({ commandId: "capture", name: "one" });
const before = store.exportTrace();
assert.throws(() => new legacy.SQLiteTraceStore(database), /newer|version|supported/u);
using imported = new legacy.SQLiteTraceStore();
imported.importTrace(before);
assert.equal(imported.exportTrace(), before);
assert.equal(readFileSync(path.join(world.path, "note"), "utf8"), "preserve");
assert.equal(store.exportTrace(), before);
using currentImported = new current.SQLiteTraceStore(path.join(directory, "imported.sqlite"));
currentImported.importTrace(imported.exportTrace());
assert.equal(
    current.inspectRetainedDeviceLayerWorld(currentImported, { deviceId: world.deviceId }).status,
    "unavailable",
);
await assert.rejects(
    current.reopenRetainedDeviceLayerWorld(currentImported, { deviceId: world.deviceId }),
    /local authority/u,
);
const legacyDatabase = path.join(directory, "old.sqlite");
const old = new legacy.SQLiteTraceStore(legacyDatabase);
const oldTrace = old.exportTrace();
old.close();
using upgraded = new current.SQLiteTraceStore(legacyDatabase);
assert.equal(upgraded.exportTrace(), oldTrace);
assert.equal(upgraded.verifyIntegrity().ok, true);
await world.cleanup({ commandId: "cleanup" });
console.log(
    JSON.stringify({
        directory,
        oldWriterRefused: true,
        archiveFactsPreserved: true,
        importedAuthorityRefused: true,
        schema15UpgradeVerified: true,
    }),
);
