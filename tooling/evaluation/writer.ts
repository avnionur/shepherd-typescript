import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    canonicalizeSemanticValue,
    type SemanticValue,
} from "../../src/canonical/canonical-record.ts";
import {
    type ApplicationEvaluationBaseline,
    type ApplicationEvaluationReport,
    runApplicationEvaluation,
    SQLiteTraceStore,
} from "../../src/index.ts";
import { type RepositoryEvaluation, resolveRepositoryEvaluation } from "./harness.ts";

/** Repository-relative research applications configuration the evaluation is resolved from. */
const CONFIG_PATH = "config/research-applications.config.json";

/**
 * Marker separating the checked, host-independent page body from the generation host section.
 * Everything after it describes the host that last wrote the page and is excluded from the check.
 */
export const EVALUATION_HOST_MARKER = "<!-- generation-host: excluded from check:evaluation -->";

/** Host and platform metadata that appears only in the generated page. */
export type EvaluationHost = {
    /** Processor architecture. */
    readonly arch: string;
    /** Node.js version. */
    readonly node: string;
    /** Operating system platform. */
    readonly platform: string;
};

/** Repository, execution mode, and host for evaluation artifact synchronization. */
export type ApplicationEvaluationArtifactOptions = {
    /** Whether to reject drift instead of writing the report and page. */
    readonly check?: boolean;
    /** Host metadata written into the page; defaults to the current process. */
    readonly host?: EvaluationHost;
    /** Repository root containing the configuration and the artifact destinations. */
    readonly repositoryRoot: string;
};

/**
 * Runs the repository evaluation offline in a fresh in-memory store and writes, or checks, the
 * digest-bearing JSON report and its human-readable page.
 *
 * The JSON report carries no host, wall-clock, or duration data and must match byte for byte. The
 * page's body above {@link EVALUATION_HOST_MARKER} is derived only from the report and must match
 * too; the generation host section after the marker is written but never compared, so the check
 * passes on any supported host.
 *
 * @param options - Repository root, check mode, and optional host metadata.
 * @returns The report the evaluation produced.
 * @throws {Error} In check mode, if the report or the page body drifted or the marker is missing.
 * @throws {TypeError} If a configured artifact path escapes the repository.
 */
export async function synchronizeApplicationEvaluation(
    options: ApplicationEvaluationArtifactOptions,
): Promise<ApplicationEvaluationReport> {
    const repositoryRoot = await realpath(options.repositoryRoot);
    const configuration = JSON.parse(
        await readFile(path.join(repositoryRoot, CONFIG_PATH), "utf8"),
    ) as Readonly<Record<string, unknown>>;
    const evaluation = resolveRepositoryEvaluation(configuration);
    const reportPath = artifactPath(repositoryRoot, evaluation.artifacts.report);
    const pagePath = artifactPath(repositoryRoot, evaluation.artifacts.page);
    const report = await evaluate(evaluation);
    const json = renderEvaluationReportJson(report);
    const body = renderEvaluationPage(report, evaluation.artifacts);
    if (options.check === true) {
        if ((await readFile(reportPath, "utf8")) !== json) {
            throw new Error(
                `${evaluation.artifacts.report} is not synchronized with ${CONFIG_PATH}`,
            );
        }
        // The body ends with the host marker, so a page without it cannot start with the body.
        if (!(await readFile(pagePath, "utf8")).startsWith(body)) {
            throw new Error(`${evaluation.artifacts.page} is not synchronized with ${CONFIG_PATH}`);
        }
        return report;
    }
    await mkdir(path.dirname(reportPath), { recursive: true });
    await mkdir(path.dirname(pagePath), { recursive: true });
    await writeFile(reportPath, json);
    await writeFile(pagePath, `${body}${renderHostSection(options.host ?? currentHost())}`);
    return report;
}

/**
 * Renders the report as indented JSON with canonically ordered keys and a trailing line feed.
 *
 * @param report - Validated evaluation report.
 * @returns The artifact text.
 */
export function renderEvaluationReportJson(report: ApplicationEvaluationReport): string {
    const ordered = JSON.parse(canonicalizeSemanticValue(report as unknown as SemanticValue));
    return `${JSON.stringify(ordered, null, 4)}\n`;
}

/**
 * Renders the host-independent page body: provenance, runs, manifest costs, comparisons with the
 * baseline evidence, rescue counts, and the published limitations, ending with the host marker.
 *
 * @param report - Validated evaluation report.
 * @param artifacts - Repository-relative page, report, and documentation paths.
 * @returns The page body up to and including {@link EVALUATION_HOST_MARKER}.
 */
