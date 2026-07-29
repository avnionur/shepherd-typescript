# Page templates

Fenced Markdown templates the `user-guide` skill emits, one per Diátaxis quadrant, plus the landing page. Fill the `<placeholders>`; keep each page inside its single quadrant. Voice per type is quoted from the source pages in `SKILL.md`.

Each template includes a **quality checklist** — verify every item before declaring the page done.

---

## Tutorial — `tutorials/*.md`

Learning-oriented. One happy path to a first success. Ruthlessly minimise explanation; no options, no digressions. Every step yields a visible result. (https://diataxis.fr/tutorials/)

````markdown
# <Get started with … / Build your first …>

> **What you'll do:** <the single concrete outcome the learner reaches>.
> **Time:** ~<n> minutes.
> **You need:** <the minimum prerequisites, stated plainly — no teaching here>.

<One-sentence promise of what will exist at the end.>

## Before you start

<Only the hard prerequisites. Link out for anything optional — do not teach it here.>

## Step 1 — <do the first concrete thing>

<Imperative instruction. One action.>

```bash
<exact command>
```

You'll see <the concrete, comprehensible result of this step — a message, a file, a screen>.

## Step 2 — <next concrete thing>

<Imperative instruction.>

```bash
<exact command>
```

You'll see <the concrete result>.

<!-- Continue with as many steps as needed. Every step must produce a visible result. -->

## What you built

<Restate the outcome. One sentence. Celebrate the learner's success.>

## Next steps

- [<A relevant how-to>](../how-to/<verb-noun>.md) — <the next real task the learner can tackle>.
- [<A relevant concept>](../explanation/concepts.md) — <understand why this works the way it does>.

## Also see

- [Quickstart](../tutorials/quickstart.md) — the canonical first-touch tutorial.
- [<Related tutorial>](../tutorials/<other>.md) — <what to learn next>.
````

### Tutorial quality checklist

- [ ] Does it work for every user, every time? (No "it depends on your setup.")
- [ ] Does every step produce a comprehensible, visible result?
- [ ] Is there exactly one happy path? (No branching, no "you could also…")
- [ ] Is explanation ruthlessly minimised? (No "why" digressions — link out instead.)
- [ ] Are all steps concrete and specific? (No "configure your environment" without exact commands.)
- [ ] Is the outcome meaningful? (The learner built something recognisable, not a contrived toy.)
- [ ] Are "Next steps" and "Also see" links present and correct?

---

## How-to guide — `how-to/*.md`

Goal-oriented directions for an already-competent user. A real-world task. Assume they know the basics; do not teach. (https://diataxis.fr/how-to-guides/)

````markdown
# How to <accomplish a specific real-world task>

<One sentence naming the goal and when you'd want it.>

> **Prerequisites:** <what must already be true / set up — stated as facts, not instructions>.

## Steps

1. **<Imperative step title>** — <one-line description of what this step achieves>.

   ```bash
   <exact command>
   ```

   <What the user should see. One sentence.>

2. **<Imperative step title>** — <one-line description>.

   <Exact action. If it's a UI action, describe the click path: "Go to **Settings → Integrations → Add**.">

3. **<Imperative step title>** — <one-line description>.

   ```bash
   <exact command>
   ```

> [!TIP]
> <An optional shortcut or common variant — keep it terse. One tip per guide unless they're closely related.>

> [!NOTE]
> <A constraint or limitation the user should be aware of.>

> [!WARNING]
> <A destructive or irreversible action to be careful about.>

## Verify it worked

<How the user confirms success — a command to run, a UI state to check, a log line to look for.>

## Troubleshooting

<Only if there's a common failure mode. One or two entries max — link to a dedicated troubleshooting how-to for more.>

### <Symptom>

<Cause and fix. One paragraph.>

## Next steps

- [<A related how-to>](../how-to/<verb-noun>.md) — <the next task in a typical workflow>.
- [<A relevant concept>](../explanation/concepts.md) — <understand the design behind this task>.

## Also see

- [<Reference for the flags/fields used here>](../reference/<component>.md) — <what each option does>.
- [<Related how-to>](../how-to/<verb-noun>.md) — <an alternative or complementary task>.
````

### How-to quality checklist

- [ ] Does the title name a real-world problem? ("How to configure SSO with Okta", not "SSO configuration.")
- [ ] Does it assume competence? (No teaching of basics — the user knows the domain.)
- [ ] Are the steps numbered, imperative, and in logical order?
- [ ] Is every step actionable? (No "understand the concept" steps.)
- [ ] Does it state the goal at the start and how to verify success at the end?
- [ ] Is there no explanation digression? (Link out for "why" — don't embed it.)
- [ ] Are "Next steps" and "Also see" links present and correct?

---

## Reference — `reference/*.md`

Information-oriented. Austere, neutral, complete. Structure **mirrors the product**. Describe; don't instruct — link out for how-to/explanation. (https://diataxis.fr/reference/)

````markdown
# <Component / CLI / Configuration> reference

<One neutral sentence stating what this describes. No instruction. No "you".>

## <Subsystem — mirrors a real part of the product>

| Name | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `<option>` | `<type>` | `<default>` | <yes/no> | <neutral factual description — what it is, not what to do with it> |

### `<command / endpoint / field>`

<Neutral description of what it is and its exact behavior.>

- **Parameters:**
  - `<name>` (`<type>`) — <fact about what it accepts>.
  - `<name>` (`<type>`, optional) — <fact>. Default: `<default>`.
- **Returns:** `<type>` — <fact about what comes back>.
- **Side effects:** <fact about what else happens — files written, services restarted, etc.>
- **Errors:**
  - `<error code>` — <when it occurs and what it means>.

> [!NOTE]
> <A constraint or edge case the user should know — stated as a fact, not advice.>

## Also see

- [How to <use this>](../how-to/<verb-noun>.md) — <see this in a real task>.
- [<Why this works this way>](../explanation/concepts.md) — <the design rationale>.
- [<Related reference>](./<other>.md) — <adjacent component or subsystem>.
````

### Reference quality checklist

- [ ] Is the style austere and uncompromising? (No fluff, no persuasion, no "you should.")
- [ ] Does the structure mirror the product? (Same order, same names, same hierarchy.)
- [ ] Is every option, flag, field, endpoint, and return value documented?
- [ ] Is every entry consistent in format? (Same fields, same order, same voice.)
- [ ] Are there no instructions? (Describe, don't instruct — link to how-to instead.)
- [ ] Are there no explanations? (State facts, not reasons — link to explanation instead.)
- [ ] Are "Also see" links present and correct?

---

## Explanation — `explanation/*.md`

Understanding-oriented, discursive. Supplies the **why** — design decisions, constraints, background. Keeps its distance from step-by-step action. (https://diataxis.fr/explanation/)

````markdown
# <Understanding … / Why … / About …>

<Open with the question this page answers. Frame it as something the reader wonders.>

## <The concept / the design decision>

<Discursive prose. Explain why things are the way they are — decisions, trade-offs,
historical reasons, constraints. Connect ideas; build a mental model.>

<Take your time. This is the one quadrant where length is not a problem — clarity is.>

## How it relates to <adjacent concept>

<Join things together into a web of understanding. Show how this concept connects to
others — what depends on it, what it depends on, what it's an alternative to.>

## Design trade-offs

<If applicable: what were the alternatives considered? Why was this path chosen?
What are the costs of this decision? Honest, not promotional.>

## Historical context

<If applicable: was this always the case? What changed and when? Why was the change made?
This helps users who remember the old way understand the new way.>

## Next steps

- [<A related concept>](./<other>.md) — <the next idea to explore in this mental model>.
- [<A relevant how-to>](../how-to/<verb-noun>.md) — <put this understanding into practice>.

## Also see

- [<The reference that describes the machinery>](../reference/<component>.md) — <the factual description this page illuminates>.
- [<Related explanation>](./<other>.md) — <an adjacent concept>.
- [<External resource>](https://…) — <further reading on the underlying theory or pattern>.
````

### Explanation quality checklist

- [ ] Does it open with a question the reader actually wonders about?
- [ ] Is it discursive? (Takes its time, explores connections, considers alternatives.)
- [ ] Does it provide context? (Why was this choice made? What were the alternatives?)
- [ ] Does it build a mental model? (The reader comes away understanding how pieces fit together.)
- [ ] Does it keep its distance from action? (No step-by-step instructions.)
- [ ] Does it connect to related ideas? (Links to adjacent concepts, reference, and how-tos.)
- [ ] Is it grounded in the actual product? (Not a generic essay — specific to this codebase.)
- [ ] Are "Next steps" and "Also see" links present and correct?

---

## Landing — `index.md`

Codex-style landing (presentation layer). H1 + tagline, capability blurbs, action cards. (https://developers.openai.com/codex)

````markdown
# <Product Name>

<One-line tagline.>

<Two–three sentence overview: what the product is and who it's for.>

---

## <Capability one>

<Short paragraph — what the user can do and why it matters. One capability per section.>

## <Capability two>

<Short paragraph.>

## <Capability three>

<Short paragraph.>

<!-- 3–5 capability blurbs is the sweet spot. More than 6 and the page loses focus. -->

---

## Get started

<div class="card-grid">

- **[Quickstart](tutorials/quickstart.md)**
  <Get to your first success in ~<n> minutes.>

- **[How-to guides](how-to/)**
  <Accomplish specific tasks — step-by-step recipes for real work.>

- **[Reference](reference/)**
  <Look up configuration, CLI commands, and API details.>

- **[Explanation](explanation/)**
  <Understand the concepts, architecture, and design decisions.>

</div>
````

### Landing quality checklist

- [ ] Is the H1 the product name and the tagline one line?
- [ ] Is the overview two–three sentences — who and what, not how?
- [ ] Are there 3–5 capability blurbs, each a short header + one paragraph?
- [ ] Do the action cards cover all four sections?
- [ ] Is the page scannable in under 10 seconds?
- [ ] Are all links relative and correct?
