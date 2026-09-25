import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    type ApplicationEvaluationExperiment,
    type TrajectoryCompressionEvaluationBinding,
    validateApplicationEvaluationReport,
} from "../../src/index.ts";
import {
    EVALUATION_HOST_MARKER,
    renderEvaluationPage,
    synchronizeApplicationEvaluation,
} from "../../tooling/evaluation/writer.ts";
import { repositoryEvaluation } from "./evaluation-fixtures.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const CONFIG = "config/research-applications.config.json";
const REPORT = "docs/generated/application-evaluation.json";
const PAGE = "docs/generated/application-evaluation.md";

async function temporaryRepository(context: TestContext): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "shepherd-evaluation-"));
    context.after(() => rm(root, { force: true, recursive: true }));
    await mkdir(path.join(root, "config"), { recursive: true });
    await cp(path.join(repositoryRoot, CONFIG), path.join(root, CONFIG));
    return root;
}

test("the committed evaluation artifacts are synchronized with the repository configuration", async () => {
    const report = await synchronizeApplicationEvaluation({ check: true, repositoryRoot });
    const committed = JSON.parse(await readFile(path.join(repositoryRoot, REPORT), "utf8"));
    assert.deepEqual(validateApplicationEvaluationReport(committed), report);
    const page = await readFile(path.join(repositoryRoot, PAGE), "utf8");
    assert.ok(page.includes(report.report_id));
    assert.ok(page.includes(EVALUATION_HOST_MARKER));
});

test("the writer generates, re-checks on any host, and rejects mutated artifacts", async (context) => {
    const root = await temporaryRepository(context);
    const host = { arch: "host-arch-q7", node: "v0.0.0-q7", platform: "host-platform-q7" };
    const written = await synchronizeApplicationEvaluation({ host, repositoryRoot: root });
    const json = await readFile(path.join(root, REPORT), "utf8");
    const page = await readFile(path.join(root, PAGE), "utf8");
    // Host metadata appears only after the marker in the page, never in the JSON report.
    for (const value of Object.values(host)) {
        assert.equal(json.includes(value), false);
        assert.ok(page.indexOf(value) > page.indexOf(EVALUATION_HOST_MARKER));
    }
    // A check on a different host passes; the host section is not compared.
    const checked = await synchronizeApplicationEvaluation({
        check: true,
        host: { arch: "host-arch-z9", node: "v0.0.0-z9", platform: "host-platform-z9" },
        repositoryRoot: root,
    });
    assert.equal(checked.report_id, written.report_id);
    await writeFile(path.join(root, PAGE), `${page}\nextra host notes\n`);
    await synchronizeApplicationEvaluation({ check: true, repositoryRoot: root });
    // A mutated report, a mutated page body, or a page without the marker fails the check.
    const mutations: readonly (readonly [string, string])[] = [
        [REPORT, json.replace('"success": true', '"success": false')],
        [REPORT, json.replace(written.report_id, `evaluation-report:sha256:${"0".repeat(64)}`)],
        [REPORT, `${json}\n`],
        [PAGE, page.replace("## Limitations", "## Caveats")],
        [PAGE, page.replace(EVALUATION_HOST_MARKER, "")],
    ];
    for (const [relative, content] of mutations) {
        const original = await readFile(path.join(root, relative), "utf8");
        await writeFile(path.join(root, relative), content);
        await assert.rejects(
            synchronizeApplicationEvaluation({ check: true, repositoryRoot: root }),
            new RegExp(`${relative.replaceAll(".", "\\.")} is not synchronized`, "u"),
        );
        await writeFile(path.join(root, relative), original);
    }
    // Rewriting without a host uses the current process metadata and stays checkable.
    await synchronizeApplicationEvaluation({ repositoryRoot: root });
    assert.ok((await readFile(path.join(root, PAGE), "utf8")).includes(process.version));
    await synchronizeApplicationEvaluation({ check: true, repositoryRoot: root });
    // A configuration change is drift until the artifacts are regenerated.
    const configuration = JSON.parse(await readFile(path.join(root, CONFIG), "utf8"));
    configuration.evaluation.definition.revision = `${configuration.evaluation.definition.revision}-drift`;
    await writeFile(path.join(root, CONFIG), JSON.stringify(configuration));
    await assert.rejects(
        synchronizeApplicationEvaluation({ check: true, repositoryRoot: root }),
        /application-evaluation\.json is not synchronized/u,
    );
});

test("the writer refuses artifact paths outside the repository and absent artifacts", async (context) => {
    const root = await temporaryRepository(context);
    await assert.rejects(synchronizeApplicationEvaluation({ check: true, repositoryRoot: root }), {
        code: "ENOENT",
    });
    for (const report of ["../outside.json", "/tmp/outside.json"]) {
        const configuration = JSON.parse(await readFile(path.join(repositoryRoot, CONFIG), "utf8"));
        configuration.evaluation.artifacts.report = report;
        await writeFile(path.join(root, CONFIG), JSON.stringify(configuration));
        await assert.rejects(
            synchronizeApplicationEvaluation({ repositoryRoot: root }),
            /unsafe evaluation artifact path/u,
        );
    }
});

test("the repository verifier rejects a candidate whose result differs from the original", async () => {
    const evaluation = repositoryEvaluation();
    const experiment = evaluation.definition.experiments.find(
        (candidate) => candidate.protocol.kind === "trajectory_compression",
    ) as ApplicationEvaluationExperiment;
    const binding = evaluation.bind(experiment) as TrajectoryCompressionEvaluationBinding;
    const judge = binding.options.verifier.program as (context: unknown) => {
        readonly result: string;
    };
    const verdict = JSON.parse(
        judge({
            compressed: { terminal: { result: { value: "short" } } },
            original: { terminal: { result: { value: "long" } } },
        }).result,
    );
    assert.equal(verdict.verdict, "rejected");
});

test("the page lists rescued experiments by identity", async () => {
    const report = await synchronizeApplicationEvaluation({ check: true, repositoryRoot });
    const artifacts = repositoryEvaluation().artifacts;
    assert.ok(renderEvaluationPage(report, artifacts).includes("Rescued: 0 of 4."));
    const [first, second] = report.runs;
    const rescued = {
        ...report,
        rescues: { count: 2, experiment_ids: [first?.experiment_id, second?.experiment_id] },
    } as typeof report;
    assert.ok(
        renderEvaluationPage(rescued, artifacts).includes(
            `Rescued: 2 of 4 (${first?.experiment_id}, ${second?.experiment_id}).`,
        ),
    );
});

test("the repository compressor proposes a null prefix identity at fork step 0", async () => {
    const evaluation = repositoryEvaluation((configuration) => {
        const fixtures = (
            configuration.evaluation as { fixtures: Record<string, Record<string, unknown>> }
        ).fixtures;
        (fixtures["trajectory-compression"] as Record<string, unknown>).forkStepIndex = 0;
    });
    const experiment = evaluation.definition.experiments.find(
        (candidate) => candidate.protocol.kind === "trajectory_compression",
    ) as ApplicationEvaluationExperiment;
    const binding = evaluation.bind(experiment) as TrajectoryCompressionEvaluationBinding;
    const propose = binding.options.compressor.program as (context: unknown) => {
        readonly result: string;
    };
    const sessionId = `replay-session:sha256:${"a".repeat(64)}`;
    const proposal = JSON.parse(
        propose({ source: { session_id: sessionId, steps: [{ prefix_id: "p" }] } }).result,
    );
    assert.deepEqual(proposal.fork_point, {
        prefix_id: null,
        session_id: sessionId,
        step_index: 0,
    });
});
