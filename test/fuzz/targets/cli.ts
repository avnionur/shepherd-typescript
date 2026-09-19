import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import { runCli } from "../../../src/cli/cli.ts";
import { ROOT_WITNESS_ID, SQLiteTraceStore } from "../../../src/index.ts";
import { cliProtocolConfig } from "../../../src/protocol/config.ts";
import type { Prng } from "../../support/prng.ts";
import { type FuzzInput, type FuzzTarget, fuzzSettings, repositoryRoot } from "../harness.ts";
import { mutateText } from "../mutators.ts";

type CliCase = { readonly argv: readonly unknown[] };

const EXIT_CODES = new Set(Object.values(cliProtocolConfig.exitCodes));
const OPTIONS = Object.values(cliProtocolConfig.options);
const PATH_OPTIONS = [
    cliProtocolConfig.options.store,
    cliProtocolConfig.options.output,
    cliProtocolConfig.options.input,
    cliProtocolConfig.options.backup,
    cliProtocolConfig.options.mode,
    cliProtocolConfig.options.limit,
];
// Relative names only: generated values never contain a path separator, so every path a command
// resolves stays inside the nested temporary working directory (at most one `..` level up).
const VALUES = [
    "trace.sqlite",
    "tasks.sqlite",
    "archive.json",
    "export.json",
    "backup",
    "missing",
    cliProtocolConfig.defaults.quickstartDemoName,
    "inspect",
    "checkpoint",
    "vacuum",
    "0",
    "1",
    "-1",
    "25",
    String(cliProtocolConfig.limits.maxPageSize + 1),
    "1.5",
    "",
    ".",
    "..",
    "none",
    "git-head",
    "run:fuzz",
    "latest",
];

function grammarArgv(random: Prng): string[] {
    const argv: string[] = [];
    const group = random.chance(0.9) ? random.pick(cliProtocolConfig.groups) : undefined;
    argv.push(group?.name ?? random.pick(["unknown", "", "--store", "-x"]));
    if (group !== undefined && group.commands.length > 0 && random.chance(0.9)) {
        argv.push(random.pick(group.commands).name);
    }
    // Most commands accept few options, so short invocations reach handlers instead of usage.
    const optionCount = random.chance(0.5) ? 0 : 1 + random.int(3);
    for (let index = 0; index < optionCount; index += 1) {
        const option = `--${random.chance(0.7) ? random.pick(PATH_OPTIONS) : random.pick(OPTIONS)}`;
        if (random.chance(0.2)) argv.push(`${option}=${random.pick(VALUES)}`);
        else {
            argv.push(option);
            if (random.chance(0.8)) argv.push(random.pick(VALUES));
        }
    }
    if (random.chance(0.2)) argv.push(random.pick(VALUES));
    if (random.chance(0.3))
        argv.splice(random.int(argv.length + 1), 0, `--${cliProtocolConfig.options.json}`);
    if (random.chance(0.05))
        argv.splice(random.int(argv.length + 1), 0, random.pick(cliProtocolConfig.helpAliases));
    return argv;
}

function mutateArgv(argv: string[], random: Prng): unknown[] {
    const mutated: unknown[] = [...argv];
    switch (random.int(8)) {
        case 0:
            if (mutated.length > 0) {
                const index = random.int(mutated.length);
                mutated[index] = sanitize(
                    mutateText(String(mutated[index]), random, fuzzSettings.mutation),
                );
            }
            break;
        case 1:
            mutated.push("x".repeat(cliProtocolConfig.limits.maxArgumentBytes + random.int(2)));
            break;
        case 2:
            // Multi-byte characters crossing the byte (not character) limit.
            mutated.push(
                "é".repeat(
                    Math.ceil(cliProtocolConfig.limits.maxArgumentBytes / 2) + random.int(2),
                ),
            );
            break;
        case 3:
            while (mutated.length <= cliProtocolConfig.limits.maxArguments - random.int(2))
                mutated.push("--json");
            break;
        case 4:
            mutated.splice(
                random.int(mutated.length + 1),
                0,
                random.pick([null, 1, {}, [], undefined]),
            );
            break;
        case 5:
            if (mutated.length > 0) mutated.splice(random.int(mutated.length), 1);
            break;
        case 6:
            if (mutated.length > 0) mutated.push(mutated[random.int(mutated.length)]);
            break;
        default:
            break;
    }
    return mutated;
}

