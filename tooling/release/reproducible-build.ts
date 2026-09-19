import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/** One regular file, directory, or link inside a packed tarball. */
export type TarEntry = {
    /** Permission bits from the header. */
    readonly mode: number;
    /** Modification time in seconds from the header. */
    readonly mtime: number;
    /** Entry path, preferring a PAX `path` record over the header name. */
    readonly path: string;
    /** SHA-256 of the entry body. */
    readonly sha256: string;
    /** Header type flag (`0` file, `5` directory, `2` symlink, and so on). */
    readonly type: string;
};

/** Evidence of one clean build and pack. */
export type BuildEvidence = {
    /** Digest of the sorted `path\0digest` lines of every build-output file. */
    readonly distTreeDigest: string;
    /** SHA-256 of each build-output file keyed by POSIX relative path. */
    readonly files: Readonly<Record<string, string>>;
    /** Tarball file name. */
    readonly tarball: string;
    /** Tarball entries in archive order. */
    readonly tarEntries: readonly TarEntry[];
    /** SHA-256 of the tarball bytes. */
    readonly tarballSha256: string;
};

/** Result of comparing two clean builds. */
export type ReproducibleBuildReport = {
    /** Build-output and tarball digests of each build. */
    readonly builds: readonly {
        readonly distTreeDigest: string;
        readonly tarball: string;
        readonly tarballSha256: string;
    }[];
    /** Differing build-output files (`dist:`) and tarball entries (`tarball:`), sorted. */
    readonly differingFiles: readonly string[];
    /** Whether both builds produced identical output trees and identical tarball bytes. */
    readonly identical: boolean;
};

/** Injected build steps so the comparison logic is independent of the host toolchain. */
export type ReproducibleBuildSteps = {
    /** Performs one clean build into `outputDirectory`. */
    readonly build: () => Promise<void>;
    /** Absolute build-output directory digested after each build. */
    readonly outputDirectory: string;
    /** Packs the package into `destination` and returns the tarball path. */
    readonly pack: (destination: string) => Promise<string>;
};

/** A completed reproducible-build run and the tarball of its second build. */
export type ReproducibleBuildRun = {
    /** Removes the temporary pack directories. */
    readonly dispose: () => Promise<void>;
    /** Comparison report. */
    readonly report: ReproducibleBuildReport;
    /** Absolute path of the second build's tarball, valid until `dispose`. */
    readonly tarballPath: string;
};

/**
 * Builds and packs twice from clean output and compares both results.
 *
 * @param steps - Build, pack, and output-directory adapters.
 * @returns The report and the second tarball; call `dispose` to remove temporary directories.
 * @throws {Error} If a build, pack, or digest step fails.
 */
export async function runReproducibleBuild(
    steps: ReproducibleBuildSteps,
): Promise<ReproducibleBuildRun> {
    const directories: string[] = [];
    const dispose = async (): Promise<void> => {
        await Promise.all(
            directories.map((directory) => rm(directory, { force: true, recursive: true })),
        );
    };
    try {
        const evidence: BuildEvidence[] = [];
        for (let index = 0; index < 2; index += 1) {
            await steps.build();
            const files = await digestTree(steps.outputDirectory);
            const destination = await mkdtemp(path.join(tmpdir(), "shepherd-reproducible-pack-"));
            directories.push(destination);
            const tarballPath = await steps.pack(destination);
            const bytes = await readFile(tarballPath);
            evidence.push({
                distTreeDigest: treeDigest(files),
                files,
                tarEntries: readTarEntries(bytes),
                tarball: path.basename(tarballPath),
                tarballSha256: sha256(bytes),
            });
        }
        const [first, second] = evidence as [BuildEvidence, BuildEvidence];
        return {
            dispose,
            report: compareBuilds(first, second),
            tarballPath: path.join(directories[1] as string, second.tarball),
        };
    } catch (error) {
        await dispose();
        throw error;
    }
}

/**
 * Compares two build evidences.
 *
 * @param first - First build.
 * @param second - Second build.
 * @returns Digests of both builds, the sorted differing files and entries, and whether the
 * builds are identical.
 */
export function compareBuilds(
    first: BuildEvidence,
    second: BuildEvidence,
): ReproducibleBuildReport {
    const differing = new Set<string>();
    for (const file of new Set([...Object.keys(first.files), ...Object.keys(second.files)])) {
        if (first.files[file] !== second.files[file]) {
            differing.add(`dist:${file}`);
        }
    }
    const entryText = (entry: TarEntry | undefined): string => JSON.stringify(entry ?? null);
    const secondEntries = new Map(second.tarEntries.map((entry) => [entry.path, entry]));
    const firstEntries = new Map(first.tarEntries.map((entry) => [entry.path, entry]));
    for (const entryPath of new Set([...firstEntries.keys(), ...secondEntries.keys()])) {
        if (entryText(firstEntries.get(entryPath)) !== entryText(secondEntries.get(entryPath))) {
            differing.add(`tarball:${entryPath}`);
        }
    }
    const summary = ({ distTreeDigest, tarball, tarballSha256 }: BuildEvidence) => ({
        distTreeDigest,
        tarball,
        tarballSha256,
    });
    return {
        builds: [summary(first), summary(second)],
        differingFiles: [...differing].sort(),
        identical:
            differing.size === 0 &&
            first.distTreeDigest === second.distTreeDigest &&
            first.tarballSha256 === second.tarballSha256,
    };
}

