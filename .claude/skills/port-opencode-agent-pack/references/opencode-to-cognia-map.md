# OpenCode-to-Cognia mapping

## Contents

1. [Authority and layout](#authority-and-layout)
2. [Agent conversion](#agent-conversion)
3. [Inline Markdown context](#inline-markdown-context)
4. [Commands and arguments](#commands-and-arguments)
5. [Skills and instructions](#skills-and-instructions)
6. [Tools, MCP, and permissions](#tools-mcp-and-permissions)
7. [Delegation and sessions](#delegation-and-sessions)
8. [Knowledge and durable memory](#knowledge-and-durable-memory)
9. [Workflow and support files](#workflow-and-support-files)
10. [Unsupported and adapted behavior](#unsupported-and-adapted-behavior)
11. [Acceptance matrix](#acceptance-matrix)

## Authority and layout

Port behavior into the current Cognia pack schema, not into a parallel OpenCode compatibility tree.

| Source concern | Cognia authority | Required rule |
| --- | --- | --- |
| Package manifest / `opencode.json` | `pack.yaml` | Declare each supplied file/directory in `provides`; declare runtime capabilities under `runtime`. |
| Agent Markdown | `agents/<id>.yaml` plus mentioned prompt Markdown | Move executable metadata to YAML; keep persona/procedure body as pack-local Markdown. |
| Command Markdown | `commands/*.md` | Preserve supported command frontmatter and body semantics. |
| Skills | `skills/<id>/SKILL.md` | Match directory and `name`; bind from agent YAML. |
| Tool catalog | built-in tool registry and optional `tool-pack.yaml` | Use registered IDs and explicit permissions. |
| Project instructions | pack prompt Markdown, skills, KB, or workspace instructions | Choose by lifecycle and authority; do not paste everything into every prompt. |
| Workflow/task state | `workflow.yaml`, commands, runtime task/session stores | Do not emulate durable task state only in prompt prose. |
| Models/defaults | settings/release configuration and agent/command YAML | Preserve override precedence; never hard-code a named model in kernel code. |

Recommended pack shape:

```text
packs/<pack-id>/
├── pack.yaml
├── workflow.yaml
├── agents/*.yaml
├── config/agents/*.md
├── config/workflows/*.md
├── skills/<skill-id>/SKILL.md
├── commands/*.md
├── tool-pack.yaml
├── kb-pack.yaml
├── permissions.yaml
├── ceremonies.yaml
├── events.yaml
├── enforcement/*.yaml
└── references/*.md
```

Only create files required by the source capability set.

## Agent conversion

Use `docs/packs/agent-yaml-reference.md` and `AgentDefinitionZ` for current truth.

| OpenCode agent concern | Cognia field/action |
| --- | --- |
| agent file name/name | `id`, `name`, `description`; use stable lowercase-hyphen IDs |
| primary/subagent/all | `mode: primary | subagent | all` |
| hidden/disabled/color/native/options | corresponding agent YAML fields when supported |
| prompt body | `prompt.template` or pack-relative mentioned Markdown |
| prompt loading profile | `prompt.mode` and supported `prompt.sections` |
| model/provider | `provider.default` / `provider.override`; keep user-configurable defaults configurable |
| temperature/top-p | `temperature`, `topP` |
| steps/turn budget | `maxSteps`, then `maxTurns` fallback |
| provider variant/options | `variant` plus `variants`; verify provider forwarding and precedence |
| tools map/list | authorized `tools` list plus permission policy; do not assume false entries map to omission without checking source semantics |
| permissions | agent `permissions`, `permissions.yaml`, and runtime effect grants |
| subagent permission | `spawn.enabled`, `spawn.canSpawn`, mode restrictions, session runtime flags, and `sessions_spawn`/task tools |
| role | `capabilities`, `roleTag`, visibility, and workflow references |
| instructions from files | `@config/...md`, skill binding, or KB URI according to size/lifecycle |

Set all six capability booleans deliberately. `codingAgent: true` is required for source-writing/reviewing agents; it does not itself grant tools, Shepherd, or filesystem authority.

Do not copy unsupported frontmatter into `options` as a way to claim support. Trace the runtime consumer for every opaque option.

## Inline Markdown context

Agent YAML is the root include context. Use pack-root-relative paths such as:

```yaml
prompt:
  template: |
    @config/agents/agent-x-persona.md
```

The expander recognizes a standalone token matching a safe pack-relative path ending in `.md`, `.markdown`, `.mdx`, or `.txt`. It strips included frontmatter, expands recursively, guards pack escape, detects active recursion cycles, stops after five nested levels, and enforces a shared 100 KB content budget. The runtime applies this expander to agent `prompt.template` content only. A matching token in `commands/*.md` or `workflow.yaml` remains literal; replace it with a skill binding, `kb-load://`, or a normal reference that does not claim inline injection.

Nested references resolve relative to the including file. For example, inside `config/agents/agent-x-persona.md`, `@../shared/review.md` would be rejected by the project porting policy even if it remains inside the pack; prefer a layout where nested sibling references do not need `..`, or include the shared file explicitly from the agent YAML. This stricter authoring rule makes audits and moves predictable.

Use an inline mention for small, mandatory, stable prompt material. Use a skill for reusable procedural behavior. Use KB configuration and retrieval for large or selectively relevant knowledge. Use Context Engine artifacts for large run outputs. These are different lifecycles and must not be collapsed into one include mechanism.

Acceptance requires loading every agent through the real pack loader and asserting that `expandPackMentions` reports all expected files and zero warnings.

## Commands and arguments

Map source command metadata only to fields consumed by Cognia's `SlashCommandZ`: `id`, `label`, `description`, `visibleTo`, `template`, `category`, `tags`, `mode`, `agent`, `subtask`, `model`, `temperature`, `maxTokens`, `tools`, `overrides`, `arguments`, `body`, and `source`.

- Preserve command-to-agent routing.
- Preserve subtask execution without switching the primary chat when that is the source behavior.
- Convert positional or `$ARGUMENTS` usage into declared typed arguments and the repository-supported template syntax.
- Replace OpenCode-specific UI tags or question protocols with Cognia's registered tools/UI contract.
- Treat command `tools` as a restriction/override only after verifying runtime precedence; it is not a substitute for the agent's permissions.
- Keep command bodies bounded. Use `kb-load://` for controlled task-specific knowledge and artifact handles for large outputs.

Test parsing, visibility, routing, argument substitution, tool restriction, and the actual target agent.

## Skills and instructions

For each source skill:

1. Preserve license and upstream provenance where required.
2. Remove assumptions about unavailable OpenCode tools, hooks, UI protocols, or paths.
3. State the Cognia-native replacement explicitly.
4. Keep `name` equal to the skill directory.
5. Bind the skill in every intended agent's `skills` list.
6. Use the skill's `agents` restriction for defense in depth when appropriate; current runtime filtering requires both agent opt-in and skill authorization.
7. Preserve trigger intent in the description/triggers but do not assume metadata alone executes the skill.

Do not duplicate the same mandatory rule in persona, skill, command, and KB. Choose one authority and reference it from the others.

## Tools, MCP, and permissions

Build a source-to-target tool table. For every tool, record target ID, availability, permission, effect category, and behavioral differences.

- File read/write/search tools must respect delegated file scope.
- Generic shell/process access is not equivalent to registered verification profiles.
- A Shepherd-enabled supervisor or worker must not retain generic `exec`; prompt prohibitions cannot enforce denied process/network/credential effects. Use host-registered structured operations and the effect broker.
- MCP connectivity does not grant permission to its effects. Declare server availability separately from agent tool/effect authority.
- Network, credentials, package mutation, Git publish, external databases, and settlement require explicit policy.
- Do not grant a broader tool because a narrow OpenCode tool has no direct equivalent. Mark the capability blocked or implement an approved adapter.
- Validate provider and tool output through Context Engine externalization; never restore old destructive truncation behavior in a pack plugin.

## Delegation and sessions

OpenCode task isolation maps to Cognia child sessions, not to copying the parent history into a new prompt.

- A new delegated task receives its agent policy, explicit task, allowed knowledge/attachments, attenuated permissions, and scoped files—not the parent transcript.
- Only explicit continuation by child/session ID may resume existing child context.
- Return a bounded result envelope with status, summary, changed artifacts, usage/cost, and a child handle. Keep full transcript retrieval explicit and authorized.
- Map source depth and concurrency to Cognia's supported maximum depth and concurrency; reducing either is a behavioral adaptation that must be documented and tested.
- Make `spawn.canSpawn` the allowlist. Agent capabilities or prose do not authorize an undeclared target.
- Keep primary, subagent, hidden, and manual-mention behavior distinct.
- Preserve parent/child cancellation, steering, background completion, timeout, and handoff semantics only when the relevant pack and application runtime flags are enabled.

## Knowledge and durable memory

Separate four kinds of information:

| Information | Cognia mechanism |
| --- | --- |
| small mandatory identity/rules | prompt Markdown mention |
| reusable procedure | skill |
| curated reference corpus | `kb-pack.yaml`, tiers, `kb://`, search/load |
| run output/evidence/progress | Context Engine artifacts, snapshots, recall, workflow state |

Do not claim that a vector/BM25 index is long-term agent memory. Preserve exact evidence through immutable artifacts and controlled reads. Configure sources/domains/tiers/budgets in YAML, validate every URI, and keep access restrictive unless explicitly broadened.

If the OpenCode package uses generated Markdown files as external memory, preserve the files' ownership, update protocol, and retrieval path. Do not eagerly inject their full contents on every turn.

## Workflow and support files

Map source orchestration into declared configuration only where Cognia actually consumes it:

- `workflow.yaml`: phases, transitions, assignees, modes, routing, retry metadata;
- `ceremonies.yaml`: participants, facilitator, aliases, end phrases;
- `events.yaml`: categories and typed events;
- `permissions.yaml`: permission types/presets;
- `tool-pack.yaml`: declared pack tools;
- `kb-pack.yaml`: sources/domains/tiers/budgets;
- `enforcement/`: deterministic audit rules;
- `gitflow.yaml`: configured branch/commit/PR behavior;
- `commands/`: user entry points.

Check the current runtime before promising that declarative metadata executes a flow. Parsing and validation alone are not execution evidence.

## Unsupported and adapted behavior

Search the source and result for OpenCode-specific residues, including `.opencode/`, `opencode.json`, `TodoWrite` state, `<question-form>`, GenUI/live-artifact protocols, daemon loops, arbitrary plugin hooks, unrestricted shell commands, source-only tool names, source session IDs, and external instruction paths.

For each residue:

1. map it to a native Cognia mechanism;
2. implement a scoped adapter with tests; or
3. mark it blocked/omitted and obtain user approval.

Never leave source syntax in the prompt and hope the model improvises the missing runtime.

## Acceptance matrix

The final port report must cover these rows:

| Area | Evidence |
| --- | --- |
| Manifest and schemas | Real pack loader succeeds; all `provides` paths exist. |
| Agents | IDs, modes, visibility, capabilities, models, budgets, skills, tools, and permissions verified. |
| Mentions | All expected Markdown loaded; zero warnings/cycles/truncation; expanded prompts inspected. |
| Commands | Parser, routing, arguments, subtask behavior, and tool/model overrides tested. |
| Delegation | Spawn graph, attenuation, fresh/resumed context, concurrency, cancellation, and result envelope tested. |
| Skills/KB | Binding/access rules, URIs, budgets, triggers, provenance, and selective loading tested. |
| Workflow/support | Every cross-reference resolves and each claimed runtime behavior has an execution test. |
| Context | Large outputs recoverable; epochs/snapshots/recall and child containment preserve exact evidence. |
| Shepherd | Opt-in, effect grants, placement truth, trace, retained candidate, preview, explicit consume-once settlement, and failure recovery tested. |
| Compatibility | Non-opted-in packs and unrelated existing capabilities remain unchanged. |
| Verification | Focused tests, full tests, typecheck, and production build reported honestly. |
