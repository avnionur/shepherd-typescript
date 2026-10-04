import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Resolve and rotate the active trace while retaining every previous database. */
export function createTraceSession(config) {
    const directory = path.dirname(config.database);
    const pointer = path.join(directory, config.traceSelectionFile);
    const prefix = path.basename(config.database) + ".";
    let database = config.database;
    try {
        const info = lstatSync(pointer);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
            throw new Error("Trace selection must be a private regular file");
        const selected = JSON.parse(readFileSync(pointer, "utf8"));
        if (
            typeof selected !== "string" ||
            path.basename(selected) !== selected ||
            !selected.startsWith(prefix) ||
            !selected.endsWith(".sqlite")
        )
            throw new Error("Invalid trace selection");
        database = path.join(directory, selected);
        const selectedInfo = lstatSync(database);
        if (!selectedInfo.isFile() || selectedInfo.isSymbolicLink())
            throw new Error("Invalid trace database");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (database !== config.database) throw new Error("Selected trace database is missing");
    }
    return {
        database,
        /** Commit a prepared fresh database as the active trace; previous files remain untouched. */
        select(next) {
            const temporary = pointer + "." + randomUUID() + ".tmp";
            writeFileSync(temporary, JSON.stringify(path.basename(next)), {
                flag: "wx",
                mode: 0o600,
            });
            renameSync(temporary, pointer);
            database = next;
        },
        /** Return an unused adjacent filename for a new trace. */
        fresh() {
            return path.join(directory, prefix + randomUUID() + ".sqlite");
        },
    };
}
