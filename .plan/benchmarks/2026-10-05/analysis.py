"""Recompute study statistics, validate raw evidence, and export scientific figures."""

import csv
import hashlib
import json
import random
import statistics
from pathlib import Path

import pypdfium2 as pdfium
from reportlab.graphics import renderPDF
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, Line, String
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
FIGURES = ROOT / "figures"
FIGURES.mkdir(exist_ok=True)


def read(file):
    """Read a JSON study artifact, resolving paths against its raw directory."""
    return json.loads((RAW / file).read_text())


provenance = read("provenance.json")
run_indices = range(1, provenance["study_configuration"]["kernelRuns"] + 1)
kernel = [read(f"kernel-{index}.json") for index in run_indices]
scope = read("scope-1.json")
agents = read("agent-study/results.json")
config = json.loads((ROOT / "agent-study.config.json").read_text())
for file, digest in provenance["configuration_sha256"].items():
    snapshot = RAW / "configuration" / Path(file).name
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == digest

kernel_table = []
for name, metric in kernel[0]["metrics"].items():
    medians = []
    for run in kernel:
        samples = run["metrics"][name]["samples"]
        summary = run["metrics"][name]["summary"]
        assert summary["count"] == len(samples)
        assert abs(statistics.median(samples) - summary["median"]) <= 0.001
        medians.append(summary["median"])
    kernel_table.append({
        "metric": name,
        "unit": metric["unit"],
        "median_of_run_medians": statistics.median(medians),
        "run_median_min": min(medians),
        "run_median_max": max(medians),
        "largest_run_p95": max(run["metrics"][name]["summary"]["p95"] for run in kernel),
    })

agent_table = []
for harness in config["harnesses"]:
    for profile in config["profiles"]:
        rows = [row for row in agents if row["harness"] == harness and row["profile"] == profile["id"]]
        assert len(rows) == len(config["tasks"]) * len(config["seeds"])
        usage = [json.loads(row["exchanges"][0]["response_body"])["usage"] for row in rows]
        agent_table.append({
            "harness": harness,
            "profile": profile["id"],
            "trials": len(rows),
            "finished": sum(row["terminal"] == "finished" for row in rows),
            "schema_valid": sum(row["schema_valid"] for row in rows),
            "correct_answer": sum(row["answer_correct"] for row in rows),
            "correct_evidence": sum(row["evidence_correct"] for row in rows),
            "joint_success": sum(row["success"] for row in rows),
            "mean_prompt_tokens": statistics.mean(item["prompt_tokens"] for item in usage),
            "mean_cached_prompt_tokens": statistics.mean(item["prompt_tokens_details"]["cached_tokens"] for item in usage),
            "mean_completion_tokens": statistics.mean(item["completion_tokens"] for item in usage),
            "mean_request_bytes": statistics.mean(row["request_bytes"] for row in rows),
            "median_elapsed_ms": statistics.median(row["elapsed_ms"] for row in rows),
            "median_client_residual_ms": statistics.median(row["elapsed_ms"] - row["transport_ms"] for row in rows),
        })

for index in range(0, len(agents), len(config["harnesses"])):
    pair = agents[index:index + len(config["harnesses"])]
    assert len({row["exchanges"][0]["body_sha256"] for row in pair}) == 1
    assert all(row["output"] == pair[0]["output"] for row in pair)
for row in agents:
    task = next(task for task in config["tasks"] if task["id"] == row["task"])
    profile = next(profile for profile in config["profiles"] if profile["id"] == row["profile"])
    answer = None if profile["selection"] == "irrelevant" else task["expectedAnswer"]
    evidence = [] if profile["selection"] == "irrelevant" else task["expectedEvidence"]
    output = row["output"]
    valid = isinstance(output, dict) and set(output) == {"answer", "evidence"}
    independent_score = valid and output["answer"] == answer and sorted(output["evidence"]) == sorted(evidence) and row["terminal"] == "finished"
    assert bool(independent_score) == row["success"]

# Resample entire tasks; the two seeds and both treatments stay paired within each cluster.
# The resulting interval is conditional on this synthetic battery, not a population guarantee.
rng = random.Random(config["bootstrapSeed"])
task_deltas = []
for task in config["tasks"]:
    task_rows = [row for row in agents if row["task"] == task["id"] and row["harness"] == config["harnesses"][-1]]
    means = {profile["id"]: statistics.mean(float(row["success"]) for row in task_rows if row["profile"] == profile["id"]) for profile in config["profiles"]}
    task_deltas.append(means[config["profiles"][1]["id"]] - means[config["profiles"][0]["id"]])
