import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteTaskRegistry, SQLiteTraceStore } from "../src/index.ts";
import { assertNodeRuntime, parseNodeRuntimePolicy } from "../src/runtime/policy.ts";

test("runtime policy accepts the approved range and rejects older, other-major and prerelease versions", () => {
    const policy = parseNodeRuntimePolicy({ node: ">=24.12.0 <25" });
    for (const version of ["24.12.0", "24.17.0", "24.99.99"]) {
        assert.doesNotThrow(() => assertNodeRuntime(version, policy));
    }
    for (const version of [
        "24.11.1",
        "24.0.0",
        "23.99.0",
        "25.0.0",
        "26.0.0",
        "24.12.0-rc.1",
        "invalid",
    ]) {
        assert.throws(() => assertNodeRuntime(version, policy), /Unsupported Node.js runtime/u);
    }
});

test("runtime configuration is closed, immutable and agrees with package engines", () => {
    const configuration = JSON.parse(
        readFileSync(new URL("../runtime.config.json", import.meta.url), "utf8"),
    );
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const policy = parseNodeRuntimePolicy(configuration);
    assert.equal(manifest.engines.node, policy.node);
    assert.ok(Object.isFrozen(policy));
    assert.ok(Object.isFrozen(policy.minimum));
    let invoked = false;
    for (const value of [
        null,
        undefined,
        [],
        "node",
        1,
        {},
        { node: 1 },
        { node: ">=24.12.0 <25", extra: true },
        { node: ">=24.12.0 <25", [Symbol()]: true },
        {
            get node() {
                invoked = true;
                return ">=24.12.0 <25";
            },
        },
        { node: ">=24" },
        { node: ">=024.12.0 <25" },
        { node: ">=25.0.0 <25" },
        { node: ">=9007199254740992.0.0 <9007199254740993" },
    ]) {
        assert.throws(() => parseNodeRuntimePolicy(value), TypeError);
    }
    assert.equal(invoked, false);
    const alternate = parseNodeRuntimePolicy({ node: ">=24.12.1 <27" });
    assert.doesNotThrow(() => assertNodeRuntime("25.0.0", alternate));
    assert.doesNotThrow(() => assertNodeRuntime("24.12.2", alternate));
    assert.throws(() => assertNodeRuntime("24.12.0", alternate));
    assert.throws(() => assertNodeRuntime("9007199254740992.0.0", alternate));
});

test("defensive behavior is proven before storage and staging even if the API exists but is ineffective", (context) => {
    const directory = mkdtempSync(path.join(tmpdir(), "shepherd-runtime-behavior-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    using target = new SQLiteTraceStore();
    const before = target.exportTrace();
    const control = new DatabaseSync(":memory:", { defensive: false });
    control.exec("PRAGMA schema_version = 1");
    assert.equal(control.prepare("PRAGMA schema_version").get()?.schema_version, 1);
    control.close();
    const execute = DatabaseSync.prototype.exec;
    const injected = context.mock.method(
        DatabaseSync.prototype,
        "exec",
        function (this: DatabaseSync, sql: string) {
            this.enableDefensive(false);
            return execute.call(this, sql);
        },
    );
    try {
        assert.throws(
            () => new SQLiteTraceStore(path.join(directory, "trace.sqlite")),
            /SQLite defensive behavior/u,
        );
        assert.throws(
            () => new SQLiteTaskRegistry(path.join(directory, "tasks.sqlite")),
            /SQLite defensive behavior/u,
        );
        assert.throws(() => target.importTrace(before), /SQLite defensive behavior/u);
        assert.equal(existsSync(path.join(directory, "trace.sqlite")), false);
        assert.equal(existsSync(path.join(directory, "tasks.sqlite")), false);
    } finally {
        injected.mock.restore();
    }
    assert.equal(target.exportTrace(), before);
});

test("stores refuse missing SQLite defensive support before creating files or blob directories", (context) => {
    const directory = mkdtempSync(path.join(tmpdir(), "shepherd-runtime-refusal-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "enableDefensive");
    assert.ok(descriptor);
    Object.defineProperty(DatabaseSync.prototype, "enableDefensive", {
        ...descriptor,
        value: undefined,
    });
    try {
        assert.throws(
            () =>
                new SQLiteTraceStore(path.join(directory, "trace.sqlite"), {
                    blobDirectory: path.join(directory, "blobs"),
                }),
            /SQLite defensive/u,
        );
        assert.throws(
            () => new SQLiteTaskRegistry(path.join(directory, "tasks.sqlite")),
            /SQLite defensive/u,
        );
        assert.equal(existsSync(path.join(directory, "trace.sqlite")), false);
        assert.equal(existsSync(path.join(directory, "tasks.sqlite")), false);
        assert.equal(existsSync(path.join(directory, "blobs")), false);
    } finally {
        Object.defineProperty(DatabaseSync.prototype, "enableDefensive", descriptor);
    }
});
