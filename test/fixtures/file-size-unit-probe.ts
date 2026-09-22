import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import path from "node:path";

// Measures the byte size of one `ulimit -f` unit. The parent launches this process under
// `ulimit -f 1`; single-byte writes succeed until the kernel's RLIMIT_FSIZE is reached, then fail
// with EFBIG (Node.js ignores SIGXFSZ). The number of bytes written is the unit, printed on
// stdout. The probe file lives in a private directory under the given parent and is removed. The
// second argument caps the writes, so a missing limit ends the probe instead of filling the disk.
const parent = process.argv[2] ?? "";
const cap = Number(process.argv[3]);
const directory = mkdtempSync(path.join(parent, "shepherd-file-size-unit-"));
const descriptor = openSync(path.join(directory, "probe"), "w");
const byte = new Uint8Array(1);
let written = 0;
try {
    while (written <= cap) {
        writeSync(descriptor, byte);
        written += 1;
    }
} catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EFBIG") throw error;
} finally {
    closeSync(descriptor);
    rmSync(directory, { force: true, recursive: true });
}
writeSync(1, `${written}\n`);