boot = sorted(statistics.mean(rng.choices(task_deltas, k=len(task_deltas))) for _ in range(config["bootstrapRepetitions"]))
interval = [boot[int(len(boot) * 0.025)], boot[int(len(boot) * 0.975) - 1]]
summary = {
    "kernel": kernel_table,
    "agent_context": agent_table,
    "cluster_bootstrap": {"selected_minus_full_joint_success": statistics.mean(task_deltas), "conditional_percentile_95_interval": interval, "task_clusters": len(task_deltas), "repetitions": len(boot), "seed": config["bootstrapSeed"]},
    "scope_correctness": {"passed": sum(check["ok"] for check in scope["revert_checks"]), "checks": len(scope["revert_checks"])},
    "scope_slo": read("scope-1-slo.json"),
    "kernel_slo": [read(f"kernel-{index}-slo.json") for index in run_indices],
}
(ROOT / "summary.json").write_text(json.dumps(summary, indent=4) + "\n")
for name, table in [("kernel-summary", kernel_table), ("agent-context-summary", agent_table)]:
    with (ROOT / f"{name}.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(table[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(table)

colors = [HexColor("#174a73"), HexColor("#ba652c")]


def export_figure(drawing, name):
    """Export the standard plotting-library drawing as a PDF and a rendered PNG."""
    file = FIGURES / f"{name}.pdf"
    renderPDF.drawToFile(drawing, str(file))
    document = pdfium.PdfDocument(str(file))
    document[0].render(scale=2).to_pil().save(FIGURES / f"{name}.png")
    document.close()


worlds = scope["configuration"]["worlds"]
labels = [world["id"] for world in worlds]
drawing = Drawing(640, 300)
drawing.add(String(320, 282, "Public scope latency: median and empirical p95", textAnchor="middle", fontName="Helvetica-Bold", fontSize=12))
for panel, family in enumerate(["fork_ms", "revert_ms"]):
    chart = LinePlot()
    chart.x = 45 + panel * 320
    chart.y = 65
    chart.width = 265
    chart.height = 180
    data = []
    for backend in scope["backends"]:
        for statistic in ["median", "p95"]:
            data.append([(index, scope["metrics"][f"{family}/{backend}/{world['id']}"]["summary"][statistic]) for index, world in enumerate(worlds)])
    chart.data = data
    chart.xValueAxis.valueMin = 0
    chart.xValueAxis.valueMax = 2
    chart.xValueAxis.valueSteps = [0, 1, 2]
    chart.xValueAxis.labelTextFormat = lambda value: labels[int(value)]
    chart.xValueAxis.labels.fontSize = 7
    chart.xValueAxis.labels.angle = 0
    chart.yValueAxis.valueMin = 0
    chart.yValueAxis.labels.fontSize = 8
    for index in range(len(data)):
        chart.lines[index].strokeColor = colors[index // 2]
        chart.lines[index].strokeWidth = 1.5
        if index % 2:
            chart.lines[index].strokeDashArray = [3, 2]
    drawing.add(chart)
    drawing.add(String(chart.x + 130, 253, family.replace("_ms", "").capitalize() + " (ms)", textAnchor="middle", fontName="Helvetica-Bold", fontSize=10))
for index, backend in enumerate(scope["backends"]):
    x = 150 + index * 210
    drawing.add(Line(x, 22, x + 24, 22, strokeColor=colors[index], strokeWidth=2))
    drawing.add(String(x + 30, 19, backend + ": solid median, dashed p95", fontSize=8))
export_figure(drawing, "scope-latency")

profiles = [profile["id"] for profile in config["profiles"]]
rows = [row for row in agent_table if row["harness"] == config["harnesses"][-1]]
drawing = Drawing(640, 300)
drawing.add(String(320, 282, "Local model context pilot: eight tasks, two seeds", textAnchor="middle", fontName="Helvetica-Bold", fontSize=12))
for panel in range(2):
    chart = VerticalBarChart()
    chart.x = 45 + panel * 320
    chart.y = 65
    chart.width = 265
    chart.height = 180
    chart.categoryAxis.categoryNames = profiles
    chart.categoryAxis.labels.fontSize = 9
    chart.valueAxis.valueMin = 0
    chart.valueAxis.labels.fontSize = 8
    if panel == 0:
        chart.data = [[100 * row[metric] / row["trials"] for row in rows] for metric in ["correct_answer", "joint_success"]]
        chart.valueAxis.valueMax = 100
        chart.valueAxis.valueStep = 25
        chart.bars[0].fillColor = colors[0]
        chart.bars[1].fillColor = colors[1]
        title = "Criterion met (%)"
    else:
        chart.data = [[row["mean_prompt_tokens"] for row in rows]]
        chart.bars[0].fillColor = colors[0]
        title = "Mean prompt tokens (including cached)"
    drawing.add(chart)
    drawing.add(String(chart.x + 130, 253, title, textAnchor="middle", fontName="Helvetica-Bold", fontSize=10))
drawing.add(String(45, 28, "Blue: answer; orange: answer plus citation. Incomplete tests abstention.", fontSize=9))
drawing.add(String(45, 14, "The direct and Shepherd harnesses returned identical paired outcomes.", fontSize=9))
export_figure(drawing, "context-quality")
print(json.dumps(summary["cluster_bootstrap"], indent=2))