export function renderEvaluationPage(
    report: ApplicationEvaluationReport,
    artifacts: RepositoryEvaluation["artifacts"],
): string {
    const directory = path.posix.dirname(artifacts.page);
    const lines = [
        "# Application evaluation report",
        "",
        `<!-- Generated from ${CONFIG_PATH} by \`pnpm evaluate:applications\`. Do not edit directly. \`pnpm check:evaluation\` fails when the JSON report or this page above the generation host section drifts. -->`,
        "",
        `Report \`${report.report_id}\` ([JSON](${path.posix.relative(directory, artifacts.report)})), evaluation \`${report.evaluation_id}\` revision \`${report.revision}\`, report version ${report.report_version}, \`${report.compatibility_version}\`.`,
        "",
        `Every figure is this repository's offline measurement on synthetic fixtures with configured seeds and static providers. Upstream headline results are not reproduced. Metrics are measured only; the delta is the application value minus the baseline value. See [application evaluation](${path.posix.relative(directory, artifacts.documentation)}) for what each metric counts.`,
        "",
        "## Runs",
        "",
        "| Experiment | Kind | Protocol version | Seeds | Dataset | Manifest |",
        "| --- | --- | --- | --- | --- | --- |",
        ...report.runs.map(
            (run) =>
                `| ${run.experiment_id} | \`${run.kind}\` | \`${run.protocol_version}\` | ${run.seeds.join(", ")} | \`${run.dataset.id}\` r${run.dataset.revision}: ${run.dataset.items.map((item) => `\`${item}\``).join(", ")} | \`${run.manifest_id}\` |`,
        ),
        "",
        "## Manifest costs",
        "",
        "Whole-run measured costs retained in each manifest, including work outside the compared metrics.",
        "",
        "| Experiment | Provider calls | Input tokens | Output tokens | Cache creation | Cache read | Cost (USD) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...report.runs.map(
            ({ costs, experiment_id }) =>
                `| ${experiment_id} | ${costs.provider_calls} | ${costs.input_tokens} | ${costs.output_tokens} | ${costs.cache_creation_input_tokens} | ${costs.cache_read_input_tokens} | ${cell(costs.cost_usd)} |`,
        ),
        "",
        "## Comparisons",
        ...report.comparisons.flatMap((comparison, index) => [
            "",
            `### ${comparison.experiment_id} against \`${comparison.baseline_kind}\``,
            "",
            "| Metric | Application | Baseline | Delta |",
            "| --- | --- | --- | --- |",
            ...comparison.values.map(
                (value) =>
                    `| \`${value.metric}\` | ${cell(value.application)} | ${cell(value.baseline)} | ${cell(value.delta)} |`,
            ),
            "",
            `Baseline evidence: ${(report.baselines[index] as ApplicationEvaluationBaseline).evidence.map((entry) => `\`${entry}\``).join(", ")}.`,
            "",
            "These values measure only the compared sessions of each side, not the whole run; a delta is not a whole-run saving. Whole-run costs are in the manifest costs table above.",
        ]),
        "",
        "## Rescues",
        "",
        "Experiments whose baseline failed its success condition while the application run passed (Appendix D, Table 12).",
        "",
        `Rescued: ${report.rescues.count} of ${report.runs.length}${report.rescues.experiment_ids.length === 0 ? "." : ` (${report.rescues.experiment_ids.join(", ")}).`}`,
        "",
        "## Limitations",
        "",
        ...report.limitations.map((limitation) => `- **${limitation.id}**: ${limitation.text}`),
        "",
        EVALUATION_HOST_MARKER,
    ];
    return `${lines.join("\n")}\n`;
}

function renderHostSection(host: EvaluationHost): string {
    return [
        "",
        "## Generation host",
        "",
        "Host metadata of the last write; it never enters the JSON report or the check.",
        "",
        "| Field | Value |",
        "| --- | --- |",
        `| Node.js | \`${host.node}\` |`,
        `| Platform | \`${host.platform}\` |`,
        `| Architecture | \`${host.arch}\` |`,
        "",
    ].join("\n");
}

function currentHost(): EvaluationHost {
    return { arch: process.arch, node: process.version, platform: process.platform };
}

async function evaluate(evaluation: RepositoryEvaluation): Promise<ApplicationEvaluationReport> {
    using store = new SQLiteTraceStore();
    // Await inside the disposal scope: the store closes when this function returns.
    return await runApplicationEvaluation(store, {
        bind: evaluation.bind,
        definition: evaluation.definition,
    });
}

function artifactPath(repositoryRoot: string, relativePath: string): string {
    const resolved = path.resolve(repositoryRoot, relativePath);
    const relative = path.relative(repositoryRoot, resolved);
    if (
        path.isAbsolute(relativePath) ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`)
    ) {
        throw new TypeError(`unsafe evaluation artifact path: ${relativePath}`);
    }
    return resolved;
}

function cell(value: number | boolean | null): string {
    return value === null ? "n/a" : String(value);
}