function sanitize(value: string): string {
    return value.replaceAll("/", "_").replaceAll("\\", "_");
}

const cli: FuzzTarget = {
    name: "runCli",
    prepare: async () => {
        const root = realpathSync(mkdtempSync(path.join(tmpdir(), "shepherd-fuzz-cli-")));
        const cwd = path.join(root, "a", "b");
        mkdirSync(cwd, { recursive: true });
        {
            using store = new SQLiteTraceStore(path.join(cwd, "trace.sqlite"));
            store.append({
                append_intent_id: "intent:cli-fuzz",
                batch: {
                    groups: [
                        {
                            owner_id: "run:fuzz",
                            records: [
                                {
                                    body: { cli: true },
                                    mode: "capture",
                                    schema_ref: "example.cli-fuzz.v1",
                                    witness_ref: ROOT_WITNESS_ID,
                                },
                            ],
                        },
                    ],
                },
            });
            writeFileSync(path.join(cwd, "archive.json"), store.exportTrace());
        }
        const validate = new Ajv2020({ strict: true }).compile(
            JSON.parse(
                readFileSync(
                    path.join(repositoryRoot, cliProtocolConfig.artifacts.jsonOutputSchema),
                    "utf8",
                ),
            ) as AnySchemaObject,
        );
        const seeds: FuzzInput[] = [
            { kind: "value", value: { argv: ["--help"] } },
            { kind: "value", value: { argv: ["store", "verify", "--json"] } },
            { kind: "value", value: { argv: ["store", "export", "--json"] } },
            { kind: "value", value: { argv: ["run", "list", "--json"] } },
        ];
        return {
            dispose: () => rmSync(root, { force: true, recursive: true }),
            execute: async (input) => {
                const argv = (input as { value: CliCase }).value.argv;
                const stdout: string[] = [];
                const stderr: string[] = [];
                const exitCode = await runCli(argv as string[], {
                    cwd,
                    stderr: (text) => stderr.push(text),
                    stdout: (text) => stdout.push(text),
                });
                return { argv, exitCode, stderr: stderr.join(""), stdout: stdout.join("") };
            },
            generate: (random) => {
                const argv = grammarArgv(random);
                return {
                    kind: "value",
                    value: { argv: random.chance(0.35) ? mutateArgv(argv, random) : argv },
                };
            },
            seeds,
            verifyAccepted: (result) => {
                const { argv, exitCode, stderr, stdout } = result as {
                    argv: readonly unknown[];
                    exitCode: number;
                    stderr: string;
                    stdout: string;
                };
                assert.ok(EXIT_CODES.has(exitCode), `exit code ${exitCode} is not configured`);
                const overLimit =
                    argv.length > cliProtocolConfig.limits.maxArguments ||
                    argv.some(
                        (argument) =>
                            typeof argument !== "string" ||
                            Buffer.byteLength(argument, "utf8") >
                                cliProtocolConfig.limits.maxArgumentBytes,
                    );
                if (overLimit) assert.equal(exitCode, cliProtocolConfig.exitCodes.usage);
                if (argv.includes(`--${cliProtocolConfig.options.json}`)) {
                    const lines = `${stdout}${stderr}`
                        .split("\n")
                        .filter((line) => line.length > 0);
                    assert.equal(lines.length, 1, "JSON mode writes exactly one envelope");
                    const envelope = JSON.parse(lines[0] as string) as { ok: boolean };
                    assert.equal(validate(envelope), true, JSON.stringify(validate.errors));
                    assert.equal(envelope.ok, exitCode === cliProtocolConfig.exitCodes.success);
                }
            },
        };
    },
};

/** `runCli` over grammar-derived and mutated argv with an in-memory CliIo. */
export const CLI_TARGETS: readonly FuzzTarget[] = [cli];
