import { SQLiteTaskRegistry, schema, task } from "PACKAGE_ENTRY";
import assert from "node:assert/strict";
import path from "node:path";

const filename = path.join(process.argv[2], "tasks.sqlite");
const registry = new SQLiteTaskRegistry(filename);
const descriptor = task({
    name: "runtime",
    version: "1",
    instruction: "Return input.",
    input: schema.string(),
    output: schema.string(),
});
const registered = registry.register(descriptor);
registry.close();
using reopened = new SQLiteTaskRegistry(filename, { readOnly: true });
const resolved = reopened.resolve({
    taskId: registered.artifactLock.task_id,
    version: registered.artifactLock.task_version,
});
assert.deepEqual(resolved, registered);
process.stdout.write("registry preserved\n");
