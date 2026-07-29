---
name: port-opencode-agent-pack
description: Port or audit an OpenCode Markdown agent package as a native Cognia capability pack, preserving agents, prompts, inline Markdown context, commands, skills, tools, permissions, delegation, workflow, knowledge, Context Engine behavior, and Shepherd managed-coding guarantees. Use when converting `.opencode` or OpenCode agent/command/skill files into a Cognia pack directory, reviewing an existing port for omissions, or validating that pack-relative `@path/file.md` references and managed build semantics are correct.
---

# Port an OpenCode agent pack

Produce a native, configuration-driven Cognia pack. Preserve behavior deliberately; never perform a file-format-only conversion and assume parity.

## Required references

Read these files before editing a port:

1. [OpenCode-to-Cognia mapping](references/opencode-to-cognia-map.md) for the complete artifact and field conversion.
2. [Context Engine and Shepherd rules](references/context-engine-and-shepherd.md) whenever the source uses long-running sessions, child agents, large outputs, coding/build agents, retained work, replay, or settlement.
3. [Shepherd port acceptance boundary](references/shepherd-port-acceptance.md) for the self-contained managed-coding conformance gates, current production profile, non-claims, known gaps, and focused-test evidence map. Read it for every Shepherd-enabled or coding/build-agent port.
4. The repository's current `AGENTS.md`, `CLAUDE.md`, `docs/pack-authoring.md`, and applicable `docs/packs/*.md` references. Repository schemas and runtime source win when documentation disagrees.

The skill also vendors the three source snapshots behind the acceptance boundary. Load [Shepherd grade gap analysis](references/shepherd-grade-gap-analysis.md) when comparing upstream/public Shepherd capabilities, [Phase 15 conformance snapshot](references/shepherd-phase-15-conformance.md) when auditing claimed implementation evidence, and [Shepherd runtime snapshot](references/shepherd-runtime.md) when checking the guarded workspace production behavior. These local copies remain available if the original plan or documentation paths are removed.

Read the entire source package, including hidden configuration, before deciding its shape. Record the source OpenCode version or evidence date; do not treat moving upstream behavior as timeless.

## Porting workflow

### 1. Inventory behavior before files

Create a private conversion matrix with one row for every source artifact and capability:

- agents and their mode, visibility, prompts, model options, tools, permissions, and step limits;
- Markdown files referenced by agent prompts;
- commands, arguments, target agents, subtask behavior, and templates;
- skills, rules, hooks, plugins, MCP/tool dependencies, and external instructions;
- delegation graph, continuation/resume behavior, concurrency, and depth;
- knowledge sources, eagerly loaded context, retrieval rules, and output files used as durable memory;
- workflow states, retries, review/approval gates, user questions, and completion conditions;
- filesystem, process, network, provider, credential, publishing, and settlement effects;
- context-management assumptions such as child isolation, compaction, large-output storage, and exact-evidence recovery.

Classify each row as `native`, `adapted`, `blocked`, or `intentionally omitted with user approval`. Never silently discard an OpenCode capability.

### 2. Establish the Cognia manifest

Create a pack directory and make `pack.yaml` the only manifest authority. Declare every supplied section through `provides`; do not rely on a conventional folder that the manifest does not expose. Keep agent IDs, phase IDs, tool IDs, KB domains, effects, models, and paths in YAML/Markdown configuration rather than TypeScript literals.

Use the repository schemas for exact fields. Add optional support files only when the source behavior needs them; do not fabricate ceremonies, events, or workflow semantics to make the directory look complete.

### 3. Convert agents and prompt Markdown

Create one `agents/<agent-id>.yaml` per runnable agent. Map role, mode, visibility, capabilities, model options, turn/step limits, skills, tools, permissions, knowledge, and spawn rules explicitly.

Keep substantial persona and procedure text as Markdown inside the pack and inject it from `prompt.template` with pack-relative mentions:

```yaml
prompt:
  mode: full
  template: |
    @config/agents/agent-x-persona.md
    @config/workflows/agent-x-runtime.md
```

Apply all mention rules:

