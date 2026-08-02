# README Site and Media Research

Research date: 2026-08-02

Purpose: identify first-party Shepherd material that can support a README update for the independent
TypeScript implementation, while separating paper claims, official Python implementation claims,
this repository's verified capabilities, and media-reuse constraints.

## Primary sources reviewed

- [Shepherd project site](https://shepherd-agents.ai/)
- [Shepherd technical blog](https://shepherd-agents.ai/blog/)
- [Current arXiv record](https://arxiv.org/abs/2605.10913)
- [Paper PDF](https://arxiv.org/pdf/2605.10913)
- [Official Shepherd documentation](https://docs.shepherd-agents.ai/)
- [Official roadmap](https://docs.shepherd-agents.ai/roadmap/)
- [Official Python repository](https://github.com/shepherd-agents/shepherd)
- [Official Python repository license](https://github.com/shepherd-agents/shepherd/blob/main/LICENSE)
- [Paper experiments repository](https://github.com/shepherd-agents/shepherd-experiments)

## Positioning reusable in the README

The project site calls SHEPHERD “Programmable Meta-Agents via Reversible Agentic Execution Traces”
and uses the tagline “Your harness is just another agent.” Its metadata describes agent execution as
a first-class, reversible, Git-like trace, allowing the supervising harness to be another agent.
These are upstream positioning statements, not claims automatically earned by this TypeScript
implementation. Source: [project site](https://shepherd-agents.ai/).

The current paper title is **Shepherd: Enabling Programmable Meta-Agents via Reversible Agentic
Execution Traces**, arXiv:2605.10913. The authors are Simon Yu, Derek Chong, Ananjan Nandi, Dilara
Soylu, Jiuding Sun, Christopher D. Manning, and Weiyan Shi; the site associates the work with
Northeastern University and Stanford University and marks the first three authors as equal
contributors. Sources: [arXiv record](https://arxiv.org/abs/2605.10913) and
[project site](https://shepherd-agents.ai/).

The official implementation and examples are Python. The site and blog use `@task`, `workspace`, and
Python provider imports; the documentation says meta-agents are programmed in Python. The README
must therefore retain the current independent-implementation disclaimer and describe this project
as a TypeScript implementation of the Shepherd model or paper, not as the authors' official
implementation. Sources: [project site](https://shepherd-agents.ai/),
[blog](https://shepherd-agents.ai/blog/), and
[documentation](https://docs.shepherd-agents.ai/).

## Paper relationship and complete concept checklist

The first-party material presents agent execution itself as an object that can be operated on.
Every model action, tool call, and environment change becomes a structured event in a reversible,
Git-like trace. A complete paper-level account should cover these operations:

- create a worker/task;
- observe execution without perturbing it;
- intercept or modify an action before it lands;
- fork coupled agent and environment state;
- revert or rewind to a prior state;
- replay or resume from a prior state.

Sources: [project site](https://shepherd-agents.ai/) and
[blog](https://shepherd-agents.ai/blog/).

The blog organizes the programming model around four constructs:

| Construct | Paper-level role |
| --- | --- |
| Task | Typed, substitutable agent behavior, analogous to a typed function |
| Effect | Intent recorded before execution, enabling observation/interception; analogous to an algebraic effect |
| Scope | Coupled agent/environment state and forks; analogous to a scoped effect handler |
| Trace | Persistent commit graph supporting history operations |

Source: [technical blog](https://shepherd-agents.ai/blog/).

The paper/site demonstrate three application families that should appear in any claim of full paper
coverage:

1. runtime intervention through observation and modification;
2. counterfactual optimization through rewind and replay;
3. meta-agent-guided tree reinforcement learning through strategic forks.

Sources: [project site](https://shepherd-agents.ai/),
[blog](https://shepherd-agents.ai/blog/), and
[paper](https://arxiv.org/abs/2605.10913).

## Upstream results that may be cited, with boundaries

The project site reports that a supervisor improves CooperBench pair-coding pass rate from 28.8% to
54.7%; counterfactual optimization improves Terminal-Bench 2.0 over MetaHarness by 12.8% with 58%
lower wall-clock time; and training-time fork selection doubles GRPO's uplift on Terminal-Bench
2.0. It also describes restoration/forking as about five times faster than `docker commit` and
fork. Source: [project site](https://shepherd-agents.ai/).

The blog additionally reports LiveCodeBench 51.0 versus 40.0 with 46% less wall-clock time,
Tree-GRPO gains of 15.2% over flat GRPO for Qwen and 10.1% for Nemotron, system-fork speedups up to
374 times full copy, and about 95% prompt-prefix/KV-cache reuse. Source:
[technical blog](https://shepherd-agents.ai/blog/).

These numbers are paper/upstream experimental results. If included in this repository's README,
they must be visibly attributed to the paper and must not be presented as TypeScript benchmark or
compatibility results until reproduced here. The existing `.plan/research-notes.md` already adopts
this distinction.

## Exact links and media assets

First-party navigation links:

- Paper abstract: <https://arxiv.org/abs/2605.10913>
- Paper PDF: <https://arxiv.org/pdf/2605.10913>
- Official Python code: <https://github.com/shepherd-agents/shepherd>
- Experiment/reproduction companion: <https://github.com/shepherd-agents/shepherd-experiments>
- Documentation: <https://docs.shepherd-agents.ai/>
- Blog: <https://shepherd-agents.ai/blog/>
- Visual artifact notebooks: <https://github.com/shepherd-agents/shepherd/tree/main/examples/notebooks/visual_artifact>
- Authors' X thread: <https://x.com/shi_weiyan/status/2072355755328700859>

The homepage embeds this teaser:

```html
<video
  class="teaser__video"
  src="assets/teaser.mp4"
  poster="assets/teaser.png"
  autoplay
  loop
  muted
  playsinline
  controls
></video>
```

Exact media URLs:

- Teaser video: <https://shepherd-agents.ai/assets/teaser.mp4>
- Teaser poster: <https://shepherd-agents.ai/assets/teaser.png>
- Figure 1 / overview image: <https://shepherd-agents.ai/assets/fig-teaser.png>
- Shepherd site logo: <https://shepherd-agents.ai/assets/logo-shepherd.png>
- Mechanisms figure: <https://shepherd-agents.ai/assets/fig-mechanisms.png>
- Supervision figure: <https://shepherd-agents.ai/assets/fig-supervision.png>
- Strategies figure: <https://shepherd-agents.ai/assets/fig-strategies.png>
- Counterfactual optimization figure: <https://shepherd-agents.ai/assets/fig-cro.png>
- Tree-GRPO figure: <https://shepherd-agents.ai/assets/fig-treegrpo.png>

The homepage does not expose a distinct Open Graph or Twitter-card image/video in its visible page
metadata. Figure 1 is the strongest static README candidate because its caption covers the trace
operations and all three applications. A practical README treatment is to display that image and
make it a link to the project page or MP4; raw HTML `<video>` support in GitHub README rendering is
not a stable assumption.

## Attribution, copyright, and reuse constraints

The official Python repository is MIT-licensed and identifies the copyright holder as the Shepherd
Authors. Source: [official repository license](https://github.com/shepherd-agents/shepherd/blob/main/LICENSE).
That license covers the repository's software and associated repository documentation; it does not
by itself establish permission for separately hosted website images or video.

The arXiv paper uses CC BY-NC-ND 4.0, which permits sharing with attribution and a license notice,
but limits use to noncommercial sharing and prohibits distributing adaptations. Sources:
[arXiv record](https://arxiv.org/abs/2605.10913) and
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).

No visible copyright, license, or terms notice on the homepage/blog expressly licenses the
site-hosted teaser, poster, logo, or figures. Do not infer that those assets inherit the software
repository's MIT license or the paper's Creative Commons license. Linking or hotlinking is lower
risk than copying the files into this repository. Before vendoring, editing, or redistributing an
asset, obtain or confirm permission and preserve the paper title, authors, source link, and any
required license notice.

The homepage BibTeX title is stale relative to the current arXiv title. Prefer the current arXiv
metadata rather than reproducing the homepage BibTeX entry verbatim. Sources:
[project site](https://shepherd-agents.ai/) and
[current arXiv record](https://arxiv.org/abs/2605.10913).

## Comparison with the current README and plan

The current README already does the following correctly:

- labels the project as an independent TypeScript implementation;
- links the official repository and paper;
- avoids claiming that paper-level behavior is already implemented;
- lists verified current trace-kernel capabilities separately from future goals;
- points to planning and compatibility documentation.

Likely README gaps relative to the user's requested full-paper framing:

- no concise explanation of the problem Shepherd solves or why execution-as-data matters;
- no explicit mapping of Task, Effect, Scope, and Trace;
- no complete list of paper-level operations: observe, intercept/modify, fork, rewind/revert, and
  replay/resume;
- no summary of the paper's three application families;
- no clear visual/video entry point;
- no author/institution-level paper attribution near the paper explanation;
- no links to the blog, docs, experiments, notebooks, or paper PDF;
- no high-level coverage map showing what this TypeScript repository has shipped versus what remains
  on the path to complete paper parity;
- no explicit warning that upstream benchmark results are not TypeScript results;
- no media-license decision recorded for external site assets.

The planning documents already cover most semantic substance: `.plan/README.md` defines shipped,
substrate, paper, and operational compatibility levels; `.plan/research-notes.md` explains the four
primitives and paper applications; `.plan/parity-matrix.md` tracks implementation requirements.
The README update should summarize and link those sources rather than duplicate their full detail.

One existing statement must remain synchronized with evidence: the README currently says
“paper-level behavior is not yet implemented.” As progress advances, replace this only with a
capability-by-capability coverage statement supported by tests and the parity matrix. Do not move
directly from that disclaimer to an undifferentiated “fully implements the paper” claim.

## Recommended no-gap README plan

1. Preserve the independent TypeScript implementation disclaimer and official-Python distinction.
2. Add a short paper-oriented overview using execution-as-data and the four constructs.
3. Add the overview figure as an externally hosted, attributed link only after accepting the
   hotlink dependency; link its click target to the MP4 or project site.
4. Add a compact paper-coverage table mapping each primitive, operation, and application to shipped,
   in-progress, or planned TypeScript evidence.
5. Keep current capability/API documentation grounded in released code.
6. Attribute all benchmark numbers to the paper/upstream and keep them out of TypeScript performance
   claims until reproduced.
7. Add first-party links for the paper, PDF, upstream code, experiments, docs, and blog.
8. Retain NOTICE/license boundaries; do not vendor site media without confirmed permission.
9. Reconcile README status language with `.plan/parity-matrix.md` and `.plan/tracker.md` on every
   update so no paper capability disappears behind a single completion percentage.

