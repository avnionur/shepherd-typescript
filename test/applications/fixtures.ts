import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import {
    type ApplicationProtocolDefinition,
    type ChildRunRootParent,
    type CodingSupervisorChangedPathsReader,
    type CodingSupervisorDecision,
    type CodingSupervisorPolicy,
    type CodingSupervisorPolicyContext,
    type CodingSupervisorWorkerDefinition,
    type CodingSupervisorWorkerProgram,
    readApplicationProtocol,
    type ScopeResourceGrant,
    schema,
    task,
} from "../../src/index.ts";

/** Supervisor identity every fixture run commands as. */
export const LEAD = "supervisor:lead";

/** Repository experiment definitions read by the application tests. */
export const researchApplications = JSON.parse(
    readFileSync(
        new URL("../../config/research-applications.config.json", import.meta.url),
        "utf8",
    ),
) as { readonly supervision: Record<string, unknown> };

/** Creates one temporary file-backed trace store path removed after the test. */
export async function temporaryDatabasePath(context: TestContext, label: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), `shepherd-applications-${label}-`));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return path.join(directory, "trace.sqlite");
}

/** The repository's Appendix E protocol definition, validated. */
export function supervisionProtocol(
    overrides: Record<string, unknown> = {},
): ApplicationProtocolDefinition {
    return readApplicationProtocol({ ...researchApplications.supervision, ...overrides });
}

/** Unvalidated copy of the repository's Appendix E protocol definition for mutation. */
export function rawSupervisionProtocol(): Record<string, unknown> {
    return structuredClone(researchApplications.supervision);
}

/** Worker task: edit one file and report the path and the text written. */
export const editTask = task({
    input: schema.object({ path: schema.string(), text: schema.string() }),
    instruction: "Write the text into the file at the path and report both.",
    name: "edit-file",
    output: schema.object({ path: schema.string(), text: schema.string() }),
    version: "1",
});

/** One canonical repository grant. */
export function grantOf(
    atoms: readonly ("read" | "write")[],
    resourceId = "repo:main",
): ScopeResourceGrant {
    return { atoms, resource_id: resourceId, resource_kind: "repository_binding" };
}

/** Root declaration with a read/write ceiling on the main repository. */
export function rootParent(
    overrides: Partial<Omit<ChildRunRootParent, "kind">> = {},
): ChildRunRootParent {
    return {
        budget: { maxTurns: 4 },
        ceiling: [grantOf(["read", "write"])],
        kind: "root",
        ...overrides,
    };
}

/** Trace-only changed-path reader over the edit task output. */
export const outputPaths: CodingSupervisorChangedPathsReader = ({ output }) => [
    (output as { readonly path: string }).path,
];

/** Program that echoes its input as the edit result. */
export const echoEdit: CodingSupervisorWorkerProgram = ({ input }) => input;

/** Worker definition overrides; an explicit `undefined` removes the default field. */
export type WorkerOverrides = {
    readonly [Key in keyof CodingSupervisorWorkerDefinition]?:
        | CodingSupervisorWorkerDefinition[Key]
        | undefined;
};

/** Builds one program-serviced worker editing the fixture file. */
export function workerOf(
    workerId: string,
    program: CodingSupervisorWorkerProgram = echoEdit,
    overrides: WorkerOverrides = {},
): CodingSupervisorWorkerDefinition {
    const [file] = supervisionProtocol().dataset.items;
    const definition: Record<string, unknown> = {
        budget: { maxTurns: 2 },
        grant: [grantOf(["read", "write"])],
        input: { path: file as string, text: `${workerId} edit` },
        program,
        task: editTask,
        workerId,
        ...overrides,
    };
    for (const [key, value] of Object.entries(definition)) {
        if (value === undefined) {
            delete definition[key];
        }
    }
    return definition as CodingSupervisorWorkerDefinition;
}

/** Policy that observes once, then accepts the named worker. */
export function acceptAfterObserve(workerId: string): CodingSupervisorPolicy {
    return ({ round }) =>
        round === 1 ? { kind: "observe" } : { kind: "accept", worker_id: workerId };
}

/** Policy that returns the scripted decisions in round order, then accepts the named worker. */
export function scripted(
    decisions: readonly CodingSupervisorDecision[],
    acceptedWorkerId: string,
): CodingSupervisorPolicy & { readonly contexts: CodingSupervisorPolicyContext[] } {
    const contexts: CodingSupervisorPolicyContext[] = [];
    const policy = (context: CodingSupervisorPolicyContext): CodingSupervisorDecision => {
        contexts.push(context);
        return decisions[context.round - 1] ?? { kind: "accept", worker_id: acceptedWorkerId };
    };
    return Object.assign(policy, { contexts });
}