/**
 * Digests every file under a directory.
 *
 * Symbolic links are recorded by target, never followed.
 *
 * @param directory - Absolute directory.
 * @returns SHA-256 per POSIX relative path, sorted by path.
 * @throws {Error} If the directory cannot be read.
 */
export async function digestTree(directory: string): Promise<Readonly<Record<string, string>>> {
    const entries = await readdir(directory, { recursive: true });
    const files: [string, string][] = [];
    for (const relative of entries) {
        const absolute = path.join(directory, relative);
        const status = await lstat(absolute);
        const key = relative.split(path.sep).join("/");
        if (status.isSymbolicLink()) {
            files.push([key, `symlink:${await readlink(absolute)}`]);
        } else if (status.isFile()) {
            files.push([key, sha256(await readFile(absolute))]);
        }
    }
    return Object.fromEntries(
        files.sort(([left], [right]) => Number(left > right) - Number(left < right)),
    );
}

/**
 * Computes the digest of a sorted file-digest map.
 *
 * @param files - SHA-256 per relative path.
 * @returns `sha256:` digest of the `path\0digest\n` lines in key order.
 */
export function treeDigest(files: Readonly<Record<string, string>>): string {
    const hash = createHash("sha256");
    for (const [file, digest] of Object.entries(files)) {
        hash.update(`${file}\0${digest}\n`, "utf8");
    }
    return `sha256:${hash.digest("hex")}`;
}

/**
 * Reads the entries of a gzip-compressed ustar/PAX tarball.
 *
 * @param archive - Gzip-compressed tar bytes.
 * @returns Entries in archive order; PAX extended headers are folded into the next entry.
 * @throws {Error} If the gzip stream is invalid.
 * @throws {TypeError} If a header is truncated or a numeric field is not octal.
 */
export function readTarEntries(archive: Uint8Array): readonly TarEntry[] {
    const data = gunzipSync(archive);
    const entries: TarEntry[] = [];
    let offset = 0;
    let paxPath: string | undefined;
    while (offset < data.length) {
        const header = data.subarray(offset, offset + 512);
        if (header.length < 512) {
            throw new TypeError(`truncated tar header at offset ${offset}`);
        }
        if (header.every((byte) => byte === 0)) {
            break;
        }
        const headerOffset = offset;
        const size = octal(header, 124, 12, headerOffset);
        const body = data.subarray(offset + 512, offset + 512 + size);
        const type = String.fromCharCode(header[156] as number).replace("\0", "0");
        offset += 512 + Math.ceil(size / 512) * 512;
        if (type === "x") {
            paxPath = paxRecord(body, "path");
            continue;
        }
        if (type === "g") {
            continue;
        }
        const name = text(header, 0, 100);
        const prefix = text(header, 345, 155);
        entries.push({
            mode: octal(header, 100, 8, headerOffset),
            mtime: octal(header, 136, 12, headerOffset),
            path: paxPath ?? (prefix.length > 0 ? `${prefix}/${name}` : name),
            sha256: sha256(body),
            type,
        });
        paxPath = undefined;
    }
    return entries;
}

/**
 * Computes the SHA-256 of bytes.
 *
 * @param bytes - Input bytes.
 * @returns Lower-case hexadecimal digest.
 */
export function sha256(bytes: Uint8Array | string): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function text(header: Uint8Array, start: number, length: number): string {
    const field = header.subarray(start, start + length);
    const end = field.indexOf(0);
    return Buffer.from(end < 0 ? field : field.subarray(0, end)).toString("utf8");
}

function octal(header: Uint8Array, start: number, length: number, offset: number): number {
    const value = text(header, start, length).trim();
    if (!/^[0-7]*$/u.test(value)) {
        throw new TypeError(`tar header near offset ${offset} has a non-octal field`);
    }
    return value.length === 0 ? 0 : Number.parseInt(value, 8);
}

function paxRecord(body: Uint8Array, key: string): string | undefined {
    for (const line of Buffer.from(body).toString("utf8").split("\n")) {
        const record = /^\d+ (?<key>[^=]+)=(?<value>.*)$/u.exec(line)?.groups;
        if (record?.key === key) {
            return record.value;
        }
    }
    return undefined;
}
