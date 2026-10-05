"""Render the study manuscript to an editable standalone LaTeX source and a shareable PDF."""

import html
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent
manuscript = json.loads((ROOT / "manuscript.json").read_text())
summary = json.loads((ROOT / "summary.json").read_text())
scope = json.loads((ROOT / "raw/scope-1.json").read_text())
checkpoints = json.loads((ROOT / "raw/checkpoints.stdout.json").read_text())
devices = json.loads((ROOT / "raw/device-layers.stdout.json").read_text())
applications = json.loads((ROOT / "raw/offline-applications.json").read_text())
agent_configuration = json.loads((ROOT / "agent-study.config.json").read_text())
OUTPUT = ROOT / "output/pdf"
OUTPUT.mkdir(parents=True, exist_ok=True)


def number(value, digits=3):
    """Format a measured value to the precision used by its table."""
    return f"{value:,.{digits}f}"


tables = {}
tables["kernel"] = (
    "Table 1. Kernel results: three fresh-dataset repetitions, 12 samples per metric per repetition.",
    ["Operation", "Unit", "Median of medians", "Run median range", "Largest run p95"],
    [[row["metric"].replace("_", " "), row["unit"], number(row["median_of_run_medians"]), f"{number(row['run_median_min'])}-{number(row['run_median_max'])}", number(row["largest_run_p95"])] for row in summary["kernel"]],
)
scope_rows = []
for backend in scope["backends"]:
    for world in scope["configuration"]["worlds"]:
        fork = scope["metrics"][f"fork_ms/{backend}/{world['id']}"]["summary"]
        revert = scope["metrics"][f"revert_ms/{backend}/{world['id']}"]["summary"]
        scope_rows.append([backend, world["id"], number(fork["median"]), number(fork["p95"]), number(revert["median"]), number(revert["p95"])])
