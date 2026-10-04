import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Verifies persisted declarations through the installed package and binary across processes.
 * @param consumerRoot - Consumer directory beneath the fresh installation.
 * @param packageName - Installed package's configured module specifier.
 * @param executable - Installed CLI binary.
 * @throws {Error} If registration, reopen, human output or stable JSON differs.
 */
export function testInstalledTaskGrantCli(
    consumerRoot: string,
    packageName: string,
    executable: string,
): void {
    const fixture = path.join(consumerRoot, "register-grants.mjs");
    const registryPath = path.join(consumerRoot, "registered-grants.sqlite");
    writeFileSync(
        fixture,
        `import assert from "node:assert/strict";
import { schema, SQLiteTaskRegistry, task } from ${JSON.stringify(`${packageName}/tasks`)};
import { grantTaskRepositories } from ${JSON.stringify(`${packageName}/workspace`)};
const descriptor = task({ name: "grant-inspection", version: "1", instruction: "Read documentation and edit source.", input: schema.object({ message: schema.string() }), output: schema.string() });
const plain = task({ name: "ungranted-inspection", version: "1", instruction: "Return input.", input: schema.string(), output: schema.string() });
const granted = grantTaskRepositories({ task: descriptor, grants: [{ binding: "docs", profile: "read-only" }, { binding: "source", profile: "read-write" }] });
using registry = new SQLiteTaskRegistry(${JSON.stringify(registryPath)});
registry.registerGranted(granted);
registry.register(plain);
assert.deepEqual(registry.registerGranted(granted).repositoryGrant, { artifact: granted.artifact, artifact_lock: granted.artifactLock });
process.stdout.write(JSON.stringify({ selector: descriptor.artifactLock.task_id + "@1", plain: plain.artifactLock.task_id + "@1", artifact: descriptor.artifact, grant: { artifact: granted.artifact, artifact_lock: granted.artifactLock } }));
`,
    );
    const expected = JSON.parse(
        execFileSync(process.execPath, [fixture], { cwd: consumerRoot, encoding: "utf8" }),
    );
    for (const selector of [expected.selector, expected.plain]) {
        const args = ["task", "show", selector, "--registry", registryPath];
        const json = JSON.parse(
            execFileSync(executable, [...args, "--json"], { encoding: "utf8" }),
        );
        const human = execFileSync(executable, args, { encoding: "utf8" });
        assert.equal(json.ok, true);
        if (selector === expected.selector) {
            assert.deepEqual(json.result.task.repository_grant, expected.grant);
            assert.deepEqual(json.result.task.artifact, expected.artifact);
            assert.match(human, /read-only/u);
            assert.match(human, /read-write/u);
            assert.match(human, /Read documentation and edit source/u);
        } else {
            assert.equal(json.result.task.repository_grant, null);
            assert.match(human, /Repository declarations: none/u);
        }
        assert.match(human, /Input schema:/u);
        assert.match(human, /Output schema:/u);
        assert.match(human, /declarations only/u);
    }
}
