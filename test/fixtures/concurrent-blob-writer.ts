import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { SQLiteTraceStore } from "../../src/index.ts";

const [databasePath, blobDirectory] = process.argv.slice(2);
if (databasePath === undefined || blobDirectory === undefined) {
    throw new TypeError("database and blob paths are required");
}

const content = new TextEncoder().encode("concurrent retained blob");
const blobId = `sha256:${createHash("sha256").update(content).digest("hex")}`;
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function prepareWithPublicationPause(sql: string) {
    const statement = prepare.call(this, sql);
    if (!sql.includes("INSERT OR IGNORE INTO blobs")) {
        return statement;
    }
    return new Proxy(statement, {
        get(target, property, receiver) {
            if (property === "run") {
                return (...parameters: unknown[]) => {
                    writeSync(1, `${blobId}\n`);
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
                    return Reflect.apply(target.run, target, parameters);
                };
            }
            return Reflect.get(target, property, receiver);
        },
    });
};
using store = new SQLiteTraceStore(databasePath, { blobDirectory });
store.putBlob(content);