tables["scope"] = (
    "Table 2. Public scope latency (ms). Worlds: small 30 KiB/10 files; medium 9.77 MiB/100; large 100 MiB/100. Empirical p95 is the sample maximum.",
    ["Backend", "World", "Fork median", "Fork p95", "Revert median", "Revert p95"],
    scope_rows,
)
tables["checkpoints"] = (
    "Table 3. Additional storage per automatic checkpoint, computed from one 32-step paired workflow per cell. Every file is 4 KiB.",
    ["World files", "Changed files/step", "Blob bytes", "DB bytes", "Total bytes"],
    [[str(row["world_files"]), str(row["changed_bytes_per_step"] // checkpoints["configuration"]["fileBytes"]), f"{row['blob_bytes_per_checkpoint']:,}", f"{row['database_bytes_per_checkpoint']:,}", f"{row['total_bytes_per_checkpoint']:,}"] for row in checkpoints["measurements"]],
)
tables["devices"] = (
    "Table 4. Device-layer summaries in ms: seven measured steps per cell. Empirical p90 equals the maximum; underlying latency samples are not emitted by this script.",
    ["Adapter", "World MiB", "Files", "Checkpoint median", "Checkpoint p90", "Restore median"],
    [[row["adapter"], str(row["world_bytes"] // 1048576), str(row["world_files"]), number(row["checkpoint_median_ms"], 2), number(row["checkpoint_p90_ms"], 2), number(row["restore_median_ms"], 2)] for row in devices["measurements"]],
)
quality_rows = []
for row in summary["agent_context"]:
    quality_rows.append([row["harness"], row["profile"], f"{row['finished']}/{row['trials']}", f"{row['correct_answer']}/{row['trials']}", f"{row['correct_evidence']}/{row['trials']}", f"{row['joint_success']}/{row['trials']}"])
tables["quality"] = (
    "Table 5. Task quality per harness and context: eight tasks x two seeds. Incomplete tests correct abstention; full and selected test supplied knowledge.",
    ["Harness", "Context", "Finished", "Answer", "Evidence", "Joint success"],
    quality_rows,
)
tables["harness"] = (
    "Table 6. Client timing and complete prompt size, including cached tokens. Cache state is shared and not reset; these are descriptive timings.",
    ["Harness", "Context", "Median total ms", "Median residual ms", "Mean prompt tokens", "Mean output tokens"],
    [[row["harness"], row["profile"], number(row["median_elapsed_ms"]), number(row["median_client_residual_ms"]), number(row["mean_prompt_tokens"], 0), number(row["mean_completion_tokens"])] for row in summary["agent_context"]],
)
application_rows = []
for comparison in applications["comparisons"]:
    metrics = {row["metric"]: row for row in comparison["values"]}
    application_rows.append([comparison["experiment_id"], comparison["baseline_kind"], str(metrics["provider_calls"]["application"]), str(metrics["provider_calls"]["baseline"]), str(metrics["steps"]["application"]), str(metrics["steps"]["baseline"])])
tables["applications"] = (
    "Table 7. Scripted application fixtures: compared-side provider calls and retained steps. Counts do not include every whole-run activity; Tree-RL budgets are unequal.",
    ["Application", "Baseline", "App calls", "Base calls", "App steps", "Base steps"],
    application_rows,
)
captions = {
    "scope-latency": "Figure 1. Median and empirical p95 public scope latency. Both file count and bytes change between small and medium; timing includes custody publication and verification.",
    "context-quality": "Figure 2. Context sensitivity and complete prompt length in the local small-model pilot. The selected package is supplied by an oracle. Both harnesses return identical paired outputs; the incomplete condition evaluates abstention.",
}

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="PaperTitle", parent=styles["Title"], fontName="Times-Bold", fontSize=23, leading=27, spaceAfter=12, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="Subtitle", fontName="Times-Roman", fontSize=13, leading=17, alignment=TA_CENTER, spaceAfter=12))
styles.add(ParagraphStyle(name="Body", fontName="Times-Roman", fontSize=10.5, leading=14.5, alignment=TA_JUSTIFY, spaceAfter=8))
styles.add(ParagraphStyle(name="AbstractBody", parent=styles["Body"], fontSize=10, leading=13.5, leftIndent=12, rightIndent=12))
styles.add(ParagraphStyle(name="Caption", fontName="Times-Italic", fontSize=9, leading=12, spaceAfter=9))
styles.add(ParagraphStyle(name="Cell", fontName="Times-Roman", fontSize=8.3, leading=10.5))
styles.add(ParagraphStyle(name="CellHeader", parent=styles["Cell"], fontName="Times-Bold"))
styles["Heading1"].fontName = "Times-Bold"
styles["Heading1"].fontSize = 14
styles["Heading1"].leading = 18
styles["Heading1"].spaceBefore = 17
styles["Heading1"].spaceAfter = 8
styles["Heading2"].fontName = "Times-Bold"
styles["Heading2"].fontSize = 11.5
styles["Heading2"].leading = 15
styles["Heading2"].spaceBefore = 11
styles["Heading2"].spaceAfter = 6

flow = []
tex = [r"\documentclass[11pt,a4paper]{article}", r"\usepackage[T1]{fontenc}", r"\usepackage[margin=25mm]{geometry}", r"\usepackage{booktabs,tabularx,longtable,amsmath,hyperref}", r"\usepackage{pgfplots}", r"\pgfplotsset{compat=1.18}", r"\usepgfplotslibrary{groupplots}", r"\hypersetup{colorlinks=true,urlcolor=blue,linkcolor=black}", r"\setlength{\parskip}{5pt}", r"\setlength{\parindent}{0pt}", r"\emergencystretch=3em"]


def latex(text):
    """Escape authored prose as LaTeX without executing content as commands."""
    replacements = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(replacements.get(char, char) for char in text)


def paragraphs(items, style="Body"):
    """Render shared manuscript paragraphs identically in PDF and LaTeX."""
    for text in items:
        flow.append(Paragraph(html.escape(text), styles[style]))
        tex.append(latex(text) + "\n")


def table(name):
    """Render the derived measurement table with repeated headers and explicit units."""
    caption, header, rows = tables[name]
    data = [[Paragraph(html.escape(value), styles["CellHeader"]) for value in header]]
    data += [[Paragraph(html.escape(value), styles["Cell"]) for value in row] for row in rows]
    width = 160 * mm
    first = 42 * mm if name in {"kernel", "applications"} else 24 * mm
    widths = [first] + [(width - first) / (len(header) - 1)] * (len(header) - 1)
    if name == "applications":
        widths = [37 * mm, 33 * mm] + [22.5 * mm] * 4
    item = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    item.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.8, colors.black), ("LINEBELOW", (0, 0), (-1, 0), 0.4, colors.black), ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f6f7")])]))
    flow.append(KeepTogether([Paragraph(html.escape(caption), styles["Caption"]), item]))
    flow.append(Spacer(1, 8))
    tex.append(r"\begin{center}\small")
    tex.append(r"\textit{" + latex(caption) + "}\\[6pt]")
    tex.append(r"\begin{tabularx}{\linewidth}{" + "X" * len(header) + "}")
    tex.append(r"\toprule")
    tex.append(" & ".join(r"\textbf{" + latex(value) + "}" for value in header) + r" \\")
    tex.append(r"\midrule")
    for row in rows:
        tex.append(" & ".join(latex(value) for value in row) + r" \\")
    tex.append(r"\bottomrule\end{tabularx}\end{center}")


def figure(name):
    """Include the exported scientific graphic and an equivalent self-contained LaTeX plot."""
    image = Image(str(ROOT / "figures" / f"{name}.png"), width=160 * mm, height=75 * mm)
    flow.append(KeepTogether([image, Paragraph(html.escape(captions[name]), styles["Caption"])]))
    tex.append(r"\begin{center}\begin{tikzpicture}")
    tex.append(r"\begin{groupplot}[group style={group size=2 by 1,horizontal sep=1.5cm},width=.43\linewidth,height=5.5cm,legend style={font=\tiny}]")
    if name == "scope-latency":
        for family, title in [("fork_ms", "Fork latency (ms)"), ("revert_ms", "Revert latency (ms)")]:
            tex.append(r"\nextgroupplot[xlabel=World,ylabel={" + title + r"},xtick={0,1,2},xticklabels={small,medium,large},ymin=0,legend pos=north west]")
            for backend in scope["backends"]:
                for statistic in ["median", "p95"]:
                    points = " ".join(f"({index},{scope['metrics'][family + '/' + backend + '/' + world['id']]['summary'][statistic]})" for index, world in enumerate(scope["configuration"]["worlds"]))
                    tex.append(r"\addplot[" + ("dashed" if statistic == "p95" else "mark=*") + "] coordinates {" + points + "};")
                    tex.append(r"\addlegendentry{" + latex(backend + " " + statistic) + "}")
    else:
        rows = [row for row in summary["agent_context"] if row["harness"] == agent_configuration["durableHarness"]]
        tex.append(r"\nextgroupplot[ybar,ylabel={Criterion met (percent)},symbolic x coords={full,selected,incomplete},xtick=data,ymin=0,ymax=110,legend pos=north east]")
        for metric, title in [("correct_answer", "Answer"), ("joint_success", "Answer and citation")]:
            points = " ".join(f"({row['profile']},{100 * row[metric] / row['trials']})" for row in rows)
            tex.append(r"\addplot coordinates {" + points + "};")
            tex.append(r"\addlegendentry{" + title + "}")
        tex.append(r"\nextgroupplot[ybar,ylabel={Mean prompt tokens},symbolic x coords={full,selected,incomplete},xtick=data,ymin=0]")
        points = " ".join(f"({row['profile']},{row['mean_prompt_tokens']})" for row in rows)
        tex.append(r"\addplot coordinates {" + points + "};")
    tex.append(r"\end{groupplot}\end{tikzpicture}")
    tex.append(r"\par\small\textit{" + latex(captions[name]) + r"}\end{center}")


flow.append(Spacer(1, 9 * mm))
flow.append(Paragraph(html.escape(manuscript["title"]), styles["PaperTitle"]))
flow.append(Paragraph(html.escape(manuscript["subtitle"]), styles["Subtitle"]))
flow.append(Paragraph(html.escape(manuscript["author"] + " | " + manuscript["date"]), styles["Subtitle"]))
flow.append(Paragraph(html.escape(manuscript["status"]), styles["Caption"]))
flow.append(Spacer(1, 4 * mm))
flow.append(Paragraph("Abstract", styles["Heading2"]))
tex += [r"\title{" + latex(manuscript["title"]) + r"\\[5pt]\large " + latex(manuscript["subtitle"]) + "}", r"\author{" + latex(manuscript["author"]) + "}", r"\date{" + latex(manuscript["date"]) + "}", r"\begin{document}\maketitle", r"\begin{center}\small " + latex(manuscript["status"]) + r"\end{center}", r"\begin{abstract}"]
paragraphs([manuscript["abstract"]], "AbstractBody")
tex.append(r"\end{abstract}")
paragraphs(["Keywords: " + manuscript["keywords"]], "Caption")
for index, section in enumerate(manuscript["sections"], 1):
    flow.append(Paragraph(f"{index}. {html.escape(section['title'])}", styles["Heading1"]))
    tex.append(r"\section{" + latex(section["title"]) + "}")
    paragraphs(section.get("paragraphs", []))
    for name in [section.get("table"), section.get("second_table")]:
        if name:
            table(name)
    if section.get("figure"):
        figure(section["figure"])
    for position, subsection in enumerate(section.get("subsections", []), 1):
        flow.append(Paragraph(f"{index}.{position}. {html.escape(subsection['title'])}", styles["Heading2"]))
        tex.append(r"\subsection{" + latex(subsection["title"]) + "}")
        paragraphs(subsection["paragraphs"])
        if subsection.get("table"):
            table(subsection["table"])
        if subsection.get("figure"):
            figure(subsection["figure"])
flow.append(Paragraph("References", styles["Heading1"]))
tex.append(r"\begin{thebibliography}{99}")
for reference in manuscript["references"]:
    flow.append(Paragraph(f"[{reference['id']}] {html.escape(reference['text'])} <link href=\"{html.escape(reference['url'], quote=True)}\" color=\"#174a73\">Primary source</link>.", styles["Body"]))
    tex.append(r"\bibitem{ref" + str(reference["id"]) + "} " + latex(reference["text"]) + r" \href{" + reference["url"] + "}{Primary source}.")
tex.append(r"\end{thebibliography}\end{document}")
(ROOT / "paper.tex").write_text("\n\n".join(tex) + "\n")


def page_header(canvas, document):
    """Add consistent running headers and page numbers to every report page."""
    canvas.saveState()
    canvas.setFont("Times-Roman", 8)
    canvas.setFillColor(colors.HexColor("#444444"))
    canvas.drawString(25 * mm, A4[1] - 16 * mm, "Shepherd TypeScript | Empirical technical report | 5 October 2026")
    canvas.drawRightString(A4[0] - 25 * mm, 15 * mm, str(document.page))
    canvas.restoreState()


document = SimpleDocTemplate(str(OUTPUT / "shepherd-empirical-study.pdf"), pagesize=A4, leftMargin=25 * mm, rightMargin=25 * mm, topMargin=24 * mm, bottomMargin=22 * mm, title=manuscript["title"], author=manuscript["author"])
document.build(flow, onFirstPage=page_header, onLaterPages=page_header)
print(OUTPUT / "shepherd-empirical-study.pdf")
