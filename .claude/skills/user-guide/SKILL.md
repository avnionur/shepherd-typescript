---
name: user-guide
description: Generate an application user guide as a renderer-agnostic Markdown docs tree organized strictly by the Diátaxis framework — Tutorials, How-to guides, Reference, Explanation — plus a `_nav.yaml` navigation manifest modeled on the OpenAI developer-docs IA. Use when the user wants to document an app, write or scaffold a user guide / docs site, or asks to "generate docs for this codebase".
---

# Application User Guide Generator

Produce a complete, navigable **user guide** for a target application as a portable tree of Markdown pages plus one navigation manifest — no site-generator lock-in.

Two sources govern the output, and they do not overlap:

- **Diátaxis decides _what pages exist and what goes in each one_.** Content is organized into exactly four sections, and every page is classified before it is written. This is authoritative and non-negotiable. (https://diataxis.fr/)
- **The OpenAI developer-docs IA decides _how it looks and navigates_** — landing page anatomy, grouped collapsible sidebar, quickstart-with-tabs, callouts, "next steps" cards. This is a presentation layer only; it never changes which pages exist. (https://developers.openai.com/codex)

Per-type page templates live in [templates.md](templates.md) — load it before emitting pages.

## When to use

Triggers: "generate a user guide", "document this app", "scaffold docs for this codebase", "write end-user documentation". The audience is an **end user of the application**, not a contributor — so the guide is dominated by How-to guides and onboarding Tutorials, with Reference for lookups and Explanation for concepts.

## Inputs (ask if not supplied)

1. **Target path** — the app/codebase to document. Read its source, `README`, config, and any existing docs to build a feature inventory.
2. **Product name** and one-line tagline (for the landing page).
3. **Audience note** — who the end user is and their assumed competence.
4. **Output directory** — defaults to `docs/` at the target root.

Do not invent facts about the app. If the source does not establish something, inspect it or ask; never fabricate steps, flags, or endpoints.

---

## The Diátaxis framework — full reference

Diátaxis is a systematic framework for technical documentation. It identifies four distinct modes of documentation, each answering a different user need at a different moment. The framework's core insight: **confusing these modes is the root cause of most documentation failure.** A page that tries to teach, instruct, describe, and explain all at once serves none of those needs well.

### The compass — classifying every page

The compass reduces classification to **two questions** (https://diataxis.fr/compass/):

1. **Action or cognition?** — is this about *doing practical steps* (action) or *acquiring theoretical/propositional knowledge* (cognition)?
2. **Acquisition or application?** — is the user *studying* (acquiring a skill) or *at work* (applying one)?

The two axes yield exactly four quadrants — one per output section:

| Section | Action / Cognition | Acquisition / Application | User need | User is… |
| --- | --- | --- | --- | --- |
| **Tutorials** | Action | Acquisition | learning by doing | a student |
| **How-to guides** | Action | Application | getting a task done | a practitioner at work |
| **Reference** | Cognition | Application | consulting facts while working | a practitioner looking something up |
| **Explanation** | Cognition | Acquisition | understanding the *why* | a student of the subject |

The compass is **scale-free** — apply it to a whole page or a single paragraph (https://diataxis.fr/compass/). If a draft page mixes two quadrants, **split it**: conflating tutorial and how-to "is at the root of many difficulties that afflict documentation" (https://diataxis.fr/how-to-guides/).

**Common end-user pages are placed by the compass, not bolted on as new sections.** Troubleshooting → a How-to guide ("fix X") or a Reference lookup. FAQ → How-to or Reference by the individual question. Do **not** create a fifth top-level bucket — keeping the four is the discipline that makes the guide coherent.

### The four modes — detailed characteristics

#### Tutorials — learning-oriented (acquisition + action)

> "A tutorial is a lesson. It is learning-oriented. It is an experience that takes place under the guidance of a teacher." — https://diataxis.fr/tutorials/

**Purpose:** Give the learner a successful, confidence-building first encounter. The teacher owns the outcome; the learner follows along.

**Quality characteristics:**
- It must **work for every user, every time** — no "it depends on your setup."
- Every step must **produce a comprehensible result, however small** — the learner sees progress at each step.
- It is **reliable** — the same inputs always produce the same outputs.
- It is **concrete and specific** — one happy path, no branching, no "you could also…"
- It is **meaningful** — the learner builds something recognisable, not a contrived toy.

**Anti-patterns — what a tutorial is NOT:**
- ❌ Not a how-to guide — does not offer multiple ways or assume competence.
- ❌ Not an explanation — ruthlessly minimises "why" digressions.
- ❌ Not a reference — does not enumerate options or list all parameters.
- ❌ Not a "quickstart" that skips steps — every step is explicit.
- ❌ Not a "getting started" that dumps the learner into choices — no "if you use X, go here; if Y, go there."

**Voice:** Second person, imperative, present tense. "You create a file." "Run this command." The teacher is present and guiding.

> **Next:** [How-to guides](#how-to-guides--goal-oriented-application--action) — once the learner has completed a tutorial, they become a practitioner who needs task recipes.

---

#### How-to guides — goal-oriented (application + action)

> "A how-to guide is a direction. It is goal-oriented. It guides the reader through the steps required to solve a real-world problem." — https://diataxis.fr/how-to-guides/

**Purpose:** Solve a specific, real-world problem for a user who already knows the basics. The user brings the goal; the guide provides the recipe.

**Quality characteristics:**
- It addresses a **real, named problem** — "How to configure SSO with Okta", not "Configuration options."
- It assumes **competence** — the reader knows the domain; do not teach fundamentals.
- It is a **series of steps** — numbered, imperative, in logical order.
- It is **practical** — every step is actionable; no background theory.
- It tells the user **what they will achieve** at the start.
- It tells the user **how to verify success** at the end.

**Anti-patterns — what a how-to guide is NOT:**
- ❌ Not a tutorial — does not hold the user's hand or teach concepts.
- ❌ Not an explanation — no "why this works" digressions; link out instead.
- ❌ Not a reference — does not exhaustively list all options; shows one working path.
- ❌ Not a collection of unrelated tips — each guide solves one problem.

**Voice:** Second person, imperative, present tense. "Configure the endpoint." "Restart the service." Direct and economical.

> **Also see:** [Reference](#reference--information-oriented-application--cognition) — the user may need to look up a flag or field while following a how-to.
> **Next:** [Explanation](#explanation--understanding-oriented-acquisition--cognition) — after completing tasks, users often want to understand the design behind them.

---

#### Reference — information-oriented (application + cognition)

> "Reference guides are technical descriptions of the machinery and how to operate it. Reference material is information-oriented." — https://diataxis.fr/reference/

**Purpose:** Provide neutral, accurate, complete factual information that a practitioner can consult while working. The user knows what they're looking for; the reference helps them find it.

**Quality characteristics:**
- **Austere and uncompromising** in style — no fluff, no persuasion, no instruction.
- **Structure mirrors the product** — if the product has a CLI, the reference has a CLI section with the same subcommands in the same order.
- **Neutral description** — states what something is and does, never what the user "should" do with it.
- **Complete** — every option, flag, field, endpoint, and return value is documented.
- **Consistent** — every entry follows the same format so the user can scan.

**Anti-patterns — what reference is NOT:**
- ❌ Not a how-to guide — does not tell the user what steps to take; link out instead.
- ❌ Not an explanation — does not discuss why a design decision was made.
- ❌ Not a tutorial — does not walk through a learning experience.
- ❌ Not a list of examples — one example per entry at most; the format is the authority.

**Voice:** Third person, declarative, present tense. "The `--output` flag specifies the destination path." No "you", no imperatives. Describe, don't instruct.

> **Also see:** [How-to guides](#how-to-guides--goal-oriented-application--action) — the user consults reference while following a how-to.
> **Also see:** [Explanation](#explanation--understanding-oriented-acquisition--cognition) — reference describes *what*; explanation describes *why*.

---

#### Explanation — understanding-oriented (acquisition + cognition)

> "Explanation is discussion. It is understanding-oriented. It provides background and context; it illuminates the connections between things." — https://diataxis.fr/explanation/

**Purpose:** Supply the *why* — design decisions, historical reasons, constraints, trade-offs, and conceptual models. Explanation builds the mental framework that makes everything else make sense.

**Quality characteristics:**
- It is **discursive** — it takes its time, explores connections, considers alternatives.
- It provides **context** — why was this choice made? What were the alternatives?
- It builds a **mental model** — the reader comes away understanding how the pieces fit together.
- It **keeps its distance** from immediate action — no step-by-step instructions.
- It **connects ideas** — links to related concepts, historical context, and adjacent topics.

**Anti-patterns — what explanation is NOT:**
- ❌ Not a how-to guide — does not give step-by-step instructions.
- ❌ Not a tutorial — does not walk the reader through a learning exercise.
- ❌ Not a reference — does not exhaustively list facts; selects what matters for understanding.
- ❌ Not a sales pitch or opinion piece — grounded in the actual design of the product.

**Voice:** Second or third person, discursive, present tense. "The system uses an event-driven architecture because…" Can use "we" for design rationale. More relaxed and reflective than the other three modes.

> **Also see:** [Reference](#reference--information-oriented-application--cognition) — explanation illuminates the reference; reference grounds the explanation in facts.
> **Also see:** [Tutorials](#tutorials--learning-oriented-acquisition--action) — a good tutorial may link to explanation for the curious learner who wants to go deeper.

---

### How to use Diátaxis — the iterative method

Diátaxis is applied in **small steps**, not up-front planning (https://diataxis.fr/how-to-use-diataxis/). The four-section skeleton is fixed; the pages inside grow incrementally.

1. **Start anywhere.** Pick the most urgent user need — a missing how-to, a confusing concept, an incomplete reference — and write one page.
2. **Classify with the compass.** Before writing, answer the two questions. If the answer is ambiguous, the page is trying to do too much — split it.
3. **Write in the right voice.** Each quadrant has a distinct voice (see above). Stay in it.
4. **Cross-link.** Every page should link to its natural neighbours — a how-to links to the reference for the flags it uses; an explanation links to the reference it illuminates; a tutorial links to the how-to for the next real task.
5. **Revisit and improve.** Diátaxis is a quality discipline, not a one-time taxonomy. Revisit weak pages, re-run the compass, and tighten the voice. The structure stays; the content sharpens.

### Cross-linking patterns

Diátaxis pages are not silos — they form a web. Every page should include **"Also see"** and/or **"Next steps"** links at the bottom, following these natural relationships:

| From | To | Rationale |
| --- | --- | --- |
| Tutorial | How-to | The learner finishes the tutorial and is ready for real tasks. |
| Tutorial | Explanation | The curious learner wants to understand *why* something worked. |
| How-to | Reference | The practitioner needs to look up a flag, field, or endpoint used in the steps. |
| How-to | Explanation | The practitioner wants to understand the design behind the task. |
| How-to | How-to (related) | The practitioner finishes one task and needs a related one. |
| Reference | How-to | The practitioner looking at a flag wants to see it used in context. |
| Reference | Explanation | The practitioner wants to understand *why* a component works this way. |
| Explanation | Reference | The reader wants to see the factual description that grounds the discussion. |
| Explanation | Explanation (related) | The reader wants to explore adjacent concepts. |
| Landing | Tutorial (Quickstart) | The new user's first action. |
| Landing | How-to (key tasks) | The returning user's most common needs. |

**Format for cross-links:**

```markdown
## Next steps

- [How to configure authentication](../how-to/configure-authentication.md) — set up SSO for your team.
- [Authentication concepts](../explanation/authentication.md) — understand the auth model.

## Also see

- [CLI reference](../reference/cli.md) — all commands used on this page.
- [Architecture overview](../explanation/architecture.md) — how the pieces fit together.
```

---

## Output taxonomy (fixed — exactly four sections)

Emit this tree. The four content directories are the Diátaxis quadrants; `index.md` and `_nav.yaml` are the Codex-style presentation wrapper.

```
<output-dir>/
├── index.md                       # Landing: H1 + tagline + capability blurbs + action cards
├── tutorials/                     # ACQUISITION + ACTION — learning by doing
│   ├── quickstart.md              #   the one canonical "get to first success" tutorial
│   └── getting-started-<flow>.md
├── how-to/                        # APPLICATION + ACTION — task recipes for competent users
│   ├── <verb-noun>.md             #   e.g. configure-authentication.md, export-data.md
│   └── integrations/<system>.md
├── reference/                     # APPLICATION + COGNITION — neutral description of the machinery
│   ├── configuration.md           #   settings, flags, file formats
│   ├── cli.md  /  api.md          #   commands / endpoints — structure mirrors the product
│   └── glossary.md
├── explanation/                   # ACQUISITION + COGNITION — concepts and the "why"
│   ├── concepts.md
│   └── architecture.md
└── _nav.yaml                      # navigation manifest (sidebar groups + top-nav)
```

### `_nav.yaml` — renderer-agnostic navigation manifest

One manifest encodes the whole IA so any generator (MkDocs, Docusaurus, Mintlify, a custom renderer) can build the site. Emit exactly this schema:

```yaml
site:
  name: <Product Name>
  tagline: <one line>
top_nav:                    # sticky global header, Codex-style
  - { label: Home, path: index.md }
  - { label: Tutorials, path: tutorials/ }
  - { label: How-to, path: how-to/ }
  - { label: Reference, path: reference/ }
  - { label: Explanation, path: explanation/ }
features:                   # renderer capabilities to enable (presentation layer)
  search: true
  theme_toggle: true        # light + dark
sidebar:                    # grouped, collapsible left nav — one group per section
  - group: Tutorials
    items:
      - { label: Quickstart, path: tutorials/quickstart.md }
  - group: How-to guides
    items:
      - { label: <task>, path: how-to/<verb-noun>.md }
  - group: Reference
    items:
      - { label: Configuration, path: reference/configuration.md }
  - group: Explanation
    items:
      - { label: Core concepts, path: explanation/concepts.md }
```

---

## Per-type writing rules

Each section has a distinct voice and set of anti-patterns, quoted from the framework. Full page templates are in [templates.md](templates.md).

- **Tutorials — learning-oriented** (https://diataxis.fr/tutorials/). A guided lesson where the teacher owns the outcome; it must "work for every user, every time" and every step must "produce a comprehensible result, however small." **Ruthlessly minimise explanation** — no digressions, no options/alternatives, no generalizations. One happy path to a first success.
- **How-to guides — goal-oriented** (https://diataxis.fr/how-to-guides/). "Directions that guide the reader through a problem or towards a result" for the **already-competent user**. A titled real-world task ("How to …"), a numbered series of steps, no teaching of basics. Wholly distinct from a tutorial.
- **Reference — information-oriented** (https://diataxis.fr/reference/). "Technical descriptions of the machinery and how to operate it." Style is "austere and uncompromising": neutrality, accuracy, completeness. **Structure mirrors the product.** Describe, don't instruct — link out to how-to/explanation instead of embedding it.
- **Explanation — understanding-oriented** (https://diataxis.fr/explanation/). "A discursive treatment of a subject, that permits reflection." Supplies the **why** — design decisions, historical reasons, constraints. Keeps its distance from immediate action.

Across all four, apply developer-docs style craft (https://developers.google.com/style): **second person, active voice, present tense, sentence-case task-oriented headings.**

---

## Presentation conventions (Codex-style, applied on top)

Layer these onto the content without changing the taxonomy (observed at https://developers.openai.com/codex and https://developers.openai.com/codex/quickstart):

- **Landing (`index.md`)** — H1 + one-line tagline, capability blurbs (short header + paragraph each), then a row of **action cards** linking to Quickstart / key how-tos / concepts.
- **Navigation** — grouped collapsible sidebar (one group per section) + sticky top nav; `_nav.yaml` enables search and a light/dark theme toggle.
- **Pages** — H1 + short intro + sentence-case headings; **numbered steps** for procedures; **tabs** for platform/language variants; **tip / note / warning callouts**; fenced code blocks (copyable); light+dark screenshots where helpful; a closing **"Next steps"** pair of links.

---

## Process

1. **Ingest** — glob and read the target app: source, `README`, config, and any existing docs. Build an inventory of features, tasks, config surfaces, and concepts. Use `kb_search` / `kb_load` if the app ships a knowledge base.
2. **Classify** — run the compass on every inventory item; assign each to Tutorials / How-to / Reference / Explanation. Record the classification. Split anything that spans two quadrants.
3. **Emit pages** — write each page from its per-type template in [templates.md](templates.md), in the right section, in the right voice.
4. **Emit the wrapper** — `index.md` (landing) and `_nav.yaml` (grouped sidebar + top-nav), with "next steps" links between related pages.
5. **Iterate, don't outline** — Diátaxis is applied in **small steps**, not up-front planning (https://diataxis.fr/how-to-use-diataxis/). Revisit weak pages one at a time, re-run the compass, and improve. The four-section skeleton is fixed; the pages inside grow incrementally.

---

## Guardrails

- Exactly four top-level content sections. No fifth bucket — Troubleshooting/FAQ are placed by the compass.
- Never mix quadrants on one page; split instead.
- Output stays renderer-agnostic: Markdown pages + one `_nav.yaml`. Do not emit generator-specific config unless the user asks.
- Every documented step, flag, command, or endpoint must be grounded in the target source — no invented behavior.

---

## Related

- [Page templates](templates.md) — per-quadrant Markdown templates with quality checklists.
- [Diátaxis framework](https://diataxis.fr/) — the authoritative source for the four-mode documentation system.
- [Diátaxis compass](https://diataxis.fr/compass/) — the two-question classification tool.
- [How to use Diátaxis](https://diataxis.fr/how-to-use-diataxis/) — the iterative methodology.
- [Google developer documentation style guide](https://developers.google.com/style) — voice and formatting conventions.
- [OpenAI developer docs](https://developers.openai.com/codex) — Codex-style IA reference for presentation layer.