- In an agent YAML prompt, resolve `@config/agents/agent-x-persona.md` from the pack root.
- In an included Markdown file, resolve a nested mention relative to that including file's directory. Use an explicit pack-root path from agent YAML; use a correct sibling-relative path only inside included Markdown.
- Use inline file mentions only in agent `prompt.template` content and files recursively reached from it. Command bodies and `workflow.yaml` do not pass through the pack mention expander; use skills, `kb-load://`, or ordinary non-include references there.
- Use `/`, never `\`; never use an absolute path, URI, `..`, workspace-relative path, home path, or a path outside the pack.
- Use a standalone unquoted token with a supported text suffix: `.md`, `.markdown`, `.mdx`, or `.txt`. Do not wrap the token in inline code. A package name, email, or extensionless `@name` is not a file include.
- Keep total expanded content within the runtime's 100 KB inline budget and nesting within five levels. Prefer skills or KB retrieval for large material.
- Treat missing, escaped, circular, truncated, and unresolved mentions as port failures. The runtime warning is fail-safe behavior, not acceptance.
- Remember that included frontmatter is stripped. Put instructions in the Markdown body.

Do not copy an OpenCode agent Markdown file unchanged when its frontmatter contains runtime configuration. Move runtime fields into agent YAML and retain only prompt body text in the mentioned file.

### 4. Convert delegation and commands

Model child agents with `mode`, `spawn`, `runtime.subagents`, agent tool lists, and permissions. Preserve fresh-child versus explicit-continuation semantics. Declare every `spawn.canSpawn` target and keep depth/concurrency within Cognia limits. Do not invent agent IDs or rely on prose to grant delegation.

Convert command Markdown into `commands/*.md` with Cognia-supported frontmatter/body. Preserve target `agent`, `subtask`, arguments, model/tool overrides, and visible intent. Replace OpenCode-only UI or task protocols with Cognia-native tools and durable state; document any behavioral adaptation in the conversion matrix.

### 5. Convert skills, knowledge, tools, and permissions

- Put each runtime skill at `skills/<skill-id>/SKILL.md`; make `name` match the directory; bind it from each authorized agent's `skills` list. Preserve source licensing/provenance.
- Put durable reference corpora behind `kb-pack.yaml` and `kb://` URIs. Use `kb-load://` only in prompt/command bodies that require controlled eager loading. Do not use inline mentions as an unbounded KB substitute.
- Map tool names to registered Cognia tools. Replace, adapt, or block OpenCode-only tools explicitly. Do not grant generic `exec` to a Shepherd-managed supervisor or worker; registered host verification profiles and brokered effects must remain authoritative.
- Translate permissions by effect, not by similar-looking labels. Deny unneeded process, network, credential, package-mutation, publish, and settlement authority.
- Keep workflow, ceremonies, events, enforcement, and GitFlow in their pack configuration files. Validate every referenced agent, phase, domain, tool, and path.

### 6. Apply Context Engine and Shepherd boundaries

Use the dedicated reference. In brief:

- Context Engine owns bounded model projections, epochs, summaries, recall, output artifacts, and child-context containment.
- Shepherd owns tasks, effects, scopes, traces, placement, retained candidates, settlement, replay, and meta-agent decisions.
- Do not duplicate either state machine in prompts, skills, workflow YAML, or custom plugins.
- A normal pack must remain behaviorally unchanged when it does not opt in.
- A managed coding pack must opt in through `runtime.shepherd` and the application feature gate, use host-owned authority, and state only the guarantees of its actual placement profile.

### 7. Audit before acceptance

Run the bundled structural audit first:

```bash
node .claude/skills/port-opencode-agent-pack/scripts/audit-pack-port.mjs packs/<pack-id>
```

Then run repository-native validation and focused tests that load the pack, expand every agent prompt mention, check cross-references, verify permissions, and exercise the source package's critical journeys. For code changes, run the repository-required typecheck, full tests, and build.

Inspect the final expanded system prompt for every agent. Validate behavior, not only YAML parsing. A valid port must prove:

- every inventory row has a disposition and every promised capability has evidence;
- no unresolved or over-budget `@` mention remains;
- no OpenCode-only path, tool, protocol, task state, or hidden dependency is still authoritative;
- fresh child runs do not inherit parent transcripts, and child results return bounded envelopes;
- large outputs remain recoverable through scoped artifacts instead of destructive truncation;
- managed coding effects, placement claims, retained candidates, and settlement follow the Shepherd contract;
- non-opted-in packs and unrelated capabilities have not regressed.

Report migrated capabilities, adaptations, omissions/blockers, placement/non-claims, tests, and remaining risks. Never describe a skipped or unavailable check as passing.
